// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';

// By extending the WebSocket interface, we can safely attach our component instance to it.
interface CossackSocket extends WebSocket {
    componentInstance?: Cossack;
}

export class CossackDurableObject {
    state: DurableObjectState;
    componentRegistry: Map<string, new () => Cossack>;

    constructor(state: DurableObjectState) {
        this.state = state;
        // The component registry will be initialized on the first request
        this.componentRegistry = new Map();
    }

    async fetch(request: Request) {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected Upgrade: websocket', { status: 426 });
        }

        const { 0: client, 1: server } = new WebSocketPair();

        // We're now accepting the WebSocket connection in the Durable Object.
        // This is a more robust pattern than managing the connection in the main worker.
        this.state.acceptWebSocket(server);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    // The `webSocketMessage` handler is automatically called by the runtime when a message is received.
    async webSocketMessage(ws: CossackSocket, message: string | ArrayBuffer) {
        const data = JSON.parse(message as string);

        try {
            if (!ws.componentInstance) {
                if (data.type === 'init' && data.componentId) {
                    // Eagerly load pages to build the component registry.
                    // This is a workaround for not being able to pass the registry to the DO.
                    if (this.componentRegistry.size === 0) {
                        const eagerPages = import.meta.glob('/src/pages/**/index.ts', { eager: true });
                        for (const path in eagerPages) {
                            const module = eagerPages[path] as any;
                            const PageComponent = Object.values(module as object)[0] as new () => Cossack;
                            if (PageComponent) {
                                this.componentRegistry.set(PageComponent.name, PageComponent);
                            }
                        }
                    }

                    const PageComponent = this.componentRegistry.get(data.componentId);
                    if (PageComponent) {
                        const instance = new PageComponent();
                        ws.componentInstance = instance;
                        await instance.bootstrap({});
                        instance.setServerWebSocket(ws);
                    } else {
                        ws.close(1011, `Component '${data.componentId}' not found in registry.`);
                    }
                } else {
                    ws.close(1011, 'Component not initialized');
                }
            } else {
                const instance = ws.componentInstance;
                if (data.type === 'action') {
                    const { action, payload } = data;
                    if (typeof (instance as any)[action] === 'function') {
                        try {
                            await (instance as any)[action](...(payload || []));
                        } finally {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'action-complete',
                                    action: action,
                                }));
                            }
                        }
                    } else {
                        console.error(`[WebSocket] Action '${action}' not found on component.`);
                    }
                }
            }
        } catch (err) {
            console.error('[WebSocket] Error in messageHandler:', err);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ error: 'An unexpected server error occurred.' }));
            }
        }
    }

    // The `webSocketClose` handler is automatically called by the runtime when a socket closes.
    async webSocketClose(ws: CossackSocket, code: number, reason: string, wasClean: boolean) {
        ws.componentInstance = undefined;
    }

    // The `webSocketError` handler is automatically called by the runtime when a socket errors.
    async webSocketError(ws: CossackSocket, error: any) {
        console.error('WebSocket error in Durable Object:', error);
        ws.componentInstance = undefined;
    }
}

