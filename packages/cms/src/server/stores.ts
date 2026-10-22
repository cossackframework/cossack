/**
 * FastDB implementations of the auth and framework stores, on relational host tables.
 * Each operation is one atomic request; conditional operations check the affected count.
 * The interfaces are structural copies, so this package does not depend on the framework.
 */
import { createSqlJobStore, type JobStore } from '@cossackframework/core/jobs';
import { createSqlNotificationStore, type NotificationStore } from '@cossackframework/core/notifications';
import { sqlDatabase, type FastDB, type Value } from '@cossackframework/fastdb';

const TOKEN = /^[A-Za-z0-9_-]{1,191}$/;
const n = (value: Value | undefined) => Number(value as bigint);

export interface AuthSessionRecord { readonly id: string; readonly userId: string; readonly kind: 'auth'; readonly createdAt: number; readonly expiresAt: number }
/** Structural `AuthSessionStore` from `@cossackframework/auth`. */
export interface CmsAuthSessionStore {
    create(record: AuthSessionRecord, context?: unknown): Promise<void>;
    read(id: string, context?: unknown): Promise<AuthSessionRecord | null>;
    replace(expected: AuthSessionRecord, replacement: AuthSessionRecord, now: number, context?: unknown): Promise<boolean>;
    revoke(id: string, context?: unknown): Promise<void>;
}

export interface OAuthStateRecord { readonly key: string; readonly provider: string; readonly createdAt: number; readonly expiresAt: number }
/** Structural `OAuthStateStore` from `@cossackframework/auth`. */
export interface CmsOAuthStateStore {
    create(record: OAuthStateRecord, context?: unknown): Promise<void>;
    consume(key: string, provider: string, now: number, context?: unknown): Promise<boolean>;
}

/** Structural `SessionStore` from `@cossackframework/framework/session`. */
export interface CmsSessionStore {
    create(ttlMs?: number): Promise<string>;
    has(sessionId: string): Promise<boolean>;
    load(sessionId: string): Promise<Record<string, unknown>>;
    get<T = unknown>(sessionId: string, key: string): Promise<T | undefined>;
    getAll(sessionId: string): Promise<Record<string, unknown>>;
    set(sessionId: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
    unset(sessionId: string, key: string): Promise<void>;
    destroy(sessionId: string): Promise<void>;
    bindUser(sessionId: string, userId: string): Promise<void>;
    purgeExpired(): Promise<number>;
}

/**
 * Auth sessions keyed by token. Rotation is one conditional update of the key; the public
 * reference survives it, so realtime descriptors detect rotation through the fingerprint.
 */
export function createAuthSessionStore(db: FastDB, options: { now?: () => number; request?: (context: unknown) => { ip?: string; userAgent?: string } } = {}): CmsAuthSessionStore & {
    publicReference(id: string): Promise<string | null>;
    findByReference(reference: string): Promise<{ id: string; userId: string; expiresAt: number } | null>;
    listForUser(userId: string, now: number): Promise<{ reference: string; createdAt: number; expiresAt: number; ip: string | null; userAgent: string | null }[]>;
    /** The newest sessions across users, for the dashboard's sign-in activity. Sessions end at sign-out, so this shows who is signed in. */
    listRecent(now: number, limit?: number): Promise<{ reference: string; userId: string; createdAt: number; ip: string | null; userAgent: string | null }[]>;
    revokeAllForUser(userId: string, except?: string): Promise<number>;
    /** Revoke one of the user's sessions by its public reference, never the `current` token. */
    revokeByReference(userId: string, reference: string, current?: string): Promise<boolean>;
} {
    const now = options.now ?? Date.now;
    return {
        async create(record, context) {
            assertRecord(record);
            const meta = options.request?.(context) ?? {};
            await db.write([{
                sql: 'INSERT INTO cms_auth_sessions (id, public_id, user_id, created_at, expires_at, ip, user_agent) VALUES ($id, $public, $user, $created, $expires, $ip, $agent)',
                params: { $id: record.id, $public: crypto.randomUUID(), $user: record.userId, $created: record.createdAt, $expires: record.expiresAt, $ip: meta.ip?.slice(0, 64) ?? null, $agent: meta.userAgent?.slice(0, 512) ?? null },
            }, {
                // The user keeps the sign-in time after the session ends.
                sql: 'UPDATE cms_users SET last_sign_in_at = $created WHERE id = $user',
                params: { $user: record.userId, $created: record.createdAt },
            }], { kind: 'cms.auth.session', retryConflicts: 5 });
        },
        async read(id) {
            if (!TOKEN.test(id)) return null;
            const result = await db.read([{ sql: 'SELECT id, user_id, created_at, expires_at FROM cms_auth_sessions WHERE id = $id', params: { $id: id } }]);
            const row = result.results[0]!.rows[0];
            return row ? Object.freeze({ id: row[0] as string, userId: row[1] as string, kind: 'auth' as const, createdAt: n(row[2]), expiresAt: n(row[3]) }) : null;
        },
        async replace(expected, replacement, at) {
            assertRecord(expected);
            assertRecord(replacement);
            if (replacement.userId !== expected.userId) return false;
            const result = await db.write([{
                sql: `UPDATE cms_auth_sessions SET id = $next, created_at = $created, expires_at = $expires
                    WHERE id = $id AND user_id = $user AND created_at = $oldCreated AND expires_at = $oldExpires AND expires_at > $now`,
                params: { $next: replacement.id, $created: replacement.createdAt, $expires: replacement.expiresAt, $id: expected.id, $user: expected.userId,
                    $oldCreated: expected.createdAt, $oldExpires: expected.expiresAt, $now: Math.max(at, now()) },
            }], { kind: 'cms.auth.session', retryConflicts: 5 });
            return result.results[0]!.affected === 1n;
        },
        async revoke(id) {
            if (!TOKEN.test(id)) return;
            await db.write([{ sql: 'DELETE FROM cms_auth_sessions WHERE id = $id', params: { $id: id } }], { kind: 'cms.auth.session', retryConflicts: 5 });
        },
        async publicReference(id) {
            if (!TOKEN.test(id)) return null;
            const result = await db.read([{ sql: 'SELECT public_id FROM cms_auth_sessions WHERE id = $id', params: { $id: id } }]);
            return (result.results[0]!.rows[0]?.[0] as string | undefined) ?? null;
        },
        async findByReference(reference) {
            if (!/^[0-9a-f-]{36}$/.test(reference)) return null;
            const result = await db.read([{ sql: 'SELECT id, user_id, expires_at FROM cms_auth_sessions WHERE public_id = $ref', params: { $ref: reference } }]);
            const row = result.results[0]!.rows[0];
            return row ? { id: row[0] as string, userId: row[1] as string, expiresAt: n(row[2]) } : null;
        },
        async listForUser(userId, at) {
            const result = await db.read([{
                sql: 'SELECT public_id, created_at, expires_at, ip, user_agent FROM cms_auth_sessions WHERE user_id = $user AND expires_at > $now ORDER BY created_at DESC LIMIT 100',
                params: { $user: userId, $now: at },
            }]);
            return result.results[0]!.rows.map(row => ({ reference: row[0] as string, createdAt: n(row[1]), expiresAt: n(row[2]), ip: row[3] as string | null, userAgent: row[4] as string | null }));
        },
        async listRecent(at, limit = 10) {
            const result = await db.read([{
                sql: 'SELECT public_id, user_id, created_at, ip, user_agent FROM cms_auth_sessions WHERE expires_at > $now ORDER BY created_at DESC LIMIT $limit',
                params: { $now: at, $limit: Math.min(Math.max(limit, 1), 100) },
            }]);
            return result.results[0]!.rows.map(row => ({ reference: row[0] as string, userId: row[1] as string, createdAt: n(row[2]), ip: row[3] as string | null, userAgent: row[4] as string | null }));
        },
        async revokeByReference(userId, reference, current) {
            if (!/^[0-9a-f-]{36}$/.test(reference)) return false;
            const result = await db.write([{
                sql: `DELETE FROM cms_auth_sessions WHERE public_id = $ref AND user_id = $user${current ? ' AND id != $current' : ''}`,
                params: { $ref: reference, $user: userId, ...(current ? { $current: current } : {}) },
            }], { kind: 'cms.auth.session', retryConflicts: 5 });
            return result.results[0]!.affected === 1n;
        },
        async revokeAllForUser(userId, except) {
            const result = await db.write([{
                sql: `DELETE FROM cms_auth_sessions WHERE user_id = $user${except ? ' AND id != $except' : ''}`,
                params: { $user: userId, ...(except ? { $except: except } : {}) },
            }], { kind: 'cms.auth.session', retryConflicts: 5 });
            return Number(result.results[0]!.affected);
        },
    };
}

/** OAuth state consumed by one conditional delete: exactly one callback can win. */
export function createOAuthStateStore(db: FastDB): CmsOAuthStateStore & { purgeExpired(now: number): Promise<number> } {
    return {
        async create(record) {
            if (!/^[a-f0-9]{64}$/.test(record.key) || !/^[a-z0-9_-]{1,64}$/.test(record.provider)) throw new TypeError('Invalid OAuth state record.');
            await db.write([{ sql: 'INSERT INTO cms_oauth_states (key, provider, created_at, expires_at) VALUES ($key, $provider, $created, $expires)',
                params: { $key: record.key, $provider: record.provider, $created: record.createdAt, $expires: record.expiresAt } }], { kind: 'cms.auth.oauth', retryConflicts: 5 });
        },
        async consume(key, provider, now) {
            if (!/^[a-f0-9]{64}$/.test(key)) return false;
            const result = await db.write([{ sql: 'DELETE FROM cms_oauth_states WHERE key = $key AND provider = $provider AND expires_at > $now',
                params: { $key: key, $provider: provider, $now: Math.max(now, Date.now()) } }], { kind: 'cms.auth.oauth', retryConflicts: 5 });
            return result.results[0]!.affected === 1n;
        },
        async purgeExpired(now) {
            const expired = await db.read([{ sql: 'SELECT 1 FROM cms_oauth_states WHERE expires_at <= $now LIMIT 1', params: { $now: now } }]);
            if (!expired.results[0]!.rows.length) return 0;
            const result = await db.write([{ sql: 'DELETE FROM cms_oauth_states WHERE key IN (SELECT key FROM cms_oauth_states WHERE expires_at <= $now LIMIT 1000)', params: { $now: now } }], { kind: 'cms.auth.oauth', retryConflicts: 5 });
            return Number(result.results[0]!.affected);
        },
    };
}

/**
 * The framework session bag. Each key is its own row, so a write to one key never
 * replaces a concurrent write to another; writes slide the expiry.
 */
export function createSessionStore(db: FastDB, options: { ttlMs?: number; now?: () => number } = {}): CmsSessionStore {
    const now = options.now ?? Date.now;
    const defaultTtl = options.ttlMs ?? 30 * 24 * 60 * 60 * 1000;
    const live = 'EXISTS (SELECT 1 FROM cms_sessions WHERE id = $id AND expires_at > $now)';
    const read = async (sessionId: string): Promise<Record<string, unknown>> => {
        if (!TOKEN.test(sessionId)) return {};
        const result = await db.read([{ sql: `SELECT key, value FROM cms_session_values WHERE session_id = $id AND ${live} ORDER BY key LIMIT 1000`, params: { $id: sessionId, $now: now() } }]);
        return Object.fromEntries(result.results[0]!.rows.map(([key, value]) => [key as string, JSON.parse(value as string)]));
    };
    return {
        async create(ttlMs = defaultTtl) {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            const id = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
            const at = now();
            await db.write([{ sql: 'INSERT INTO cms_sessions (id, user_id, created_at, expires_at) VALUES ($id, NULL, $at, $expires)', params: { $id: id, $at: at, $expires: at + ttlMs } }], { kind: 'cms.session', retryConflicts: 5 });
            return id;
        },
        async has(sessionId) {
            if (!TOKEN.test(sessionId)) return false;
            const result = await db.read([{ sql: 'SELECT 1 FROM cms_sessions WHERE id = $id AND expires_at > $now', params: { $id: sessionId, $now: now() } }]);
            return result.results[0]!.rows.length === 1;
        },
        load: read,
        getAll: read,
        async get<T>(sessionId: string, key: string) {
            if (!TOKEN.test(sessionId)) return undefined;
            const result = await db.read([{ sql: `SELECT value FROM cms_session_values WHERE session_id = $id AND key = $key AND ${live}`, params: { $id: sessionId, $key: key, $now: now() } }]);
            const value = result.results[0]!.rows[0]?.[0];
            return value === undefined ? undefined : JSON.parse(value as string) as T;
        },
        async set(sessionId, key, value, ttlMs = defaultTtl) {
            if (!TOKEN.test(sessionId)) throw new TypeError('Invalid session ID.');
            const encoded = JSON.stringify(value);
            if (encoded === undefined) throw new TypeError('Session values must be JSON.');
            const at = now();
            await db.write([
                { sql: `INSERT INTO cms_session_values (session_id, key, value) SELECT $id, $key, $value WHERE ${live}
                    ON CONFLICT (session_id, key) DO UPDATE SET value = excluded.value`, params: { $id: sessionId, $key: key, $value: encoded, $now: at } },
                { sql: 'UPDATE cms_sessions SET expires_at = $expires WHERE id = $id AND expires_at > $now', params: { $id: sessionId, $expires: at + ttlMs, $now: at } },
            ], { kind: 'cms.session', retryConflicts: 5 });
        },
        async unset(sessionId, key) {
            if (!TOKEN.test(sessionId)) return;
            await db.write([{ sql: 'DELETE FROM cms_session_values WHERE session_id = $id AND key = $key', params: { $id: sessionId, $key: key } }], { kind: 'cms.session', retryConflicts: 5 });
        },
        async destroy(sessionId) {
            if (!TOKEN.test(sessionId)) return;
            await db.write([
                { sql: 'DELETE FROM cms_session_values WHERE session_id = $id', params: { $id: sessionId } },
                { sql: 'DELETE FROM cms_sessions WHERE id = $id', params: { $id: sessionId } },
            ], { kind: 'cms.session', retryConflicts: 5 });
        },
        async bindUser(sessionId, userId) {
            if (!TOKEN.test(sessionId)) return;
            await db.write([{ sql: 'UPDATE cms_sessions SET user_id = $user WHERE id = $id', params: { $id: sessionId, $user: userId } }], { kind: 'cms.session', retryConflicts: 5 });
        },
        async purgeExpired() {
            const at = now();
            const expired = await db.read([{ sql: 'SELECT 1 FROM cms_sessions WHERE expires_at <= $now LIMIT 1', params: { $now: at } }]);
            if (!expired.results[0]!.rows.length) return 0;
            const result = await db.write([
                { sql: 'DELETE FROM cms_session_values WHERE session_id IN (SELECT id FROM cms_sessions WHERE expires_at <= $now LIMIT 500)', params: { $now: at } },
                { sql: 'DELETE FROM cms_sessions WHERE id IN (SELECT id FROM cms_sessions WHERE expires_at <= $now LIMIT 500)', params: { $now: at } },
            ], { kind: 'cms.session', retryConflicts: 5 });
            return Number(result.results[1]!.affected);
        },
    };
}

/** Job ledger with the same lease and fencing semantics as the D1 store. */
export function createJobStore(db: FastDB): JobStore {
    return createSqlJobStore(sqlDatabase(db, { kind: 'cms.jobs' }));
}

/** Notification ledger with the same fencing semantics as the D1 store. */
export function createNotificationStore(db: FastDB): NotificationStore {
    return createSqlNotificationStore(sqlDatabase(db, { kind: 'cms.notifications' }));
}

function assertRecord(record: AuthSessionRecord): void {
    if (!TOKEN.test(record.id) || typeof record.userId !== 'string' || !record.userId || !Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.expiresAt)) {
        throw new TypeError('Invalid auth session record.');
    }
}
