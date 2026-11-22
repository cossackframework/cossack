import { sql, type Migration } from '@cossackframework/database';

// Tenants: each has its own database. These tables are used in the main database; a tenant's
// database has them too, empty, because every database gets every migration.
export default {
  name: '0012_create_tenants',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up: [
      sql.unsafe(`
      CREATE TABLE tenants (
        id VARCHAR(191) PRIMARY KEY,
        slug VARCHAR(63) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        database VARCHAR(191) NOT NULL UNIQUE,
        status VARCHAR(16) NOT NULL DEFAULT 'creating',
        created_at VARCHAR(32) NOT NULL
      )
    `),
      sql.unsafe(`
      CREATE TABLE tenant_domains (
        host VARCHAR(191) PRIMARY KEY,
        tenant_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(32) NOT NULL
      )
    `),
      sql.unsafe('CREATE INDEX tenant_domains_tenant_id ON tenant_domains (tenant_id)'),
      sql.unsafe(`
      CREATE TABLE tenant_members (
        tenant_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        PRIMARY KEY (tenant_id, user_id)
      )
    `),
      sql.unsafe('CREATE INDEX tenant_members_user_id ON tenant_members (user_id)'),
      sql.unsafe(`
      CREATE TABLE tenant_handoffs (
        id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        tenant_id VARCHAR(191) NOT NULL,
        expires_at VARCHAR(32) NOT NULL
      )
    `),
      sql.unsafe('ALTER TABLE sessions ADD COLUMN parent_id VARCHAR(191)'),
      sql.unsafe('CREATE INDEX sessions_parent_id ON sessions (parent_id)'),
    ],
    down: [
      { kind: 'drop-index', tableName: 'sessions', indexName: 'sessions_parent_id' },
      { kind: 'drop-column', tableName: 'sessions', columnName: 'parent_id' },
      { kind: 'drop-table', tableName: 'tenant_handoffs' },
      { kind: 'drop-table', tableName: 'tenant_members' },
      { kind: 'drop-table', tableName: 'tenant_domains' },
      { kind: 'drop-table', tableName: 'tenants' },
    ],
  },
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE tenants (
        id VARCHAR(191) PRIMARY KEY,
        slug VARCHAR(63) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        database VARCHAR(191) NOT NULL UNIQUE,
        status VARCHAR(16) NOT NULL DEFAULT 'creating',
        created_at VARCHAR(32) NOT NULL
      )
    `));
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE tenant_domains (
        host VARCHAR(191) PRIMARY KEY,
        tenant_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(32) NOT NULL
      )
    `));
    schema.raw(orm.sql.unsafe('CREATE INDEX tenant_domains_tenant_id ON tenant_domains (tenant_id)'));
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE tenant_members (
        tenant_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        PRIMARY KEY (tenant_id, user_id)
      )
    `));
    schema.raw(orm.sql.unsafe('CREATE INDEX tenant_members_user_id ON tenant_members (user_id)'));
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE tenant_handoffs (
        id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        tenant_id VARCHAR(191) NOT NULL,
        expires_at VARCHAR(32) NOT NULL
      )
    `));
    schema.raw(orm.sql.unsafe('ALTER TABLE sessions ADD COLUMN parent_id VARCHAR(191)'));
    schema.raw(orm.sql.unsafe('CREATE INDEX sessions_parent_id ON sessions (parent_id)'));
  },
  down({ orm, schema }) {
    schema.raw(orm.sql.unsafe(orm.driver.dialect === 'mysql'
      ? 'DROP INDEX sessions_parent_id ON sessions'
      : 'DROP INDEX sessions_parent_id'));
    schema.dropColumn('sessions', 'parent_id');
    schema.dropTable('tenant_handoffs');
    schema.dropTable('tenant_members');
    schema.dropTable('tenant_domains');
    schema.dropTable('tenants');
  },
} satisfies Migration;
