import { sql, type Migration } from '@cossackframework/database';

// A network administrator reaches every tenant and manages the list of tenants.
export default {
  name: '0013_add_network_admin',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up: [
      sql.unsafe('ALTER TABLE users ADD COLUMN network_admin BOOLEAN NOT NULL DEFAULT FALSE'),
    ],
    down: [
      { kind: 'drop-column', tableName: 'users', columnName: 'network_admin' },
    ],
  },
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe('ALTER TABLE users ADD COLUMN network_admin BOOLEAN NOT NULL DEFAULT FALSE'));
  },
  down({ schema }) {
    schema.dropColumn('users', 'network_admin');
  },
} satisfies Migration;
