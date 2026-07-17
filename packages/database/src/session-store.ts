// src/session-store.ts
//
// DB-backed key/value session storage. Promotes the inline session CRUD that
// `cossack add auth` generates (see `authModuleTemplate` in the cossack CLI)
// into a reusable, tested class. Reuses the per-request `db()` client from the
// database ALS scope — no separate client, no new binding.
//
// Sessions are addressed by an opaque high-entropy ID (32 random bytes,
// base64url). The ID is carried in a cookie (see `createSessionMiddleware`);
// the store is the source of truth. IDs need no signing — forging is futile
// against 256 bits of entropy.
//
// Anonymous sessions (`user_id` null) work for carts/wizards/A-B without auth;
// authenticated sessions carry the `user_id`. The `data` column holds a JSON
// key/value bag so `set('cart', ...)` / `get('cart')` work like a hash.
//
// Expected schema (shipped via the `cossack add database` migration template):
//   create table sessions (
//     id text primary key not null,
//     user_id text,                  -- nullable for anonymous sessions
//     data text,                     -- JSON key/value bag
//     expires_at text not null
//   );

import type { DbClient } from './types';
import { db } from './store';

/** Sessions-table row shape (snake_case to match the migration). */
export interface SessionRow {
    id: string;
    user_id: string | null;
    data: string | null;
    /** JSON bag for auth-session metadata (user-agent, ip, type discriminator, ...). */
    meta: string | null;
    /** Geo (Cloudflare request.cf country/city) captured at login; null off-CF. */
    location: string | null;
    /** User-Agent header captured at login. */
    user_agent: string | null;
    /** Client IP (cf-connecting-ip) captured at login. */
    ip_address: string | null;
    expires_at: string;
}

// Augment the Database interface so `selectFrom('sessions')` is typed.
declare module './types' {
    interface Database {
        sessions: SessionRow;
    }
}

/** Default session TTL: 30 days, in milliseconds. */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function nowISO(): string {
    return new Date().toISOString();
}

function expiryISO(ttlMs: number): string {
    return new Date(Date.now() + ttlMs).toISOString();
}

function isExpired(expiresAt: string): boolean {
    return new Date(expiresAt).getTime() <= Date.now();
}

/**
 * DB-backed session key/value store. Construct per request (the session
 * middleware does this) with the scoped `db()` client, or pass an explicit
 * client for scripts/tests.
 *
 *   const store = new SessionStore();                 // uses db()
 *   await store.set(sessionId, 'cart', { items: [] });
 *   const cart = await store.get(sessionId, 'cart');
 */
export class SessionStore {
    constructor(private client: DbClient = db()) {}

    /**
     * Read + parse the JSON `data` bag for a session. Returns `{}` if the
     * session is missing, expired, or has no data. Does NOT auto-delete expired
     * rows here (see `purgeExpired`); callers just see an empty bag.
     */
    async load(sessionId: string): Promise<Record<string, unknown>> {
        const row = await this.client
            .selectFrom('sessions')
            .select(['data', 'expires_at'])
            .where('id', '=', sessionId)
            .executeTakeFirst();
        if (!row) return {};
        if (isExpired(row.expires_at as string)) return {};
        if (!row.data) return {};
        try {
            return JSON.parse(row.data as string) as Record<string, unknown>;
        } catch {
            return {};
        }
    }

    /**
     * Set a single key in the session's data bag (merging with existing data).
     * Also refreshes `expires_at` to extend the session on activity (sliding
     * expiration). Creates the row if it doesn't exist.
     */
    async set(
        sessionId: string,
        key: string,
        value: unknown,
        ttlMs: number = DEFAULT_TTL_MS,
    ): Promise<void> {
        const data = await this.load(sessionId);
        data[key] = value;
        await this.client
            .insertInto('sessions')
            .values({
                id: sessionId,
                user_id: null,
                data: JSON.stringify(data),
                expires_at: expiryISO(ttlMs),
            })
            .onConflict((oc) =>
                oc.column('id').doUpdateSet({
                    data: JSON.stringify(data),
                    expires_at: expiryISO(ttlMs),
                }),
            )
            .execute();
    }

    /** Read a single key from the session's data bag. */
    async get<T = unknown>(sessionId: string, key: string): Promise<T | undefined> {
        const data = await this.load(sessionId);
        return data[key] as T | undefined;
    }

    /** Read the entire data bag. */
    async getAll(sessionId: string): Promise<Record<string, unknown>> {
        return this.load(sessionId);
    }

    /** Remove a single key from the data bag. */
    async unset(sessionId: string, key: string): Promise<void> {
        const data = await this.load(sessionId);
        if (!(key in data)) return;
        delete data[key];
        await this.client
            .updateTable('sessions')
            .set({ data: JSON.stringify(data) })
            .where('id', '=', sessionId)
            .execute();
    }

    /** Delete the session row entirely. */
    async destroy(sessionId: string): Promise<void> {
        await this.client.deleteFrom('sessions').where('id', '=', sessionId).execute();
    }

    /** Delete all expired rows. Call opportunistically (e.g. on a sample of requests). */
    async purgeExpired(): Promise<number> {
        const now = nowISO();
        const result = await this.client
            .deleteFrom('sessions')
            .where('expires_at', '<', now)
            .executeTakeFirst();
        // Kysely's DeleteResult exposes numDeletedRows (bigint).
        return Number(result?.numDeletedRows ?? 0);
    }

    /**
     * Create a new session row with a fresh high-entropy ID. Returns the ID.
     * Use when no session ID is present (anonymous first visit).
     */
    async create(ttlMs: number = DEFAULT_TTL_MS): Promise<string> {
        // 32 random bytes → ~43 base64url chars. See crypto.generateToken in
        // @cossackframework/core; we inline here to keep this package
        // dependency-free on core (the database package is standalone, only
        // depending on kysely + hono peer deps).
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const id = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        await this.client
            .insertInto('sessions')
            .values({ id, user_id: null, data: null, expires_at: expiryISO(ttlMs) })
            .execute();
        return id;
    }

    /** Attach a user ID to a session (called on login). */
    async bindUser(sessionId: string, userId: string): Promise<void> {
        await this.client
            .updateTable('sessions')
            .set({ user_id: userId })
            .where('id', '=', sessionId)
            .execute();
    }
}
