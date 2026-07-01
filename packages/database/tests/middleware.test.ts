// tests/middleware.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDbMiddleware, db, getDb, runWithDb, ensureDbAlsWired } from '../src';

/** A fake Kysely-shaped object (we only need it as an identity token here). */
function fakeClient() {
    return { __brand: 'db' } as any;
}

function fakeContext() {
    const store: Record<string, unknown> = {};
    return {
        set: (k: string, v: unknown) => {
            store[k] = v;
        },
        get: (k: string) => store[k],
    };
}

describe('request scoping', () => {
    beforeEach(() => {
        ensureDbAlsWired();
    });

    it('db() throws outside a request scope', () => {
        expect(() => db()).toThrow(/No database client in scope/);
    });

    it('runWithDb makes db() resolve to the scoped client', async () => {
        const client = fakeClient();
        const inside = await runWithDb(client, () => db());
        expect(inside).toBe(client);
    });

    it('db() is isolated per concurrent scope', async () => {
        const a = fakeClient();
        const b = fakeClient();
        const observed: any[] = [];
        await Promise.all([
            runWithDb(a, async () => {
                await Promise.resolve();
                observed.push(db());
            }),
            runWithDb(b, async () => {
                await Promise.resolve();
                observed.push(db());
            }),
        ]);
        expect(observed.sort((x, y) => (x === a ? -1 : 1))).toEqual(expect.arrayContaining([a, b]));
    });

    it('createDbMiddleware sets c.db and wraps the request in the scope', async () => {
        const client = fakeClient();
        const middleware = createDbMiddleware({ client });
        const c: any = fakeContext();
        let seenByNext: any = null;

        await middleware(c, async () => {
            // Inside next(): global db() and getDb(c) both resolve to client.
            seenByNext = db();
        });

        expect(seenByNext).toBe(client);
        expect(getDb(c)).toBe(client);
    });

    it('createDbMiddleware accepts a per-request client factory', async () => {
        const middleware = createDbMiddleware({
            client: (c: any) => ({ __from: c.env } as any),
        });
        const c: any = { ...fakeContext(), env: { DB: 'binding' } };
        await middleware(c, async () => {});
        expect((getDb(c) as any).__from.DB).toBe('binding');
    });

    it('getDb throws when no client is set on the context', () => {
        const c: any = fakeContext();
        expect(() => getDb(c)).toThrow(/No database client on the request context/);
    });
});
