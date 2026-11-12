import { describe, expect, it, vi } from 'vitest';
import { userPrincipal, type Principal } from '@cossackframework/cms';

/**
 * On the main site a network account signs in on every site it belongs to: a main-site user
 * admin who lacks what the account holds elsewhere must not set its password, mint it a token,
 * reset its second factors or delete it.
 */
const state = vi.hoisted(() => ({
    principal: undefined as unknown,
    memberships: new Map<string, { site: string; permissions: string[] }[]>(),
}));
const host = { siteAccounts: null, users: { get: async () => null } };
vi.mock('../src/cms/index', () => ({
    currentCms: () => host,
    siteUrl: () => undefined,
    networkFor: () => ({
        memberSites: async (id: string) => [{ id: 'main' }, ...(state.memberships.get(id) ?? []).map(entry => ({ id: entry.site }))],
        hostOf: (site: { id: string }) => ({ users: { get: async (id: string) => {
            const entry = (state.memberships.get(id) ?? []).find(item => item.site === site.id);
            return entry ? { id, permissions: entry.permissions } : null;
        } } }),
        deleteAccount: async () => true,
    }),
}));
vi.mock('@cossackframework/core', async original => ({
    ...await original<typeof import('@cossackframework/core')>(),
    getRequestContext: () => ({ env: {}, get: (key: string) => key === 'principal' ? state.principal : key === 'site' ? { id: 'main' } : undefined }),
}));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);
const { createApiToken, manageableHere, resetSecondFactors } = await import('../src/auth');
const { changeUserPassword, deleteUser } = await import('../src/services/users');

const as = (principal: Principal) => { state.principal = principal; };
const mainAdmin = userPrincipal('admin', ['admin'], ['cms:users', 'cms:roles', 'cms/*', 'cms:settings']);

describe('network accounts on the main site', () => {
    state.memberships.set('blog-admin', [{ site: 'blog', permissions: ['*'] }]);
    state.memberships.set('blog-author', [{ site: 'blog', permissions: ['cms/posts:create'] }]);

    it('stay with whoever holds what the account holds on its other sites', async () => {
        as(mainAdmin);
        expect(await manageableHere('blog-admin')).toBe(false);
        expect(await manageableHere('blog-author')).toBe(true);
        // A network admin, and the person themself, still manage it.
        as(userPrincipal('root', ['network_admin'], ['*']));
        expect(await manageableHere('blog-admin')).toBe(true);
        as(userPrincipal('blog-admin', [], []));
        expect(await manageableHere('blog-admin')).toBe(true);
    });

    it('refuse the password, token, second-factor and delete changes of a stronger account', async () => {
        as(mainAdmin);
        await expect(changeUserPassword('blog-admin', 'new long password')).rejects.toThrow(/network account/);
        await expect(createApiToken('blog-admin', 'Takeover', 'write')).rejects.toThrow(/network account/);
        await expect(resetSecondFactors('blog-admin')).rejects.toThrow(/network account/);
        await expect(deleteUser('blog-admin')).rejects.toThrow(/network account/);
    });
});
