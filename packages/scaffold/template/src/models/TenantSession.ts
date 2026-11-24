import { BaseEntity, Column, Entity, Index, PrimaryColumn } from '@cossackframework/database';

/**
 * Which tenants a session of the main host reached, in the main database. A tenant keeps its
 * sessions in its own database; this row is how ending the main session finds and ends the
 * sessions made from it. The session is named by its public ID, which rotation keeps.
 */
@Entity({ tableName: 'tenant_sessions' })
export class TenantSession extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'session_public_id', length: 36 })
  declare sessionPublicId: string;

  @PrimaryColumn({ type: 'varchar', name: 'tenant_id', length: 191 })
  declare tenantId: string;

  @Index('tenant_sessions_user_id')
  @Column({ type: 'varchar', name: 'user_id', length: 191 })
  declare userId: string;

  @Column({ type: 'datetime', name: 'created_at' })
  declare createdAt: Date;
}
