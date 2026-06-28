// src/transports/sse.ts
import { SseRuntime, Cossack, createInstance, type PageOptions } from '@cossackframework/core';
import type { Context } from 'hono';

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
}

/** In-memory state store for SSE transport pages. Keyed by componentRouteId:scopeKey. */
const sseStateStore = new Map<string, SseStoreEntry>();

function sseStoreKey(componentRouteId: string, scopeKey: string): string {
    return `${componentRouteId}:${scopeKey}`;
}

export interface RouterContext {
    routeIdMap: Map<string, string>;
    routePathToIdMap: Map<string, string>;
    routePathToFilePathMap: Map<string, string>;
    pages: Record<string, any>;
    layouts: Record<string, any>;
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
        });
    }
}

/** SSE endpoint handler — long-lived connection that pushes state updates to the client. */
export function handleSseEndpoint(ctx: RouterContext) {
    return async (c: Context) => {
        const { componentRouteId } = c.req.param();
        const requestedScopeKey = c.req.query('scopeKey');
        const componentPath = ctx.routeIdMap.get(componentRouteId);
        if (!componentPath) return new Response('Invalid component ID', { status: 400 });

        const module = ctx.pages[componentPath] || ctx.layouts[componentPath];
        if (!module) return new Response('Component not found', { status: 404 });
        const PageComponent = Object.values(module as object)[0] as new () => Cossack;
        if (!PageComponent || typeof PageComponent !== 'function') return new Response('Invalid component', { status: 500 });

        // SECURITY: re-derive the expected scope server-side from the
        // authenticated user (and the page's scope() config), and reject any
        // client-supplied value that does not match. Otherwise a crafted
        // request like `?scopeKey=user:<victim_id>` could subscribe to another
        // user's SSE stream and receive all of their state updates
        // (cross-user eavesdropping). The client only ever echoes back the
        // scopeKey it received during SSR.
        const pageOptions = Reflect.getMetadata('page:options', PageComponent) as PageOptions | undefined;
        const expectedScopeKey = await resolveSseScopeKey(c, pageOptions);
        if (!requestedScopeKey || requestedScopeKey !== expectedScopeKey) {
            return new Response('Forbidden: scopeKey does not match the authenticated scope', { status: 403 });
        }

        // Look up or create SSE state store entry
        const storeKey = sseStoreKey(componentRouteId, expectedScopeKey);
        let entry = sseStateStore.get(storeKey);

        if (!entry) {
            // Cold start: create instance on demand
            const user = c.get('user');
            const componentInstance = createInstance(PageComponent) as any;
            await componentInstance.bootstrap({ context: c, user, env: c.env, skipInit: true });
            componentInstance._render();

            const runtime = new SseRuntime(componentInstance);
            entry = { componentInstance, runtime, pendingGenerator: null, stateVersion: 0 };
            sseStateStore.set(storeKey, entry);
        }

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

        // Clean up on disconnect
        const cleanup = () => {
            clearInterval(heartbeat);
            clearInterval(driver);
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
