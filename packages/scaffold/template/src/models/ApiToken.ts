import { BaseEntity, Column, Entity, Index, PrimaryColumn } from '@cossackframework/database';

/**
 * An application password: a named token a user creates for apps and scripts. Only the hash of
 * its secret is kept. A request with it acts as the user, with their current roles.
 */
@Entity({ tableName: 'api_tokens' })
export class ApiToken extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  @Index('api_tokens_user_id')
  @Column({ type: 'varchar', name: 'user_id', length: 191 })
  declare userId: string;

  @Column({ type: 'text', name: 'name' })
  declare name: string;

  @Column({ type: 'varchar', name: 'secret_hash', length: 64 })
  declare secretHash: string;

  /** `read` tokens may only read. */
  @Column({ type: 'varchar', name: 'scope', length: 16 })
  declare scope: 'read' | 'write';

  @Column({ type: 'datetime', name: 'created_at' })
  declare createdAt: Date;

  @Column({ type: 'datetime', name: 'last_used_at', nullable: true })
  declare lastUsedAt: Date | null;

  @Column({ type: 'datetime', name: 'expires_at', nullable: true })
  declare expiresAt: Date | null;
}
