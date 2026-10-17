import type { NotificationRecord, NotificationStore, NotificationFinish } from './contracts';
export interface NotificationStateDatabase {
  prepare(sql: string): { bind(...values: (string | number | null)[]): {
    first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes?: number } }>;
  } };
}
/** Explicit migration/setup SQL. Contains private notification data; protect this database. */
export const notificationStateSchema = `CREATE TABLE IF NOT EXISTS cossack_notifications (
 id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('email','in-app')), record_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','provider-accepted','failed','unknown','delivered')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
 is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)), code TEXT, message_id TEXT,
 token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, sending TEXT CHECK(sending IN ('none','provider'))
);
CREATE INDEX IF NOT EXISTS cossack_notifications_inbox ON cossack_notifications(tenant_id,user_id,channel,status,created_at,id);`;
export class NotificationPersistenceError extends Error {
  readonly code = 'NOTIFICATION_STORE_FAILED';
  constructor() { super('Notification persistence failed.'); this.name = 'NotificationPersistenceError'; }
}
interface Row { sending: 'none' | 'provider' | null; record_json: string; status: NotificationRecord['status']; updated_at: number; attempt: number; is_read: number; code: NotificationRecord['code'] | null; message_id: string | null; }
const statuses = new Set(['queued', 'provider-accepted', 'failed', 'unknown', 'delivered']);
const codes = new Set(['NOTIFICATION_PREFERENCE_DISABLED', 'NOTIFICATION_PREFERENCES_UNAVAILABLE', 'NOTIFICATION_PROVIDER_REJECTED', 'NOTIFICATION_DELIVERY_UNKNOWN', 'NOTIFICATION_CHANNEL_UNAVAILABLE']);
function identity(value: unknown): asserts value is string { if (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError('Invalid notification identity.'); }
function timestamp(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid notification timestamp.'); }
function record(row: Row): NotificationRecord {
  try { const base = JSON.parse(row.record_json) as NotificationRecord;
    return { ...base, status: row.status, updatedAt: row.updated_at, attempt: row.attempt, read: row.is_read === 1,
      ...(row.code ? { code: row.code } : {}), ...(row.message_id ? { messageId: row.message_id } : {}) };
  } catch { throw new NotificationPersistenceError(); }
}
/** Durable fenced delivery ledger; never automatically reclaim ambiguous non-idempotent sends. */
export function createSqlNotificationStore(database: NotificationStateDatabase): NotificationStore {
  if (!database || typeof database.prepare !== 'function') throw new TypeError('A notification state database is required.');
  async function first(sql: string, values: (string | number | null)[]): Promise<Row | null> {
    try { return await database.prepare(sql).bind(...values).first<Row>(); } catch { throw new NotificationPersistenceError(); }
  }
  async function run(sql: string, values: (string | number | null)[]): Promise<boolean> {
    try { return (await database.prepare(sql).bind(...values).run()).meta.changes === 1; } catch { throw new NotificationPersistenceError(); }
  }
  return {
    durability: 'durable',
    async insert(value) {
      identity(value.id); identity(value.recipient.tenantId); identity(value.recipient.userId);
      if (!/^[a-f0-9]{64}$/.test(value.key) || !['email','in-app'].includes(value.channel) || value.status !== 'queued' || value.attempt !== 0 || value.read !== false) throw new TypeError('Invalid initial notification state.');
      timestamp(value.createdAt); timestamp(value.updatedAt);
      let encoded: string;
      try { encoded = JSON.stringify(value); } catch { throw new TypeError('Notification state must contain JSON data.'); }
      if (new TextEncoder().encode(encoded).byteLength > 256 * 1024) throw new TypeError('Notification state exceeds its size limit.');
      const inserted = await first(`INSERT INTO cossack_notifications (id,key,tenant_id,user_id,channel,record_json,status,created_at,updated_at,attempt,is_read)
        VALUES (?,?,?,?,?,?,'queued',?,?,0,0) ON CONFLICT(key) DO NOTHING RETURNING *`, [value.id,value.key,value.recipient.tenantId,value.recipient.userId,value.channel,encoded,value.createdAt,value.updatedAt]);
      const existing = inserted ?? await first('SELECT * FROM cossack_notifications WHERE key=?', [value.key]);
      if (!existing) throw new NotificationPersistenceError();
      return { created: !!inserted, record: record(existing) };
    },
    async get(id) { identity(id); const found = await first('SELECT * FROM cossack_notifications WHERE id=?', [id]); return found ? record(found) : undefined; },
    async claim(id, options) {
      identity(id); timestamp(options.now);
      if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs < 1 || options.leaseMs > 86400000 || !Number.isSafeInteger(options.now + options.leaseMs)) throw new TypeError('Invalid notification lease.');
      const uncertain = await first(`UPDATE cossack_notifications SET status='unknown',code='NOTIFICATION_DELIVERY_UNKNOWN',updated_at=?,token=NULL,lease_until=0,sending=NULL
        WHERE id=? AND status='queued' AND sending='none' AND lease_until<=? RETURNING *`, [options.now,id,options.now]);
      if (uncertain) return { status: 'terminal', record: record(uncertain) };
      const token = crypto.randomUUID();
      const acquired = await first(`UPDATE cossack_notifications SET token=?,lease_until=?,updated_at=?,attempt=attempt+1
        WHERE id=? AND status='queued' AND (token IS NULL OR lease_until<=?) AND (sending IS NULL OR sending='provider') RETURNING *`, [token,options.now+options.leaseMs,options.now,id,options.now]);
      if (acquired) return { status: 'acquired', token, record: record(acquired), ...(acquired.sending ? { sending: acquired.sending } : {}) };
      const found = await first('SELECT * FROM cossack_notifications WHERE id=?', [id]);
      if (!found) return { status: 'missing' };
      return found.status === 'queued' ? { status: 'busy' } : { status: 'terminal', record: record(found) };
    },
    async beginSend(id, token, options) {
      identity(id); identity(token); timestamp(options.now);
      if (!['none','provider'].includes(options.idempotency)) throw new TypeError('Invalid notification provider capability.');
      return run(`UPDATE cossack_notifications SET sending=?,updated_at=? WHERE id=? AND token=? AND status='queued' AND channel='email' AND lease_until>? AND (sending IS NULL OR sending=?)`, [options.idempotency,options.now,id,token,options.now,options.idempotency]);
    },
    async finish(id, token, result: NotificationFinish) {
      identity(id); identity(token); timestamp(result.now);
      if (!statuses.has(result.status) || result.code !== undefined && !codes.has(result.code)) throw new TypeError('Invalid notification outcome.');
      if (result.messageId !== undefined) identity(result.messageId);
      return run(`UPDATE cossack_notifications SET status=?,updated_at=?,code=?,message_id=?,token=NULL,lease_until=0,
        sending=CASE WHEN ?='queued' AND ?='NOTIFICATION_DELIVERY_UNKNOWN' AND sending='provider' THEN sending ELSE NULL END
        WHERE id=? AND token=? AND status='queued' AND lease_until>?
        AND (?<>'queued' OR sending IS NULL OR ?='NOTIFICATION_PROVIDER_REJECTED' OR (sending='provider' AND ?='NOTIFICATION_DELIVERY_UNKNOWN'))
        AND (?<>'provider-accepted' OR (channel='email' AND sending IS NOT NULL))
        AND (?<>'delivered' OR (channel='in-app' AND sending IS NULL))`, [result.status,result.now,result.code??null,result.messageId??null,result.status,result.code??null,id,token,result.now,result.status,result.code??null,result.code??null,result.status,result.status]);
    },
    async list(recipient, options) {
      identity(recipient.tenantId); identity(recipient.userId);
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new TypeError('Invalid notification list limit.');
      try {
        const rows = await database.prepare(`SELECT * FROM cossack_notifications WHERE tenant_id=? AND user_id=? AND channel='in-app' AND status='delivered' ORDER BY created_at DESC,id LIMIT ?`)
          .bind(recipient.tenantId,recipient.userId,options.limit).all<Row>();
        return rows.results.map(record);
      } catch { throw new NotificationPersistenceError(); }
    },
    async setRead(id, recipient, read) {
      identity(id); identity(recipient.tenantId); identity(recipient.userId);
      if (typeof read !== 'boolean') throw new TypeError('Invalid notification read state.');
      return run(`UPDATE cossack_notifications SET is_read=? WHERE id=? AND tenant_id=? AND user_id=? AND channel='in-app' AND status='delivered'`, [read?1:0,id,recipient.tenantId,recipient.userId]);
    },
    async recordDelivered(id, messageId, now) {
      identity(id); identity(messageId); timestamp(now);
      return run(`UPDATE cossack_notifications SET status='delivered',updated_at=? WHERE id=? AND channel='email' AND status='provider-accepted' AND message_id=?`, [now,id,messageId]);
    },
  };
}

/** The same ledger on a D1 binding. */
export const createD1NotificationStore = createSqlNotificationStore;
