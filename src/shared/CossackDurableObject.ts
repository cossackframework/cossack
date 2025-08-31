// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';

// Define a user type for clarity. In a real app, this would be more complex.
type AuthenticatedUser = {
    id: string;
    [key: string]: any; // Allow other properties like friends, roles, etc.
};

// Extend the WebSocket interface to attach our user and component instance.
interface CossackSocket extends WebSocket {
    user?: AuthenticatedUser;
}

export class CossackDurableObject {
    state: DurableObjectState;
    componentInstance?: Cossack;
    componentName?: string;

    constructor(state: DurableObjectState) {
        this.state = state;
    }

    async fetch(request: Request) {
        // If there are no connected clients, this is a new session.
        // We must reset the component instance to ensure a fresh state.
        if (this.state.getWebSockets().length === 0) {
            this.componentInstance = undefined;
        }

        // The worker is responsible for authentication and passes user info in headers.
        const userId = request.headers.get('X-User-ID');
        const componentName = request.headers.get('X-Component-Name');
        const userData = request.headers.get('X-User-Data');

        if (!userId || !componentName) {
            return new Response('Required headers are missing', { status: 400 });
        }

        const user: AuthenticatedUser = userData ? JSON.parse(userData) : { id: userId };

        // Initialize the component instance on the first connection of a session.
        if (!this.componentInstance) {
            this.componentName = componentName;
            const componentRegistry = await this.getComponentRegistry();
            const PageComponent = componentRegistry.get(this.componentName);
            if (PageComponent) {
                this.componentInstance = new PageComponent();
                // Bootstrap the component on the server to initialize its state.
                await this.componentInstance.bootstrap({});
            } else {
                return new Response(`Component ${this.componentName} not found`, { status: 500 });
            }
        }

        const { 0: client, 1: server } = new WebSocketPair();
        
        // Tag the WebSocket with the user object for secure, server-side filtering.
        this.state.acceptWebSocket(server, [JSON.stringify(user)]);

        // Immediately send the current state to the newly connected client.
        // This ensures they don't see a stale view from the initial SSR.
        if (this.componentInstance) {
            let stateToSend = this.componentInstance.getInitialState();
            // We must still respect the security filter for this initial payload.
            if (typeof this.componentInstance.webSocketBroadcastFilter === 'function') {
                stateToSend = this.componentInstance.webSocketBroadcastFilter(this.componentInstance, user);
            }
            server.send(JSON.stringify({ type: 'state-update', state: stateToSend }));
        }

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    async getComponentRegistry(): Promise<Map<string, new () => Cossack>> {
        const registry = new Map<string, new () => Cossack>();
        const eagerPages = import.meta.glob('/src/pages/**/index.ts', { eager: true });
        for (const path in eagerPages) {
            const module = eagerPages[path] as any;
            const PageComponent = Object.values(module as object)[0] as new () => Cossack;
            if (PageComponent) {
                registry.set(PageComponent.name, PageComponent);
            }
        }
        return registry;
    }

    broadcast(initiatorWs?: CossackSocket) {
        if (!this.componentInstance) return;

        const sharedState = this.componentInstance.getInitialState();
        const sockets = this.state.getWebSockets();

        for (const ws of sockets) {
            const cossackSocket = ws as CossackSocket;
            const [userJson] = this.state.getTags(cossackSocket);
            const user: AuthenticatedUser = JSON.parse(userJson);

            let stateToSend = sharedState;

            // If the component has a filter method, use it to create a personalized view.
            if (typeof this.componentInstance.webSocketBroadcastFilter === 'function') {
                stateToSend = this.componentInstance.webSocketBroadcastFilter(this.componentInstance, user);
            }

            cossackSocket.send(JSON.stringify({ type: 'state-update', state: stateToSend }));
        }
    }

    async webSocketMessage(ws: CossackSocket, message: string | ArrayBuffer) {
        const data = JSON.parse(message as string);
        const [userJson] = this.state.getTags(ws);
        const user: AuthenticatedUser = JSON.parse(userJson);

        if (this.componentInstance && data.type === 'action') {
            const { action, payload } = data;
            if (typeof (this.componentInstance as any)[action] === 'function') {
                try {
                    // Pass the authenticated user to the action for context and security.
                    await (this.componentInstance as any)[action](user, ...(payload || []));
                    // After the action, broadcast the new state to all clients.
                    this.broadcast(ws);
                } finally {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'action-complete', action: action }));
                    }
                }
            }
        }
    }

    async webSocketClose(ws: CossackSocket, code: number, reason: string, wasClean: boolean) {
        // After a socket closes, check if any other clients are connected.
        // If not, the session is over, and we should destroy the component instance
        // to ensure the next user gets a fresh state.
        if (this.state.getWebSockets().length === 0) {
            this.componentInstance = undefined;
        }
    }

    async webSocketError(ws: CossackSocket, error: any) {
        console.error('WebSocket error in Durable Object:', error);
    }
}