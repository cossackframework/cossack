import { PermanentJobError, TransientJobError } from '../jobs/contracts';
import { isNotificationDeliveryError, type EmailDeliveryProvider, type InAppNotification, type NotificationChannel, type NotificationContent, type NotificationData, type NotificationFailureCode, type NotificationHtml, type NotificationInspection, type NotificationRecipient, type NotificationRecord, type NotificationRegistry, type NotificationStatus, type NotificationStore } from './contracts';
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
function invalid(): never { throw new TypeError('Notification configuration or input is invalid.'); }
function bounded(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value); }
export function escapeNotificationHtml(value: string): NotificationHtml {
    if (typeof value !== 'string') invalid();
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)) as NotificationHtml;
}
/** Literal markup is author-trusted; every interpolation is escaped as text. */
export function notificationHtml(strings: TemplateStringsArray, ...values: readonly (string | number | boolean | null | undefined)[]): NotificationHtml {
    return strings.reduce((result, literal, index) => result + literal + (index < values.length ? escapeNotificationHtml(String(values[index] ?? '')) : ''), '') as NotificationHtml;
}
function recipientValue(value: NotificationRecipient): NotificationRecipient {
    if (!value || !bounded(value.tenantId, 256) || !bounded(value.userId, 256)) invalid();
    if (value.email !== undefined && (!bounded(value.email, 320) || !/^[^\s@]+@[^\s@]+$/.test(value.email))) invalid();
    return { tenantId: value.tenantId, userId: value.userId, ...(value.email === undefined ? {} : { email: value.email }) };
}
function jsonData(value: unknown): unknown {
    let count = 0;
    const visit = (item: unknown, depth: number): unknown => {
        if (++count > 10000 || depth > 32) invalid();
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (typeof item !== 'object' || item === null) invalid();
        if (Array.isArray(item)) {
            if (Object.getPrototypeOf(item) !== Array.prototype) invalid();
            const length = Object.getOwnPropertyDescriptor(item, 'length');
            if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > 10000) invalid();
            const keys = Reflect.ownKeys(item);
            if (keys.length !== length.value + 1) invalid();
            for (const key of keys) {
                if (key === 'length') continue;
                if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length.value) invalid();
            }
            const entries: unknown[] = [];
            for (let index = 0; index < length.value; index++) {
                const field = Object.getOwnPropertyDescriptor(item, String(index));
                if (!field || !('value' in field) || !field.enumerable) invalid();
                entries[index] = visit(field.value, depth + 1);
            }
            return entries;
        }
        if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) invalid();
        const result: Record<string, unknown> = Object.create(null);
        const keys: string[] = [];
        const ownKeys = Reflect.ownKeys(item);
        if (ownKeys.length > 10000) invalid();
        for (const key of ownKeys) {
            if (typeof key !== 'string') invalid();
            keys.push(key);
        }
        for (const key of keys.sort()) {
            const field = Object.getOwnPropertyDescriptor(item, key)!;
            if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !('value' in field) || !field.enumerable) invalid();
            if (field.value !== undefined) result[key] = visit(field.value, depth + 1);
        }
        return result;
    };
    const result = visit(value, 0);
    if (new TextEncoder().encode(JSON.stringify(result)).length > 120 * 1024) invalid();
    return result;
}
function contentValue(value: NotificationContent): NotificationContent {
    if (!value || !bounded(value.subject, 998) || typeof value.text !== 'string' || typeof value.html !== 'string' || value.text.length > 120000 || value.html.length > 120000) invalid();
    return { subject: value.subject, text: value.text, html: value.html };
}
function inspection(record: NotificationRecord): NotificationInspection {
    return { id: record.id, template: record.template, channel: record.channel, status: record.status, attempt: record.attempt,
        createdAt: record.createdAt, updatedAt: record.updatedAt, ...(record.code ? { code: record.code } : {}) };
}
async function identity(parts: readonly string[]): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
export interface NotificationRuntimeOptions<T extends NotificationRegistry> {
    namespace: string;
    templates: T;
    store: NotificationStore;
    /** Compose this with the existing jobs dispatcher using id as its stable key. */
    dispatch(id: string, recipient: Readonly<NotificationRecipient>): Promise<unknown>;
    preferences(context: { recipient: Readonly<NotificationRecipient>; template: keyof T & string; channel: NotificationChannel }): boolean | Promise<boolean>;
    email?: { provider: EmailDeliveryProvider; from: string };
    now?: () => number;
    leaseMs?: number;
    maxAttempts?: number;
}
export interface NotificationEnqueueOptions { recipient: NotificationRecipient; channel: NotificationChannel; idempotencyKey?: string; }
export interface NotificationEnqueueResult { status: NotificationStatus | 'suppressed'; id?: string; }
export interface NotificationRuntime<T extends NotificationRegistry> {
    preview<K extends keyof T & string>(name: K, data: NotificationData<T[K]>): Promise<NotificationContent>;
    enqueue<K extends keyof T & string>(name: K, data: NotificationData<T[K]>, options: NotificationEnqueueOptions): Promise<NotificationEnqueueResult>;
    deliver(id: string): Promise<NotificationInspection>;
    inspect(id: string): Promise<NotificationInspection | undefined>;
    list(recipient: Pick<NotificationRecipient, 'tenantId' | 'userId'>, options?: { limit?: number }): Promise<readonly InAppNotification[]>;
    setRead(id: string, recipient: Pick<NotificationRecipient, 'tenantId' | 'userId'>, read: boolean): Promise<boolean>;
    /** Call only after authenticating an actual provider delivery receipt/webhook. */
    recordDelivered(id: string, evidence: { messageId: string }): Promise<boolean>;
}
export function createNotificationRuntime<T extends NotificationRegistry>(options: NotificationRuntimeOptions<T>): NotificationRuntime<T> {
    if (!IDENTIFIER.test(options.namespace) || !options.store || !['process', 'durable'].includes(options.store.durability)
        || typeof options.dispatch !== 'function' || typeof options.preferences !== 'function') invalid();
    const templates = Object.assign(Object.create(null), options.templates) as T;
    for (const [name, template] of Object.entries(templates)) if (!IDENTIFIER.test(name) || typeof template.schema?.parse !== 'function' || typeof template.render !== 'function') invalid();
    if (!Object.keys(templates).length) invalid();
    if (options.email && (!['none', 'provider'].includes(options.email.provider.idempotency) || typeof options.email.provider.send !== 'function' || !bounded(options.email.from, 320) || !/^[^\s@]+@[^\s@]+$/.test(options.email.from))) invalid();
    const now = options.now ?? Date.now, leaseMs = options.leaseMs ?? 60000, maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 86400000 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) invalid();
    async function render<K extends keyof T & string>(name: K, data: NotificationData<T[K]>): Promise<{ data: unknown; content: NotificationContent }> {
        const template = templates[name]; if (!template) invalid();
        let parsed: unknown;
        try { parsed = await template.schema.parse(jsonData(data)); } catch { invalid(); }
        let snapshot: unknown;
        let content: NotificationContent;
        try { snapshot = jsonData(parsed); content = contentValue(await template.render(parsed)); } catch { invalid(); }
        return { data: snapshot, content };
    }
    async function latest(id: string): Promise<NotificationInspection> { const record = await options.store.get(id); if (!record) throw new PermanentJobError(); return inspection(record); }
    async function deliver(id: string): Promise<NotificationInspection> {
        if (!bounded(id, 128)) invalid();
        const claim = await options.store.claim(id, { now: now(), leaseMs });
        if (claim.status === 'missing') throw new PermanentJobError();
        if (claim.status === 'busy') throw new TransientJobError();
        if (claim.status === 'terminal') return inspection(claim.record);
        const { record, token } = claim;
        const finish = async (status: NotificationStatus, code?: NotificationFailureCode, messageId?: string): Promise<NotificationInspection> => {
            const committed = await options.store.finish(id, token, { status, now: now(), ...(code ? { code } : {}), ...(messageId ? { messageId } : {}) });
            if (!committed) throw new TransientJobError();
            if (status === 'queued') throw new TransientJobError();
            return latest(id);
        };
        let enabled: boolean;
        try { enabled = await options.preferences({ recipient: { ...record.recipient }, template: record.template as keyof T & string, channel: record.channel }); }
        catch {
            if (claim.sending) return finish(record.attempt < maxAttempts ? 'queued' : 'unknown', 'NOTIFICATION_DELIVERY_UNKNOWN');
            return finish(record.attempt < maxAttempts ? 'queued' : 'failed', 'NOTIFICATION_PREFERENCES_UNAVAILABLE');
        }
        if (enabled !== true) return claim.sending ? finish('unknown', 'NOTIFICATION_DELIVERY_UNKNOWN') : finish('failed', 'NOTIFICATION_PREFERENCE_DISABLED');
        if (record.channel === 'in-app') return finish('delivered');
        if (!options.email || !record.recipient.email) return claim.sending ? finish('unknown', 'NOTIFICATION_DELIVERY_UNKNOWN') : finish('failed', 'NOTIFICATION_CHANNEL_UNAVAILABLE');
        const provider = options.email.provider;
        if (claim.sending === 'provider' && provider.idempotency !== 'provider') return finish('unknown', 'NOTIFICATION_DELIVERY_UNKNOWN');
        if (!await options.store.beginSend(id, token, { now: now(), idempotency: provider.idempotency })) throw new TransientJobError();
        let response: Awaited<ReturnType<EmailDeliveryProvider['send']>>;
        try { response = await provider.send({ to: record.recipient.email, from: options.email.from, ...record.content }, { idempotencyKey: record.key }); }
        catch (error) {
            let rejected = false, retryable = false;
            if (isNotificationDeliveryError(error)) {
                rejected = Object.getOwnPropertyDescriptor(error, 'outcome')?.value === 'rejected';
                retryable = Object.getOwnPropertyDescriptor(error, 'retryable')?.value === true;
            }
            // A current rejection cannot disprove earlier ambiguous acceptance.
            const uncertain = claim.sending === 'provider' || !rejected;
            const code = uncertain ? 'NOTIFICATION_DELIVERY_UNKNOWN' : 'NOTIFICATION_PROVIDER_REJECTED';
            const safeRetry = rejected ? retryable : provider.idempotency === 'provider';
            return finish(safeRetry && record.attempt < maxAttempts ? 'queued' : uncertain ? 'unknown' : 'failed', code);
        }
        let status: PropertyDescriptor | undefined, messageId: PropertyDescriptor | undefined;
        try {
            status = response && Object.getOwnPropertyDescriptor(response, 'status');
            messageId = response && Object.getOwnPropertyDescriptor(response, 'messageId');
        } catch { /* An untrustworthy receipt is uncertain, not rejection. */ }
        if (!status || !('value' in status) || status.value !== 'provider-accepted' || (messageId && (!('value' in messageId) || (messageId.value !== undefined && !bounded(messageId.value, 256))))) {
            return finish(provider.idempotency === 'provider' && record.attempt < maxAttempts ? 'queued' : 'unknown', 'NOTIFICATION_DELIVERY_UNKNOWN');
        }
        return finish('provider-accepted', undefined, messageId?.value as string | undefined);
    }
    return {
        async preview(name, data) { return (await render(name, data)).content; },
        async enqueue(name, data, config) {
            if (!config || !['email', 'in-app'].includes(config.channel)) invalid();
            const recipient = recipientValue(config.recipient);
            if (config.idempotencyKey !== undefined && !bounded(config.idempotencyKey, 512)) invalid();
            const rendered = await render(name, data);
            let enabled: boolean;
            try { enabled = await options.preferences({ recipient: { ...recipient }, template: name, channel: config.channel }); } catch { throw new Error('Notification preferences are unavailable.'); }
            if (enabled !== true) return { status: 'suppressed' };
            const id = crypto.randomUUID(), timestamp = now();
            const key = await identity([options.namespace, name, config.channel, recipient.tenantId, recipient.userId, config.idempotencyKey ?? id]);
            const inserted = await options.store.insert({ id, key, template: name, channel: config.channel, recipient, data: rendered.data, content: rendered.content,
                status: 'queued', createdAt: timestamp, updatedAt: timestamp, attempt: 0, read: false });
            const record = inserted.record;
            if (record.template !== name || record.channel !== config.channel || JSON.stringify(record.recipient) !== JSON.stringify(recipient)
                || JSON.stringify(record.data) !== JSON.stringify(rendered.data) || JSON.stringify(record.content) !== JSON.stringify(rendered.content)) throw new Error('Notification idempotency identity conflicts with different content.');
            if (record.status === 'queued') await options.dispatch(record.id, { ...record.recipient });
            return { status: record.status, id: record.id };
        },
        deliver,
        async inspect(id) { if (!bounded(id, 128)) invalid(); const record = await options.store.get(id); return record ? inspection(record) : undefined; },
        async list(recipient, config = {}) {
            const scope = recipientValue(recipient), limit = config.limit ?? 100;
            if (!Number.isInteger(limit) || limit < 1 || limit > 1000) invalid();
            const records = await options.store.list(scope, { limit });
            return records.map(record => ({ id: record.id, template: record.template, content: { ...record.content }, createdAt: record.createdAt, read: record.read }));
        },
        async setRead(id, recipient, read) { if (!bounded(id, 128) || typeof read !== 'boolean') invalid(); return options.store.setRead(id, recipientValue(recipient), read); },
        async recordDelivered(id, evidence) { if (!bounded(id, 128) || !evidence || !bounded(evidence.messageId, 256)) invalid(); return options.store.recordDelivered(id, evidence.messageId, now()); },
    };
}
