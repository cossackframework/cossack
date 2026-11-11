/**
 * Stripe as the payments provider: Checkout Sessions over its REST API (form-encoded, no SDK),
 * and webhooks verified with the signing secret (HMAC-SHA256 over `t.payload`, five minutes of
 * tolerance). The events the CMS relays: a completed checkout (pending while its payment is
 * on its way, completed or failed when it arrives), a succeeded or failed payment, a paid or
 * failed invoice (a subscription's payments), a subscription change or end, a refund. Others
 * answer 200 and are not relayed.
 *
 * Which event completes a payment (`completes`, what `payment.completed` fires for) rests on
 * documented fields only: a paid checkout, and a paid invoice unless it is the first invoice
 * (`billing_reason: subscription_create`) of a subscription a CMS checkout made, which that
 * checkout already completed. A payment intent repeats one of those, so it never completes.
 */
import { CmsError } from '../errors';
import type { PaymentEvent } from '../hooks';
import { checkCheckout, type Checkout, type CheckoutInput, type PaymentsProvider } from './payments';
import { sha256Hex, timingSafeEqual } from './tokens';

export const STRIPE_API = 'https://api.stripe.com';
/** The metadata key that marks a payment or subscription a CMS checkout made. */
const CHECKOUT_MARK = 'cms_checkout';
/** How old a webhook's timestamp may be. */
export const STRIPE_TOLERANCE_MS = 5 * 60_000;
/** How long a webhook waits for a lookup in Stripe's API before relaying without it. */
export const STRIPE_LOOKUP_MS = 5_000;

export interface StripePaymentsOptions {
    readonly secretKey: string;
    /** The endpoint's signing secret (`whsec_…`); without it webhooks are refused. */
    readonly webhookSecret?: string;
    readonly api?: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly now?: () => number;
    /** How long a webhook waits for a lookup in Stripe's API; {@link STRIPE_LOOKUP_MS} by default. */
    readonly lookupMs?: number;
}

const TYPES: { readonly [stripe: string]: PaymentEvent['type'] } = {
    // A completed checkout whose payment is still on its way (a bank transfer, SEPA) is pending until one of the async events says how it went.
    'checkout.session.completed': 'checkout.completed', 'checkout.session.async_payment_succeeded': 'checkout.completed', 'checkout.session.async_payment_failed': 'payment.failed',
    'payment_intent.succeeded': 'payment.succeeded', 'payment_intent.payment_failed': 'payment.failed',
    'invoice.paid': 'payment.succeeded', 'invoice.payment_failed': 'payment.failed',
    'customer.subscription.created': 'subscription.updated', 'customer.subscription.updated': 'subscription.updated', 'customer.subscription.deleted': 'subscription.cancelled',
    'charge.refunded': 'refund',
};

export function stripePayments(options: StripePaymentsOptions): PaymentsProvider {
    const api = (options.api ?? STRIPE_API).replace(/\/$/, '');
    const fetcher = options.fetch ?? globalThis.fetch;
    const now = options.now ?? Date.now;
    /** A GET of Stripe's API, or nothing when it does not answer in time. */
    const lookup = async <T>(path: string): Promise<T | undefined> => {
        try {
            const response = await fetcher(`${api}${path}`, { headers: { authorization: `Bearer ${options.secretKey}` }, signal: AbortSignal.timeout(options.lookupMs ?? STRIPE_LOOKUP_MS) });
            return response.ok ? await response.json() as T : undefined;
        } catch {
            return undefined;
        }
    };
    /** The metadata of an invoice's subscription, or nothing when Stripe does not answer. */
    const invoiceMetadata = async (id: string): Promise<Record<string, unknown> | undefined> => {
        if (!/^in_[A-Za-z0-9]{1,200}$/.test(id)) return undefined;
        const data = await lookup<{ parent?: { subscription_details?: { metadata?: Record<string, unknown> } }; subscription_details?: { metadata?: Record<string, unknown> } }>(`/v1/invoices/${id}`);
        return data?.parent?.subscription_details?.metadata ?? data?.subscription_details?.metadata;
    };
    /**
     * The invoice a charge paid. Charges name it (`invoice`) before Stripe's 2025-03-31 (basil) API
     * version; from then on the invoice's payment record links it to the charge's payment intent.
     */
    const chargeInvoice = async (charge: Record<string, unknown>): Promise<string | undefined> => {
        if (typeof charge.invoice === 'string') return charge.invoice;
        const intent = charge.payment_intent;
        if (typeof intent !== 'string' || !/^pi_[A-Za-z0-9]{1,200}$/.test(intent)) return undefined;
        const payments = await lookup<{ data?: { invoice?: unknown }[] }>(`/v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=${intent}&limit=1`);
        const invoice = payments?.data?.[0]?.invoice;
        return typeof invoice === 'string' ? invoice : (invoice as { id?: unknown } | undefined)?.id as string | undefined;
    };
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
            // The session's metadata stays on the session: the payment and subscription it makes carry their own copy,
            // with the reference, so their later events (payments, invoices, refunds) name the order too.
            // Both are marked as a checkout's, so the first invoice of its subscription is not counted twice.
            const carried = { ...(input.metadata ?? {}), ...(input.reference ? { reference: input.reference } : {}), [CHECKOUT_MARK]: '1' };
            for (const [key, value] of Object.entries(carried)) form.set(input.mode === 'subscription' ? `subscription_data[metadata][${key}]` : `payment_intent_data[metadata][${key}]`, value);
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
            const object = event.data?.object ?? {};
            const mapped = TYPES[event.type];
            if (!mapped) return null;
            const type: PaymentEvent['type'] = event.type === 'checkout.session.completed' && object.payment_status === 'unpaid' ? 'checkout.pending' : mapped;
            const invoice = event.type.startsWith('invoice.');
            // An invoice has no metadata of its own for a subscription: its subscription's copy is in
            // `parent.subscription_details` (`subscription_details` before Stripe's 2025 API versions).
            const subscription = (object.parent as { subscription_details?: { metadata?: unknown } } | undefined)?.subscription_details ?? (object.subscription_details as { metadata?: unknown } | undefined);
            let given = (invoice ? subscription?.metadata : object.metadata) as Record<string, unknown> | undefined;
            // A refunded subscription payment's charge has no metadata; its invoice's subscription has the order's.
            if (event.type === 'charge.refunded' && !Object.keys(given ?? {}).length) {
                const paid = await chargeInvoice(object);
                if (paid) given = await invoiceMetadata(paid);
            }
            given = given && typeof given === 'object' ? given : {};
            const metadata = Object.fromEntries(Object.entries(given).filter(([key, value]) => typeof value === 'string' && key !== CHECKOUT_MARK)) as Record<string, string>;
            const marked = given[CHECKOUT_MARK] === '1';
            const fromCheckout = event.type.startsWith('checkout.') || marked;
            const completes = (type === 'checkout.completed')
                || (event.type === 'invoice.paid' && !(object.billing_reason === 'subscription_create' && marked));
            // A refund's amount is what was refunded, not the charge it came from; an invoice's is what was paid.
            const amount = event.type === 'charge.refunded' ? (typeof object.amount_refunded === 'number' ? object.amount_refunded : null)
                : invoice ? (typeof object.amount_paid === 'number' && event.type === 'invoice.paid' ? object.amount_paid : typeof object.amount_due === 'number' ? object.amount_due : null)
                : typeof object.amount_total === 'number' ? object.amount_total : typeof object.amount === 'number' ? object.amount : typeof object.amount_received === 'number' ? object.amount_received : null;
            return {
                eventId: `payment:stripe:${event.id}`, topic: 'payment.event', at: now(), provider: 'stripe', type, providerType: event.type,
                checkoutId: typeof object.id === 'string' && event.type.startsWith('checkout.') ? object.id : null, fromCheckout, completes,
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
