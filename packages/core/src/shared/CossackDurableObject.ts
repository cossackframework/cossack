// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';
import type { AuthenticatedUser } from './user';
import { DurableObjectRuntime } from './runtimes/durable-object';
import 'reflect-metadata';

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
        const storedData = await this.state.storage.get(['componentPath', 'url', 'params', 'componentState', 'providerName']);
        const componentPath = storedData.get('componentPath') as string | undefined;
        const url = storedData.get('url') as string | undefined;
        const params = storedData.get('params') as Record<string, string> | undefined;
        const componentState = storedData.get('componentState') as Record<string, any> | undefined;
        const providerName = storedData.get('providerName') as string | undefined;

        if (!componentPath || !url || !providerName) {
            return;
        }

        const componentInstance = await this.createAndBootstrapComponent(componentPath, params || {}, url, providerName);
        if (componentInstance) {
            if (componentState) {
                // Restore children state registry
                if (componentState.children) {
                    (componentInstance as any)._childrenStateRegistry = componentState.children;
                }

                // Restore public state from SerializedComponentState
                const publicState = componentState.public || {};
                for (const key in publicState) {
                    (componentInstance as any)[key] = publicState[key];
                }
            }
            // Rebuild the component tree to populate activeComponents
            componentInstance._render();

            this.componentInstance = componentInstance;
        }
    }

    async fetch(request: Request) {
        const url = new URL(request.url);

        // Handle HTTP state requests for SSR
        if (request.method === 'GET' && url.pathname === '/state') {
            return this.handleStateRequest(request);
        }

        await this.ensureComponentInstance();

        const componentPath = request.headers.get('X-Component-Path');
        const providerName = request.headers.get('X-Provider-Name');

        if (!componentPath || !providerName) {
            return new Response('Headers X-Component-Path and X-Provider-Name are required', { status: 400 });
        }

        const params: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
            params[key] = value;
        });
        const page = params.pathname;

        if (!page) {
            return new Response('pathname query parameter is required for WebSocket connection', { status: 400 });
        }

        if (!this.componentInstance) {
            const componentInstance = await this.createAndBootstrapComponent(componentPath, params, page, providerName);
            if (!componentInstance) {
                return new Response('Failed to initialize component', { status: 500 });
            }
            this.componentInstance = componentInstance;
            // For a brand new DO, run init() to seed the initial state (skipInit was used in bootstrap)
            await this.componentInstance.init();

            const initialState = componentInstance.getInitialState();
            // Store the full URL for consistent DO ID generation
            const fullUrl = `${page}${url.search}`;
            await this.state.storage.put({ componentPath, url: fullUrl, params, componentState: initialState, providerName });
        }

        const userId = request.headers.get('X-User-ID');
        const userData = request.headers.get('X-User-Data');
        const user: AuthenticatedUser = userId
            ? (userData ? JSON.parse(userData) : { id: userId })
            : { id: 'anonymous' };

        const { 0: client, 1: server } = new WebSocketPair();
        const channel = url.pathname.split('/').pop() || 'global';
        server.serializeAttachment({ channel, user });
        this.state.acceptWebSocket(server);

        // Send only the public state to the client (not the entire SerializedComponentState)
        const currentState = this.componentInstance.getInitialState();
        server.send(JSON.stringify({ type: 'state-update', state: currentState.public }));

        return new Response(null, { status: 101, webSocket: client });
    }

    abstract getComponentRegistry(): Promise<Map<string, new () => Cossack>>;

    /**
     * Handle HTTP requests to the DO (for querying state during SSR)
     * Supports a GET endpoint to retrieve the current component state
     */
    async handleStateRequest(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // Extract component context from query params for on-demand initialization
        const componentPath = url.searchParams.get('componentPath');
        const paramsStr = url.searchParams.get('params');
        const fullUrl = url.searchParams.get('url');
        const providerName = url.searchParams.get('providerName');

        // If DO hasn't been initialized yet, create it on-demand with the provided context
        if (!this.componentInstance && componentPath && fullUrl && providerName) {
            const params = paramsStr ? JSON.parse(paramsStr) : {};
            await this.createAndBootstrapComponent(componentPath, params, fullUrl, providerName);
        }

        await this.ensureComponentInstance();
        if (!this.componentInstance) {
            return new Response(JSON.stringify({ error: 'Component not initialized' }), { status: 404 });
        }

        if (url.pathname === '/state') {
            const currentState = this.componentInstance.getInitialState();
            return new Response(JSON.stringify(currentState), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response('Not found', { status: 404 });
    }

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