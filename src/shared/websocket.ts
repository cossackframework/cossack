// src/shared/websocket.ts
import type { Cossack } from './cossack';

interface CossackSocket extends WebSocket {
    componentInstance?: Cossack;
}

export async function handleWebSocketMessage(evt: MessageEvent, ws: WebSocket, componentRegistry: Map<string, new () => Cossack>) {
    const cossackSocket = ws as CossackSocket;
    const data = JSON.parse(evt.data as string);

    try {
        if (!cossackSocket.componentInstance) {
            if (data.type === 'init' && data.componentId) {
                const PageComponent = componentRegistry.get(data.componentId);
                if (PageComponent) {
                    const instance = new PageComponent();
                    cossackSocket.componentInstance = instance;
                    await instance.bootstrap({});
                    instance.setServerWebSocket(cossackSocket);
                } else {
                    cossackSocket.close(1011, `Component '${data.componentId}' not found in registry.`);
                }
            } else {
                cossackSocket.close(1011, 'Component not initialized');
            }
        } else {
            const instance = cossackSocket.componentInstance;
            if (data.type === 'action') {
                const { action, payload } = data;
                if (typeof (instance as any)[action] === 'function') {
                    try {
                        await (instance as any)[action](...(payload || []));
                    } finally {
                        if (cossackSocket.readyState === WebSocket.OPEN) {
                            cossackSocket.send(JSON.stringify({
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
        if (cossackSocket.readyState === WebSocket.OPEN) {
            cossackSocket.send(JSON.stringify({ error: 'An unexpected server error occurred.' }));
        }
    }
}

export function handleWebSocketClose(evt: CloseEvent, ws: WebSocket) {
    const cossackSocket = ws as CossackSocket;
    if (cossackSocket.componentInstance) {
        cossackSocket.componentInstance = undefined;
    }
}

export function handleWebSocketError(err: Event, ws: WebSocket) {
    console.error('WebSocket error:', err);
    const cossackSocket = ws as CossackSocket;
    if (cossackSocket.componentInstance) {
        cossackSocket.componentInstance = undefined;
    }
}
