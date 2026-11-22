import { sql, type Migration } from '@cossackframework/database';

// An account's state: active, or waiting for its email's confirmation or for approval.
export default {
  name: '0010_add_user_status',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up: [
      sql.unsafe("ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'"),
    ],
    down: [
      { kind: 'drop-column', tableName: 'users', columnName: 'status' },
    ],
  },
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe("ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'"));
  },
  down({ schema }) {
    schema.dropColumn('users', 'status');
  },
} satisfies Migration;
