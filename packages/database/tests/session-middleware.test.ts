// tests/session-middleware.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import type { Kysely } from 'kysely';
import {
    createDatabase,
    createDbMiddleware,
    createSessionMiddleware,
    session,
    SessionStore,
} from '@cossackframework/database';

type AnyDb = Kysely<any>;

async function makeDb(): Promise<{ db: AnyDb; dir: string; client: any }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-session-mw-'));
    const dbPath = path.join(dir, 'test.sqlite');
    const client = createClient({ url: `file:${dbPath}` });
    const db = createDatabase({ dialect: 'libsql', client }) as AnyDb;
    await db.schema
        .createTable('sessions')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('user_id', 'text')
        .addColumn('data', 'text')
        .addColumn('expires_at', 'text', (c) => c.notNull())
        .execute();
    return { db, dir, client };
}

/** Extract the Set-Cookie value for a given name from a Response. */
function getSetCookie(res: Response, name: string): string | undefined {
    const all = res.headers.getSetCookie?.() ?? [];
    for (const c of all) {
        if (c.startsWith(`${name}=`)) return c.split(';')[0].slice(name.length + 1);
    }
    return undefined;
}

describe('session middleware + session() helper', () => {
    let db: AnyDb;
    let dir: string;
    let app: Hono;

    beforeEach(async () => {
        const made = await makeDb();
        db = made.db;
        dir = made.dir;

        app = new Hono();
        // dbMiddleware scopes the Kysely client; session middleware uses db() inside.
        app.use('*', createDbMiddleware({ client: db }));
        app.use('*', createSessionMiddleware({ ttl: 60_000 }));

        app.get('/session/cart', async (c) => {
            const cart = await session().get('cart');
            const sid = session().id();
            return c.json({ cart: cart ?? null, sid });
        });
        app.post('/session/cart', async (c) => {
            await session().set('cart', { items: ['a', 'b'] });
            const sid = session().id();
            return c.json({ ok: true, sid });
        });
    });

    afterEach(async () => {
        await db.destroy();
        await fs.rm(dir, { recursive: true, force: true });
    });

    it('issues a cossack_sid cookie on first visit (anonymous session)', async () => {
        const res = await app.request('/session/cart');
        expect(res.status).toBe(200);
        const sidCookie = getSetCookie(res, 'cossack_sid');
        expect(sidCookie).toBeDefined();
        expect(sidCookie!.length).toBeGreaterThan(10);
    });

    it('persists session data across requests via the cookie', async () => {
        // 1. POST sets cart on session X.
        const postRes = await app.request('/session/cart', { method: 'POST' });
        const postBody = (await postRes.json()) as any;
        const sid = postBody.sid;
        expect(sid).toBeDefined();

        // 2. GET with the cookie reads the cart back (same session).
        const getRes = await app.request('/session/cart', {
            headers: { cookie: `cossack_sid=${sid}` },
        });
        const getBody = (await getRes.json()) as any;
        expect(getBody.cart).toEqual({ items: ['a', 'b'] });
        expect(getBody.sid).toBe(sid);
    });

    it('a fresh visit without the cookie gets a new session (empty cart)', async () => {
        const res = await app.request('/session/cart');
        const body = (await res.json()) as any;
        expect(body.cart).toBeNull();
    });

    it('session() throws outside the session middleware scope', async () => {
        // A bare Hono app WITHOUT the session middleware: session() should throw.
        const bare = new Hono();
        bare.get('/x', async (c) => {
            try {
                session().id();
                return c.text('no-throw');
            } catch (e: any) {
                return c.text(e.message, 500);
            }
        });
        const res = await bare.request('/x');
        expect(res.status).toBe(500);
        expect((await res.text()).slice(0, 9)).toBe('[Cossack]');
    });

    it('respects an authCookieReader to reuse an existing session ID', async () => {
        // Pre-seed a session row with data, then route the request at it via
        // authCookieReader (simulating an authenticated request).
        const store = new SessionStore(db);
        const authId = await store.create();
        await store.set(authId, 'cart', { items: ['from-auth'] });

        const app2 = new Hono();
        app2.use('*', createDbMiddleware({ client: db }));
        app2.use(
            '*',
            createSessionMiddleware({
                ttl: 60_000,
                authCookieReader: (c) => c.req.header('x-auth-sid') ?? undefined,
            }),
        );
        app2.get('/cart', async (c) => {
            return c.json({ cart: await session().get('cart'), sid: session().id() });
        });

        const res = await app2.request('/cart', { headers: { 'x-auth-sid': authId } });
        const body = (await res.json()) as any;
        expect(body.sid).toBe(authId);
        expect(body.cart).toEqual({ items: ['from-auth'] });
        // No anonymous cookie issued when auth provided the ID.
        expect(getSetCookie(res, 'cossack_sid')).toBeUndefined();
    });

    it('issues the anonymous cookie when authCookieReader is set but returns undefined', async () => {
        // Regression: the guard `!options.authCookieReader` used to suppress the
        // anonymous cookie even when auth returned undefined (unauthenticated),
        // orphaning the new session. Now the cookie is set so the session
        // survives the next request.
        const app2 = new Hono();
        app2.use('*', createDbMiddleware({ client: db }));
        app2.use(
            '*',
            createSessionMiddleware({
                ttl: 60_000,
                // Auth reader that always says "no authenticated session".
                authCookieReader: () => undefined,
            }),
        );
        app2.get('/cart', async (c) => {
            return c.json({ sid: session().id() });
        });

        const res = await app2.request('/cart');
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        // A new anonymous session was created and ITS cookie was issued.
        const sidCookie = getSetCookie(res, 'cossack_sid');
        expect(sidCookie).toBeDefined();
        expect(sidCookie).toBe(body.sid);

        // And it persists: a follow-up request with the cookie reuses the ID.
        const res2 = await app2.request('/cart', {
            headers: { cookie: `cossack_sid=${sidCookie}` },
        });
        const body2 = (await res2.json()) as any;
        expect(body2.sid).toBe(sidCookie);
        // No new cookie issued on the follow-up (session already existed).
        expect(getSetCookie(res2, 'cossack_sid')).toBeUndefined();
    });
});
