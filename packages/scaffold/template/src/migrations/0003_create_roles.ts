import { sql, type Migration } from '@cossackframework/database';

const up = [
  sql.fragment`
    CREATE TABLE roles (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      permissions TEXT,
      meta ${sql.type('json')},
      created_at VARCHAR(32) NOT NULL
    )
  `,
];

export default {
  name: '0003_create_roles',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up,
    down: [
      { kind: 'drop-table', tableName: 'roles' },
    ],
  },
  up({ schema }) {
    for (const statement of up) schema.raw(statement);
  },
  down({ schema }) {
    schema.dropTable('roles');
  },
} satisfies Migration;
