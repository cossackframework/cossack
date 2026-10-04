import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createOAuth, defineOAuthProvider, OAuthError } from '../src/index';
import { signCookieValue } from '../src/oauth/state';
import { memoryOAuthStates, mockFetch, restoreFetch } from './helpers';

const secret = 'fixture-state-secret-01234567890123456789';
const privateValue = 'PRIVATE_PROVIDER_PASSWORD_CODE_VERIFIER_DATABASE';
const definition = defineOAuthProvider({ id: 'fixture', authorizeUrl: 'https://provider.invalid/authorize',
    tokenUrl: 'https://provider.invalid/token', userInfoUrl: 'https://provider.invalid/user', scopes: [],
    normalizeUser: raw => ({ id: String(raw.id), raw }) });

function fixture(store = memoryOAuthStates().store, onUser = vi.fn(() => new Response(null, { status: 204 }))) {
    const provider = { clientId: 'fixture', clientSecret: privateValue, redirectUrl: '/callback' };
    const oauth = createOAuth({ secret, stateStore: store,
        providers: { fixture: provider, other: provider },
        customProviders: { fixture: definition, other: { ...definition, id: 'other' } } });
    const app = new Hono();
    app.get('/start', oauth.redirect('fixture'));
    app.get('/callback', oauth.callback('fixture', { onUser }));
    app.get('/other', oauth.callback('other', { onUser }));
    return { app, onUser, async begin() {
        const response = await app.request('/start');
        expect(response.status).toBe(302);
        const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
        const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
        return { state, cookie, callback: (route = '/callback') => app.request(`${route}?code=${privateValue}&state=${state}`, { headers: { cookie } }) };
    } };
}

afterEach(() => { restoreFetch(); vi.restoreAllMocks(); });

it('requires an atomic state store in cookie mode at both the type and runtime boundaries', () => {
    if (false) {
        // @ts-expect-error Cookie-based flows must supply stateStore.
        createOAuth({ secret, providers: {} });
    }
    for (const stateStore of [undefined, null, {}, { create() {} }, { consume() {} }]) {
        expect(() => createOAuth({ secret, stateStore, providers: {} } as never))
            .toThrowError(new OAuthError('COSSACK_OAUTH_STATE_STORE_INVALID'));
    }
    expect(() => createOAuth({ secret, stateless: true, stateStore: memoryOAuthStates().store, providers: {} } as never))
        .toThrowError(new OAuthError('COSSACK_OAUTH_STATE_STORE_INVALID'));
});

it.each([{ name: 'bad;name' }, { name: privateValue + '\r\nInjected' }, { path: '/;bad' }, { path: 'relative' },
    { name: '__Host-oauth', secure: true, path: '/account' }, { name: '__Secure-oauth', secure: false },
    { name: '__Host-oauth' }, { sameSite: 'none' as const, secure: false }])('rejects invalid cookie settings before state effects (%j)', cookie => {
    const { store } = memoryOAuthStates();
    expect(() => createOAuth({ secret, stateStore: store, providers: {}, cookie }))
        .toThrowError(new OAuthError('COSSACK_OAUTH_CONFIGURATION_INVALID'));
    expect(store.create).not.toHaveBeenCalled(); expect(store.consume).not.toHaveBeenCalled();
});

it('stores only a frozen provider-scoped digest and absolute expiry', async () => {
    const { store, rows } = memoryOAuthStates();
    const { begin } = fixture(store);
    const { state } = await begin();
    const record = [...rows.values()][0]!;
    expect(Object.isFrozen(record)).toBe(true);
    expect(record).toEqual({ key: expect.stringMatching(/^[0-9a-f]{64}$/), provider: 'fixture',
        createdAt: expect.any(Number), expiresAt: record.createdAt + 600000 });
    expect(JSON.stringify(record)).not.toContain(state);
    expect(JSON.stringify(record)).not.toContain(privateValue);
    expect(store.create).toHaveBeenCalledOnce();
});

it('allows one concurrent callback before token exchange and rejects later replay independently of provider code reuse', async () => {
    const { store, rows } = memoryOAuthStates();
    const { begin, onUser } = fixture(store);
    const { callback } = await begin();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const fetch = vi.fn(async (url: string) => {
        if (url.endsWith('/token')) {
            entered(); await gate;
            return Response.json({ access_token: privateValue });
        }
        return Response.json({ id: 'fixture-user' });
    });
    vi.stubGlobal('fetch', fetch);
    const first = callback();
    await started;
    try {
        const duplicate = await callback();
        expect(duplicate.status).toBe(400);
        expect(await duplicate.json()).toMatchObject({ code: 'COSSACK_OAUTH_STATE_UNAVAILABLE', stage: 'state' });
        expect(duplicate.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
        expect(fetch).toHaveBeenCalledOnce();
        expect(onUser).not.toHaveBeenCalled();
    } finally { release(); }
    expect((await first).status).toBe(204);
    expect((await callback()).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onUser).toHaveBeenCalledOnce();
    expect(rows.size).toBe(0);
});

it('binds stored state to its provider and does not consume the original flow through another provider', async () => {
    const { store, rows } = memoryOAuthStates();
    const { begin } = fixture(store);
    const { callback } = await begin();
    const fetch = mockFetch([{ body: { access_token: privateValue } }, { body: { id: 'fixture' } }]);
    expect((await callback('/other')).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows.size).toBe(1);
    expect((await callback()).status).toBe(204);
});

it('rejects signed cookies that have no server-side state record before provider I/O', async () => {
    const { app, onUser } = fixture();
    const fetch = mockFetch({ body: {} });
    const value = await signCookieValue({ state: 'unregistered', codeVerifier: privateValue }, secret);
    const response = await app.request(`/callback?code=${privateValue}&state=unregistered`,
        { headers: { cookie: `cossack_oauth_state=${value}` } });
    expect(await response.json()).toMatchObject({ code: 'COSSACK_OAUTH_STATE_UNAVAILABLE' });
    expect(fetch).not.toHaveBeenCalled(); expect(onUser).not.toHaveBeenCalled();
});

it('rejects expiry at the atomic store boundary even while the signed cookie remains valid', async () => {
    const { store, rows } = memoryOAuthStates();
    const { begin, onUser } = fixture(store);
    const { callback } = await begin();
    const record = [...rows.values()][0]!;
    rows.set(record.key, { ...record, expiresAt: Date.now() });
    const fetch = mockFetch({ body: {} });
    expect((await callback()).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled(); expect(onUser).not.toHaveBeenCalled();
});

it.each(['create', 'consume'] as const)('redacts state %s storage failures and issues no authenticated result', async stage => {
    const { store } = memoryOAuthStates();
    const { app, begin, onUser } = fixture(store);
    const flow = stage === 'consume' ? await begin() : null;
    vi.spyOn(store, stage).mockRejectedValue(new Error(privateValue));
    const fetch = mockFetch({ body: {} });
    const response = flow ? await flow.callback() : await app.request('/start');
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ code: stage === 'create' ? 'COSSACK_OAUTH_STATE_CREATE_FAILED' : 'COSSACK_OAUTH_STATE_CONSUME_FAILED',
        stage: stage === 'create' ? 'state-create' : 'state-consume' });
    expect(JSON.stringify(body)).not.toContain(privateValue);
    if (stage === 'create') expect(response.headers.get('set-cookie')).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); expect(onUser).not.toHaveBeenCalled();
});

it('never issues state cookies when persistence completes at expiry', async () => {
    const { store } = memoryOAuthStates();
    vi.spyOn(store, 'create').mockImplementation(async record => { vi.spyOn(Date, 'now').mockReturnValue(record.expiresAt); });
    const response = await fixture(store).app.request('/start');
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
});

it('rejects a consumed flow that reaches its signed deadline while storage completes', async () => {
    const { store, rows } = memoryOAuthStates();
    const { begin, onUser } = fixture(store);
    const { callback } = await begin();
    const record = [...rows.values()][0]!;
    vi.spyOn(store, 'consume').mockImplementation(async () => {
        rows.delete(record.key);
        vi.spyOn(Date, 'now').mockReturnValue(record.expiresAt); return true;
    });
    const fetch = mockFetch({ body: {} });
    expect((await callback()).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled(); expect(onUser).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
});

it.each(['exchange', 'mapping'] as const)('keeps state consumed after a failed %s and prevents repeating side effects', async stage => {
    const { store } = memoryOAuthStates();
    const onUser = vi.fn(() => { throw new Error(privateValue); });
    const { begin } = fixture(store, onUser);
    const { callback } = await begin();
    const fetch = mockFetch(stage === 'exchange' ? { status: 401, body: privateValue } :
        [{ body: { access_token: privateValue } }, { body: { id: privateValue } }]);
    const first = await callback();
    expect(await first.json()).toMatchObject({ code: stage === 'exchange' ? 'COSSACK_OAUTH_TOKEN_EXCHANGE_FAILED' : 'COSSACK_OAUTH_ACCOUNT_MAPPING_FAILED' });
    const second = await callback();
    expect(await second.json()).toMatchObject({ code: 'COSSACK_OAUTH_STATE_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(stage === 'exchange' ? 1 : 2);
    expect(onUser).toHaveBeenCalledTimes(stage === 'exchange' ? 0 : 1);
});

it('rejects truthy non-boolean consumption results', async () => {
    const { store } = memoryOAuthStates();
    const { begin } = fixture(store);
    const { callback } = await begin();
    vi.spyOn(store, 'consume').mockResolvedValue('yes' as unknown as boolean);
    const fetch = mockFetch({ body: {} });
    expect((await callback()).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
});

it.each(['__Host-oauth-state', '__Secure-oauth-state'])('clears a prefixed Secure cookie after success and early rejection (%s)', async name => {
    const { store } = memoryOAuthStates();
    const oauth = createOAuth({ secret, stateStore: store, cookie: { name, secure: true, path: '/' },
        providers: { fixture: { clientId: 'fixture', clientSecret: privateValue, redirectUrl: '/callback' } },
        customProviders: { fixture: definition } });
    const app = new Hono();
    app.get('/start', oauth.redirect('fixture'));
    app.get('/callback', oauth.callback('fixture', { onUser: () => new Response(null, { status: 204 }) }));
    const redirect = await app.request('https://app.test/start');
    expect(redirect.status).toBe(302);
    const state = new URL(redirect.headers.get('location')!).searchParams.get('state')!;
    const cookie = redirect.headers.get('set-cookie')!.split(';')[0]!;
    const denied = await app.request('https://app.test/callback?error=access_denied', { headers: { cookie } });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('set-cookie')).toContain(`${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
    mockFetch([{ body: { access_token: privateValue } }, { body: { id: 'fixture-user' } }]);
    const accepted = await app.request(`https://app.test/callback?code=fixture&state=${state}`, { headers: { cookie } });
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get('set-cookie')).toContain(`${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
});

it('retains application cookies and streaming bodies while clearing state on a raw success Response', async () => {
    const { store } = memoryOAuthStates();
    const headers = new Headers();
    headers.append('Set-Cookie', 'first=one; HttpOnly');
    headers.append('Set-Cookie', 'second=two; HttpOnly');
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('fixture-stream')); controller.close(); } });
    const onUser = vi.fn(() => new Response(stream, { status: 201, headers }));
    const { begin } = fixture(store, onUser);
    const { callback } = await begin();
    mockFetch([{ body: { access_token: privateValue } }, { body: { id: 'fixture-user' } }]);
    const response = await callback();
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual(['first=one; HttpOnly', 'second=two; HttpOnly',
        'cossack_oauth_state=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax']);
    expect(await response.text()).toBe('fixture-stream');
});

it('clears state on an immutable custom error redirect without losing its status or Location', async () => {
    const oauth = createOAuth({ secret, stateStore: memoryOAuthStates().store,
        providers: { fixture: { clientId: 'fixture', clientSecret: privateValue, redirectUrl: '/callback' } },
        customProviders: { fixture: definition } });
    const app = new Hono();
    app.get('/callback', oauth.callback('fixture', { onUser: vi.fn(),
        onError: () => Response.redirect('https://app.test/login', 303) }));
    const response = await app.request('https://app.test/callback?error=access_denied');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://app.test/login');
    expect(response.headers.getSetCookie()).toEqual(['cossack_oauth_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax']);
});
