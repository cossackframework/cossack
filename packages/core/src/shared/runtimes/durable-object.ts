import { logRuntimeFailure } from '../server-diagnostics';
import type { CossackServerRuntime } from '../runtime';
import { dispatchSocketRpcMessage } from '../runtime';
import type { Cossack } from '../cossack';
import { socketRequestContext, type SocketPeerAttachment } from '../socket-context';
import { sendRpcFrame } from '../rpc-stream';
import { SocketDeliveryQueue, type SocketOperationAuthorizer } from '../socket-delivery';

export type DurableObjectSocketAuthorizer = (
    client: WebSocket,
    attachment: SocketPeerAttachment,
    operation: (context: import('hono').Context) => Promise<void>,
) => Promise<boolean>;

export class DurableObjectRuntime implements CossackServerRuntime {
    private component: Cossack;
    private state: DurableObjectState;
    private isStateful: boolean;
    private env: unknown;
    private authorizePeer?: DurableObjectSocketAuthorizer;
    private delivery = new SocketDeliveryQueue<WebSocket>();

    constructor(component: Cossack, state: DurableObjectState, stateful: boolean = false, env?: unknown,
        authorizePeer?: DurableObjectSocketAuthorizer) {
        this.component = component;
        this.state = state;
        this.isStateful = stateful;
        this.env = env;
        this.authorizePeer = authorizePeer;
        (this.component as any)._runtime = this;
    }

    async onClientMessage(client: WebSocket, message: string): Promise<void> {
        let data: any;
        try {
            data = JSON.parse(message);
        } catch (e) {
            // A single malformed frame must not crash the runtime / close the
            // shared Durable Object connection for all clients.
            logRuntimeFailure({ runtime: 'cloudflare' }, 'parse', 'COSSACK_WEBSOCKET_MESSAGE_INVALID');
            return;
        }
        // The attachment deserializes lazily so non-action frames (broadcasts,
        // pings, malformed payloads) never touch DO storage APIs.
        let attachment: SocketPeerAttachment | undefined;
        const peer = () => attachment ??= client.deserializeAttachment?.() ?? {};
        if (data?.type === 'action' && typeof data.action === 'string' && Array.isArray(data.payload) && !peer().request) {
            // Connections opened before request snapshots were introduced must
            // reauthenticate. Do not execute with guessed identity/headers.
            if (typeof data.requestId === 'string' && data.requestId.trim()) sendRpcFrame(client, {
                v: 1, type: 'error', requestId: data.requestId, code: 'COSSACK_RPC_TRANSPORT_CLOSED',
                message: 'WebSocket request context is unavailable. Reconnect before calling server methods.',
            });
            client.close?.(1012, 'Reconnect to refresh request context');
            return;
        }
        await dispatchSocketRpcMessage(this.component, data, client,
            () => peer().user,
            () => peer().request ? socketRequestContext(peer().request!, this.env, peer().user) : undefined,
            this.authorizePeer ? (candidate, operation) => this.authorizePeer!(candidate as WebSocket, peer(), operation) : undefined);
    }

    broadcastState(partialState: Record<string, any>): void {
        const message = { type: 'state-update', state: partialState };
        const deliveries: Promise<void>[] = [];
        for (const ws of this.state.getWebSockets()) {
            deliveries.push(this.sendToClient(ws, message));
        }
        this.keepAlive(Promise.all(deliveries));
    }

    broadcastEvent(eventName: string, payload: any[]): void {
        const message = { type: 'event', eventName, payload };
        const deliveries: Promise<void>[] = [];
        for (const ws of this.state.getWebSockets()) {
            deliveries.push(this.sendToClient(ws, message));
        }
        this.keepAlive(Promise.all(deliveries));
    }

    sendClientAction(client: WebSocket, action: string, payload: any[]): void {
        this.keepAlive(this.sendToClient(client, { type: 'client-action', action, payload }));
    }

    async sendToClient(client: WebSocket, message: Record<string, unknown>): Promise<void> {
        const authorize: SocketOperationAuthorizer<WebSocket> | undefined = this.authorizePeer
            ? (socket, operation) => this.authorizePeer!(socket, socket.deserializeAttachment?.() ?? {}, operation)
            : undefined;
        await this.delivery.send(client, message, socket => socket.readyState === 1, authorize,
            () => logRuntimeFailure({ runtime: 'cloudflare' }, 'delivery'));
    }

    get stateful(): boolean {
        return this.isStateful;
    }

    async persistState(): Promise<void> {
        if (!this.isStateful) return;
        // Persisted snapshots outlive the request. Component state never holds the user.
        const stateToPersist = this.component.getInitialState();
        await this.state.storage.put('componentState', stateToPersist);
    }

    retireClient(client: WebSocket): void {
        this.delivery.remove(client);
    }

    private keepAlive(work: Promise<unknown>): void {
        if (typeof this.state.waitUntil === 'function') this.state.waitUntil(work);
        else void work.catch(() => {});
    }
}
