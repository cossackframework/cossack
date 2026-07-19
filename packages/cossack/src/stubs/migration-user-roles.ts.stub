import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('user_roles')
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    // One role assigned to a user at most once.
    .addPrimaryKeyConstraint('user_roles_pkey', ['user_id', 'role_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('user_roles').ifExists().execute();
}
