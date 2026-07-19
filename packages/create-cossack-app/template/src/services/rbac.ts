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
import type { PublicUser } from '../auth';

export type { RoleAssignment } from '../models/User';

export const guard = createAuthorizer<PublicUser>({
    hasRole: (user, role) => user.roles.some((r) => r.name === role),
    hasPermission: (user, permission) => user.roles.some((r) => r.permissions.includes(permission)),
    // Unauthenticated → login page. Forbidden (logged-in, lacks the role) →
    // their own dashboard, which is friendlier than a bare 403.
    onUnauthorized: (c, reason) =>
        c.redirect(reason === 'unauthenticated' ? config('auth.redirectAfterLogout') : '/dashboard'),
});
