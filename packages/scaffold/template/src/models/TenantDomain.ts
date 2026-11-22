import { BaseEntity, Column, Entity, Index, PrimaryColumn } from '@cossackframework/database';

/** A host name of its own that reaches a tenant, besides `<slug>.<the application's host>`. */
@Entity({ tableName: 'tenant_domains' })
export class TenantDomain extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'host', length: 191 })
  declare host: string;

  @Index('tenant_domains_tenant_id')
  @Column({ type: 'varchar', name: 'tenant_id', length: 191 })
  declare tenantId: string;

  /** The tenant's address: its other hosts redirect here. At most one per tenant. */
  @Column({ type: 'boolean', name: 'is_primary', default: false })
  declare isPrimary: boolean;

  /** When the host was shown to point at this application. Only a verified domain reaches the tenant. */
  @Column({ type: 'datetime', name: 'verified_at', nullable: true })
  declare verifiedAt: Date | null;

  @Column({ type: 'datetime', name: 'created_at' })
  declare createdAt: Date;
}
