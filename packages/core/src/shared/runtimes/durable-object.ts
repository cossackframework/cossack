import type { CossackServerRuntime } from '../runtime';
import type { Cossack } from '../cossack';

export class DurableObjectRuntime implements CossackServerRuntime {
    private component: Cossack;
    private state: DurableObjectState;
    private isStateful: boolean;

    constructor(component: Cossack, state: DurableObjectState, stateful: boolean = false) {
        this.component = component;
        this.state = state;
        this.isStateful = stateful;
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
        if (!data || typeof data !== 'object' || data.type !== 'action' ||
            typeof data.action !== 'string' || !Array.isArray(data.payload)) {
            return;
        }
        const { user } = (client as any).deserializeAttachment() as any;

        let targetInstance = this.component;
        if (data.target && data.target !== targetInstance._id) {
            if (targetInstance.activeComponents.has(data.target)) {
                targetInstance = targetInstance.activeComponents.get(data.target)!;
            } else {
                console.warn(`[Cossack] Target component '${data.target}' not found. Action '${data.action}' dropped.`);
                return;
            }
        }

        await targetInstance.executeAction(data.action, data.payload, user, client);
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
