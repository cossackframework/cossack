import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
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
        // Note: createLoginHandler still requires a createSession in its opts
        // (it's typed as required to preserve the existing API), but at runtime
        // we simulate the provider fallback by omitting it via a cast.
        const loginHandler = kit.createLoginHandler({
            validateCredentials: async () => user,
            // intentionally omit createSession to exercise the fallback path
            createSession: undefined as unknown as () => Promise<{ headers: Headers }>,
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
        // And omit it on the login handler too (cast to exercise the runtime guard).
        const loginHandler = kit.createLoginHandler({
            validateCredentials: async () => user,
            createSession: undefined as unknown as () => Promise<{ headers: Headers }>,
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
