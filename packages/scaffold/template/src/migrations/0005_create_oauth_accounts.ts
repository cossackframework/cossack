import type { Migration } from '@cossackframework/orm';

export default {
  name: '0005_create_oauth_accounts',
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE oauth_accounts (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        provider VARCHAR(191) NOT NULL,
        provider_user_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        CONSTRAINT oauth_accounts_provider_user_unique UNIQUE (provider, provider_user_id)
      )
    `));
  },
  down({ schema }) {
    schema.dropTable('oauth_accounts');
  },
} satisfies Migration;
