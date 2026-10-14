// tests/flash-middleware.test.ts
import 'reflect-metadata';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { flash, flashed, flashedAll, flashInput, old, signValue } from '@cossackframework/core';
import { __resetProcessFlashClaimsForTests, createFlashMiddleware } from '../src/middlewares/flash';
import { isCloudflareRuntime } from '../src/transports/sse';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetProcessFlashClaimsForTests();
});

const SECRET = 'flash-test-secret-16-chars-min';

type FlashCoordinator = {
    getByName(name: string): { claimFlash(nonce: string, expiresAt: number): Promise<boolean> };
};
type TestBindings = { APP_SECRET?: string; COSSACK_SSE?: FlashCoordinator };

/**
 * Build a Hono app with the flash middleware + a couple of test routes that
 * exercise the two-phase cookie lifecycle. Env (with the secret) is passed via
 * app.fetch's second argument so the middleware's `c.env.APP_SECRET` resolves.
 */
function makeApp(name = 'Alice') {
    const app = new Hono<{ Bindings: TestBindings }>();
    app.use('*', createFlashMiddleware());

    // POST handler: accumulates flash data, then redirects.
    app.post('/submit', async (c) => {
        flash('success', 'Saved successfully!');
        flashInput({ name }, { fields: ['name'] });
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
    init: { method?: string; cookie?: string; coordinator?: FlashCoordinator } = {},
) {
    const headers: Record<string, string> = {};
    if (init.cookie) headers['cookie'] = init.cookie;
    const req = new Request(`https://test${path}`, {
        method: init.method ?? 'GET',
        headers,
    });
    return app.fetch(req, { APP_SECRET: SECRET, COSSACK_SSE: init.coordinator });
}

function makeFlashCoordinator() {
    const claimed = new Set<string>();
    const names: string[] = [];
    const errors = new Set<string>();
    const namespace: FlashCoordinator = {
        getByName(name) {
            names.push(name);
            return {
                async claimFlash(nonce, expiresAt) {
                    if (errors.has('all')) throw new Error('coordinator unavailable');
                    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || claimed.has(nonce)) return false;
                    claimed.add(nonce);
                    return true;
                },
            };
        },
    };
    return { namespace, claimed, names, errors };
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
    it.each(['/crpc', '/upload', '/sse/page.example', '/ws/page/example'])('preserves incoming flash on %s, including failed outgoing writes', async path => {
        const app = makeApp();
        app.all(path, c => {
            if (c.req.query('fail')) { flash('success', 'partial'); return c.text('rejected', 400); }
            return c.text('ok');
        });
        const post = await dispatch(app, '/submit', { method: 'POST' });
        const token = `cossack_flash=${getSetCookie(post, 'cossack_flash')}`;
        for (const suffix of ['', '?fail=1']) {
            const response = await dispatch(app, path + suffix, { cookie: token });
            expect(response.status).toBe(suffix ? 400 : 200);
            expect(response.headers.getSetCookie()).toEqual([]);
        }
        const invalid = await dispatch(app, path, { cookie: 'cossack_flash=invalid.token' });
        expect(getSetCookie(invalid, 'cossack_flash')).toBe('');
        const page = await dispatch(app, '/form', { cookie: token });
        expect(await page.json()).toMatchObject({ success: 'Saved successfully!', oldName: 'Alice' });
        expect(getSetCookie(page, 'cossack_flash')).toBe('');
    });

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

    it('atomically consumes copied flash cookies once per process when no durable coordinator exists', async () => {
        const app = makeApp();
        app.all('/crpc', c => c.text('ok'));
        const post = await dispatch(app, '/submit', { method: 'POST' });
        const token = getSetCookie(post, 'cossack_flash')!;
        const copiedCookie = `cossack_flash=${token}`;

        // Background work must leave the token available for the page request.
        const background = await dispatch(app, '/crpc', { cookie: copiedCookie });
        expect(background.status).toBe(200);
        expect(background.headers.getSetCookie()).toEqual([]);

        const [first, replay] = await Promise.all([
            dispatch(app, '/form', { cookie: copiedCookie }),
            dispatch(app, '/form', { cookie: copiedCookie }),
        ]);
        const bodies = await Promise.all([first.json(), replay.json()]) as { success: string | null }[];
        expect(bodies.filter(body => body.success === 'Saved successfully!')).toHaveLength(1);
        expect(bodies.filter(body => body.success === null)).toHaveLength(1);

        const laterReplay = await dispatch(app, '/form', { cookie: copiedCookie });
        expect(await laterReplay.json()).toMatchObject({ success: null, oldName: null });
    });

    it('fails closed at process claim capacity and purges expired claims before accepting new ones', async () => {
        __resetProcessFlashClaimsForTests(1);
        let now = 1_750_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);

        const makeExpiryApp = (maxAge: number, value: string) => {
            const app = new Hono<{ Bindings: { APP_SECRET?: string } }>();
            app.use('*', createFlashMiddleware({ maxAge }));
            app.post('/write', c => { flash('notice', value); return c.redirect('/read'); });
            app.get('/read', c => c.json({ notice: flashed<string>('notice') ?? null }));
            return app;
        };
        const shortApp = makeExpiryApp(1, 'short');
        const longApp = makeExpiryApp(10, 'long');
        const request = (app: typeof shortApp, path: string, cookie?: string, method = 'GET') => app.fetch(
            new Request(`https://test${path}`, {
                method,
                headers: cookie ? { cookie: `cossack_flash=${cookie}` } : undefined,
            }),
            { APP_SECRET: SECRET },
        );

        try {
            const shortWrite = await request(shortApp, '/write', undefined, 'POST');
            const shortToken = getSetCookie(shortWrite, 'cossack_flash')!;
            expect((await (await request(shortApp, '/read', shortToken)).json() as { notice: string }).notice).toBe('short');

            now += 100;
            const longWrite = await request(longApp, '/write', undefined, 'POST');
            const longToken = getSetCookie(longWrite, 'cossack_flash')!;
            const full = await request(longApp, '/read', longToken);
            expect(full.status).toBe(503);
            expect(await full.json()).toMatchObject({ code: 'COSSACK_FLASH_REPLAY_UNAVAILABLE' });
            expect(getSetCookie(full, 'cossack_flash')).toBe('');
            const stillClaimed = await request(shortApp, '/read', shortToken);
            expect(await stillClaimed.json()).toEqual({ notice: null });

            // The first claim is now expired, while the second token is still
            // live. Expiry cleanup must free the slot without evicting a live claim.
            now += 901;
            const accepted = await request(longApp, '/read', longToken);
            expect(accepted.status).toBe(200);
            expect(await accepted.json()).toEqual({ notice: 'long' });
        } finally {
            vi.restoreAllMocks();
            __resetProcessFlashClaimsForTests();
        }
    });

    it('does not consume a Cloudflare flash token on background RPC and atomically rejects replayed page reads', async () => {
        const app = makeApp();
        const coordinator = makeFlashCoordinator();
        const post = await dispatch(app, '/submit', { method: 'POST', coordinator: coordinator.namespace });
        const token = getSetCookie(post, 'cossack_flash');
        expect(token).toBeTruthy();

        const background = await dispatch(app, '/crpc', { cookie: `cossack_flash=${token}`, coordinator: coordinator.namespace });
        expect(background.status).toBe(404); // no route; middleware still preserves the redirect cookie
        expect(coordinator.claimed.size).toBe(0);

        const reads = await Promise.all([
            dispatch(app, '/form', { cookie: `cossack_flash=${token}`, coordinator: coordinator.namespace }),
            dispatch(app, '/form', { cookie: `cossack_flash=${token}`, coordinator: coordinator.namespace }),
        ]);
        const bodies = await Promise.all(reads.map(response => response.json())) as { success: string | null }[];
        expect(bodies.filter(body => body.success === 'Saved successfully!')).toHaveLength(1);
        expect(bodies.filter(body => body.success === null)).toHaveLength(1);
        expect(coordinator.claimed.size).toBe(1);
        expect(coordinator.names).toHaveLength(2);
        expect(coordinator.names.every(name => name.startsWith('cossack.flash.v1:'))).toBe(true);

        const replay = await dispatch(app, '/form', { cookie: `cossack_flash=${token}`, coordinator: coordinator.namespace });
        expect(await replay.json()).toMatchObject({ success: null, oldName: null });
    });

    it('fails closed with a cleared cookie when Cloudflare cannot use the flash coordinator', async () => {
        const app = makeApp();
        const post = await dispatch(app, '/submit', { method: 'POST' });
        const token = getSetCookie(post, 'cossack_flash');
        expect(token).toBeTruthy();
        vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
        expect(isCloudflareRuntime()).toBe(true);
        const response = await dispatch(app, '/form', { cookie: `cossack_flash=${token}` });
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_FLASH_REPLAY_UNAVAILABLE' });
        expect(getSetCookie(response, 'cossack_flash')).toBe('');
    });

    it('fails closed if a Cloudflare flash claim call fails', async () => {
        const app = makeApp();
        const coordinator = makeFlashCoordinator();
        const post = await dispatch(app, '/submit', { method: 'POST', coordinator: coordinator.namespace });
        const token = getSetCookie(post, 'cossack_flash')!;
        coordinator.errors.add('all');
        const response = await dispatch(app, '/form', { cookie: `cossack_flash=${token}`, coordinator: coordinator.namespace });
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_FLASH_REPLAY_UNAVAILABLE' });
        expect(getSetCookie(response, 'cossack_flash')).toBe('');
    });

    it('enforces the signed max-age on the server when a copied cookie is replayed later', async () => {
        let now = 1_750_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        try {
            const app = new Hono<{ Bindings: { APP_SECRET?: string } }>();
            app.use('*', createFlashMiddleware({ maxAge: 1 }));
            app.post('/write', c => { flash('notice', 'short-lived'); return c.redirect('/read'); });
            app.get('/read', c => c.json({ notice: flashed<string>('notice') ?? null }));

            const write = await app.fetch(new Request('https://test/write', { method: 'POST' }), { APP_SECRET: SECRET });
            const token = getSetCookie(write, 'cossack_flash');
            expect(token).toBeTruthy();
            expect(write.headers.getSetCookie().find(value => value.startsWith('cossack_flash='))).toContain('Max-Age=1');

            now += 1_001;
            const expired = await app.fetch(new Request('https://test/read', {
                headers: { cookie: `cossack_flash=${token}` },
            }), { APP_SECRET: SECRET });
            expect(await expired.json()).toEqual({ notice: null });
            expect(getSetCookie(expired, 'cossack_flash')).toBe('');
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('preserves Unicode form input across the signed-cookie redirect', async () => {
        const name = 'Nguyễn — สวัสดี 東京 👋';
        const app = makeApp(name);
        const post = await dispatch(app, '/submit', { method: 'POST' });
        const cookie = getSetCookie(post, 'cossack_flash');
        const get = await dispatch(app, '/form', { cookie: `cossack_flash=${cookie}` });
        expect((await get.json() as { oldName: string }).oldName).toBe(name);
    });

    it('isolates signed flash values when requests overlap in one isolate', async () => {
        const app = new Hono<{ Bindings: { APP_SECRET?: string } }>();
        app.use('*', createFlashMiddleware());
        let arrivals = 0;
        let release!: () => void;
        const bothArrived = new Promise<void>(resolve => { release = resolve; });
        app.post('/parallel/:owner', async c => {
            const owner = c.req.param('owner');
            flash('owner', owner);
            if (++arrivals === 2) release();
            await bothArrived;
            return c.text('written');
        });
        app.get('/read', c => c.json({ owner: flashed<string>('owner') ?? null }));

        const [aliceWrite, bobWrite] = await Promise.all(['alice', 'bob'].map(owner => app.request(
            `/parallel/${owner}`, { method: 'POST' }, { APP_SECRET: SECRET },
        )));
        const aliceToken = getSetCookie(aliceWrite, 'cossack_flash');
        const bobToken = getSetCookie(bobWrite, 'cossack_flash');
        expect(aliceToken).toBeTruthy();
        expect(bobToken).toBeTruthy();
        expect(aliceToken).not.toBe(bobToken);

        const [aliceRead, bobRead] = await Promise.all([
            app.request('/read', { headers: { cookie: `cossack_flash=${aliceToken}` } }, { APP_SECRET: SECRET }),
            app.request('/read', { headers: { cookie: `cossack_flash=${bobToken}` } }, { APP_SECRET: SECRET }),
        ]);
        expect(await aliceRead.json()).toEqual({ owner: 'alice' });
        expect(await bobRead.json()).toEqual({ owner: 'bob' });
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
    it('requires maxAge to be a positive whole number of seconds', () => {
        expect(() => createFlashMiddleware({ maxAge: 0 })).toThrow(RangeError);
        expect(() => createFlashMiddleware({ maxAge: 1.5 })).toThrow(RangeError);
    });

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

    it('rejects older signed flash data that has no server-enforced expiry', async () => {
        const app = makeApp();
        const token = await signValue({ success: 'legacy-without-expiry' }, SECRET);
        const res = await dispatch(app, '/form', { cookie: `cossack_flash=${token}` });
        expect(await res.json()).toMatchObject({ success: null, oldName: null });
        expect(getSetCookie(res, 'cossack_flash')).toBe('');
    });
});
