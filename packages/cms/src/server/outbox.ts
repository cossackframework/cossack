/**
 * Durable after-commit delivery. Mutations commit their outbox row in the same batch;
 * the dispatcher leases due rows, runs `cms.resource.after-commit` handlers, and records
 * which plugins still need the event. Deliveries can repeat: consumers key on `eventId`.
 */
import type { FastDB } from '@cossackframework/fastdb';
import type { HookRegistry } from '@cossackframework/core/hooks';
import { afterCommit, type ResourceEvent } from '../hooks';

export interface DispatchReport {
    readonly delivered: readonly string[];
    readonly retrying: readonly { id: string; plugins: readonly string[] }[];
    /** Gave up after `maxAttempts`; the row keeps the failed plugins for inspection. */
    readonly deadLettered: readonly string[];
}

export interface OutboxOptions {
    now?: () => number;
    leaseMs?: number;
    maxAttempts?: number;
    /** Delay before attempt n: `min(maxDelayMs, baseDelayMs * 2^(n-1))`. */
    baseDelayMs?: number;
    maxDelayMs?: number;
}

export class Outbox {
    readonly #db: FastDB;
    readonly #hooks: HookRegistry;
    readonly #now: () => number;
    readonly #leaseMs: number;
    readonly #maxAttempts: number;
    readonly #baseDelay: number;
    readonly #maxDelay: number;

    constructor(db: FastDB, hooks: HookRegistry, options: OutboxOptions = {}) {
        this.#db = db;
        this.#hooks = hooks;
        this.#now = options.now ?? Date.now;
        this.#leaseMs = options.leaseMs ?? 60_000;
        this.#maxAttempts = options.maxAttempts ?? 10;
        this.#baseDelay = options.baseDelayMs ?? 1_000;
        this.#maxDelay = options.maxDelayMs ?? 15 * 60_000;
    }

    /** Deliver up to `limit` due events. Safe to run concurrently: each row has one lease holder. */
    async dispatch(options: { limit?: number; signal?: AbortSignal } = {}): Promise<DispatchReport> {
        const now = this.#now();
        const token = crypto.randomUUID();
        const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
        const call = options.signal ? { signal: options.signal } : {};
        // Idle runs read only, so they do not race schema migrations for the database sequence.
        const due = await this.#db.read([{ sql: 'SELECT 1 FROM cms_outbox WHERE delivered_at IS NULL AND available_at <= $now AND lease_until <= $now LIMIT 1', params: { $now: now } }], call);
        if (!due.results[0]!.rows.length) return { delivered: [], retrying: [], deadLettered: [] };
        await this.#db.write([{
            sql: `UPDATE cms_outbox SET lease_token = $token, lease_until = $until, attempts = attempts + 1
                WHERE id IN (SELECT id FROM cms_outbox WHERE delivered_at IS NULL AND available_at <= $now AND lease_until <= $now ORDER BY created_at, id LIMIT $limit)`,
            params: { $token: token, $until: now + this.#leaseMs, $now: now, $limit: limit },
        }], { ...call, kind: 'cms.outbox', retryConflicts: 5 });
        const claimed = await this.#db.read([{ sql: 'SELECT id, payload, pending_plugins, attempts FROM cms_outbox WHERE lease_token = $token ORDER BY created_at, id', params: { $token: token } }], call);
        const delivered: string[] = [];
        const retrying: { id: string; plugins: readonly string[] }[] = [];
        const deadLettered: string[] = [];
        for (const [id, payload, pending, attempts] of claimed.results[0]!.rows) {
            const event = JSON.parse(payload as string) as ResourceEvent;
            const only = pending ? JSON.parse(pending as string) as string[] : undefined;
            const report = await this.#hooks.doAction(afterCommit, event, { ...call, ...(only ? { only } : {}) });
            const at = this.#now();
            if (report.ok) {
                await this.#settle(id as string, token, { $done: at, $pending: null, $available: at }, call);
                delivered.push(id as string);
                continue;
            }
            const attempt = Number(attempts as bigint);
            if (attempt >= this.#maxAttempts) {
                await this.#settle(id as string, token, { $done: at, $pending: JSON.stringify(report.failed), $available: at }, call);
                deadLettered.push(id as string);
            } else {
                const delay = Math.min(this.#maxDelay, this.#baseDelay * 2 ** (attempt - 1));
                await this.#settle(id as string, token, { $done: null, $pending: JSON.stringify(report.failed), $available: at + delay }, call);
                retrying.push({ id: id as string, plugins: report.failed });
            }
        }
        return { delivered, retrying, deadLettered };
    }

    /** Events still waiting, oldest first. */
    async pending(options: { limit?: number } = {}): Promise<{ id: string; topic: string; attempts: number; availableAt: number; plugins: string[] | null }[]> {
        const result = await this.#db.read([{ sql: 'SELECT id, topic, attempts, available_at, pending_plugins FROM cms_outbox WHERE delivered_at IS NULL ORDER BY created_at, id LIMIT $limit', params: { $limit: options.limit ?? 50 } }]);
        return result.results[0]!.rows.map(row => ({ id: row[0] as string, topic: row[1] as string, attempts: Number(row[2] as bigint), availableAt: Number(row[3] as bigint), plugins: row[4] ? JSON.parse(row[4] as string) : null }));
    }

    /** Delete delivered events older than `olderThanMs`. Dead letters stay until reviewed. */
    async prune(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
        const old = await this.#db.read([{ sql: 'SELECT 1 FROM cms_outbox WHERE delivered_at IS NOT NULL AND delivered_at <= $before AND pending_plugins IS NULL LIMIT 1', params: { $before: this.#now() - olderThanMs } }]);
        if (!old.results[0]!.rows.length) return 0;
        const result = await this.#db.write([{
            sql: 'DELETE FROM cms_outbox WHERE id IN (SELECT id FROM cms_outbox WHERE delivered_at IS NOT NULL AND delivered_at <= $before AND pending_plugins IS NULL LIMIT 1000)',
            params: { $before: this.#now() - olderThanMs },
        }], { kind: 'cms.outbox', retryConflicts: 5 });
        return Number(result.results[0]!.affected);
    }

    async #settle(id: string, token: string, values: { $done: number | null; $pending: string | null; $available: number }, call: { signal?: AbortSignal }): Promise<void> {
        await this.#db.write([{
            sql: 'UPDATE cms_outbox SET delivered_at = $done, pending_plugins = $pending, available_at = $available, lease_token = NULL, lease_until = 0 WHERE id = $id AND lease_token = $token',
            params: { ...values, $id: id, $token: token },
        }], { ...call, kind: 'cms.outbox', retryConflicts: 5 });
    }
}
