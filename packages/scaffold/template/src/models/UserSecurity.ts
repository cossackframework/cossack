import { BaseEntity, Column, Entity, PrimaryColumn } from '@cossackframework/database';

/** A user's authenticator app and recovery codes. A row exists once a setup was started. */
@Entity({ tableName: 'user_security' })
export class UserSecurity extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'user_id', length: 191 })
  declare userId: string;

  @Column({ type: 'text', name: 'totp_secret', nullable: true })
  declare totpSecret: string | null;

  /** Set when the authenticator was confirmed with a code. Until then it asks for nothing at sign-in. */
  @Column({ type: 'datetime', name: 'totp_confirmed_at', nullable: true })
  declare totpConfirmedAt: Date | null;

  /** The last time step a code was accepted for, so each code works once. */
  @Column({ type: 'integer', name: 'totp_last_step', nullable: true })
  declare totpLastStep: number | null;

  /** Hashes of the unused recovery codes. */
  @Column({ type: 'json', name: 'recovery', nullable: true })
  declare recovery: string[] | null;

  @Column({ type: 'datetime', name: 'updated_at' })
  declare updatedAt: Date;
}
