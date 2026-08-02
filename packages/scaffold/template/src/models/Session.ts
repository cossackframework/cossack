import {
  BaseEntity,
  Column,
  Entity,
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

  @Column({ type: 'varchar', name: 'user_id', length: 191, nullable: true })
  declare userId: string | null;

  @Column({ type: 'text', name: 'data', nullable: true })
  declare data: string | null;

  @Column({ type: 'text', name: 'meta', nullable: true })
  declare meta: string | null;

  @Column({ type: 'text', name: 'location', nullable: true })
  declare location: string | null;

  @Column({ type: 'text', name: 'user_agent', nullable: true })
  declare userAgent: string | null;

  @Column({ type: 'text', name: 'ip_address', nullable: true })
  declare ipAddress: string | null;

  @Column({ type: 'varchar', name: 'created_at', length: 32, default: '' })
  declare createdAt: string;

  @Column({ type: 'varchar', name: 'expires_at', length: 32 })
  declare expiresAt: string;

  @ManyToOne(() => User, (user) => user.sessions, { nullable: true })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  declare user: Relation<User | null>;
}
