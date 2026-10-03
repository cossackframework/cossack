import type { CossackServerRuntime } from '../runtime';
import { dispatchSocketRpcMessage } from '../runtime';
import type { Cossack } from '../cossack';
import { socketRequestContext, type SocketRequestSnapshot } from '../socket-context';
import { sendRpcFrame } from '../rpc-stream';

export class DurableObjectRuntime implements CossackServerRuntime {
    private component: Cossack;
    private state: DurableObjectState;
    private isStateful: boolean;
    private env: unknown;

    constructor(component: Cossack, state: DurableObjectState, stateful: boolean = false, env?: unknown) {
        this.component = component;
        this.state = state;
        this.isStateful = stateful;
        this.env = env;
        (this.component as any)._runtime = this;
    }

    async onClientMessage(client: WebSocket, message: string): Promise<void> {
        let data: any;
        try {
            data = JSON.parse(message);
        } catch (e) {
            // A single malformed frame must not crash the runtime / close the
            // shared Durable Object connection for all clients.
            console.error('[Cossack] Ignoring malformed WebSocket message:', e);
            return;
        }
        // The attachment deserializes lazily so non-action frames (broadcasts,
        // pings, malformed payloads) never touch DO storage APIs.
        let attachment: { user?: unknown; request?: SocketRequestSnapshot } | undefined;
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
            () => peer().request ? socketRequestContext(peer().request!, this.env, peer().user) : undefined);
    }

    broadcastState(partialState: Record<string, any>): void {
        const message = JSON.stringify({ type: 'state-update', state: partialState });
        for (const ws of this.state.getWebSockets()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    broadcastEvent(eventName: string, payload: any[]): void {
        const message = JSON.stringify({ type: 'event', eventName, payload });
        for (const ws of this.state.getWebSockets()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    sendClientAction(client: WebSocket, action: string, payload: any[]): void {
        const message = JSON.stringify({ type: 'client-action', action, payload });
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }

    get stateful(): boolean {
        return this.isStateful;
    }

    async persistState(): Promise<void> {
        if (!this.isStateful) return;
        const stateToPersist = this.component.getInitialState();
        await this.state.storage.put('componentState', stateToPersist);
    }
}
