// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';
import 'reflect-metadata';

type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

export abstract class CossackDurableObject {
    state: DurableObjectState;
    componentInstance?: Cossack;

    constructor(state: DurableObjectState) {
        this.state = state;
        this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    private async createAndBootstrapComponent(componentName: string, params: Record<string, string>): Promise<Cossack | undefined> {
        const componentRegistry = await this.getComponentRegistry();
        const PageComponent = componentRegistry.get(componentName);
    
        if (PageComponent) {
            const componentInstance = new PageComponent();
            (componentInstance as any)._cossack_DO_instance = this;
            
            const hydratedContext = {
                req: { param: (key?: string) => key ? params?.[key] : params }
            } as any;
    
            await componentInstance.bootstrap({ context: hydratedContext });
            console.log(`[DO] Component '${componentName}' bootstrapped successfully.`);
            return componentInstance;
        } else {
            console.error(`[DO] Component '${componentName}' not found in registry.`);
            this.state.getWebSockets().forEach(ws => ws.close(1011, 'Component not found'));
            return undefined;
        }
    }

    private async ensureComponentInstance(): Promise<void> {
        if (this.componentInstance) {
            return;
        }
        console.log('[DO] Hibernated instance waking up. Initializing from storage...');
        const storedData = await this.state.storage.get(['componentName', 'params', 'componentState']);
        const componentName = storedData.get('componentName') as string | undefined;
        const params = storedData.get('params') as Record<string, string> | undefined;
        const componentState = storedData.get('componentState') as Record<string, any> | undefined;
    
        if (!componentName || !params) {
            console.error('[DO] Cannot revive component, metadata not found in storage.');
            return;
        }
        
        const componentInstance = await this.createAndBootstrapComponent(componentName, params);
        if (componentInstance) {
            if (componentState) {
                console.log('[DO] Applying persisted state...');
                for (const key in componentState) {
                    (componentInstance as any)[key] = componentState[key];
                }
            }
            this.componentInstance = componentInstance;
        }
    }

    async fetch(request: Request) {
        // On a new connection, always try to revive an existing session first.
        await this.ensureComponentInstance();

        // If there's no instance, it means this is the first-ever request.
        if (!this.componentInstance) {
            console.log('[DO] No instance found, creating new component...');
            const componentName = request.headers.get('X-Component-Name');
            const paramsData = request.headers.get('X-Component-Params');
            if (!componentName) return new Response('Header X-Component-Name is required', { status: 400 });
            
            const params = paramsData ? JSON.parse(paramsData) : {};
            
            const componentInstance = await this.createAndBootstrapComponent(componentName, params);
            if (!componentInstance) {
                return new Response('Failed to initialize component', { status: 500 });
            }
            this.componentInstance = componentInstance;

            // Save the full initial state to create the first snapshot.
            const initialState = componentInstance.getInitialState();
            await this.state.storage.put({ componentName, params, componentState: initialState });
        }

        const userId = request.headers.get('X-User-ID');
        const userData = request.headers.get('X-User-Data');
        if (!userId) return new Response('Header X-User-ID is required', { status: 400 });
        const user: AuthenticatedUser = userData ? JSON.parse(userData) : { id: userId };

        const { 0: client, 1: server } = new WebSocketPair();
        const channel = new URL(request.url).pathname.split('/').pop() || 'global';
        server.serializeAttachment({ channel, user });
        this.state.acceptWebSocket(server);

        // Always send the latest state to the connecting client.
        const currentState = this.componentInstance.getInitialState();
        server.send(JSON.stringify({ type: 'state-update', state: currentState }));

        return new Response(null, { status: 101, webSocket: client });
    }

    abstract getComponentRegistry(): Promise<Map<string, new () => Cossack>>;

    public async persistState() {
        if (!this.componentInstance) return;
        const stateToPersist = this.componentInstance.getInitialState();
        await this.state.storage.put('componentState', stateToPersist);
        console.log('[DO] Component state persisted.');
    }

    public async sendClientAction(channel: string, action: string, payload: any[]) {
        const message = JSON.stringify({ type: 'client-action', action, payload });
        const sockets = this.state.getWebSockets();
        const socketsForChannel = sockets.filter(ws => (ws.deserializeAttachment() as any).channel === channel);
        
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
            for (const ws of socketsForChannel) {
                ws.send(JSON.stringify({ type: 'state-update', state: fullState }));
            }
        }
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        await this.ensureComponentInstance();
        if (!this.componentInstance) {
            ws.close(1011, 'Component not available, please reconnect');
            return;
        }

        const data = JSON.parse(message as string);
        if (data.type === 'action') {
            const { user } = ws.deserializeAttachment() as any;
            const { action, payload } = data;
            if (typeof (this.componentInstance as any)[action] === 'function') {
                try {
                    await (this.componentInstance as any)[action](...(payload || []), user);
                } finally {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'action-complete', action }));
                    }
                }
            }
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {}
    async webSocketError(ws: WebSocket, error: any) {}
}