// src/services/rbac.ts
//
// The authorization surface. `guard` is the @cossackframework/auth authorizer kit: pages
// opt into checks with `@Page({ middlewares: [guard.requireRole('admin')] })`.
//
// With the CMS, permissions are patterns such as `cms:users` or `cms/posts:*`, and the
// shared dashboard's `admin` role means "may manage users". Users, roles and their
// permissions are the dashboard package's (auth.ts); this module says what they allow here.

import { createAuthorizer } from '@cossackframework/auth';
import { PERMISSIONS } from '@cossackframework/cms';
import { isTransportPath } from '@cossackframework/core/transport-routes';
import type { PublicUser } from '../auth';
import { holds, holdsAll } from '../lib/permissions';
import type { MiddlewareHandler } from 'hono';

export type { RoleAssignment } from '@/models/User';

/** The ID of the role whose holders may do everything. It cannot be changed or deleted. */
export const ADMIN_ROLE = 'admin';

/** The permission patterns a user holds, from every role. A network administrator holds everything. */
export function permissionsOf(user: { roles: readonly { id?: string; name: string; permissions: readonly string[] }[]; networkAdmin?: boolean } | null | undefined): string[] {
    if (!user) return [];
    if (user.networkAdmin || user.roles.some(role => role.id === ADMIN_ROLE)) return ['*'];
    return [...new Set(user.roles.flatMap(role => role.permissions))];
}

export const guard = createAuthorizer<PublicUser>({
    hasRole: (user, role) => role === 'admin' ? holds(permissionsOf(user), PERMISSIONS.manageUsers) : user.roles.some(entry => entry.id === role || entry.name === role),
    hasPermission: (user, permission) => holds(permissionsOf(user), permission),
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
    return holds(permissionsOf(user), PERMISSIONS.manageRoles);
}

/**
 * Who may see and end a user's sessions and application passwords: the user, and role managers
 * who may change the account, so nobody mints a token for a stronger account or reads and ends
 * its sessions. An account shared with other sites (`lockedProfile`) stays with its owner.
 */
export function canManageAccess(user: PublicUser | null | undefined, target: { id: string; roles: readonly { name?: string; permissions: readonly string[] }[]; networkAdmin?: boolean; lockedProfile?: string }): boolean {
    if (!user) return false;
    if (user.id === target.id) return true;
    if (target.lockedProfile) return false;
    return canAssignRoles(user) && canManageUser(user, target);
}

/** Guard of the role screens. */
export const requireRoleManager: MiddlewareHandler = guard.requirePermission(PERMISSIONS.manageRoles);

/**
 * Whether the user may change another account: one whose roles hold no permission the user
 * lacks, so nobody takes over a stronger account by setting its password or email; a network
 * administrator's account stays with network administrators.
 */
export function canManageUser(user: PublicUser | null | undefined, target: { roles: readonly { name?: string; permissions?: readonly string[] }[]; networkAdmin?: boolean }): boolean {
    if (!user) return false;
    if (target.networkAdmin && !user.networkAdmin) return false;
    return holdsAll(permissionsOf(user), target.roles.flatMap(role => role.permissions ?? []));
}

/** Whether the user may give these roles: a role manager, holding every permission the roles hold. */
export function canGrantRoles(user: PublicUser | null | undefined, roles: readonly { permissions: readonly string[] }[]): boolean {
    return canAssignRoles(user) && holdsAll(permissionsOf(user), roles.flatMap(role => role.permissions));
}
