import type { Migration } from '@cossackframework/database';

export default {
  name: '0001_create_users',
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE users (
        id VARCHAR(191) PRIMARY KEY,
        email VARCHAR(191) NOT NULL UNIQUE,
        name TEXT,
        password_hash TEXT,
        avatar TEXT,
        meta TEXT,
        created_at VARCHAR(32) NOT NULL
      )
    `));
  },
  down({ schema }) {
    schema.dropTable('users');
  },
} satisfies Migration;
