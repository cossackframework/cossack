import { sql, type Migration } from '@cossackframework/database';

const up = [
  sql.fragment`
    CREATE TABLE oauth_accounts (
      id VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      provider VARCHAR(191) NOT NULL,
      provider_user_id VARCHAR(191) NOT NULL,
      meta ${sql.type('json')},
      created_at VARCHAR(32) NOT NULL,
      CONSTRAINT oauth_accounts_provider_user_unique UNIQUE (provider, provider_user_id)
    )
  `,
];

export default {
  name: '0005_create_oauth_accounts',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up,
    down: [
      { kind: 'drop-table', tableName: 'oauth_accounts' },
    ],
  },
  up({ schema }) {
    for (const statement of up) schema.raw(statement);
  },
  down({ schema }) {
    schema.dropTable('oauth_accounts');
  },
} satisfies Migration;
