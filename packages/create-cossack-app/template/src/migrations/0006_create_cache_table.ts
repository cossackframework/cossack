import type { Kysely } from '@cossackframework/database';

// Table for the database cache driver (@cossackframework/database's
// DatabaseCacheStore). Values are JSON text; expires_at is epoch milliseconds
// (NULL = never expires). The 'database' cache driver is registered by the
// default project template in src/middlewares/db.ts — set CACHE_DRIVER=database
// in your wrangler vars or .dev.vars to use it.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('cache_items')
    .addColumn('key', 'text', (c) => c.primaryKey().notNull())
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'integer')
    .addColumn('updated_at', 'integer', (c) => c.notNull())
    .execute();

  // Speed up purgeExpired() (WHERE expires_at < now).
  await db.schema
    .createIndex('cache_items_expires_at_index')
    .on('cache_items')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('cache_items_expires_at_index').ifExists().execute();
  await db.schema.dropTable('cache_items').ifExists().execute();
}
