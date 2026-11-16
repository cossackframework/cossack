// src/services/rbac.ts
//
// The authorization surface. `guard` is the @cossackframework/auth authorizer kit: pages
// opt into checks with `@Page({ middlewares: [guard.requireRole('admin')] })`.
//
// With the CMS, permissions are patterns such as `cms:users` or `cms/posts:*`, and the
// shared dashboard's `admin` role means "may manage users".

import { createAuthorizer } from '@cossackframework/auth';
import { hasPermission, holdsAll, isNetworkAdmin, PERMISSIONS } from '@cossackframework/cms';
import { isTransportPath } from '@cossackframework/core/transport-routes';
import type { PublicUser } from '../auth';
import type { MiddlewareHandler } from 'hono';

export type { RoleAssignment } from '../auth';

export const guard = createAuthorizer<PublicUser>({
    hasRole: (user, role) => role === 'admin' ? hasPermission(user.principal, PERMISSIONS.manageUsers) : user.roles.some(entry => entry.id === role),
    hasPermission: (user, permission) => hasPermission(user.principal, permission),
    // Unauthenticated → login page. Forbidden → the dashboard, friendlier than a bare 403.
    onUnauthorized: (c, reason) => {
        if (isTransportPath(c.req.path, 'rpc', 'upload', 'websocket')) {
            return c.json({ error: reason === 'unauthenticated' ? 'Authentication required' : 'Forbidden',
                code: reason === 'unauthenticated' ? 'COSSACK_RPC_UNAUTHENTICATED' : 'COSSACK_RPC_FORBIDDEN' }, reason === 'unauthenticated' ? 401 : 403);
        }
        return c.redirect(reason === 'unauthenticated' ? `${config('auth.redirectAfterLogout')}` : '/dashboard');
    },
});

/** Who may define roles and choose users' roles: holders of `cms:roles`, administrators by default. */
export function canAssignRoles(user: PublicUser | null | undefined): boolean {
    return !!user && hasPermission(user.principal, PERMISSIONS.manageRoles);
}

/**
 * Who may see and end a user's sessions and application passwords: the user, and role managers
 * who may change the account (`canManageUser`, and `manageableHere` for a network account), so
 * nobody mints a token for a stronger account or reads and ends its sessions.
 */
export function canManageAccess(user: PublicUser | null | undefined, target: { id: string; roles: readonly { permissions: readonly string[] }[]; networkAdmin?: boolean; lockedProfile?: string }): boolean {
    if (!user) return false;
    if (user.id === target.id) return true;
    // A network account this request may not change (`manageableHere`): its sessions show where it signs in on every site.
    if (target.lockedProfile) return false;
    return canAssignRoles(user) && canManageUser(user, target);
}

/** Guard of the role screens. */
export const requireRoleManager: MiddlewareHandler = guard.requirePermission(PERMISSIONS.manageRoles);

/**
 * Whether the user may change another account: one whose roles hold no permission the user
 * lacks, so nobody takes over a stronger account by setting its password or email; a network
 * admin's account, which holds no site role for it, stays with network admins.
 */
export function canManageUser(user: PublicUser | null | undefined, target: { roles: readonly { permissions: readonly string[] }[]; networkAdmin?: boolean }): boolean {
    if (!user) return false;
    if (target.networkAdmin && !isNetworkAdmin(user.principal)) return false;
    return holdsAll(user.principal, target.roles.flatMap(role => role.permissions));
}

/** Whether the user may give these roles: a role manager, holding every permission the roles hold. */
export function canGrantRoles(user: PublicUser | null | undefined, roles: readonly { permissions: readonly string[] }[]): boolean {
    return canAssignRoles(user) && holdsAll(user!.principal, roles.flatMap(role => role.permissions));
}
