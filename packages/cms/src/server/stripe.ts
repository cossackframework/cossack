/**
 * Stripe as the payments provider: Checkout Sessions over its REST API (form-encoded, no SDK),
 * and webhooks verified with the signing secret (HMAC-SHA256 over `t.payload`, five minutes of
 * tolerance). The events the CMS relays: a completed checkout, a succeeded or failed payment, a
 * subscription change or end, a refund. Others answer 200 and are not relayed.
 */
import { CmsError } from '../errors';
import type { PaymentEvent } from '../hooks';
import { checkCheckout, type Checkout, type CheckoutInput, type PaymentsProvider } from './payments';
import { sha256Hex, timingSafeEqual } from './tokens';

export const STRIPE_API = 'https://api.stripe.com';
/** How old a webhook's timestamp may be. */
export const STRIPE_TOLERANCE_MS = 5 * 60_000;

export interface StripePaymentsOptions {
    readonly secretKey: string;
    /** The endpoint's signing secret (`whsec_…`); without it webhooks are refused. */
    readonly webhookSecret?: string;
    readonly api?: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly now?: () => number;
}

const TYPES: { readonly [stripe: string]: PaymentEvent['type'] } = {
    'checkout.session.completed': 'checkout.completed', 'payment_intent.succeeded': 'payment.succeeded', 'payment_intent.payment_failed': 'payment.failed',
    'customer.subscription.created': 'subscription.updated', 'customer.subscription.updated': 'subscription.updated', 'customer.subscription.deleted': 'subscription.cancelled',
    'charge.refunded': 'refund',
};

export function stripePayments(options: StripePaymentsOptions): PaymentsProvider {
    const api = (options.api ?? STRIPE_API).replace(/\/$/, '');
    const fetcher = options.fetch ?? globalThis.fetch;
    const now = options.now ?? Date.now;
    return {
        name: 'stripe',
        async checkout(raw: CheckoutInput): Promise<Checkout> {
            const input = checkCheckout(raw);
            const form = new URLSearchParams();
            form.set('mode', input.mode!);
            form.set('success_url', input.successUrl);
            form.set('cancel_url', input.cancelUrl);
            if (input.customerEmail) form.set('customer_email', input.customerEmail);
            if (input.reference) form.set('client_reference_id', input.reference);
            if (input.priceId) { form.set('line_items[0][price]', input.priceId); form.set('line_items[0][quantity]', '1'); }
            else {
                form.set('line_items[0][price_data][currency]', input.currency!.toLowerCase());
                form.set('line_items[0][price_data][unit_amount]', String(input.amount));
                form.set('line_items[0][price_data][product_data][name]', input.description!.trim());
                form.set('line_items[0][quantity]', '1');
            }
            for (const [key, value] of Object.entries(input.metadata ?? {})) form.set(`metadata[${key}]`, value);
            const response = await fetcher(`${api}/v1/checkout/sessions`, { method: 'POST', headers: { authorization: `Bearer ${options.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
            const data = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: { message?: string } };
            if (!response.ok || !data.id || !data.url) throw new CmsError('CMS_UNAVAILABLE', `Stripe refused the checkout: ${data.error?.message ?? response.status}`);
            return { id: data.id, url: data.url };
        },
        async webhook(request: Request): Promise<PaymentEvent | null> {
            if (!options.webhookSecret) throw new CmsError('CMS_FORBIDDEN', 'No Stripe webhook secret is configured.');
            const body = await request.text();
            const header = request.headers.get('stripe-signature') ?? '';
            const parts = Object.fromEntries(header.split(',').map(part => part.split('=', 2) as [string, string]));
            const timestamp = Number(parts.t);
            const signatures = header.split(',').filter(part => part.startsWith('v1=')).map(part => part.slice(3));
            if (!Number.isFinite(timestamp) || !signatures.length) throw new CmsError('CMS_FORBIDDEN', 'The webhook signature is missing.');
            if (Math.abs(now() - timestamp * 1000) > STRIPE_TOLERANCE_MS) throw new CmsError('CMS_FORBIDDEN', 'The webhook is too old.');
            const expected = await hmacHex(options.webhookSecret, `${timestamp}.${body}`);
            if (!signatures.some(signature => signature.length === expected.length && timingSafeEqual(signature, expected))) throw new CmsError('CMS_FORBIDDEN', 'The webhook signature does not match.');
            const event = JSON.parse(body) as { id: string; type: string; created: number; data: { object: Record<string, unknown> } };
            const type = TYPES[event.type];
            if (!type) return null;
            const object = event.data?.object ?? {};
            const metadata = object.metadata && typeof object.metadata === 'object' ? Object.fromEntries(Object.entries(object.metadata as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string> : {};
            const amount = typeof object.amount_total === 'number' ? object.amount_total : typeof object.amount === 'number' ? object.amount : typeof object.amount_received === 'number' ? object.amount_received : null;
            return {
                eventId: `payment:stripe:${event.id}`, topic: 'payment.event', at: now(), provider: 'stripe', type, providerType: event.type,
                checkoutId: typeof object.id === 'string' && event.type.startsWith('checkout.') ? object.id : null,
                reference: typeof object.client_reference_id === 'string' ? object.client_reference_id : metadata.reference ?? null,
                customerEmail: typeof object.customer_email === 'string' ? object.customer_email : (object.customer_details as { email?: string } | undefined)?.email ?? null,
                amount, currency: typeof object.currency === 'string' ? object.currency.toUpperCase() : null, metadata, object,
            };
        },
    };
}

async function hmacHex(secret: string, text: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
    return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The event ID Stripe gives, for tests and logs. */
export { sha256Hex as stripeHash };
