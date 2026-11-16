/**
 * UUIDv7 (RFC 9562) for generated `uuid` primary keys: a millisecond time, then random bits, so
 * new rows sort by creation and indexes stay compact. The same generator as
 * `@cossackframework/core`'s `uuidv7`, kept here so the ORM depends on no framework package.
 */
const HEX = '0123456789abcdef';

export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(now / 0x10000), false);
  view.setUint16(4, now & 0xffff, false);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let out = '';
  for (let index = 0; index < 16; index++) {
    out += HEX[bytes[index]! >> 4]! + HEX[bytes[index]! & 0x0f]!;
    if (index === 3 || index === 5 || index === 7 || index === 9) out += '-';
  }
  return out;
}
