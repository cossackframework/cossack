import { WebSocket } from 'ws';
import type { Cossack, CossackServerRuntime } from '@cossackframework/core';

export class NodeWebSocketRuntime implements CossackServerRuntime {
    private component: Cossack;
    private clients: Set<WebSocket> = new Set();

    constructor(component: Cossack) {
        this.component = component;
        (this.component as any)._runtime = this;
    }

    public addClient(ws: WebSocket, user?: any) {
        this.clients.add(ws);
        
        // Attach user to the websocket object for later retrieval if needed, 
        // similar to how Cloudflare's WebSocket attachment works, 
        // though strictly typing this would require extending WebSocket.
        (ws as any).user = user;

        ws.on('close', () => {
            this.clients.delete(ws);
        });
        
        ws.on('message', (data) => {
             this.onClientMessage(ws, data.toString()).catch((e) => {
                 console.error('[Cossack] Error handling Node WebSocket message:', e);
             });
        });
    }

    async onClientMessage(client: unknown, message: string): Promise<void> {
        const ws = client as WebSocket;
        let data: any;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('[Cossack] Ignoring malformed WebSocket message:', e);
            return;
        }
        if (!data || typeof data !== 'object' || data.type !== 'action' ||
            typeof data.action !== 'string' || !Array.isArray(data.payload)) {
            return;
        }

        const user = (ws as any).user;
        await this.component.executeAction(data.action, data.payload, user, client);
    }

    broadcastState(partialState: Record<string, any>): void {
        const message = JSON.stringify({ type: 'state-update', state: partialState });
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    broadcastEvent(eventName: string, payload: any[]): void {
        const message = JSON.stringify({ type: 'event', eventName, payload });
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    sendClientAction(client: unknown, action: string, payload: any[]): void {
        const ws = client as WebSocket;
        const message = JSON.stringify({ type: 'client-action', action, payload });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    }

    async persistState(): Promise<void> {
        // TODO: Implement pluggable persistence for Node.js (e.g., Redis, file system, DB)
        // For now, state is just in-memory in the component instance.
    }
}
