import { AuthorKeypair } from '../../util/doc-types';
import { ICryptoDriver } from '../../crypto/crypto-types';
import { IStorageAsync, IStorageDriverAsync } from '../../storage/storage-types';

import { Crypto } from '../../crypto/crypto';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';
import { StorageAsync } from '../../storage/storage-async';

import {
    BenchmarkRunner
} from './benchmark-runner';

//================================================================================

let pushLocal = async (storageFrom: IStorageAsync, storageTo: IStorageAsync): Promise<void> => {
    let docs = await storageFrom.getAllDocs();
    for (let doc of docs) {
        await storageTo.ingest(doc);
    }
}
let syncLocal = async (storage1: IStorageAsync, storage2: IStorageAsync): Promise<void> => {
    await pushLocal(storage1, storage2);
    await pushLocal(storage2, storage1);
}

//================================================================================

export let runStorageDriverBenchmark = async (runner: BenchmarkRunner, cryptoDriver: ICryptoDriver, makeStorageDriver: () => IStorageDriverAsync, scenarioName: string) => {
    //==================================================
    // setup

    runner.setScenario(scenarioName);

    let workspace = '+gardening.pals';
    let crypto = new Crypto(cryptoDriver);
    let validator = new FormatValidatorEs4(crypto);
    let storageDriver = makeStorageDriver();

    let keypair1 = crypto.generateAuthorKeypair('aaaa') as AuthorKeypair;
    let keypair2 = crypto.generateAuthorKeypair('aaaa') as AuthorKeypair;
    let keypair3 = crypto.generateAuthorKeypair('aaaa') as AuthorKeypair;

    //==================================================
    // benchmarks

    let n = 100;
    for (let n of [100, 500]) {
        let storageAdd = new StorageAsync(workspace, validator, storageDriver);
        await runner.runOnce(`add ${n} docs (docs/sec)`, {actualIters: n}, async () => {
            for (let ii = 0; ii < n; ii++) {
                await storageAdd.set(keypair1, {
                    format: 'es.4',
                    workspace: workspace,
                    path: '/test/' + ii,
                    content: 'hello' + ii,
                });
            }
        });

        let storageSync = new StorageAsync(workspace, validator, storageDriver);
        await runner.runOnce(`sync ${n} docs to empty storage (docs/sec)`, {actualIters: n}, async () => {
            await syncLocal(storageAdd, storageSync);
        });

        await runner.runOnce(`sync ${n} docs again to full storage (docs/sec)`, {actualIters: n}, async () => {
            await syncLocal(storageAdd, storageSync);
        });

        runner.note('');
    }

    //==================================================
    // teardown
}
