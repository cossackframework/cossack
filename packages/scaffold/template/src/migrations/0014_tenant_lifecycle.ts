import { sql, type Migration } from '@cossackframework/database';

// Tenants: a domain is verified before it serves and one may be primary; a deleted tenant can
// be restored for a while; the network of tenants has its own settings.
export default {
  name: '0014_tenant_lifecycle',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up: [
      sql.unsafe('ALTER TABLE tenant_domains ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE'),
      sql.unsafe('ALTER TABLE tenant_domains ADD COLUMN verified_at VARCHAR(32)'),
      sql.unsafe('ALTER TABLE tenants ADD COLUMN deleted_at VARCHAR(32)'),
      sql.unsafe(`
      CREATE TABLE tenant_network (
        "key" VARCHAR(191) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at VARCHAR(32) NOT NULL
      )
    `),
    ],
    down: [
      { kind: 'drop-table', tableName: 'tenant_network' },
      { kind: 'drop-column', tableName: 'tenants', columnName: 'deleted_at' },
      { kind: 'drop-column', tableName: 'tenant_domains', columnName: 'verified_at' },
      { kind: 'drop-column', tableName: 'tenant_domains', columnName: 'is_primary' },
    ],
  },
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe('ALTER TABLE tenant_domains ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE'));
    schema.raw(orm.sql.unsafe('ALTER TABLE tenant_domains ADD COLUMN verified_at VARCHAR(32)'));
    schema.raw(orm.sql.unsafe('ALTER TABLE tenants ADD COLUMN deleted_at VARCHAR(32)'));
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE tenant_network (
        "key" VARCHAR(191) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at VARCHAR(32) NOT NULL
      )
    `));
  },
  down({ schema }) {
    schema.dropTable('tenant_network');
    schema.dropColumn('tenants', 'deleted_at');
    schema.dropColumn('tenant_domains', 'verified_at');
    schema.dropColumn('tenant_domains', 'is_primary');
  },
} satisfies Migration;
