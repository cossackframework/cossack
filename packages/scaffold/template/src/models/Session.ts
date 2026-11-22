import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from '@cossackframework/database';
import { User } from './User';

@Entity({ tableName: 'sessions' })
export class Session extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  /** Independent public reference for account session management. */
  @Index('sessions_public_id_unique', { unique: true })
  @Column({ type: 'varchar', name: 'public_id', length: 36, nullable: true, unique: true })
  declare publicId: string | null;

  @Column({ type: 'varchar', name: 'user_id', length: 191, nullable: true })
  declare userId: string | null;

  @Column({ type: 'json', name: 'data', nullable: true })
  declare data: Record<string, unknown> | null;

  @Column({ type: 'json', name: 'meta', nullable: true })
  declare meta: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'location', nullable: true })
  declare location: string | null;

  @Column({ type: 'text', name: 'user_agent', nullable: true })
  declare userAgent: string | null;

  @Column({ type: 'text', name: 'ip_address', nullable: true })
  declare ipAddress: string | null;

  /** The sign-in used a second factor: an authenticator or recovery code, or a passkey. */
  @Column({ type: 'boolean', name: 'second_factor', default: false })
  declare secondFactor: boolean;

  /** In a tenant's database: the public ID of the main host's session this one was made from (shared sign-in). */
  @Index('sessions_parent_id')
  @Column({ type: 'varchar', name: 'parent_id', length: 191, nullable: true })
  declare parentId: string | null;

  @CreateDateColumn({ name: 'created_at', default: '' })
  declare createdAt: Date;

  @Column({ type: 'datetime', name: 'expires_at' })
  declare expiresAt: Date;

  @ManyToOne(() => User, (user) => user.sessions, { nullable: true })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  declare user: Relation<User | null>;
}
