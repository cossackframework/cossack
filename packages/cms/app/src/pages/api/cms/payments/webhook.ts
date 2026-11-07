import type { Context } from 'hono';
import { isCmsError } from '@cossackframework/cms';

/**
 * The payments provider's webhook: `POST /api/cms/payments/webhook`, signed by the provider
 * (Stripe's `Stripe-Signature`). A known event is queued for plugins as `cms.payment.event`;
 * an unknown type answers 200 and is dropped; a bad signature answers 400.
 */
export const POST = async (c: Context) => {
    const cms = c.get('cms');
    try {
        const event = await cms.receivePayment(c.req.raw);
        return c.json(event ? { received: true, eventId: event.eventId, type: event.type } : { received: true, ignored: true }, 200, { 'cache-control': 'no-store' });
    } catch (error) {
        if (isCmsError(error, 'CMS_UNAVAILABLE')) return c.json({ error: error.message, code: error.code }, 404);
        if (isCmsError(error)) return c.json({ error: error.message, code: error.code }, 400);
        throw error;
    }
};
