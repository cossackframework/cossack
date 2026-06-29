// src/transports/sse.ts
import { SseRuntime, Cossack, createInstance, isOriginAllowed, type PageOptions } from '@cossackframework/core';
import type { Context } from 'hono';
import type { RouterContext } from '../route-ids';

/** Active async generator being iterated by the SSE endpoint. */
interface PendingGenerator {
    iterator: AsyncIterator<any>;
    streamId: string;
    done: boolean;
    /** The component instance that owns the generator — used to sync state after each pull. */
    sourceInstance: any;
    /** True while an iterator.next() is in flight — prevents concurrent pulls from multiple SSE drivers. */
    pulling: boolean;
}

interface SseStoreEntry {
    componentInstance: any;
    runtime: SseRuntime;
    /** Active async generator being iterated by the SSE endpoint. */
    pendingGenerator: PendingGenerator | null;
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
            pendingGenerator: null,
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

        // SECURITY: for the DEFAULT per-user scope, re-derive the expected
        // scope server-side from the authenticated user and reject any
        // client-supplied value that does not match — otherwise a crafted
        // request like `?scopeKey=user:<victim_id>` could subscribe to another
        // user's SSE stream (cross-user eavesdropping).
        //
        // For a CUSTOM scope() (e.g. `room:${c.req.query('room')}`) the
        // developer's scope function is the authorization model and depends on
        // page-request data that isn't present on this SSE request — so we
        // trust the SSR-computed scopeKey the client echoes back (the same one
        // SSR registered the store entry under).
        const pageOptions = Reflect.getMetadata('page:options', PageComponent) as PageOptions | undefined;
        let effectiveScopeKey: string;
        if (typeof pageOptions?.scope === 'function') {
            if (!requestedScopeKey) {
                return new Response('scopeKey query parameter is required', { status: 400 });
            }
            effectiveScopeKey = requestedScopeKey;
        } else {
            const expectedScopeKey = await resolveSseScopeKey(c, pageOptions);
            if (!requestedScopeKey || requestedScopeKey !== expectedScopeKey) {
                return new Response('Forbidden: scopeKey does not match the authenticated scope', { status: 403 });
            }
            effectiveScopeKey = expectedScopeKey;
        }

        // Look up or create SSE state store entry
        const storeKey = sseStoreKey(componentRouteId, effectiveScopeKey);
        let entry = sseStateStore.get(storeKey);

        if (!entry) {
            // Cold start: create instance on demand
            const user = c.get('user');
            const componentInstance = createInstance(PageComponent) as any;
            await componentInstance.bootstrap({ context: c, user, env: c.env, skipInit: true });
            componentInstance._render();

            const runtime = new SseRuntime(componentInstance);
            entry = { componentInstance, runtime, pendingGenerator: null, stateVersion: 0, connectionCount: 0, lastActive: Date.now() };
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
        // - pendingGenerator from /crpc → pull one value per tick and push as SSE yield event
        //
        // IMPORTANT: look up the entry from the Map on each tick rather than using a
        // captured reference. This ensures the driver always uses the current entry
        // even if another request replaced it in the Map.
        let lastVersion = entry.stateVersion;

        const driver = setInterval(async () => {
            const currentEntry = sseStateStore.get(storeKey);
            if (!currentEntry) return;

            // 1. Detect state changes signalled by /crpc (version counter)
            if (currentEntry.stateVersion !== lastVersion) {
                lastVersion = currentEntry.stateVersion;
                send('state-update', currentEntry.componentInstance.getPublicState());
            }

            // 2. Pull next value from active generator (only one driver pulls at a time)
            if (currentEntry.pendingGenerator && !currentEntry.pendingGenerator.done && !currentEntry.pendingGenerator.pulling) {
                const gen = currentEntry.pendingGenerator;
                gen.pulling = true;
                try {
                    const { value, done } = await gen.iterator.next();
                    gen.pulling = false;
                    // Sync state changes from the generator's source instance to the SSE entry
                    const sourceState = gen.sourceInstance.getPublicState();
                    for (const k in sourceState) {
                        currentEntry.componentInstance[k] = sourceState[k];
                    }
                    // Bump version — do NOT update lastVersion here.
                    // Each driver detects the bump on its next tick and sends
                    // state-update to its own connection (including this one).
                    currentEntry.stateVersion++;

                    if (done) {
                        gen.done = true;
                        send('stream-done', { streamId: gen.streamId });
                        currentEntry.pendingGenerator = null;
                    } else {
                        send('yield', { streamId: gen.streamId, value });
                    }
                } catch (err) {
                    gen.pulling = false;
                    gen.done = true;
                    send('stream-error', { streamId: gen.streamId, error: String(err) });
                    currentEntry.stateVersion++;
                    currentEntry.pendingGenerator = null;
                }
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

/**
 * Handle SSE-specific logic in the /crpc handler — streaming detection and state sync.
 * Uses the pre-computed scopeKey for targeted store entry lookup.
 */
export function handleSseCrpc(
    componentRouteId: string,
    scopeKey: string,
    actionResult: any,
    responseData: Record<string, any>,
    targetInstance: any,
): { handled: boolean; response?: any } {
    function isAsyncIterable(obj: any): boolean {
        return obj != null && typeof obj[Symbol.asyncIterator] === 'function';
    }

    const storeKey = sseStoreKey(componentRouteId, scopeKey);

    // If the action returned an async iterable, set up streaming
    if (isAsyncIterable(actionResult)) {
        const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const entry = sseStateStore.get(storeKey);

        if (entry) {
            // Signal SSE client that state changed so far (e.g. isStreaming = true)
            for (const k in responseData) {
                entry.componentInstance[k] = responseData[k];
            }
            entry.stateVersion++;

            // Register the generator on the SSE store entry.
            entry.pendingGenerator = {
                iterator: actionResult[Symbol.asyncIterator](),
                streamId,
                done: false,
                sourceInstance: targetInstance,
                pulling: false,
            };
        }

        return {
            handled: true,
            response: {
                ...responseData,
                _cossack_stream_id: streamId,
            },
        };
    }

    // Non-streaming: sync SSE state
    syncSseState(storeKey, responseData);

    return { handled: false };
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
