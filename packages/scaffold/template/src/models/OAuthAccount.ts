import {
  BaseEntity,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from '@cossackframework/orm';
import { User } from './User';

@Entity({ tableName: 'oauth_accounts' })
export class OAuthAccount extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  @Column({ type: 'varchar', name: 'user_id', length: 191 })
  declare userId: string;

  @Column({ type: 'varchar', name: 'provider', length: 191 })
  declare provider: string;

  @Column({ type: 'varchar', name: 'provider_user_id', length: 191 })
  declare providerUserId: string;

  @Column({ type: 'varchar', name: 'created_at', length: 32 })
  declare createdAt: string;

  @ManyToOne(() => User, (user) => user.oauthAccounts)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  declare user: Relation<User>;
}
