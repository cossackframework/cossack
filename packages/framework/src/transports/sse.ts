// src/transports/sse.ts
import { SseRuntime, Cossack, createInstance, isOriginAllowed, type PageOptions } from '@cossackframework/core';
import type { Context } from 'hono';
import type { RouterContext } from '../route-ids.js';
import { decodeRuntimeRouteParams, withRuntimeRouteParams } from '../runtime-websocket.js';

interface SseStoreEntry {
    componentInstance: any;
    runtime: SseRuntime;
    /** Incremented by /crpc after each action. SSE endpoint polls this to detect changes. */
    stateVersion: number;
    /** Number of open SSE connections subscribed to this entry. */
    connectionCount: number;
    /** Last time an entry was touched (created or connected). Used for LRU eviction. */
    lastActive: number;
}

/** In-memory state store for SSE transport pages. Keyed by componentRouteId:scopeKey. */
const SSE_STORE_MAX = 500;
const sseStateStore = new Map<string, SseStoreEntry>();

/** Evict the oldest entry when the store exceeds its bound. */
function enforceSseStoreBound(): void {
    while (sseStateStore.size > SSE_STORE_MAX) {
        let oldestKey: string | undefined;
        let oldestTime = Infinity;
        for (const [k, v] of sseStateStore) {
            if (v.lastActive < oldestTime) {
                oldestTime = v.lastActive;
                oldestKey = k;
            }
        }
        if (oldestKey === undefined) break;
        sseStateStore.delete(oldestKey);
    }
}

/** @internal Test seam: current number of entries in the SSE store. */
export function __sseStoreSize(): number {
    return sseStateStore.size;
}

function sseStoreKey(componentRouteId: string, scopeKey: string): string {
    return `${componentRouteId}:${scopeKey}`;
}


/**
 * Evaluate the scope function from PageOptions, or return the default SSE scope.
 * Default: per-user (`user:${user?.id || 'anonymous'}`).
 */
export async function resolveSseScopeKey(
    c: Context,
    pageOptions: PageOptions | undefined,
): Promise<string> {
    if (pageOptions?.scope) {
        return pageOptions.scope(c);
    }
    const user = c.get('user');
    return `user:${user?.id || 'anonymous'}`;
}

/**
 * Register or reset an SSE store entry during SSR.
 * The fresh component instance replaces any existing entry so that state is
 * re-initialized via init() instead of reusing stale in-memory state.
 */
export function registerSseStoreEntry(
    ctx: RouterContext,
    path: string,
    scopeKey: string,
    pageInstance: any,
): void {
    const componentRouteId = ctx.routePathToIdMap.get(path);
    if (componentRouteId) {
        const storeKey = sseStoreKey(componentRouteId, scopeKey);
        const runtime = new SseRuntime(pageInstance);
        sseStateStore.set(storeKey, {
            componentInstance: pageInstance,
            runtime,
            stateVersion: 0,
            connectionCount: 0,
            lastActive: Date.now(),
        });
    }
}

/** SSE endpoint handler — long-lived connection that pushes state updates to the client. */
export function handleSseEndpoint(ctx: RouterContext) {
    return async (c: Context) => {
        // SECURITY: validate Origin to prevent cross-site abuse of the SSE
        // SECURITY: validate Origin to prevent cross-site abuse of the SSE
        // endpoint. Unlike WebSocket, EventSource does NOT send an Origin
        // header for same-origin requests (only `referer`), so we only enforce
        // when Origin is present — i.e. a cross-origin attempt, which the
        // browser would also block via CORS (this server sends no
        // Access-Control-Allow-Origin). This keeps the defense-in-depth without
        // rejecting legitimate same-origin SSE connections.
        const requestOrigin = c.req.header('origin');
        if (requestOrigin && !isOriginAllowed(requestOrigin, c.req.url, ctx.allowedOrigins)) {
            return new Response('Origin not allowed', { status: 403 });
        }
        const { componentRouteId } = c.req.param();
        let requestedScopeKey = c.req.query('scopeKey');
        // Hono may return the raw ( %-encoded) query value for keys containing
        // reserved characters (e.g. `room:xyz` → `room%3Axyz`). Decode so the
        // store key matches the one /crpc and SSR use (decoded).
        if (requestedScopeKey && requestedScopeKey.includes('%')) {
            try { requestedScopeKey = decodeURIComponent(requestedScopeKey); } catch { /* keep raw */ }
        }
        const componentPath = ctx.routeIdMap.get(componentRouteId);
        if (!componentPath) return new Response('Invalid component ID', { status: 400 });

        const module = ctx.pages[componentPath] || ctx.layouts[componentPath];
        if (!module) return new Response('Component not found', { status: 404 });
        const PageComponent = Object.values(module as object)[0] as new () => Cossack;
        if (!PageComponent || typeof PageComponent !== 'function') return new Response('Invalid component', { status: 500 });

        // Scope keys are identifiers, not credentials. Re-evaluate custom scopes
        // with the live authenticated user too; never trust an echoed SSR key.
        const pageOptions = Reflect.getMetadata('page:options', PageComponent) as PageOptions | undefined;
        let params: Record<string, string>;
        try {
            params = decodeRuntimeRouteParams(c.req.query('params'));
        } catch {
            return new Response('Invalid route params', { status: 400 });
        }
        const effectiveScopeKey = await resolveSseScopeKey(withRuntimeRouteParams(c, params), pageOptions);
        if (!requestedScopeKey || requestedScopeKey !== effectiveScopeKey) {
            return new Response('Forbidden: scopeKey does not match the authenticated scope', { status: 403 });
        }

        // Look up or create SSE state store entry
        const storeKey = sseStoreKey(componentRouteId, effectiveScopeKey);
        let entry = sseStateStore.get(storeKey);

        if (!entry) {
            // Cold start: create instance on demand
            const user = c.get('user');
            const componentInstance = createInstance(PageComponent) as any;
            await componentInstance.bootstrap({
                context: c,
                user,
                env: c.env,
                runtime: await ctx.runtimeInfo?.(),
                skipInit: true,
            });
            componentInstance._render();

            const runtime = new SseRuntime(componentInstance);
            entry = { componentInstance, runtime, stateVersion: 0, connectionCount: 0, lastActive: Date.now() };
            sseStateStore.set(storeKey, entry);
            enforceSseStoreBound();
        }

        // Track this connection against the entry so the store can be trimmed
        // when no clients remain.
        entry.connectionCount++;
        entry.lastActive = Date.now();

        const { componentInstance } = entry;

        // Use TransformStream — the writable end accepts SSE frames,
        // the readable end is returned as the HTTP response body.
        // All setInterval callbacks run in THIS request's I/O context.
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const send = (eventType: string, data: any) => {
            writer.write(encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});
        };

        // Send initial state + connected
        send('state-update', componentInstance.getPublicState());
        send('connected', {});

        // Heartbeat every 15s (Cloudflare Workers close idle connections ~30s)
        const heartbeat = setInterval(() => {
            writer.write(encoder.encode(': heartbeat\n\n')).catch(() => {});
        }, 15000);

        // Main driver: polls shared state for changes and writes to this stream.
        // - stateVersion bumps from /crpc → push state-update to this client
        //
        // IMPORTANT: look up the entry from the Map on each tick rather than using a
        // captured reference. This ensures the driver always uses the current entry
        // even if another request replaced it in the Map.
        let lastVersion = entry.stateVersion;

        const driver = setInterval(() => {
            const currentEntry = sseStateStore.get(storeKey);
            if (!currentEntry) return;

            // 1. Detect state changes signalled by /crpc (version counter)
            if (currentEntry.stateVersion !== lastVersion) {
                lastVersion = currentEntry.stateVersion;
                send('state-update', currentEntry.componentInstance.getPublicState());
            }

        }, 200);

        const cleanup = () => {
            clearInterval(heartbeat);
            clearInterval(driver);
            const e = sseStateStore.get(storeKey);
            if (e) {
                e.connectionCount = Math.max(0, e.connectionCount - 1);
                e.lastActive = Date.now();
            }
        };
        (c.req.raw as any).signal?.addEventListener('abort', cleanup);

        return new Response(readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    };
}

/** Sync state changes to the SSE store entry identified by storeKey. */
export function syncSseState(
    storeKey: string,
    responseData: Record<string, any>,
): void {
    const entry = sseStateStore.get(storeKey);
    if (entry) {
        for (const k in responseData) {
            if (k !== '_cossack_return') {
                entry.componentInstance[k] = responseData[k];
            }
        }
        entry.stateVersion++;
    }
}
