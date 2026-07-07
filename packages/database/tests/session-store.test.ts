// tests/session-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '@libsql/client';
import type { Kysely } from 'kysely';
import { createDatabase, SessionStore, runWithDb } from '../src';

type AnyDb = Kysely<any>;

async function makeDb(): Promise<{ db: AnyDb; dir: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-session-'));
    const dbPath = path.join(dir, 'test.sqlite');
    const client = createClient({ url: `file:${dbPath}` });
    const db = createDatabase({ dialect: 'libsql', client }) as AnyDb;
    // Create the sessions table matching the migration template (with the new
    // `data` column and nullable `user_id`).
    await db.schema
        .createTable('sessions')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('user_id', 'text')
        .addColumn('data', 'text')
        .addColumn('expires_at', 'text', (c) => c.notNull())
        .execute();
    return { db, dir };
}

describe('SessionStore', () => {
    let db: AnyDb;
    let dir: string;

    beforeEach(async () => {
        const made = await makeDb();
        db = made.db;
        dir = made.dir;
    });
    afterEach(async () => {
        await db.destroy();
        await fs.rm(dir, { recursive: true, force: true });
    });

    // SessionStore uses the global `db()` helper by default, so wrap each test
    // in a db scope that resolves to our test client (mirrors middleware).
    function run(store: SessionStore, fn: () => Promise<void>) {
        return runWithDb(db as any, fn);
    }

    it('create() issues a unique session row', async () => {
        const store = new SessionStore(db as any);
        const id = await store.create();
        expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url

        const row = await db.selectFrom('sessions').selectAll().executeTakeFirst();
        expect(row?.id).toBe(id);
        expect(row?.user_id).toBeNull();
        expect(row?.data).toBeNull();
        expect(row?.expires_at).toBeTruthy();
    });

    it('create() returns distinct IDs', async () => {
        const store = new SessionStore(db as any);
        const ids = new Set<string>();
        for (let i = 0; i < 10; i++) ids.add(await store.create());
        expect(ids.size).toBe(10);
    });

    it('set() merges into the data bag and refreshes expiry', async () => {
        const store = new SessionStore(db as any);
        const id = await store.create();
        await store.set(id, 'theme', 'dark');
        await store.set(id, 'cart', { items: [1, 2] });

        const data = await store.getAll(id);
        expect(data).toEqual({ theme: 'dark', cart: { items: [1, 2] } });
    });

    it('set() on a fresh ID creates the row', async () => {
        const store = new SessionStore(db as any);
        // Use a fabricated ID — set() should upsert the row.
        await store.set('custom-id', 'x', 1);
        expect(await store.get('custom-id', 'x')).toBe(1);
    });

    it('get() returns undefined for missing keys', async () => {
        const store = new SessionStore(db as any);
        const id = await store.create();
        expect(await store.get(id, 'missing')).toBeUndefined();
    });

    it('getTyped preserves the stored type', async () => {
        const store = new SessionStore(db as any);
        const id = await store.create();
        await store.set(id, 'count', 42);
        const count = await store.get<number>(id, 'count');
        expect(count).toBe(42);
        expect(typeof count).toBe('number');
    });

    it('unset() removes a key', async () => {
        const store = new SessionStore(db as any);
        const id = await store.create();
        await store.set(id, 'a', 1);
        await store.set(id, 'b', 2);
        await store.unset(id, 'a');
        expect(await store.get(id, 'a')).toBeUndefined();
        expect(await store.get(id, 'b')).toBe(2);
    });

    it('destroy() deletes the row', async () => {
        const store = new SessionStore(db as any);
        const id = await store.create();
        await store.set(id, 'x', 1);
        await store.destroy(id);
        expect(await store.getAll(id)).toEqual({});
    });

    it('load() returns {} for an expired session', async () => {
        const store = new SessionStore(db as any);
        const id = await store.create(0); // immediate expiry
        // Wait a tick so Date.now() advances past the expiry.
        await new Promise((r) => setTimeout(r, 5));
        expect(await store.getAll(id)).toEqual({});
    });

    it('purgeExpired() removes expired rows only', async () => {
        const store = new SessionStore(db as any);
        const expiredId = await store.create(0);
        await new Promise((r) => setTimeout(r, 5));
        const liveId = await store.create(); // default 30-day TTL

        const deleted = await store.purgeExpired();
        expect(deleted).toBeGreaterThanOrEqual(1);

        // Expired row is gone; live row remains.
        expect(await store.getAll(expiredId)).toEqual({});
        expect(await store.getAll(liveId)).toEqual({});
        // But the live row still exists in the table:
        const row = await db.selectFrom('sessions').select('id').where('id', '=', liveId).executeTakeFirst();
        expect(row?.id).toBe(liveId);
    });

    it('bindUser() attaches a user ID to a session', async () => {
        const store = new SessionStore(db as any);
        const id = await store.create();
        await store.bindUser(id, 'user-123');
        const row = await db.selectFrom('sessions').select('user_id').where('id', '=', id).executeTakeFirst();
        expect(row?.user_id).toBe('user-123');
    });
});
