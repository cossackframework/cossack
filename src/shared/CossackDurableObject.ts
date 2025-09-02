// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';
import 'reflect-metadata';

type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

export class CossackDurableObject {
    state: DurableObjectState;
    componentInstance?: Cossack;

    constructor(state: DurableObjectState) {
        this.state = state;
        this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    async ensureComponentInstance(): Promise<void> {
        if (this.componentInstance) {
            return;
        }
        console.log('[DO] ensureComponentInstance: Component instance not found. Re-initializing...');
        const storedData = await this.state.storage.get(['componentName', 'params']);
        const componentName = storedData.get('componentName') as string | undefined;
        const params = storedData.get('params') as Record<string, string> | undefined;

        if (!componentName) {
            console.error('[DO] ensureComponentInstance: Cannot initialize component, metadata not found in storage.');
            // Close all websockets because the DO is in a broken state.
            this.state.getWebSockets().forEach(ws => ws.close(1011, 'Internal Server Error'));
            return;
        }

        const componentRegistry = await this.getComponentRegistry();
        const PageComponent = componentRegistry.get(componentName);

        if (PageComponent) {
            this.componentInstance = new PageComponent();
            (this.componentInstance as any)._cossack_DO_instance = this;
            
            // Create a hydrated context for the server-side component instance in the DO
            const hydratedContext = {
                req: {
                    param: (key?: string) => key ? params?.[key] : params
                }
            } as any; // We cast to `any` to satisfy the bootstrap method's `Context` type

            await this.componentInstance.bootstrap({ context: hydratedContext });
            console.log('[DO] ensureComponentInstance: Component instance re-initialized successfully.');
        }
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const channel = url.pathname.split('/').pop() || 'global';
        console.log(`[DO] fetch: New connection for channel: ${channel}`);

        // This now only runs for the very first request that creates the DO.
        if (!this.componentInstance) {
            const componentName = request.headers.get('X-Component-Name');
            const paramsData = request.headers.get('X-Component-Params');
            if (!componentName) return new Response('Header X-Component-Name is required', { status: 400 });
            
            const params = paramsData ? JSON.parse(paramsData) : {};
            // Persist the metadata needed to re-create the component instance after hibernation.
            await this.state.storage.put({ componentName, params });
        }

        // Ensure the instance exists, especially for subsequent connections to a non-hibernated DO.
        await this.ensureComponentInstance();

        const userId = request.headers.get('X-User-ID');
        const userData = request.headers.get('X-User-Data');
        if (!userId) return new Response('Header X-User-ID is required', { status: 400 });
        const user: AuthenticatedUser = userData ? JSON.parse(userData) : { id: userId };

        const { 0: client, 1: server } = new WebSocketPair();
        server.serializeAttachment({ channel, user });
        this.state.acceptWebSocket(server);

        // Immediately send the current authoritative state to the newly connected client.
        // This solves the refresh issue by ensuring the client syncs with the DO's state.
        if (this.componentInstance) {
            const currentState = this.componentInstance.getInitialState();
            server.send(JSON.stringify({ type: 'state-update', state: currentState }));
        }

        return new Response(null, { status: 101, webSocket: client });
    }

    async getComponentRegistry(): Promise<Map<string, new () => Cossack>> {
        const registry = new Map<string, new () => Cossack>();
        const eagerPages = import.meta.glob('/src/pages/**/index.ts', { eager: true });
        for (const path in eagerPages) {
            const module = eagerPages[path] as any;
            const PageComponent = Object.values(module as object)[0] as new () => Cossack;
            if (PageComponent) registry.set(PageComponent.name, PageComponent);
        }
        return registry;
    }

    public async sendClientAction(channel: string, action: string, payload: any[]) {
        const message = JSON.stringify({ type: 'client-action', action, payload });
        const sockets = this.state.getWebSockets();
        const socketsForChannel = sockets.filter(ws => (ws.deserializeAttachment() as any).channel === channel);
        
        console.log(`[DO] sendClientAction: Sending action '${action}' to ${socketsForChannel.length} clients on channel '${channel}'`);
        for (const ws of socketsForChannel) {
            ws.send(message);
        }
    }

    public async broadcast(changedProperties: string[]) {
        await this.ensureComponentInstance();
        if (!this.componentInstance) return;

        const stateProperties = Reflect.getMetadata('cossack:state', this.componentInstance.constructor) || {};
        const channelsToUpdate = new Set<string>();
        for (const prop of changedProperties) {
            channelsToUpdate.add(stateProperties[prop]?.channel || 'global');
        }

        const fullState = this.componentInstance.getInitialState();
        const sockets = this.state.getWebSockets();

        for (const channel of channelsToUpdate) {
            const socketsForChannel = sockets.filter(ws => (ws.deserializeAttachment() as any).channel === channel);
            console.log(`[DO] broadcast: Broadcasting to ${socketsForChannel.length} sockets on channel '${channel}'`);
            for (const ws of socketsForChannel) {
                ws.send(JSON.stringify({ type: 'state-update', state: fullState }));
            }
        }
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        await this.ensureComponentInstance();
        if (!this.componentInstance) {
            ws.close(1011, 'Component not available');
            return;
        }

        const data = JSON.parse(message as string);
        if (data.type === 'action') {
            const { user } = ws.deserializeAttachment() as any;
            const { action, payload } = data;
            if (typeof (this.componentInstance as any)[action] === 'function') {
                try {
                    await (this.componentInstance as any)[action](user, ...(payload || []));
                } finally {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'action-complete', action }));
                    }
                }
            }
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        console.log(`[DO] webSocketClose: Socket closed. Code: ${code}, Reason: ${reason}`);
    }

    async webSocketError(ws: WebSocket, error: any) {
        console.error('[DO] webSocketError:', error);
    }
}