import { base64url } from './state';

export interface PkcePair {
    /** Sent to the provider on the authorize request. */
    codeChallenge: string;
    /** Sent on the token-exchange request; kept private. */
    codeVerifier: string;
}

/**
 * Generate a PKCE (RFC 7636) S256 pair.
 *
 * `verifier`: 32 random bytes -> base64url (~43 chars).
 * `challenge`: base64url(SHA-256(verifier)).
 *
 * Uses the Web Crypto API, available on Cloudflare Workers and Node.js >= 20.
 */
export async function createPkcePair(): Promise<PkcePair> {
    const verifierBytes = new Uint8Array(32);
    crypto.getRandomValues(verifierBytes);
    const codeVerifier = base64url(verifierBytes);

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const codeChallenge = base64url(new Uint8Array(digest));

    return { codeChallenge, codeVerifier };
}
