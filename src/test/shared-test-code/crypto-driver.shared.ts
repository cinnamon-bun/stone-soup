import t = require('tap');
declare let window: any;

import {
    identifyBufOrBytes,
    stringToBytes
} from '../../util/bytes';
import {
    stringToBuffer,
} from '../../util/buffers';
import {
    base32StringToBytes
} from '../../crypto/base32';
import {
    ICryptoDriver
} from '../../crypto/crypto-types';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

//================================================================================

export let runCryptoDriverTests = (driver: ICryptoDriver) => {
    // Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
    let driverName = (driver as any).name;
    let nameOfRun = driverName;

    /* istanbul ignore next */ 
    if ((t.test as any).onFinish) {
        (t.test as any).onFinish(() => window.onFinish('crypto-driver shared tests -- ' + driverName));
    }

    t.test(nameOfRun + ': sha256(bytes | string) --> bytes', (t: any) => {
        let vectors : [Uint8Array | string | Buffer, Uint8Array][] = [
            // input, output
            ['', base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            [stringToBytes(''), base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            ['abc', base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [stringToBytes('abc'), base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [snowmanString, base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],
            [snowmanBytes, base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],

            // we're not supposed to feed it Buffers but let's find out what happens when we do.
            [stringToBuffer('abc'), base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [stringToBuffer(''), base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            [stringToBuffer(snowmanString), base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],
        ];
        for (let [input, expectedResult] of vectors) {
            let actualResult = driver.sha256(input);
            t.same(identifyBufOrBytes(actualResult), 'bytes', 'sha256 outputs bytes');
            t.same(actualResult.length, 32, 'sha256 outputs 32 bytes');
            t.same(actualResult, expectedResult, `hash of bytes or string: ${JSON.stringify(input)}`)
        }
        t.end();
    });

    t.test(nameOfRun + ': generateKeypairBytes', (t: any) => {
        let keypair = driver.generateKeypairBytes();
        t.same(identifyBufOrBytes(keypair.pubkey), 'bytes', 'keypair.pubkey is bytes');
        t.same(identifyBufOrBytes(keypair.secret), 'bytes', 'keypair.secret is bytes');
        t.same(keypair.pubkey.length, 32, 'pubkey is 32 bytes long');
        t.same(keypair.secret.length, 32, 'secret is 32 bytes long');
        t.notSame(keypair.secret, keypair.pubkey, 'secret is !== pubkey');

        let keypair2 = driver.generateKeypairBytes();
        t.notSame(keypair.pubkey, keypair2.pubkey, 'generateKeypairBytes is non-deterministic (pubkey)');
        t.notSame(keypair.secret, keypair2.secret, 'generateKeypairBytes is non-deterministic (secret)');

        t.end();
    });

    t.test(nameOfRun + ': sign and verify', (t: any) => {
        let keypairBytes = driver.generateKeypairBytes();
        let msg = 'hello'
        let sigBytes = driver.sign(keypairBytes, msg);

        t.same(identifyBufOrBytes(sigBytes), 'bytes', 'signature is bytes, not buffer');
        t.same(sigBytes.length, 64, 'sig is 64 bytes long');

        t.ok(driver.verify(keypairBytes.pubkey, sigBytes, msg), 'signature is valid');

        t.notOk(driver.verify(keypairBytes.pubkey, sigBytes, msg+'!'), 'signature is invalid after message is changed');

        // change the sig and see if it's still valid
        sigBytes[0] = (sigBytes[0] + 1) % 256;
        t.notOk(driver.verify(keypairBytes.pubkey, sigBytes, msg), 'signature is invalid after signature is changed');

        t.end();
    });

}