/** Webhooks: their events, shape and URL rules. Client-safe; the host stores and sends them. */
export const WEBHOOK_EVENTS = Object.freeze(['entry.created', 'entry.updated', 'entry.published', 'entry.unpublished', 'entry.deleted'] as const);
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly events: readonly WebhookEvent[];
    /** Collection names; empty for all. */
    readonly collections: readonly string[];
    /** Signs each delivery: `X-Cossack-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`. */
    readonly secret: string;
    readonly active: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface WebhookInput {
    readonly name: string;
    readonly url: string;
    readonly events: readonly string[];
    readonly collections?: readonly string[];
    readonly active?: boolean;
}

export interface WebhookDelivery {
    readonly id: string;
    readonly webhookId: string;
    readonly event: string;
    readonly status: 'pending' | 'delivered' | 'failed';
    readonly attempts: number;
    readonly responseStatus: number | null;
    readonly error: string | null;
    readonly createdAt: number;
    readonly deliveredAt: number | null;
    readonly nextAttemptAt: number;
}

/** What a delivery posts. */
export interface WebhookPayload {
    readonly event: WebhookEvent | 'ping';
    /** Stable across retries: the outbox event and the webhook event. */
    readonly eventId: string;
    readonly at: number;
    readonly collection?: string;
    readonly entry?: { readonly [field: string]: unknown };
    readonly previousStatus?: string | null;
}

/** HTTPS anywhere; plain HTTP only for this machine, for development. */
export function webhookUrlProblem(url: string): string | undefined {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return 'Enter a full URL, such as https://example.com/hooks/cms.'; }
    if (url.length > 2000 || parsed.username || parsed.password) return 'Enter a URL of at most 2000 characters, without credentials.';
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) return 'Webhooks use HTTPS, except to this machine.';
    return undefined;
}
