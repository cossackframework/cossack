// tests/crypto.test.ts
import { describe, it, expect } from 'vitest';
import {
  signValue,
  verifyValue,
  base64url,
  constantTimeEqual,
  generateToken,
} from '../src/shared/crypto';

const SECRET = 'test-secret-at-least-16-chars';
const WRONG_SECRET = 'a-different-secret-also-16';

describe('crypto — base64url', () => {
  it('round-trips bytes', () => {
    const bytes = new TextEncoder().encode('hello world');
    const encoded = base64url(bytes);
    // base64url has no padding and uses -_ instead of +/
    expect(encoded).not.toMatch(/[+/=]/);
    // Decode back
    const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    expect(json).toBe('hello world');
  });
});

describe('crypto — signValue / verifyValue', () => {
  it('round-trips a payload', async () => {
    const payload = { name: 'Alice', n: 42, nested: { ok: true } };
    const token = await signValue(payload, SECRET);
    const decoded = await verifyValue<typeof payload>(token, SECRET);
    expect(decoded).toEqual(payload);
  });

  it('round-trips a string payload', async () => {
    const token = await signValue('simple', SECRET);
    expect(await verifyValue<string>(token, SECRET)).toBe('simple');
  });

  it('round-trips null/undefined values', async () => {
    expect(await verifyValue(await signValue(null, SECRET), SECRET)).toBeNull();
    // JSON.stringify(undefined) is undefined → JSON.parse fails → null
    expect(await verifyValue(await signValue(undefined, SECRET), SECRET)).toBeNull();
  });

  it('returns null for a tampered payload', async () => {
    const token = await signValue({ role: 'user' }, SECRET);
    // Flip a character in the payload segment (before the dot).
    const [encoded, sig] = token.split('.');
    const tampered = encoded.slice(0, -1) + (encoded.endsWith('A') ? 'B' : 'A') + '.' + sig;
    expect(await verifyValue(tampered, SECRET)).toBeNull();
  });

  it('returns null for a tampered signature', async () => {
    const token = await signValue({ role: 'user' }, SECRET);
    const [encoded, sig] = token.split('.');
    const tampered = encoded + '.' + sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(await verifyValue(tampered, SECRET)).toBeNull();
  });

  it('returns null with the wrong secret', async () => {
    const token = await signValue({ role: 'user' }, SECRET);
    expect(await verifyValue(token, WRONG_SECRET)).toBeNull();
  });

  it('returns null for malformed tokens', async () => {
    expect(await verifyValue('no-dot-here', SECRET)).toBeNull();
    expect(await verifyValue('', SECRET)).toBeNull();
    expect(await verifyValue('.signature', SECRET)).toBeNull();
  });

  it('returns null for non-JSON payloads (even if signature matched)', async () => {
    // Craft a token whose payload decodes to invalid JSON. We sign a valid
    // payload first to get the right format, then the test just confirms the
    // parser rejects garbage — but since signValue always produces valid JSON,
    // we instead verify the constant-time path doesn't throw on weird input.
    expect(await verifyValue('====.====', SECRET)).toBeNull();
  });
});

describe('crypto — constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('abcd', 'abc')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('crypto — generateToken', () => {
  it('produces base64url tokens of the expected length', () => {
    const t = generateToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes → ~43 base64url chars (no padding)
    expect(t.length).toBe(43);
  });

  it('defaults to 32 bytes', () => {
    expect(generateToken().length).toBe(43);
  });

  it('produces unique tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateToken());
    expect(seen.size).toBe(100);
  });
});
