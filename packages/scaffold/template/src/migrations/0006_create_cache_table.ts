import { sql, type Migration } from '@cossackframework/database';

// `key` is a reserved word on MySQL, so it is written as an identifier.
const up = [
  sql.fragment`
    CREATE TABLE cache_items (
      ${sql.id('key')} VARCHAR(191) PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at BIGINT,
      updated_at BIGINT NOT NULL
    )
  `,
  sql.fragment`CREATE INDEX cache_items_expires_at_index ON cache_items (expires_at)`,
];

export default {
  name: '0006_create_cache_table',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up,
    down: [
      { kind: 'drop-table', tableName: 'cache_items' },
    ],
  },
  up({ schema }) {
    for (const statement of up) schema.raw(statement);
  },
  down({ schema }) {
    schema.dropTable('cache_items');
  },
} satisfies Migration;
