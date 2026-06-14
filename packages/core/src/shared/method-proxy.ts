// src/shared/method-proxy.ts
import type { PageOptions } from './decorators';
import { RootContext } from './cossack';

interface ServerMethodBase {
    name: string;
}
interface ServerMethodWs extends ServerMethodBase {
    channel: string;
    provider: string;
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
    const stateKeys = Object.keys(Reflect.getMetadata('cossack:state', component.constructor) || {});

    // SSE transport: server methods may be async generators, so the proxy must
    // support both `await` (thenable) and `for await...of` (async iterable).
    const isSse = initialState?.transport === 'sse';

    for (const method of serverMethods) {
        const { name } = method;

        if (isSse) {
            // SSE hybrid proxy — works with both `await` and `for await...of`
            const self = component;
            const sseProxy = (...args: any[]) => {
                // === Optimistic handler (sync) ===
                if (optimisticHandlers[name] && self.hasMethod(optimisticHandlers[name])) {
                    try {
                        const optimisticMethod = self.getMethod(optimisticHandlers[name]);
                        const snapshot: Record<string, any> = {};
                        for (const key of stateKeys) {
                            snapshot[key] = (self as any)[key];
                        }
                        (optimisticMethod as any)(...args);
                        if (!self._optimisticLockedKeys[name]) {
                            self._optimisticLockedKeys[name] = new Set();
                        }
                        for (const key of stateKeys) {
                            if ((self as any)[key] !== snapshot[key]) {
                                self._optimisticLockedKeys[name].add(key);
                            }
                        }
                        self.requestUpdate();
                    } catch (e) {
                        console.error(`Error in optimistic handler for '${name}':`, e);
                    }
                }

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
                const extractFiles = (arg: any): any => {
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
                        return Array.from(arg).map(file => extractFiles(file));
                    }
                    if (Array.isArray(arg)) {
                        return arg.map(item => extractFiles(item));
                    }
                    if (arg && typeof arg === 'object' && arg !== null) {
                        const newObj: any = {};
                        for (const key in arg) {
                            newObj[key] = extractFiles(arg[key]);
                        }
                        return newObj;
                    }
                    return arg;
                };
                const processedArgs = args.map(arg => extractFiles(arg));

                // === Shared apply-state helper ===
                const applyState = (data: Record<string, any>) => {
                    for (const key in data) {
                        if (key.startsWith('_cossack_')) continue;
                        if (key === 'loading' || key === 'isServer' || key === 'params') continue;
                        if (self._isOptimisticLocked(key)) {
                            self._optimisticPendingState[key] = data[key];
                        } else {
                            self.setProperty(key, data[key]);
                        }
                    }
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
                            throw new Error(`HTTP error! status: ${response.status}`);
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
                            if (resolveYield) {
                                resolveYield({ value: undefined, done: true });
                                resolveYield = null;
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
                            if (!initComplete) {
                                const response = await fetchPromise;
                                if (!response.ok) {
                                    throw new Error(`HTTP error! status: ${response.status}`);
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

                            // Wait for next SSE event
                            return new Promise<IteratorResult<any>>((resolve) => {
                                resolveYield = resolve;
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
            // Optimistic UI Handler
            if (optimisticHandlers[name] && component.hasMethod(optimisticHandlers[name])) {
                try {
                    const optimisticMethod = component.getMethod(optimisticHandlers[name]);

                    // Auto-detect: snapshot @State values before handler
                    const snapshot: Record<string, any> = {};
                    for (const key of stateKeys) {
                        snapshot[key] = (component as any)[key];
                    }

                    (optimisticMethod as any)(...args);

                    // Auto-detect: find which @State keys changed
                    if (!component._optimisticLockedKeys[name]) {
                        component._optimisticLockedKeys[name] = new Set();
                    }
                    for (const key of stateKeys) {
                        if ((component as any)[key] !== snapshot[key]) {
                            component._optimisticLockedKeys[name].add(key);
                        }
                    }

                    component.requestUpdate();
                } catch (e) {
                    console.error(`Error in optimistic handler for '${name}':`, e);
                }
            }

            component.loading[name] = (component.loading[name] || 0) + 1;
            component.requestUpdate();

            try {
                // Check for files in arguments
                const files = new Map<string, File>();

                const extractFiles = (arg: any): any => {
                    // Skip recursion for DOM nodes, Events, Window, etc.
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
                         return Array.from(arg).map(file => extractFiles(file));
                    }
                    if (Array.isArray(arg)) {
                        return arg.map(item => extractFiles(item));
                    }
                    if (arg && typeof arg === 'object' && arg !== null) {
                        const newObj: any = {};
                        for (const key in arg) {
                            newObj[key] = extractFiles(arg[key]);
                        }
                        return newObj;
                    }
                    return arg;
                };

                const processedArgs = args.map(arg => extractFiles(arg));

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

                                    for (const key in data) {
                                        if (key === 'loading' || key === 'isServer' || key === 'params') continue;
                                        if (component._isOptimisticLocked(key)) {
                                            component._optimisticPendingState[key] = data[key];
                                        } else {
                                            component.setProperty(key, data[key]);
                                        }
                                    }
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
                        throw new Error(`HTTP error! status: ${response.status}`);
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

                    for (const key in data) {
                        if (key === 'loading' || key === 'isServer' || key === 'params') continue;
                        if (component._isOptimisticLocked(key)) {
                            component._optimisticPendingState[key] = data[key];
                        } else {
                            component.setProperty(key, data[key]);
                        }
                    }
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
    const stateKeys = Object.keys(Reflect.getMetadata('cossack:state', component.constructor) || {});

    for (const method of serverMethods) {
        const { name, channel, provider } = method;
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
                if (optimisticHandlers[name] && component.hasMethod(optimisticHandlers[name])) {
                    try {
                        const optimisticMethod = component.getMethod(optimisticHandlers[name]);

                        // Auto-detect: snapshot @State values before handler
                        const snapshot: Record<string, any> = {};
                        for (const key of stateKeys) {
                            snapshot[key] = (component as any)[key];
                        }

                        (optimisticMethod as any)(...args);

                        // Auto-detect: find which @State keys changed
                        if (!component._optimisticLockedKeys[name]) {
                            component._optimisticLockedKeys[name] = new Set();
                        }
                        for (const key of stateKeys) {
                            if ((component as any)[key] !== snapshot[key]) {
                                component._optimisticLockedKeys[name].add(key);
                            }
                        }

                        component.requestUpdate(); // Render immediately after optimistic update
                    } catch (e) {
                        console.error(`Error in optimistic handler for '${name}':`, e);
                    }
                }

                component.loading[name] = (component.loading[name] || 0) + 1;
                component.requestUpdate();

                // Filter out Event objects and DOM nodes, keep only serializable values
                const payload = args.filter(arg => {
                    const type = typeof arg;
                    // Keep primitives (string, number, boolean, undefined)
                    if (type !== 'object') return true;
                    // Filter out null, objects (including Events, DOM nodes, etc.)
                    return false;
                });
                ws.send(JSON.stringify({
                    type: 'action',
                    action: name,
                    payload: payload,
                    channel: channel,
                    target: component._id,
                }));
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
    const serverMethods = Object.entries(serverMethodsMetadata).map(([name, options]: [string, any]) => ({
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
    taskMethods.forEach((method: string) => clientSafeMethods.add(method));

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

    // Scan for methods without decorators (server-only by default)
    const proto = Object.getPrototypeOf(component);
    const propertyNames = Object.getOwnPropertyNames(proto);

    const builtInMethods = new Set([
        'constructor', 'render', 'head', 'onMount', 'onCleanup', 'escapeHtml',
        'loadingTemplate', 'toString', 'valueOf', 'getProperty', 'setProperty',
        'hasMethod', 'getMethod', 'getInitialState', 'getPublicState',
        'registerComponent', 'setCurrentPage', 'bootstrap', 'destroy',
        'initializeState', 'initializeProviders', 'connectWebSocket', 'connectSSE',
        'proxyHttpMethods', 'proxyServerMethods', 'proxyClientMethods',
        'updateHead', 'applyHeadTags', 'buildHeadContext', 'mergeHead',
        'updatePath', 'isActive', 'executeAction', 'broadcastEvent',
        'redirect', 'requestUpdate', 'validateChannels', 'willUpdate',
        'connectedCallback', 'disconnectedCallback', 'shouldUpdate',
        'performUpdate', 'updated', '_render', 'getInitialHtml',
        '_getWrappedTemplate', 'autoBindMethods', 'setupEventListeners',
        'setupVisibleTasks', 'runTasks', 'consume', 'provide',
        '_transitionToPhase', '_restorePhase', 'isInPhase', 'isInAnyPhase',
        'getPhase', 'getParentComponent', 'getElementInternal',
        'getInitialStateFromWindow', '_scheduleStateBroadcast',
        '_wrapLifecycleMethods', '_setupServerMethodProxies',
        'confirmNavigation', '_checkPreventNavigation',
        'clientInit', // Client-only initialization method
        'onNavigateComplete',
    ]);

    for (const name of propertyNames) {
        if (builtInMethods.has(name)) continue;
        if (clientSafeMethods.has(name)) continue;
        if (name.startsWith('_')) continue; // Skip private properties

        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor && typeof descriptor.value === 'function') {
            // Check if this method is already in the server methods list
            if (!serverMethods.some((m: ServerMethodWs) => m.name === name)) {
                serverMethods.push({
                    name,
                    channel: 'global',
                    provider: 'page',
                });
            }
        }
    }

    const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', component.constructor);

    if (pageOptions?.transport === 'http' || pageOptions?.transport === 'sse') {
        component.proxyHttpMethods(serverMethods);
    } else {
        component.proxyServerMethods(serverMethods);
    }
    component._serverMethodsProxied = true;
}
