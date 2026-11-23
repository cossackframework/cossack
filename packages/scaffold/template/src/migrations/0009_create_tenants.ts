import { sql, type Migration } from '@cossackframework/database';

// Tenants: each has its own database. These tables are used in the main database; a tenant's
// database has them too, empty, because every database gets every migration. A domain is
// verified before it serves and one may be primary; a deleted tenant can be restored for a
// while; `tenant_network` holds the network's settings; `tenant_handoffs` the one-time codes of
// sign-in between hosts; `tenant_sessions` which tenants a main session reached. `database` and
// `key` are reserved words on MySQL, so they are written as identifiers.
const up = [
  sql.fragment`
    CREATE TABLE tenants (
      id VARCHAR(191) PRIMARY KEY,
      slug VARCHAR(63) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      ${sql.id('database')} VARCHAR(191) NOT NULL UNIQUE,
      status VARCHAR(16) NOT NULL DEFAULT 'creating',
      meta ${sql.type('json')},
      created_at VARCHAR(32) NOT NULL,
      deleted_at VARCHAR(32)
    )
  `,
  sql.fragment`
    CREATE TABLE tenant_domains (
      host VARCHAR(191) PRIMARY KEY,
      tenant_id VARCHAR(191) NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      verified_at VARCHAR(32),
      meta ${sql.type('json')},
      created_at VARCHAR(32) NOT NULL
    )
  `,
  sql.fragment`CREATE INDEX tenant_domains_tenant_id ON tenant_domains (tenant_id)`,
  sql.fragment`
    CREATE TABLE tenant_members (
      tenant_id VARCHAR(191) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      meta ${sql.type('json')},
      created_at VARCHAR(32) NOT NULL,
      PRIMARY KEY (tenant_id, user_id)
    )
  `,
  sql.fragment`CREATE INDEX tenant_members_user_id ON tenant_members (user_id)`,
  sql.fragment`
    CREATE TABLE tenant_handoffs (
      id VARCHAR(64) PRIMARY KEY,
      session_id VARCHAR(191) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      tenant_id VARCHAR(191) NOT NULL,
      expires_at VARCHAR(32) NOT NULL
    )
  `,
  sql.fragment`
    CREATE TABLE tenant_sessions (
      session_public_id VARCHAR(36) NOT NULL,
      tenant_id VARCHAR(191) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      PRIMARY KEY (session_public_id, tenant_id)
    )
  `,
  sql.fragment`CREATE INDEX tenant_sessions_user_id ON tenant_sessions (user_id)`,
  sql.fragment`
    CREATE TABLE tenant_network (
      ${sql.id('key')} VARCHAR(191) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    )
  `,
];

export default {
  name: '0009_create_tenants',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up,
    down: [
      { kind: 'drop-table', tableName: 'tenant_network' },
      { kind: 'drop-table', tableName: 'tenant_sessions' },
      { kind: 'drop-table', tableName: 'tenant_handoffs' },
      { kind: 'drop-table', tableName: 'tenant_members' },
      { kind: 'drop-table', tableName: 'tenant_domains' },
      { kind: 'drop-table', tableName: 'tenants' },
    ],
  },
  up({ schema }) {
    for (const statement of up) schema.raw(statement);
  },
  down({ schema }) {
    schema.dropTable('tenant_network');
    schema.dropTable('tenant_sessions');
    schema.dropTable('tenant_handoffs');
    schema.dropTable('tenant_members');
    schema.dropTable('tenant_domains');
    schema.dropTable('tenants');
  },
} satisfies Migration;
