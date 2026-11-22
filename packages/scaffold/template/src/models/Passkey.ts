import { BaseEntity, Column, Entity, Index, PrimaryColumn } from '@cossackframework/database';

/** A passkey (WebAuthn credential) of a user. The ID is the credential's own. */
@Entity({ tableName: 'passkeys' })
export class Passkey extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  @Index('passkeys_user_id')
  @Column({ type: 'varchar', name: 'user_id', length: 191 })
  declare userId: string;

  @Column({ type: 'text', name: 'name' })
  declare name: string;

  @Column({ type: 'text', name: 'public_key' })
  declare publicKey: string;

  /** The authenticator's signature counter; it only moves forward. */
  @Column({ type: 'integer', name: 'sign_count' })
  declare signCount: number;

  @Column({ type: 'json', name: 'transports', nullable: true })
  declare transports: string[] | null;

  @Column({ type: 'text', name: 'device_type', nullable: true })
  declare deviceType: string | null;

  @Column({ type: 'boolean', name: 'backed_up' })
  declare backedUp: boolean;

  @Column({ type: 'datetime', name: 'created_at' })
  declare createdAt: Date;

  @Column({ type: 'datetime', name: 'last_used_at', nullable: true })
  declare lastUsedAt: Date | null;
}
