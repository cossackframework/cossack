import { describe, it, expect } from 'vitest';
import {
    base64url,
    constantTimeEqual,
    generateState,
    signCookieValue,
    verifyCookieValue,
} from '../src/oauth/state';

describe('base64url', () => {
    it('encodes bytes without padding', () => {
        // RFC 7636 example
        const bytes = new TextEncoder().encode('hello');
        expect(base64url(bytes)).toBe('aGVsbG8');
    });

    it('encodes empty buffer to empty string', () => {
        expect(base64url(new Uint8Array(0))).toBe('');
    });

    it('uses URL-safe alphabet (- and _ instead of + and /)', () => {
        // bytes chosen to produce '+' and '/' in standard base64
        const bytes = new Uint8Array([0xff, 0xfb, 0xff, 0xff]);
        const out = base64url(bytes);
        expect(out).not.toMatch(/[+/]/);
        expect(out).toMatch(/[-_]/);
    });
});

describe('constantTimeEqual', () => {
    it('returns true for equal strings', () => {
        expect(constantTimeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings', () => {
        expect(constantTimeEqual('abc', 'abd')).toBe(false);
    });

    it('returns false for different lengths', () => {
        expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    });

    it('returns true for empty strings', () => {
        expect(constantTimeEqual('', '')).toBe(true);
    });
});

describe('generateState', () => {
    it('produces a base64url string', () => {
        const s = generateState();
        expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces unique values', () => {
        const a = generateState();
        const b = generateState();
        expect(a).not.toBe(b);
    });

    it('has at least 128 bits of entropy (~22 base64url chars)', () => {
        expect(generateState().length).toBeGreaterThanOrEqual(22);
    });
});

describe('signCookieValue / verifyCookieValue', () => {
    const secret = 'super-secret-test-key-0123456789';
    const payload = { state: 'abc', codeVerifier: 'xyz' };

    it('round-trips a payload', async () => {
        const token = await signCookieValue(payload, secret);
        const decoded = await verifyCookieValue(token, secret);
        expect(decoded).toEqual(payload);
    });

    it('rejects a tampered payload', async () => {
        const token = await signCookieValue(payload, secret);
        // Flip a character in the encoded payload portion (before the dot).
        const [encoded, sig] = token.split('.');
        const tampered = `${encoded.slice(0, -1)}X.${sig}`;
        const decoded = await verifyCookieValue(tampered, secret);
        expect(decoded).toBeNull();
    });

    it('rejects a tampered signature', async () => {
        const token = await signCookieValue(payload, secret);
        const [encoded, sig] = token.split('.');
        const tampered = `${encoded}.${sig.slice(0, -1)}X`;
        const decoded = await verifyCookieValue(tampered, secret);
        expect(decoded).toBeNull();
    });

    it('rejects the wrong secret', async () => {
        const token = await signCookieValue(payload, secret);
        const decoded = await verifyCookieValue(token, 'wrong-secret-aaaaaaa');
        expect(decoded).toBeNull();
    });

    it('rejects malformed tokens', async () => {
        expect(await verifyCookieValue('not-a-token', secret)).toBeNull();
        expect(await verifyCookieValue('', secret)).toBeNull();
        expect(await verifyCookieValue('only-one-part', secret)).toBeNull();
    });

    it('rejects payloads with wrong shape', async () => {
        // Manually craft a validly-signed token with bad JSON shape.
        const badPayload = { state: 'abc' }; // missing codeVerifier
        const json = JSON.stringify(badPayload);
        const encoded = base64url(new TextEncoder().encode(json));
        // Compute the HMAC by reusing signCookieValue on a known-good payload
        // then swapping the encoded portion — easier: just sign directly.
        const token = await signCookieValue(badPayload as never, secret);
        // Replace its payload portion with our bad one but keep its signature
        // invalid (signing the bad payload properly):
        const [_oldEncoded, sig] = token.split('.');
        const tampered = `${encoded}.${sig}`;
        // Signature won't match -> null.
        expect(await verifyCookieValue(tampered, secret)).toBeNull();
    });
});
