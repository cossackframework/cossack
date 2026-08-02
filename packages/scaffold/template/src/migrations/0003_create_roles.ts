import type { Migration } from '@cossackframework/orm';

export default {
  name: '0003_create_roles',
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
