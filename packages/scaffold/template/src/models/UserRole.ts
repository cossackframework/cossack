import {
  BaseEntity,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from '@cossackframework/orm';
import { Role } from './Role';
import { User } from './User';

@Entity({ tableName: 'user_roles' })
export class UserRole extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'user_id', length: 191 })
  declare userId: string;

  @PrimaryColumn({ type: 'varchar', name: 'role_id', length: 191 })
  declare roleId: string;

  @Column({ type: 'varchar', name: 'created_at', length: 32 })
  declare createdAt: string;

  @ManyToOne(() => User, (user) => user.roleAssignments)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  declare user: Relation<User>;

  @ManyToOne(() => Role, (role) => role.userAssignments)
  @JoinColumn({ name: 'role_id', referencedColumnName: 'id' })
  declare role: Relation<Role>;
}
