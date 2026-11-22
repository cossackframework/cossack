import { BaseEntity, Column, Entity, Index, PrimaryColumn } from '@cossackframework/database';

/**
 * An account's membership of a tenant, in the main database: which tenants an account can
 * reach. The member's roles are in the tenant's own database.
 */
@Entity({ tableName: 'tenant_members' })
export class TenantMember extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'tenant_id', length: 191 })
  declare tenantId: string;

  @Index('tenant_members_user_id')
  @PrimaryColumn({ type: 'varchar', name: 'user_id', length: 191 })
  declare userId: string;

  @Column({ type: 'datetime', name: 'created_at' })
  declare createdAt: Date;
}
