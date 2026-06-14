// src/shared/transport-connections.ts
import { PageStateProvider, StateProvider } from './StateProvider';

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
            const data = JSON.parse(event.data);
            if (data.type === 'state-update') {
                // Update public state from the new structure
                const stateUpdate = data.state || {};
                for (const key in stateUpdate) {
                    if (key === 'loading' || key === 'isServer' || key === 'params') continue;
                    if (component._isOptimisticLocked(key)) {
                        component._optimisticPendingState[key] = stateUpdate[key];
                    } else {
                        component.setProperty(key, stateUpdate[key]);
                    }
                }
            } else if (data.type === 'action-complete') {
                const { action } = data;
                if (component.loading[action]) {
                    component.loading[action]--;
                    if (component.loading[action] <= 0) {
                        delete component.loading[action];
                        // Release the lock but don't flush buffered state.
                        // The state-update for the final action arrives shortly
                        // after (or before) this action-complete. By releasing
                        // the lock, that state-update will apply the correct
                        // final server value directly via setProperty.
                        delete component._optimisticLockedKeys[action];
                        // Discard stale buffered state
                        const lockedKeys = component._optimisticLockedKeys[action];
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
                if (clientMethods[action] && component.hasMethod(action)) {
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

        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
            }
        }, 25000);
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
            for (const key in stateUpdate) {
                if (key === 'loading' || key === 'isServer' || key === 'params') continue;
                if (component._isOptimisticLocked(key)) {
                    component._optimisticPendingState[key] = stateUpdate[key];
                } else {
                    component.setProperty(key, stateUpdate[key]);
                }
            }
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
                    delete component._optimisticLockedKeys[action];
                    const lockedKeys = component._optimisticLockedKeys[action];
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
            if (clientMethods[action] && component.hasMethod(action)) {
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
