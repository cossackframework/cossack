import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('oauth_accounts')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('provider', 'text', (c) => c.notNull())
    .addColumn('provider_user_id', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addUniqueConstraint('oauth_accounts_provider_user_unique', ['provider', 'provider_user_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('oauth_accounts').ifExists().execute();
}
