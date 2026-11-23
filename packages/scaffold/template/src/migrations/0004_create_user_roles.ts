import { sql, type Migration } from '@cossackframework/database';

const up = [
  sql.fragment`
    CREATE TABLE user_roles (
      user_id VARCHAR(191) NOT NULL,
      role_id VARCHAR(191) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id)
    )
  `,
];

export default {
  name: '0004_create_user_roles',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up,
    down: [
      { kind: 'drop-table', tableName: 'user_roles' },
    ],
  },
  up({ schema }) {
    for (const statement of up) schema.raw(statement);
  },
  down({ schema }) {
    schema.dropTable('user_roles');
  },
} satisfies Migration;
