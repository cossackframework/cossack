// src/shared/method-proxy.ts
import type { PageOptions } from './decorators';
import { RootContext } from './cossack';
import { RESERVED_STATE_KEYS } from './component-types';
import { isSharedMethod } from './shared-method';
import { createRpcCall, readRpcStream, RPC_STREAM_CONTENT_TYPE, RpcError } from './rpc-stream';

interface ServerMethodBase {
    name: string;
}
interface ServerMethodWs extends ServerMethodBase {
    channel: string;
    provider: string;
}

/**
 * Collect ALL reactive state-like keys on a component constructor: `@State`,
 * `@Store`, `@ClientState`, and `@ClientStore`. Used by the optimistic-UI
 * snapshot/lock logic so that optimistic handlers track changes to stores
 * and client-only state too, not just `@State` keys.
 */
function getAllReactiveStateKeys(constructor: any): string[] {
    const keys = new Set<string>();
    const stateMeta = Reflect.getMetadata('cossack:state', constructor) || {};
    const storeMeta = Reflect.getMetadata('cossack:store', constructor) || {};
    for (const k of Object.keys(stateMeta)) keys.add(k);
    for (const k of Object.keys(storeMeta)) keys.add(k);
    for (const k of (Reflect.getMetadata('cossack:client-state', constructor) || [])) keys.add(k);
    for (const k of (Reflect.getMetadata('cossack:client-store', constructor) || [])) keys.add(k);
    return Array.from(keys);
}

/**
 * Decide whether an argument can be sent as JSON over a WebSocket. Keeps
 * primitives, plain objects, and arrays; drops DOM nodes, Event/File/Blob
 * instances, and functions (none of which are JSON-transportable).
 */
function isWsTransportable(arg: unknown): boolean {
    if (arg === null) return true;
    const t = typeof arg;
    if (t === 'function') return false;
    if (t !== 'object') return true; // primitive (string/number/boolean/undefined/bigint)
    // Object: reject DOM nodes, Events, Files, Blobs.
    const obj = arg as { nodeType?: unknown };
    if (typeof obj.nodeType === 'number') return false; // DOM node
    if (typeof Event !== 'undefined' && arg instanceof Event) return false;
    if (typeof File !== 'undefined' && arg instanceof File) return false;
    if (typeof Blob !== 'undefined' && arg instanceof Blob) return false;
    return true; // plain object / array / Date — JSON.stringify-able
}

/**
 * Walk an argument tree, replacing DOM nodes / Events / Window with null and
 * File objects with `{ _cossack_file_id }` references collected into `files`
 * (so they can be sent as multipart parts alongside the JSON payload). Shared
 * by the SSE and HTTP upload proxies.
 */
function extractFilesFromArg(arg: any, files: Map<string, File>): any {
    if (arg && (
        arg instanceof Node ||
        arg instanceof Event ||
        arg instanceof Window ||
        (arg.constructor && arg.constructor.name && (
            arg.constructor.name.endsWith('Event') ||
            arg.constructor.name === 'Window' ||
            arg.constructor.name === 'Document'
        ))
    )) {
        return null;
    }
    if (arg instanceof File) {
        const id = `file_${files.size}`;
        files.set(id, arg);
        return { _cossack_file_id: id };
    }
    if (arg instanceof FileList) {
        return Array.from(arg).map(file => extractFilesFromArg(file, files));
    }
    if (Array.isArray(arg)) {
        return arg.map(item => extractFilesFromArg(item, files));
    }
    if (arg && typeof arg === 'object' && arg !== null) {
        const newObj: any = {};
        for (const key in arg) {
            newObj[key] = extractFilesFromArg(arg[key], files);
        }
        return newObj;
    }
    return arg;
}

/**
 * Run an optimistic UI handler (if registered for `name`) on `target`, then
 * snapshot/diff the component's @State keys to lock the ones the handler
 * changed. Shared by the SSE, HTTP, and WebSocket proxies. Errors in the
 * handler are logged but never propagated (the server action still runs).
 */
function runOptimisticHandler(
    target: any,
    name: string,
    args: any[],
    optimisticHandlerName: string | undefined,
    stateKeys: string[],
): void {
    if (!optimisticHandlerName || !target.hasMethod(optimisticHandlerName)) return;
    try {
        const optimisticMethod = target.getMethod(optimisticHandlerName);
        const snapshot: Record<string, any> = {};
        for (const key of stateKeys) {
            snapshot[key] = target[key];
        }
        (optimisticMethod as any)(...args);
        if (!target._optimisticLockedKeys[name]) {
            target._optimisticLockedKeys[name] = new Set();
        }
        for (const key of stateKeys) {
            if (target[key] !== snapshot[key]) {
                target._optimisticLockedKeys[name].add(key);
            }
        }
        target.requestUpdate();
    } catch (e) {
        console.error(`Error in optimistic handler for '${name}':`, e);
    }
}

/**
 * Apply a server-sent state object to a component instance, respecting the
 * optimistic-lock protocol: locked keys are buffered in _optimisticPendingState
 * (applied once the action completes); other keys are set directly. Internal
 * reserved keys (_cossack_*, loading, isServer, params) are skipped. Does NOT
 * call requestUpdate — callers schedule a render as appropriate to their
 * transport. When requestState is provided for a direct /crpc response (HTTP
 * or SSE), fields changed locally since that request began are skipped as stale.
 */
export function applyStateToComponent(
    component: any,
    data: Record<string, any>,
    requestState?: Record<string, any>,
): void {
    for (const key in data) {
        if (key.startsWith('_cossack_')) continue;
        if (RESERVED_STATE_KEYS.has(key)) continue;
        // Direct /crpc responses contain the server's complete public state,
        // including fields merely echoed from the request. If the local value
        // no longer matches what this request sent, the client edited it while
        // the call was in flight (or a newer response already won), so this
        // field is stale and must not be applied.
        if (
            requestState &&
            Object.prototype.hasOwnProperty.call(requestState, key) &&
            !transportValuesEqual(component[key], requestState[key])
        ) {
            continue;
        }
        if (component._isOptimisticLocked(key)) {
            component._optimisticPendingState[key] = data[key];
        } else {
            component.setProperty(key, data[key]);
        }
    }
}

/** Clone state exactly as JSON transport will represent it. */
function snapshotTransportState(state: Record<string, any>): Record<string, any> {
    return JSON.parse(JSON.stringify(state));
}

/** Compare a live value with its JSON-transport snapshot. */
function transportValuesEqual(liveValue: unknown, sentValue: unknown): boolean {
    try {
        return JSON.stringify(liveValue) === JSON.stringify(sentValue);
    } catch {
        // The request snapshot is JSON-safe, but the live field can become
        // cyclic or contain a bigint while the request is in flight.
        return Object.is(liveValue, sentValue);
    }
}

/**
 * Notify the client SPA (if present) after a server action has succeeded so it
 * can invalidate all cached route documents before a possible redirect.
 * Calling the framework-private hook when absent (SSR, tests) is a no-op.
 */
function invalidateClientPageCache(): void {
    (globalThis as { __cossack_invalidatePageCache?: () => void }).__cossack_invalidatePageCache?.();
}

/** HTTP and SSE actions share a single response-local promise/iterator call. */
export function proxyHttpMethods(component: any, serverMethods: ServerMethodBase[]): void {
    const initialState = component.getInitialStateFromWindow();
    const componentRouteId = component.constructor.name === 'App'
        ? initialState?.appRouteId
        : component.__cossack_componentRouteId || initialState?.componentRouteId;
    if (!componentRouteId) {
        console.error('[Cossack] Cannot create HTTP proxies: componentRouteId not found in initial state.');
        return;
    }
    const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', component.constructor) || {};
    const stateKeys = getAllReactiveStateKeys(component.constructor);
    for (const { name } of serverMethods) {
        if (isSharedMethod(component.constructor, name)) continue;
        const proxy = (...args: any[]) => {
            runOptimisticHandler(component, name, args, optimisticHandlers[name], stateKeys);
            component.loading[name] = (component.loading[name] || 0) + 1;
            component.requestUpdate();
            const controller = new AbortController();
            let upload: XMLHttpRequest | undefined;
            let cleaned = false;
            let success = false;
            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                if (component.loading[name] > 0) component.loading[name]--;
                if (!component.loading[name]) {
                    delete component.loading[name];
                    const lockedKeys = component._optimisticLockedKeys[name];
                    delete component._optimisticLockedKeys[name];
                    if (lockedKeys) {
                        for (const key of lockedKeys) {
                            if (component._isOptimisticLocked(key)) continue;
                            if (success && Object.prototype.hasOwnProperty.call(component._optimisticPendingState, key)) {
                                component.setProperty(key, component._optimisticPendingState[key]);
                            }
                            delete component._optimisticPendingState[key];
                        }
                    }
                }
                component.requestUpdate();
            };
            let requestState: Record<string, any>;
            let request: Promise<Response>;
            try {
                const files = new Map<string, File>();
                const payload = args.map(arg => extractFilesFromArg(arg, files));
                requestState = snapshotTransportState(component.getPublicState());
                if (files.size) {
                    const formData = new FormData();
                    formData.append('componentRouteId', componentRouteId);
                    if (component._id) formData.append('target', component._id);
                    formData.append('action', name);
                    formData.append('state', JSON.stringify(requestState));
                    formData.append('payload', JSON.stringify(payload));
                    files.forEach((file, id) => formData.append(id, file));
                    request = new Promise<Response>((resolve, reject) => {
                        const xhr = upload = new XMLHttpRequest();
                        xhr.open('POST', `/upload${window.location.search}`, true);
                        xhr.upload.onprogress = (event) => {
                            const property = `${name}Progress`;
                            if (event.lengthComputable && typeof component.getProperty(property) === 'number') {
                                component.setProperty(property, event.loaded / event.total * 100);
                                component.requestUpdate();
                            }
                        };
                        xhr.onload = () => {
                            try {
                                resolve(new Response(xhr.responseText, {
                                    status: xhr.status, headers: { 'Content-Type': 'application/json' },
                                }));
                            } catch (cause) {
                                reject(new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Upload failed.', { cause }));
                            }
                        };
                        xhr.onerror = () => reject(new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Upload failed.'));
                        xhr.onabort = () => reject(new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.'));
                        xhr.send(formData);
                    });
                } else {
                    request = fetch(`/crpc${window.location.search}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Accept: `${RPC_STREAM_CONTENT_TYPE}, application/json` },
                        signal: controller.signal,
                        body: JSON.stringify({
                            componentRouteId, target: component._id, action: name,
                            state: requestState, payload, scopeKey: initialState?.scopeKey,
                            pageParams: initialState?.metadata?.params || {},
                        }),
                    });
                }
            } catch (cause) {
                request = Promise.reject(new RpcError('COSSACK_RPC_SERIALIZATION_FAILED',
                    `Cannot serialize arguments or state for '${name}'.`, { cause }));
            }
            // The request starts immediately; selecting a result consumer never dispatches it again.
            void request.catch(() => {});
            const apply = (state: Record<string, unknown>) => {
                // Advance the snapshot only for fields this response can apply. This
                // lets later stream frames update the same field without clobbering
                // edits made locally while the request was in flight.
                const applicable = Object.keys(state).filter(key => !Object.prototype.hasOwnProperty.call(requestState, key)
                    || transportValuesEqual(component[key], requestState[key]));
                applyStateToComponent(component, state, requestState);
                for (const key of applicable) {
                    if (!key.startsWith('_cossack_') && !RESERVED_STATE_KEYS.has(key)) {
                        requestState[key] = snapshotTransportState({ value: component[key] }).value;
                    }
                }
                component.requestUpdate();
            };
            const operation = async function* (): AsyncGenerator<unknown, unknown> {
                try {
                    if (controller.signal.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.');
                    const response = await request;
                    if (!response.ok) {
                        let body: any;
                        try { body = await response.json(); } catch { /* preserve HTTP status */ }
                        throw new RpcError(body?.code ?? 'COSSACK_RPC_FAILED',
                            typeof body?.error === 'string' ? body.error : `HTTP error! status: ${response.status}`,
                            { status: response.status, requestId: response.headers?.get('X-Cossack-Request-Id') ?? undefined });
                    }
                    if (response.headers?.get('Content-Type')?.split(';', 1)[0] === RPC_STREAM_CONTENT_TYPE) {
                        let invalidated = false;
                        for await (const frame of readRpcStream(response, controller.signal)) {
                            if (frame.type === 'error') throw new RpcError(frame.code, frame.message, { requestId: frame.requestId });
                            if (!invalidated) { invalidateClientPageCache(); invalidated = true; }
                            apply(frame.state);
                            if (frame.type === 'done') { success = true; return frame.value; }
                            yield frame.value;
                        }
                    } else {
                        let data: Record<string, unknown>;
                        try {
                            data = await response.json() as Record<string, unknown>;
                            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Expected a state object.');
                        } catch (cause) {
                            throw new RpcError('COSSACK_RPC_RESPONSE_INVALID', 'Invalid RPC response.', { cause });
                        }
                        invalidateClientPageCache();
                        if (typeof data._cossack_redirect === 'string') {
                            success = true;
                            window.location.href = data._cossack_redirect;
                            return;
                        }
                        apply(data);
                        success = true;
                        if (data._cossack_return !== undefined) yield data._cossack_return;
                        return data._cossack_return;
                    }
                } catch (cause) {
                    if (controller.signal.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { cause });
                    if (cause instanceof RpcError) throw cause;
                    throw new RpcError('COSSACK_RPC_NETWORK_FAILED', 'RPC request failed.', { cause });
                } finally { cleanup(); }
            };
            return createRpcCall(operation(), () => {
                controller.abort();
                upload?.abort();
                cleanup();
            }, error => console.error(`Error calling server action '${name}':`, error));
        };
        component.__cossack_proxies.set(name, proxy);
        component.setProperty(name, proxy);
    }
}

/**
 * Create WebSocket-based proxies for @Server methods (client-side only).
 * Sends actions over the provider's WebSocket and integrates optimistic handlers.
 */
export function proxyServerMethods(component: any, serverMethods: ServerMethodWs[]): void {
    const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', component.constructor) || {};
    const stateKeys = getAllReactiveStateKeys(component.constructor);

    for (const method of serverMethods) {
        const { name, channel, provider } = method;
        if (isSharedMethod(component.constructor, name)) continue;
        const proxy = (...args: any[]) => {
            let ws = component.websockets.get(provider);
            if (!ws) {
                const root = component.consume(RootContext);
                if (root) {
                    ws = (root as any).websockets.get(provider);
                }
            }

            if (ws && ws.readyState === WebSocket.OPEN) {
                // Optimistic UI Handler
                runOptimisticHandler(component, name, args, optimisticHandlers[name], stateKeys);

                component.loading[name] = (component.loading[name] || 0) + 1;
                component.requestUpdate();

                // Keep serializable args (primitives, plain objects, arrays),
                // drop non-transportable ones (DOM nodes, Event, File, Blob,
                // functions). The previous implementation dropped ALL objects,
                // so calling e.g. this.updateItem({ id: 5 }) over WebSocket
                // sent an empty payload.
                const payload = args.filter(isWsTransportable);
                let message;
                try {
                    message = JSON.stringify({
                        type: 'action',
                        action: name,
                        payload: payload,
                        channel: channel,
                        target: component._id,
                    });
                } catch (e) {
                    console.error(`[Cossack] Failed to serialise WS payload for '${name}':`, e);
                    return;
                }
                ws.send(message);
                invalidateClientPageCache();
            } else {
                console.error(`WebSocket for provider '${provider}' not connected. Cannot call server method '${name}'.`);
            }
        };

        // Store proxy in the map so stubbed methods can find it
        component.__cossack_proxies.set(name, proxy);

        // Set the method on the instance
        component.setProperty(name, proxy);
    }
}

/**
 * Discover @Server methods (and un-decorated methods, which are server-only by
 * default) on the component class and wire them up via the appropriate transport.
 * Called on the client once per component during state initialization.
 */
export function setupServerMethodProxies(component: any): void {
    if (component._serverMethodsProxied) {
        return; // Already proxied
    }

    // Get server methods directly from Reflect metadata
    const serverMethodsMetadata = Reflect.getMetadata('cossack:server-methods', component.constructor) || {};

    // Build the server methods list from metadata
    const serverMethods = Object.entries(serverMethodsMetadata)
        .filter(([name]) => !isSharedMethod(component.constructor, name))
        .map(([name, options]: [string, any]) => ({
            name,
            channel: options.channel || 'global',
            provider: options.provider || 'page',
        }));

    // Also detect methods without decorators (server-only by default)
    const clientSafeMethods = new Set(
        Object.keys(Reflect.getMetadata('cossack:client-methods', component.constructor) || {})
    );
    const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', component.constructor) || {};
    const computedMethods = Reflect.getMetadata('computed', component.constructor) || {};

    // Add client-safe methods to the set
    Object.values(optimisticHandlers || {}).forEach((handler: any) => clientSafeMethods.add(handler));
    Object.keys(computedMethods || {}).forEach(key => clientSafeMethods.add(key));

    // Add @PreventNavigation() decorated methods as client-safe
    const preventNavigationMethod = Reflect.getMetadata('cossack:prevent-navigation', component.constructor);
    if (preventNavigationMethod) {
        clientSafeMethods.add(preventNavigationMethod);
    }

    // Add @Task decorated methods as client-safe
    const taskMethods = Reflect.getMetadata('cossack:tasks', component.constructor) || [];
    taskMethods.forEach((reg: { propertyKey: string }) => clientSafeMethods.add(reg.propertyKey));

    // Add @ClientTask decorated methods as client-safe
    const clientTaskMethods = Reflect.getMetadata('cossack:client-tasks', component.constructor) || [];
    clientTaskMethods.forEach((reg: { propertyKey: string }) => clientSafeMethods.add(reg.propertyKey));

    // Add @VisibleTask decorated methods as client-safe
    const visibleTaskMethods = Reflect.getMetadata('cossack:visible-tasks', component.constructor) || [];
    visibleTaskMethods.forEach((item: { propertyKey: string }) => clientSafeMethods.add(item.propertyKey));

    // Add @On, @OnDocument, @OnWindow decorated methods as client-safe
    const domEvents = Reflect.getMetadata('cossack:dom-events', component.constructor) || [];
    domEvents.forEach((item: { propertyKey: string }) => clientSafeMethods.add(item.propertyKey));
    const documentEvents = Reflect.getMetadata('cossack:document-events', component.constructor) || [];
    documentEvents.forEach((item: { propertyKey: string }) => clientSafeMethods.add(item.propertyKey));
    const windowEvents = Reflect.getMetadata('cossack:window-events', component.constructor) || [];
    windowEvents.forEach((item: { propertyKey: string }) => clientSafeMethods.add(item.propertyKey));

    // Only methods explicitly registered via @Server metadata (or the
    // compile-time __serverOnly injection for @Server) become RPC methods.
    // Undecorated helpers are NOT auto-registered — they fail loudly if called
    // from the client, matching the compile-time security plugin behavior.
    const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', component.constructor);

    if (pageOptions?.transport === 'http' || pageOptions?.transport === 'sse') {
        component.proxyHttpMethods(serverMethods);
    } else {
        component.proxyServerMethods(serverMethods);
    }
    component._serverMethodsProxied = true;
}

/**
 * Framework-internal lifecycle methods that are decorated with `@Server()`
 * purely so the security plugin strips them from the client bundle. They are
 * NOT RPC endpoints and must never be invocable by a remote client.
 */
const RPC_BLOCKED_INTERNAL_METHODS: ReadonlySet<string> = new Set([
    'initializeProviders',
    'proxyClientMethods',
    'validateChannels',
]);

/**
 * Authorisation gate for RPC dispatch (HTTP `/crpc`, `/upload`, and WebSocket
 * action messages).
 *
 * Only methods registered in the `cossack:server-methods` metadata — i.e.
 * `@Server()`-decorated methods — are eligible for remote invocation. This is
 * the server-side counterpart to the client-side bundle stripping: without it,
 * any public or inherited method on a component instance (e.g. `bootstrap`,
 * `getMethod`, `setProperty`, `getPublicState`, `destroy`) could be invoked by
 * a crafted request, fully bypassing the "secure by default" guarantee.
 *
 * `Reflect.getMetadata` returns only the nearest ancestor's own metadata, so
 * the prototype chain is walked manually to honour inherited `@Server` methods
 * (such as the base-class `redirect`).
 */
export function isRpcCallableAction(constructor: unknown, action: unknown): action is string {
    if (typeof action !== 'string' || action.length === 0) return false;
    // Prototype-pollution / builtin guards.
    if (action === '__proto__' || action === 'prototype' || action === 'constructor') return false;
    // Framework-internal @Server lifecycle hooks are not RPC endpoints.
    if (RPC_BLOCKED_INTERNAL_METHODS.has(action)) return false;
    if (isSharedMethod(constructor, action)) return false;

    let proto: object | null = typeof constructor === 'function' ? constructor : null;
    while (proto !== null && proto !== Function.prototype) {
        const serverMethods = Reflect.getOwnMetadata('cossack:server-methods', proto) as
            | Record<string, unknown>
            | undefined;
        if (serverMethods && Object.prototype.hasOwnProperty.call(serverMethods, action)) {
            return true;
        }
        proto = Object.getPrototypeOf(proto);
    }
    return false;
}

/**
 * Reduce a client-supplied `state` blob (from `/crpc` or `/upload`) to only the
 * keys registered as `@State` on the target component. This is the server-side
 * guard against state-injection / privilege escalation: without it a crafted
 * request could overwrite framework-internal or security-sensitive properties
 * such as `user`, `_runtime`, `_cossack_ws_context`, `loading`, etc.
 *
 * Prototype-pollution vectors (`__proto__`, `prototype`, `constructor`) are
 * refused unconditionally even if they somehow appeared in metadata.
 */
export function sanitizeClientState(
    constructor: unknown,
    state: unknown
): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    if (!state || typeof state !== 'object') return clean;

    const allowed = new Set<string>();
    let proto: object | null = typeof constructor === 'function' ? constructor : null;
    while (proto !== null && proto !== Function.prototype) {
        // Allow push-back for public state only: @State and @Store.
        // @ClientState and @ClientStore are client-only by design and must
        // never be accepted from an inbound client request.
        const stateMeta = Reflect.getOwnMetadata('cossack:state', proto) as
            | Record<string, unknown>
            | undefined;
        if (stateMeta) {
            for (const key of Object.keys(stateMeta)) allowed.add(key);
        }
        const storeMeta = Reflect.getOwnMetadata('cossack:store', proto) as
            | Record<string, unknown>
            | undefined;
        if (storeMeta) {
            for (const key of Object.keys(storeMeta)) allowed.add(key);
        }
        proto = Object.getPrototypeOf(proto);
    }

    const source = state as Record<string, unknown>;
    for (const key of Object.keys(source)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
        if (allowed.has(key)) clean[key] = source[key];
    }
    return clean;
}
