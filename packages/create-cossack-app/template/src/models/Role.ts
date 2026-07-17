import type { Generated } from '@cossackframework/database';

/**
 * The `roles` table row shape. `permissions` is a JSON array of Permission
 * strings (see lib/permissions.ts); null means no permissions granted.
 */
export interface RoleRow {
    id: Generated<string>;
    name: string;
    permissions: string | null;
    created_at: Generated<string>;
}

// Map the table name -> row type so Kysely's query builder is fully typed.
declare module '@cossackframework/database' {
    interface Database {
        roles: RoleRow;
    }
}
