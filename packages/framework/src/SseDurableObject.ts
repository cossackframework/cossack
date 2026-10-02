import { DurableObject, type RpcStub } from 'cloudflare:workers';
import { readRpcStream, RPC_STREAM_CONTENT_TYPE, RPC_STREAM_MAX_FRAME_BYTES } from '@cossackframework/core';

const MAX_PENDING = 32;
const MAX_EVENTS = 128;
const MAX_LOG_BYTES = RPC_STREAM_MAX_FRAME_BYTES;
const encoder = new TextEncoder();

export type SseSnapshot = { state: string; cursor: number };
export type SseUpdate = { cursor: number; event: string; data: string };
export interface SseUpdates { snapshot: SseSnapshot; resync: boolean; events: SseUpdate[] }
type Action = (state: string) => Promise<Response>;

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
    initialize(state: string): SseSnapshot {
        this.#validateState(state);
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO snapshot VALUES (1, ?, 0)', state);
        return this.#snapshot();
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

    /** No replay: an action executes once and owns the serialization slot until its response closes. */
    async execute(action: RpcStub<Action>): Promise<Response> {
        if (this.#pending >= MAX_PENDING) return Response.json({
            code: 'COSSACK_SSE_BUSY', error: 'Too many pending actions for this scope.' }, { status: 429 });
        this.#pending++;
        const before = this.#tail;
        let release!: () => void;
        this.#tail = new Promise<void>(resolve => { release = resolve; });
        let closed = false;
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
                throw new Error('SSE action callback must return an RPC stream');
            }
            const iterator = readRpcStream(response);
            const body = new ReadableStream<Uint8Array>({
                pull: async controller => {
                    if (closed) return;
                    try {
                        const next = await iterator.next();
                        if (closed) return;
                        if (next.done) { finish(); controller.close(); return; }
                        const frame = next.value;
                        if (frame.type !== 'error') this.#publishState(JSON.stringify(frame.state));
                        controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
                        if (frame.type !== 'yield') {
                            await iterator.return(undefined);
                            finish();
                            controller.close();
                        }
                    } catch (error) {
                        try { await iterator.return(undefined); }
                        finally { finish(); controller.error(error); }
                    }
                },
                cancel: async () => { try { await iterator.return(undefined); } finally { finish(); } },
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
        if (encoder.encode(state).length > RPC_STREAM_MAX_FRAME_BYTES) throw new Error('SSE state exceeds the byte limit');
        const parsed: unknown = JSON.parse(state);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('SSE state must be an object');
    }

    #publishState(state: string): void {
        this.#validateState(state);
        this.ctx.storage.transactionSync(() => {
            const cursor = this.ctx.storage.sql.exec<{ cursor: number }>(
                "INSERT INTO events (event, data, bytes) VALUES ('state-update', ?, ?) RETURNING cursor",
                state, encoder.encode(state).length).one().cursor;
            this.ctx.storage.sql.exec('UPDATE snapshot SET state = ?, cursor = ? WHERE id = 1', state, cursor);
            // Bound both row count and total bytes. A stale subscriber receives a snapshot.
            this.ctx.storage.sql.exec(`DELETE FROM events WHERE cursor NOT IN (
                SELECT cursor FROM (
                    SELECT cursor, SUM(bytes) OVER (ORDER BY cursor DESC) AS total FROM events
                ) WHERE total <= ? ORDER BY cursor DESC LIMIT ?
            )`, MAX_LOG_BYTES, MAX_EVENTS);
        });
    }
}
