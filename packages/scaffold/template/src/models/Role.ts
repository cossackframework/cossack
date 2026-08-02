import {
  BaseEntity,
  Column,
  CreateDateColumn,
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

  @Column({ type: 'json', name: 'permissions', nullable: true })
  declare permissions: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  declare createdAt: Date;

  @OneToMany(() => UserRole, (assignment) => assignment.role)
  declare userAssignments: Relation<UserRole[]>;
}
