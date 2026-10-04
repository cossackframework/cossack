import { afterEach, describe, expect, it, vi } from 'vitest';
import { transformSync } from 'esbuild';
import { renderRecipe, resolveRecipe } from '../src/index.js';
import { OAuthError, createCredentialVerifier, createSessionManager, hashPassword, verifyPassword } from '../../auth/src/index.ts';
import { input, isClientVisibleError, ClientVisibleError } from '../../core/dist/index.js';

afterEach(() => vi.unstubAllGlobals());

async function generatedAuth() {
  const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'auth', oauth: 'github',
    features: ['dashboard'], dashboardModules: ['sessions'] }));
  const source = files.get('src/auth.ts').content.toString();
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
  const Session = { find: vi.fn(), findOne: vi.fn(), delete: vi.fn(async () => ({ meta: { rowsAffected: 1 } })), insert: vi.fn() };
  Session.findOne.mockResolvedValue(sessionRow({ id: ownerContext().cookie }));
  const sql = vi.fn(async () => ({ rows: [], meta: { rowsAffected: 1 } }));
  const User = { findOne: vi.fn(), insert: vi.fn(), update: vi.fn() };
  const OAuthAccount = { findOne: vi.fn(), insert: vi.fn() };
  let provider;
  const createSession = vi.fn();
  const modules = {
    'hono/cookie': { getCookie: c => c?.cookie },
    '@cossackframework/auth': { createAuth: (options) => { provider = options; return { createSession }; }, createOAuth: vi.fn(), OAuthError,
      createCredentialVerifier, createSessionManager, hashPassword, verifyPassword },
    '@cossackframework/database': { MoreThan: (value) => value, sql },
    '@cossackframework/core': { ClientVisibleError: Error },
    '@/lib/uuid': { uuidv7: () => 'generated-id' },
    '@/models/User': { User },
    '@/models/Session': { Session },
    '@/models/OAuthAccount': { OAuthAccount },
  };
  const module = { exports: {} };
  // Execute the generated module, with only its database/provider boundary mocked.
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
    return modules[name];
  }, module, module.exports);
  return { api: module.exports, provider, Session, User, OAuthAccount, createSession, sql, files };
}

const ownerContext = () => ({ cookie: 'CURRENT_PRIVATE_BEARER', get: () => ({ id: 'member' }),
  req: { header: () => undefined, raw: new Request('http://localhost/') } });
const sessionRow = (overrides = {}) => ({ id: 'PRIVATE_AUTH_BEARER', publicId: crypto.randomUUID(), userId: 'member',
  createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60000), meta: { type: 'auth' },
  location: null, userAgent: null, ipAddress: null, data: { credential: 'PRIVATE_SESSION_DATA' }, ...overrides });

function generatedSessionsPage(files, api) {
  // Decorators and rendering are irrelevant to exercising the generated methods.
  // Native acceptance separately verifies the real SSR/RPC authorization boundary.
  const source = files.get('src/pages/dashboard/sessions/index.ts')?.content.toString();
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@cossackframework/core') return { Cossack: class {}, Page: () => () => {}, State: () => () => {}, Server: () => () => {} };
    if (name === '../../../auth') return api;
    if (name === 'hono/cookie') return { getCookie: c => c?.cookie };
    if (name === '@cossackframework/ui' || name.startsWith('@cossackframework/solar-icons/')) return {};
    if (name === '@cossackframework/renderer') return {};
    throw new Error(`Unexpected page dependency: ${name}`);
  }, module, module.exports);
  return new module.exports.default();
}

function generatedFormPage(files, name, api) {
  const module = { exports: {} };
  const schemaModule = { exports: {} };
  const schemaCode = transformSync(files.get('src/auth-input.ts').content.toString(), { loader: 'ts', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', schemaCode)(() => ({ input }), schemaModule, schemaModule.exports);
  const code = transformSync(files.get(`src/pages/auth/${name}/index.ts`).content.toString(), { loader: 'ts', format: 'cjs',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } }).code;
  const decorator = () => () => {};
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@cossackframework/core') return { Cossack: class {}, isClientVisibleError, ClientVisibleError, storeRules: v => v,
      Page: decorator, State: decorator, ClientState: decorator, ClientStore: decorator,
      Validate: decorator, Client: decorator, Server: decorator };
    if (name === '../../../auth') return api;
    if (name === '../../../auth-input') return schemaModule.exports;
    if (name === '@cossackframework/ui' || name === '@cossackframework/renderer') return {};
    throw new Error(`Unexpected form dependency: ${name}`);
  }, module, module.exports);
  const page = new module.exports.default();
  page.c = { header: vi.fn(), req: { url: 'https://fixture.test/auth/login', query: () => 'fixture-token' } };
  page.redirect = vi.fn();
  return page;
}

describe('generated auth security', () => {
  it('creates an independent management reference without changing the auth purpose', async () => {
    const { api, Session } = await generatedAuth();
    const created = await api.authSessions.create('member', ownerContext());
    const row = Session.insert.mock.calls[0][0];
    expect(row.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.publicId).not.toBe(created.session.id);
    expect(row.id).toBe(created.session.id);
    expect(row.meta).toEqual({ type: 'auth' });
    expect(created.headers.get('set-cookie')).not.toContain(row.publicId);
  });

  it('lists safe references and excludes credentials, storage data, other owners and token purposes', async () => {
    const { api, Session } = await generatedAuth();
    const current = sessionRow({ id: ownerContext().cookie, meta: { type: 'auth', credential: 'PRIVATE_META' } });
    Session.find.mockResolvedValue([current, sessionRow({ meta: { type: 'password_reset' } }),
      sessionRow({ meta: { type: 'oauth_state' } }), sessionRow({ userId: 'victim' }), sessionRow({ expiresAt: new Date(0) })]);
    expect(await api.listUserSessions(ownerContext())).toEqual([{ reference: current.publicId,
      createdAt: current.createdAt.toISOString(), expiresAt: current.expiresAt.toISOString(), current: true,
      location: null, userAgent: null, ipAddress: null }]);
    expect(JSON.stringify(await api.listUserSessions(ownerContext()))).not.toContain('PRIVATE');
  });

  it('conditionally assigns legacy references and reads the winner from storage', async () => {
    const { api, Session, sql } = await generatedAuth();
    const legacy = sessionRow({ publicId: null });
    const winner = { ...legacy, publicId: crypto.randomUUID() };
    Session.find.mockResolvedValue([legacy]);
    sql.mockResolvedValue({ meta: { rowsAffected: 0 } }); // Another listing won.
    Session.findOne.mockResolvedValue(winner);
    expect((await api.listUserSessions(ownerContext()))[0].reference).toBe(winner.publicId);
    expect(sql.mock.calls[0][0].join('?')).toContain('public_id IS NULL');
    Session.findOne.mockResolvedValue(null); // Rotation/revocation won before re-read.
    expect(await api.listUserSessions(ownerContext())).toEqual([]);
  });

  it('rejects a stored bearer token as the public reference', async () => {
    const { api, Session } = await generatedAuth();
    const id = crypto.randomUUID();
    Session.find.mockResolvedValue([sessionRow({ id, publicId: id })]);
    await expect(api.listUserSessions(ownerContext())).rejects.toThrow('Invalid session management reference.');
  });

  it('requires the trusted request actor for listing and every revocation', async () => {
    const { api, Session, sql } = await generatedAuth();
    for (const context of [{ cookie: 'token', get: () => undefined }, { get: () => ({ id: 'member' }) }]) {
      await expect(api.listUserSessions(context)).rejects.toThrow('Sign in');
      await expect(api.revokeSession(context, crypto.randomUUID())).rejects.toThrow('Sign in');
      await expect(api.revokeAllUserSessions(context)).rejects.toThrow('Sign in');
    }
    expect(Session.find).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });

  it('rejects bearer-shaped revoke input and scopes accepted references in one SQL operation', async () => {
    const { api, sql, Session } = await generatedAuth();
    expect(await api.revokeSession(ownerContext(), 'PRIVATE_AUTH_BEARER')).toBe(false);
    expect(await api.revokeSession(ownerContext(), { reference: crypto.randomUUID() })).toBe(false);
    expect(sql).not.toHaveBeenCalled();
    const reference = crypto.randomUUID();
    expect(await api.revokeSession(ownerContext(), reference)).toBe(true);
    const current = await Session.findOne();
    expect(sql.mock.calls[0].slice(1, 6)).toEqual([reference, 'member', ownerContext().cookie, current.publicId, '{"type":"auth"}']);
    sql.mockResolvedValue({ meta: { rowsAffected: 0 } });
    expect(await api.revokeSession(ownerContext(), reference)).toBe(false);
  });

  it.each(['init', 'revoke', 'revokeAllExceptCurrent', 'revokeAll'])('keeps storage failures out of dashboard %s state', async method => {
    const { api, files, Session, sql } = await generatedAuth();
    Session.find.mockRejectedValue(new Error('PRIVATE_DATABASE_PASSWORD'));
    sql.mockRejectedValue(new Error('PRIVATE_DATABASE_PASSWORD'));
    const page = generatedSessionsPage(files, api);
    page.c = ownerContext();
    await page[method](crypto.randomUUID());
    expect(page.error).toBe(method === 'init' ? 'Could not load sessions.'
      : method === 'revoke' ? 'Could not revoke session.' : 'Could not revoke sessions.');
    expect(JSON.stringify({ error: page.error, sessions: page.sessions })).not.toContain('PRIVATE_DATABASE_PASSWORD');
  });

  it('keeps rotation failures out of page state and only redirects after applying the replacement cookie', async () => {
    const { files } = await generatedAuth();
    const rotate = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_STORAGE')).mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ headers: new Headers({ 'set-cookie': 'replacement' }) });
    const page = generatedSessionsPage(files, { authSessions: { cookieName: 'session_id', rotate } });
    page.c = { ...ownerContext(), header: vi.fn() }; page.redirect = vi.fn();
    for (let i = 0; i < 2; i++) {
      await page.rotateCurrent();
      expect(page.error).toBe('Could not rotate session. Try again.');
      expect(page.c.header).not.toHaveBeenCalled(); expect(page.redirect).not.toHaveBeenCalled();
    }
    await page.rotateCurrent();
    expect(rotate).toHaveBeenLastCalledWith(ownerContext().cookie, page.c);
    expect(page.error).toBe(''); expect(page.c.header).toHaveBeenCalledWith('set-cookie', 'replacement');
    expect(page.redirect).toHaveBeenCalledWith('/dashboard/sessions');
    expect(page.c.header.mock.invocationCallOrder[0]).toBeLessThan(page.redirect.mock.invocationCallOrder[0]);
  });

  it.each([
    ['login', 'login', { email: 'invalid', password: 'short' }, 'loginUser'],
    ['login', 'login', { email: 'a'.repeat(180) + '@example.test', password: 'valid-password' }, 'loginUser'],
    ['register', 'register', { name: '', email: 'valid@example.test', password: '🙂'.repeat(257) }, 'registerUser'],
    ['forgot-password', 'requestReset', { email: ['invalid'] }, 'requestPasswordReset'],
    ['reset-password', 'doReset', { token: '', password: 'valid-password' }, 'resetPassword'],
  ])('validates native generated %s calls before touching credentials or storage', async (name, method, submitted, helper) => {
    const { files } = await generatedAuth();
    const api = { [helper]: vi.fn() };
    const page = generatedFormPage(files, name, api);
    await expect(page[method](submitted)).rejects.toThrow();
    expect(api[helper]).not.toHaveBeenCalled(); expect(page.c.header).not.toHaveBeenCalled();
  });

  it.each([
    ['login', 'login', { email: 'valid@example.test', password: 'valid-password' }, 'loginUser', 'Could not sign in. Try again.'],
    ['register', 'register', { name: '', email: 'valid@example.test', password: 'valid-password' }, 'registerUser', 'Could not create the account. Try again or sign in.'],
    ['reset-password', 'doReset', { token: 'token', password: 'valid-password' }, 'resetPassword', 'Could not reset the password. Request a new reset link.'],
  ])('redacts storage failures in the actual generated %s method', async (name, method, submitted, helper, message) => {
    const { files } = await generatedAuth();
    const page = generatedFormPage(files, name, { [helper]: vi.fn().mockRejectedValue(new Error('PRIVATE_DATABASE')) });
    await page[method](submitted);
    expect(page.error).toBe(message); expect(page.c.header).not.toHaveBeenCalled(); expect(page.redirect).not.toHaveBeenCalled();
  });

  it('only preserves the known duplicate account error and does not copy arbitrary visible errors', async () => {
    const { files } = await generatedAuth();
    const registerUser = vi.fn().mockRejectedValueOnce(new ClientVisibleError('An account with this email already exists.'))
      .mockRejectedValueOnce(new ClientVisibleError('PRIVATE_VISIBLE_ERROR'));
    const page = generatedFormPage(files, 'register', { registerUser });
    const data = { name: '', email: 'valid@example.test', password: 'valid-password' };
    await page.register(data); expect(page.error).toBe('An account with this email already exists.');
    await page.register(data); expect(page.error).toBe('Could not create the account. Try again or sign in.');
  });

  it('discards reset-request storage exceptions at the server boundary', async () => {
    const { files } = await generatedAuth();
    const page = generatedFormPage(files, 'forgot-password', {
      requestPasswordReset: vi.fn().mockRejectedValue(new Error('PRIVATE_DATABASE')),
    });
    await expect(page.requestReset({ email: 'valid@example.test' }))
      .rejects.toThrow('Could not send the reset link. Try again.');
  });

  it.each(['login', 'register', 'forgot-password', 'reset-password'])('retains a browser draft and fixed feedback after a failed %s request', async name => {
    const { files } = await generatedAuth();
    const page = generatedFormPage(files, name, {});
    page.form = { name: 'Draft', email: 'draft@example.test', password: 'PRIVATE_DRAFT' };
    page.validateAll = vi.fn().mockResolvedValue(true);
    for (const method of ['login', 'register', 'requestReset', 'doReset']) page[method] = vi.fn().mockRejectedValue(new Error('PRIVATE_TRANSPORT'));
    await page.handleSubmit({ preventDefault() {} });
    expect(page.error).not.toContain('PRIVATE_TRANSPORT'); expect(page.error).toMatch(/^Could not /);
    expect(page.form.password).toBe('PRIVATE_DRAFT');
    if (name === 'forgot-password') expect(page.submitted).toBe(false);
  });

  it('protects the current stable reference during bulk revocation and rejects an already-rotated caller', async () => {
    const { api, Session, sql } = await generatedAuth();
    const current = await Session.findOne();
    await api.revokeAllUserSessions(ownerContext(), true);
    expect(sql.mock.calls[0].slice(1)).toEqual(['member', ownerContext().cookie, current.publicId, '{"type":"auth"}']);
    Session.findOne.mockResolvedValue(null);
    sql.mockClear();
    await expect(api.revokeSession(ownerContext(), crypto.randomUUID())).rejects.toThrow('Sign in');
    await expect(api.revokeAllUserSessions(ownerContext(), true)).rejects.toThrow('Sign in');
    expect(sql).not.toHaveBeenCalled();
  });

  it('clears an earlier dashboard error after successful revocation', async () => {
    const { api, files, Session } = await generatedAuth();
    Session.find.mockResolvedValue([]);
    const page = generatedSessionsPage(files, api);
    page.c = ownerContext(); page.error = 'Previous failure';
    await page.revoke(crypto.randomUUID());
    expect(page.error).toBe('');
    expect(page.sessions).toEqual([]);
  });

  it.each(['redirect', 'callback'])('uses library configuration diagnostics for the generated OAuth %s route', async method => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { api } = await generatedAuth();
      const context = { env: { GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: 'PRIVATE_PROVIDER_SECRET', OAUTH_SECRET: 'fixture-state-secret-0123456789' },
        json: (body, status) => Response.json(body, { status }) };
      const response = await api.oauth[method]('github', { onUser() {} })(context);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({ code: 'COSSACK_OAUTH_CREDENTIALS_MISSING', stage: 'configuration' });
      expect(JSON.stringify(body)).not.toContain('PRIVATE_PROVIDER_SECRET');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PROVIDER_SECRET');
      expect(warn.mock.calls[0][1]).toEqual(new OAuthError('COSSACK_OAUTH_CREDENTIALS_MISSING').toJSON());
    } finally { warn.mockRestore(); }
  });
  it('keeps session database exceptions out of generated warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { provider, Session, User } = await generatedAuth();
      Session.findOne.mockRejectedValue(new Error('PRIVATE_DATABASE_PASSWORD_TOKEN'));
      User.findOne.mockRejectedValue(new Error('PRIVATE_DATABASE_PASSWORD_TOKEN'));
      expect(await provider.validateSessionId('fixture')).toBeNull();
      expect(await provider.resolveUserById('fixture')).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_DATABASE_PASSWORD_TOKEN');
      expect(warn.mock.calls[0][0]).toContain('pnpm migrate');
    } finally { warn.mockRestore(); }
  });
  it('does not accept reset tokens as login sessions', async () => {
    const { provider, Session } = await generatedAuth();
    for (const meta of [{ type: 'password_reset' }, null, '{', { type: 'unknown' }]) {
      Session.findOne.mockResolvedValue({ userId: 'victim', meta });
      expect(await provider.validateSessionId('reset-token')).toBeNull();
    }
    Session.findOne.mockResolvedValue({ id: 'session', userId: 'member', meta: { type: 'auth' },
      createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 10000) });
    expect(await provider.validateSessionId('session')).toBe('member');
  });

  it('rejects login sessions as reset tokens without deleting them', async () => {
    const { api, Session, User } = await generatedAuth();
    Session.findOne.mockResolvedValue({ userId: 'member', meta: { type: 'auth' } });
    expect(await api.resetPassword('login-session', 'new-password')).toBe(false);
    expect(Session.delete).not.toHaveBeenCalled();
    expect(User.update).not.toHaveBeenCalled();
  });

  it('allows only one reset when the same token is consumed concurrently and revokes sessions', async () => {
    const { api, Session, User } = await generatedAuth();
    Session.findOne.mockResolvedValue({ userId: 'member', meta: { type: 'password_reset' } });
    Session.delete.mockResolvedValueOnce({ meta: { rowsAffected: 1 } }).mockResolvedValueOnce({ meta: { rowsAffected: 0 } });
    const results = await Promise.all([api.resetPassword('reset', 'password-one'), api.resetPassword('reset', 'password-two')]);
    expect(results.sort()).toEqual([false, true]);
    expect(User.update).toHaveBeenCalledOnce();
    expect(Session.delete).toHaveBeenCalledWith({ userId: 'member' });
  });

  it('does not link an unrecognized OAuth identity to an existing email account', async () => {
    const { api, OAuthAccount, User, createSession } = await generatedAuth();
    OAuthAccount.findOne.mockResolvedValue(null);
    User.findOne.mockResolvedValue({ id: 'victim', email: 'victim@example.com' });
    await expect(api.handleOAuthUser('github', { id: 'attacker', email: 'victim@example.com' }, {}, {}))
      .rejects.toThrow('before linking');
    expect(OAuthAccount.insert).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(User.insert).not.toHaveBeenCalled();
  });
});
