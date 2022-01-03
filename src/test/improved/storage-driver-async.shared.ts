import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';
import { throws } from '../test-utils';
//t.runOnly = true;

import { Doc } from '../../util/doc-types';
import { Query } from '../../query/query-types';
import { GlobalCryptoDriver } from '../../crypto/global-crypto-driver';

import { TestScenario } from './test-scenario-types';

//================================================================================

import {
    LogLevel,
    setDefaultLogLevel,
} from '../../util/log';
//setDefaultLogLevel(LogLevel.Debug);
let J = JSON.stringify;

//================================================================================

export let runStorageDriverTests = (scenario: TestScenario) => {

    let TEST_NAME = 'storage-driver shared tests';
    let SUBTEST_NAME = scenario.name;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': empty storage, close', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let driver = scenario.makeDriver(workspace);

        t.same(driver.getMaxLocalIndex(), -1, 'maxLocalIndex starts at -1');
        t.same(await driver.queryDocs({}), [], 'query returns empty array');

        await driver.close(true);
        t.same(driver.isClosed(), true, 'isClosed');

        await throws(t, async () => driver.getMaxLocalIndex(), 'getMaxLocalIndex throws when closed');
        await throws(t, async () => await driver.queryDocs({}), 'queryDocs throws when closed');
        await throws(t, async () => await driver.upsert({} as any), 'upsert throws when closed');

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': config', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let driver = scenario.makeDriver(workspace);

        // empty...
        t.same(await driver.getConfig('foo'), undefined, `getConfig('nonexistent') --> undefined`);
        t.same(await driver.listConfigKeys(), scenario.builtinConfigKeys, `listConfigKeys() only contains builtin config keys: ${scenario.builtinConfigKeys}`);
        t.same(await driver.deleteConfig('foo'), false, `deleteConfig('nonexistent') --> false`);

        // set some items...
        await driver.setConfig('b', 'bb');
        await driver.setConfig('a', 'aa');

        // after adding some items...
        t.same(await driver.getConfig('a'), 'aa', `getConfig works`);
        t.same(await driver.listConfigKeys(), ['a', 'b', ...scenario.builtinConfigKeys], `listConfigKeys() is ${(['a', 'b', ...scenario.builtinConfigKeys])} (sorted)`);

        t.same(await driver.deleteConfig('a'), true, 'delete returns true on success');
        t.same(await driver.deleteConfig('a'), false, 'delete returns false if nothing is there');
        t.same(await driver.getConfig('a'), undefined, `getConfig returns undefined after deleting the key`);

        await driver.close(true);
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': upsert and basic querying with one path', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let driver = scenario.makeDriver(workspace);

        let doc0: Doc = {
            format: 'es.4',
            author: '@suzy.bolxx3bc6gmoa43rr5qfgv6r65zbqjwtzcnr7zyef2hvpftw45clq',
            content: 'Hello 0',
            contentHash: 'bnkc2f3fbdfpfeanwcgbid4t2lanmtq2obsvijhsagmn3x652h57a',
            deleteAfter: null,
            path: '/posts/post-0000.txt',
            timestamp: 1619627796035000,
            workspace: '+gardening.abc',
            signature: 'whatever0',  // upsert does not check signature or validate doc
        }
        // same author, newer
        let doc1 = {
            ...doc0,
            content: 'Hello 1',
            timestamp: doc0.timestamp + 1, // make sure this one wins
            signature: 'whatever1',  // everything assumes different docs have different sigs
        }
        // second author, newer still
        let doc2 = {
            ...doc0,
            author: '@timm.baaaaaaaaaaaaaaaaaaaaaaaaazbqjwtzcnr7zyef2hvpftw45clq',
            content: 'Hello 2',
            timestamp: doc0.timestamp + 2, // make sure this one wins
            signature: 'whatever2',  // everything assumes different docs have different sigs
        }
        // second author, older
        let doc3 = {
            ...doc0,
            author: '@timm.baaaaaaaaaaaaaaaaaaaaaaaaazbqjwtzcnr7zyef2hvpftw45clq',
            content: 'Hello 3',
            timestamp: doc0.timestamp - 3, // make sure this one wins
            signature: 'whatever3',  // everything assumes different docs have different sigs
        }
        // third author, oldest
        let doc4 = {
            ...doc0,
            author: '@bobo.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxnr7zyef2hvpftw45clq',
            content: 'Hello 4',
            timestamp: doc0.timestamp - 4, // make sure this one wins
            signature: 'whatever4',  // everything assumes different docs have different sigs
        }

        let docResult: Doc = await driver.upsert(doc0);
        t.same(docResult._localIndex, 0, 'upsert doc0, localIndex is now 0');
        t.same(driver.getMaxLocalIndex(), docResult._localIndex, 'driver.getMaxLocalIndex() matches doc._localIndex');

        let docs = await driver.queryDocs({});
        t.same(docs.length, 1, 'query returns 1 doc');
        t.same(docs[0]._localIndex, 0, 'docs[0]._localIndex');
        t.same(docs[0].content, 'Hello 0', 'content is from doc0');

        //-----------------

        // overwrite same author, latest
        docResult = await driver.upsert(doc1);
        t.same(docResult._localIndex, 1, 'upsert doc1 from same author, localIndex is now 1');
        t.same(driver.getMaxLocalIndex(), docResult._localIndex, 'driver.getMaxLocalIndex() matches doc._localIndex');

        docs = await driver.queryDocs({});
        t.same(docs.length, 1, 'query returns 1 doc');
        t.same(docs[0]._localIndex, 1, 'docs[0]._localIndex');
        t.same(docs[0].content, 'Hello 1', 'content is from doc1');

        //-----------------

        // add a second author, latest
        docResult = await driver.upsert(doc2);
        t.same(docResult._localIndex, 2, 'upsert doc2 from second author, localIndex is now 3');
        t.same(driver.getMaxLocalIndex(), docResult._localIndex, 'driver.getMaxLocalIndex() matches doc._localIndex');

        let latestDocs = await driver.queryDocs({ historyMode: 'latest' });
        t.same(latestDocs.length, 1, 'there is 1 latest doc');
        t.same(latestDocs[0]._localIndex, 2, 'latestDocs[0]._localIndex');
        t.same(latestDocs[0].content, 'Hello 2', 'content is from doc2');

        let allDocs = await driver.queryDocs({ historyMode: 'all' });
        t.same(allDocs.length, 2, 'there are 2 overall docs');
        t.same(allDocs[0].content, 'Hello 2', "latestDocs[0].content is 2 (it's the latest)");
        t.same(allDocs[1].content, 'Hello 1', 'latestDocs[1].content is 1');

        //-----------------

        // add a second author, older, overwriting the previous newer one from same author.
        // -- should not bounce, that's the job of IStorage
        docResult = await driver.upsert(doc3);
        t.same(docResult._localIndex, 3, 'upsert doc3 from second author (but older), localIndex is now 3');
        t.same(driver.getMaxLocalIndex(), docResult._localIndex, 'driver.getMaxLocalIndex() matches doc._localIndex');

        // latest doc is now from author 1
        latestDocs = await driver.queryDocs({ historyMode: 'latest' });
        t.same(latestDocs.length, 1, 'there is 1 latest doc');
        t.same(latestDocs[0]._localIndex, 1, 'latestDocs[0]._localIndex');
        t.same(latestDocs[0].content, 'Hello 1', 'content is from doc1');

        allDocs = await driver.queryDocs({ historyMode: 'all' });
        t.same(allDocs.length, 2, 'there are 2 overall docs');
        t.same(allDocs[0].content, 'Hello 1', "latestDocs[0].content is 1 (it's the latest)");
        t.same(allDocs[1].content, 'Hello 3', 'latestDocs[1].content is 3');

        //-----------------

        // add a third author, oldest
        docResult = await driver.upsert(doc4);
        t.same(docResult._localIndex, 4, 'upsert doc4 from new third author (but oldest), localIndex is now 5');
        t.same(driver.getMaxLocalIndex(), docResult._localIndex, 'driver.getMaxLocalIndex() matches doc._localIndex');

        // latest doc is still from author 1
        latestDocs = await driver.queryDocs({ historyMode: 'latest' });
        t.same(latestDocs.length, 1, 'there is 1 latest doc');
        t.same(latestDocs[0]._localIndex, 1, 'latestDocs[0]._localIndex is 1');
        t.same(latestDocs[0].content, 'Hello 1', 'content is from doc1');

        allDocs = await driver.queryDocs({ historyMode: 'all' });
        t.same(allDocs.length, 3, 'there are 2 overall docs');
        t.same(allDocs[0].content, 'Hello 1', "latestDocs[0].content is 1 (it's the latest)");
        t.same(allDocs[1].content, 'Hello 3', 'latestDocs[1].content is 3');
        t.same(allDocs[2].content, 'Hello 4', 'latestDocs[2].content is 4');

        //-----------------
        // test querying

        type Vector = { query: Query, expectedContent: string[] };
        let vectors: Vector[] = [
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                },
                expectedContent: ['Hello 1', 'Hello 3', 'Hello 4'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                    limit: 2,
                },
                expectedContent: ['Hello 1', 'Hello 3'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                    startAfter: { localIndex: 2 },
                },
                expectedContent: ['Hello 3', 'Hello 4'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                    startAfter: { path: 'a' },  // invalid combo of orderBy and startAt
                },
                expectedContent: [],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                    startAfter: { localIndex: 2 },
                    limit: 1,
                },
                expectedContent: ['Hello 3'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex DESC',
                },
                expectedContent: ['Hello 4', 'Hello 3', 'Hello 1'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'path ASC',
                },
                // sort by timestamp when path is the same, as it is here
                expectedContent: ['Hello 1', 'Hello 3', 'Hello 4'],
            },
            {
                query: {
                    historyMode: 'latest',
                },
                expectedContent: ['Hello 1'],
            },
            {
                query: {},
                expectedContent: ['Hello 1'],
            },
            {
                query: { limit: 0, },
                expectedContent: [],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'path ASC',
                    filter: { author: doc0.author, },
                },
                expectedContent: ['Hello 1'],
            },
        ];

        for (let { query, expectedContent } of vectors) {
            let qr = await driver.queryDocs(query);
            let actualContent = qr.map(doc => doc.content);
            t.same(actualContent, expectedContent, `query: ${J(query)}`);
        }

        await driver.close(true);
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

};