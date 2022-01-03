import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';
import { throws } from '../test-utils';
//t.runOnly = true;

import { WorkspaceAddress } from '../../util/doc-types';
import { IStorageAsync, IStorageDriverAsync } from '../../storage/storage-types';
import { GlobalCryptoDriver, setGlobalCryptoDriver } from '../../crypto/global-crypto-driver';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';
import { StorageAsync } from '../../storage/storage-async';

import { TestScenario } from './test-scenario-types';

//================================================================================

import {
    Logger, LogLevel, setLogLevel,
} from '../../util/log';
let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');
let J = JSON.stringify;
//setLogLevel('test', LogLevel.Debug);

//================================================================================

// all of the methods we're testing here are present on both Storage and StorageDriver,
// so we run the entire thing twice -- once running the tests on a Storage, and once
// on its StorageDriver directly.

export let runStorageConfigTests = (scenario: TestScenario) => {
    _runStorageConfigTests(scenario, 'storage');
    _runStorageConfigTests(scenario, 'storageDriver');
}

let _runStorageConfigTests = (scenario: TestScenario, mode: 'storage' | 'storageDriver') => {
    let TEST_NAME = 'storage config tests';
    let SUBTEST_NAME = `${scenario.name} (${mode} mode)`;

    let makeStorageOrDriver = (ws: WorkspaceAddress): IStorageAsync | IStorageDriverAsync => {
        let driver = scenario.makeDriver(ws);
        return mode === 'storage' ? new StorageAsync(ws, FormatValidatorEs4, driver) : driver;
    }

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': config basics, and close', async (t: any) => {
        setGlobalCryptoDriver(scenario.cryptoDriver);
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorageOrDriver(workspace);

        // methods in common between Storage and StorageDriver:
        // set, get, list, delete, erase, close

        // empty...
        t.same(await storage.getConfig('a'), undefined, `getConfig('nonexistent') --> undefined`);
        t.same(await storage.listConfigKeys(), scenario.builtinConfigKeys, `listConfigKeys() only contains built-in config keys`);
        t.same(await storage.deleteConfig('a'), false, `deleteConfig('nonexistent') --> false`);

        // set some items...
        await storage.setConfig('b', 'bb');
        await storage.setConfig('a', 'aa');

        // verify items are there...
        t.same(await storage.getConfig('a'), 'aa', `getConfig works`);
        t.same(await storage.listConfigKeys(), ['a', 'b', ...scenario.builtinConfigKeys], `listConfigKeys() is ${(['a', 'b', ...scenario.builtinConfigKeys])} (sorted)`);

        await storage.setConfig('a', 'aaa');
        t.same(await storage.getConfig('a'), 'aaa', `getConfig overwrites old value`);

        // delete items
        t.same(await storage.deleteConfig('a'), true, 'delete returns true on success');
        t.same(await storage.deleteConfig('a'), false, 'delete returns false if nothing is there');
        t.same(await storage.getConfig('a'), undefined, `getConfig returns undefined after deleting the key`);
        t.same(await storage.listConfigKeys(), ['b', ...scenario.builtinConfigKeys], `listConfigKeys() is ${(['b', ...scenario.builtinConfigKeys])} after deleting 'a'`);

        // close without erasing
        await storage.close(false);
        t.same(storage.isClosed(), true, 'storage is now closed');

        // config methods should throw when closed
        await throws(t, async () => { await storage.setConfig('x', 'xx'); }, 'setConfig should throw if used after close()');
        await throws(t, async () => { await storage.getConfig('b'); }, 'getConfig should throw if used after close()');
        await throws(t, async () => { await storage.listConfigKeys(); }, 'listConfigKeys should throw if used after close()');
        await throws(t, async () => { await storage.deleteConfig('b'); }, 'deleteConfig should throw if used after close()');
        await throws(t, async () => { await storage.close(false); }, 'close should throw if used after close()');

        // make a new one so we can erase it to clean up
        let storage2 = makeStorageOrDriver(workspace);
        await storage2.close(true);
        await throws(t, async () => { await storage2.close(true); }, 'close(true) should throw if used after close(true)');

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': config persist after closing and reopening', async (t: any) => {
        setGlobalCryptoDriver(scenario.cryptoDriver);
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage1 = makeStorageOrDriver(workspace);

        // set an item
        await storage1.setConfig('a', 'aa');

        // close, then reopen the same workspace, without erasing
        await storage1.close(false);
        t.same(storage1.isClosed(), true, 'close worked');
        let storage2 = makeStorageOrDriver(workspace);

        // see if data is still there (depending on the scenario)
        if (scenario.persistent) {
            t.same(await storage2.getConfig('a'), 'aa', 'this kind of storage should persist after close');
        } else {
            t.same(await storage2.getConfig('a'), undefined, 'this kind of storage should not persist after close');
        }

        // close and erase
        await storage2.close(true);

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': config erase should delete data', async (t: any) => {
        setGlobalCryptoDriver(scenario.cryptoDriver);
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage1 = makeStorageOrDriver(workspace);

        // set an item
        await storage1.setConfig('a', 'aa');

        // close and erase it...
        await storage1.close(true);
        t.same(storage1.isClosed(), true, 'closing should close');

        // re-open.  data should be gone.
        let storage2 = makeStorageOrDriver(workspace);
        t.same(await storage2.getConfig('a'), undefined, 'erase has emptied out the data');

        // clean up
        await storage2.close(true);

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

}
