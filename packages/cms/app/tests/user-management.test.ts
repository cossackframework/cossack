import { describe, expect, it, vi } from 'vitest';
import { NETWORK_ADMIN, userPrincipal } from '@cossackframework/cms';
import type { PublicUser } from '../src/auth';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('config', () => '/auth/login');

const { canGrantRoles, canManageAccess, canManageUser } = await import('../src/services/rbac');

const user = (id: string, roles: string[], permissions: string[]) => ({ id, roles: [], principal: userPrincipal(id, roles, permissions) }) as unknown as PublicUser;
const userManager = user('manager', ['editor'], ['cms:users', 'cms/*']);
const siteAdmin = user('admin', ['admin'], ['cms:users', 'cms:roles']);
const networkAdmin = user('root', ['admin', NETWORK_ADMIN], ['*']);

describe('who manages an account', () => {
    it('keeps a network admin, who holds no site role for it, with network admins', () => {
        const target = { id: 'root-2', roles: [], networkAdmin: true };
        expect(canManageUser(userManager, target)).toBe(false);
        expect(canManageUser(siteAdmin, target)).toBe(false);
        expect(canManageUser(networkAdmin, target)).toBe(true);
        expect(canManageAccess(siteAdmin, target)).toBe(false);
        expect(canManageAccess(networkAdmin, target)).toBe(true);
        expect(canManageAccess(user('root-2', [NETWORK_ADMIN], ['*']), target)).toBe(true);
    });

    it('lets user managers change accounts no stronger than their own', () => {
        expect(canManageUser(userManager, { roles: [{ permissions: ['cms/posts:*'] }] })).toBe(true);
        expect(canManageUser(userManager, { roles: [{ permissions: ['cms:roles'] }] })).toBe(false);
        // A custom role that installs plugins is code on the server: a user manager without it cannot take the account over.
        expect(canManageUser(userManager, { roles: [{ permissions: ['cms/posts:*', 'cms:plugins'] }] })).toBe(false);
        expect(canManageUser(siteAdmin, { roles: [{ permissions: ['cms:roles'] }] })).toBe(true);
        expect(canManageUser(siteAdmin, { roles: [{ permissions: ['*'] }] })).toBe(false);
        expect(canManageUser(networkAdmin, { roles: [{ permissions: ['*'] }] })).toBe(true);
    });

    it('lets role managers give only roles they could hold', () => {
        expect(canGrantRoles(siteAdmin, [{ permissions: ['cms:users'] }])).toBe(true);
        expect(canGrantRoles(siteAdmin, [{ permissions: ['*'] }])).toBe(false);
        expect(canGrantRoles(userManager, [{ permissions: [] }])).toBe(false);
        expect(canGrantRoles(networkAdmin, [{ permissions: ['*'] }])).toBe(true);
    });
});
