import { BaseEntity, Column, Entity, PrimaryColumn } from '@cossackframework/database';

/**
 * A short-lived step of a sign-in: a password waiting for its second factor (`signin`), or a
 * passkey ceremony (`passkey-register`, `passkey-signin`). Its random ID goes to the browser.
 */
@Entity({ tableName: 'auth_challenges' })
export class AuthChallenge extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  @Column({ type: 'varchar', name: 'kind', length: 32 })
  declare kind: string;

  @Column({ type: 'varchar', name: 'user_id', length: 191, nullable: true })
  declare userId: string | null;

  @Column({ type: 'text', name: 'challenge' })
  declare challenge: string;

  /** Wrong codes given for a pending sign-in. */
  @Column({ type: 'integer', name: 'attempts' })
  declare attempts: number;

  @Column({ type: 'datetime', name: 'expires_at' })
  declare expiresAt: Date;
}
