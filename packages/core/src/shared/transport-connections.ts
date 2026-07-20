// src/shared/transport-connections.ts
import { PageStateProvider, StateProvider } from './StateProvider';
import { applyStateToComponent } from './method-proxy';
import { isSharedMethod } from './shared-method';

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

/**
 * Connect to WebSocket providers (client-side only).
 * Reads provider targets from initial state and sets up message handlers
 * for state updates, action completions, and events.
 */
export function connectWebSocket(component: any): void {
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
            ...(initialState?.metadata?.params || {}),
        }).toString();

        const wsUrl = `/ws/${providerName}/${target}?${params}`;
        const fullWsUrl = `ws://${window.location.host}${wsUrl}`;
        const ws = new WebSocket(fullWsUrl);
        component.websockets.set(providerName, ws);

        ws.onmessage = (event: MessageEvent) => {
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
            if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
            if (data.type === 'state-update') {
                // Update public state from the new structure
                applyStateToComponent(component, data.state || {});
            } else if (data.type === 'action-complete') {
                const { action } = data;
                if (component.loading[action]) {
                    component.loading[action]--;
                    if (component.loading[action] <= 0) {
                        delete component.loading[action];
                        // Release the optimistic lock and discard any buffered
                        // pending state for the locked keys. Capture the set
                        // BEFORE deleting (the previous code deleted first, then
                        // read undefined — leaving _optimisticPendingState to
                        // grow without bound). The authoritative post-action
                        // value arrives in the next state-update and is applied
                        // directly via setProperty once the lock is released.
                        const lockedKeys = component._optimisticLockedKeys[action];
                        delete component._optimisticLockedKeys[action];
                        if (lockedKeys) {
                            for (const key of lockedKeys) {
                                delete component._optimisticPendingState[key];
                            }
                        }
                    }
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
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
            }
        }, 25000);
        const stopPing = () => clearInterval(pingInterval);
        ws.onclose = stopPing;
        ws.onerror = stopPing;
    }
}

/**
 * Connect to an SSE endpoint for state updates (client-side only).
 * Uses componentRouteId and scopeKey from initial state.
 */
export function connectSSE(component: any): void {
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

    const params = new URLSearchParams({ scopeKey });
    const es = new EventSource(`/sse/${componentRouteId}?${params.toString()}`);
    component._sseConnection = es;

    es.addEventListener('state-update', (event: MessageEvent) => {
        try {
            const stateUpdate = JSON.parse((event as any).data);
            applyStateToComponent(component, stateUpdate);
            component.requestUpdate();
        } catch (e) {
            console.error('[Cossack] Error parsing SSE state-update:', e);
        }
    });

    es.addEventListener('action-complete', (event: MessageEvent) => {
        try {
            const { action } = JSON.parse((event as any).data);
            if (component.loading[action]) {
                component.loading[action]--;
                if (component.loading[action] <= 0) {
                    delete component.loading[action];
                    // Capture locked keys BEFORE deleting (see WS handler).
                    const lockedKeys = component._optimisticLockedKeys[action];
                    delete component._optimisticLockedKeys[action];
                    if (lockedKeys) {
                        for (const key of lockedKeys) {
                            delete component._optimisticPendingState[key];
                        }
                    }
                }
            }
            component.requestUpdate();
        } catch (e) {
            console.error('[Cossack] Error parsing SSE action-complete:', e);
        }
    });

    es.addEventListener('event', (event: MessageEvent) => {
        try {
            const { eventName, payload } = JSON.parse((event as any).data);
            const eventHandlers = Reflect.getMetadata('cossack:event-handlers', component.constructor) || {};
            if (eventHandlers[eventName]) {
                for (const handlerMethod of eventHandlers[eventName]) {
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
        // Connection confirmed by server
    });

    // Streaming events — passive listeners; stream proxy instances attach/detach their own
    // listeners dynamically via addEventListener/removeEventListener on this EventSource.

    es.onerror = () => {
        // EventSource auto-reconnects per spec
    };
}
