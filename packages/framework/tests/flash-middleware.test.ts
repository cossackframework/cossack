// tests/flash-middleware.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { flash, flashed, flashedAll, flashInput, old } from '@cossackframework/core';
import { createFlashMiddleware } from '../src/middlewares/flash';

const SECRET = 'flash-test-secret-16-chars-min';

/**
 * Build a Hono app with the flash middleware + a couple of test routes that
 * exercise the two-phase cookie lifecycle. Env (with the secret) is passed via
 * app.fetch's second argument so the middleware's `c.env.APP_SECRET` resolves.
 */
function makeApp() {
    const app = new Hono<{ Bindings: { APP_SECRET?: string } }>();
    app.use('*', createFlashMiddleware());

    // POST handler: accumulates flash data, then redirects.
    app.post('/submit', async (c) => {
        flash('success', 'Saved successfully!');
        flashInput({ name: 'Alice' });
        return c.redirect('/form');
    });

    // GET handler: reads flash data and renders it as JSON. Coerce undefined →
    // null so the keys are always present in the response (JSON.stringify omits
    // undefined values, which would make test assertions ambiguous).
    app.get('/form', async (c) => {
        return c.json({
            success: flashed<string>('success') ?? null,
            oldName: old<string>('name') ?? null,
            allFlashed: Object.keys(flashedAll()),
        });
    });

    // POST handler that redirects to the Referer (regression for the `back()`
    // returning `{}` bug — back() must return a Response, not void).
    app.post('/back', async (c) => {
        flash('success', 'from-back');
        return c.redirect(c.req.header('referer') || '/');
    });

    return app;
}

/** Dispatch a request, optionally with a Cookie header and the secret env. */
async function dispatch(
    app: ReturnType<typeof makeApp>,
    path: string,
    init: { method?: string; cookie?: string } = {},
) {
    const headers: Record<string, string> = {};
    if (init.cookie) headers['cookie'] = init.cookie;
    const req = new Request(`https://test${path}`, {
        method: init.method ?? 'GET',
        headers,
    });
    return app.fetch(req, { APP_SECRET: SECRET });
}

/** Extract the Set-Cookie value for a given name from a Response. */
function getSetCookie(res: Response, name: string): string | undefined {
    const all = res.headers.getSetCookie?.() ?? [];
    for (const c of all) {
        if (c.startsWith(`${name}=`)) {
            return c.split(';')[0].slice(name.length + 1);
        }
    }
    return undefined;
}

describe('flash middleware — two-phase cookie lifecycle', () => {
    it('POST accumulates flash and sets a signed cookie on the redirect response', async () => {
        const app = makeApp();
        const res = await dispatch(app, '/submit', { method: 'POST' });

        expect(res.status).toBe(302);
        const cookie = getSetCookie(res, 'cossack_flash');
        expect(cookie).toBeDefined();
        // The cookie value is signed: base64url(payload).base64url(sig)
        expect(cookie!.split('.')).toHaveLength(2);
    });

    it('GET without a flash cookie reads nothing', async () => {
        const app = makeApp();
        const res = await dispatch(app, '/form');
        const body = (await res.json()) as any;
        expect(body).toEqual({ success: null, oldName: null, allFlashed: [] });
    });

    it('back() returns a redirect Response to the Referer (not {})', async () => {
        // Regression: back() used to return void, so the API handler serialized
        // public state as `{}` instead of redirecting. Now it returns a Response.
        const app = makeApp();
        const req = new Request('https://test/back', {
            method: 'POST',
            headers: { referer: 'https://test/form' },
        });
        const res = await app.fetch(req, { APP_SECRET: SECRET });
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('https://test/form');
        // Flash cookie was set (the whole point of the redirect-with-flash flow).
        const cookie = getSetCookie(res, 'cossack_flash');
        expect(cookie).toBeDefined();
    });

    it('the signed cookie round-trips: POST sets it, GET reads it, GET-again is empty', async () => {
        const app = makeApp();

        // 1. POST → sets the flash cookie.
        const postRes = await dispatch(app, '/submit', { method: 'POST' });
        const cookie = getSetCookie(postRes, 'cossack_flash');
        expect(cookie).toBeDefined();

        // 2. GET with the cookie → flash data is available.
        const getRes = await dispatch(app, '/form', { cookie: `cossack_flash=${cookie}` });
        const body = (await getRes.json()) as any;
        expect(body.success).toBe('Saved successfully!');
        expect(body.oldName).toBe('Alice');
        expect(body.allFlashed).toEqual(['success']); // __input excluded

        // The GET response deletes the flash cookie (single-use).
        const deleteCookieHeader = getSetCookie(getRes, 'cossack_flash');
        expect(deleteCookieHeader).toMatch(/^(|Max-Age=0)/);

        // 3. A follow-up GET without the cookie → nothing (already consumed).
        const getRes2 = await dispatch(app, '/form');
        const body2 = (await getRes2.json()) as any;
        expect(body2).toEqual({ success: null, oldName: null, allFlashed: [] });
    });

    it('does not set a flash cookie when the handler flashes nothing', async () => {
        const app = new Hono<{ Bindings: { APP_SECRET?: string } }>();
        app.use('*', createFlashMiddleware());
        app.get('/noop', async (c) => c.text('ok'));

        const res = await app.fetch(new Request('https://test/noop'), { APP_SECRET: SECRET });
        expect(res.headers.getSetCookie?.() ?? []).toEqual([]);
    });
});

describe('flash middleware — secret enforcement', () => {
    it('throws only when flash is written and no secret is configured', async () => {
        const app = new Hono<{ Bindings: {} }>();
        app.use('*', createFlashMiddleware());
        app.post('/submit', async (c) => {
            flash('success', 'x');
            return c.redirect('/form');
        });
        app.get('/form', async (c) => c.text('ok'));

        // GET without secret + no cookie → works fine (flash not exercised).
        const getRes = await app.fetch(new Request('https://test/form'), {});
        expect(getRes.status).toBe(200);

        // POST without secret + outgoing flash → middleware throws (Hono
        // surfaces unhandled errors as 500).
        const postRes = await app.fetch(new Request('https://test/submit', { method: 'POST' }), {});
        expect(postRes.status).toBe(500);
    });

    it('drops an unverifiable incoming cookie silently (no crash)', async () => {
        // Cookie signed with a different secret → verification fails → treated as empty.
        const app = makeApp();
        const res = await dispatch(app, '/form', {
            cookie: 'cossack_flash=invalid.token',
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.success).toBeNull();
    });
});
