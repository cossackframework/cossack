import { WebSocket } from 'ws';
import { InMemoryWebSocketRuntime, type Cossack } from '@cossackframework/core';

export class NodeWebSocketRuntime extends InMemoryWebSocketRuntime<WebSocket> {
    constructor(component: Cossack) {
        super(component, {
            isOpen: (client) => client.readyState === WebSocket.OPEN,
            onError: (error) => console.error('[Cossack] Ignoring malformed WebSocket message:', error),
        });
    }

    public override addClient(ws: WebSocket, user?: unknown) {
        super.addClient(ws, user);
        ws.on('close', () => {
            this.removeClient(ws);
        });
        ws.on('message', (data) => {
            this.onClientMessage(ws, data.toString()).catch((error) => {
                console.error('[Cossack] Error handling Node WebSocket message:', error);
            });
        });
    }
}
