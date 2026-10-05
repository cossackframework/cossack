import { sql, type Migration } from '@cossackframework/database';

export default {
  name: '0003_create_roles',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up: [
      sql.unsafe(`
      CREATE TABLE roles (
        id VARCHAR(191) PRIMARY KEY,
        name VARCHAR(191) NOT NULL UNIQUE,
        permissions TEXT,
        created_at VARCHAR(32) NOT NULL
      )
    `),
    ],
    down: [
      { kind: 'drop-table', tableName: 'roles' },
    ],
  },
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE roles (
        id VARCHAR(191) PRIMARY KEY,
        name VARCHAR(191) NOT NULL UNIQUE,
        permissions TEXT,
        created_at VARCHAR(32) NOT NULL
      )
    `));
  },
  down({ schema }) {
    schema.dropTable('roles');
  },
} satisfies Migration;
