/**
 * The `roles` table row shape. `permissions` is a JSON array of Permission
 * strings (see config/permissions.ts); null means no permissions granted.
 * `id` and `created_at` are set by the app (uuidv7 + ISO timestamp), so they're
 * plain `string` — not Kysely `Generated`.
 */
export interface RoleRow {
    id: string;
    name: string;
    permissions: string | null;
    created_at: string;
}

// Map the table name -> row type so Kysely's query builder is fully typed.
declare module '@cossackframework/database' {
    interface Database {
        roles: RoleRow;
    }
}
