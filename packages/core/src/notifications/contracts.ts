export interface NotificationSchema<T> { parse(value: unknown): Promise<T>; }
declare const notificationHtmlBrand: unique symbol;
/** Escaping helpers produce this type; author casts/raw HTML remain author-trusted. */
export type NotificationHtml = string & { readonly [notificationHtmlBrand]: true };
export interface NotificationContent { subject: string; text: string; html: NotificationHtml; }
export interface NotificationTemplate<T> { schema: NotificationSchema<T>; render(data: T): NotificationContent | Promise<NotificationContent>; }
export function defineNotificationTemplate<T>(template: NotificationTemplate<T>): NotificationTemplate<T> { return template; }
export type NotificationRegistry = Record<string, NotificationTemplate<any>>;
export type NotificationData<T> = T extends NotificationTemplate<infer D> ? D : never;
export type NotificationChannel = 'email' | 'in-app';
/** Resolve these keys on the server from authenticated application context. */
export interface NotificationRecipient { tenantId: string; userId: string; email?: string; }
export type NotificationStatus = 'queued' | 'provider-accepted' | 'failed' | 'unknown' | 'delivered';
export type NotificationFailureCode = 'NOTIFICATION_PREFERENCE_DISABLED' | 'NOTIFICATION_PREFERENCES_UNAVAILABLE'
    | 'NOTIFICATION_PROVIDER_REJECTED' | 'NOTIFICATION_DELIVERY_UNKNOWN' | 'NOTIFICATION_CHANNEL_UNAVAILABLE';
export interface EmailDeliveryProvider {
    /** Provider must actually enforce a stable key across retries/restarts. */
    readonly idempotency: 'provider' | 'none';
    send(message: { to: string; from: string; subject: string; html: string; text: string }, context: { idempotencyKey: string }): Promise<{ status: 'provider-accepted'; messageId?: string }>;
}
const deliveryErrors = new WeakSet<object>();
export class NotificationDeliveryError extends Error {
    readonly outcome: 'rejected' | 'unknown';
    readonly retryable: boolean;
    constructor(outcome: 'rejected' | 'unknown', options: { retryable?: boolean } = {}) {
        super('Notification provider delivery failed.'); this.name = 'NotificationDeliveryError';
        this.outcome = outcome; this.retryable = options.retryable === true; deliveryErrors.add(this);
    }
}
export function isNotificationDeliveryError(error: unknown): error is NotificationDeliveryError {
    return typeof error === 'object' && error !== null && deliveryErrors.has(error);
}
/** Adapter-private persistence record: never expose data/email through inspection APIs. */
export interface NotificationRecord {
    id: string; key: string; template: string; channel: NotificationChannel;
    recipient: NotificationRecipient; content: NotificationContent; data: unknown;
    status: NotificationStatus; createdAt: number; updatedAt: number; attempt: number; read: boolean;
    code?: NotificationFailureCode; messageId?: string;
}
export type NotificationClaim = { status: 'acquired'; token: string; record: NotificationRecord; sending?: EmailDeliveryProvider['idempotency'] }
    | { status: 'busy' } | { status: 'missing' } | { status: 'terminal'; record: NotificationRecord };
export interface NotificationFinish {
    status: NotificationStatus; now: number; code?: NotificationFailureCode; messageId?: string;
}
/** Mutations are atomic and claim-token fenced. Durable adapters persist the
 * sending marker before effects. Expired non-idempotent sending claims become
 * unknown, never acquired again. Email delivery evidence is a trusted server input. */
export interface NotificationStore {
    readonly durability: 'process' | 'durable';
    insert(record: NotificationRecord): Promise<{ created: boolean; record: NotificationRecord }>;
    get(id: string): Promise<NotificationRecord | undefined>;
    claim(id: string, options: { now: number; leaseMs: number }): Promise<NotificationClaim>;
    beginSend(id: string, token: string, options: { now: number; idempotency: EmailDeliveryProvider['idempotency'] }): Promise<boolean>;
    finish(id: string, token: string, result: NotificationFinish): Promise<boolean>;
    list(recipient: Pick<NotificationRecipient, 'tenantId' | 'userId'>, options: { limit: number }): Promise<readonly NotificationRecord[]>;
    setRead(id: string, recipient: Pick<NotificationRecipient, 'tenantId' | 'userId'>, read: boolean): Promise<boolean>;
    recordDelivered(id: string, messageId: string, now: number): Promise<boolean>;
}
export interface NotificationInspection { id: string; template: string; channel: NotificationChannel; status: NotificationStatus; attempt: number; createdAt: number; updatedAt: number; code?: NotificationFailureCode; }
export interface InAppNotification { id: string; template: string; content: NotificationContent; createdAt: number; read: boolean; }
