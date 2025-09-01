// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';
import 'reflect-metadata';

type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

interface CossackSocket extends WebSocket {
    user?: AuthenticatedUser;
}

export class CossackDurableObject {
    state: DurableObjectState;
    componentInstance?: Cossack;
    componentName?: string;
    private channels: Map<string, Set<CossackSocket>> = new Map();
    private socketToChannels: Map<CossackSocket, string> = new Map();

    constructor(state: DurableObjectState) {
        this.state = state;
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const channel = url.pathname.split('/').pop() || 'global';

        if (this.state.getWebSockets().length === 0) {
            this.componentInstance = undefined;
        }

        const userId = request.headers.get('X-User-ID');
        const componentName = request.headers.get('X-Component-Name');
        const userData = request.headers.get('X-User-Data');
        const paramsData = request.headers.get('X-Component-Params');

        if (!userId || !componentName) {
            return new Response('Required headers are missing', { status: 400 });
        }

        const user: AuthenticatedUser = userData ? JSON.parse(userData) : { id: userId };
        const params: Record<string, string> = paramsData ? JSON.parse(paramsData) : {};

        // Initialize the component instance on the first connection of a session.
        if (!this.componentInstance) {
            this.componentName = componentName;
            const componentRegistry = await this.getComponentRegistry();
            const PageComponent = componentRegistry.get(this.componentName);
            if (PageComponent) {
                this.componentInstance = new PageComponent();
                // Pass the DO instance to the component for broadcasting
                (this.componentInstance as any)._cossack_DO_instance = this;
                // Bootstrap with the params from the original request to ensure state consistency
                await this.componentInstance.bootstrap({ params });
            } else {
                return new Response(`Component ${this.componentName} not found`, { status: 500 });
            }
        }

        const { 0: client, 1: server } = new WebSocketPair();
        const cossackSocket = server as CossackSocket;
        cossackSocket.user = user;

        this.state.acceptWebSocket(cossackSocket);
        this.addSocketToChannel(cossackSocket, channel);

        if (this.componentInstance) {
            let stateToSend = this.componentInstance.getInitialState();
            server.send(JSON.stringify({ type: 'state-update', state: stateToSend }));
        }

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    private addSocketToChannel(ws: CossackSocket, channel: string) {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        this.channels.get(channel)!.add(ws);
        this.socketToChannels.set(ws, channel);
    }

    private removeSocket(ws: CossackSocket) {
        const channel = this.socketToChannels.get(ws);
        if (channel) {
            this.channels.get(channel)?.delete(ws);
            if (this.channels.get(channel)?.size === 0) {
                this.channels.delete(channel);
            }
            this.socketToChannels.delete(ws);
        }
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

    public broadcast(changedProperties: string[]) {
        if (!this.componentInstance) return;

        const stateProperties = Reflect.getMetadata('cossack:state', this.componentInstance.constructor) || {};
        const channelsToUpdate = new Set<string>();

        for (const prop of changedProperties) {
            const channel = stateProperties[prop]?.channel || 'global';
            channelsToUpdate.add(channel);
        }

        const fullState = this.componentInstance.getInitialState();

        for (const channel of channelsToUpdate) {
            const sockets = this.channels.get(channel);
            if (sockets) {
                for (const ws of sockets) {
                    // In a real app, you might filter stateToSend based on user permissions
                    ws.send(JSON.stringify({ type: 'state-update', state: fullState }));
                }
            }
        }
    }

    async webSocketMessage(ws: CossackSocket, message: string | ArrayBuffer) {
        const data = JSON.parse(message as string);
        const user = ws.user!;

        if (this.componentInstance && data.type === 'action') {
            const { action, payload } = data;
            if (typeof (this.componentInstance as any)[action] === 'function') {
                try {
                    await (this.componentInstance as any)[action](user, ...(payload || []));
                    // The broadcast is now handled by the component's state proxy
                } finally {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'action-complete', action: action }));
                    }
                }
            }
        }
    }

    async webSocketClose(ws: CossackSocket, code: number, reason: string, wasClean: boolean) {
        this.removeSocket(ws);
        if (this.state.getWebSockets().length === 0) {
            this.componentInstance = undefined;
        }
    }

    async webSocketError(ws: CossackSocket, error: any) {
        console.error('WebSocket error in Durable Object:', error);
        this.removeSocket(ws);
    }
}