// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';
import { DurableObjectRuntime } from './runtimes/durable-object';
import 'reflect-metadata';

type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

export abstract class CossackDurableObject {
    state: DurableObjectState;
    componentInstance?: Cossack;
    runtime?: DurableObjectRuntime;
    env: any;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;
        this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    private async createAndBootstrapComponent(componentName: string, params: Record<string, string>, page: string, providerName: string): Promise<Cossack | undefined> {
        const componentRegistry = await this.getComponentRegistry();
        const PageComponent = componentRegistry.get(componentName);
    
        if (PageComponent) {
            const componentInstance = new PageComponent();
            
            const hydratedContext = {
                req: { param: (key?: string) => key ? params?.[key] : params }
            } as any;
    
            await componentInstance.bootstrap({ context: hydratedContext, env: this.env, page, providerName, skipInit: true });
            
            this.runtime = new DurableObjectRuntime(componentInstance, this.state);
            
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
        const storedData = await this.state.storage.get(['componentName', 'params', 'componentState', 'page', 'providerName']);
        const componentName = storedData.get('componentName') as string | undefined;
        const params = storedData.get('params') as Record<string, string> | undefined;
        const componentState = storedData.get('componentState') as Record<string, any> | undefined;
        const page = storedData.get('page') as string | undefined;
        const providerName = storedData.get('providerName') as string | undefined;
    
        if (!componentName || !page || !providerName) {
            return; // Not an error, just means it's a fresh DO.
        }
        
        const componentInstance = await this.createAndBootstrapComponent(componentName, params || {}, page, providerName);
        if (componentInstance) {
            if (componentState) {
                for (const key in componentState) {
                    (componentInstance as any)[key] = componentState[key];
                }
            }
            this.componentInstance = componentInstance;
            // State already restored from storage - skip init() to prevent reset
        }
    }

    async fetch(request: Request) {
        await this.ensureComponentInstance();

        const componentName = request.headers.get('X-Component-Name');
        const providerName = request.headers.get('X-Provider-Name');

        if (!componentName || !providerName) {
            return new Response('Headers X-Component-Name and X-Provider-Name are required', { status: 400 });
        }

        const url = new URL(request.url);
        const params: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
            params[key] = value;
        });
        const page = params.pathname;

        if (!page) {
            return new Response('pathname query parameter is required for WebSocket connection', { status: 400 });
        }

        if (!this.componentInstance) {
            const componentInstance = await this.createAndBootstrapComponent(componentName, params, page, providerName);
            if (!componentInstance) {
                return new Response('Failed to initialize component', { status: 500 });
            }
            this.componentInstance = componentInstance;
            // For a brand new DO, run init() to seed the initial state (skipInit was used in bootstrap)
            await this.componentInstance.init();

            const initialState = componentInstance.getInitialState();
            await this.state.storage.put({ componentName, params, componentState: initialState, page, providerName });
        }

        const userId = request.headers.get('X-User-ID');
        const userData = request.headers.get('X-User-Data');
        if (!userId) return new Response('Header X-User-ID is required', { status: 400 });
        const user: AuthenticatedUser = userData ? JSON.parse(userData) : { id: userId };

        const { 0: client, 1: server } = new WebSocketPair();
        const channel = url.pathname.split('/').pop() || 'global';
        server.serializeAttachment({ channel, user });
        this.state.acceptWebSocket(server);

        const currentState = this.componentInstance.getInitialState();
        server.send(JSON.stringify({ type: 'state-update', state: currentState }));

        return new Response(null, { status: 101, webSocket: client });
    }

    abstract getComponentRegistry(): Promise<Map<string, new () => Cossack>>;

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        await this.ensureComponentInstance();
        if (!this.componentInstance || !this.runtime) {
            ws.close(1011, 'Component not available, please reconnect');
            return;
        }

        await this.runtime.onClientMessage(ws, message as string);
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {}
    async webSocketError(ws: any) {}
}