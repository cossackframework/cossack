import type { Context } from 'hono';

export interface AuthorizedSocket {
    readonly readyState: number;
    send(data: string): void;
    close?(code?: number, reason?: string): void;
}

export type SocketOperationAuthorizer<Client extends AuthorizedSocket> = (
    client: Client,
    operation: (context: Context) => Promise<void>,
) => Promise<boolean>;

const AUTH_CHANGED = JSON.stringify({
    type: 'authorization-error',
    code: 'COSSACK_REALTIME_AUTH_CHANGED',
    message: 'Realtime authorization changed. Reload the page to reconnect.',
});

/** Send the terminal frame clients use to stop reconnecting with stale identity. */
export function closeUnauthorizedSocket(client: AuthorizedSocket): void {
    if (client.readyState === 1) {
        try { client.send(AUTH_CHANGED); } catch { /* close below */ }
    }
    try { client.close?.(1008, 'Realtime authorization changed'); }
    catch { /* peer may already be closed */ }
}

/** An outbound frame: a protocol message object, or an already-encoded string. */
export type SocketFrame = Record<string, unknown> | string;

type FrameKind = 'state' | 'action' | 'other';

interface QueuedFrame {
    message: SocketFrame;
    kind: FrameKind;
}

interface QueueState {
    frames: QueuedFrame[];
    /** True while a drain loop owns this peer; set and cleared synchronously. */
    active: boolean;
    idle: Promise<void>;
    retired: boolean;
}

/** Broadcasts share one message object across peers; encode it once. */
const encodings = new WeakMap<object, string>();
function encode(message: SocketFrame): string {
    if (typeof message === 'string') return message;
    let encoded = encodings.get(message);
    if (encoded === undefined) {
        encoded = JSON.stringify(message);
        encodings.set(message, encoded);
    }
    return encoded;
}

function isStateRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function frameKind(message: SocketFrame): FrameKind {
    if (typeof message === 'string') return 'other';
    if (message.type === 'client-action') return 'action';
    if (message.type === 'state-update' && isStateRecord(message.state)) return 'state';
    return 'other';
}

/**
 * Serialize per-peer authorization and delivery while keeping fan-out bounded.
 *
 * Frames queue per peer and drain in order. Authorization (which reruns the
 * application's middleware) runs once per drained batch rather than once per
 * frame, like SSE: a batch is every queued frame up to the next
 * `client-action`, and each `client-action` frame is authorized on its own.
 * While a peer's delivery is pending, a new `state-update` that directly
 * follows a queued `state-update` merges into it (later keys win). State
 * updates are partial snapshots, so merging never drops a key, and a tight
 * loop of state writes cannot grow the queue or disconnect a slow client.
 * Frames are never merged across an intervening event or action, so frame
 * order is preserved. A peer whose backlog still exceeds `maxPending` frames
 * is retired with 1013.
 */
export class SocketDeliveryQueue<Client extends AuthorizedSocket> {
    private readonly queues = new WeakMap<object, QueueState>();
    private readonly maxPending: number;

    constructor(maxPending = 32) {
        this.maxPending = maxPending;
    }

    send(
        client: Client,
        message: SocketFrame,
        isOpen: (client: Client) => boolean,
        authorize?: SocketOperationAuthorizer<Client>,
        onError: (error: unknown) => void = () => {},
    ): Promise<void> {
        // Encode eagerly (cached per message object) so an unserializable
        // frame fails in the caller, not later inside a peer's drain.
        const encoded = encode(message);
        if (!authorize) {
            if (isOpen(client)) client.send(encoded);
            return Promise.resolve();
        }
        if (!client || (typeof client !== 'object' && typeof client !== 'function')) return Promise.resolve();
        let state = this.queues.get(client as object);
        if (!state) {
            state = { frames: [], active: false, idle: Promise.resolve(), retired: false };
            this.queues.set(client as object, state);
        }
        if (state.retired) return state.idle;
        const kind = frameKind(message);
        const last = state.frames[state.frames.length - 1];
        if (kind === 'state' && last?.kind === 'state') {
            // Never mutate a queued message: broadcasts share it across peers.
            const previous = last.message as Record<string, unknown>;
            const next = message as Record<string, unknown>;
            last.message = { ...previous, ...next,
                state: { ...(previous.state as Record<string, unknown>), ...(next.state as Record<string, unknown>) } };
        } else {
            if (state.frames.length >= this.maxPending) {
                this.retire(client, state, 1013, 'Realtime delivery queue is full');
                return state.idle;
            }
            state.frames.push({ message, kind });
        }
        if (!state.active) {
            state.active = true;
            state.idle = this.drain(client, state, isOpen, authorize, onError);
        }
        return state.idle;
    }

    private async drain(
        client: Client,
        state: QueueState,
        isOpen: (client: Client) => boolean,
        authorize: SocketOperationAuthorizer<Client>,
        onError: (error: unknown) => void,
    ): Promise<void> {
        try {
            // Let frames queued in the same turn join the first batch.
            await Promise.resolve();
            while (!state.retired && state.frames.length) {
                // A batch is everything up to the next client-action; a
                // client-action is always a batch of its own.
                const actionAt = state.frames.findIndex(frame => frame.kind === 'action');
                const batch = state.frames.splice(0, actionAt === 0 ? 1 : actionAt === -1 ? state.frames.length : actionAt);
                if (!isOpen(client)) continue;
                let operationRan = false;
                let allowed = false;
                try {
                    allowed = await authorize(client, async () => { operationRan = true; });
                } catch (error) {
                    onError(error);
                }
                if (!allowed || !operationRan) {
                    this.retire(client, state, 1008, 'Realtime authorization changed', true);
                    break;
                }
                for (const frame of batch) {
                    if (state.retired || !isOpen(client)) break;
                    client.send(encode(frame.message));
                }
            }
        } catch (error) {
            onError(error);
            this.retire(client, state, 1011, 'Realtime delivery failed');
        } finally {
            if (state.retired) state.frames.length = 0;
            // Synchronous with the loop's final empty check: a later send()
            // starts a new drain instead of joining a finished one.
            state.active = false;
        }
    }

    retire(client: Client, state?: QueueState, code = 1008, reason = 'Realtime connection retired', authorizationChanged = false): void {
        let current = state;
        if (!current && client && (typeof client === 'object' || typeof client === 'function')) {
            current = this.queues.get(client as object);
        }
        if (current?.retired) return;
        if (current) {
            current.retired = true;
            current.frames.length = 0;
        }
        if (authorizationChanged) closeUnauthorizedSocket(client);
        else try { client.close?.(code, reason); } catch { /* the peer may already be closed */ }
    }

    remove(client: Client): void {
        if (!client || (typeof client !== 'object' && typeof client !== 'function')) return;
        const state = this.queues.get(client as object);
        if (state) {
            state.retired = true;
            state.frames.length = 0;
        }
        this.queues.delete(client as object);
    }
}
