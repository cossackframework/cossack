import { describe, it, expect, vi } from 'vitest';
import { Context, Hono } from 'hono';
import { createAuth } from '../src/session';

interface User {
    id: string;
    email: string;
    name: string;
}

function buildApp(kit: ReturnType<typeof createAuth<User>>, loginHandler?: any) {
    const app = new Hono<{ Variables: { user?: User } }>();
    app.use('*', kit.middleware);
    if (loginHandler) {
        app.post('/api/login', loginHandler);
    }
    app.get('/me', (c) => c.json({ user: c.get('user') ?? null }));
    return app;
}

describe('createAuth — middleware', () => {
    it.each(['extractSessionId', 'validateSessionId', 'resolveUserById'] as const)('redacts %s failures and continues as guest', async stage => {
        const privateValue = 'PRIVATE_SESSION_PASSWORD_TOKEN';
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const fail = vi.fn(async () => { throw new Error(privateValue); });
            const kit = createAuth<User>({
                extractSessionId: () => privateValue,
                validateSessionId: async () => 'fixture-user',
                resolveUserById: async () => ({ id: 'fixture-user', email: 'fixture@example.invalid', name: 'Fixture' }),
                [stage]: fail,
            });
            const response = await buildApp(kit).request('/me');
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ user: null });
            expect(fail).toHaveBeenCalledOnce();
            expect(warning).toHaveBeenCalledOnce();
            expect(warning.mock.calls[0]).toHaveLength(1);
            expect(JSON.stringify(warning.mock.calls)).not.toContain(privateValue);
            expect(warning.mock.calls[0][0]).toMatch(/COSSACK_AUTH_.*_FAILED: continuing as guest/);
        } finally { warning.mockRestore(); }
    });
    it('passes through when no session id is present', async () => {
        let extracted = false;
        const kit = createAuth<User>({
            extractSessionId: () => {
                extracted = true;
                return undefined;
            },
            validateSessionId: async () => null,
            resolveUserById: async () => null,
        });
        const app = buildApp(kit);
        const res = await app.request('/me');
        expect(res.status).toBe(200);
        expect(extracted).toBe(true);
        expect(((await res.json()) as { user: unknown }).user).toBeNull();
    });

    it('populates c.get("user") when session is valid', async () => {
        const user: User = { id: 'u1', email: 'a@b.io', name: 'Tan' };
        const kit = createAuth<User>({
            extractSessionId: () => 'valid-session-token',
            validateSessionId: async (sid) => (sid === 'valid-session-token' ? 'u1' : null),
            resolveUserById: async (uid) => (uid === 'u1' ? user : null),
        });
        const app = buildApp(kit);
        const res = await app.request('/me');
        expect(res.status).toBe(200);
        expect(((await res.json()) as { user: User }).user).toEqual(user);
    });

    it('passes through when session id is invalid', async () => {
        const kit = createAuth<User>({
            extractSessionId: () => 'bad-token',
            validateSessionId: async () => null,
            resolveUserById: async () => null,
        });
        const app = buildApp(kit);
        const res = await app.request('/me');
        expect(res.status).toBe(200);
        expect(((await res.json()) as { user: unknown }).user).toBeNull();
    });

    it('passes through when session is valid but user cannot be resolved', async () => {
        const kit = createAuth<User>({
            extractSessionId: () => 'token',
            validateSessionId: async () => 'deleted-user',
            resolveUserById: async () => null,
        });
        const app = buildApp(kit);
        const res = await app.request('/me');
        expect(res.status).toBe(200);
        expect(((await res.json()) as { user: unknown }).user).toBeNull();
    });

    it('degrades to guest when validateSessionId throws (e.g. sessions table missing)', async () => {
        // Regression: a stale session cookie when the DB/schema is unavailable
        // must not 500 every route — the request should render as a guest.
        const kit = createAuth<User>({
            extractSessionId: () => 'stale-cookie',
            validateSessionId: async () => {
                throw new Error('no such table: sessions');
            },
            resolveUserById: async () => null,
        });
        const app = buildApp(kit);
        const res = await app.request('/me');
        expect(res.status).toBe(200);
        expect(((await res.json()) as { user: unknown }).user).toBeNull();
    });

    it('degrades to guest when resolveUserById throws', async () => {
        const kit = createAuth<User>({
            extractSessionId: () => 'token',
            validateSessionId: async () => 'u1',
            resolveUserById: async () => {
                throw new Error('connection refused');
            },
        });
        const app = buildApp(kit);
        const res = await app.request('/me');
        expect(res.status).toBe(200);
        expect(((await res.json()) as { user: unknown }).user).toBeNull();
    });
});

describe('createAuth — realtime identity', () => {
    const user = { id: 'u1', email: 'a@b.io', name: 'Fresh account' };
    const descriptor = { version: 1, provider: 'fixture.session', data: { reference: 'public-reference' } };
    const makeProvider = () => ({
        extractSessionId: vi.fn(() => 'PRIVATE_BEARER'),
        validateSessionId: vi.fn(async () => 'u1'),
        resolveUserById: vi.fn(async () => user),
        realtime: { key: 'fixture.session', capture: vi.fn(async () => descriptor.data), validate: vi.fn(async () => 'u1' as string | null) },
    });

    it('captures only after successful authentication and keeps the hook server-only', async () => {
        const provider = makeProvider(); const c = new Context(new Request('http://localhost/'));
        await createAuth(provider).middleware(c, async () => {});
        expect(provider.realtime.capture).not.toHaveBeenCalled();
        expect(await c.get('cossack.captureRealtimeIdentity')()).toEqual(descriptor);
        expect(provider.realtime.capture).toHaveBeenCalledWith('PRIVATE_BEARER', 'u1', c);
        expect(JSON.stringify(await c.get('cossack.captureRealtimeIdentity')())).not.toContain('PRIVATE_BEARER');
        provider.validateSessionId.mockResolvedValue(null as never);
        await createAuth(provider).middleware(c, async () => {});
        expect(c.get('user')).toBeUndefined();
        expect(c.get('cossack.captureRealtimeIdentity')).toBeUndefined();
    });

    it('checks current storage and resolves fresh user data without extracting a bearer again', async () => {
        const provider = makeProvider(); const c = new Context(new Request('http://localhost/', { headers: { cookie: 'PRIVATE_BEARER' } }));
        c.set('user', { ...user, name: 'Stale account' }); c.set('cossack.realtimeIdentity', descriptor);
        await createAuth(provider).middleware(c, async () => {});
        expect(provider.realtime.validate).toHaveBeenCalledWith(descriptor.data, c);
        expect(provider.extractSessionId).not.toHaveBeenCalled(); expect(provider.validateSessionId).not.toHaveBeenCalled();
        expect(c.get('user')).toEqual(user); expect(c.get('cossack.captureRealtimeIdentity')).toBeUndefined();
        provider.realtime.validate.mockResolvedValue(null);
        await createAuth(provider).middleware(c, async () => {});
        expect(c.get('user')).toBeUndefined(); expect(provider.resolveUserById).toHaveBeenCalledOnce();
    });

    it.each([null, {}, [], { ...descriptor, version: 2 }, { ...descriptor, provider: 'different.provider' },
        { version: 1, provider: descriptor.provider }])('rejects a malformed or foreign descriptor without falling back to the cookie: %j', async restored => {
        const provider = makeProvider(); const c = new Context(new Request('http://localhost/'));
        c.set('user', user); c.set('cossack.realtimeIdentity', restored);
        const next = vi.fn(async () => {});
        await createAuth(provider).middleware(c, next);
        expect(c.get('user')).toBeUndefined(); expect(next).toHaveBeenCalledOnce();
        expect(provider.realtime.validate).not.toHaveBeenCalled(); expect(provider.extractSessionId).not.toHaveBeenCalled();
    });

    it.each(['validate', 'resolve'] as const)('redacts a realtime %s failure and discards the old user', async stage => {
        const provider = makeProvider(); const c = new Context(new Request('http://localhost/'));
        c.set('user', user); c.set('cossack.realtimeIdentity', descriptor);
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            (stage === 'validate' ? provider.realtime.validate : provider.resolveUserById).mockRejectedValue(new Error('PRIVATE_STORAGE_CREDENTIAL'));
            await createAuth(provider).middleware(c, async () => {});
            expect(c.get('user')).toBeUndefined(); expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_STORAGE_CREDENTIAL');
            expect(warning).toHaveBeenCalledWith(expect.stringContaining('COSSACK_AUTH_REALTIME_VALIDATION_FAILED'));
        } finally { warning.mockRestore(); }
    });

    it('propagates downstream failures once, including a mismatched provider', async () => {
        for (const restored of [descriptor, { ...descriptor, provider: 'other.session' }]) {
            const c = new Context(new Request('http://localhost/')); c.set('cossack.realtimeIdentity', restored);
            const error = new Error('handler failure'); const next = vi.fn(async () => { throw error; });
            await expect(createAuth(makeProvider()).middleware(c, next)).rejects.toBe(error);
            expect(next).toHaveBeenCalledOnce();
        }
    });

    it('requires a stable bounded provider key', () => {
        for (const key of ['', 'Uppercase', 'x'.repeat(65), 'with spaces', null, undefined, 123]) {
            const provider = makeProvider(); provider.realtime.key = key as string;
            expect(() => createAuth(provider)).toThrow('stable provider key');
        }
    });
});

describe('createAuth — createLoginHandler', () => {
    it('logs in with valid credentials and merges session headers', async () => {
        const user: User = { id: 'u1', email: 'a@b.io', name: 'Tan' };
        const kit = createAuth<User>({
            extractSessionId: () => undefined,
            validateSessionId: async () => null,
            resolveUserById: async () => null,
        });
        const loginHandler = kit.createLoginHandler({
            validateCredentials: async (creds) =>
                creds.email === 'a@b.io' && creds.password === 'pw' ? user : null,
            createSession: async () => {
                const headers = new Headers();
                headers.append('Set-Cookie', 'session=abc; Path=/; HttpOnly');
                return { headers };
            },
        });
        const app = buildApp(kit, loginHandler);

        const res = await app.request('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'a@b.io', password: 'pw' }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { success?: boolean };
        expect(body).toEqual({ success: true });
        expect(res.headers.get('set-cookie')).toBe('session=abc; Path=/; HttpOnly');
    });

    it('returns 401 for invalid credentials', async () => {
        const kit = createAuth<User>({
            extractSessionId: () => undefined,
            validateSessionId: async () => null,
            resolveUserById: async () => null,
        });
        const loginHandler = kit.createLoginHandler({
            validateCredentials: async () => null,
            createSession: async () => ({ headers: new Headers() }),
        });
        const app = buildApp(kit, loginHandler);
        const res = await app.request('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'x', password: 'y' }),
        });
        expect(res.status).toBe(401);
        expect(((await res.json()) as { error: string }).error).toBe('Invalid credentials');
    });
});

describe('createAuth — createLoginHandler request guards', () => {
    const user: User = { id: 'u1', email: 'a@b.io', name: 'Tan' };
    const body = JSON.stringify({ email: 'a@b.io', password: 'pw' });

    function setup() {
        const validateCredentials = vi.fn(async () => user);
        const createSession = vi.fn(async () => {
            const headers = new Headers();
            headers.append('Set-Cookie', 'session=abc; Path=/; HttpOnly');
            return { headers };
        });
        const kit = createAuth<User>({
            extractSessionId: () => undefined,
            validateSessionId: async () => null,
            resolveUserById: async () => null,
        });
        const app = buildApp(kit, kit.createLoginHandler({ validateCredentials, createSession }));
        const post = (headers: Record<string, string>, payload: string = body) =>
            app.request('http://localhost/api/login', { method: 'POST', headers, body: payload });
        return { post, validateCredentials, createSession };
    }

    it.each([
        ['text/plain (cross-site form)', { 'Content-Type': 'text/plain' }],
        ['urlencoded form', { 'Content-Type': 'application/x-www-form-urlencoded' }],
        ['multipart form', { 'Content-Type': 'multipart/form-data; boundary=x' }],
        ['missing content type', {}],
        ['json lookalike', { 'Content-Type': 'application/jsonp' }],
    ])('rejects %s with 415 before reading credentials', async (_label, headers) => {
        const { post, validateCredentials, createSession } = setup();
        const res = await post(headers as Record<string, string>);
        expect(res.status).toBe(415);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(validateCredentials).not.toHaveBeenCalled();
        expect(createSession).not.toHaveBeenCalled();
    });

    it('accepts application/json with parameters', async () => {
        const { post } = setup();
        const res = await post({ 'Content-Type': 'Application/JSON; charset=utf-8' });
        expect(res.status).toBe(200);
    });

    it.each(['cross-site'])('rejects Sec-Fetch-Site: %s with 403', async site => {
        const { post, validateCredentials } = setup();
        const res = await post({ 'Content-Type': 'application/json', 'Sec-Fetch-Site': site });
        expect(res.status).toBe(403);
        expect(validateCredentials).not.toHaveBeenCalled();
    });

    it.each(['same-origin', 'none'])('allows Sec-Fetch-Site: %s', async site => {
        const { post } = setup();
        const res = await post({ 'Content-Type': 'application/json', 'Sec-Fetch-Site': site });
        expect(res.status).toBe(200);
    });

    it.each(['https://evil.example', 'http://localhost.evil.example', 'https://localhost', 'null'])(
        'rejects a foreign Origin %s with 403', async origin => {
            const { post, validateCredentials } = setup();
            const res = await post({ 'Content-Type': 'application/json', Origin: origin });
            expect(res.status).toBe(403);
            expect(validateCredentials).not.toHaveBeenCalled();
        });

    it('rejects a foreign Origin even when Sec-Fetch-Site claims same-site', async () => {
        const { post } = setup();
        const res = await post({ 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-site', Origin: 'http://sub.localhost' });
        expect(res.status).toBe(403);
    });

    it('allows a matching Origin', async () => {
        const { post } = setup();
        const res = await post({ 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: 'http://localhost' });
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toBe('session=abc; Path=/; HttpOnly');
    });

    it('allows the https Origin behind a TLS-terminating proxy', async () => {
        const { post } = setup();
        const res = await post({ 'Content-Type': 'application/json', Origin: 'https://localhost', 'X-Forwarded-Proto': 'https' });
        expect(res.status).toBe(200);
    });

    it.each(['{"email":', 'not json', ''])('returns 400 for malformed JSON %j', async payload => {
        const { post, validateCredentials } = setup();
        const res = await post({ 'Content-Type': 'application/json' }, payload);
        expect(res.status).toBe(400);
        expect(validateCredentials).not.toHaveBeenCalled();
    });

    it.each(['null', '[]', '"pw"', '42'])('returns 400 for non-object JSON %s', async payload => {
        const { post, validateCredentials } = setup();
        const res = await post({ 'Content-Type': 'application/json' }, payload);
        expect(res.status).toBe(400);
        expect(validateCredentials).not.toHaveBeenCalled();
    });
});

describe('createAuth — reusable createSession', () => {
    it('exposes createSession on the kit when configured on the provider', async () => {
        let captured: User | undefined;
        const kit = createAuth<User>({
            extractSessionId: () => undefined,
            validateSessionId: async () => null,
            resolveUserById: async () => null,
            createSession: async (user) => {
                captured = user;
                const headers = new Headers();
                headers.append('Set-Cookie', 'session=xyz; HttpOnly');
                return { headers };
            },
        });
        expect(typeof kit.createSession).toBe('function');

        // Simulate an OAuth-style caller reusing auth.createSession.
        const user: User = { id: 'u1', email: 'a@b.io', name: 'Tan' };
        const { headers } = (await kit.createSession!(user, undefined as never))!;
        expect(captured).toEqual(user);
        expect(headers.get('set-cookie')).toBe('session=xyz; HttpOnly');
    });

    it('createSession is undefined when not configured', () => {
        const kit = createAuth<User>({
            extractSessionId: () => undefined,
            validateSessionId: async () => null,
            resolveUserById: async () => null,
        });
        expect(kit.createSession).toBeUndefined();
    });

    it('createLoginHandler falls back to provider.createSession when its own is omitted', async () => {
        const user: User = { id: 'u1', email: 'a@b.io', name: 'Tan' };
        const kit = createAuth<User>({
            extractSessionId: () => undefined,
            validateSessionId: async () => null,
            resolveUserById: async () => null,
            createSession: async () => {
                const headers = new Headers();
                headers.append('Set-Cookie', 'fallback=1; HttpOnly');
                return { headers };
            },
        });
        const loginHandler = kit.createLoginHandler({
            validateCredentials: async () => user,
        });
        const app = buildApp(kit, loginHandler);
        const res = await app.request('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'a@b.io', password: 'pw' }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toBe('fallback=1; HttpOnly');
    });

    it('createLoginHandler returns 500 when no createSession is configured anywhere', async () => {
        const user: User = { id: 'u1', email: 'a@b.io', name: 'Tan' };
        const kit = createAuth<User>({
            extractSessionId: () => undefined,
            validateSessionId: async () => null,
            resolveUserById: async () => null,
            // no createSession on the provider
        });
        // Omitting both creators exercises the runtime guard.
        const loginHandler = kit.createLoginHandler({
            validateCredentials: async () => user,
        });
        const app = buildApp(kit, loginHandler);
        const res = await app.request('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'a@b.io', password: 'pw' }),
        });
        expect(res.status).toBe(500);
        expect(((await res.json()) as { error: string }).error).toMatch(/No createSession configured/);
    });
});
