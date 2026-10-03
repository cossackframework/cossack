import { collectServerMethodMetadata } from './server-method-metadata';
// src/shared/method-proxy.ts
import type { PageOptions } from './decorators';
import { RootContext } from './cossack';
import { RESERVED_STATE_KEYS } from './component-types';
import { isSharedMethod } from './shared-method';
import { createRpcCall, describeUnsupportedValue, snapshotRpcValue, readRpcNativeResponse, RPC_NATIVE_RESPONSE_HEADER, readRpcStream, RPC_STREAM_CONTENT_TYPE, RpcError, type RpcStreamFrame } from './rpc-stream';
import { readRpcJsonResponse, readRpcHttpError } from './rpc-json';
import { sendRpcUpload } from './rpc-upload';
import { rpcFormData } from './rpc-files';
import { wsPendingCalls } from './transport-connections';

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
 * primitives, plain objects, and arrays; drops DOM nodes and Event
 * instances. Unsupported data values are rejected with a diagnostic.
 */
function isWsTransportable(arg: unknown): boolean {
    if (arg === null) return true;
    const t = typeof arg;
    if (t !== 'object') return true; // primitive (string/number/boolean/undefined/bigint)
    // UI event arguments are ignored. Binary arguments must reach validation,
    // which rejects them before dispatch instead of silently changing arity.
    const obj = arg as { nodeType?: unknown };
    if (typeof obj.nodeType === 'number') return false; // DOM node
    if (typeof Event !== 'undefined' && arg instanceof Event) return false;
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
    // Dates serialize to ISO strings through JSON on every transport; keep
    // the value itself so the upload boundary matches WS/service behavior.
    if (arg instanceof Date) return arg;
    if (Array.isArray(arg)) {
        return arg.map(item => extractFilesFromArg(item, files));
    }
    if (arg && typeof arg === 'object' && arg !== null) {
        const newObj: any = Object.create(null);
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
            !transportValuesEqual(component[key], requestState[key], key)
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
    return snapshotRpcValue(state, 'state') as Record<string, any>;
}

/** Compare a live value with its JSON-transport snapshot. */
function transportValuesEqual(liveValue: unknown, sentValue: unknown, key: string): boolean {
    try {
        return JSON.stringify(snapshotTransportState({ [key]: liveValue })[key]) === JSON.stringify(sentValue);
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

/**
 * Build the response-state applier shared by every transport proxy: apply the
 * server state, skip fields the client edited while the request was in flight,
 * and advance the request snapshot so later frames do not clobber local edits.
 */
function createStateApplier(component: any, requestState: Record<string, any>) {
    return (state: Record<string, unknown>) => {
        // Advance the snapshot only for fields this response can apply. This
        // lets later stream frames update the same field without clobbering
        // edits made locally while the request was in flight.
        const applicable = Object.keys(state).filter(key => !Object.prototype.hasOwnProperty.call(requestState, key)
            || transportValuesEqual(component[key], requestState[key], key));
        applyStateToComponent(component, state, requestState);
        for (const key of applicable) {
            if (!key.startsWith('_cossack_') && !RESERVED_STATE_KEYS.has(key)) {
                requestState[key] = snapshotTransportState({ [key]: component[key] })[key];
            }
        }
        component.requestUpdate();
    };
}

/** Per-call loading and optimistic-lock lifecycle shared by the transport proxies. */
function createCallLifecycle(component: any, name: string) {
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
    return { cleanup, succeed: () => { success = true; } };
}

/** Ordered frame queue for request-scoped realtime calls. */
class SocketFrameQueue {
    private frames: Array<{ frame: RpcStreamFrame; bytes: number }> = [];
    private bytes = 0;
    private failed = false;
    private resolvers: Array<(result: IteratorResult<RpcStreamFrame>) => void> = [];

    push(frame: RpcStreamFrame): void {
        if (this.failed) return;
        const resolve = this.resolvers.shift();
        if (resolve) resolve({ value: frame, done: false });
        else {
            const bytes = new TextEncoder().encode(JSON.stringify(frame)).length;
            if (this.frames.length >= 256 || this.bytes + bytes > 4 * 1024 * 1024) {
                this.fail({ v: 1, type: 'error', requestId: frame.requestId,
                    code: 'COSSACK_RPC_BUFFER_EXCEEDED', message: 'RPC consumer fell behind the bounded realtime buffer.' });
                return;
            }
            this.frames.push({ frame, bytes });
            this.bytes += bytes;
        }
    }

    fail(frame: RpcStreamFrame): void {
        this.failed = true;
        this.frames = [{ frame, bytes: 0 }];
        this.bytes = 0;
        for (const resolve of this.resolvers.splice(0)) resolve({ value: frame, done: false });
    }

    next(): Promise<IteratorResult<RpcStreamFrame>> {
        const queued = this.frames.shift();
        if (queued) {
            this.bytes -= queued.bytes;
            return Promise.resolve({ value: queued.frame, done: false });
        }
        return new Promise(resolve => this.resolvers.push(resolve));
    }
}

/** A call that rejects without dispatching anything (for example, no socket). */
function rejectedRpcCall(code: string, message: string, name: string): ReturnType<typeof createRpcCall> {
    return createRpcCall((async function* () { throw new RpcError(code, message); })(), () => {},
        error => console.error(`Error calling server action '${name}':`, error));
}

/** Resolve the @Server({ timeout }) deadline declared for a method, if any. */
function serverMethodTimeout(constructor: any, name: string): number | undefined {
    const metadata = collectServerMethodMetadata(constructor);
    const timeout = Number(metadata[name]?.timeout);
    return Number.isFinite(timeout) && timeout > 0 ? timeout : undefined;
}

/** Race a frame wait against the call deadline. */
async function nextFrameWithDeadline(
    queue: SocketFrameQueue,
    deadline: number,
    requestId: string,
    timeoutMs: number | undefined,
): Promise<IteratorResult<RpcStreamFrame>> {
    if (deadline === Infinity) return queue.next();
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        throw new RpcError('COSSACK_RPC_TIMEOUT',
            `The call exceeded its ${timeoutMs}ms deadline. The server outcome is unknown and is never retried.`, { requestId });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            queue.next(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new RpcError('COSSACK_RPC_TIMEOUT',
                    `The call exceeded its ${timeoutMs}ms deadline. The server outcome is unknown and is never retried.`,
                    { requestId })), remaining);
            }),
        ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
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
        const timeoutMs = serverMethodTimeout(component.constructor, name);
        const proxy = (...args: any[]) => {
            runOptimisticHandler(component, name, args, optimisticHandlers[name], stateKeys);
            component.loading[name] = (component.loading[name] || 0) + 1;
            component.requestUpdate();
            const controller = new AbortController();
            let timedOut = false;
            // A deadline aborts the call but never retries it: the mutation may
            // have completed server-side, so its outcome stays unknown.
            const deadlineTimer = timeoutMs === undefined ? undefined : setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
            const { cleanup: finish, succeed } = createCallLifecycle(component, name);
            const cleanup = () => {
                if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
                finish();
            };
            let requestState: Record<string, any> = {};
            let payload: unknown[] = args;
            let request: Promise<Response>;
            // Validate the RAW arguments before the walker runs: the upload
            // walker replaces DOM/Event values with null and Files with
            // references by design, but would silently EMPTY Maps, Sets, and
            // class instances (for..in copies nothing). Reject those with the
            // original path so every transport behaves identically — and
            // reject the CALL rather than throwing synchronously, matching
            // the realtime proxies' contract.
            const handledByUpload = (value: object) =>
                value instanceof File || value instanceof FileList ||
                value instanceof Node || value instanceof Event || value === (globalThis as any);
            try {
                const files = new Map<string, File>();
                const normalizedArgs = snapshotRpcValue(args, 'payload', { handled: handledByUpload }) as unknown[];
                payload = normalizedArgs.map(arg => extractFilesFromArg(arg, files));
                const liveState = component.getPublicState();
                requestState = liveState;
                requestState = snapshotTransportState(liveState);
                if (files.size) {
                    const formData = rpcFormData({ componentRouteId, target: component._id, action: name,
                        state: requestState, payload, scopeKey: initialState?.scopeKey,
                        pageParams: initialState?.metadata?.params || {} }, files);
                    const property = `${name}Progress`;
                    // Fetch keeps native response streaming/backpressure. XHR
                    // is required only when the author requests upload progress.
                    request = typeof component.getProperty?.(property) === 'number'
                        ? sendRpcUpload(`/upload${window.location.search}`, formData, controller.signal, event => {
                            if (event.lengthComputable) {
                                component.setProperty(property, event.loaded / event.total * 100);
                                component.requestUpdate();
                            }
                        })
                        : fetch(`/upload${window.location.search}`, {
                            method: 'POST', body: formData, signal: controller.signal,
                            headers: { Accept: `${RPC_STREAM_CONTENT_TYPE}, application/json` },
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
                // Pre-dispatch validation already produced a path-accurate
                // diagnostic; never bury it under a generic message.
                if (cause instanceof RpcError && cause.code === 'COSSACK_RPC_SERIALIZATION_FAILED') {
                    request = Promise.reject(cause);
                } else {
                    const where = describeUnsupportedValue(payload) ?? describeUnsupportedValue(requestState);
                    request = Promise.reject(new RpcError('COSSACK_RPC_SERIALIZATION_FAILED',
                        `Cannot serialize arguments or state for '${name}'` +
                        `${where ? `: unsupported value at ${where}` : ''}.`, { cause }));
                }
            }
            // The request starts immediately; selecting a result consumer never dispatches it again.
            void request.catch(() => {});
            const apply = createStateApplier(component, requestState);
            let requestId: string | undefined;
            const operation = async function* (): AsyncGenerator<unknown, unknown> {
                try {
                    if (controller.signal.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.');
                    const response = await request;
                    requestId = response.headers?.get('X-Cossack-Request-Id') ?? undefined;
                    if (!response.ok) {
                        throw await readRpcHttpError(response, controller.signal);
                    }
                    if (response.headers?.get(RPC_NATIVE_RESPONSE_HEADER) === 'native') {
                        const result = await readRpcNativeResponse(response, controller.signal);
                        invalidateClientPageCache();
                        succeed();
                        return result;
                    }
                    if (response.headers?.get('Content-Type')?.split(';', 1)[0] === RPC_STREAM_CONTENT_TYPE) {
                        let invalidated = false;
                        for await (const frame of readRpcStream(response, controller.signal)) {
                            if (frame.type === 'error') throw new RpcError(frame.code, frame.message,
                                { requestId: frame.requestId, fieldErrors: frame.fieldErrors });
                            if (!invalidated) { invalidateClientPageCache(); invalidated = true; }
                            apply(frame.state);
                            if (frame.type === 'done') { succeed(); return frame.value; }
                            yield frame.value;
                        }
                    } else {
                        const data = await readRpcJsonResponse(response, 'component', controller.signal);
                        invalidateClientPageCache();
                        if (typeof data._cossack_redirect === 'string') {
                            succeed();
                            window.location.href = data._cossack_redirect;
                            return;
                        }
                        apply(data);
                        succeed();
                        return data._cossack_return;
                    }
                } catch (cause) {
                    if (controller.signal.aborted) {
                        if (timedOut) throw new RpcError('COSSACK_RPC_TIMEOUT',
                            `The call exceeded its ${timeoutMs}ms deadline. The server outcome is unknown and is never retried.`, { cause, requestId });
                        throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { cause, requestId });
                    }
                    if (cause instanceof RpcError) throw cause;
                    throw new RpcError('COSSACK_RPC_NETWORK_FAILED',
                        'RPC request failed. The server outcome is unknown and is never retried.', { cause, requestId });
                } finally { cleanup(); }
            };
            return createRpcCall(operation(), () => {
                controller.abort();
                cleanup();
            }, error => console.error(`Error calling server action '${name}':`, error), () => requestId);
        };
        component.__cossack_proxies.set(name, proxy);
        component.setProperty(name, proxy);
    }
}

/**
 * Create WebSocket-based proxies for @Server methods (client-side only).
 * Every call is one request-scoped realtime RPC: correlated yield/done/error
 * frames by request id, promise-or-iterator consumption, cancellation, and
 * the same optimistic and loading lifecycle as HTTP/SSE calls.
 */
export function proxyServerMethods(component: any, serverMethods: ServerMethodWs[]): void {
    const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', component.constructor) || {};
    const stateKeys = getAllReactiveStateKeys(component.constructor);

    for (const method of serverMethods) {
        const { name, channel, provider } = method;
        if (isSharedMethod(component.constructor, name)) continue;
        const timeoutMs = serverMethodTimeout(component.constructor, name);
        const proxy = (...args: any[]) => {
            let ws = component.websockets.get(provider);
            if (!ws) {
                const root = component.consume(RootContext);
                if (root) {
                    ws = (root as any).websockets.get(provider);
                }
            }
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                return rejectedRpcCall('COSSACK_RPC_TRANSPORT_UNAVAILABLE',
                    `Realtime connection for provider '${provider}' is not open, so '${name}' was not dispatched.`, name);
            }

            runOptimisticHandler(component, name, args, optimisticHandlers[name], stateKeys);
            component.loading[name] = (component.loading[name] || 0) + 1;
            component.requestUpdate();

            const requestId = crypto.randomUUID();
            const { cleanup, succeed } = createCallLifecycle(component, name);
            // Keep serializable args (primitives, plain objects, arrays), drop
            // non-transportable UI objects (DOM nodes, Event).
            let payload = args.filter(isWsTransportable);
            const queue = new SocketFrameQueue();
            let message: string;
            let requestState: Record<string, unknown> = {};
            try {
                requestState = component.getPublicState();
                payload = snapshotRpcValue(payload, 'payload') as unknown[];
                requestState = snapshotTransportState(requestState);
                message = JSON.stringify({
                    v: 1,
                    type: 'action',
                    requestId,
                    action: name,
                    payload: payload,
                    channel: channel,
                    target: component._id,
                });
            } catch (cause) {
                cleanup();
                if (cause instanceof RpcError) return rejectedRpcCall(cause.code, cause.message, name);
                const where = describeUnsupportedValue(payload, 'payload') ?? describeUnsupportedValue(requestState, 'state');
                return rejectedRpcCall('COSSACK_RPC_SERIALIZATION_FAILED',
                    `Cannot serialize the realtime request for '${name}'` +
                    `${where ? `: unsupported value at ${where}` : ''}.`, name);
            }
            const apply = createStateApplier(component, requestState);
            wsPendingCalls(ws).set(requestId, frame => queue.push(frame));
            try {
                ws.send(message);
            } catch (cause) {
                wsPendingCalls(ws).delete(requestId);
                cleanup();
                return rejectedRpcCall('COSSACK_RPC_TRANSPORT_FAILED',
                    `Cannot send the realtime request for '${name}'.`, name);
            }
            invalidateClientPageCache();

            const operation = async function* (): AsyncGenerator<unknown, unknown> {
                const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
                try {
                    while (true) {
                        const next = await nextFrameWithDeadline(queue, deadline, requestId, timeoutMs);
                        const frame = next.value;
                        if (frame.type === 'error') throw new RpcError(frame.code, frame.message,
                            { requestId, fieldErrors: frame.fieldErrors });
                        apply(frame.state);
                        if (frame.type === 'done') { succeed(); return frame.value; }
                        yield frame.value;
                    }
                } catch (error) {
                    if (error instanceof RpcError && ['COSSACK_RPC_TIMEOUT', 'COSSACK_RPC_BUFFER_EXCEEDED',
                        'COSSACK_RPC_STREAM_INVALID', 'COSSACK_RPC_STREAM_TOO_LARGE'].includes(error.code)) {
                        try { ws.send(JSON.stringify({ type: 'cancel', requestId })); } catch { /* socket already gone */ }
                    }
                    throw error;
                } finally {
                    wsPendingCalls(ws).delete(requestId);
                    cleanup();
                }
            };
            return createRpcCall(operation(), () => {
                // Wake local consumers immediately. Server cancellation is a
                // best effort and cannot interrupt arbitrary application I/O.
                queue.fail({ v: 1, type: 'error', requestId,
                    code: 'COSSACK_RPC_CANCELLED', message: 'RPC call was cancelled.' });
                try { ws.send(JSON.stringify({ type: 'cancel', requestId })); } catch { /* socket already gone */ }
            }, error => console.error(`Error calling server action '${name}':`, error), () => requestId);
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
    const serverMethodsMetadata = collectServerMethodMetadata(component.constructor);

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
