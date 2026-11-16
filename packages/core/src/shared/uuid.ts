/**
 * UUIDv7 (RFC 9562) on the Web Crypto API, for Workers and Node.js alike: a 48-bit Unix
 * millisecond time, then 74 random bits. IDs sort roughly by creation, which keeps indexes
 * compact. The time is readable from the ID, so never use one as a secret: tokens and keys
 * take `crypto.getRandomValues` or `crypto.randomUUID()`.
 */
const HEX = '0123456789abcdef';

/** A fresh UUIDv7, lowercase and dashed. */
export function uuidv7(now: number = Date.now()): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const view = new DataView(bytes.buffer);
    // Bytes 0-5: the time, big-endian; 0-3 the high 32 bits, 4-5 the low 16.
    view.setUint32(0, Math.floor(now / 0x10000), false);
    view.setUint16(4, now & 0xffff, false);
    // The version (7) and the RFC 9562 variant (10xx).
    bytes[6] = (bytes[6]! & 0x0f) | 0x70;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    let out = '';
    for (let index = 0; index < 16; index++) {
        out += HEX[bytes[index]! >> 4]! + HEX[bytes[index]! & 0x0f]!;
        if (index === 3 || index === 5 || index === 7 || index === 9) out += '-';
    }
    return out;
}
