import type { Migration } from '@cossackframework/orm';

export default {
  name: '0007_create_user_roles',
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE user_roles (
        user_id VARCHAR(191) NOT NULL,
        role_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id)
      )
    `));
  },
  down({ schema }) {
    schema.dropTable('user_roles');
  },
} satisfies Migration;
