// src/services/rbac.ts
//
// The authorization surface. `guard` is the @cossackframework/auth authorizer
// kit: pages opt into role/permission checks via
// `@Page({ middlewares: [guard.requireRole('admin')] })`.
//
// It is intentionally unopinionated about how roles are stored — it reads
// `c.get('user').roles` (populated by resolveUserById in src/auth.ts) and
// answers yes/no via the callbacks below.

import { createAuthorizer } from '@cossackframework/auth';
import type { MiddlewareHandler } from 'hono';
import type { PublicUser } from '../auth';
import { holds, holdsAll } from '../lib/permissions';

export type { RoleAssignment } from '@/models/User';

export const guard = createAuthorizer<PublicUser>({
    // A network administrator stands in for every role.
    hasRole: (user, role) => user.networkAdmin === true || user.roles.some((r) => r.name === role),
    hasPermission: (user, permission) => holds(permissionsOf(user), permission),
    // Unauthenticated → login page. Forbidden (logged-in, lacks the role) →
    // their own dashboard, which is friendlier than a bare 403.
    onUnauthorized: (c, reason) =>
        c.redirect(reason === 'unauthenticated' ? config('auth.redirectAfterLogout') : '/dashboard'),
});

/** The role whose holders may do everything. It cannot be renamed, changed or deleted. */
export const ADMIN_ROLE = 'admin';

/**
 * The permission patterns a user holds, from every role. The admin role holds everything,
 * whatever its stored list says, so a permission the project adds later is an administrator's too.
 */
export function permissionsOf(user: { roles: readonly { name: string; permissions: readonly string[] }[] } | null | undefined): string[] {
    if (!user) return [];
    if ((user as { networkAdmin?: boolean }).networkAdmin || user.roles.some((r) => r.name === ADMIN_ROLE)) return ['*'];
    return [...new Set(user.roles.flatMap((r) => r.permissions))];
}

/** Who may define roles and choose users' roles: holders of `role:update`, administrators by default. */
export function canAssignRoles(user: PublicUser | null | undefined): boolean {
    return holds(permissionsOf(user), 'role:update');
}

/** Who may see and end a user's sessions and application passwords: the user and administrators. */
export function canManageAccess(user: PublicUser | null | undefined, target: { id: string }): boolean {
    return !!user && (user.id === target.id || canAssignRoles(user));
}

/** Guard of the role screens. */
export const requireRoleManager: MiddlewareHandler = guard.requirePermission('role:update');

/** Whether the user may give these roles: a role manager, holding every permission the roles hold. */
export function canGrantRoles(user: PublicUser | null | undefined, roles: readonly { name?: string; permissions: readonly string[] }[]): boolean {
    if (!canAssignRoles(user)) return false;
    const held = permissionsOf(user);
    // Only an administrator makes another one.
    return roles.every(role => role.name !== ADMIN_ROLE || held.includes('*')) && holdsAll(held, roles.flatMap(role => role.permissions));
}

/**
 * Whether the user may change another account: one whose roles hold no permission the user
 * lacks, so nobody takes over a stronger account by setting its password or email.
 */
export function canManageUser(user: PublicUser | null | undefined, target: { roles: readonly { name: string; permissions?: readonly string[] }[] }): boolean {
    if (!user) return false;
    return holdsAll(permissionsOf(user), permissionsOf({ roles: target.roles.map(role => ({ name: role.name, permissions: role.permissions ?? [] })) }));
}
