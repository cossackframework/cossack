import type { Migration } from '@cossackframework/database';

export default {
  name: '0002_create_sessions',
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE sessions (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191),
        data TEXT,
        meta TEXT,
        location TEXT,
        user_agent TEXT,
        ip_address TEXT,
        created_at VARCHAR(32) NOT NULL DEFAULT '',
        expires_at VARCHAR(32) NOT NULL
      )
    `));
  },
  down({ schema }) {
    schema.dropTable('sessions');
  },
} satisfies Migration;
