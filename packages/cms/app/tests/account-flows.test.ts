import { beforeAll, describe, expect, it, vi } from 'vitest';
import { contentModule, createCMS, DEFAULT_ROLES, systemPrincipal, type CmsHost } from '../../src/server/index';
import { live, romedbService } from '../../tests/helpers';

const state = vi.hoisted(() => ({ cms: undefined as CmsHost | undefined, c: undefined as unknown, sent: [] as { to: string; text: string }[] }));
vi.mock('../src/cms/index', () => ({ currentCms: () => state.cms, networkFor: () => ({ memberSites: async () => [{ id: 'main' }], main: { accounts: { memberships: async () => new Map() } }, sites: { getMany: async () => [] } }), siteUrl: () => undefined }));
vi.mock('@cossackframework/core', async original => ({ ...await original<typeof import('@cossackframework/core')>(), getRequestContext: () => state.c }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);
const { changeUserPassword } = await import('../src/services/users');
const { linkOrigin, loginUser, passwordMatches, registerUser, requestPasswordReset, SignInPendingError, verifyEmail } = await import('../src/auth');

/** A request to `url` with these bindings, as getRequestContext gives it. */
function request(url: string, bindings: Record<string, unknown> = {}, variables: Record<string, unknown> = {}) {
    const raw = new Request(url, { headers: variables.cookie ? { cookie: String(variables.cookie) } : {} });
    state.c = { env: bindings, req: { url, raw, header: (name: string) => raw.headers.get(name) ?? undefined }, get: (key: string) => key === 'site' ? { id: 'main' } : variables[key], set: () => undefined };
}

describe.skipIf(!live)('account flows', () => {
    const service = romedbService();
    beforeAll(async () => {
        state.cms = createCMS({ db: service.database(), modules: [contentModule], mail: { send: async message => { state.sent.push({ to: String(message.to), text: String(message.text) }); } } });
        expect((await state.cms.migrate()).failed).toBeUndefined();
        await state.cms.ready({ force: true });
        for (const role of DEFAULT_ROLES) await state.cms.users.defineRole(role);
    });

    it('points email links at the site\'s address, never the Host the request named', async () => {
        const cms = state.cms!;
        await cms.users.create({ email: 'reset@example.com', name: 'Reset', password: 'long password', roles: ['subscriber'] });
        request('https://evil.example/auth/forgot-password', { APP_URL: 'https://site.example' });
        expect(linkOrigin()).toBe('https://site.example');
        state.sent.length = 0;
        await requestPasswordReset('reset@example.com', 'https://evil.example');
        expect(state.sent).toHaveLength(1);
        expect(state.sent[0]!.text).toContain('https://site.example/auth/reset-password?token=');
        expect(state.sent[0]!.text).not.toContain('evil.example');
        // No address configured: only a request to this machine (development) has one.
        request('https://evil.example/auth/forgot-password');
        expect(linkOrigin()).toBeNull();
        state.sent.length = 0;
        await requestPasswordReset('reset@example.com');
        expect(state.sent).toHaveLength(0);
        request('http://localhost:5173/auth/forgot-password');
        expect(linkOrigin()).toBe('http://localhost:5173');
    });

    it('counts wrong current passwords per account, so a session cannot guess its way in', async () => {
        const cms = state.cms!;
        const user = await cms.users.create({ email: 'guess@example.com', name: 'Guess', password: 'right password', roles: ['editor'] });
        request('https://site.example/dashboard/users/x');
        // Right answers do not use up the allowance.
        for (let i = 0; i < 12; i++) expect(await passwordMatches(user.id, 'right password')).toBe(true);
        for (let i = 0; i < 10; i++) expect(await passwordMatches(user.id, `wrong ${i}`)).toBe(false);
        await expect(passwordMatches(user.id, 'right password')).rejects.toThrow(/Too many wrong passwords/);
    });

    it('activates only an account still waiting for its link, and lets an unconfirmed address register again', async () => {
        const cms = state.cms!;
        await cms.settings.update('general', { usersCanRegister: true, verifyEmail: true }, { principal: systemPrincipal('test') });
        request('https://site.example/auth/register', { APP_URL: 'https://site.example' });
        state.sent.length = 0;
        const first = await registerUser('new@example.com', 'long password', 'New');
        expect(first).toMatchObject({ verification: 'sent' });
        expect((await cms.accounts.findByEmail('new@example.com'))?.unconfirmed).toBe(true);
        // The link was missed: registering again replaces the waiting account and sends a new one.
        const again = await registerUser('new@example.com', 'another password', 'New');
        expect(again.id).not.toBe(first.id);
        expect(await cms.accounts.get(first.id)).toBeNull();
        const token = /verify\?token=([A-Za-z0-9_-]+)/.exec(state.sent.at(-1)!.text)![1]!;
        expect(await verifyEmail(token)).toMatchObject({ user: again.id, pending: false });
        expect((await cms.accounts.get(again.id))?.status).toBe('active');

        // An administrator disabled a waiting signup: its old link does not bring it back.
        const spam = await registerUser('spam@example.com', 'long password', 'Spam');
        const spamToken = /verify\?token=([A-Za-z0-9_-]+)/.exec(state.sent.at(-1)!.text)![1]!;
        await new Promise(resolve => setTimeout(resolve, 5));
        await cms.users.setStatus(spam.id, 'disabled');
        expect(await verifyEmail(spamToken)).toBeNull();
        expect((await cms.accounts.get(spam.id))?.status).toBe('disabled');
        // Nor does registering again replace it.
        await expect(registerUser('spam@example.com', 'long password', 'Spam')).rejects.toThrow(/already exists/);
    });

    it('refuses a registration it cannot send the confirmation link for, instead of activating it', async () => {
        const cms = state.cms!;
        await cms.settings.update('general', { usersCanRegister: true, verifyEmail: true }, { principal: systemPrincipal('test') });
        // Production without APP_URL: no address for the link.
        request('https://site.example/auth/register');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(registerUser('nolink@example.com', 'long password', 'No link')).rejects.toThrow(/not available/);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
        expect(await cms.accounts.findByEmail('nolink@example.com')).toBeNull();
    });

    it('tells an account waiting for approval so, once its password is right', async () => {
        const cms = state.cms!;
        const user = await cms.users.create({ email: 'waiting@example.com', name: 'Waiting', password: 'long password', roles: ['subscriber'] });
        await cms.users.holdForApproval(user.id, { verified: true });
        request('https://site.example/auth/login', { APP_URL: 'https://site.example' });
        await expect(loginUser('waiting@example.com', 'long password', '198.51.100.1')).rejects.toBeInstanceOf(SignInPendingError);
        expect(await loginUser('waiting@example.com', 'wrong password', '198.51.100.1')).toBeNull();
    });

    it('ends the account\'s other sessions when its password changes, keeping the caller\'s own', async () => {
        const cms = state.cms!;
        const user = await cms.users.create({ email: 'change@example.com', name: 'Change', password: 'long password', roles: ['subscriber'] });
        const mine = 'a'.repeat(64);
        const stolen = 'b'.repeat(64);
        for (const id of [mine, stolen]) await cms.authSessions.create({ id, userId: user.id, kind: 'auth', createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
        request('https://site.example/dashboard/profile', { APP_URL: 'https://site.example' }, { user: { id: user.id }, cookie: `session_id=${mine}` });
        await changeUserPassword(user.id, 'a new long password');
        expect(await cms.authSessions.read(mine)).not.toBeNull();
        expect(await cms.authSessions.read(stolen)).toBeNull();
        // Changed by someone else: every session ends.
        request('https://site.example/dashboard/users', { APP_URL: 'https://site.example' }, { user: { id: 'admin' } });
        await changeUserPassword(user.id, 'yet another password');
        expect(await cms.authSessions.read(mine)).toBeNull();
    });
});
