// src/shared/transport-connections.ts
import { PageStateProvider, StateProvider } from './StateProvider';
import { applyStateToComponent } from './method-proxy';
import { hasOptimisticCalls, resetOptimisticSnapshotHistory, optimisticCallForRequest } from './optimistic-state';
import { resetSseSnapshotCursor } from './rpc-state';
import { isSharedMethod } from './shared-method';
import { rpcCancellations, validateRpcFrame, RPC_STREAM_MAX_FRAME_BYTES, RpcError, type RpcStreamFrame, type RpcSocket } from './rpc-stream';

/** Per-socket sinks for correlated request-scoped RPC frames. */
export function wsPendingCalls(ws: RpcSocket): Map<string, (frame: RpcStreamFrame, interrupted?: boolean) => void> {
    const socket = ws as { __cossack_rpc_pending?: Map<string, (frame: RpcStreamFrame, interrupted?: boolean) => void> };
    return socket.__cossack_rpc_pending ??= new Map();
}

/** Reject every request-scoped call on a socket that is no longer usable. */
export function failPendingSocketCalls(ws: RpcSocket): void {
    const pending = wsPendingCalls(ws);
    for (const [requestId, sink] of [...pending]) {
        sink({ v: 1, type: 'error', requestId,
            code: 'COSSACK_RPC_TRANSPORT_CLOSED',
            message: 'The realtime connection closed before the call finished. The server result is unknown.' }, true);
    }
    pending.clear();
    rpcCancellations(ws).clear();
}

/**
 * Route one parsed socket message to its request-scoped call. Returns true
 * when the message was consumed as a correlated RPC frame.
 */
export function routeSocketFrame(ws: RpcSocket, data: unknown): boolean {
    if (!data || typeof data !== 'object' || typeof (data as any).requestId !== 'string') return false;
    const frame = data as unknown as RpcStreamFrame;
    const sink = wsPendingCalls(ws).get(frame.requestId);
    if (sink) {
        try {
            validateRpcFrame(frame);
            if (new TextEncoder().encode(JSON.stringify(frame)).length > RPC_STREAM_MAX_FRAME_BYTES) {
                throw new RpcError('COSSACK_RPC_STREAM_TOO_LARGE', 'RPC frame exceeds the byte limit.');
            }
            sink(frame);
            if (frame.type !== 'yield') wsPendingCalls(ws).delete(frame.requestId);
        } catch (error) {
            sink({ v: 1, type: 'error', requestId: frame.requestId,
                code: error instanceof RpcError ? error.code : 'COSSACK_RPC_STREAM_INVALID',
                message: error instanceof RpcError ? error.message : 'Invalid RPC frame.' }, true);
            wsPendingCalls(ws).delete(frame.requestId);
        }
    }
    return true;
}

/** Per-connection realtime status exposed to applications as `component.realtime`. */
export interface RealtimeConnectionStatus {
    state: 'connecting' | 'open' | 'reconnecting' | 'closed';
    /** Reconnect attempts since the last successful open (WebSockets). */
    attempts: number;
    /** Last delivered event cursor (SSE coordinator) or message marker. */
    lastEventId?: number | string;
    /** Human-readable description of the latest transport failure. */
    lastError?: string;
    /** True after the latest reconnect resynchronized from an authoritative snapshot. */
    resynced?: boolean;
    updatedAt: number;
}

export interface RealtimeStatusRecord {
    sse: RealtimeConnectionStatus;
    websockets: Record<string, RealtimeConnectionStatus>;
}

export function realtimeStatus(component: any): RealtimeStatusRecord {
    return component.__realtimeStatus ??= {
        sse: { state: 'connecting', attempts: 0, updatedAt: Date.now() },
        websockets: {},
    };
}

function updateStatus(
    component: any,
    scope: 'sse' | { provider: string },
    patch: Partial<RealtimeConnectionStatus>,
): void {
    const record = realtimeStatus(component);
    const status = scope === 'sse' ? record.sse : (record.websockets[scope.provider] ??= {
        state: 'connecting', attempts: 0, updatedAt: Date.now() });
    Object.assign(status, patch, { updatedAt: Date.now() });
    component.requestUpdate?.();
}

/** Bounded exponential reconnect delay: 0.5s doubling to a 30s ceiling. */
export function realtimeReconnectDelay(attempts: number): number {
    return Math.min(30_000, 500 * 2 ** Math.min(Math.max(attempts - 1, 0), 6));
}

/**
 * Initialize provider map for the component (server-side only).
 * Sets up StateProvider instances based on @Page decorator options.
 */
export function initializeProviders(component: any): void {
    if (!component.isServer) return;

    component.providers = new Map<string, StateProvider>();
    const pageOptions = Reflect.getMetadata('page:options', component.constructor) || {};
    let componentProviders = pageOptions.providers || {};

    if (Object.keys(componentProviders).length === 0) {
        componentProviders = { page: new PageStateProvider() };
    } else if (!componentProviders.page) {
        componentProviders.page = new PageStateProvider();
    }

    for (const [name, provider] of Object.entries(componentProviders)) {
        (provider as StateProvider).setContext(component, component.env);
        component.providers.set(name, provider as StateProvider);
    }
}

const socketDisposers = new WeakMap<object, () => void>();

/** Clear provider ownership and pending work before initiating network closure. */
export function disconnectWebSockets(component: any): void {
    const sockets = [...component.websockets.entries()] as [string, WebSocket][];
    component.websockets.clear();
    const errors: unknown[] = [];
    for (const [provider, socket] of sockets) {
        Object.assign(realtimeStatus(component).websockets[provider] ??= {
            state: 'closed', attempts: 0, updatedAt: Date.now(),
        }, { state: 'closed', updatedAt: Date.now() });
        try {
            const dispose = socketDisposers.get(socket);
            if (dispose) dispose();
            else {
                (socket as any).__cossack_intentional_close = true;
                failPendingSocketCalls(socket);
                socket.close();
            }
        } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, '[Cossack] WebSocket cleanup failed.');
}

/**
 * Connect to WebSocket providers (client-side only).
 * Reads provider targets from initial state and sets up message handlers
 * for state updates, action completions, and events.
 */
export function connectWebSocket(component: any): void {
    if (component._phase === 'Destroyed') return;
    disconnectWebSockets(component);
    const initialState = component.getInitialStateFromWindow();
    const providerTargets = initialState?.providerTargets || {};

    for (const providerName in providerTargets) {
        const target = providerTargets[providerName];

        // Access metadata - support both routePath (new) and componentPath (legacy)
        const routePath = initialState?.routePath || initialState?.metadata?.routePath || initialState?.metadata?.componentPath;
        if (!routePath) {
            console.error('[Cossack] Cannot connect WebSocket: routePath not found in initial state.');
            continue;
        }

        const pathname = initialState?.metadata?.pathname;
        const params = new URLSearchParams({
            routePath,
            pathname: pathname || '',
            params: JSON.stringify(initialState?.metadata?.params || {}),
        }).toString();

        // Targets can be scope keys or object names (`team:a`, `page:[...]`), so
        // encode them as single path segments. The server decodes route params.
        const wsUrl = `/ws/${encodeURIComponent(providerName)}/${encodeURIComponent(target)}?${params}`;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const fullWsUrl = `${protocol}//${window.location.host}${wsUrl}`;

        // Connect with bounded exponential reconnect. A socket closed by the
        // application (component destruction) never reconnects.
        const connect = (attempt: number) => {
            const ws = new WebSocket(fullWsUrl);
            component.websockets.set(providerName, ws);
            let closed = false;
            let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
            let stopPing = () => {};
            const ownsSocket = () => component.websockets.get(providerName) === ws &&
                !(ws as any).__cossack_intentional_close && component._phase !== 'Destroyed';
            const isCurrent = () => !closed && ownsSocket();
            updateStatus(component, { provider: providerName },
                attempt === 0 ? { state: 'connecting', attempts: 0 } : { state: 'reconnecting', attempts: attempt });

            ws.onopen = () => {
                if (!isCurrent()) return;
                attempt = 0;
                resetOptimisticSnapshotHistory(component);
                updateStatus(component, { provider: providerName },
                    { state: 'open', attempts: 0, lastError: undefined });
            };
        ws.onmessage = (event: MessageEvent) => {
            if (!isCurrent()) return;
            if (event.data === 'pong') {
                return; // Server heartbeat response, ignore.
            }
            let data: any;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                // Malformed frame — ignore rather than poisoning the socket.
                console.error('[Cossack] Ignoring malformed WebSocket message:', e);
                return;
            }
            if (!data || typeof data !== 'object') return;
            if (data.type === 'authorization-error' && data.code === 'COSSACK_REALTIME_AUTH_CHANGED') {
                closed = true;
                stopPing();
                clearTimeout(reconnectTimer);
                (ws as any).__cossack_intentional_close = true;
                if (component.websockets.get(providerName) === ws) component.websockets.delete(providerName);
                socketDisposers.delete(ws);
                ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
                failPendingSocketCalls(ws);
                try { ws.close(1008, 'Realtime authorization changed'); } catch { /* already closed */ }
                updateStatus(component, { provider: providerName }, {
                    state: 'closed', attempts: 0,
                    lastError: 'Realtime authorization changed. Reload the page to reconnect.',
                });
                return;
            }
            // Request-scoped frames route to their waiting call; broadcasts
            // continue through the handlers below.
            if (routeSocketFrame(ws, data)) return;
            if (typeof data.type !== 'string') return;
            if (data.type === 'state-update') {
                // Update public state from the new structure
                applyStateToComponent(component, data.state || {});
            } else if (data.type === 'action-complete') {
                const { action } = data;
                if (hasOptimisticCalls(component, action)) return;
                if (component.loading[action]) {
                    component.loading[action]--;
                    if (component.loading[action] <= 0) delete component.loading[action];
                }
                component.requestUpdate();
            } else if (data.type === 'client-action') {
                const { action, payload } = data;
                const clientMethods = Reflect.getMetadata('cossack:client-methods', component.constructor) || {};
                if (clientMethods[action] && !isSharedMethod(component.constructor, action) && component.hasMethod(action)) {
                    const method = component.getMethod(action);
                    (method as any)(...payload);
                }
            } else if (data.type === 'event') {
                const { eventName, payload } = data;
                const eventHandlers = Reflect.getMetadata('cossack:event-handlers', component.constructor) || {};
                if (eventHandlers[eventName]) {
                    for (const handlerMethod of eventHandlers[eventName]) {
                        if (!isCurrent()) return;
                        if (component.hasMethod(handlerMethod)) {
                            const method = component.getMethod(handlerMethod);
                            (method as any)(...payload);
                        }
                    }
                }
            }
        };

        // Keep-alive ping. The handle is cleared when the socket closes
        // (including when Cossack.destroy() closes it) so it doesn't leak a
        // timer — and a closure over the WS — for every provider per page.
        const pingInterval = setInterval(() => {
            if (isCurrent() && ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
            }
        }, 25000);
        stopPing = () => clearInterval(pingInterval);
        ws.onclose = () => {
            if (closed) return;
            closed = true;
            stopPing();
            failPendingSocketCalls(ws);
            if (component.websockets.get(providerName) !== ws) return;
            if ((ws as any).__cossack_intentional_close || component._phase === 'Destroyed') {
                Object.assign(realtimeStatus(component).websockets[providerName], { state: 'closed', updatedAt: Date.now() });
                if (component._phase !== 'Destroyed') component.requestUpdate?.();
                return;
            }
            const nextAttempt = attempt + 1;
            updateStatus(component, { provider: providerName }, {
                state: 'reconnecting',
                attempts: nextAttempt,
                lastError: 'WebSocket closed before the component was destroyed.',
            });
            reconnectTimer = setTimeout(() => {
                if (ownsSocket()) {
                    connect(nextAttempt);
                }
            }, realtimeReconnectDelay(nextAttempt));
        };
        ws.onerror = () => {
            if (!isCurrent()) return;
            stopPing();
            updateStatus(component, { provider: providerName }, {
                lastError: 'WebSocket error; the connection is closed or reconnecting.',
            });
        };
        socketDisposers.set(ws, () => {
            closed = true;
            (ws as any).__cossack_intentional_close = true;
            stopPing();
            clearTimeout(reconnectTimer);
            socketDisposers.delete(ws);
            ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
            failPendingSocketCalls(ws);
            ws.close();
        });
        };
        connect(0);
    }
}

/** Retire SSE ownership before closing: EventSource.close() emits no close event. */
export function disconnectSSE(component: any): void {
    const source: EventSource | undefined = component._sseConnection;
    if (!source) return;
    component._sseConnection = undefined;
    Object.assign(realtimeStatus(component).sse, { state: 'closed', updatedAt: Date.now() });
    source.onopen = null;
    source.onerror = null;
    source.close();
}

/**
 * Connect to an SSE endpoint for state updates (client-side only).
 * Uses componentRouteId and scopeKey from initial state.
 */
export function connectSSE(component: any): void {
    if (component._phase === 'Destroyed') return;
    disconnectSSE(component);
    const initialState = component.getInitialStateFromWindow();
    const componentRouteId = initialState?.componentRouteId;
    const scopeKey = initialState?.scopeKey;

    if (!componentRouteId) {
        console.error('[Cossack] Cannot connect SSE: componentRouteId not found in initial state.');
        return;
    }

    if (!scopeKey) {
        console.error('[Cossack] Cannot connect SSE: scopeKey not found in initial state.');
        return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set('scopeKey', scopeKey);
    params.set('params', JSON.stringify(initialState?.metadata?.params || {}));
    const es = new EventSource(`/sse/${componentRouteId}?${params.toString()}`);
    component._sseConnection = es;
    const isCurrent = () => component._sseConnection === es && component._phase !== 'Destroyed';
    updateStatus(component, 'sse', { state: 'connecting', attempts: 0 });
    es.onopen = () => {
        if (!isCurrent()) return;
        // EventSource reconnects automatically; onopen after a failure marks
        // recovery. A following `resync` event reports whether the snapshot
        // had to replace expired history.
        resetOptimisticSnapshotHistory(component);
        resetSseSnapshotCursor(component);
        updateStatus(component, 'sse', { state: 'open', attempts: 0, lastError: undefined });
    };
    es.onerror = () => {
        if (!isCurrent()) return;
        const status = realtimeStatus(component).sse;
        updateStatus(component, 'sse', {
            state: es.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting',
            attempts: status.attempts + 1,
            lastError: 'The SSE connection failed; EventSource is reconnecting.',
        });
    };
    es.addEventListener('resync', (event: MessageEvent) => {
        if (!isCurrent()) return;
        resetOptimisticSnapshotHistory(component);
        updateStatus(component, 'sse', { resynced: true });
        try {
            const marker = JSON.parse((event as any).data);
            if (marker && typeof marker.cursor === 'number') {
                updateStatus(component, 'sse', { lastEventId: marker.cursor });
            }
        } catch { /* keep the flag */ }
    });

    es.addEventListener('authorization-error', () => {
        if (!isCurrent()) return;
        disconnectSSE(component);
        updateStatus(component, 'sse', { state: 'closed', attempts: 0,
            lastError: 'Realtime authorization changed. Reload the page to reconnect.' });
        component.requestUpdate();
    });

    es.addEventListener('state-update', (event: MessageEvent) => {
        if (!isCurrent()) return;
        try {
            const stateUpdate = JSON.parse((event as any).data);
            const id = (event as any).lastEventId;
            if (id !== undefined && id !== '') {
                updateStatus(component, 'sse', { lastEventId: id });
            }
            const cursor = id !== undefined && id !== '' && /^\d+$/.test(id) ? Number(id) : undefined;
            applyStateToComponent(component, cursor === undefined ? stateUpdate : { ...stateUpdate, _cossack_sse_cursor: cursor },
                undefined, optimisticCallForRequest(component, stateUpdate._cossack_request_id));
            component.requestUpdate();
        } catch (e) {
            console.error('[Cossack] Error parsing SSE state-update:', e);
        }
    });

    es.addEventListener('action-complete', (event: MessageEvent) => {
        if (!isCurrent()) return;
        try {
            const { action } = JSON.parse((event as any).data);
            if (hasOptimisticCalls(component, action)) return;
            if (component.loading[action]) {
                component.loading[action]--;
                if (component.loading[action] <= 0) delete component.loading[action];
            }
            component.requestUpdate();
        } catch (e) {
            console.error('[Cossack] Error parsing SSE action-complete:', e);
        }
    });

    es.addEventListener('event', (event: MessageEvent) => {
        if (!isCurrent()) return;
        try {
            const { eventName, payload } = JSON.parse((event as any).data);
            const eventHandlers = Reflect.getMetadata('cossack:event-handlers', component.constructor) || {};
            if (eventHandlers[eventName]) {
                for (const handlerMethod of eventHandlers[eventName]) {
                    if (!isCurrent()) return;
                    if (component.hasMethod(handlerMethod)) {
                        const method = component.getMethod(handlerMethod);
                        (method as any)(...payload);
                    }
                }
            }
        } catch (e) {
            console.error('[Cossack] Error parsing SSE event:', e);
        }
    });

    es.addEventListener('client-action', (event: MessageEvent) => {
        if (!isCurrent()) return;
        try {
            const { action, payload } = JSON.parse((event as any).data);
            const clientMethods = Reflect.getMetadata('cossack:client-methods', component.constructor) || {};
            if (clientMethods[action] && !isSharedMethod(component.constructor, action) && component.hasMethod(action)) {
                const method = component.getMethod(action);
                (method as any)(...payload);
            }
        } catch (e) {
            console.error('[Cossack] Error parsing SSE client-action:', e);
        }
    });

    es.addEventListener('connected', () => {
        // Connection confirmed by server; status already reflects the open state.
    });

    // Streaming events — passive listeners; stream proxy instances attach/detach their own
    // listeners dynamically via addEventListener/removeEventListener on this EventSource.
}
