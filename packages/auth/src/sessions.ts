import type { Context } from 'hono';
import { generateCookie } from 'hono/cookie';
import { AuthError, authOperation, type AuthErrorCode } from './errors';

/** Portable auth-session data. Times are Unix milliseconds; reset tokens are a separate purpose. */
export interface AuthSessionRecord {
    readonly id: string;
    readonly userId: string;
    readonly kind: 'auth';
    readonly createdAt: number;
    readonly expiresAt: number;
}

export interface AuthSessionStore {
    /** Insert a new record; never overwrite a colliding id. */
    create(record: AuthSessionRecord, context: Context): Promise<void>;
    read(id: string, context: Context): Promise<AuthSessionRecord | null>;
    /** Atomically replace the still-active expected record. Exactly one concurrent replacement can win. */
    replace(expected: AuthSessionRecord, replacement: AuthSessionRecord, now: number, context: Context): Promise<boolean>;
    revoke(id: string, context: Context): Promise<void>;
}

export interface AuthSessionOptions {
    store: AuthSessionStore;
    /** Absolute lifetime in seconds. No implicit refresh on validation. Default: 7 days. */
    ttlSeconds?: number;
    cookie?: { name?: string; path?: string; domain?: string; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None' };
    /** Unix milliseconds. Useful for deterministic expiry tests; defaults to Date.now. */
    now?: () => number;
}

export interface IssuedAuthSession {
    readonly session: AuthSessionRecord;
    /** Apply only after storage succeeds. Never copy these headers into public page state. */
    readonly headers: Headers;
}

export interface AuthSessionManager {
    readonly cookieName: string;
    create(userId: string, context: Context): Promise<IssuedAuthSession>;
    validate(id: string, context: Context): Promise<AuthSessionRecord | null>;
    rotate(id: string, context: Context): Promise<IssuedAuthSession | null>;
    revoke(id: string, context: Context): Promise<Headers>;
    expiredCookie(): Headers;
}

const maxTime = 8_640_000_000_000_000;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(value);

/** Persistent session lifecycle. The application supplies atomic storage; this kit owns expiry and cookie policy. */
export function createSessionManager(options: AuthSessionOptions): AuthSessionManager {
    const ttl = options.ttlSeconds ?? 7 * 24 * 60 * 60;
    const cookie = { name: 'session_id', path: '/', secure: true, sameSite: 'Lax' as const, ...options.cookie };
    if (!options.store || ![options.store.create, options.store.read, options.store.replace, options.store.revoke].every(value => typeof value === 'function') ||
        (options.now !== undefined && typeof options.now !== 'function') ||
        !Number.isSafeInteger(ttl) || ttl < 1 || ttl > 400 * 24 * 60 * 60 ||
        typeof cookie.name !== 'string' || !/^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/.test(cookie.name) ||
        typeof cookie.path !== 'string' || !cookie.path.startsWith('/') || /[;\x00-\x20\x7f]/.test(cookie.path) ||
        (cookie.domain !== undefined && (typeof cookie.domain !== 'string' || !/^\.?[a-zA-Z0-9.-]+$/.test(cookie.domain))) ||
        typeof cookie.secure !== 'boolean' || !['Lax', 'Strict', 'None'].includes(cookie.sameSite) ||
        (cookie.sameSite === 'None' && !cookie.secure)) throw new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID');

    const clock = () => {
        let now: number;
        try { now = (options.now ?? Date.now)(); }
        catch { throw new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID'); }
        if (!Number.isSafeInteger(now) || now < 0 || now > maxTime - ttl * 1000) throw new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID');
        return now;
    };
    const headers = (id: string, maxAge: number) => {
        const result = new Headers();
        try { result.append('Set-Cookie', generateCookie(cookie.name, id, { ...cookie, httpOnly: true, maxAge })); }
        catch { throw new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID'); }
        return result;
    };
    headers('', 0); // Validate cookie prefix constraints before storage effects.
    const record = (userId: string, now: number, failure: AuthErrorCode): AuthSessionRecord => {
        if (typeof userId !== 'string' || !userId.trim()) throw new AuthError('COSSACK_AUTH_CONFIGURATION_INVALID');
        let id: string;
        try { id = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''); }
        catch { throw new AuthError(failure); }
        return Object.freeze({ id, userId, kind: 'auth', createdAt: now, expiresAt: now + ttl * 1000 });
    };
    const valid = (value: AuthSessionRecord | null, id: string, now: number): AuthSessionRecord | null => {
        if (!value || value.id !== id || value.kind !== 'auth' || typeof value.userId !== 'string' || !value.userId.trim() ||
            !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt) ||
            value.createdAt < 0 || value.createdAt > now || value.expiresAt <= now || value.expiresAt > maxTime ||
            value.expiresAt <= value.createdAt) return null;
        return Object.freeze({ id, userId: value.userId, kind: 'auth', createdAt: value.createdAt, expiresAt: value.expiresAt });
    };

    return Object.freeze({
        cookieName: cookie.name,
        async create(userId: string, context: Context) {
            const session = record(userId, clock(), 'COSSACK_AUTH_SESSION_CREATE_FAILED');
            await authOperation('COSSACK_AUTH_SESSION_CREATE_FAILED', () => options.store.create(session, context));
            const remaining = Math.ceil((session.expiresAt - clock()) / 1000);
            if (remaining <= 0) throw new AuthError('COSSACK_AUTH_SESSION_CREATE_FAILED');
            return { session, headers: headers(session.id, remaining) };
        },
        async validate(id: string, context: Context) {
            if (!identifier(id)) return null;
            const stored = await authOperation('COSSACK_AUTH_SESSION_READ_FAILED', () => options.store.read(id, context));
            return valid(stored, id, clock());
        },
        async rotate(id: string, context: Context) {
            if (!identifier(id)) return null;
            const stored = await authOperation('COSSACK_AUTH_SESSION_READ_FAILED', () => options.store.read(id, context));
            const now = clock();
            const current = valid(stored, id, now);
            if (!current) return null;
            const replacement = record(current.userId, now, 'COSSACK_AUTH_SESSION_ROTATE_FAILED');
            const replaced = await authOperation('COSSACK_AUTH_SESSION_ROTATE_FAILED', () => options.store.replace(current, replacement, now, context));
            if (replaced !== true) return null;
            const remaining = Math.ceil((replacement.expiresAt - clock()) / 1000);
            if (remaining <= 0) throw new AuthError('COSSACK_AUTH_SESSION_ROTATE_FAILED');
            return { session: replacement, headers: headers(replacement.id, remaining) };
        },
        async revoke(id: string, context: Context) {
            if (identifier(id)) await authOperation('COSSACK_AUTH_SESSION_REVOKE_FAILED', () => options.store.revoke(id, context));
            return headers('', 0);
        },
        expiredCookie: () => headers('', 0),
    });
}
