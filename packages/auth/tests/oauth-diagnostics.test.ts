import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createOAuth, defineOAuthProvider, OAuthError, type OAuthErrorCallback, type OAuthProviderDefinition, type OAuthUserCallback } from '../src/index';
import { exchangeCode, fetchUserInfo, parseTokenResponse } from '../src/oauth/flow';
import { signCookieValue } from '../src/oauth/state';
import { mockFetch, restoreFetch } from './helpers';

const secret = 'fixture-state-secret-01234567890123456789';
const privateValue = 'PRIVATE_PASSWORD_TOKEN_CLIENT_SECRET';
const provider = defineOAuthProvider({
    id: 'fixture', authorizeUrl: 'https://provider.invalid/authorize',
    tokenUrl: 'https://provider.invalid/token', userInfoUrl: 'https://provider.invalid/user',
    scopes: [],
    normalizeUser: raw => ({ id: String(raw.id), raw }),
});
const config = { clientId: 'fixture-id', clientSecret: privateValue, redirectUrl: '/callback' };

function fixture(options: { definition?: OAuthProviderDefinition; onUser?: OAuthUserCallback; onError?: OAuthErrorCallback } = {}) {
    const onUser = options.onUser ?? vi.fn();
    const oauth = createOAuth({ secret, providers: { fixture: config }, customProviders: { fixture: options.definition ?? provider } });
    const app = new Hono();
    app.get('/start', oauth.redirect('fixture'));
    app.get('/callback', oauth.callback('fixture', { onUser, onError: options.onError }));
    return { app, onUser, async callback() {
        const redirect = await app.request('/start');
        expect(redirect.status).toBe(302);
        const state = new URL(redirect.headers.get('location')!).searchParams.get('state')!;
        const cookie = redirect.headers.get('set-cookie')!.split(';')[0];
        return app.request(`/callback?code=${privateValue}&state=${state}`, { headers: { cookie } });
    } };
}

afterEach(() => { restoreFetch(); vi.restoreAllMocks(); });

it.each(['clientId', 'clientSecret', 'redirectUrl'] as const)('identifies missing %s configuration without echoing its values', field => {
    const oauth = createOAuth({ secret, providers: { fixture: { ...config, [field]: '' } }, customProviders: { fixture: provider } });
    expect(() => oauth.redirect('fixture')).toThrowError(new OAuthError('COSSACK_OAUTH_CREDENTIALS_MISSING'));
});

it('keeps unknown provider names and resolved-secret exceptions out of diagnostics', async () => {
    const oauth = createOAuth({ secret, providers: {} });
    let failure: unknown;
    try { oauth.redirect(privateValue); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'COSSACK_OAUTH_PROVIDER_UNKNOWN', stage: 'configuration', status: 500 });
    expect(String(failure)).not.toContain(privateValue);
    const app = new Hono();
    const failing = createOAuth({ secret: () => { throw new Error(privateValue); }, providers: { fixture: config }, customProviders: { fixture: provider } });
    app.get('/start', failing.redirect('fixture'));
    const response = await app.request('/start');
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'COSSACK_OAUTH_SECRET_INVALID', stage: 'configuration' });
});

it.each([
    ['/callback', 'COSSACK_OAUTH_CALLBACK_INVALID', 400],
    [`/callback?error=access_denied&error_description=${privateValue}`, 'COSSACK_OAUTH_CONSENT_DENIED', 403],
    [`/callback?error=${privateValue}&error_description=${privateValue}`, 'COSSACK_OAUTH_PROVIDER_DENIED', 502],
] as const)('clears the matching cookie for rejected callback %s without provider I/O', async (url, code, status) => {
    const fetch = mockFetch({ body: {} });
    const { app, onUser } = fixture();
    const response = await app.request(url, { headers: { cookie: `cossack_oauth_state=${privateValue}` } });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ code, stage: 'callback', status });
    expect(JSON.stringify(body)).not.toContain(privateValue);
    expect(response.headers.get('set-cookie')).toMatch(/cossack_oauth_state=;.*Max-Age=0/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(onUser).not.toHaveBeenCalled();
});

it('rejects expired signed state before exchanging credentials', async () => {
    const fetch = mockFetch({ body: {} });
    const { app, onUser } = fixture();
    const cookie = await signCookieValue({ state: 'expired', codeVerifier: privateValue }, secret, -1);
    const response = await app.request('/callback?code=fixture&state=expired', { headers: { cookie: `cossack_oauth_state=${cookie}` } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'COSSACK_OAUTH_STATE_INVALID', stage: 'state' });
    expect(fetch).not.toHaveBeenCalled();
    expect(onUser).not.toHaveBeenCalled();
});

it.each(['token', 'profile'] as const)('cancels failed %s response bodies and exposes only numeric provider status', async stage => {
    const cancel = vi.fn();
    const failed = new Response(new ReadableStream({ cancel }), { status: 401, statusText: privateValue });
    const fetch = vi.fn().mockResolvedValue(failed);
    vi.stubGlobal('fetch', fetch);
    const promise = stage === 'token'
        ? exchangeCode({ definition: provider, config, code: privateValue, redirectUrl: config.redirectUrl })
        : fetchUserInfo({ definition: provider, tokens: { accessToken: privateValue } });
    const failure = await promise.catch(error => error);
    expect(failure).toBeInstanceOf(OAuthError);
    expect(failure).toMatchObject({ stage: stage === 'token' ? 'token-exchange' : 'user-info', providerStatus: 401, status: 502 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(failure)).not.toContain(privateValue);
    expect(failure.stack).not.toContain(privateValue);
    expect(failure.cause).toBeUndefined();
});

it.each(['null', '[]', '"private"', '{}', '{"access_token":""}', '{"access_token":"   "}'])('rejects malformed token shape %s with the stable diagnostic', body => {
    expect(() => parseTokenResponse(body)).toThrowError(new OAuthError('COSSACK_OAUTH_TOKEN_EXCHANGE_FAILED'));
});

it('sanitizes network failures before custom onError runs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(privateValue, { cause: { password: privateValue } })));
    const onError = vi.fn<OAuthErrorCallback>((error, c) => {
        expect(error).toBeInstanceOf(OAuthError);
        expect(Object.isFrozen(error)).toBe(true);
        expect(error.cause).toBeUndefined();
        expect(error.stack).not.toContain(privateValue);
        return c.json(error.toJSON(), error.status);
    });
    const { callback, onUser } = fixture({ onError });
    const response = await callback();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'COSSACK_OAUTH_TOKEN_EXCHANGE_FAILED', stage: 'token-exchange' });
    expect(JSON.stringify(body)).not.toContain(privateValue);
    expect(onError).toHaveBeenCalledOnce();
    expect(onUser).not.toHaveBeenCalled();
});

it('sanitizes profile normalization errors before invoking application mapping', async () => {
    mockFetch([{ body: { access_token: privateValue } }, { body: { id: 'fixture' } }]);
    const { callback, onUser } = fixture({ definition: { ...provider, normalizeUser: () => { throw new Error(privateValue); } } });
    const response = await callback();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'COSSACK_OAUTH_USER_INFO_FAILED', stage: 'user-info' });
    expect(JSON.stringify(body)).not.toContain(privateValue);
    expect(onUser).not.toHaveBeenCalled();
});

it('identifies application account/session mapping failures without retaining user or token data', async () => {
    mockFetch([{ body: { access_token: privateValue, refresh_token: privateValue } }, { body: { id: privateValue } }]);
    const onUser = vi.fn(() => { throw new Error(privateValue); });
    const { callback } = fixture({ onUser });
    const response = await callback();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'COSSACK_OAUTH_ACCOUNT_MAPPING_FAILED', stage: 'account-mapping' });
    expect(JSON.stringify(body)).not.toContain(privateValue);
    expect(onUser).toHaveBeenCalledOnce();
});

it('contains a failing application error handler without Hono logging its thrown value', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = fixture({ onError: () => { throw new Error(privateValue); } });
    const response = await app.request('/callback');
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'COSSACK_OAUTH_ERROR_HANDLER_FAILED', stage: 'error-handler' });
    expect(JSON.stringify(body)).not.toContain(privateValue);
    expect(log).not.toHaveBeenCalled();
});
