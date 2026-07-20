// src/shared/method-proxy.ts
import type { PageOptions } from './decorators';
import { RootContext } from './cossack';
import { RESERVED_STATE_KEYS } from './component-types';
import { isSharedMethod } from './shared-method';

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
 * transport.
 */
export function applyStateToComponent(component: any, data: Record<string, any>): void {
    for (const key in data) {
        if (key.startsWith('_cossack_')) continue;
        if (RESERVED_STATE_KEYS.has(key)) continue;
        if (component._isOptimisticLocked(key)) {
            component._optimisticPendingState[key] = data[key];
        } else {
            component.setProperty(key, data[key]);
        }
    }
}

/**
 * Notify the client SPA (if present) that a server action is being dispatched,
 * so it can invalidate the cached initial state for the current page. Without
 * this, navigating away and back after a mutation returns the stale cached
 * state. The hook is registered by the framework's client app; calling it when
 * absent (SSR, tests) is a no-op.
 */
function invalidateCurrentClientPage(): void {
    (globalThis as { __cossack_invalidateCurrentPage?: () => void }).__cossack_invalidateCurrentPage?.();
}

/**
 * Create HTTP fetch proxies for @Server methods (client-side only).
 *
 * Two variants:
 * - SSE transport: returns a hybrid object that is BOTH thenable and async-iterable,
 *   so callers can `await proxy()` OR `for await (const x of proxy())`.
 * - HTTP transport: standard async proxy.
 *
 * Both variants support optimistic UI handlers and file uploads.
 */
export function proxyHttpMethods(component: any, serverMethods: ServerMethodBase[]): void {
    const initialState = component.getInitialStateFromWindow();

    // For App component (global component), use appRouteId
    // Check constructor name - App component will have name 'App'
    const isAppComponent = component.constructor.name === 'App';
    const componentRouteId = isAppComponent
        ? initialState?.appRouteId
        : initialState?.componentRouteId;

    if (!componentRouteId) {
        console.error('[Cossack] Cannot create HTTP proxies: componentRouteId not found in initial state.');
        return;
    }

    const scopeKey = initialState?.scopeKey;
    const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', component.constructor) || {};
    const stateKeys = getAllReactiveStateKeys(component.constructor);

    // SSE transport: server methods may be async generators, so the proxy must
    // support both `await` (thenable) and `for await...of` (async iterable).
    const isSse = initialState?.transport === 'sse';

    for (const method of serverMethods) {
        const { name } = method;
        if (isSharedMethod(component.constructor, name)) continue;

        if (isSse) {
            // SSE hybrid proxy — works with both `await` and `for await...of`
            const self = component;
            const sseProxy = (...args: any[]) => {
                // === Optimistic handler (sync) ===
                // Optimistic UI Handler
                runOptimisticHandler(self, name, args, optimisticHandlers[name], stateKeys);

                self.loading[name] = (self.loading[name] || 0) + 1;
                self.requestUpdate();

                // === Shared cleanup ===
                const cleanup = () => {
                    if (self.loading[name] > 0) {
                        self.loading[name]--;
                    }
                    if (!self.loading[name] || self.loading[name] <= 0) {
                        delete self.loading[name];
                        const lockedKeys = self._optimisticLockedKeys[name];
                        if (lockedKeys) {
                            for (const key of lockedKeys) delete self._optimisticPendingState[key];
                            delete self._optimisticLockedKeys[name];
                        }
                    }
                    self.requestUpdate();
                };

                // === File extraction (shared) ===
                const files = new Map<string, File>();
                const processedArgs = args.map(arg => extractFilesFromArg(arg, files));

                 // === Shared apply-state helper ===
                 const applyState = (data: Record<string, any>) => {
                    applyStateToComponent(self, data);
                    self.requestUpdate();
                };

                // === Path A: thenable (for `await proxy()`) ===
                // Makes the fetch, handles both streaming and non-streaming responses.
                const promiseOperation = async (): Promise<any> => {
                    try {
                        if (files.size > 0) {
                            // File upload via XHR — no streaming
                            const formData = new FormData();
                            formData.append('componentRouteId', componentRouteId);
                            if (self._id) formData.append('target', self._id);
                            formData.append('action', name);
                            formData.append('state', JSON.stringify(self.getPublicState()));
                            formData.append('payload', JSON.stringify(processedArgs));
                            files.forEach((file, id) => { formData.append(id, file); });

                            return await new Promise<any>((resolve, reject) => {
                                const xhr = new XMLHttpRequest();
                                xhr.open('POST', '/upload', true);
                                xhr.upload.onprogress = (e) => {
                                    if (e.lengthComputable) {
                                        const percentComplete = (e.loaded / e.total) * 100;
                                        const progressProp = `${name}Progress`;
                                        const progressValue = self.getProperty(progressProp);
                                        if (typeof progressValue === 'number') {
                                            self.setProperty(progressProp, percentComplete);
                                            self.requestUpdate();
                                        }
                                    }
                                };
                                xhr.onload = () => {
                                    if (xhr.status >= 200 && xhr.status < 300) {
                                        try {
                                            const data = JSON.parse(xhr.responseText);
                                            if (data._cossack_redirect) {
                                                window.location.href = data._cossack_redirect;
                                                resolve(undefined);
                                                return;
                                            }
                                            let returnValue;
                                            if ('_cossack_return' in data) {
                                                returnValue = data._cossack_return;
                                                delete data._cossack_return;
                                            }
                                            applyState(data);
                                            resolve(returnValue);
                                        } catch (e) { reject(e); }
                                    } else {
                                        reject(new Error(`HTTP error! status: ${xhr.status}`));
                                    }
                                };
                                xhr.onerror = () => reject(new Error('Network error'));
                                xhr.send(formData);
                            });
                        }

                        const response = await fetch('/crpc', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                componentRouteId,
                                target: self._id,
                                action: name,
                                state: self.getPublicState(),
                                payload: processedArgs,
                                _cossack_stream: true,
                                scopeKey,
                            }),
                        });

                        if (!response.ok) {
                            // The server returns { error: <message> } for thrown
                            // @Server errors — surface that message so form
                            // handlers can display it instead of a generic status.
                            let msg = `HTTP error! status: ${response.status}`;
                            try {
                                const errBody = await response.json() as Record<string, any>;
                                if (errBody?.error) msg = String(errBody.error);
                            } catch { /* body wasn't JSON; keep the status message */ }
                            throw new Error(msg);
                        }

                        const data = await response.json() as Record<string, any>;

                        if (data._cossack_redirect) {
                            window.location.href = data._cossack_redirect;
                            return;
                        }

                        // Apply initial state from response
                        applyState(data);

                        // If server started a stream, wait for it to complete
                        if (data._cossack_stream_id) {
                            // Streaming: don't wait for completion here.
                            // SSE state sync drives the UI — when isStreaming flips
                            // to false via SSE, the client recovers automatically.
                            return undefined;
                        }

                        // Non-streaming return
                        let returnValue;
                        if ('_cossack_return' in data) {
                            returnValue = data._cossack_return;
                        }
                        return returnValue;
                    } catch (error) {
                        console.error(`Error calling server action '${name}':`, error);
                    } finally {
                        cleanup();
                    }
                };

                const promise = promiseOperation();

                // === Path B: async iterator (for `for await...of proxy()`) ===
                // Makes its own fetch so it can consume SSE yield events independently.
                const createStreamIterator = () => {
                    const fetchPromise = fetch('/crpc', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            componentRouteId,
                            target: self._id,
                            action: name,
                            state: self.getPublicState(),
                            payload: processedArgs,
                            _cossack_stream: true,
                            scopeKey,
                        }),
                    });

                    let resolveYield: ((result: IteratorResult<any>) => void) | null = null;
                    // Reject fn for the pending `next()` promise. A `stream-error` SSE
                    // event calls this to surface server-side errors (e.g. a thrown
                    // ClientVisibleError) into the consumer's `for await...of` loop,
                    // instead of silently ending the iterator as a successful completion.
                    let rejectYield: ((reason: any) => void) | null = null;
                    // A stream error that arrived while next() was NOT awaiting is stashed
                    // here and thrown by the next next() call, so the consumer's loop still
                    // sees it regardless of timing.
                    let pendingStreamError: Error | null = null;
                    let streamId: string | null = null;
                    let pendingValues: any[] = [];
                    let streamDone = false;
                    let initComplete = false;

                    const yieldHandler = (event: MessageEvent) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.streamId !== streamId) return;
                            if (!initComplete) return;

                            if (resolveYield) {
                                resolveYield({ value: data.value, done: false });
                                resolveYield = null;
                                rejectYield = null;
                            } else {
                                pendingValues.push(data.value);
                            }
                        } catch (e) {
                            console.error('[Cossack] Error parsing SSE yield event:', e);
                        }
                    };

                    const doneHandler = (event: MessageEvent) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.streamId !== streamId) return;
                            streamDone = true;
                            if (resolveYield) {
                                resolveYield({ value: undefined, done: true });
                                resolveYield = null;
                                rejectYield = null;
                            }
                        } catch (e) {
                            console.error('[Cossack] Error parsing SSE stream-done event:', e);
                        }
                    };

                    const errorEventHandler = (event: MessageEvent) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.streamId !== streamId) return;
                            streamDone = true;
                            // Surface the server-side error to the consumer's
                            // `for await...of` loop by rejecting the pending
                            // next() promise (throws inside the loop, the usual
                            // place to try/catch streaming errors), or stashing
                            // it for the next next() call if none is awaiting.
                            const err = new Error(
                                typeof data.error === 'string' && data.error
                                    ? data.error
                                    : 'Stream error',
                            );
                            if (rejectYield) {
                                rejectYield(err);
                                rejectYield = null;
                                resolveYield = null;
                            } else {
                                pendingStreamError = err;
                            }
                            console.error('[Cossack] Stream error:', data.error);
                        } catch (e) {
                            console.error('[Cossack] Error parsing SSE stream-error event:', e);
                        }
                    };

                    const sse = self._sseConnection;
                    if (sse) {
                        sse.addEventListener('yield', yieldHandler as any);
                        sse.addEventListener('stream-done', doneHandler as any);
                        sse.addEventListener('stream-error', errorEventHandler as any);
                    }

                    const iterator: AsyncIterator<any> & { [Symbol.asyncIterator](): AsyncIterator<any> } = {
                        async next() {
                            // A stream-error that arrived while next() wasn't awaiting
                            // is stashed; throw it now so the consumer's for-await loop
                            // sees it instead of completing silently.
                            if (pendingStreamError) {
                                const e = pendingStreamError;
                                pendingStreamError = null;
                                throw e;
                            }
                            if (!initComplete) {
                                const response = await fetchPromise;
                                if (!response.ok) {
                                    let msg = `HTTP error! status: ${response.status}`;
                                    try {
                                        const errBody = await response.json() as Record<string, any>;
                                        if (errBody?.error) msg = String(errBody.error);
                                    } catch { /* not JSON */ }
                                    throw new Error(msg);
                                }
                                const data = await response.json() as Record<string, any>;

                                if (data._cossack_redirect) {
                                    window.location.href = data._cossack_redirect;
                                    return { value: undefined, done: true };
                                }

                                streamId = data._cossack_stream_id;
                                initComplete = true;

                                // Apply initial state from the response
                                applyState(data);

                                // Check if there are already queued values
                                if (pendingValues.length > 0) {
                                    return { value: pendingValues.shift(), done: false };
                                }

                                // Stream may already be done (fast completion)
                                if (streamDone) {
                                    return { value: undefined, done: true };
                                }

                                // If server didn't start a stream, this is a non-streaming method
                                // called with for-await-of. Yield the return value once, then done.
                                if (!data._cossack_stream_id) {
                                    let returnValue;
                                    if ('_cossack_return' in data) {
                                        returnValue = data._cossack_return;
                                    }
                                    if (returnValue !== undefined) {
                                        return { value: returnValue, done: false };
                                    }
                                    return { value: undefined, done: true };
                                }
                            }

                            if (streamDone && pendingValues.length === 0) {
                                return { value: undefined, done: true };
                            }

                            if (pendingValues.length > 0) {
                                return { value: pendingValues.shift(), done: false };
                            }

                            // Wait for next SSE event. Capture both resolve and
                            // reject so a `stream-error` event can reject (throw
                            // into the consumer's for-await loop) rather than
                            // resolve-as-done (silent success).
                            return new Promise<IteratorResult<any>>((resolve, reject) => {
                                resolveYield = resolve;
                                rejectYield = reject;
                            });
                        },

                        return() {
                            const sse = self._sseConnection;
                            if (sse) {
                                sse.removeEventListener('yield', yieldHandler as any);
                                sse.removeEventListener('stream-done', doneHandler as any);
                                sse.removeEventListener('stream-error', errorEventHandler as any);
                            }
                            return Promise.resolve({ value: undefined, done: true });
                        },

                        [Symbol.asyncIterator]() { return this; },
                    };

                    return iterator;
                };

                // === Return hybrid object ===
                return {
                    then(onFulfilled: any, onRejected: any) {
                        return promise.then(onFulfilled, onRejected);
                    },
                    catch(onRejected: any) {
                        return promise.catch(onRejected);
                    },
                    [Symbol.asyncIterator]() {
                        return createStreamIterator();
                    },
                };
            };

            component.__cossack_proxies.set(name, sseProxy);
            component.setProperty(name, sseProxy);
            continue;
        }

        // HTTP transport: standard async proxy
        const proxy = async (...args: any[]) => {
            invalidateCurrentClientPage();
            // Optimistic UI Handler
            runOptimisticHandler(component, name, args, optimisticHandlers[name], stateKeys);

            component.loading[name] = (component.loading[name] || 0) + 1;
            component.requestUpdate();

            try {
                // Check for files in arguments
                const files = new Map<string, File>();

                const processedArgs = args.map(arg => extractFilesFromArg(arg, files));

                if (files.size > 0) {
                    const formData = new FormData();
                    formData.append('componentRouteId', componentRouteId);
                    if (component._id) formData.append('target', component._id);
                    formData.append('action', name);
                    formData.append('state', JSON.stringify(component.getPublicState()));
                    formData.append('payload', JSON.stringify(processedArgs));

                    files.forEach((file, id) => {
                        formData.append(id, file);
                    });

                    return await new Promise<any>((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('POST', '/upload', true);

                        // Upload Progress
                        xhr.upload.onprogress = (e) => {
                            if (e.lengthComputable) {
                                const percentComplete = (e.loaded / e.total) * 100;
                                const progressProp = `${name}Progress`;
                                const progressValue = component.getProperty(progressProp);
                                if (typeof progressValue === 'number') {
                                    component.setProperty(progressProp, percentComplete);
                                    component.requestUpdate();
                                }
                            }
                        };

                        xhr.onload = () => {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                try {
                                    const data = JSON.parse(xhr.responseText);
                                    if (data._cossack_redirect) {
                                        window.location.href = data._cossack_redirect;
                                        resolve(undefined);
                                        return;
                                    }

                                    let returnValue;
                                    if ('_cossack_return' in data) {
                                        returnValue = data._cossack_return;
                                        delete data._cossack_return;
                                    }

                                    applyStateToComponent(component, data);
                                    resolve(returnValue);
                                } catch (e) {
                                    reject(e);
                                }
                            } else {
                                reject(new Error(`HTTP error! status: ${xhr.status}`));
                            }
                        };

                        xhr.onerror = () => reject(new Error('Network error'));
                        xhr.send(formData);
                    });

                } else {
                    const response = await fetch('/crpc', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            componentRouteId,
                            target: component._id,
                            action: name,
                            state: component.getPublicState(),
                            payload: processedArgs,
                            scopeKey,
                        }),
                    });

                    if (!response.ok) {
                        let msg = `HTTP error! status: ${response.status}`;
                        try {
                            const errBody = await response.json() as Record<string, any>;
                            if (errBody?.error) msg = String(errBody.error);
                        } catch { /* not JSON */ }
                        throw new Error(msg);
                    }

                    const data = await response.json() as Record<string, any>;

                    if (data._cossack_redirect) {
                        window.location.href = data._cossack_redirect;
                        return;
                    }

                    let returnValue;
                    if ('_cossack_return' in data) {
                        returnValue = data._cossack_return;
                        delete data._cossack_return;
                    }

                    applyStateToComponent(component, data);
                    return returnValue;
                }
            } catch (error) {
                console.error(`Error calling server action '${name}':`, error);
            } finally {
                // Decrement loading counter (don't wipe — other calls may be pending)
                if (component.loading[name] > 0) {
                    component.loading[name]--;
                }
                if (!component.loading[name] || component.loading[name] <= 0) {
                    delete component.loading[name];
                    // Release the lock and discard stale buffered state.
                    // The HTTP response already contains the final server state
                    // (processed above in the try block), so no flush is needed.
                    const lockedKeys = component._optimisticLockedKeys[name];
                    if (lockedKeys) {
                        for (const key of lockedKeys) {
                            delete component._optimisticPendingState[key];
                        }
                        delete component._optimisticLockedKeys[name];
                    }
                }
                component.requestUpdate();
            }
        };

        // Store proxy in the map so stubbed methods can find it
        component.__cossack_proxies.set(name, proxy);

        // Set the method on the instance
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
            invalidateCurrentClientPage();
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
