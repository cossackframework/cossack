/** Webhooks: their events, shape and URL rules. Client-safe; the host stores and sends them. */
/**
 * Entry events; `form.submitted` for each kept or sent form submission (not spam), going to
 * webhooks for all collections or for Forms; `note.created` and `note.resolved` for editors'
 * review notes on an entry, going to webhooks for the entry's collection; and
 * `payment.completed` for a checkout or payment the payments provider confirmed, going to
 * webhooks for all collections.
 */
export const WEBHOOK_EVENTS = Object.freeze(['entry.created', 'entry.updated', 'entry.published', 'entry.unpublished', 'entry.deleted', 'form.submitted', 'note.created', 'note.resolved', 'payment.completed'] as const);
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly events: readonly WebhookEvent[];
    /** Collection names; empty for all. */
    readonly collections: readonly string[];
    /** The signing secret's first characters, to tell webhooks apart; the secret itself comes once at creation, or from `secret(id)`. */
    readonly secretHint: string;
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
    /** `form.submitted`: the form and the submission. */
    readonly form?: { readonly id: string; readonly slug: string; readonly title: string };
    readonly submission?: { readonly [field: string]: unknown };
    readonly previousStatus?: string | null;
    /** `note.created` and `note.resolved`: the note, with `entry` naming its entry (`id`, `title`, the editor's `url`). */
    readonly note?: { readonly [field: string]: unknown };
    /** `payment.completed`: the `PaymentEvent` without the provider's object (`provider`, `type`, `checkoutId`, `reference`, `customerEmail`, `amount`, `currency`, `metadata`). */
    readonly payment?: { readonly [field: string]: unknown };
}

/**
 * HTTPS to a public address. A site in development (`local`) may also use plain HTTP and its
 * own machine or network, for a local receiver; otherwise addresses that name this machine or a
 * private network are refused, so a site's webhooks cannot reach services behind the server.
 * Names are not resolved here; pass `webhookFetch` (such as `publicOnlyFetch` from
 * `@cossackframework/cms/node`) to refuse a name that resolves to a private address when sending.
 */
export function webhookUrlProblem(url: string, options: { local?: boolean } = {}): string | undefined {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return 'Enter a full URL, such as https://example.com/hooks/cms.'; }
    if (url.length > 2000 || parsed.username || parsed.password) return 'Enter a URL of at most 2000 characters, without credentials.';
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'Webhooks use HTTPS.';
    if (options.local) return parsed.protocol === 'https:' || privateHost(parsed.hostname) ? undefined : 'Webhooks use HTTPS, except to this machine or network.';
    if (parsed.protocol !== 'https:') return 'Webhooks use HTTPS.';
    if (privateHost(parsed.hostname)) return 'Webhooks go to public addresses, not this machine or a private network.';
    return undefined;
}

/** Whether a URL's host names this machine or a private, link-local or shared network. */
function privateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return privateAddress(host);
    if (host.startsWith('[')) return privateAddress(host.slice(1, -1));
    // A bare number or hex form is an IPv4 address in another spelling.
    return /^(0x[0-9a-f]+|\d+)$/.test(host);
}

/**
 * Whether an IP address (dotted IPv4, or IPv6 without brackets) is this machine, a private,
 * link-local, shared or multicast network, or unspecified. For checking what a name resolves to.
 */
export function privateAddress(address: string): boolean {
    const ip = address.toLowerCase();
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)?.slice(1).map(Number);
    if (v4) {
        const [a, b] = v4 as [number, number];
        return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    }
    if (!ip.includes(':')) return true;
    // IPv4-mapped and IPv4-compatible forms carry an IPv4 address; refuse them all rather than parse.
    return ip === '::' || ip === '::1' || ip.startsWith('::') || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('ff') || ip.startsWith('64:ff9b:');
}
