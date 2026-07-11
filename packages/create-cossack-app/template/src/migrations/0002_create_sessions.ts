import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sessions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    // user_id is nullable so anonymous sessions (carts, wizards, A/B) work
    // without auth. Authenticated sessions set it on login.
    .addColumn('user_id', 'text')
    // data holds a JSON key/value bag for general-purpose session storage
    // (the session() helper). Nullable until first write.
    .addColumn('data', 'text')
    .addColumn('expires_at', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sessions').ifExists().execute();
}
