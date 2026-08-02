import { BaseEntity, Column, Entity, Index, PrimaryColumn } from '@cossackframework/database';

@Entity({ tableName: 'cache_items' })
export class CacheItem extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'key', length: 191 })
  declare key: string;

  @Column({ type: 'json', name: 'value' })
  declare value: unknown;

  @Index('cache_items_expires_at_index')
  @Column({ type: 'bigint', name: 'expires_at', nullable: true })
  declare expiresAt: number | null;

  @Column({ type: 'bigint', name: 'updated_at' })
  declare updatedAt: number;
}
