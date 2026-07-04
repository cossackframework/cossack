import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { NodeWebSocketRuntime } from './runtime';
import type { Cossack } from '@cossackframework/core';
import { isOriginAllowed, createInstance } from '@cossackframework/core';
import { URL } from 'url';

export * from './runtime';
export { serveStatic, type StaticServeOptions } from './static-serve';
export {
    createNodeEmailSender,
    type NodeEmailOptions,
    type NodeEmailSender,
    type EmailMessageInput,
    type EmailSendResult,
    type EmailAddress,
} from './email';

export interface CossackNodeAdapterOptions {
    server: Server;
    componentRegistry: Map<string, new () => Cossack>;
    path?: string;
    /**
     * Allowed Origin values for WebSocket upgrades. Defaults to same-origin
     * (the request's own origin). Missing Origin headers are rejected, which
     * blocks cross-site WebSocket hijacking.
     */
    allowedOrigins?: string[];
    /**
     * Authenticate the WebSocket upgrade, returning the user object the
     * component should run as (e.g. parsed from a cookie/JWT on `request`).
     * Falls back to `defaultUser` then to `{ id: 'anonymous' }`. Provide this
     * for any app with per-user state or authorization — otherwise every
     * connection shares one anonymous identity.
     */
    authenticate?: (request: IncomingMessage) => Promise<unknown> | unknown;
    /** User used when no `authenticate` hook is provided. Defaults to `{ id: 'anonymous' }`. */
    defaultUser?: unknown;
    /**
     * Runtime bindings to expose to components as `this.env` (mirrors
     * Cloudflare's `env` argument). Use it to supply polyfills such as
     * `{ EMAIL: createNodeEmailSender({...}) }` so the same
     * `this.env.EMAIL.send(...)` call works on both runtimes.
     */
    env?: Record<string, unknown>;
}

export class CossackNodeAdapter {
    private wss: WebSocketServer;
    // Map of target ID -> Runtime instance
    private instances: Map<string, NodeWebSocketRuntime> = new Map();
    private componentRegistry: Map<string, new () => Cossack>;
    private allowedOrigins?: string[];
    private authenticate?: (request: IncomingMessage) => Promise<unknown> | unknown;
    private defaultUser: unknown;
    private env?: Record<string, unknown>;

    constructor(options: CossackNodeAdapterOptions) {
        this.wss = new WebSocketServer({ noServer: true });
        this.componentRegistry = options.componentRegistry;
        this.allowedOrigins = options.allowedOrigins;
        this.authenticate = options.authenticate;
        this.defaultUser = options.defaultUser ?? { id: 'anonymous' };
        this.env = options.env;

        options.server.on('upgrade', (request: IncomingMessage, socket: any, head: any) => {
             const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
             if (pathname.startsWith(options.path || '/ws')) {
                this.handleUpgrade(request, socket, head);
             }
        });
    }

    private handleUpgrade(request: IncomingMessage, socket: any, head: any) {
        // SECURITY: validate Origin to prevent cross-site WebSocket hijacking.
        const requestUrl = new URL(request.url || '', `http://${request.headers.host}`).toString();
        const origin = request.headers.origin as string | undefined;
        if (!isOriginAllowed(origin, requestUrl, this.allowedOrigins)) {
            socket.destroy();
            return;
        }

        this.wss.handleUpgrade(request, socket, head, async (ws) => {
            const url = new URL(request.url || '', `http://${request.headers.host}`);
            // Path: /ws/:provider/:target
            const pathParts = url.pathname.split('/');
            const target = pathParts.pop(); // last part is target
            const provider = pathParts.pop(); // second to last is provider
            
            const params = url.searchParams;
            const componentId = params.get('componentId');
            
            if (!target || !componentId) {
                ws.close(1008, 'Missing target or componentId');
                return;
            }

            let runtime = this.instances.get(target);

            if (!runtime) {
                const ComponentClass = this.componentRegistry.get(componentId);
                if (!ComponentClass) {
                    ws.close(1008, 'Component not found');
                    return;
                }

                // Use the DI container so @Service-injected dependencies are
                // resolved (new ComponentClass() bypassed the container).
                const componentInstance = createInstance(ComponentClass) as Cossack;
                const pathname = params.get('pathname') || '/';

                const context = {
                    req: {
                        path: pathname,
                        param: (key?: string) => {
                            if (key) return params.get(key);
                            const p: Record<string, string> = {};
                            params.forEach((v, k) => { p[k] = v; });
                            return p;
                        },
                        query: (key?: string) => {
                            if (key) return params.get(key);
                            const q: Record<string, string> = {};
                            params.forEach((v, k) => { q[k] = v; });
                            return q;
                        }
                    }
                } as any;
                
                // We need to bootstrap the component.
                // Thread the configured `env` (bindings such as EMAIL polyfills)
                // so `this.env` works identically to Cloudflare's runtime.
                await componentInstance.bootstrap({
                    context,
                    env: this.env,
                    page: pathname,
                    providerName: provider
                });
                
                // init() and get() are now automatically called during bootstrap

                runtime = new NodeWebSocketRuntime(componentInstance);
                this.instances.set(target, runtime);
            }

            // Resolve the connecting user via the authenticate hook (cookies,
            // JWT, etc.) so per-user state/authorization works. Without a hook,
            // connections run as the configured defaultUser (anonymous) — never
            // a forged identity.
            let user: unknown;
            try {
                user = this.authenticate ? await this.authenticate(request) : this.defaultUser;
            } catch (e) {
                console.error('[Cossack] Authentication failed, rejecting upgrade:', e);
                ws.close(1008, 'Authentication failed');
                return;
            }

            runtime.addClient(ws, user);
            
            // Send initial state to the connecting client
            const initialState = (runtime as any).component.getInitialState();
            ws.send(JSON.stringify({ type: 'state-update', state: initialState }));
        });
    }
}
