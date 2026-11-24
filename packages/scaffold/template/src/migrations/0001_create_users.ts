import { sql, type Migration } from '@cossackframework/database';

// Accounts. `status` is active, unconfirmed, pending or disabled; `network_admin` reaches every
// tenant; `tenant_account` marks, in a tenant's database, an account of that tenant only.
// `meta` is the project's own data about the row, as on the other tables that have it.
const up = [
  sql.fragment`
    CREATE TABLE users (
      id VARCHAR(191) PRIMARY KEY,
      email VARCHAR(191) NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT,
      avatar TEXT,
      meta ${sql.type('json')},
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      network_admin BOOLEAN NOT NULL DEFAULT FALSE,
      tenant_account BOOLEAN NOT NULL DEFAULT FALSE,
      created_at VARCHAR(32) NOT NULL
    )
  `,
];

export default {
  name: '0001_create_users',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up,
    down: [
      { kind: 'drop-table', tableName: 'users' },
    ],
  },
  up({ schema }) {
    for (const statement of up) schema.raw(statement);
  },
  down({ schema }) {
    schema.dropTable('users');
  },
} satisfies Migration;
