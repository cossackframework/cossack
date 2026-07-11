import type { Generated } from '@cossackframework/database';

/**
 * The `users` table row shape. Add columns here as your app grows.
 */
export interface UserRow {
  id: Generated<string>;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Generated<string>;
}

// Map the table name -> row type so Kysely's query builder is fully typed.
declare module '@cossackframework/database' {
  interface Database {
    users: UserRow;
  }
}

// Expose a safe subset as `this.user` / `c.get('user')`.
// `passwordHash` is intentionally excluded from the request context.
declare module '@cossackframework/core' {
  interface User {
    id: string;
    email: string;
    name: string;
  }
}
