// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';
import type { User } from './user';
import type { PageOptions } from './decorators';
import { DurableObjectRuntime } from './runtimes/durable-object';
import './metadata';

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

            // Get stateful option from component metadata
            const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);
            const isStateful = pageOptions?.stateful === true;

            this.runtime = new DurableObjectRuntime(componentInstance, this.state, isStateful);

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

        // Check if this DO is stateful
        const storedConfig = await this.state.storage.get(['stateful', 'componentPath', 'url', 'params', 'componentState', 'providerName']);
        const isStateful = storedConfig.get('stateful') === true;

        if (!isStateful) {
            // Stateless DOs don't restore from storage
            return;
        }

        const componentPath = storedConfig.get('componentPath') as string | undefined;
        const url = storedConfig.get('url') as string | undefined;
        const params = storedConfig.get('params') as Record<string, string> | undefined;
        const componentState = storedConfig.get('componentState') as Record<string, any> | undefined;
        const providerName = storedConfig.get('providerName') as string | undefined;

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

        let params: Record<string, string>;
        try {
            const parsed: unknown = JSON.parse(url.searchParams.get('params') || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
                Object.values(parsed).some((value) => typeof value !== 'string')) {
                throw new TypeError('params must be a string record');
            }
            params = parsed as Record<string, string>;
        } catch {
            return new Response('Invalid WebSocket route params', { status: 400 });
        }
        const page = url.searchParams.get('pathname');

        if (!page) {
            return new Response('pathname query parameter is required for WebSocket connection', { status: 400 });
        }

        // For stateless DOs, discard the in-memory component when the DO is idle
        // (no other clients connected). This prevents stale in-memory state from
        // leaking into a new session. Cloudflare keeps idle DOs in memory for
        // several seconds after the last request, so the old componentInstance
        // would otherwise persist and serve mutated state to new clients.
        if (this.componentInstance && !this.runtime?.stateful && this.state.getWebSockets().length === 0) {
            this.componentInstance = undefined;
            this.runtime = undefined;
        }

        if (!this.componentInstance) {
            const componentInstance = await this.createAndBootstrapComponent(componentPath, params, page, providerName);
            if (!componentInstance) {
                return new Response('Failed to initialize component', { status: 500 });
            }
            this.componentInstance = componentInstance;
            // For a brand new DO, run init() to seed the initial state (skipInit was used in bootstrap)
            await this.componentInstance.init();

            // Only persist to DO storage if stateful
            const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', componentInstance.constructor);
            const isStateful = pageOptions?.stateful === true;

            if (isStateful) {
                const initialState = componentInstance.getInitialState();
                const fullUrl = `${page}${url.search}`;
                await this.state.storage.put({ componentPath, url: fullUrl, params, componentState: initialState, providerName, stateful: true });
            }
        }

        const userId = request.headers.get('X-User-ID');
        const userData = request.headers.get('X-User-Data');
        const user: User = userId
            ? (userData ? JSON.parse(userData) : { id: userId })
            : { id: 'anonymous' };

        const { 0: client, 1: server } = new WebSocketPair();
        const channel = url.pathname.split('/').pop() || 'global';
        server.serializeAttachment({ channel, user });
        this.state.acceptWebSocket(server);

        // For stateful DOs, send the current in-memory state so the client syncs immediately.
        // For stateless DOs, skip this — the client uses SSR-provided defaults and only
        // receives state updates from real-time broadcasts.
        if (this.runtime?.stateful) {
            const currentState = this.componentInstance.getInitialState();
            server.send(JSON.stringify({ type: 'state-update', state: currentState.public }));
        }

        return new Response(null, { status: 101, webSocket: client });
    }

    abstract getComponentRegistry(): Promise<Map<string, new () => Cossack>>;

    /**
     * Handle HTTP requests to the DO (for querying state during SSR)
     * Supports a GET endpoint to retrieve the current component state
     */
    async handleStateRequest(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // For stateless mode, return empty state so SSR uses defaults
        const storedStateful = await this.state.storage.get('stateful');
        if (storedStateful !== true) {
            return new Response(JSON.stringify({ public: {} }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

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
