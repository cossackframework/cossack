import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { NodeWebSocketRuntime } from './runtime';
import type { Cossack } from '@cossackframework/core';
import { isOriginAllowed } from '@cossackframework/core';
import { URL } from 'url';

export * from './runtime';
export { serveStatic, type StaticServeOptions } from './static-serve';

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
}

export class CossackNodeAdapter {
    private wss: WebSocketServer;
    // Map of target ID -> Runtime instance
    private instances: Map<string, NodeWebSocketRuntime> = new Map();
    private componentRegistry: Map<string, new () => Cossack>;
    private allowedOrigins?: string[];

    constructor(options: CossackNodeAdapterOptions) {
        this.wss = new WebSocketServer({ noServer: true });
        this.componentRegistry = options.componentRegistry;
        this.allowedOrigins = options.allowedOrigins;

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

                const componentInstance = new ComponentClass();
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
                // Note: We might be missing 'env' here if the Node server has specific env vars.
                // Users can pass a global env to the Adapter if needed, but for now we'll pass empty.
                await componentInstance.bootstrap({ 
                    context, 
                    page: pathname, 
                    providerName: provider 
                });
                
                // init() and get() are now automatically called during bootstrap

                runtime = new NodeWebSocketRuntime(componentInstance);
                this.instances.set(target, runtime);
            }

            // TODO: Extract user from request (cookies, headers) if needed
            const user = { id: 'guest' }; 
            
            runtime.addClient(ws, user);
            
            // Send initial state to the connecting client
            const initialState = (runtime as any).component.getInitialState();
            ws.send(JSON.stringify({ type: 'state-update', state: initialState }));
        });
    }
}
