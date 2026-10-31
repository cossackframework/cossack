/**
 * Webhooks: entry events posted to other services, such as a static site's build hook. An
 * after-commit handler queues one delivery per matching webhook; `dispatch()` sends due
 * deliveries with an HMAC signature and retries failures with backoff.
 */
import type { RomeDB, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { randomToken } from './tokens';
import { WEBHOOK_EVENTS, webhookUrlProblem, type Webhook, type WebhookDelivery, type WebhookEvent, type WebhookInput, type WebhookPayload } from '../webhooks';

const WRITE = { kind: 'cms.webhooks', retryConflicts: 5 } as const;
/** Waits before attempts 2-6; the sixth failure marks the delivery failed. */
const BACKOFF = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
const COLUMNS = 'id, name, url, events, collections, secret, active, created_at, updated_at';
const DELIVERY_COLUMNS = 'id, webhook_id, event, status, attempts, response_status, error, created_at, delivered_at, next_attempt_at';

export class CmsWebhooks {
    readonly #db: RomeDB;
    readonly #now: () => number;
    readonly #fetch: typeof globalThis.fetch;
    #cache: { at: number; hooks: Promise<Webhook[]> } | undefined;

    constructor(db: RomeDB, options: { now?: () => number; fetch?: typeof globalThis.fetch } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
        this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    }

    async list(): Promise<Webhook[]> {
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_webhooks ORDER BY created_at, id LIMIT 100` }]);
        return result.results[0]!.rows.map(webhookOf);
    }

    async get(id: string): Promise<Webhook | null> {
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_webhooks WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? webhookOf(row) : null;
    }

    /** Create a webhook, or change the one with `id`. A new webhook gets a random secret. */
    async save(input: WebhookInput, options: { id?: string; by?: string | null; collections?: readonly string[] } = {}): Promise<Webhook> {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        const url = typeof input.url === 'string' ? input.url.trim() : '';
        const events = [...new Set(input.events ?? [])];
        const collections = [...new Set(input.collections ?? [])];
        const problems: string[] = [];
        if (!name || name.length > 80) problems.push('Name the webhook in 1-80 characters.');
        const urlProblem = webhookUrlProblem(url);
        if (urlProblem) problems.push(urlProblem);
        if (!events.length || events.some(event => !(WEBHOOK_EVENTS as readonly string[]).includes(event))) problems.push('Choose at least one event.');
        if (options.collections && collections.some(entry => !options.collections!.includes(entry))) problems.push('Choose existing collections.');
        if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '));
        const now = this.#now();
        const id = options.id ?? crypto.randomUUID();
        const params = { $id: id, $name: name, $url: url, $events: JSON.stringify(events), $collections: JSON.stringify(collections), $active: input.active === false ? 0 : 1, $now: now };
        if (options.id) {
            const result = await this.#db.write([{ rql: 'UPDATE cms_webhooks SET name = $name, url = $url, events = $events, collections = $collections, active = $active, updated_at = $now WHERE id = $id', params }], WRITE);
            if (result.results[0]!.affected === 0n) throw new CmsError('CMS_NOT_FOUND', 'Webhook not found.');
        } else {
            await this.#db.write([{
                rql: 'INSERT INTO cms_webhooks (id, name, url, events, collections, secret, active, created_at, updated_at, created_by) VALUES ($id, $name, $url, $events, $collections, $secret, $active, $now, $now, $by)',
                params: { ...params, $secret: `whsec_${randomToken(24)}`, $by: options.by ?? null },
            }], WRITE);
        }
        this.#cache = undefined;
        return (await this.get(id))!;
    }

    async delete(id: string): Promise<void> {
        await this.#db.write([
            { rql: 'DELETE FROM cms_webhook_deliveries WHERE webhook_id = $id', params: { $id: id } },
            { rql: 'DELETE FROM cms_webhooks WHERE id = $id', params: { $id: id } },
        ], WRITE);
        this.#cache = undefined;
    }

    async deliveries(webhookId: string, limit = 20): Promise<WebhookDelivery[]> {
        const result = await this.#db.read([{ rql: `SELECT ${DELIVERY_COLUMNS} FROM cms_webhook_deliveries WHERE webhook_id = $id ORDER BY created_at DESC, id LIMIT ${Math.min(Math.max(limit, 1), 100)}`, params: { $id: webhookId } }]);
        return result.results[0]!.rows.map(deliveryOf);
    }

    /** Whether an active webhook wants any of these events for the collection. */
    async wants(events: readonly WebhookEvent[], collection: string): Promise<boolean> {
        return (await this.#active()).some(hook => events.some(event => hook.events.includes(event)) && (!hook.collections.length || hook.collections.includes(collection)));
    }

    /** Queue the payload for every active webhook that wants the event for this collection. */
    async enqueue(payload: WebhookPayload & { event: WebhookEvent; collection: string }): Promise<number> {
        const hooks = (await this.#active()).filter(hook => hook.events.includes(payload.event) && (!hook.collections.length || hook.collections.includes(payload.collection)));
        if (!hooks.length) return 0;
        const now = this.#now();
        const body = JSON.stringify(payload);
        // Repeated outbox deliveries of the same event queue nothing new.
        await this.#db.write(hooks.map(hook => ({
            rql: `INSERT INTO cms_webhook_deliveries (id, webhook_id, event_id, event, payload, status, attempts, next_attempt_at, lease_until, created_at)
                VALUES ($id, $hook, $key, $event, $payload, 'pending', 0, $now, 0, $now) ON CONFLICT (webhook_id, event_id) DO NOTHING`,
            params: { $id: crypto.randomUUID(), $hook: hook.id, $key: payload.eventId, $event: payload.event, $payload: body, $now: now },
        })), WRITE);
        return hooks.length;
    }

    /** Send due deliveries. Safe to run concurrently: each delivery has one lease holder. */
    async dispatch(options: { limit?: number; signal?: AbortSignal } = {}): Promise<{ delivered: number; failed: number; retrying: number }> {
        const now = this.#now();
        const token = crypto.randomUUID();
        const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
        // Most runs find nothing due: read first, so idle runs write nothing.
        const due = await this.#db.read([{ rql: "SELECT 1 FROM cms_webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= $now AND lease_until <= $now LIMIT 1", params: { $now: now } }]);
        if (!due.results[0]!.rows.length) return { delivered: 0, failed: 0, retrying: 0 };
        await this.#db.write([{
            rql: `UPDATE cms_webhook_deliveries SET lease_token = $token, lease_until = $until, attempts = attempts + 1
                WHERE id IN (SELECT id FROM cms_webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= $now AND lease_until <= $now ORDER BY next_attempt_at, id LIMIT $limit)`,
            params: { $token: token, $until: now + 60_000, $now: now, $limit: limit },
        }], WRITE);
        const claimed = await this.#db.read([{
            rql: `SELECT d.id, d.event, d.payload, d.attempts, w.url, w.secret, w.active FROM cms_webhook_deliveries d LEFT JOIN cms_webhooks w ON w.id = d.webhook_id
                WHERE d.lease_token = $token ORDER BY d.next_attempt_at, d.id`,
            params: { $token: token },
        }]);
        const report = { delivered: 0, failed: 0, retrying: 0 };
        for (const [id, event, payload, attempts, url, secret, active] of claimed.results[0]!.rows) {
            const outcome = url === null || Number(active as bigint) !== 1 ? { ok: false, status: null, error: 'The webhook was removed or turned off.', final: true }
                : await this.#send(url as string, secret as string, event as string, id as string, payload as string, options.signal);
            const attempt = Number(attempts as bigint);
            const final = outcome.ok || ('final' in outcome && outcome.final) || attempt > BACKOFF.length;
            const status = outcome.ok ? 'delivered' : final ? 'failed' : 'pending';
            report[outcome.ok ? 'delivered' : final ? 'failed' : 'retrying']++;
            await this.#db.write([{
                rql: `UPDATE cms_webhook_deliveries SET status = $status, response_status = $response, error = $error, delivered_at = $done, next_attempt_at = $next,
                    lease_token = NULL, lease_until = 0 WHERE id = $id AND lease_token = $token`,
                params: { $status: status, $response: outcome.status, $error: outcome.error, $done: outcome.ok ? this.#now() : null,
                    $next: final ? this.#now() : this.#now() + BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)]!, $id: id as string, $token: token },
            }], WRITE);
        }
        return report;
    }

    /** Send a `ping` to the webhook now and report the answer. Nothing is queued. */
    async ping(id: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
        const hook = await this.get(id);
        if (!hook) throw new CmsError('CMS_NOT_FOUND', 'Webhook not found.');
        const delivery = crypto.randomUUID();
        const payload: WebhookPayload = { event: 'ping', eventId: delivery, at: this.#now() };
        return this.#send(hook.url, hook.secret, 'ping', delivery, JSON.stringify(payload));
    }

    /** Queue a delivery again, such as after fixing the receiving end. */
    async redeliver(deliveryId: string): Promise<void> {
        await this.#db.write([{ rql: "UPDATE cms_webhook_deliveries SET status = 'pending', next_attempt_at = $now, attempts = 0, lease_until = 0 WHERE id = $id", params: { $now: this.#now(), $id: deliveryId } }], WRITE);
    }

    /** Delete settled deliveries older than `olderThanMs` (default 30 days). */
    async prune(olderThanMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
        const params = { $before: this.#now() - olderThanMs };
        const old = await this.#db.read([{ rql: "SELECT 1 FROM cms_webhook_deliveries WHERE status != 'pending' AND created_at <= $before LIMIT 1", params }]);
        if (!old.results[0]!.rows.length) return;
        await this.#db.write([{ rql: "DELETE FROM cms_webhook_deliveries WHERE id IN (SELECT id FROM cms_webhook_deliveries WHERE status != 'pending' AND created_at <= $before LIMIT 500)", params: { $before: this.#now() - olderThanMs } }], WRITE);
    }

    async #send(url: string, secret: string, event: string, delivery: string, body: string, signal?: AbortSignal): Promise<{ ok: boolean; status: number | null; error: string | null }> {
        const timestamp = String(Math.floor(this.#now() / 1000));
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
        try {
            const response = await this.#fetch(url, {
                method: 'POST', body, redirect: 'manual',
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
                headers: {
                    'content-type': 'application/json', 'user-agent': 'Cossack-CMS-Webhook/1', 'x-cossack-event': event, 'x-cossack-delivery': delivery,
                    'x-cossack-timestamp': timestamp, 'x-cossack-signature': `sha256=${[...signature].map(byte => byte.toString(16).padStart(2, '0')).join('')}`,
                },
            });
            await response.body?.cancel().catch(() => undefined);
            return response.ok ? { ok: true, status: response.status, error: null } : { ok: false, status: response.status, error: `The receiver answered ${response.status}.` };
        } catch (error) {
            return { ok: false, status: null, error: (error as Error).name === 'TimeoutError' ? 'No answer within 10 seconds.' : `Could not connect: ${(error as Error).message}`.slice(0, 300) };
        }
    }

    #active(): Promise<Webhook[]> {
        const now = this.#now();
        if (!this.#cache || now - this.#cache.at > 30_000) {
            const hooks = this.list().then(list => list.filter(hook => hook.active));
            this.#cache = { at: now, hooks };
            hooks.catch(() => { this.#cache = undefined; });
        }
        return this.#cache.hooks;
    }
}

/** Verify a delivery's signature, for receivers written in TypeScript. */
export async function verifyWebhookSignature(secret: string, timestamp: string, body: string, signature: string): Promise<boolean> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const hex = signature.replace(/^sha256=/, '');
    if (!/^[a-f0-9]{64}$/.test(hex)) return false;
    const bytes = new Uint8Array(hex.match(/../g)!.map(pair => Number.parseInt(pair, 16)));
    return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(`${timestamp}.${body}`));
}

function webhookOf(row: readonly Value[]): Webhook {
    return Object.freeze({
        id: row[0] as string, name: row[1] as string, url: row[2] as string, events: JSON.parse(row[3] as string) as WebhookEvent[], collections: JSON.parse(row[4] as string) as string[],
        secret: row[5] as string, active: Number(row[6] as bigint) === 1, createdAt: Number(row[7] as bigint), updatedAt: Number(row[8] as bigint),
    });
}

function deliveryOf(row: readonly Value[]): WebhookDelivery {
    return Object.freeze({
        id: row[0] as string, webhookId: row[1] as string, event: row[2] as string, status: row[3] as WebhookDelivery['status'], attempts: Number(row[4] as bigint),
        responseStatus: row[5] === null ? null : Number(row[5] as bigint), error: row[6] as string | null, createdAt: Number(row[7] as bigint),
        deliveredAt: row[8] === null ? null : Number(row[8] as bigint), nextAttemptAt: Number(row[9] as bigint),
    });
}

