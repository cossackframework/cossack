import { DurableObject, type RpcStub } from 'cloudflare:workers';
import { readRpcStream, RPC_STREAM_CONTENT_TYPE, RPC_STREAM_MAX_FRAME_BYTES, type RpcStreamFrame } from '@cossackframework/core';

const MAX_PENDING = 32;
const MAX_EVENTS = 128;
const MAX_LOG_BYTES = RPC_STREAM_MAX_FRAME_BYTES;
const MAX_EVENT_NAME = 64;
const encoder = new TextEncoder();

export type SseSnapshot = { state: string; cursor: number };
export type SseInitResult = SseSnapshot & { fresh: boolean };
export type SseUpdate = { cursor: number; event: string; data: string };
export interface SseUpdates { snapshot: SseSnapshot; resync: boolean; events: SseUpdate[] }
type Action = (state: string) => Promise<Response>;

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Cloudflare-only entry. One namespace instance per [componentRouteId, scopeKey]. */
export class SseDurableObject extends DurableObject {
    #tail: Promise<void> = Promise.resolve();
    #pending = 0;

    constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
        super(ctx, env);
        ctx.blockConcurrencyWhile(async () => {
            ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS snapshot (
                id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, cursor INTEGER NOT NULL
            )`);
            ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL,
                data TEXT NOT NULL, bytes INTEGER NOT NULL
            )`);
        });
    }

    /** First initialization wins. Rendering another tab never resets shared state. */
    initialize(state: string): SseInitResult {
        this.#validateState(state);
        const inserted = this.ctx.storage.sql.exec('INSERT OR IGNORE INTO snapshot VALUES (1, ?, 0)', state)
            .rowsWritten;
        return { ...this.#snapshot(), fresh: inserted > 0 };
    }

    /** Current authoritative snapshot, or null before the first initialization. */
    currentState(): SseSnapshot | null {
        const row = this.ctx.storage.sql.exec<SseSnapshot>('SELECT state, cursor FROM snapshot WHERE id = 1').toArray()[0];
        return row ?? null;
    }

    updates(after: number): SseUpdates {
        if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid SSE cursor');
        const snapshot = this.#snapshot();
        const oldest = this.ctx.storage.sql.exec<{ cursor: number }>(
            'SELECT cursor FROM events ORDER BY cursor LIMIT 1').toArray()[0]?.cursor;
        const resync = after > snapshot.cursor || (oldest !== undefined && after < oldest - 1);
        return { snapshot, resync, events: resync ? [] : this.ctx.storage.sql.exec<SseUpdate>(
            'SELECT cursor, event, data FROM events WHERE cursor > ? ORDER BY cursor', after).toArray() };
    }

    /**
     * Publish an authoritative state snapshot for this scope. Called by the
     * Worker for ordinary (non-streaming) action results; streaming results are
     * published per frame by execute().
     */
    publish(state: string): SseSnapshot {
        this.#validateState(state);
        return this.#appendEvent('state-update', state);
    }

    /**
     * Append a broadcast event (framework `event`, `client-action`, or an
     * application event name) without changing the authoritative state.
     */
    broadcast(event: string, data: string): SseSnapshot {
        if (typeof event !== 'string' || event.length === 0 || event.length > MAX_EVENT_NAME ||
            !/^[a-zA-Z0-9:_-]+$/.test(event)) throw new Error('Invalid SSE broadcast event name');
        if (typeof data !== 'string' || encoder.encode(data).length > RPC_STREAM_MAX_FRAME_BYTES ||
            !isJsonObject(JSON.parse(data))) throw new Error('Invalid SSE broadcast payload');
        return this.#appendEvent(event, data);
    }

    /**
     * No replay: an action executes once and owns the serialization slot until
     * its response closes. Streaming responses release the slot when their body
     * finishes, fails, or is cancelled by the caller; fully materialized
     * responses (ordinary results, redirects, custom Responses) release it on
     * return. A caller that disconnects while queued cannot cancel its callback
     * on the tested runtime baseline; that action still runs once and its
     * result is discarded — it is never replayed.
     */
    async execute(action: RpcStub<Action>): Promise<Response> {
        if (this.#pending >= MAX_PENDING) return Response.json({
            code: 'COSSACK_SSE_BUSY', error: 'Too many pending actions for this scope.' }, { status: 429 });
        this.#pending++;
        const before = this.#tail;
        let release!: () => void;
        this.#tail = new Promise<void>(resolve => { release = resolve; });
        let closed = false;
        let iterator: AsyncGenerator<RpcStreamFrame> | undefined;
        const finish = () => {
            if (closed) return;
            closed = true;
            this.#pending--;
            release();
        };
        await before;
        try {
            const response = await action(this.#snapshot().state);
            if (!response.ok) { finish(); return response; }
            if (response.headers.get('Content-Type')?.split(';', 1)[0] !== RPC_STREAM_CONTENT_TYPE) {
                // Ordinary result, redirect, or custom response: the body is
                // fully materialized, so the callback already published state
                // and the serialization slot is released immediately.
                finish();
                return response;
            }
            iterator = readRpcStream(response)[Symbol.asyncIterator]();
            const body = new ReadableStream<Uint8Array>({
                pull: async controller => {
                    if (closed) { try { controller.close(); } catch { /* already closed */ } return; }
                    try {
                        const next = await iterator!.next();
                        if (closed) return;
                        if (next.done) { finish(); controller.close(); return; }
                        const frame = next.value;
                        if ((frame.type === 'yield' || frame.type === 'done') && !isJsonObject(frame.state)) {
                            throw new Error('COSSACK_RPC_STATE_INVALID: SSE action frame carries no object state.');
                        }
                        if (frame.type === 'yield' || frame.type === 'done') {
                            this.#publishState(JSON.stringify(frame.state));
                        }
                        controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
                        if (frame.type !== 'yield') {
                            await iterator!.return(undefined);
                            finish();
                            controller.close();
                        }
                    } catch (error) {
                        try { await iterator!.return(undefined); }
                        finally { finish(); controller.error(error); }
                    }
                },
                cancel: async () => { try { await iterator!.return(undefined); } finally { finish(); } },
            }, { highWaterMark: 0 });
            return new Response(body, { status: response.status, headers: response.headers });
        } catch (error) { finish(); throw error; }
    }

    #snapshot(): SseSnapshot {
        const row = this.ctx.storage.sql.exec<SseSnapshot>('SELECT state, cursor FROM snapshot WHERE id = 1').toArray()[0];
        if (!row) throw new Error('SSE scope has not been initialized');
        return row;
    }

    #validateState(state: string): void {
        if (typeof state !== 'string' || encoder.encode(state).length > RPC_STREAM_MAX_FRAME_BYTES) throw new Error('SSE state exceeds the byte limit');
        const parsed: unknown = JSON.parse(state);
        if (!isJsonObject(parsed)) throw new Error('SSE state must be an object');
    }

    /** Append one event transactionally. State events replace the snapshot; every event advances its cursor. */
    #appendEvent(event: string, data: string): SseSnapshot {
        this.ctx.storage.transactionSync(() => {
            const cursor = this.ctx.storage.sql.exec<{ cursor: number }>(
                'INSERT INTO events (event, data, bytes) VALUES (?, ?, ?) RETURNING cursor',
                event, data, encoder.encode(data).length).one().cursor;
            this.ctx.storage.sql.exec(
                event === 'state-update'
                    ? 'UPDATE snapshot SET state = ?, cursor = ? WHERE id = 1'
                    : 'UPDATE snapshot SET cursor = ? WHERE id = 1',
                ...(event === 'state-update' ? [data, cursor] : [cursor]));
            // Bound both row count and total bytes. A stale subscriber receives a snapshot.
            this.ctx.storage.sql.exec(`DELETE FROM events WHERE cursor NOT IN (
                SELECT cursor FROM (
                    SELECT cursor, SUM(bytes) OVER (ORDER BY cursor DESC) AS total FROM events
                ) WHERE total <= ? ORDER BY cursor DESC LIMIT ?
            )`, MAX_LOG_BYTES, MAX_EVENTS);
        });
        return this.#snapshot();
    }

    #publishState(state: string): void {
        this.#validateState(state);
        this.#appendEvent('state-update', state);
    }
}
