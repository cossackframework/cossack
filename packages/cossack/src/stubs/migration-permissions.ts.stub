import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('permissions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .execute();

  await db.schema
    .createTable('role_permissions')
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addColumn('permission_id', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('role_permissions_pkey', ['role_id', 'permission_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('role_permissions').ifExists().execute();
  await db.schema.dropTable('permissions').ifExists().execute();
}
