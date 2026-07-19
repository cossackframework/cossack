import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('email', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text')
    .addColumn('password_hash', 'text')
    // avatar is a URL to the user's profile picture (nullable until set).
    .addColumn('avatar', 'text')
    // meta is a JSON bag for arbitrary user metadata (preferences, flags, ...).
    .addColumn('meta', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').ifExists().execute();
}
