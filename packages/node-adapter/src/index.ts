import { logRuntimeFailure } from '@cossackframework/core/server-diagnostics';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { NodeWebSocketRuntime } from './runtime';
import type { Cossack, PageOptions } from '@cossackframework/core';
import { isOriginAllowed, createInstance } from '@cossackframework/core';
import { URL } from 'url';

export * from './runtime';
/** Pass to `createApp({ runtimeAdapter })` so SSR emits process-runtime targets. */
export const nodeRuntimeAdapter = { name: 'node' } as const;
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
    /** Maximum number of process-local component instances. Defaults to 512. */
    maxInstances?: number;
    /** Evict disconnected instances after this idle period. Defaults to 15 minutes. */
    idleTimeoutMs?: number;
}

interface NodeRuntimeEntry {
    runtime: NodeWebSocketRuntime;
    lastActive: number;
}

class NodeRuntimeLimitError extends Error {
    constructor() {
        super('Node runtime instance limit reached');
    }
}

function decodeRouteParams(encoded: string | null): Record<string, string> {
    if (encoded === null) return {};
    const parsed: unknown = JSON.parse(encoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TypeError('WebSocket route params must be a JSON object');
    }
    const routeParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') {
            throw new TypeError('WebSocket route params must contain strings');
        }
        routeParams[key] = value;
    }
    return routeParams;
}

export class CossackNodeAdapter {
    private wss: WebSocketServer;
    // Map of target ID -> Runtime instance
    private instances: Map<string, NodeRuntimeEntry> = new Map();
    private pendingInstances: Map<string, Promise<NodeRuntimeEntry>> = new Map();
    private componentRegistry: Map<string, new () => Cossack>;
    private allowedOrigins?: string[];
    private authenticate?: (request: IncomingMessage) => Promise<unknown> | unknown;
    private defaultUser: unknown;
    private env?: Record<string, unknown>;
    private maxInstances: number;
    private idleTimeoutMs: number;

    constructor(options: CossackNodeAdapterOptions) {
        this.wss = new WebSocketServer({ noServer: true });
        this.componentRegistry = options.componentRegistry;
        this.allowedOrigins = options.allowedOrigins;
        this.authenticate = options.authenticate;
        this.defaultUser = options.defaultUser ?? { id: 'anonymous' };
        this.env = options.env;
        this.maxInstances = options.maxInstances ?? 512;
        this.idleTimeoutMs = options.idleTimeoutMs ?? 15 * 60_000;
        if (!Number.isInteger(this.maxInstances) || this.maxInstances < 1 ||
            !Number.isFinite(this.idleTimeoutMs) || this.idleTimeoutMs < 0) {
            throw new TypeError('Node runtime requires positive integer maxInstances and nonnegative finite idleTimeoutMs');
        }

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
            // Current clients send the public route path. Keep componentId as
            // a legacy fallback for applications built before route metadata.
            const componentId = params.get('routePath') ||
                params.get('componentPath') || params.get('componentId');
            
            if (!target || !componentId) {
                ws.close(1008, 'Missing target or routePath');
                return;
            }

            let routeParams: Record<string, string>;
            try {
                routeParams = decodeRouteParams(params.get('params'));
            } catch {
                ws.close(1008, 'Invalid route params');
                return;
            }

            const ComponentClass = this.componentRegistry.get(componentId);
            if (!ComponentClass) {
                ws.close(1008, 'Component not found');
                return;
            }

            // Resolve the connecting user before accepting its scope target.
            // This prevents a client from joining another user's instance by
            // guessing its target key.
            let user: unknown;
            try {
                user = this.authenticate ? await this.authenticate(request) : this.defaultUser;
            } catch (e) {
                logRuntimeFailure({ runtime: 'node' }, 'authentication');
                ws.close(1008, 'Authentication failed');
                return;
            }

            const pathname = params.get('pathname') || '/';
            const context = {
                get: (key: string) => key === 'user' ? user : undefined,
                env: this.env,
                req: {
                    header: (key?: string) => {
                        const headers = new Headers();
                        for (let index = 0; index < request.rawHeaders.length; index += 2) {
                            headers.append(request.rawHeaders[index]!, request.rawHeaders[index + 1]!);
                        }
                        return key === undefined ? Object.fromEntries(headers) : headers.get(key) ?? undefined;
                    },
                    path: pathname,
                    param: (key?: string) => {
                        if (key) return routeParams[key];
                        return { ...routeParams };
                    },
                    query: (key?: string) => {
                        if (key) return params.get(key);
                        const q: Record<string, string> = {};
                        params.forEach((v, k) => { q[k] = v; });
                        return q;
                    }
                }
            } as any;

            const pageOptions = Reflect.getMetadata('page:options', ComponentClass) as PageOptions | undefined;
            let expectedTarget: string;
            try {
                expectedTarget = pageOptions?.scope
                    ? await pageOptions.scope(context)
                    : `user:${(user as { id?: unknown } | undefined)?.id || 'anonymous'}`;
            } catch (error) {
                logRuntimeFailure({ runtime: 'node' }, 'scope');
                ws.close(1008, 'Invalid WebSocket scope');
                return;
            }
            if (target !== expectedTarget) {
                ws.close(1008, 'Invalid WebSocket scope');
                return;
            }

            const instanceKey = `${componentId}:${provider ?? 'page'}:${target}`;
            let entry: NodeRuntimeEntry;
            try {
                entry = await this.getOrCreateRuntime(instanceKey, ComponentClass, {
                    context, user, pathname, provider,
                });
            } catch (error) {
                logRuntimeFailure({ runtime: 'node' }, 'initialization');
                ws.close(1013, error instanceof NodeRuntimeLimitError
                    ? 'Runtime instance limit reached' : 'Runtime unavailable');
                return;
            }
            const runtime = entry.runtime;
            entry.lastActive = Date.now();

            runtime.addClient(ws, user, context);
            
            // Send initial state to the connecting client
            try {
                await runtime.sendInitialState(ws);
            } catch (error) {
                logRuntimeFailure({ runtime: 'node' }, 'initial-state');
                ws.close(1011, 'Runtime unavailable');
            }
        });
    }

    private async getOrCreateRuntime(
        instanceKey: string,
        ComponentClass: new () => Cossack,
        options: { context: any; user: unknown; pathname: string; provider?: string },
    ): Promise<NodeRuntimeEntry> {
        const cached = this.instances.get(instanceKey);
        if (cached) return cached;

        let creation = this.pendingInstances.get(instanceKey);
        if (!creation) {
            this.pruneInstances(true);
            if (this.instances.size + this.pendingInstances.size >= this.maxInstances) {
                throw new NodeRuntimeLimitError();
            }
            creation = (async () => {
                // Use the DI container so @Service-injected dependencies are
                // resolved (new ComponentClass() bypasses the container).
                const componentInstance = createInstance(ComponentClass) as Cossack;
                try {
                    await componentInstance.bootstrap({
                        context: options.context,
                        user: options.user as any,
                        env: this.env,
                        runtime: { platform: 'web', adapter: 'node' },
                        page: options.pathname,
                        providerName: options.provider,
                    });
                } catch (error) {
                    await componentInstance.destroyAsync().catch(cleanupError => {
                        logRuntimeFailure({ runtime: 'node' }, 'component-cleanup', 'COSSACK_COMPONENT_CLEANUP_FAILED');
                    });
                    throw error;
                }

                const entry: NodeRuntimeEntry = {
                    runtime: new NodeWebSocketRuntime(componentInstance),
                    lastActive: Date.now(),
                };
                this.instances.set(instanceKey, entry);
                return entry;
            })();
            this.pendingInstances.set(instanceKey, creation);
        }

        try {
            return await creation;
        } finally {
            if (this.pendingInstances.get(instanceKey) === creation) this.pendingInstances.delete(instanceKey);
        }
    }

    private pruneInstances(reserveSlot = false): void {
        const now = Date.now();
        for (const [key, entry] of this.instances) {
            if (entry.runtime.clientCount === 0 && now - entry.lastActive >= this.idleTimeoutMs) {
                this.instances.delete(key);
            }
        }
        const targetSize = Math.max(0, this.maxInstances - (reserveSlot ? 1 : 0) - this.pendingInstances.size);
        if (this.instances.size <= targetSize) return;
        const idle = [...this.instances.entries()]
            .filter(([, entry]) => entry.runtime.clientCount === 0)
            .sort((a, b) => a[1].lastActive - b[1].lastActive);
        for (const [key] of idle) {
            if (this.instances.size <= targetSize) break;
            this.instances.delete(key);
        }
    }
}

export { createNodeAdapter, type NodeAdapterOptions, type NodeWebSocketUpgrade, type NodeUpgradeServer } from "./adapter";

export { installNodeShutdown, type NodeShutdownServer, type NodeShutdownOptions, type NodeShutdownResult } from './shutdown';
