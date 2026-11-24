import { BaseEntity, Column, Entity, PrimaryColumn } from '@cossackframework/database';

/**
 * A one-time code that carries a sign-in from the main host to a tenant's host
 * (`tenants.signIn: 'shared'`). Only the code's hash is kept, for a minute.
 */
@Entity({ tableName: 'tenant_handoffs' })
export class TenantHandoff extends BaseEntity {
  /** SHA-256 of the code. */
  @PrimaryColumn({ type: 'varchar', name: 'id', length: 64 })
  declare id: string;

  /** The main host's session the code was issued for. */
  @Column({ type: 'varchar', name: 'session_id', length: 191 })
  declare sessionId: string;

  @Column({ type: 'varchar', name: 'user_id', length: 191 })
  declare userId: string;

  /** The tenant the code is for; empty for the main tenant. */
  @Column({ type: 'varchar', name: 'tenant_id', length: 191 })
  declare tenantId: string;

  @Column({ type: 'datetime', name: 'expires_at' })
  declare expiresAt: Date;
}
