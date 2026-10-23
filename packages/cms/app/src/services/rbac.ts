// src/services/rbac.ts
//
// The authorization surface. `guard` is the @cossackframework/auth authorizer kit: pages
// opt into checks with `@Page({ middlewares: [guard.requireRole('admin')] })`.
//
// With the CMS, permissions are patterns such as `cms:users` or `cms/posts:*`, and the
// shared dashboard's `admin` role means "may manage users".

import { createAuthorizer } from '@cossackframework/auth';
import { hasPermission, permissionMatches, PERMISSIONS } from '@cossackframework/cms';
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

/** Who may see and end a user's sessions and application passwords: the user and administrators. */
export function canManageAccess(user: PublicUser | null | undefined, userId: string): boolean {
    return !!user && (user.id === userId || canAssignRoles(user));
}

/** Guard of the role screens. */
export const requireRoleManager: MiddlewareHandler = guard.requirePermission(PERMISSIONS.manageRoles);

/**
 * Whether the user may change another account. Accounts that can manage roles stay with
 * role managers, so a user manager cannot take over an administrator.
 */
export function canManageUser(user: PublicUser | null | undefined, target: { roles: readonly { permissions: readonly string[] }[] }): boolean {
    if (canAssignRoles(user)) return true;
    return !target.roles.some(role => role.permissions.some(pattern => permissionMatches(pattern, PERMISSIONS.manageRoles)));
}
