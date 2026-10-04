import { describe, expect, it, vi } from 'vitest';
import { transformSync } from 'esbuild';
import { renderRecipe, resolveRecipe } from '../src/index.js';
import { OAuthError, createCredentialVerifier, createSessionManager, hashPassword, verifyPassword } from '../../auth/src/index.ts';

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
    if (name === '@cossackframework/ui' || name.startsWith('@cossackframework/solar-icons/')) return {};
    if (name === '@cossackframework/renderer') return {};
    throw new Error(`Unexpected page dependency: ${name}`);
  }, module, module.exports);
  return new module.exports.default();
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
