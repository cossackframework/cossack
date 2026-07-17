/**
 * The `sessions` table row shape (snake_case to match the migration).
 * user_id is nullable for anonymous sessions; data is a JSON key/value bag;
 * meta is a JSON bag for auth-session metadata (type discriminator, ...);
 * location/user_agent/ip_address track where authenticated sessions originated.
 */
export interface SessionRow {
  id: string;
  user_id: string | null;
  data: string | null;
  meta: string | null;
  location: string | null;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: string;
}

// Map the table name -> row type so Kysely's query builder is fully typed.
declare module '@cossackframework/database' {
  interface Database {
    sessions: SessionRow;
  }
}
