import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('roles')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    // permissions holds a JSON array of Permission strings (see config/permissions.ts).
    // null means "no permissions granted".
    .addColumn('permissions', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('roles').ifExists().execute();
}
