import { BaseEntity, Column, Entity, PrimaryColumn } from '@cossackframework/database';

/**
 * A counter of attempts in a window: sign-ins by email and by client address, second-factor
 * codes by account, reset requests. The ID names what is counted; an email is hashed in it.
 */
@Entity({ tableName: 'auth_attempts' })
export class AuthAttempt extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  @Column({ type: 'integer', name: 'attempts' })
  declare attempts: number;

  /** When the window ends and the count starts again. */
  @Column({ type: 'datetime', name: 'expires_at' })
  declare expiresAt: Date;
}
