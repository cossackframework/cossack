import { describe, it, expect } from 'vitest';

// Inline copy of the uuidv7 implementation from src/stubs/uuid.ts.stub so the
// test does not depend on fs scaffolding. Keep in sync with the stub.
const HEX = '0123456789abcdef';
function uuidv7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(now / 0x10000), false);
  view.setUint16(4, now & 0xffff, false);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces RFC 9562-conformant strings (version 7, variant 10xx)', () => {
    for (let i = 0; i < 500; i++) {
      expect(uuidv7()).toMatch(UUIDV7_RE);
    }
  });

  it('produces unique values', () => {
    const ids = new Set();
    for (let i = 0; i < 10000; i++) ids.add(uuidv7());
    expect(ids.size).toBe(10000);
  });

  it('encodes the current Unix-ms timestamp in the first 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const tsHex = id.replace(/-/g, '').slice(0, 12);
    const ts = parseInt(tsHex, 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('sorts monotonically across different milliseconds', async () => {
    const ids = [];
    for (let i = 0; i < 10; i++) {
      ids.push(uuidv7());
      // Sleep > 1ms so each id lands in a distinct millisecond.
      await new Promise((r) => setTimeout(r, 3));
    }
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
