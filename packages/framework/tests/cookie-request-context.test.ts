// tests/cookie-request-context.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { cookie, getRequestContext, __resetRequestContextForTests } from '@cossackframework/core';
import { createRequestContextMiddleware } from '../src/middlewares/request-context';
import { runWithContext, ensureRequestContextAlsWired } from '../src/request-context-als';

/**
 * Tests for `cookie()` + the request-context ALS. Exercises:
 *   - `getRequestContext()` is undefined outside a scope
 *   - `cookie()` throws outside a scope
 *   - via the real middleware: get/set/delete round-trip on the response
 *   - `cookie()` works inside a downstream middleware
 */
function makeApp() {
    const app = new Hono();
    app.use('*', createRequestContextMiddleware());

    // A downstream middleware that reads a cookie (proves the Context is in
    // scope for middlewares registered after the request-context one).
    app.use('*', async (c, next) => {
        // cookie() must resolve to this request's Context here.
        c.header('X-Seen-Theme', cookie().get('theme') ?? 'none');
        await next();
    });

    app.get('/cookie/get', async (c) => {
        const theme = cookie().get('theme') ?? 'default';
        return c.json({ theme });
    });

    app.post('/cookie/set', async (c) => {
        cookie().set('theme', 'dark', { maxAge: 3600, httpOnly: true, path: '/' });
        return c.json({ ok: true });
    });

    app.post('/cookie/delete', async (c) => {
        cookie().delete('theme');
        return c.json({ ok: true });
    });

    return app;
}

describe('request-context + cookie() — scope errors', () => {
    beforeEach(() => __resetRequestContextForTests());

    it('getRequestContext() returns undefined outside a scope', () => {
        expect(getRequestContext()).toBeUndefined();
    });

    it('cookie() throws a clear [Cossack] error outside a scope', () => {
        expect(() => cookie()).toThrow(/\[Cossack\] No request context in scope/);
    });

    it('cookie() resolves inside a runWithContext scope', async () => {
        // The beforeEach reset the getter; re-wire it for this test.
        ensureRequestContextAlsWired();
        // Build a realistic enough Context for hono/cookie: getCookie reads
        // `c.req.raw.headers`. A real Request gives us that.
        const fakeReq = new Request('https://test/');
        const fakeC = {
            req: { raw: fakeReq, header: (n: string) => fakeReq.headers.get(n), url: 'https://test/' },
            header: () => {},
            res: { headers: new Headers() },
        } as any;
        let captured: string | undefined;
        await runWithContext(fakeC, async () => {
            // get on a context with no cookies → undefined (no throw).
            captured = cookie().get('anything');
        });
        expect(captured).toBeUndefined();
    });
});

describe('request-context middleware — cookie() end-to-end', () => {
    const app = makeApp();

    it('cookie().get reads the request cookie', async () => {
        const res = await app.request('/cookie/get', {
            headers: { cookie: 'theme=ocean' },
        });
        const body = (await res.json()) as any;
        expect(body.theme).toBe('ocean');
        // The downstream middleware also saw it via cookie().
        expect(res.headers.get('X-Seen-Theme')).toBe('ocean');
    });

    it('cookie().get defaults when no cookie is present', async () => {
        const res = await app.request('/cookie/get');
        const body = (await res.json()) as any;
        expect(body.theme).toBe('default');
        expect(res.headers.get('X-Seen-Theme')).toBe('none');
    });

    it('cookie().set writes a Set-Cookie header on the response', async () => {
        const res = await app.request('/cookie/set', { method: 'POST' });
        const setCookies = res.headers.getSetCookie?.() ?? [];
        expect(setCookies.some((s) => s.startsWith('theme=dark'))).toBe(true);
    });

    it('cookie().delete expires the cookie', async () => {
        const res = await app.request('/cookie/delete', { method: 'POST' });
        const setCookies = res.headers.getSetCookie?.() ?? [];
        expect(
            setCookies.some((s) => s.startsWith('theme=') && /Max-Age=0|max-age=0/i.test(s)),
        ).toBe(true);
    });
});
