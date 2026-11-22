// The caller of a request as the shared access helpers (services/rbac.ts) take them.
import { NETWORK_ADMIN, type Principal } from '@cossackframework/cms';
import type { PublicUser } from '#app/auth';

/**
 * A principal as a user of the shared helpers: an application password's request has no
 * session user, so its principal's permissions stand in as one role.
 */
export function userOfPrincipal(principal: Extract<Principal, { kind: 'user' }>): PublicUser {
    return { id: principal.id, email: '', name: '', avatar: null, meta: null,
        roles: [{ id: 'principal', name: 'principal', permissions: [...principal.permissions] }],
        ...(principal.roles.includes(NETWORK_ADMIN) ? { networkAdmin: true } : {}) };
}
