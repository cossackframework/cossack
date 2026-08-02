import {
  BaseEntity,
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from '@cossackframework/orm';
import { OAuthAccount } from './OAuthAccount';
import { Session } from './Session';
import { UserRole } from './UserRole';

export interface RoleAssignment {
  id: string;
  name: string;
  permissions: string[];
}

@Entity({ tableName: 'users' })
export class User extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 191 })
  declare id: string;

  @Column({ type: 'varchar', name: 'email', length: 191, unique: true })
  declare email: string;

  @Column({ type: 'text', name: 'name', nullable: true })
  declare name: string | null;

  @Column({ type: 'text', name: 'password_hash', nullable: true })
  declare passwordHash: string | null;

  @Column({ type: 'text', name: 'avatar', nullable: true })
  declare avatar: string | null;

  @Column({ type: 'text', name: 'meta', nullable: true })
  declare meta: string | null;

  @Column({ type: 'varchar', name: 'created_at', length: 32 })
  declare createdAt: string;

  @OneToMany(() => Session, (session) => session.user)
  declare sessions: Relation<Session[]>;

  @OneToMany(() => OAuthAccount, (account) => account.user)
  declare oauthAccounts: Relation<OAuthAccount[]>;

  @OneToMany(() => UserRole, (assignment) => assignment.user)
  declare roleAssignments: Relation<UserRole[]>;
}

declare module '@cossackframework/core' {
  interface User {
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    meta: Record<string, unknown> | null;
    roles: RoleAssignment[];
  }
}
