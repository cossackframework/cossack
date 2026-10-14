import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createOAuth } from '../src/oauth';
import { signCookieValue } from '../src/oauth/state';
import { mockFetch, restoreFetch, memoryOAuthStates } from './helpers';

const SECRET = 'test-secret-0123456789-abcdef-0123456789';

function buildApp(opts?: Parameters<typeof createOAuth>[0]) {
    const oauth = createOAuth(
        opts ?? {
            stateStore: memoryOAuthStates().store,
            secret: SECRET,
            providers: {
                github: {
                    clientId: 'gh-id',
                    clientSecret: 'gh-secret',
                    redirectUrl: '/auth/github/callback',
                },
            },
        },
    );

    const seen: { user?: unknown; tokens?: unknown } = {};
    const app = new Hono();
    app.get('/auth/github/redirect', oauth.redirect('github'));
    app.get(
        '/auth/github/callback',
        oauth.callback('github', {
            async onUser(user, tokens) {
                seen.user = user;
                seen.tokens = tokens;
            },
            successRedirect: '/dashboard',
        }),
    );
    return { app, oauth, seen };
}

function getSetCookieHeader(res: Response): string {
    return res.headers.get('set-cookie') ?? '';
}

describe('createOAuth — redirect handler', () => {
    afterEach(restoreFetch);

    it('redirects 302 to the provider authorize URL', async () => {
        const { app } = buildApp();
        const res = await app.request('/auth/github/redirect');
        expect(res.status).toBe(302);
        const location = res.headers.get('location') ?? '';
        expect(location).toContain('https://github.com/login/oauth/authorize?');
        const params = new URL(location).searchParams;
        expect(params.get('client_id')).toBe('gh-id');
        expect(params.get('redirect_uri')).toBe('http://localhost/auth/github/callback');
        expect(params.get('response_type')).toBe('code');
        expect(params.get('code_challenge_method')).toBe('S256');
        expect(params.get('state')).toMatch(/.+/);
        expect(params.get('code_challenge')).toMatch(/.+/);
    });

    it('sets an HttpOnly signed state cookie', async () => {
        const { app } = buildApp();
        const res = await app.request('/auth/github/redirect');
        const cookie = getSetCookieHeader(res);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('cossack_oauth_state=');
    });

    it('throws if the provider is unknown', () => {
        expect(() =>
            createOAuth({
                stateStore: memoryOAuthStates().store,
                secret: SECRET,
                providers: {},
            }).redirect('totally-unknown-provider'),
        ).toThrow(/Unknown OAuth provider/);
    });

    it('throws if the provider has no credentials configured', () => {
        expect(() =>
            createOAuth({
                stateStore: memoryOAuthStates().store,
                secret: SECRET,
                providers: {},
            }).redirect('github'),
        ).toThrow(/OAuth credentials are missing/);
    });

    it('rejects a too-short secret', () => {
        expect(() =>
            createOAuth({
                stateStore: memoryOAuthStates().store,
                secret: 'short',
                providers: {},
            }),
        ).toThrow(/at least 16 characters/);
    });

    it('supports request-scoped secret resolvers', async () => {
        const resolver = vi.fn(() => SECRET);
        const { app } = buildApp({
            stateStore: memoryOAuthStates().store,
            secret: resolver,
            providers: {
                github: {
                    clientId: 'gh-id',
                    clientSecret: 'gh-secret',
                    redirectUrl: '/auth/github/callback',
                },
            },
        });
        const res = await app.request('/auth/github/redirect');
        expect(res.status).toBe(302);
        expect(resolver).toHaveBeenCalledOnce();
    });

    it('reports an invalid resolved secret at request time', async () => {
        const { app } = buildApp({
            stateStore: memoryOAuthStates().store,
            secret: () => '',
            providers: {
                github: {
                    clientId: 'gh-id',
                    clientSecret: 'gh-secret',
                    redirectUrl: '/auth/github/callback',
                },
            },
        });
        const res = await app.request('/auth/github/redirect');
        expect(res.status).toBe(500);
        expect(await res.json()).toMatchObject({ code: 'COSSACK_OAUTH_SECRET_INVALID', stage: 'configuration' });
    });
});

describe('createOAuth — callback handler (happy path)', () => {
    afterEach(restoreFetch);

    it('verifies state, exchanges code, fetches user, and redirects on success', async () => {
        const { app, seen } = buildApp();

        // 1. Perform redirect to obtain a real signed cookie + state value.
        const redirectRes = await app.request('/auth/github/redirect');
        const cookieHeader = getSetCookieHeader(redirectRes);
        const state = new URL(redirectRes.headers.get('location') ?? '').searchParams.get('state')!;
        const cookieValue = /cossack_oauth_state=([^;]+)/.exec(cookieHeader)![1];

        // 2. Mock the token-exchange + userinfo responses.
        mockFetch([
            { body: { access_token: 'at', token_type: 'bearer', scope: 'user:email' } },
            {
                body: {
                    id: 99,
                    login: 'octouser',
                    name: 'Octo Cat',
                    email: 'octo@e.io',
                    avatar_url: 'https://github.com/octo.png',
                },
            },
            { body: [{ email: 'octo@e.io', primary: true, verified: true }] },
        ]);

        // 3. Hit the callback with the state + a fake code, carrying the cookie.
        const callbackUrl = new URL('/auth/github/callback', 'http://localhost');
        callbackUrl.searchParams.set('code', 'theauthcode');
        callbackUrl.searchParams.set('state', state);
        const callbackRes = await app.request(callbackUrl.toString().replace('http://localhost', ''), {
            headers: { cookie: `cossack_oauth_state=${cookieValue}` },
        });

        expect(callbackRes.status).toBe(302);
        expect(callbackRes.headers.get('location')).toBe('/dashboard');

        expect(seen.user).toMatchObject({
            id: '99',
            nickname: 'octouser',
            name: 'Octo Cat',
            email: 'octo@e.io',
            emailVerified: true,
            avatar: 'https://github.com/octo.png',
        });
        expect(seen.tokens).toMatchObject({ accessToken: 'at', scope: 'user:email' });
    });

    it('clears the state cookie after the callback', async () => {
        const { app } = buildApp();
        const redirectRes = await app.request('/auth/github/redirect');
        const cookieHeader = getSetCookieHeader(redirectRes);
        const state = new URL(redirectRes.headers.get('location') ?? '').searchParams.get('state')!;
        const cookieValue = /cossack_oauth_state=([^;]+)/.exec(cookieHeader)![1];

        mockFetch([
            { body: { access_token: 'at' } },
            { body: { id: 1, login: 'u', email: 'a@b.io' } },
        ]);

        const callbackUrl = `/auth/github/callback?code=c&state=${state}`;
        const callbackRes = await app.request(callbackUrl, {
            headers: { cookie: `cossack_oauth_state=${cookieValue}` },
        });
        expect(callbackRes.status).toBe(302);
        // Set-Cookie should clear (Max-Age=0 / empty value).
        const clearing = getSetCookieHeader(callbackRes);
        expect(clearing).toMatch(/cossack_oauth_state=;|Max-Age=0|expires=Thu, 01 Jan 1970/i);
    });
});

describe('createOAuth — callback handler (failure modes)', () => {
    afterEach(restoreFetch);

    it('rejects when state cookie is missing', async () => {
        const { app } = buildApp();
        mockFetch({ body: { access_token: 'at' } });
        const res = await app.request('/auth/github/callback?code=c&state=anything');
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/state cookie is missing/i);
    });

    it('rejects when state does not match (CSRF defense)', async () => {
        const { app } = buildApp();
        // Build a cookie signed with one state, then send a different state on the URL.
        const token = await signCookieValue(
            { state: 'stored-state', codeVerifier: 'v' },
            SECRET,
        );
        mockFetch({ body: { access_token: 'at' } });
        const res = await app.request('/auth/github/callback?code=c&state=attacker-state', {
            headers: { cookie: `cossack_oauth_state=${token}` },
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/state mismatch/i);
    });

    it('reports consent denial without echoing provider error params', async () => {
        const { app } = buildApp();
        const res = await app.request(
            '/auth/github/callback?error=access_denied&error_description=user+cancelled',
        );
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body).toMatchObject({ code: 'COSSACK_OAUTH_CONSENT_DENIED', stage: 'callback' });
        expect(JSON.stringify(body)).not.toContain('user cancelled');
    });

    it('rejects when code or state query param is missing', async () => {
        const { app } = buildApp();
        const res = await app.request('/auth/github/callback');
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toMatch(/missing required code or state/);
    });

    it('invokes onError when provided', async () => {
        const oauth = createOAuth({
            stateStore: memoryOAuthStates().store,
            secret: SECRET,
            providers: {
                github: {
                    clientId: 'gh-id',
                    clientSecret: 'gh-secret',
                    redirectUrl: '/auth/github/callback',
                },
            },
        });
        const app = new Hono();
        app.get(
            '/cb',
            oauth.callback('github', {
                onUser: () => {},
                onError: async (_e, c) => c.json({ custom: true }, 418),
            }),
        );
        const res = await app.request('/cb');
        expect(res.status).toBe(418);
        expect(await res.json()).toEqual({ custom: true });
    });

    it('honors an onUser Response return value', async () => {
        const oauth = createOAuth({
            stateStore: memoryOAuthStates().store,
            secret: SECRET,
            providers: {
                github: {
                    clientId: 'gh-id',
                    clientSecret: 'gh-secret',
                    redirectUrl: '/auth/github/callback',
                },
            },
        });
        const app = new Hono();
        app.get(
            '/cb',
            oauth.callback('github', {
                onUser: async () => new Response('hello from user', { status: 201 }),
            }),
        );

        // Build a valid signed cookie.
        const redirectApp = new Hono();
        redirectApp.get('/r', oauth.redirect('github'));
        const redirectRes = await redirectApp.request('/r');
        const cookieValue = /cossack_oauth_state=([^;]+)/.exec(
            getSetCookieHeader(redirectRes),
        )![1];
        const state = new URL(redirectRes.headers.get('location') ?? '').searchParams.get('state')!;

        mockFetch([
            { body: { access_token: 'at' } },
            { body: { id: 1, login: 'u', email: 'a@b.io' } },
        ]);

        const res = await app.request(`/cb?code=c&state=${state}`, {
            headers: { cookie: `cossack_oauth_state=${cookieValue}` },
        });
        expect(res.status).toBe(201);
        expect(await res.text()).toBe('hello from user');
    });
});

describe('createOAuth — stateless mode', () => {
    afterEach(restoreFetch);

    it('does not set a state cookie on redirect', async () => {
        const oauth = createOAuth({
            secret: SECRET,
            stateless: true,
            providers: {
                github: {
                    clientId: 'gh-id',
                    clientSecret: 'gh-secret',
                    redirectUrl: '/auth/github/callback',
                },
            },
        });
        const app = new Hono();
        app.get('/r', oauth.redirect('github'));
        const res = await app.request('/r');
        expect(res.status).toBe(302);
        expect(getSetCookieHeader(res)).not.toContain('cossack_oauth_state');
    });

    it('omits code_challenge / PKCE on the authorize URL (no verifier can be recovered)', async () => {
        const oauth = createOAuth({
            secret: SECRET,
            stateless: true,
            providers: {
                github: {
                    clientId: 'gh-id',
                    clientSecret: 'gh-secret',
                    redirectUrl: '/auth/github/callback',
                },
            },
        });
        const app = new Hono();
        app.get('/r', oauth.redirect('github'));
        const res = await app.request('/r');
        const location = new URL(res.headers.get('location') ?? '');
        expect(location.searchParams.get('code_challenge')).toBeNull();
        expect(location.searchParams.get('code_challenge_method')).toBeNull();
    });

    function statelessApp(options: { secret?: string; maxAge?: number } = {}) {
        const oauth = createOAuth({
            secret: options.secret ?? SECRET,
            stateless: true,
            ...(options.maxAge === undefined ? {} : { cookie: { maxAge: options.maxAge } }),
            providers: {
                github: { clientId: 'gh-id', clientSecret: 'gh-secret', redirectUrl: '/auth/github/callback' },
                gitlab: { clientId: 'gl-id', clientSecret: 'gl-secret', redirectUrl: '/auth/gitlab/callback' },
            },
        });
        const onUser = vi.fn(async () => {});
        const app = new Hono();
        app.get('/r/:provider', c => oauth.redirect(c.req.param('provider'))(c, async () => {}) as Promise<Response>);
        app.get('/cb', oauth.callback('github', { onUser, successRedirect: '/done' }));
        const start = async (provider = 'github') => {
            const res = await app.request(`/r/${provider}`);
            return new URL(res.headers.get('location') ?? '').searchParams.get('state')!;
        };
        return { app, onUser, start };
    }

    it('completes the callback flow with its signed state and no code_verifier', async () => {
        const { app, onUser, start } = statelessApp();
        const state = await start();
        let observedBody: string | undefined;
        const mock = mockFetch([
            { body: { access_token: 'at', token_type: 'bearer' } },
            { body: { id: 1, login: 'u', email: 'a@b.io' } },
            { body: [{ email: 'a@b.io', primary: true, verified: true }] },
        ]);
        const original = globalThis.fetch;
        vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
            if (typeof input === 'string' && input.includes('access_token')) observedBody = String(init?.body);
            return original(input, init);
        });

        const res = await app.request(`/cb?code=thecode&state=${encodeURIComponent(state)}`);
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/done');
        expect(observedBody).not.toContain('code_verifier');
        expect((onUser.mock.calls[0] as unknown[])[0]).toMatchObject({ id: '1' });
        expect(mock).toHaveBeenCalledTimes(3); // token, /user, /user/emails
    });

    it('issues a distinct signed state per redirect', async () => {
        const { start } = statelessApp();
        const [a, b] = [await start(), await start()];
        expect(a).not.toBe(b);
        expect(a).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    });

    it.each([
        ['an arbitrary value', () => 'anystate'],
        ['a random nonce', () => 'AAAAAAAAAAAAAAAAAAAAAA'],
        ['a value with a forged signature', (s: string) => `${s.slice(0, s.lastIndexOf('.'))}.${'A'.repeat(43)}`],
        ['a tampered payload', (s: string) => `${s[0] === 'A' ? 'B' : 'A'}${s.slice(1)}`],
    ])('rejects %s without contacting the provider', async (_label, forge) => {
        const { app, onUser, start } = statelessApp();
        const state = forge(await start());
        const mock = mockFetch({ body: { access_token: 'at' } });
        const res = await app.request(`/cb?code=thecode&state=${encodeURIComponent(state)}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'COSSACK_OAUTH_STATE_INVALID' });
        expect(mock).not.toHaveBeenCalled();
        expect(onUser).not.toHaveBeenCalled();
    });

    it('rejects a state signed with a different secret', async () => {
        const other = statelessApp({ secret: 'another-secret-0123456789-abcdef' });
        const state = await other.start();
        const { app, onUser } = statelessApp();
        const mock = mockFetch({ body: { access_token: 'at' } });
        const res = await app.request(`/cb?code=c&state=${encodeURIComponent(state)}`);
        expect(res.status).toBe(400);
        expect(mock).not.toHaveBeenCalled();
        expect(onUser).not.toHaveBeenCalled();
    });

    it('rejects a state issued for another provider', async () => {
        const { app, onUser, start } = statelessApp();
        const state = await start('gitlab');
        const mock = mockFetch({ body: { access_token: 'at' } });
        const res = await app.request(`/cb?code=c&state=${encodeURIComponent(state)}`);
        expect(res.status).toBe(400);
        expect(mock).not.toHaveBeenCalled();
        expect(onUser).not.toHaveBeenCalled();
    });

    it('rejects an expired state', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const { app, onUser, start } = statelessApp({ maxAge: 60 });
            const state = await start();
            vi.setSystemTime(Date.now() + 61_000);
            const mock = mockFetch({ body: { access_token: 'at' } });
            const res = await app.request(`/cb?code=c&state=${encodeURIComponent(state)}`);
            expect(res.status).toBe(400);
            expect(await res.json()).toMatchObject({ code: 'COSSACK_OAUTH_STATE_INVALID' });
            expect(mock).not.toHaveBeenCalled();
            expect(onUser).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });

    it('rejects a stateful cookie value used as a stateless state', async () => {
        const cookie = await signCookieValue({ state: 's', codeVerifier: 'v' }, SECRET);
        const { app, onUser } = statelessApp();
        const mock = mockFetch({ body: { access_token: 'at' } });
        const res = await app.request(`/cb?code=c&state=${encodeURIComponent(cookie)}`);
        expect(res.status).toBe(400);
        expect(mock).not.toHaveBeenCalled();
        expect(onUser).not.toHaveBeenCalled();
    });

    it('requires a valid secret at construction', () => {
        const providers = { github: { clientId: 'gh-id', clientSecret: 'gh-secret', redirectUrl: '/cb' } };
        expect(() => createOAuth({ stateless: true, providers } as never)).toThrow(/state secret/);
        expect(() => createOAuth({ secret: 'short', stateless: true, providers })).toThrow(/state secret/);
    });
});

describe('createOAuth — custom providers', () => {
    afterEach(restoreFetch);

    it('rejects custom provider that shadows a first-party id', () => {
        expect(() =>
            createOAuth({
                stateStore: memoryOAuthStates().store,
                secret: SECRET,
                providers: {},
                customProviders: {
                    github: {
                        id: 'github',
                        authorizeUrl: 'x',
                        tokenUrl: 'x',
                        userInfoUrl: 'x',
                        scopes: [],
                        normalizeUser: (raw) => ({ id: String(raw.id), raw }),
                    },
                },
            }),
        ).toThrow(/OAuth configuration is invalid/);
    });
});

// docs/oauth.md: `providers.google.provider.hostedDomain` is enforced on the
// callback, not only sent as the `hd` picker hint.
describe('createOAuth — Google hostedDomain and verified email through the callback', () => {
    afterEach(restoreFetch);

    const idToken = (claims: Record<string, unknown>) => `hdr.${btoa(JSON.stringify(claims))}.sig`;

    function googleApp(provider?: { hostedDomain?: string }) {
        const oauth = createOAuth({
            stateStore: memoryOAuthStates().store,
            secret: SECRET,
            providers: {
                google: { clientId: 'g-id', clientSecret: 'g-secret', redirectUrl: '/auth/google/callback', ...(provider ? { provider } : {}) },
            },
        });
        const onUser = vi.fn(async () => {});
        const onError = vi.fn(async (error: { toJSON(): unknown }, c: { json(body: unknown, status: number): Response }) =>
            c.json(error.toJSON(), 499));
        const app = new Hono();
        app.get('/auth/google/redirect', oauth.redirect('google'));
        app.get('/auth/google/callback', oauth.callback('google', { onUser, onError: onError as never, successRedirect: '/home' }));
        const signIn = async (claims: Record<string, unknown>) => {
            const redirect = await app.request('/auth/google/redirect');
            const location = new URL(redirect.headers.get('location') ?? '');
            const cookie = /cossack_oauth_state=([^;]+)/.exec(getSetCookieHeader(redirect))![1];
            mockFetch([
                { body: { access_token: 'at', id_token: idToken(claims), token_type: 'Bearer' } },
                { body: { sub: claims.sub } },
            ]);
            const response = await app.request(`/auth/google/callback?code=c&state=${location.searchParams.get('state')}`, {
                headers: { cookie: `cossack_oauth_state=${cookie}` },
            });
            restoreFetch();
            return { location, response };
        };
        return { onUser, onError, signIn };
    }

    it('sends hd and admits a verified account from the configured domain', async () => {
        const { onUser, signIn } = googleApp({ hostedDomain: 'acme.com' });
        const { location, response } = await signIn({ sub: 's1', email: 'ada@acme.com', email_verified: true, hd: 'acme.com' });
        expect(location.searchParams.get('hd')).toBe('acme.com');
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/home');
        expect(onUser).toHaveBeenCalledOnce();
        expect((onUser.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 's1', email: 'ada@acme.com', emailVerified: true });
    });

    it.each([
        ['a personal account after the user removed hd', { sub: 's1', email: 'ada@gmail.com', email_verified: true }],
        ['another Workspace domain', { sub: 's1', email: 'ada@evil.com', email_verified: true, hd: 'evil.com' }],
        ['an unverified address in the domain', { sub: 's1', email: 'ada@acme.com', email_verified: false, hd: 'acme.com' }],
    ])('rejects %s before onUser runs', async (_label, claims) => {
        const { onUser, onError, signIn } = googleApp({ hostedDomain: 'acme.com' });
        const { response } = await signIn(claims);
        expect(onUser).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledOnce();
        expect(response.status).toBe(499);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_OAUTH_USER_INFO_FAILED', stage: 'user-info', status: 502 });
    });

    it('passes an unverified Google email to onUser as null without hostedDomain', async () => {
        const { onUser, signIn } = googleApp();
        const { response } = await signIn({ sub: 's2', email: 'victim@example.com', email_verified: false });
        expect(response.status).toBe(302);
        expect((onUser.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 's2', email: null, emailVerified: false });
    });
});
