import { beforeAll, describe, expect, it, vi } from 'vitest';
import { contentModule, createCMS, DEFAULT_ROLES, systemPrincipal, type CmsHost } from '../../src/server/index';
import { live, romedbService } from '../../tests/helpers';

const state = vi.hoisted(() => ({ cms: undefined as CmsHost | undefined, c: undefined as unknown }));
vi.mock('../src/cms/index', () => ({ currentCms: () => state.cms, networkFor: () => ({ memberSites: async () => [{ id: 'main' }], main: { accounts: { memberships: async () => new Map() } }, sites: { get: async () => null } }) }));
vi.mock('../src/cms/handoff', () => ({ handoffSite: async () => null, pendingSite: async () => null }));
vi.mock('@cossackframework/core', async original => ({ ...await original<typeof import('@cossackframework/core')>(), getRequestContext: () => state.c }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('config', (key: string) => key === 'auth.redirectAfterLogin' ? '/dashboard' : '/auth/login');
vi.stubGlobal('__', (text: string) => text);
const { handleOAuthUser, loginUser, oauthProvider } = await import('../src/auth');
const { authOptions } = await import('../src/auth-options');

/** The callback's request, as the provider's redirect arrives: no session yet. */
function callback() {
    const raw = new Request('https://site.example/auth/github/callback');
    const headers = new Headers();
    const variables = new Map<string, unknown>([['site', { id: 'main' }], ['cms', state.cms]]);
    const c = {
        env: { APP_URL: 'https://site.example' }, headers,
        req: { url: raw.url, raw, path: '/auth/github/callback', method: 'GET', header: (name: string) => raw.headers.get(name) ?? undefined },
        get: (key: string) => variables.get(key), set: (key: string, value: unknown) => { variables.set(key, value); },
        header: (name: string, value: string, options?: { append?: boolean }) => { if (options?.append) headers.append(name, value); else headers.set(name, value); },
        redirect: (location: string) => new Response(null, { status: 302, headers: { location } }),
    };
    state.c = c;
    return c;
}
const signIn = async (user: { email?: string | null; emailVerified?: boolean; name?: string }) => {
    const c = callback();
    const response = await handleOAuthUser('github', { id: 'provider-id', ...user } as never, {} as never, c as never);
    return { location: response.headers.get('location'), cookies: c.headers.get('set-cookie') ?? '' };
};

// A provider proves an email address, as a sign-in link does. The account with that verified
// address signs in; nothing about the provider's identity is stored.
describe.skipIf(!live)('OAuth sign-in', () => {
    const service = romedbService();
    beforeAll(async () => {
        state.cms = createCMS({ db: service.database(), modules: [contentModule], oauth: ['github', 'Not A Provider!'] });
        expect((await state.cms.migrate()).failed).toBeUndefined();
        await state.cms.ready({ force: true });
        for (const role of DEFAULT_ROLES) await state.cms.users.defineRole(role);
        await state.cms.users.create({ email: 'owner@example.com', name: 'Owner', password: 'a long password', roles: ['administrator'], network: true } as never).catch(() => undefined);
    });

    it('offers the providers the site lists, and the sign-in page reads them', () => {
        callback();
        expect(state.cms!.oauth).toEqual(['github']);
        expect(oauthProvider('github')).toBe(true);
        expect(oauthProvider('google')).toBe(false);
        expect(authOptions.oauth).toEqual(['github']);
        expect(authOptions.authMethods).toEqual(['credentials', 'oauth']);
    });

    it('refuses an address the provider did not verify, and creates nothing', async () => {
        expect(await signIn({ email: 'unverified@example.com', emailVerified: false })).toMatchObject({ location: '/auth/login?oauth=unverified', cookies: '' });
        expect(await signIn({ email: null, emailVerified: true })).toMatchObject({ location: '/auth/login?oauth=unverified' });
        expect(await state.cms!.signIn.accounts.findByEmail('unverified@example.com')).toBeNull();
    });

    it('signs an existing active account in by its verified email', async () => {
        const cms = state.cms!;
        const user = await cms.users.create({ email: 'editor@example.com', name: 'Editor', password: 'a long password', roles: ['editor'] });
        const result = await signIn({ email: 'Editor@Example.com', emailVerified: true });
        expect(result.location).toBe('/dashboard');
        expect(result.cookies).toMatch(/session_id=/);
        // No second account, and the password still works.
        expect((await cms.signIn.accounts.findByEmail('editor@example.com'))!.id).toBe(user.id);
        callback();
        expect((await loginUser('editor@example.com', 'a long password'))!.id).toBe(user.id);
    });

    it('creates an account for an unknown address only while registration is open', async () => {
        const cms = state.cms!;
        await cms.settings.update('general', { usersCanRegister: false }, { principal: systemPrincipal('test') });
        expect(await signIn({ email: 'new@example.com', emailVerified: true, name: 'New Person' })).toMatchObject({ location: '/auth/login?oauth=closed', cookies: '' });
        expect(await cms.signIn.accounts.findByEmail('new@example.com')).toBeNull();

        await cms.settings.update('general', { usersCanRegister: true, verifyEmail: true, approveRegistrations: false }, { principal: systemPrincipal('test') });
        const result = await signIn({ email: 'new@example.com', emailVerified: true, name: 'New Person' });
        expect(result.location).toBe('/dashboard');
        expect(result.cookies).toMatch(/session_id=/);
        // The provider confirmed the address: the account is active without the email's link, with the default role.
        const account = await cms.signIn.accounts.findByEmail('new@example.com');
        expect(account).toMatchObject({ status: 'active' });
        const member = await cms.users.resolve(account!.id);
        expect(member!.name).toBe('New Person');
        expect(member!.assignments.map(role => role.id)).toEqual([await cms.settings.get('general.defaultRole')]);
    });

    it('holds a new account for approval when the site asks for it, and says so again later', async () => {
        const cms = state.cms!;
        await cms.settings.update('general', { usersCanRegister: true, approveRegistrations: true }, { principal: systemPrincipal('test') });
        expect(await signIn({ email: 'held@example.com', emailVerified: true })).toMatchObject({ location: '/auth/login?oauth=pending', cookies: '' });
        const account = await cms.signIn.accounts.findByEmail('held@example.com');
        expect(account!.status).not.toBe('active');
        expect(await cms.users.awaitingApproval(account!.id)).toBe(true);
        expect(await signIn({ email: 'held@example.com', emailVerified: true })).toMatchObject({ location: '/auth/login?oauth=pending', cookies: '' });
    });

    it('does not sign a disabled account in', async () => {
        const cms = state.cms!;
        // An account an administrator turned off, not a registration that never confirmed its email.
        const user = await cms.users.create({ email: 'off@example.com', name: 'Off', password: 'a long password', roles: ['subscriber'] });
        expect(await cms.users.setStatus(user.id, 'disabled')).toBe(true);
        expect(await signIn({ email: 'off@example.com', emailVerified: true })).toMatchObject({ location: '/auth/login?oauth=inactive', cookies: '' });
        expect((await cms.signIn.accounts.get(user.id))!.status).toBe('disabled');
    });
});
