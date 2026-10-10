import { logRuntimeFailure } from '@cossackframework/core/server-diagnostics';
import { WebSocket } from 'ws';
import { InMemoryWebSocketRuntime, type Cossack } from '@cossackframework/core';
import type { Context } from 'hono';

export class NodeWebSocketRuntime extends InMemoryWebSocketRuntime<WebSocket> {
    constructor(component: Cossack) {
        super(component, {
            isOpen: (client) => client.readyState === WebSocket.OPEN,
            onError: () => logRuntimeFailure({ runtime: 'node' }, 'dispatch'),
        });
    }

    public override addClient(
        ws: WebSocket,
        user?: unknown,
        context?: Context,
        authorize?: (client: WebSocket, operation: (context: Context) => Promise<void>) => Promise<boolean>,
    ) {
        super.addClient(ws, user, context, authorize);
        ws.on('close', () => {
            this.removeClient(ws);
        });
        ws.on('message', (data) => {
            this.onClientMessage(ws, data.toString()).catch((error) => {
                logRuntimeFailure({ runtime: 'node' }, 'dispatch');
            });
        });
    }
}
