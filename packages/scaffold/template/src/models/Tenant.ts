import { BaseEntity, Column, Entity, PrimaryColumn } from '@cossackframework/database';

/**
 * A tenant: an organization with its own database, members and roles. Rows live in the main
 * database only. The main tenant has no row: it is the application's own database.
 */
@Entity({ tableName: 'tenants' })
export class Tenant extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  /** The name in its address, `<slug>.<the application's host>`. */
  @Column({ type: 'varchar', name: 'slug', length: 63, unique: true })
  declare slug: string;

  @Column({ type: 'text', name: 'name' })
  declare name: string;

  /** What `tenantORM` opens: a file's name, or the `{tenant}` of TENANT_DATABASE_URL. */
  @Column({ type: 'varchar', name: 'database', length: 191, unique: true })
  declare database: string;

  /**
   * `creating` until its database is ready. `archived` answers 503 and keeps its data.
   * `deleted` answers 404 and can be restored for 30 days; then it is purged.
   */
  @Column({ type: 'varchar', name: 'status', length: 16, default: 'creating' })
  declare status: 'creating' | 'active' | 'archived' | 'deleted';

  /** The project's own data about this row. */
  @Column({ type: 'json', name: 'meta', nullable: true })
  declare meta: Record<string, unknown> | null;

  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  declare deletedAt: Date | null;

  @Column({ type: 'datetime', name: 'created_at' })
  declare createdAt: Date;
}
