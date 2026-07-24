import type { Generated } from '@cossackframework/database';

/**
 * The `user_roles` join-table row shape — links a user to a role.
 * The (user_id, role_id) pair is the primary key, so each role is assigned
 * to a user at most once.
 */
export interface UserRoleRow {
    user_id: string;
    role_id: string;
    created_at: Generated<string>;
}

declare module '@cossackframework/database' {
    interface Database {
        user_roles: UserRoleRow;
    }
}
