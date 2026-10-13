import { getCookie, setCookie, generateCookie } from 'hono/cookie';
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
 * Compare all bytes without an early mismatch exit. JavaScript does not provide
 * a formal constant-time guarantee; the loop length depends on the input lengths.
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

/** Provider-scoped digest for persistent storage; raw nonces stay out of database rows. */
export async function stateKey(provider: string, state: string): Promise<string> {
    const input = new TextEncoder().encode(JSON.stringify(['cossack-oauth-state', provider, state]));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Shape persisted in the signed cookie across the OAuth round-trip. */
export interface OAuthStatePayload {
    state: string;
    codeVerifier: string;
}

export interface VerifiedStateCookie extends OAuthStatePayload { readonly expiresAt: number; }

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
export async function signCookieValue(payload: OAuthStatePayload, secret: string, maxAge = 600, expiresAt = Date.now() + maxAge * 1000): Promise<string> {
    const json = JSON.stringify({ ...payload, expiresAt });
    const encoded = base64url(new TextEncoder().encode(json));
    const sig = await hmac(encoded, secret);
    return `${encoded}.${sig}`;
}

/**
 * Verify the signature and decode the payload. Returns `null` on any failure
 * (bad format, signature mismatch, invalid JSON).
 */
export async function verifyCookieValue(token: string, secret: string): Promise<VerifiedStateCookie | null> {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const encoded = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;

    const expected = await hmac(encoded, secret);
    if (!constantTimeEqual(sig, expected)) return null;

    try {
        const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
        const json = new TextDecoder('utf-8', { fatal: true }).decode(
            Uint8Array.from(binary, char => char.charCodeAt(0)),
        );
        const parsed = JSON.parse(json) as OAuthStatePayload & { expiresAt: number };
        if (typeof parsed.state !== 'string' || typeof parsed.codeVerifier !== 'string') return null;
        if (!Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= Date.now() || parsed.expiresAt > 8_640_000_000_000_000) return null;
        return Object.freeze({ state: parsed.state, codeVerifier: parsed.codeVerifier, expiresAt: parsed.expiresAt });
    } catch {
        return null;
    }
}

const STATELESS_PURPOSE = 'cossack-oauth-stateless-state';

/**
 * Stateless-mode `state`: `base64url(payload).base64url(hmac)`, where the
 * payload binds a random nonce, the provider id and an absolute expiry. The
 * MAC input is purpose-prefixed so a signed state cookie is never accepted.
 */
export async function signStatelessState(provider: string, secret: string, expiresAt: number): Promise<string> {
    const json = JSON.stringify({ n: generateState(), p: provider, e: expiresAt });
    const encoded = base64url(new TextEncoder().encode(json));
    return `${encoded}.${await hmac(`${STATELESS_PURPOSE}.${encoded}`, secret)}`;
}

/** Verify signature (without an early mismatch exit), provider and expiry. Returns the expiry or `null`. */
export async function verifyStatelessState(token: string, provider: string, secret: string): Promise<number | null> {
    if (typeof token !== 'string' || token.length > 1024) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const encoded = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
    const expected = await hmac(`${STATELESS_PURPOSE}.${encoded}`, secret);
    if (!constantTimeEqual(sig, expected)) return null;
    try {
        const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
        const json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
        const parsed = JSON.parse(json) as { n?: unknown; p?: unknown; e?: unknown };
        if (typeof parsed.n !== 'string' || parsed.p !== provider) return null;
        if (!Number.isSafeInteger(parsed.e) || (parsed.e as number) <= Date.now()) return null;
        return parsed.e as number;
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
    expiresAt?: number,
): Promise<void> {
    const value = await signCookieValue(payload, secret, options.maxAge ?? DEFAULT_MAX_AGE, expiresAt);
    if (expiresAt !== undefined && expiresAt <= Date.now()) throw new Error('OAuth state expired before cookie creation.');
    const name = options.name ?? DEFAULT_COOKIE_NAME;
    setCookie(c, name, value, {
        httpOnly: true,
        secure: options.secure ?? requestSecure,
        sameSite: options.sameSite ?? 'Lax',
        path: options.path ?? '/',
        maxAge: expiresAt === undefined ? options.maxAge ?? DEFAULT_MAX_AGE : Math.ceil((expiresAt - Date.now()) / 1000),
        domain: options.domain,
    });
}

/**
 * Read, verify, and **consume** the state cookie. The cookie is always cleared
 * on read. Expiry is also checked in the signed payload.
 */
export async function consumeStateCookie(
    c: Context,
    secret: string,
    options: StateCookieOptions,
): Promise<VerifiedStateCookie | null> {
    try {
        const token = getCookie(c, options.name ?? DEFAULT_COOKIE_NAME);
        if (!token) return null;
        return await verifyCookieValue(token, secret);
    } finally { clearStateCookie(c, options); }
}

/** Clear the matching browser cookie even when the callback cannot read state. */
export function clearStateCookie(c: Context, options: StateCookieOptions): void {
    c.header('Set-Cookie', clearedStateCookie(c, options), { append: true });
}

function clearedStateCookie(c: Context, options: StateCookieOptions): string {
    const name = options.name ?? DEFAULT_COOKIE_NAME;
    // Always delete, even on failure, to finish the browser round-trip. Pass the same domain
    // (if any) used at set time so the deletion actually matches the cookie.
    const secure = options.secure ?? (new URL(c.req.raw.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https');
    return generateCookie(name, '', { path: options.path ?? '/', domain: options.domain,
        secure, httpOnly: true, sameSite: options.sameSite ?? 'Lax', maxAge: 0 });
}

/** Raw/immutable application Responses do not inherit Hono's prepared cookies. */
export function withClearedStateCookie(response: Response, c: Context, options: StateCookieOptions): Response {
    const value = clearedStateCookie(c, options);
    if (response.headers.getSetCookie().includes(value)) return response;
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
