// src/shared/crypto.ts
//
// Generalized HMAC sign/verify helpers shared by features that need to carry a
// tamper-proof payload through an untrusted channel (a cookie, a query string).
// Today: OAuth state/PKCE round-trip + flash-data cookies.
//
// Uses the Web Crypto API (`crypto.subtle`), available on both Cloudflare
// Workers and Node.js >= 20. Format: `base64url(payload).base64url(hmac)`.
// Tampering with either segment fails verification.

/**
 * Base64url-encode a byte buffer without padding (RFC 7636 / RFC 4648 §5).
 */
export function base64url(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (let i = 0; i < view.byteLength; i++) {
        binary += String.fromCharCode(view[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Constant-time string comparison. Defends against timing attacks on signed
 * values. Iterates the full length every time; safe even for unequal-length
 * inputs (returns false without leaking length info).
 */
export function constantTimeEqual(a: string, b: string): boolean {
    const encoder = new TextEncoder();
    const aBytes = encoder.encode(a);
    const bBytes = encoder.encode(b);

    // Match length first; the loop below still runs to keep timing uniform.
    let match = aBytes.byteLength === bBytes.byteLength ? 1 : 0;
    const len = Math.max(aBytes.byteLength, bBytes.byteLength);
    for (let i = 0; i < len; i++) {
        const av = i < aBytes.byteLength ? aBytes[i] : 0;
        const bv = i < bBytes.byteLength ? bBytes[i] : 0;
        match &= av === bv ? 1 : 0;
    }
    return match === 1;
}

/**
 * HMAC-SHA256 sign a message with a secret, returning a base64url signature.
 */
async function hmac(message: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return base64url(new Uint8Array(sig));
}

/**
 * Serialize + sign an arbitrary JSON-serializable payload.
 * Format: `base64url(payload).base64url(hmac)`. Tampering with either segment
 * fails verification.
 */
export async function signValue<T>(payload: T, secret: string): Promise<string> {
    const json = JSON.stringify(payload);
    const encoded = base64url(new TextEncoder().encode(json));
    const sig = await hmac(encoded, secret);
    return `${encoded}.${sig}`;
}

/**
 * Verify the signature and decode the payload. Returns `null` on any failure
 * (bad format, signature mismatch, invalid JSON). The payload is returned
 * untyped — the caller casts to the expected shape (typed `verifyValue<T>`).
 */
export async function verifyValue<T>(token: string, secret: string): Promise<T | null> {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const encoded = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const expected = await hmac(encoded, secret);
    if (!constantTimeEqual(sig, expected)) return null;

    try {
        const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(json) as T;
    } catch {
        return null;
    }
}

/**
 * Generate a high-entropy random token (base64url, no padding). Used for
 * session IDs and OAuth state nonces. `bytes` defaults to 32 (256 bits).
 */
export function generateToken(bytes = 32): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return base64url(buf);
}
