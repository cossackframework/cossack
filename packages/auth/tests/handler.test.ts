import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createOAuth } from '../src/oauth';
import { signCookieValue } from '../src/oauth/state';
import { mockFetch, restoreFetch } from './helpers';

const SECRET = 'test-secret-0123456789-abcdef-0123456789';

function buildApp(opts?: Parameters<typeof createOAuth>[0]) {
    const oauth = createOAuth(
        opts ?? {
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
                secret: SECRET,
                providers: {},
            }).redirect('totally-unknown-provider'),
        ).toThrow(/Unknown OAuth provider "totally-unknown-provider"/);
    });

    it('throws if the provider has no credentials configured', () => {
        expect(() =>
            createOAuth({
                secret: SECRET,
                providers: {},
            }).redirect('github'),
        ).toThrow(/No credentials configured for OAuth provider "github"/);
    });

    it('rejects a too-short secret', () => {
        expect(() =>
            createOAuth({
                secret: 'short',
                providers: {},
            }),
        ).toThrow(/at least 16 characters/);
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
            avatar: 'https://github.com/octo.png',
        });
        expect(seen.tokens).toMatchObject({ accessToken: 'at', scope: 'user:email' });
    });

    it('clears the state cookie after the callback (single-use)', async () => {
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
        expect(res.status).toBe(502);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/state cookie missing/i);
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
        expect(res.status).toBe(502);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/state mismatch/i);
    });

    it('surfaces provider error params', async () => {
        const { app } = buildApp();
        const res = await app.request(
            '/auth/github/callback?error=access_denied&error_description=user+cancelled',
        );
        expect(res.status).toBe(502);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/access_denied/);
        expect(body.error).toMatch(/user cancelled/);
    });

    it('rejects when code or state query param is missing', async () => {
        const { app } = buildApp();
        const res = await app.request('/auth/github/callback');
        expect(res.status).toBe(502);
        expect(((await res.json()) as { error: string }).error).toMatch(/missing required/);
    });

    it('invokes onError when provided', async () => {
        const oauth = createOAuth({
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
});

describe('createOAuth — custom providers', () => {
    afterEach(restoreFetch);

    it('rejects custom provider that shadows a first-party id', () => {
        expect(() =>
            createOAuth({
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
        ).toThrow(/shadows a first-party provider/);
    });
});
