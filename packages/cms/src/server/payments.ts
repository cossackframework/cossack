/**
 * Payments: one provider the application configures (Stripe built in, or its own) that plugins
 * with the `payments` capability start checkouts through, and whose webhooks become
 * `cms.payment.event` actions delivered from the outbox. Products, orders, plans and invoices are
 * a plugin's own resources; the CMS keeps the money boundary and the event.
 */
import type { PaymentEvent } from '../hooks';

export interface CheckoutInput {
    /** The amount in the currency's minor unit, such as cents; omitted with `priceId`. */
    readonly amount?: number;
    /** ISO 4217, lower or upper case. */
    readonly currency?: string;
    /** What is bought, shown by the provider. */
    readonly description?: string;
    /** A provider price for a subscription or a catalog item, instead of `amount`. */
    readonly priceId?: string;
    readonly mode?: 'payment' | 'subscription';
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly customerEmail?: string;
    /** The plugin's own key for the order, returned with the event as `reference`. */
    readonly reference?: string;
    readonly metadata?: { readonly [key: string]: string };
}

export interface Checkout {
    readonly id: string;
    /** Where the buyer goes to pay. */
    readonly url: string;
}

export interface PaymentsProvider {
    readonly name: string;
    checkout(input: CheckoutInput): Promise<Checkout>;
    /** The event a webhook request carries, verified; null for a type the CMS does not relay. Throws `CMS_FORBIDDEN` for a bad signature. */
    webhook(request: Request): Promise<PaymentEvent | null>;
}

const CURRENCY = /^[A-Za-z]{3}$/;
const URL_OK = /^https?:\/\/[^\s]{1,2000}$/;

/** A checkout request within the rules, or an error naming what is wrong. */
export function checkCheckout(input: CheckoutInput): CheckoutInput {
    if (!input || typeof input !== 'object') throw new Error('A checkout needs its fields.');
    if (!URL_OK.test(input.successUrl ?? '') || !URL_OK.test(input.cancelUrl ?? '')) throw new Error('successUrl and cancelUrl must be absolute http(s) URLs.');
    const mode = input.mode ?? (input.priceId ? 'subscription' : 'payment');
    if (mode !== 'payment' && mode !== 'subscription') throw new Error('mode is payment or subscription.');
    if (!input.priceId) {
        if (!Number.isSafeInteger(input.amount) || (input.amount as number) <= 0) throw new Error('amount is a positive whole number of the currency\'s minor unit.');
        if (!CURRENCY.test(input.currency ?? '')) throw new Error('currency is a three-letter code.');
        if (typeof input.description !== 'string' || !input.description.trim() || input.description.length > 200) throw new Error('description is 1 to 200 characters.');
    }
    if (input.customerEmail !== undefined && (typeof input.customerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail))) throw new Error('customerEmail must be an email address.');
    if (input.reference !== undefined && (typeof input.reference !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(input.reference))) throw new Error('reference is 1-200 printable characters.');
    const metadata = input.metadata ?? {};
    if (Object.keys(metadata).length > 20 || Object.entries(metadata).some(([key, value]) => !/^[A-Za-z0-9_.-]{1,40}$/.test(key) || typeof value !== 'string' || value.length > 500)) throw new Error('metadata is up to 20 short string entries.');
    return { ...input, mode, metadata };
}
