import type { Generated } from '@cossackframework/database';

/**
 * The `users` table row shape. Column names match the migration (snake_case).
 * Add columns here as your app grows.
 */
export interface UserRow {
  id: Generated<string>;
  email: string;
  name: string | null;
  password_hash: string | null;
  created_at: Generated<string>;
}

// Map the table name -> row type so Kysely's query builder is fully typed.
declare module '@cossackframework/database' {
  interface Database {
    users: UserRow;
  }
}

// Expose a safe subset as `this.user` / `c.get('user')`.
// `password_hash` is intentionally excluded from the request context.
declare module '@cossackframework/core' {
  interface User {
    id: string;
    email: string;
    name: string;
  }
}
