/**
 * Durable after-commit delivery. Mutations commit their outbox row in the same batch;
 * the dispatcher leases due rows, runs the handlers of the row's topic
 * (`cms.resource.after-commit` for resource events, `cms.form.submitted` for form
 * submissions), and records which plugins still need the event. Deliveries can repeat: consumers key on `eventId`.
 */
import type { RomeDB, Statement, Value } from '@cossackframework/romedb';
import type { HookRegistry } from '@cossackframework/core/hooks';
import type { ActionPoint } from '@cossackframework/core/hooks';
import { afterCommit, cachePurge, formSubmitted, paymentEvent, pluginJob, userRegistered, userSignedIn } from '../hooks';
import { searchRebuild } from './site-search';
import { collectionDeleted } from './comments';
import { sharedFields } from './shared-fields';
import { noteAnnounced } from './notes';
import { pathsMoved } from './path-moves';
import { readPaged } from './budget';

/** The action an outbox row runs, by its topic; resource events run `cms.resource.after-commit`. */
const POINTS: { readonly [topic: string]: ActionPoint<unknown> } = { 'form.submitted': formSubmitted as ActionPoint<unknown>, 'cache.purge': cachePurge as ActionPoint<unknown>, 'plugin.job': pluginJob as ActionPoint<unknown>, 'payment.event': paymentEvent as ActionPoint<unknown>, 'user.registered': userRegistered as ActionPoint<unknown>, 'user.signed-in': userSignedIn as ActionPoint<unknown>, 'search.rebuild': searchRebuild as ActionPoint<unknown>, 'collection.deleted': collectionDeleted as ActionPoint<unknown>, 'resource.shared': sharedFields as ActionPoint<unknown>, 'note.announced': noteAnnounced as ActionPoint<unknown>, 'paths.moved': pathsMoved as ActionPoint<unknown> };

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
    readonly #db: RomeDB;
    readonly #hooks: HookRegistry;
    readonly #now: () => number;
    readonly #leaseMs: number;
    readonly #maxAttempts: number;
    readonly #baseDelay: number;
    readonly #maxDelay: number;

    constructor(db: RomeDB, hooks: HookRegistry, options: OutboxOptions = {}) {
        this.#db = db;
        this.#hooks = hooks;
        this.#now = options.now ?? Date.now;
        this.#leaseMs = options.leaseMs ?? 60_000;
        this.#maxAttempts = options.maxAttempts ?? 10;
        this.#baseDelay = options.baseDelayMs ?? 1_000;
        this.#maxDelay = options.maxDelayMs ?? 15 * 60_000;
    }

    /** Rows `enqueue()` added, so a dispatch delivers what its own handlers queued. */
    #enqueued = 0;

    /**
     * Deliver up to `limit` due events. Safe to run concurrently: each row has one lease holder.
     * A handler may queue more rows (an entry event queues a cache purge): up to three rounds
     * deliver those now rather than after the next request.
     */
    async dispatch(options: { limit?: number; signal?: AbortSignal } = {}): Promise<DispatchReport> {
        const delivered: string[] = [];
        const retrying: { id: string; plugins: readonly string[] }[] = [];
        const deadLettered: string[] = [];
        for (let round = 0; round < 3; round++) {
            const enqueued = this.#enqueued;
            const report = await this.#round(options);
            delivered.push(...report.delivered);
            retrying.push(...report.retrying);
            deadLettered.push(...report.deadLettered);
            if (this.#enqueued === enqueued) break;
        }
        return { delivered, retrying, deadLettered };
    }

    async #round(options: { limit?: number; signal?: AbortSignal }): Promise<DispatchReport> {
        const now = this.#now();
        const token = crypto.randomUUID();
        const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
        const call = options.signal ? { signal: options.signal } : {};
        // Idle runs read only, so they do not race schema migrations for the database sequence.
        const due = await this.#db.read([{ rql: 'SELECT 1 FROM cms_outbox WHERE delivered_at IS NULL AND available_at <= $now AND lease_until <= $now LIMIT 1', params: { $now: now } }], call);
        if (!due.results[0]!.rows.length) return { delivered: [], retrying: [], deadLettered: [] };
        await this.#db.write([{
            rql: `UPDATE cms_outbox SET lease_token = $token, lease_until = $until, attempts = attempts + 1
                WHERE id IN (SELECT id FROM cms_outbox WHERE delivered_at IS NULL AND available_at <= $now AND lease_until <= $now ORDER BY created_at, id LIMIT $limit)`,
            params: { $token: token, $until: now + this.#leaseMs, $now: now, $limit: limit },
        }], { ...call, kind: 'cms.outbox', retryConflicts: 5 });
        // Payloads hold whole records: the claimed rows may come in smaller reads.
        const claimed = await readPaged(this.#db, (size, at) => ({ rql: 'SELECT id, payload, pending_plugins, attempts, topic FROM cms_outbox WHERE lease_token = $token ORDER BY created_at, id LIMIT $limit OFFSET $offset', params: { $token: token, $limit: size, $offset: at } }), limit, 0, call);
        const delivered: string[] = [];
        const retrying: { id: string; plugins: readonly string[] }[] = [];
        const deadLettered: string[] = [];
        for (const [id, payload, pending, attempts, topic] of claimed) {
            // Handlers run one row at a time and can outlast the batch lease. Past half of it,
            // extend this row's lease first; a row another dispatcher claimed meanwhile is its to run.
            if (this.#now() > now + this.#leaseMs / 2) {
                const renewed = await this.#db.write([{
                    rql: 'UPDATE cms_outbox SET lease_until = $until WHERE id = $id AND lease_token = $token AND delivered_at IS NULL',
                    params: { $until: this.#now() + this.#leaseMs, $id: id as string, $token: token },
                }], { ...call, kind: 'cms.outbox', retryConflicts: 5 });
                if (renewed.results[0]!.affected !== 1n) continue;
            }
            const event = JSON.parse(payload as string) as unknown;
            const only = pending ? JSON.parse(pending as string) as string[] : undefined;
            const point = POINTS[topic as string] ?? afterCommit as ActionPoint<unknown>;
            const report = await this.#hooks.doAction(point, event, { ...call, ...(only ? { only } : {}) });
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

    /**
     * Queue an event of a topic outside a resource write, such as a cache purge or a plugin's job;
     * `eventId` is the row, delivered from `availableAt` (default: now). With `ignoreDuplicate`, a
     * row that exists is left alone and false comes back.
     */
    /** The row `enqueue` writes, for a caller's own batch: the event is queued exactly when the batch commits. Call `outboxWritten()` after it. */
    statement(topic: string, event: { readonly eventId: string; readonly at: number }, options: { availableAt?: number; ignoreDuplicate?: boolean } = {}): Statement {
        return {
            rql: `INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) VALUES ($outbox_id, $outbox_topic, $outbox_payload, $outbox_at, $outbox_available, 0, 0)${options.ignoreDuplicate ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
            params: { $outbox_id: event.eventId, $outbox_topic: topic, $outbox_payload: JSON.stringify(event), $outbox_at: event.at, $outbox_available: options.availableAt ?? event.at },
        };
    }

    async enqueue(topic: string, event: { readonly eventId: string; readonly at: number }, options: { signal?: AbortSignal; availableAt?: number; ignoreDuplicate?: boolean } = {}): Promise<boolean> {
        const result = await this.#db.write([{
            rql: `INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) VALUES ($id, $topic, $payload, $at, $available, 0, 0)${options.ignoreDuplicate ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
            params: { $id: event.eventId, $topic: topic, $payload: JSON.stringify(event), $at: event.at, $available: options.availableAt ?? event.at },
        }], { ...(options.signal ? { signal: options.signal } : {}), kind: 'cms.outbox', retryConflicts: 5 });
        const inserted = result.results[0]!.affected !== 0n;
        if (inserted) this.#enqueued++;
        return inserted;
    }

    /**
     * Queue an event in one atomic write with `writes`, and only when `guard` (an SQL condition
     * on the caller's rows, such as an `EXISTS`) holds as the write starts; a row that exists is
     * left alone. The answer has whether the row was added and the results of `writes`.
     */
    async enqueueWith(topic: string, event: { readonly eventId: string; readonly at: number }, guard: { readonly rql: string; readonly params: { readonly [name: string]: Value } }, writes: readonly Statement[]): Promise<{ inserted: boolean; results: readonly { readonly affected: bigint }[] }> {
        const result = await this.#db.write([{
            // The row's parameters have their own names, so the guard's own ($id, say) keep theirs.
            rql: `INSERT INTO cms_outbox (id, topic, payload, created_at, available_at, attempts, lease_until) SELECT $outbox_id, $outbox_topic, $outbox_payload, $outbox_at, $outbox_at, 0, 0 WHERE ${guard.rql} ON CONFLICT (id) DO NOTHING`,
            params: { ...guard.params, $outbox_id: event.eventId, $outbox_topic: topic, $outbox_payload: JSON.stringify(event), $outbox_at: event.at },
        }, ...writes], { kind: 'cms.outbox', retryConflicts: 5 });
        const inserted = result.results[0]!.affected !== 0n;
        if (inserted) this.#enqueued++;
        return { inserted, results: result.results.slice(1) };
    }

    /** Events the dispatcher gave up on: delivered, with the plugins that never took them kept in `plugins`. Newest first. */
    async deadLettered(options: { limit?: number } = {}): Promise<{ id: string; topic: string; attempts: number; at: number; plugins: string[] }[]> {
        const result = await this.#db.read([{ rql: 'SELECT id, topic, attempts, delivered_at, pending_plugins FROM cms_outbox WHERE delivered_at IS NOT NULL AND pending_plugins IS NOT NULL ORDER BY delivered_at DESC, id LIMIT $limit', params: { $limit: Math.min(Math.max(options.limit ?? 50, 1), 500) } }]);
        return result.results[0]!.rows.map(row => ({ id: row[0] as string, topic: row[1] as string, attempts: Number(row[2] as bigint), at: Number(row[3] as bigint), plugins: JSON.parse(row[4] as string) as string[] }));
    }

    /** Queue a waiting or dead-lettered event again, now, for the plugins that still need it. */
    async retry(id: string): Promise<boolean> {
        const result = await this.#db.write([{
            rql: 'UPDATE cms_outbox SET delivered_at = NULL, attempts = 0, available_at = $now, lease_token = NULL, lease_until = 0 WHERE id = $id AND (delivered_at IS NULL OR pending_plugins IS NOT NULL)',
            params: { $id: id, $now: this.#now() },
        }], { kind: 'cms.outbox', retryConflicts: 5 });
        return result.results[0]!.affected === 1n;
    }

    /** Drop an event nobody will take. */
    async remove(id: string): Promise<boolean> {
        const result = await this.#db.write([{ rql: 'DELETE FROM cms_outbox WHERE id = $id AND (delivered_at IS NULL OR pending_plugins IS NOT NULL)', params: { $id: id } }], { kind: 'cms.outbox', retryConflicts: 5 });
        return result.results[0]!.affected === 1n;
    }

    /** Events still waiting, oldest first. */
    async pending(options: { limit?: number } = {}): Promise<{ id: string; topic: string; attempts: number; availableAt: number; plugins: string[] | null }[]> {
        const result = await this.#db.read([{ rql: 'SELECT id, topic, attempts, available_at, pending_plugins FROM cms_outbox WHERE delivered_at IS NULL ORDER BY created_at, id LIMIT $limit', params: { $limit: options.limit ?? 50 } }]);
        return result.results[0]!.rows.map(row => ({ id: row[0] as string, topic: row[1] as string, attempts: Number(row[2] as bigint), availableAt: Number(row[3] as bigint), plugins: row[4] ? JSON.parse(row[4] as string) : null }));
    }

    /** Delete delivered events older than `olderThanMs`. Dead letters stay until reviewed. */
    async prune(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
        const old = await this.#db.read([{ rql: 'SELECT 1 FROM cms_outbox WHERE delivered_at IS NOT NULL AND delivered_at <= $before AND pending_plugins IS NULL LIMIT 1', params: { $before: this.#now() - olderThanMs } }]);
        if (!old.results[0]!.rows.length) return 0;
        const result = await this.#db.write([{
            rql: 'DELETE FROM cms_outbox WHERE id IN (SELECT id FROM cms_outbox WHERE delivered_at IS NOT NULL AND delivered_at <= $before AND pending_plugins IS NULL LIMIT 1000)',
            params: { $before: this.#now() - olderThanMs },
        }], { kind: 'cms.outbox', retryConflicts: 5 });
        return Number(result.results[0]!.affected);
    }

    async #settle(id: string, token: string, values: { $done: number | null; $pending: string | null; $available: number }, call: { signal?: AbortSignal }): Promise<void> {
        await this.#db.write([{
            rql: 'UPDATE cms_outbox SET delivered_at = $done, pending_plugins = $pending, available_at = $available, lease_token = NULL, lease_until = 0 WHERE id = $id AND lease_token = $token',
            params: { ...values, $id: id, $token: token },
        }], { ...call, kind: 'cms.outbox', retryConflicts: 5 });
    }
}
