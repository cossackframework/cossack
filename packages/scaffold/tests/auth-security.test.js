import { describe, expect, it, vi } from 'vitest';
import { transformSync } from 'esbuild';
import { renderRecipe, resolveRecipe } from '../src/index.js';
import { OAuthError } from '../../auth/src/index.ts';

async function generatedAuth() {
  const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'auth', oauth: 'github' }));
  const source = files.get('src/auth.ts').content.toString();
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
  const Session = { findOne: vi.fn(), delete: vi.fn(async () => ({ meta: { rowsAffected: 1 } })), insert: vi.fn() };
  const User = { findOne: vi.fn(), insert: vi.fn(), update: vi.fn() };
  const OAuthAccount = { findOne: vi.fn(), insert: vi.fn() };
  let provider;
  const createSession = vi.fn();
  const modules = {
    'hono/cookie': { getCookie: vi.fn() },
    '@cossackframework/auth': { createAuth: (options) => { provider = options; return { createSession }; }, createOAuth: vi.fn(), OAuthError },
    '@cossackframework/database': { MoreThan: (value) => value, Not: (value) => value, sql: vi.fn() },
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
  return { api: module.exports, provider, Session, User, OAuthAccount, createSession };
}

describe('generated auth security', () => {
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
    Session.findOne.mockResolvedValue({ userId: 'member', meta: { type: 'auth' } });
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
