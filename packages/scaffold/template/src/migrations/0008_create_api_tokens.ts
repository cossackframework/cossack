import { sql, type Migration } from '@cossackframework/database';

// Application passwords: tokens a user creates for apps and scripts.
const up = [
  sql.fragment`
    CREATE TABLE api_tokens (
      id VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      name TEXT NOT NULL,
      secret_hash VARCHAR(64) NOT NULL,
      scope VARCHAR(16) NOT NULL,
      meta ${sql.type('json')},
      created_at VARCHAR(32) NOT NULL,
      last_used_at VARCHAR(32),
      expires_at VARCHAR(32)
    )
  `,
  sql.fragment`CREATE INDEX api_tokens_user_id ON api_tokens (user_id)`,
];

export default {
  name: '0008_create_api_tokens',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up,
    down: [
      { kind: 'drop-table', tableName: 'api_tokens' },
    ],
  },
  up({ schema }) {
    for (const statement of up) schema.raw(statement);
  },
  down({ schema }) {
    schema.dropTable('api_tokens');
  },
} satisfies Migration;
