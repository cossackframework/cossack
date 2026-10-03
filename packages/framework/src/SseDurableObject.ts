import { DurableObject, type RpcStub } from 'cloudflare:workers';
import { readRpcStream, RPC_NATIVE_RESPONSE_HEADER, RPC_STREAM_CONTENT_TYPE, RPC_STREAM_MAX_FRAME_BYTES, type RpcStreamFrame } from '@cossackframework/core';

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
type CancelAction = () => Promise<void>;
interface PendingAction {
    id: string;
    ready: Promise<void>;
    enter: () => void;
    cancelled: boolean;
    closed: boolean;
    close?: () => void;
    abort?: RpcStub<CancelAction>;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Cloudflare-only entry. One namespace instance per [componentRouteId, scopeKey]. */
export class SseDurableObject extends DurableObject {
    #actions = new Map<string, PendingAction>();
    #queue: PendingAction[] = [];
    #active?: PendingAction;

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
    publish(state: string, requestId?: string): SseSnapshot {
        this.#validateState(state);
        if (requestId !== undefined && (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128)) {
            throw new Error('Invalid SSE snapshot request ID');
        }
        const data = requestId === undefined ? state : JSON.stringify({ ...JSON.parse(state), _cossack_request_id: requestId });
        if (encoder.encode(data).length > RPC_STREAM_MAX_FRAME_BYTES) throw new Error('SSE correlated state exceeds the byte limit');
        return this.#appendEvent('state-update', data, state);
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

    /** Scope-local queue diagnostics contain no caller or operation IDs. */
    queueStatus(): { pending: number; queued: number; active: boolean } {
        return { pending: this.#actions.size, queued: this.#queue.length, active: this.#active !== undefined };
    }

    /** Cancel this operation without replaying it or releasing another action's slot. */
    cancel(operationId: string): void {
        const entry = this.#actions.get(operationId);
        if (!entry || entry.closed || entry.cancelled) return;
        entry.cancelled = true;
        if (entry !== this.#active) {
            this.#finish(entry);
            entry.enter();
        } else {
            // Abort the originating Worker's pending guard. Application work that
            // already started may finish; it is not retried or rolled back.
            try { void entry.abort?.().catch(() => {}); }
            catch { /* the originating callback may already have ended */ }
            entry.close?.();
        }
    }

    /**
     * One operation owns the scope until its response ends. Cancelled queued
     * operations never invoke their callbacks. A pending callback is aborted
     * through its originating Worker; a counter guard releases it before action
     * invocation. Already started application work may still finish.
     */
    async execute(action: RpcStub<Action>, operationId: string = crypto.randomUUID(), abort?: RpcStub<CancelAction>): Promise<Response> {
        if (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 128) {
            return Response.json({ code: 'COSSACK_RPC_REQUEST_INVALID', error: 'Invalid SSE operation ID.' }, { status: 400 });
        }
        if (this.#actions.has(operationId)) return Response.json({
            code: 'COSSACK_RPC_REQUEST_DUPLICATE', error: 'An SSE operation with this ID is already active.' }, { status: 409 });
        if (this.#actions.size >= MAX_PENDING) return Response.json({
            code: 'COSSACK_SSE_BUSY', error: 'Too many pending actions for this scope.' }, { status: 429 });
        let enter!: () => void;
        const ready = new Promise<void>(resolve => { enter = resolve; });
        const entry: PendingAction = { id: operationId, ready, enter, cancelled: false, closed: false, abort };
        this.#actions.set(operationId, entry);
        if (this.#active) this.#queue.push(entry);
        else { this.#active = entry; enter(); }
        await ready;
        if (entry.cancelled) return this.#cancelledResponse();
        const finish = () => this.#finish(entry);
        let iterator: AsyncIterator<RpcStreamFrame> | undefined;
        try {
            const response = await action(this.#snapshot().state);
            if (entry.cancelled) {
                void response.body?.cancel().catch(() => {});
                finish();
                return this.#cancelledResponse();
            }
            if (!response.ok || response.headers.get(RPC_NATIVE_RESPONSE_HEADER) === 'native' ||
                response.headers.get('Content-Type')?.split(';', 1)[0] !== RPC_STREAM_CONTENT_TYPE) {
                if (!response.body) { finish(); return response; }
                const reader = response.body.getReader();
                let output!: ReadableStreamDefaultController<Uint8Array>;
                entry.close = () => {
                    if (entry.closed) return;
                    void reader.cancel().catch(() => {});
                    reader.releaseLock();
                    finish();
                    try { output.close(); } catch { /* cancelled by consumer */ }
                };
                const body = new ReadableStream<Uint8Array>({
                    start: controller => { output = controller; },
                    pull: async controller => {
                        if (entry.closed) return;
                        try {
                            const next = await reader.read();
                            if (entry.closed) return;
                            if (next.done) { reader.releaseLock(); finish(); controller.close(); }
                            else controller.enqueue(next.value);
                        } catch (error) {
                            if (entry.closed) return;
                            reader.releaseLock(); finish(); controller.error(error);
                        }
                    },
                    cancel: () => entry.close?.(),
                }, { highWaterMark: 0 });
                return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
            }
            const cancellation = new AbortController();
            iterator = readRpcStream(response, cancellation.signal)[Symbol.asyncIterator]();
            let output!: ReadableStreamDefaultController<Uint8Array>;
            entry.close = () => {
                if (entry.closed) return;
                cancellation.abort();
                void iterator!.return?.(undefined).catch(() => {});
                finish();
                try { output.close(); } catch { /* cancelled by consumer */ }
            };
            const body = new ReadableStream<Uint8Array>({
                start: controller => { output = controller; },
                pull: async controller => {
                    if (entry.closed) return;
                    try {
                        const next = await iterator!.next();
                        if (entry.closed) return;
                        if (next.done) { finish(); controller.close(); return; }
                        const frame = next.value;
                        if ((frame.type === 'yield' || frame.type === 'done') && !isJsonObject(frame.state)) {
                            throw new Error('COSSACK_RPC_STATE_INVALID: SSE action frame carries no object state.');
                        }
                        if (frame.type === 'yield' || frame.type === 'done') {
                            const snapshot = this.publish(JSON.stringify(frame.scopeState ?? frame.state), frame.requestId);
                            if (!frame.scopeState) frame.state = { ...frame.state, _cossack_sse_cursor: snapshot.cursor };
                        }
                        const encoded = encoder.encode(`${JSON.stringify(frame)}\n`);
                        if (encoded.length - 1 > RPC_STREAM_MAX_FRAME_BYTES) throw new Error('Correlated SSE action frame exceeds the byte limit');
                        controller.enqueue(encoded);
                        if (frame.type !== 'yield') {
                            await iterator!.return?.(undefined);
                            finish(); controller.close();
                        }
                    } catch (error) {
                        if (entry.closed) return;
                        controller.error(error); entry.close?.();
                    }
                },
                cancel: () => entry.close?.(),
            }, { highWaterMark: 0 });
            return new Response(body, { status: response.status, headers: response.headers });
        } catch (error) { finish(); throw error; }
    }

    #cancelledResponse(): Response {
        return Response.json({ code: 'COSSACK_RPC_CANCELLED', error: 'RPC call was cancelled.' }, { status: 499 });
    }

    #finish(entry: PendingAction): void {
        if (entry.closed) return;
        entry.closed = true;
        entry.close = undefined;
        entry.abort = undefined;
        this.#actions.delete(entry.id);
        if (this.#active === entry) {
            this.#active = this.#queue.shift();
            this.#active?.enter();
        } else {
            const index = this.#queue.indexOf(entry);
            if (index >= 0) this.#queue.splice(index, 1);
        }
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
    #appendEvent(event: string, data: string, snapshotState = data): SseSnapshot {
        this.ctx.storage.transactionSync(() => {
            const cursor = this.ctx.storage.sql.exec<{ cursor: number }>(
                'INSERT INTO events (event, data, bytes) VALUES (?, ?, ?) RETURNING cursor',
                event, data, encoder.encode(data).length).one().cursor;
            this.ctx.storage.sql.exec(
                event === 'state-update'
                    ? 'UPDATE snapshot SET state = ?, cursor = ? WHERE id = 1'
                    : 'UPDATE snapshot SET cursor = ? WHERE id = 1',
                ...(event === 'state-update' ? [snapshotState, cursor] : [cursor]));
            // Bound both row count and total bytes. A stale subscriber receives a snapshot.
            this.ctx.storage.sql.exec(`DELETE FROM events WHERE cursor NOT IN (
                SELECT cursor FROM (
                    SELECT cursor, SUM(bytes) OVER (ORDER BY cursor DESC) AS total FROM events
                ) WHERE total <= ? ORDER BY cursor DESC LIMIT ?
            )`, MAX_LOG_BYTES, MAX_EVENTS);
        });
        return this.#snapshot();
    }

}
