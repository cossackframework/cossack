import { sql, type Migration } from '@cossackframework/database';

// Application passwords: tokens a user creates for apps and scripts.
export default {
  name: '0011_create_api_tokens',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up: [
      sql.unsafe(`
      CREATE TABLE api_tokens (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        name TEXT NOT NULL,
        secret_hash VARCHAR(64) NOT NULL,
        scope VARCHAR(16) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        last_used_at VARCHAR(32),
        expires_at VARCHAR(32)
      )
    `),
      sql.unsafe('CREATE INDEX api_tokens_user_id ON api_tokens (user_id)'),
    ],
    down: [
      { kind: 'drop-table', tableName: 'api_tokens' },
    ],
  },
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE api_tokens (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        name TEXT NOT NULL,
        secret_hash VARCHAR(64) NOT NULL,
        scope VARCHAR(16) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        last_used_at VARCHAR(32),
        expires_at VARCHAR(32)
      )
    `));
    schema.raw(orm.sql.unsafe('CREATE INDEX api_tokens_user_id ON api_tokens (user_id)'));
  },
  down({ schema }) {
    schema.dropTable('api_tokens');
  },
} satisfies Migration;
