import { BaseEntity, Column, Entity, PrimaryColumn } from '@cossackframework/database';

/** Settings of the network of tenants, in the main database: whether it runs, and what comes later. */
@Entity({ tableName: 'tenant_network' })
export class TenantNetwork extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'key', length: 191 })
  declare key: string;

  @Column({ type: 'text', name: 'value' })
  declare value: string;

  @Column({ type: 'datetime', name: 'updated_at' })
  declare updatedAt: Date;
}
