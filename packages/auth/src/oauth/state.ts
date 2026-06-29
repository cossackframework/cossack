import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';

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
 * Constant-time string comparison. Defends against timing attacks on the OAuth
 * `state` parameter. Iterates the full length every time; safe even for
 * unequal-length inputs (returns false without leaking length info).
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
 * Generate a high-entropy state nonce (>= 128 bits) for CSRF protection.
 */
export function generateState(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
}

/** Shape persisted in the signed cookie across the OAuth round-trip. */
export interface OAuthStatePayload {
    state: string;
    codeVerifier: string;
}

/**
 * HMAC-SHA256 sign a message with a secret, returning a base64url signature.
 * Uses the Web Crypto API (`crypto.subtle`), available on both Cloudflare
 * Workers and Node.js >= 20.
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
 * Serialize + sign a payload. Format: `base64url(payload).base64url(hmac)`.
 * Tampering with either segment fails verification.
 */
export async function signCookieValue(payload: OAuthStatePayload, secret: string): Promise<string> {
    const json = JSON.stringify(payload);
    const encoded = base64url(new TextEncoder().encode(json));
    const sig = await hmac(encoded, secret);
    return `${encoded}.${sig}`;
}

/**
 * Verify the signature and decode the payload. Returns `null` on any failure
 * (bad format, signature mismatch, invalid JSON).
 */
export async function verifyCookieValue(token: string, secret: string): Promise<OAuthStatePayload | null> {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const encoded = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const expected = await hmac(encoded, secret);
    if (!constantTimeEqual(sig, expected)) return null;

    try {
        const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
        const parsed = JSON.parse(json) as OAuthStatePayload;
        if (typeof parsed.state !== 'string' || typeof parsed.codeVerifier !== 'string') return null;
        return parsed;
    } catch {
        return null;
    }
}

export interface StateCookieOptions {
    name?: string;
    maxAge?: number;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    path?: string;
    domain?: string;
}

const DEFAULT_COOKIE_NAME = 'cossack_oauth_state';
const DEFAULT_MAX_AGE = 600; // 10 minutes

/**
 * Write the signed state+PKCE cookie on the redirect response.
 */
export async function setStateCookie(
    c: Context,
    payload: OAuthStatePayload,
    secret: string,
    options: StateCookieOptions,
    requestSecure: boolean,
): Promise<void> {
    const value = await signCookieValue(payload, secret);
    const name = options.name ?? DEFAULT_COOKIE_NAME;
    setCookie(c, name, value, {
        httpOnly: true,
        secure: options.secure ?? requestSecure,
        sameSite: options.sameSite ?? 'Lax',
        path: options.path ?? '/',
        maxAge: options.maxAge ?? DEFAULT_MAX_AGE,
        domain: options.domain,
    });
}

/**
 * Read, verify, and **consume** the state cookie. The cookie is always cleared
 * on read to enforce single-use semantics.
 */
export async function consumeStateCookie(
    c: Context,
    secret: string,
    options: StateCookieOptions,
): Promise<OAuthStatePayload | null> {
    const name = options.name ?? DEFAULT_COOKIE_NAME;
    const token = getCookie(c, name);
    // Always delete, even on failure, to prevent replay. Pass the same domain
    // (if any) used at set time so the deletion actually matches the cookie.
    deleteCookie(c, name, { path: options.path ?? '/', domain: options.domain });
    if (!token) return null;
    return verifyCookieValue(token, secret);
}
