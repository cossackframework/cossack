/**
 * A role assigned to a user, with its parsed permissions. Populated by
 * `resolveUserById` (src/auth.ts) and read by the authorizer (src/services/rbac.ts).
 */
export interface RoleAssignment {
    id: string;
    name: string;
    permissions: string[];
}

/**
 * The `users` table row shape. Column names match the migration (snake_case).
 * `id` and `created_at` are set by the app (uuidv7 + ISO timestamp), so they're
 * plain `string` — not Kysely `Generated` (which would make them optional on
 * insert and widen the read type). Add columns here as your app grows.
 */
export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  avatar: string | null;
  meta: string | null;
  created_at: string;
}

// Map the table name -> row type so Kysely's query builder is fully typed.
declare module '@cossackframework/database' {
  interface Database {
    users: UserRow;
  }
}

// Expose a safe subset as `this.user` / `c.get('user')`.
// `password_hash` is intentionally excluded from the request context.
// `roles` is populated at session resolution so the authorizer + nav can read it.
declare module '@cossackframework/core' {
  interface User {
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    meta: Record<string, unknown> | null;
    roles: RoleAssignment[];
  }
}
