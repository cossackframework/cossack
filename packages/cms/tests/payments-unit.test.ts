import { describe, expect, it } from 'vitest';
import { checkCheckout } from '../src/server/payments';
import { stripePayments } from '../src/server/stripe';

const sign = async (secret: string, timestamp: number, body: string) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
    return `t=${timestamp},v1=${[...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
};

describe('payments', () => {
    it('checks a checkout request', () => {
        expect(() => checkCheckout({ successUrl: '/done', cancelUrl: 'https://x.test/c' })).toThrow(/absolute/);
        expect(() => checkCheckout({ amount: 0, currency: 'usd', description: 'x', successUrl: 'https://x.test/d', cancelUrl: 'https://x.test/c' })).toThrow(/amount/);
        expect(() => checkCheckout({ amount: 500, currency: 'dollars', description: 'x', successUrl: 'https://x.test/d', cancelUrl: 'https://x.test/c' })).toThrow(/currency/);
        expect(checkCheckout({ amount: 500, currency: 'usd', description: 'Hat', successUrl: 'https://x.test/d', cancelUrl: 'https://x.test/c' })).toMatchObject({ mode: 'payment', metadata: {} });
        expect(checkCheckout({ priceId: 'price_1', successUrl: 'https://x.test/d', cancelUrl: 'https://x.test/c' }).mode).toBe('subscription');
    });

    it('creates a Stripe checkout session with a form body', async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        const stripe = stripePayments({ secretKey: 'sk_test_1', api: 'https://stripe.test', fetch: (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return Response.json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }); }) as typeof fetch });
        const checkout = await stripe.checkout({ amount: 1250, currency: 'EUR', description: 'A hat', successUrl: 'https://shop.test/thanks', cancelUrl: 'https://shop.test/cart', customerEmail: 'ada@example.com', reference: 'order-9', metadata: { plugin: 'shop' } });
        expect(checkout).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
        expect(calls[0]!.url).toBe('https://stripe.test/v1/checkout/sessions');
        expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk_test_1');
        const form = new URLSearchParams(String(calls[0]!.init.body));
        expect(Object.fromEntries(form)).toMatchObject({ mode: 'payment', success_url: 'https://shop.test/thanks', customer_email: 'ada@example.com', client_reference_id: 'order-9',
            'line_items[0][price_data][currency]': 'eur', 'line_items[0][price_data][unit_amount]': '1250', 'line_items[0][price_data][product_data][name]': 'A hat', 'line_items[0][quantity]': '1', 'metadata[plugin]': 'shop' });
        const refused = stripePayments({ secretKey: 'sk', fetch: (async () => Response.json({ error: { message: 'No such price' } }, { status: 400 })) as typeof fetch });
        await expect(refused.checkout({ priceId: 'price_x', successUrl: 'https://s.test/a', cancelUrl: 'https://s.test/b' })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
    });

    it('verifies webhook signatures and relays the events the CMS knows', async () => {
        const now = Date.parse('2026-11-07T12:00:00Z');
        const stripe = stripePayments({ secretKey: 'sk', webhookSecret: 'whsec_test', now: () => now });
        const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', created: Math.floor(now / 1000), data: { object: { id: 'cs_1', client_reference_id: 'order-9', customer_details: { email: 'ada@example.com' }, amount_total: 1250, currency: 'eur', metadata: { plugin: 'shop' } } } });
        const request = (signature: string) => new Request('https://shop.test/api/cms/payments/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body });
        const event = await stripe.webhook(request(await sign('whsec_test', Math.floor(now / 1000), body)));
        expect(event).toMatchObject({ eventId: 'payment:stripe:evt_1', type: 'checkout.completed', providerType: 'checkout.session.completed', checkoutId: 'cs_1', reference: 'order-9', customerEmail: 'ada@example.com', amount: 1250, currency: 'EUR', metadata: { plugin: 'shop' } });
        await expect(stripe.webhook(request(await sign('whsec_other', Math.floor(now / 1000), body)))).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(stripe.webhook(request(await sign('whsec_test', Math.floor(now / 1000) - 600, body)))).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(stripe.webhook(request('nonsense'))).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        const other = JSON.stringify({ id: 'evt_2', type: 'customer.created', created: Math.floor(now / 1000), data: { object: {} } });
        expect(await stripe.webhook(new Request('https://shop.test/x', { method: 'POST', headers: { 'stripe-signature': await sign('whsec_test', Math.floor(now / 1000), other) }, body: other }))).toBeNull();
        await expect(stripePayments({ secretKey: 'sk' }).webhook(request('t=1,v1=a'))).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
    });
});
