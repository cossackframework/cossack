import {
  BaseEntity,
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from '@cossackframework/database';
import { UserRole } from './UserRole';

@Entity({ tableName: 'roles' })
export class Role extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  @Column({ type: 'varchar', name: 'name', length: 191, unique: true })
  declare name: string;

  @Column({ type: 'text', name: 'permissions', nullable: true })
  declare permissions: string | null;

  @Column({ type: 'varchar', name: 'created_at', length: 32 })
  declare createdAt: string;

  @OneToMany(() => UserRole, (assignment) => assignment.role)
  declare userAssignments: Relation<UserRole[]>;
}
