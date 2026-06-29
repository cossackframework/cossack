import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { githubProvider } from '../src/oauth/providers/github';
import { createGoogleProvider } from '../src/oauth/providers/google';
import { createGitLabProvider } from '../src/oauth/providers/gitlab';
import { facebookProvider } from '../src/oauth/providers/facebook';
import { createMicrosoftProvider } from '../src/oauth/providers/microsoft';
import { defineOAuthProvider } from '../src/oauth/provider';
import {
    buildAuthorizeUrl,
    exchangeCode,
    fetchUserInfo,
    parseTokenResponse,
    resolveRedirectUrl,
} from '../src/oauth/flow';
import type { OAuthProviderConfig, OAuthProviderDefinition } from '../src/oauth/types';
import { mockFetch, restoreFetch } from './helpers';

const config: OAuthProviderConfig = {
    clientId: 'cid',
    clientSecret: 'csec',
    redirectUrl: '/cb',
    scopes: ['openid', 'email'],
};

function mockContext(path: string): new () => any {
    // We only need c.req.raw.url for resolveRedirectUrl; build a minimal stub.
    return {
        req: { raw: new Request(path) },
    } as unknown as new () => any;
}

describe('resolveRedirectUrl', () => {
    it('returns absolute URLs unchanged', () => {
        const c: any = mockContext('https://app.example.com/start');
        expect(resolveRedirectUrl('https://callback.example.com/cb', c)).toBe(
            'https://callback.example.com/cb',
        );
    });

    it('resolves relative URLs against the request origin', () => {
        const c: any = mockContext('https://app.example.com/start');
        expect(resolveRedirectUrl('/auth/cb', c)).toBe('https://app.example.com/auth/cb');
    });

    it('uses port from the request URL', () => {
        const c: any = mockContext('http://localhost:8787/start');
        expect(resolveRedirectUrl('/auth/cb', c)).toBe('http://localhost:8787/auth/cb');
    });
});

describe('buildAuthorizeUrl', () => {
    it('includes all standard params + PKCE', () => {
        const url = new URL(
            buildAuthorizeUrl({
                definition: githubProvider,
                config,
                redirectUrl: 'https://app.example.com/cb',
                state: 'st8',
                codeChallenge: 'chllng',
            }),
        );
        expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
        const params = url.searchParams;
        expect(params.get('response_type')).toBe('code');
        expect(params.get('client_id')).toBe('cid');
        expect(params.get('redirect_uri')).toBe('https://app.example.com/cb');
        expect(params.get('state')).toBe('st8');
        expect(params.get('code_challenge')).toBe('chllng');
        expect(params.get('code_challenge_method')).toBe('S256');
    });

    it('uses default scopes when config has none', () => {
        const url = new URL(
            buildAuthorizeUrl({
                definition: githubProvider,
                config: { ...config, scopes: undefined },
                redirectUrl: 'https://app.example.com/cb',
                state: 'st8',
                codeChallenge: 'chllng',
            }),
        );
        expect(url.searchParams.get('scope')).toBe('user:email');
    });

    it('honors config.scopes override (joined by space)', () => {
        const url = new URL(
            buildAuthorizeUrl({
                definition: githubProvider,
                config,
                redirectUrl: 'https://app.example.com/cb',
                state: 'st8',
                codeChallenge: 'chllng',
            }),
        );
        expect(url.searchParams.get('scope')).toBe('openid email');
    });

    it('drops reserved keys from authorizeParams extras', () => {
        const def: OAuthProviderDefinition = {
            ...githubProvider,
            authorizeParams: () => ({
                state: 'ATTACK',
                response_type: 'token',
                hd: 'example.com',
            }),
        };
        const url = new URL(
            buildAuthorizeUrl({
                definition: def,
                config,
                redirectUrl: 'https://app.example.com/cb',
                state: 'st8',
                codeChallenge: 'chllng',
            }),
        );
        const params = url.searchParams;
        expect(params.get('state')).toBe('st8');
        expect(params.get('response_type')).toBe('code');
        expect(params.get('hd')).toBe('example.com');
    });

    it('supports comma-separated scopes (Google uses space; custom may use comma)', () => {
        const def: OAuthProviderDefinition = {
            ...githubProvider,
            scopeSeparator: ',',
        };
        const url = new URL(
            buildAuthorizeUrl({
                definition: def,
                config,
                redirectUrl: 'https://app.example.com/cb',
                state: 'st8',
                codeChallenge: 'chllng',
            }),
        );
        expect(url.searchParams.get('scope')).toBe('openid,email');
    });

    it('omits scope param when no scopes configured', () => {
        const def: OAuthProviderDefinition = { ...githubProvider, scopes: [] };
        const url = new URL(
            buildAuthorizeUrl({
                definition: def,
                config: { ...config, scopes: undefined },
                redirectUrl: 'https://app.example.com/cb',
                state: 'st8',
                codeChallenge: 'chllng',
            }),
        );
        expect(url.searchParams.get('scope')).toBeNull();
    });
});

describe('parseTokenResponse', () => {
    it('parses a standard JSON response', () => {
        const tokens = parseTokenResponse(
            JSON.stringify({
                access_token: 'at',
                refresh_token: 'rt',
                expires_in: 3600,
                token_type: 'bearer',
                scope: 'read',
                id_token: 'idt',
            }),
        );
        expect(tokens).toEqual({
            accessToken: 'at',
            refreshToken: 'rt',
            expiresIn: 3600,
            tokenType: 'bearer',
            scope: 'read',
            idToken: 'idt',
        });
    });

    it('parses a form-encoded response', () => {
        const tokens = parseTokenResponse('access_token=at&token_type=bearer');
        expect(tokens.accessToken).toBe('at');
        expect(tokens.tokenType).toBe('bearer');
        expect(tokens.refreshToken).toBeUndefined();
    });

    it('throws when access_token is missing', () => {
        expect(() => parseTokenResponse(JSON.stringify({ error: 'bad' }))).toThrow(
            /missing access_token/,
        );
    });
});

describe('exchangeCode', () => {
    afterEach(restoreFetch);

    it('POSTs urlencoded body with all required fields', async () => {
        const mock = mockFetch({
            body: { access_token: 'at', token_type: 'bearer' },
        });
        await exchangeCode({
            definition: githubProvider,
            config,
            redirectUrl: 'https://app.example.com/cb',
            code: 'thecode',
            codeVerifier: 'theverifier',
        });
        expect(mock).toHaveBeenCalledTimes(1);
        const [url, init] = mock.mock.calls[0];
        expect(url).toBe('https://github.com/login/oauth/access_token');
        expect(init?.method).toBe('POST');
        const body = String(init?.body);
        expect(body).toContain('grant_type=authorization_code');
        expect(body).toContain('code=thecode');
        expect(body).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb');
        expect(body).toContain('client_id=cid');
        expect(body).toContain('client_secret=csec');
        expect(body).toContain('code_verifier=theverifier');
        const headers = new Headers(init?.headers);
        expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    });

    it('merges tokenParams extras into the body', async () => {
        const mock = mockFetch({ body: { access_token: 'at' } });
        const def: OAuthProviderDefinition = {
            ...githubProvider,
            tokenParams: () => ({ resource: 'my-api' }),
        };
        await exchangeCode({
            definition: def,
            config,
            redirectUrl: 'https://app.example.com/cb',
            code: 'c',
            codeVerifier: 'v',
        });
        const body = String(mock.mock.calls[0][1]?.body);
        expect(body).toContain('resource=my-api');
    });

    it('throws on non-2xx response', async () => {
        mockFetch({ status: 400, body: { error: 'invalid_grant' } });
        await expect(
            exchangeCode({
                definition: githubProvider,
                config,
                redirectUrl: 'https://app.example.com/cb',
                code: 'c',
                codeVerifier: 'v',
            }),
        ).rejects.toThrow(/OAuth token exchange failed: 400/);
    });
});

describe('fetchUserInfo', () => {
    afterEach(restoreFetch);

    it('sends a bearer token and runs the provider normalizer', async () => {
        const mock = mockFetch({
            body: { id: 42, login: 'octouser', name: 'Octo', email: 'o@e.io', avatar_url: 'https://a' },
        });
        const { user, raw } = await fetchUserInfo({
            definition: githubProvider,
            tokens: { accessToken: 'at' },
        });
        const [url, init] = mock.mock.calls[0];
        expect(url).toBe('https://api.github.com/user');
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer at');
        expect(raw).toEqual({
            id: 42,
            login: 'octouser',
            name: 'Octo',
            email: 'o@e.io',
            avatar_url: 'https://a',
        });
        expect(user.id).toBe('42');
        expect(user.nickname).toBe('octouser');
        expect(user.email).toBe('o@e.io');
    });

    it('appends userInfoParams (Facebook fields)', async () => {
        const mock = mockFetch({ body: { id: 'fb1', name: 'Fb' } });
        await fetchUserInfo({
            definition: facebookProvider,
            tokens: { accessToken: 'at' },
        });
        const url = mock.mock.calls[0][0] as string;
        expect(url).toContain('fields=');
        expect(url).toContain('email');
    });

    it('throws on non-2xx', async () => {
        mockFetch({ status: 401, body: { error: 'invalid_token' } });
        await expect(
            fetchUserInfo({ definition: githubProvider, tokens: { accessToken: 'at' } }),
        ).rejects.toThrow(/OAuth user-info fetch failed: 401/);
    });
});

describe('provider definitions', () => {
    describe('github', () => {
        it('falls back to /user/emails when email is null', async () => {
            // Force a sequence: first userinfo returns null email, second /user/emails returns list.
            mockFetch([
                { body: { id: 1, login: 'u', email: null, avatar_url: 'a' } },
                {
                    body: [
                        { email: 'pub@e.io', primary: true, verified: true },
                        { email: 'priv@e.io', primary: false, verified: true },
                    ],
                },
            ]);
            const { user } = await fetchUserInfo({
                definition: githubProvider,
                tokens: { accessToken: 'at' },
            });
            expect(user.email).toBe('pub@e.io');
            restoreFetch();
        });

        it('skips the emails call when email is present', async () => {
            const mock = mockFetch({ body: { id: 1, login: 'u', email: 'a@b.io' } });
            const { user } = await fetchUserInfo({
                definition: githubProvider,
                tokens: { accessToken: 'at' },
            });
            expect(user.email).toBe('a@b.io');
            expect(mock).toHaveBeenCalledTimes(1); // only userinfo, no /user/emails
            restoreFetch();
        });
    });

    describe('google', () => {
        it('passes hostedDomain and offlineAccess as authorize params', () => {
            const def = createGoogleProvider({ hostedDomain: 'acme.com', offlineAccess: true });
            const configWithOpts = {
                ...config,
                provider: { hostedDomain: 'acme.com', offlineAccess: true },
            } as OAuthProviderConfig & { provider: unknown };
            const extras = def.authorizeParams?.(configWithOpts) ?? {};
            expect(extras.hd).toBe('acme.com');
            expect(extras.access_type).toBe('offline');
            expect(extras.prompt).toBe('consent');
        });

        it('prefers id_token claims when normalizing', async () => {
            const def = createGoogleProvider();
            // JWT payload {"sub":"sub-123","email":"claims@e.io","name":"Claims","picture":"pic"}
            const payload = btoa(JSON.stringify({ sub: 'sub-123', email: 'claims@e.io', name: 'Claims', picture: 'pic' }));
            const idToken = `hdr.${payload}.sig`;
            const user = await def.normalizeUser({ sub: 'other', email: 'raw@e.io' }, { accessToken: 'at', idToken });
            expect(user.id).toBe('sub-123');
            expect(user.email).toBe('claims@e.io');
            expect(user.name).toBe('Claims');
            expect(user.avatar).toBe('pic');
        });
    });

    describe('gitlab', () => {
        it('uses default base url when none provided', () => {
            const def = createGitLabProvider();
            expect(def.authorizeUrl).toBe('https://gitlab.com/oauth/authorize');
            expect(def.tokenUrl).toBe('https://gitlab.com/oauth/token');
            expect(def.userInfoUrl).toBe('https://gitlab.com/api/v4/user');
        });

        it('honors a custom self-hosted base url', () => {
            const def = createGitLabProvider({ baseUrl: 'https://gitlab.acme.io/' });
            expect(def.authorizeUrl).toBe('https://gitlab.acme.io/oauth/authorize');
            expect(def.tokenUrl).toBe('https://gitlab.acme.io/oauth/token');
            expect(def.userInfoUrl).toBe('https://gitlab.acme.io/api/v4/user');
        });
    });

    describe('facebook', () => {
        it('extracts the nested picture URL', async () => {
            const user = await facebookProvider.normalizeUser(
                {
                    id: 'fb1',
                    name: 'Fb User',
                    email: 'fb@e.io',
                    picture: { data: { url: 'https://cdn/p.png' } },
                },
                { accessToken: 'at' },
            );
            expect(user.avatar).toBe('https://cdn/p.png');
            expect(user.id).toBe('fb1');
            expect(user.name).toBe('Fb User');
        });
    });

    describe('microsoft', () => {
        it('defaults to the common tenant', () => {
            const def = createMicrosoftProvider();
            expect(def.authorizeUrl).toContain('/common/oauth2/v2.0/authorize');
            expect(def.tokenUrl).toContain('/common/oauth2/v2.0/token');
        });

        it('honors a specific tenant', () => {
            const def = createMicrosoftProvider({ tenant: 'consumers' });
            expect(def.authorizeUrl).toContain('login.microsoftonline.com/consumers/');
        });

        it('prefers email from id_token preferred_username', async () => {
            const def = createMicrosoftProvider();
            const payload = btoa(
                JSON.stringify({
                    oid: 'oid-1',
                    email: 'jp@e.io',
                    preferred_username: 'pu@e.io',
                    name: 'Msft',
                }),
            );
            const idToken = `hdr.${payload}.sig`;
            const user = await def.normalizeUser({}, { accessToken: 'at', idToken });
            expect(user.id).toBe('oid-1');
            expect(user.email).toBe('jp@e.io'); // explicit email claim wins
            expect(user.name).toBe('Msft');
        });
    });
});

describe('defineOAuthProvider', () => {
    it('returns the definition unchanged', () => {
        const def: OAuthProviderDefinition = {
            id: 'custom',
            authorizeUrl: 'https://p/authorize',
            tokenUrl: 'https://p/token',
            userInfoUrl: 'https://p/me',
            scopes: ['x'],
            normalizeUser: (raw) => ({ id: String(raw.id), raw }),
        };
        expect(defineOAuthProvider(def)).toBe(def);
    });
});
