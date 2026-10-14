// src/shared/CossackDurableObject.ts
import type { Cossack } from './cossack';
import type { User } from './user';
import type { SerializedComponentState } from './component-types';
import type { PageOptions } from './decorators';
import { DurableObjectRuntime } from './runtimes/durable-object';
import './metadata';
import { snapshotSocketRequest, socketRequestContext, type SocketPeerAttachment } from './socket-context';
import type { Context } from 'hono';
import { rpcCancellations } from './rpc-stream';
import { closeUnauthorizedSocket } from './socket-delivery';
import { logRuntimeFailure } from './server-diagnostics';

export abstract class CossackDurableObject {
    state: DurableObjectState;
    componentInstance?: Cossack;
    runtime?: DurableObjectRuntime;
    env: any;
    private componentInitialization?: Promise<void>;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;
        this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    /**
     * One unpublished component owns bootstrap/restoration until it is ready.
     * Callers wait for any pending operation, then run their own: operations
     * differ (restore vs. create+accept), so a caller must never adopt another
     * caller's promise. Each operation re-checks `componentInstance` itself.
     * A failed pending operation rejects its waiters too (no retry storm).
     */
    private async initializeComponent(operation: () => Promise<void>): Promise<void> {
        while (this.componentInitialization) await this.componentInitialization;
        const pending = Promise.resolve().then(operation);
        this.componentInitialization = pending;
        try { await pending; }
        finally { if (this.componentInitialization === pending) this.componentInitialization = undefined; }
    }

    private async disposeComponent(component: Cossack): Promise<void> {
        try { await component.destroyAsync(); }
        catch { logRuntimeFailure({ runtime: 'cloudflare' }, 'component-cleanup', 'COSSACK_COMPONENT_CLEANUP_FAILED'); }
    }

    private publishComponent(component: Cossack): void {
        const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', component.constructor);
        const runtime = new DurableObjectRuntime(component, this.state, pageOptions?.stateful === true, this.env,
            (client, attachment, operation) => this.authorizeWebSocketPeer(client, attachment, operation));
        this.runtime = runtime;
        this.componentInstance = component;
    }

    private async createAndBootstrapComponent(componentName: string, params: Record<string, string>, page: string, providerName: string,
        initialState?: SerializedComponentState): Promise<Cossack | undefined> {
        const PageComponent = (await this.getComponentRegistry()).get(componentName);
        if (!PageComponent) {
            logRuntimeFailure({ runtime: 'cloudflare' }, 'initialization');
            this.state.getWebSockets().forEach(ws => ws.close(1011, 'Component not found'));
            return undefined;
        }
        const component = new PageComponent();
        component.__cossack_rpcOwner = componentName;
        const context = { req: { param: (key?: string) => key ? params[key] : params } } as any;
        try { await component.bootstrap({ context, env: this.env, page, providerName, skipInit: true, initialState }); }
        catch (error) { await this.disposeComponent(component); throw error; }
        return component;
    }

    private async ensureComponentInstance(): Promise<void> {
        if (this.componentInstance) return;
        await this.initializeComponent(async () => {
            if (this.componentInstance) return;
            const stored = await this.state.storage.get(['stateful', 'componentPath', 'url', 'params', 'componentState', 'providerName']);
            if (stored.get('stateful') !== true) return;
            const componentPath = stored.get('componentPath') as string | undefined;
            const url = stored.get('url') as string | undefined;
            const providerName = stored.get('providerName') as string | undefined;
            if (!componentPath || !url || !providerName) return;
            // Restore through bootstrap's state initialization (the same path
            // as bootstrap({ initialState }) elsewhere): assigning persisted
            // keys through reactive setters would broadcast and re-persist
            // the state that was just read.
            const snapshot = stored.get('componentState') as SerializedComponentState | undefined;
            const component = await this.createAndBootstrapComponent(componentPath,
                stored.get('params') as Record<string, string> || {}, url, providerName, snapshot);
            if (!component) return;
            try {
                component._render();
                this.publishComponent(component);
            } catch (error) { await this.disposeComponent(component); throw error; }
        });
    }

    async fetch(request: Request) {
        const url = new URL(request.url);

        // Handle HTTP state requests for SSR
        if (request.method === 'GET' && url.pathname === '/state') {
            return this.handleStateRequest(request);
        }

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

        // Identity assertions are supplied by the Worker proxy, never message
        // payloads. Anonymous peers have no user, so the default key uses IP.
        const encodedUserId = request.headers.get('X-User-ID');
        const identityHeader = request.headers.get('X-Cossack-Realtime-Identity');
        const encodedScopeKey = request.headers.get('X-Cossack-Realtime-Scope');
        let scopeKey: string | undefined;
        const targetValidity = request.headers.get('X-Cossack-Realtime-Target-Valid');
        let targetValid = true;
        let user: User | undefined;
        let identity: unknown;
        try {
            // The proxy forwards only the percent-encoded id. Framework runtimes
            // resolve the full user through middleware in authorizeWebSocketPeer.
            if (encodedUserId !== null) {
                const userId = decodeURIComponent(encodedUserId);
                if (!userId) throw new TypeError('Invalid identity assertion');
                user = { id: userId } as User;
            }
            if (identityHeader) {
                if (new TextEncoder().encode(identityHeader).length > 1024) throw new TypeError('Realtime identity exceeds limits');
                identity = JSON.parse(identityHeader);
                if (!identity || typeof identity !== 'object' || Array.isArray(identity) ||
                    (identity as any).version !== 1 || typeof (identity as any).provider !== 'string' || !('data' in (identity as any))) {
                    throw new TypeError('Invalid realtime identity');
                }
            }
            if (encodedScopeKey !== null) scopeKey = decodeURIComponent(encodedScopeKey);
            if (scopeKey !== undefined && (!scopeKey || scopeKey.length > 2048)) throw new TypeError('Invalid realtime scope');
            if (targetValidity !== null) {
                if (targetValidity !== 'true' && targetValidity !== 'false') throw new TypeError('Invalid realtime target status');
                targetValid = targetValidity === 'true';
            }
        } catch {
            return Response.json({ code: 'COSSACK_WS_CONTEXT_INVALID', error: 'Invalid WebSocket identity context.' }, { status: 400 });
        }
        const { 0: client, 1: server } = new WebSocketPair();
        const channel = url.pathname.split('/').pop() || 'global';
        const peer: SocketPeerAttachment = {
            channel, user, request: snapshotSocketRequest(request, params), identity, componentPath, scopeKey,
        };
        try {
            // Attachment limits depend on the Workers runtime version. Refuse
            // an oversized snapshot; silently dropping headers changes budgets.
            server.serializeAttachment(peer);
        } catch {
            // This attachment consists entirely of JSON identity data and
            // string request metadata. The runtime's capacity exception is a
            // plain Error on workerd, rather than a RangeError.
            return Response.json({ code: 'COSSACK_WS_CONTEXT_TOO_LARGE', error: 'WebSocket peer context exceeds the attachment limit.' }, { status: 413 });
        }

        // Recheck credentials immediately before the DO initializes or joins
        // component state. Outbound frames and later actions repeat this check.
        const authorized = targetValid && await this.authorizeWebSocketPeer(server, peer, async () => {});
        if (!authorized) {
            // Once upgraded, the browser can distinguish a terminal auth change
            // from a transient network failure and stop stale reconnect loops.
            this.state.acceptWebSocket(server);
            closeUnauthorizedSocket(server);
            return new Response(null, { status: 101, webSocket: client });
        }

        await this.ensureComponentInstance();
        if (this.componentInstance && this.componentInstance.__cossack_rpcOwner !== componentPath) {
            return Response.json({ code: 'COSSACK_WS_SCOPE_MISMATCH', error: 'WebSocket component does not match its Durable Object scope.' }, { status: 403 });
        }

        let accepted = false;
        await this.initializeComponent(async () => {
            if (this.componentInstance && this.componentInstance.__cossack_rpcOwner !== componentPath) return;
            // Discard idle stateless state once, inside the same initialization
            // ownership as its replacement. Cleanup cannot race another join.
            if (this.componentInstance && !this.runtime?.stateful && this.state.getWebSockets().length === 0) {
                const previous = this.componentInstance;
                this.componentInstance = undefined;
                this.runtime = undefined;
                await this.disposeComponent(previous);
            }
            if (!this.componentInstance) {
                const component = await this.createAndBootstrapComponent(componentPath, params, page, providerName);
                if (!component) return;
                try {
                    await component.init();
                    const options: PageOptions | undefined = Reflect.getMetadata('page:options', component.constructor);
                    if (options?.stateful === true) {
                        await this.state.storage.put({ componentPath, url: `${page}${url.search}`, params,
                            componentState: component.getInitialState(), providerName, stateful: true });
                    }
                    this.publishComponent(component);
                } catch (error) { await this.disposeComponent(component); throw error; }
            }
            // Accept before releasing ownership: otherwise an overlapping join
            // can mistake a newly initialized stateless component for idle state.
            this.state.acceptWebSocket(server);
            accepted = true;
        });
        if (!this.componentInstance) return new Response('Failed to initialize component', { status: 500 });
        if (this.componentInstance.__cossack_rpcOwner !== componentPath) {
            return Response.json({ code: 'COSSACK_WS_SCOPE_MISMATCH', error: 'WebSocket component does not match its Durable Object scope.' }, { status: 403 });
        }
        if (!accepted) this.state.acceptWebSocket(server);

        // For stateful DOs, send the current in-memory state so the client syncs immediately.
        // For stateless DOs, skip this — the client uses SSR-provided defaults and only
        // receives state updates from real-time broadcasts.
        if (this.runtime?.stateful) {
            const currentState = this.componentInstance.getInitialState();
            await this.runtime.sendToClient(server, { type: 'state-update', state: currentState.public });
        }

        return new Response(null, { status: 101, webSocket: client });
    }

    abstract getComponentRegistry(): Promise<Map<string, new () => Cossack>>;

    /** Framework runtimes override this to run fresh auth and inherited middleware. */
    protected async authorizeWebSocketPeer(
        _client: WebSocket,
        peer: SocketPeerAttachment,
        operation: (context: Context) => Promise<void>,
    ): Promise<boolean> {
        if (!peer.request) return false;
        await operation(socketRequestContext(peer.request, this.env, peer.user));
        return true;
    }

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

        // Stored configuration owns restoration. Query metadata cannot create
        // an unused second component or choose a different restoration target.
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

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        // Complete the reciprocal handshake on runtimes without automatic replies.
        // Reserved status codes represent local observations, not wire codes.
        const wireCode = (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code))
            || (code >= 3000 && code <= 4999) ? code : wasClean ? 1000 : 1011;
        try { ws.close(wireCode, code === wireCode ? reason : ''); }
        catch { /* A terminal socket may already be unavailable; still retire it. */ }
        for (const cancel of rpcCancellations(ws).values()) cancel();
        rpcCancellations(ws).clear();
        this.runtime?.retireClient(ws);
    }
    async webSocketError(ws: WebSocket) {
        await this.webSocketClose(ws, 1011, 'Socket error', false);
    }
}
