// src/lib/uuid.ts
//
// Dependency-free UUIDv7 (RFC 9562) generator using only the Web Crypto API,
// so it runs unchanged on Cloudflare Workers and Node.js.
//
// UUIDv7 prefixes the value with a 48-bit Unix-millisecond timestamp, which
// makes IDs roughly time-sortable (useful for `ORDER BY id`) and reduces index
// fragmentation vs. random UUIDv4. The remaining 74 bits are random.
//
// Use this for every row id in the database instead of crypto.randomUUID()
// (which is v4 / non-sortable).

const HEX = '0123456789abcdef';

/** Generate a fresh UUIDv7 string (lowercase, dashed). */
export function uuidv7(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const now = Date.now();
    const view = new DataView(bytes.buffer);

    // Bytes 0..5 = 48-bit Unix-millisecond timestamp (big-endian, per RFC 9562).
    // Bytes 0..3 hold the top 32 bits (now >> 16); bytes 4..5 the low 16 bits.
    view.setUint32(0, Math.floor(now / 0x10000), false);
    view.setUint16(4, now & 0xffff, false);

    // version nibble (byte 6 high) = 7
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    // variant nibble (byte 8 high) = 10xx → 0b1000_0000 | (rand & 0x3f)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    // Format as 8-4-4-4-12.
    let out = '';
    for (let i = 0; i < 16; i++) {
        out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
        if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
    }
    return out;
}
