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
    /** Site statuses; a site left out has been purged. */
    sites: new Map<string, string>([['blog', 'active']]),
    /** Whether the network is on: memberSites then lists only the main site. */
    enabled: true,
}));
const host = { siteAccounts: null, users: { get: async () => null } };
vi.mock('../src/cms/index', () => ({
    currentCms: () => host,
    siteUrl: () => undefined,
    networkFor: () => ({
        main: { accounts: { memberships: async (ids: string[]) => new Map(ids.map(id => [id, ['main', ...(state.memberships.get(id) ?? []).map(entry => entry.site)]])) } },
        sites: { getMany: async (ids: string[]) => ids.filter(id => state.sites.has(id)).map(id => ({ id, name: id, database: id, status: state.sites.get(id), domains: [] })) },
        memberSites: async (id: string) => [{ id: 'main' }, ...(state.enabled ? (state.memberships.get(id) ?? []).filter(entry => state.sites.get(entry.site) === 'active').map(entry => ({ id: entry.site })) : [])],
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
const { createApiToken, manageableHere, resetSecondFactors, revokeSessionOf, revokeSessionsOf, sessionsOf } = await import('../src/auth');
const { canManageAccess } = await import('../src/services/rbac');
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

    it('count sites the network hides: switched off, deleted until purged, or being created', async () => {
        as(mainAdmin);
        try {
            state.enabled = false;
            expect(await manageableHere('blog-admin')).toBe(false);
            state.enabled = true;
            for (const status of ['deleted', 'archived', 'creating']) {
                state.sites.set('blog', status);
                expect(await manageableHere('blog-admin'), status).toBe(false);
            }
            // A purged site has no database left to come back with.
            state.sites.delete('blog');
            expect(await manageableHere('blog-admin')).toBe(true);
        } finally {
            state.enabled = true;
            state.sites.set('blog', 'active');
        }
    });

    it('refuse the password, token, second-factor and delete changes of a stronger account', async () => {
        as(mainAdmin);
        await expect(changeUserPassword('blog-admin', 'new long password')).rejects.toThrow(/network account/);
        await expect(createApiToken('blog-admin', 'Takeover', 'write')).rejects.toThrow(/network account/);
        await expect(resetSecondFactors('blog-admin')).rejects.toThrow(/network account/);
        await expect(deleteUser('blog-admin')).rejects.toThrow(/network account/);
        // Its sessions, which show where it signs in on every site, are not this admin's to read or end.
        const c = {} as never;
        await expect(sessionsOf(c, 'blog-admin')).rejects.toThrow(/network account/);
        await expect(revokeSessionOf(c, 'blog-admin', 'ref')).rejects.toThrow(/network account/);
        await expect(revokeSessionsOf(c, 'blog-admin')).rejects.toThrow(/network account/);
        expect(canManageAccess({ id: 'admin', principal: mainAdmin } as never, { id: 'blog-admin', roles: [], lockedProfile: 'locked' })).toBe(false);
        expect(canManageAccess({ id: 'admin', principal: mainAdmin } as never, { id: 'blog-author', roles: [] })).toBe(true);
    });
});
