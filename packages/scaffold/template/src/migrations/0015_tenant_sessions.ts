import { sql, type Migration } from '@cossackframework/database';

// A tenant keeps its sessions in its own database; the main database records which tenants a
// main session reached. An account can exist in one tenant only (`users.tenant_account`).
export default {
  name: '0015_tenant_sessions',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up: [
      sql.unsafe(`
      CREATE TABLE tenant_sessions (
        session_public_id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        PRIMARY KEY (session_public_id, tenant_id)
      )
    `),
      sql.unsafe('CREATE INDEX tenant_sessions_user_id ON tenant_sessions (user_id)'),
      sql.unsafe('ALTER TABLE users ADD COLUMN tenant_account BOOLEAN NOT NULL DEFAULT FALSE'),
    ],
    down: [
      { kind: 'drop-column', tableName: 'users', columnName: 'tenant_account' },
      { kind: 'drop-table', tableName: 'tenant_sessions' },
    ],
  },
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE tenant_sessions (
        session_public_id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        PRIMARY KEY (session_public_id, tenant_id)
      )
    `));
    schema.raw(orm.sql.unsafe('CREATE INDEX tenant_sessions_user_id ON tenant_sessions (user_id)'));
    schema.raw(orm.sql.unsafe('ALTER TABLE users ADD COLUMN tenant_account BOOLEAN NOT NULL DEFAULT FALSE'));
  },
  down({ schema }) {
    schema.dropColumn('users', 'tenant_account');
    schema.dropTable('tenant_sessions');
  },
} satisfies Migration;
