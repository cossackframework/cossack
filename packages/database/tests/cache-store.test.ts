// tests/cache-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '@libsql/client';
import type { Kysely } from 'kysely';
import { createDatabase, DatabaseCacheStore, runWithDb, ensureDbAlsWired } from '../src';

type AnyDb = Kysely<any>;

async function makeDb(): Promise<{ db: AnyDb; dir: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-cache-'));
    const dbPath = path.join(dir, 'test.sqlite');
    const client = createClient({ url: `file:${dbPath}` });
    const db = createDatabase({ dialect: 'libsql', client }) as AnyDb;
    // Create the cache_items table matching the migration template.
    await db.schema
        .createTable('cache_items')
        .addColumn('key', 'text', (c) => c.primaryKey())
        .addColumn('value', 'text', (c) => c.notNull())
        .addColumn('expires_at', 'integer')
        .addColumn('updated_at', 'integer', (c) => c.notNull())
        .execute();
    await db.schema.createIndex('cache_items_expires_at_index').on('cache_items').column('expires_at').execute();
    return { db, dir };
}

describe('DatabaseCacheStore', () => {
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

    // Each test uses an explicit client (mirrors passing one to scripts/tests).
    // The lazy `db()` resolution path is covered in its own block below.
    async function run(fn: () => Promise<void>): Promise<void> {
        await runWithDb(db as any, fn);
    }

    it('stores and reads JSON values', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('a', { n: 1 });
            expect(await store.get<{ n: number }>('a')).toEqual({ n: 1 });
        });
    });

    it('returns undefined for missing keys', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            expect(await store.get('missing')).toBeUndefined();
        });
    });

    it('overwrites existing values', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('a', 'first');
            await store.set('a', 'second');
            expect(await store.get<string>('a')).toBe('second');
        });
    });

    it('has() reports presence', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('a', 1);
            expect(await store.has('a')).toBe(true);
            expect(await store.has('b')).toBe(false);
        });
    });

    it('delete() removes a key', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('a', 1);
            await store.delete('a');
            expect(await store.has('a')).toBe(false);
        });
    });

    it('flush() clears everything', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('a', 1);
            await store.set('b', 2);
            await store.flush();
            expect(await store.has('a')).toBe(false);
            expect(await store.has('b')).toBe(false);
        });
    });

    it('respects a TTL in seconds', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('temp', 'x', 1); // 1s — comfortably above DB latency
            expect(await store.get('temp')).toBe('x');
            await new Promise((r) => setTimeout(r, 1100));
            expect(await store.get('temp')).toBeUndefined();
            expect(await store.has('temp')).toBe(false);
        });
    });

    it('omitting a TTL stores indefinitely', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('forever', 'x');
            await new Promise((r) => setTimeout(r, 10));
            expect(await store.get('forever')).toBe('x');
        });
    });

    it('set(key, undefined) deletes', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('a', 1);
            await store.set('a', undefined);
            expect(await store.has('a')).toBe(false);
        });
    });

    it('survives corrupt stored JSON (deletes it)', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await db.insertInto('cache_items').values({
                key: 'bad',
                value: '{not json',
                expires_at: null,
                updated_at: Date.now(),
            }).execute();
            expect(await store.get('bad')).toBeUndefined();
            const row = await db.selectFrom('cache_items').select('key').where('key', '=', 'bad').executeTakeFirst();
            expect(row).toBeUndefined(); // corrupt row deleted
        });
    });

    it('getMany reads multiple keys', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('a', 1);
            await store.set('b', 2);
            expect(await store.getMany(['a', 'b', 'c'])).toEqual([1, 2, undefined]);
        });
    });

    it('setMany writes multiple entries', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.setMany([
                { key: 'a', value: 1 },
                { key: 'b', value: 2, ttlSeconds: 1 },
            ]);
            expect(await store.get('a')).toBe(1);
            expect(await store.get('b')).toBe(2);
            await new Promise((r) => setTimeout(r, 1100));
            expect(await store.get('b')).toBeUndefined();
        });
    });

    it('deleteMany removes multiple keys', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('a', 1);
            await store.set('b', 2);
            await store.set('c', 3);
            await store.deleteMany(['a', 'b']);
            expect(await store.has('a')).toBe(false);
            expect(await store.has('b')).toBe(false);
            expect(await store.has('c')).toBe(true);
        });
    });

    it('getMany reaps expired rows opportunistically', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('temp', 'x', 1);
            await store.set('live', 'y');
            await new Promise((r) => setTimeout(r, 1100));
            expect(await store.getMany(['temp', 'live'])).toEqual([undefined, 'y']);
            const row = await db.selectFrom('cache_items').select('key').where('key', '=', 'temp').executeTakeFirst();
            expect(row).toBeUndefined(); // expired row reaped
        });
    });

    it('purgeExpired() removes only expired rows', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            await store.set('expire', 'x', 1);
            await store.set('live', 'y');
            await new Promise((r) => setTimeout(r, 1100));
            const deleted = await store.purgeExpired();
            expect(deleted).toBe(1);
            expect(await store.has('live')).toBe(true);
            expect(await store.has('expire')).toBe(false);
        });
    });

    it('round-trips structured values (no mutation)', async () => {
        const store = new DatabaseCacheStore(db as any);
        await run(async () => {
            const obj = { list: [1, 2, { deep: true }] };
            await store.set('obj', obj);
            obj.list.push(99);
            const out = await store.get<{ list: number[] }>('obj');
            expect(out?.list).toEqual([1, 2, { deep: true }]);
        });
    });
});

describe('DatabaseCacheStore — lazy db() resolution', () => {
    let db: AnyDb;
    let dir: string;

    beforeEach(async () => {
        ensureDbAlsWired(); // wire the ALS store getter so `db()` resolves
        const made = await makeDb();
        db = made.db;
        dir = made.dir;
    });
    afterEach(async () => {
        await db.destroy();
        await fs.rm(dir, { recursive: true, force: true });
    });

    it('resolves the per-request client via db() when none is passed', async () => {
        // No explicit client — must resolve db() inside a request scope.
        const store = new DatabaseCacheStore();
        await runWithDb(db as any, async () => {
            await store.set('a', 1);
            expect(await store.get('a')).toBe(1);
        });
    });

    it('one instance serves multiple separate request scopes', async () => {
        // A single store, registered once, must work across requests — the
        // key property that lets it be wired via middleware, not the entrypoint.
        const store = new DatabaseCacheStore();
        await runWithDb(db as any, async () => {
            await store.set('shared', 'from-request-1');
        });
        await runWithDb(db as any, async () => {
            expect(await store.get<string>('shared')).toBe('from-request-1');
        });
    });

    it('throws a clear error when called outside a db scope (no explicit client)', async () => {
        const store = new DatabaseCacheStore();
        await expect(store.get('a')).rejects.toThrow(/No database client in scope/);
    });
});

