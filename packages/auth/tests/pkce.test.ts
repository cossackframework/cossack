import { describe, it, expect } from 'vitest';
import { createPkcePair } from '../src/oauth/pkce';
import { base64url } from '../src/oauth/state';

describe('createPkcePair', () => {
    it('produces a base64url verifier of ~43 chars (32 bytes)', async () => {
        const { codeVerifier } = await createPkcePair();
        expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
        expect(codeVerifier.length).toBeLessThanOrEqual(128);
    });

    it('produces a base64url challenge (no padding)', async () => {
        const { codeChallenge } = await createPkcePair();
        expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(codeChallenge).not.toContain('=');
    });

    it('satisfies the RFC 7636 S256 reference vector', async () => {
        // RFC 7636 Section B (workaround for the spec's example values):
        // verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        // challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        const challenge = base64url(new Uint8Array(digest));
        expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('produces a challenge that matches SHA-256(verifier)', async () => {
        const { codeVerifier, codeChallenge } = await createPkcePair();
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
        const expected = base64url(new Uint8Array(digest));
        expect(codeChallenge).toBe(expected);
    });

    it('produces unique pairs', async () => {
        const a = await createPkcePair();
        const b = await createPkcePair();
        expect(a.codeVerifier).not.toBe(b.codeVerifier);
        expect(a.codeChallenge).not.toBe(b.codeChallenge);
    });
});
