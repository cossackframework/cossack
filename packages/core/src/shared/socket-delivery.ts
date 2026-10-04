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

interface QueueState {
    tail: Promise<void>;
    pending: number;
    retired: boolean;
}

/** Serialize per-peer authorization and delivery while keeping fan-out bounded. */
export class SocketDeliveryQueue<Client extends AuthorizedSocket> {
    private readonly queues = new WeakMap<object, QueueState>();
    private readonly maxPending: number;

    constructor(maxPending = 32) {
        this.maxPending = maxPending;
    }

    send(
        client: Client,
        frame: string,
        isOpen: (client: Client) => boolean,
        authorize?: SocketOperationAuthorizer<Client>,
        onError: (error: unknown) => void = () => {},
    ): Promise<void> {
        if (!authorize) {
            if (isOpen(client)) client.send(frame);
            return Promise.resolve();
        }
        if (!client || (typeof client !== 'object' && typeof client !== 'function')) return Promise.resolve();
        let state = this.queues.get(client as object);
        if (!state) {
            state = { tail: Promise.resolve(), pending: 0, retired: false };
            this.queues.set(client as object, state);
        }
        if (state.retired) return state.tail;
        if (state.pending >= this.maxPending) {
            this.retire(client, state, 1013, 'Realtime delivery queue is full');
            return state.tail;
        }
        state.pending++;
        const current = state;
        current.tail = current.tail.then(async () => {
            if (current.retired || !isOpen(client)) return;
            let operationRan = false;
            let allowed = false;
            try {
                allowed = await authorize(client, async () => { operationRan = true; });
            } catch (error) {
                onError(error);
            }
            if (!allowed || !operationRan) {
                this.retire(client, current, 1008, 'Realtime authorization changed', true);
                return;
            }
            if (!current.retired && isOpen(client)) client.send(frame);
        }).catch(error => {
            onError(error);
            this.retire(client, current, 1011, 'Realtime delivery failed');
        }).finally(() => { current.pending = Math.max(0, current.pending - 1); });
        return current.tail;
    }

    retire(client: Client, state?: QueueState, code = 1008, reason = 'Realtime connection retired', authorizationChanged = false): void {
        let current = state;
        if (!current && client && (typeof client === 'object' || typeof client === 'function')) {
            current = this.queues.get(client as object);
        }
        if (current?.retired) return;
        if (current) current.retired = true;
        if (authorizationChanged) closeUnauthorizedSocket(client);
        else try { client.close?.(code, reason); } catch { /* the peer may already be closed */ }
    }

    remove(client: Client): void {
        if (!client || (typeof client !== 'object' && typeof client !== 'function')) return;
        const state = this.queues.get(client as object);
        if (state) state.retired = true;
        this.queues.delete(client as object);
    }
}
