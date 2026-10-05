import type { NotificationClaim, NotificationFinish, NotificationRecord, NotificationRecipient, NotificationStore } from './contracts';
interface StoredNotification { record: NotificationRecord; token?: string; expiresAt?: number; sending?: 'provider' | 'none'; }
export type MemoryNotificationSnapshot = readonly [string, StoredNotification][];
/** Explicit process-only test store. Snapshots simulate restart; they are not durable storage. */
export class MemoryNotificationStore implements NotificationStore {
    readonly durability = 'process' as const;
    private records: Map<string, StoredNotification>;
    private keys = new Map<string, string>();
    constructor(snapshot: MemoryNotificationSnapshot = []) {
        this.records = new Map(structuredClone(snapshot));
        for (const [id, item] of this.records) this.keys.set(item.record.key, id);
    }
    snapshot(): MemoryNotificationSnapshot { return structuredClone([...this.records]); }
    async insert(record: NotificationRecord): Promise<{ created: boolean; record: NotificationRecord }> {
        if (record.status !== 'queued' || record.attempt !== 0 || record.read !== false || !/^[a-f0-9]{64}$/.test(record.key)
            || typeof record.id !== 'string' || !record.id || record.id.length > 128) throw new Error('Notification storage record is invalid.');
        const existing = this.keys.get(record.key);
        if (existing) return { created: false, record: structuredClone(this.records.get(existing)!.record) };
        if (this.records.has(record.id)) throw new Error('Notification storage identity conflict.');
        const copy = structuredClone(record); this.records.set(copy.id, { record: copy }); this.keys.set(copy.key, copy.id);
        return { created: true, record: structuredClone(copy) };
    }
    async get(id: string): Promise<NotificationRecord | undefined> { const item = this.records.get(id); return item ? structuredClone(item.record) : undefined; }
    async claim(id: string, options: { now: number; leaseMs: number }): Promise<NotificationClaim> {
        const item = this.records.get(id); if (!item) return { status: 'missing' };
        if (item.record.status !== 'queued') return { status: 'terminal', record: structuredClone(item.record) };
        if (item.token && item.expiresAt! > options.now) return { status: 'busy' };
        if (item.sending === 'none') {
            item.record.status = 'unknown'; item.record.code = 'NOTIFICATION_DELIVERY_UNKNOWN'; item.record.updatedAt = options.now;
            delete item.token; delete item.expiresAt; delete item.sending;
            return { status: 'terminal', record: structuredClone(item.record) };
        }
        item.token = crypto.randomUUID(); item.expiresAt = options.now + options.leaseMs;
        item.record.attempt++; item.record.updatedAt = options.now;
        return { status: 'acquired', token: item.token, record: structuredClone(item.record), ...(item.sending ? { sending: item.sending } : {}) };
    }
    async beginSend(id: string, token: string, options: { now: number; idempotency: 'provider' | 'none' }): Promise<boolean> {
        const item = this.records.get(id);
        if (!item || item.token !== token || item.expiresAt! <= options.now || item.record.status !== 'queued') return false;
        if (item.sending === 'provider' && options.idempotency !== 'provider') return false;
        item.sending = options.idempotency; item.record.updatedAt = options.now; return true;
    }
    async finish(id: string, token: string, result: NotificationFinish): Promise<boolean> {
        const item = this.records.get(id);
        if (!item || item.token !== token || item.expiresAt! <= result.now || item.record.status !== 'queued') return false;
        if (result.status === 'provider-accepted' && (item.record.channel !== 'email' || !item.sending)) return false;
        if (result.status === 'delivered' && (item.record.channel !== 'in-app' || item.sending)) return false;
        if (result.status === 'queued' && item.sending && result.code !== 'NOTIFICATION_PROVIDER_REJECTED'
            && !(item.sending === 'provider' && result.code === 'NOTIFICATION_DELIVERY_UNKNOWN')) return false;
        item.record.status = result.status; item.record.updatedAt = result.now;
        delete item.record.code; delete item.record.messageId;
        if (result.code) item.record.code = result.code;
        if (result.messageId) item.record.messageId = result.messageId;
        delete item.token; delete item.expiresAt;
        if (!(result.status === 'queued' && result.code === 'NOTIFICATION_DELIVERY_UNKNOWN' && item.sending === 'provider')) delete item.sending;
        return true;
    }
    async list(recipient: Pick<NotificationRecipient, 'tenantId' | 'userId'>, options: { limit: number }): Promise<readonly NotificationRecord[]> {
        return [...this.records.values()].map(item => item.record).filter(item => item.channel === 'in-app' && item.status === 'delivered'
            && item.recipient.tenantId === recipient.tenantId && item.recipient.userId === recipient.userId)
            .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, options.limit).map(item => structuredClone(item));
    }
    async setRead(id: string, recipient: Pick<NotificationRecipient, 'tenantId' | 'userId'>, read: boolean): Promise<boolean> {
        const item = this.records.get(id);
        if (!item || item.record.channel !== 'in-app' || item.record.status !== 'delivered' || item.record.recipient.tenantId !== recipient.tenantId || item.record.recipient.userId !== recipient.userId) return false;
        item.record.read = read; return true;
    }
    async recordDelivered(id: string, messageId: string, now: number): Promise<boolean> {
        const item = this.records.get(id);
        if (!item || item.record.channel !== 'email' || item.record.status !== 'provider-accepted' || item.record.messageId !== messageId) return false;
        item.record.status = 'delivered'; item.record.updatedAt = now; return true;
    }
}
