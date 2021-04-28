/**
 * This file provides common operations on Buffer.
 * Any util function that uses a Buffer should be here, not in bytes.ts.
 */

//--------------------------------------------------

export let bytesToBuffer = (bytes: Uint8Array): Buffer =>
    Buffer.from(bytes);

export let bufferToBytes = (buf: Buffer): Uint8Array =>
    new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength / Uint8Array.BYTES_PER_ELEMENT);

//--------------------------------------------------

export let stringToBuffer = (str: string): Buffer =>
    Buffer.from(str, 'utf-8');

export let bufferToString = (buf: Buffer): string =>
    buf.toString('utf-8');