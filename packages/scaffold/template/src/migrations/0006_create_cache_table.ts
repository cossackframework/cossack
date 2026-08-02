import type { Migration } from '@cossackframework/database';

export default {
  name: '0006_create_cache_table',
  up({ orm, schema }) {
    schema
      .raw(orm.sql.unsafe(`
        CREATE TABLE cache_items (
          key VARCHAR(191) PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at BIGINT,
          updated_at BIGINT NOT NULL
        )
      `))
      .raw(orm.sql.unsafe(
        'CREATE INDEX cache_items_expires_at_index ON cache_items (expires_at)',
      ));
  },
  down({ schema }) {
    schema.dropTable('cache_items');
  },
} satisfies Migration;
