// src/shared/cossack.ts
import { renderToString, html, TemplateResult, CossackElement, isTemplateResult } from '@cossackframework/renderer';
import { isServer } from './environment';
import { Client, PageOptions, Server, State, ClientState, VisibleTaskOptions } from './decorators';
import type { Context } from 'hono';
import type { CossackServerRuntime } from './runtime';
import { PageStateProvider, StateProvider } from './StateProvider';
import { HeadTag, HeadContext, HeadValue } from './head';
import { createCossackContext, HydratedContext } from './context';

export interface CossackOptions {
  Channels?: string;
}

import type { AuthenticatedUser } from './user';
import { RedirectStatusCode } from 'hono/utils/http-status';

export abstract class Cossack<Env = any, T extends CossackOptions = {}> extends CossackElement {
    // Standard Properties
    protected container?: Element;
    protected isServer: boolean = isServer;
    
    protected c!: Context;
    protected user?: AuthenticatedUser;
    protected env!: Env;
    protected providers!: Map<string, StateProvider>;
    public props: Record<string, any> = {};

    @ClientState()
    private _cossack_path: string = '';

    @Server()
    private _cossack_provider_name?: string;

    @Server()
    private _cossack_ws_context?: unknown;

    @Client()
    private websockets: Map<string, WebSocket> = new Map();

    public loading: Record<string, number> = {};

    @Server()
    private _runtime?: CossackServerRuntime;

    private dirtyProperties: Set<string> = new Set();
    private broadcastScheduled: boolean = false;
    private isMounted: boolean = false;
    private skipRenderTasks: boolean = false;
    private isRunningTasks: boolean = false;
    private isBootstrapping: boolean = false;
    private eventCleanupFns: (() => void)[] = [];

    // Navigation blocking state
    public _pendingNavigation: (() => void) | null = null;

    // DevTools Metadata (Injected by Vite plugin)
    public static __source?: { file: string };

    constructor() {
        super();
        this.autoBindMethods();
    }

    connectedCallback() {
        this.initializeState();
        super.connectedCallback();
    }

    willUpdate(changedProperties: Map<string | number | symbol, unknown>) {
        this.initializeState();
        super.willUpdate(changedProperties);
    }

    public static buildHeadContext(tags: HeadTag[]): HeadContext {
        const context: HeadContext = {
            title: '',
            description: '',
            image: '',
            meta: [],
            links: [],
            scripts: [],
            tags: []
        };

        for (const tag of tags) {
            switch (tag.tag) {
                case 'title':
                    context.title = tag.children || '';
                    break;
                case 'meta':
                    const name = tag.attributes?.name || tag.attributes?.property;
                    if (name === 'description' || name === 'og:description') {
                        context.description = String(tag.attributes?.content || '');
                    } else if (name === 'og:image' || name === 'twitter:image') {
                        context.image = String(tag.attributes?.content || '');
                    }
                    context.meta.push(tag);
                    break;
                case 'link':
                    context.links.push(tag);
                    break;
                case 'script':
                    context.scripts.push(tag);
                    break;
                default:
                    context.tags.push(tag);
                    break;
            }
        }

        return context;
    }

    public static mergeHead(context: HeadContext, value: HeadValue): HeadTag[] {
        const title = value.title ?? context.title;
        const description = value.description ?? context.description;
        const image = value.image ?? context.image;
        
        let meta = value.meta ?? context.meta;
        const links = value.links ?? context.links;
        const scripts = value.scripts ?? context.scripts;
        const tags = value.tags ?? context.tags;

        const result: HeadTag[] = [];
        if (title) result.push({ tag: 'title', children: title });
        
        // Auto-expand SEO shortcuts
        if (description) {
            result.push({ tag: 'meta', attributes: { name: 'description', content: description } });
            result.push({ tag: 'meta', attributes: { property: 'og:description', content: description } });
        }
        if (image) {
            result.push({ tag: 'meta', attributes: { property: 'og:image', content: image } });
            result.push({ tag: 'meta', attributes: { name: 'twitter:image', content: image } });
        }

        result.push(...meta);
        result.push(...links);
        result.push(...scripts);
        result.push(...tags);
        return result;
    }

    public static applyHeadTags(tags: HeadTag[]) {
        const headElement = document.head;

        // Clear existing managed tags
        headElement.querySelectorAll('[data-cossack]').forEach(el => el.remove());

        for (const tag of tags) {
            const el = document.createElement(tag.tag);
            el.setAttribute('data-cossack', '');
            if (tag.attributes) {
                for (const [key, value] of Object.entries(tag.attributes)) {
                    el.setAttribute(key, String(value));
                }
            }
            if (tag.children) {
                if (tag.tag === 'title') {
                    document.title = tag.children;
                } else {
                    el.textContent = tag.children;
                }
            }
            headElement.appendChild(el);
        }
    }

    private autoBindMethods() {
        const proto = Object.getPrototypeOf(this);
        const propertyNames = Object.getOwnPropertyNames(proto);
        for (const name of propertyNames) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, name);
            if (descriptor && typeof descriptor.value === 'function' && name !== 'constructor') {
                (this as any)[name] = descriptor.value.bind(this);
            }
        }
    }

    public async bootstrap({ container, initialState, context, user, env, page, providerName, skipInit }: { container?: Element | string, initialState?: any, context?: Context | HydratedContext, user?: AuthenticatedUser, env?: any, page?: string, providerName?: string, skipInit?: boolean } = {}) {
        this.isBootstrapping = true;
        if (typeof container === 'string') {
            this.container = document.querySelector(container) || undefined;
        } else {
            this.container = container;
        }
        
        this.user = user;
        this.props = { page };

        this._wrapLifecycleMethods();

        if (this.isServer) {
            if (!context) {
                throw new Error('[Cossack] Context must be provided during bootstrap on the server.');
            }
            this.c = createCossackContext(context, true);
            this.env = env;
            this._cossack_provider_name = providerName;
            this.initializeProviders();
        } else {
            const clientInitialState = initialState || (window as any).__INITIAL_STATE__;
            this.user = clientInitialState?.user;
            const clientParams = clientInitialState?.params || {};
            this._cossack_path = clientInitialState?.pathname || window.location.pathname;

            const hydratedContext: HydratedContext = {
                req: {
                    param: (key?: string) => key ? clientParams[key] : clientParams,
                    get path() { return (this as any)._component._cossack_path; },
                    query: (key?: string) => {
                         const url = new URL(window.location.href);
                         if (key) return url.searchParams.get(key);
                         const params: Record<string, string> = {};
                         url.searchParams.forEach((value, k) => {
                             params[k] = value;
                         });
                         return params;
                    }
                }
            };
            // Link the hydrated context to this component instance
            (hydratedContext.req as any)._component = this;

            this.c = createCossackContext(hydratedContext, false);
        }

        this.initializeState(initialState);

        // Run tasks after state initialization
        await this.runTasks();

        if (this.isServer) {
            this.proxyClientMethods();
        } else {
            const clientInitialState = initialState || (window as any).__INITIAL_STATE__;
            const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', this.constructor);

            if (pageOptions?.transport === 'http') {
                this.proxyHttpMethods(clientInitialState?.serverMethods || []);
            } else {
                this.connectWebSocket();
                this.proxyServerMethods(clientInitialState?.serverMethods || []);
            }
        }

        // Perform initialization (wrapped hooks)
        await this.get();
        if (!skipInit) {
            await this.init();
        }

        this.isBootstrapping = false;

        if (this.container && !this.isServer) {
            this.skipRenderTasks = true;
            this.mount(this.container as HTMLElement);
            this.skipRenderTasks = false;
            
            if (!this.isMounted) {
                this.isMounted = true;
                this.onMount();
            }
        }
    }

    private _wrapLifecycleMethods() {
        const wrap = (methodName: 'init' | 'get') => {
            const original = (this as any)[methodName];
            if (typeof original !== 'function') return;
            if (original.__cossack_wrapped) return;

            const wrapped = async (...args: any[]) => {
                this.loading.init = (this.loading.init || 0) + 1;
                if (!this.isServer && this.container) {
                    this.requestUpdate();
                }
                try {
                    return await original.apply(this, args);
                } finally {
                    this.loading.init--;
                    if (this.loading.init <= 0) delete this.loading.init;
                    if (!this.isServer && this.container) {
                        this.requestUpdate();
                    }
                }
            };
            wrapped.__cossack_wrapped = true;
            (this as any)[methodName] = wrapped;
        };

        wrap('init');
        wrap('get');
    }

    @Client()
    public updatePath(path: string) {
        this._cossack_path = path;
    }

    public isActive(path: string, exact: boolean = true): boolean {
        const current = this.c.req.path;
        if (exact) {
            return current === path;
        }
        return current.startsWith(path);
    }

    public async executeAction(action: string, payload: any[], user: any, clientContext: unknown) {
        if (typeof (this as any)[action] === 'function') {
            this._cossack_ws_context = clientContext;
            try {
                await (this as any)[action](...(payload || []), user);
            } finally {
                this._cossack_ws_context = undefined;
                const ws = clientContext as WebSocket;
                if (ws.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify({ type: 'action-complete', action }));
                }
            }
        }
    }

    @Server()
    private initializeProviders() {
        if (!this.isServer) return;

        this.providers = new Map<string, StateProvider>();
        const pageOptions = Reflect.getMetadata('page:options', this.constructor) || {};
        let componentProviders = pageOptions.providers || {};

        if (Object.keys(componentProviders).length === 0) {
            componentProviders = { page: new PageStateProvider() };
        } else if (!componentProviders.page) {
            componentProviders.page = new PageStateProvider();
        }

        for (const [name, provider] of Object.entries(componentProviders)) {
            (provider as StateProvider).setContext(this, this.env);
            this.providers.set(name, provider as StateProvider);
        }
    }

    @Client()
    private connectWebSocket() {
        const initialState = (window as any).__INITIAL_STATE__;
        const providerTargets = initialState?.providerTargets || {};

        for (const providerName in providerTargets) {
            const target = providerTargets[providerName];
            
            const componentId = initialState?.componentId;
            if (!componentId) {
                console.error('[Cossack] Cannot connect WebSocket: componentId not found in initial state.');
                continue;
            }
            
            const pathname = initialState?.pathname;
            const params = new URLSearchParams({
                componentId,
                pathname: pathname || '',
                ...initialState?.params,
            }).toString();

            const wsUrl = `/ws/${providerName}/${target}?${params}`;
            const fullWsUrl = `ws://${window.location.host}${wsUrl}`;
            const ws = new WebSocket(fullWsUrl);
            this.websockets.set(providerName, ws);

            ws.onmessage = (event) => {
                if (event.data === 'pong') {
                    return; // Server heartbeat response, ignore.
                }
                const data = JSON.parse(event.data);
                if (data.type === 'state-update') {
                    for (const key in data.state) {
                        if (key === 'loading' || key === 'isServer' || key === 'params') continue;
                        (this as any)[key] = data.state[key];
                    }
                } else if (data.type === 'action-complete') {
                    const { action } = data;
                    if (this.loading[action]) {
                        this.loading[action]--;
                        if (this.loading[action] <= 0) {
                            delete this.loading[action];
                        }
                    }
                    this.requestUpdate();
                } else if (data.type === 'client-action') {
                    const { action, payload } = data;
                    const clientMethods = Reflect.getMetadata('cossack:client-methods', this.constructor) || {};
                    if (clientMethods[action] && typeof (this as any)[action] === 'function') {
                        (this as any)[action](...payload);
                    }
                } else if (data.type === 'event') {
                    const { eventName, payload } = data;
                    const eventHandlers = Reflect.getMetadata('cossack:event-handlers', this.constructor) || {};
                    if (eventHandlers[eventName]) {
                        for (const handlerMethod of eventHandlers[eventName]) {
                            if (typeof (this as any)[handlerMethod] === 'function') {
                                (this as any)[handlerMethod](...payload);
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

    @Client()
    private proxyHttpMethods(serverMethods: { name: string }[]) {
        const componentRouteId = (window as any).__INITIAL_STATE__?.componentRouteId;
        if (!componentRouteId) {
            console.error('[Cossack] Cannot create HTTP proxies: componentRouteId not found in initial state.');
            return;
        }

        const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', this.constructor) || {};

        for (const method of serverMethods) {
            const { name } = method;
            (this as any)[name] = async (...args: any[]) => {
                
                // Optimistic UI Handler
                if (optimisticHandlers[name] && typeof (this as any)[optimisticHandlers[name]] === 'function') {
                    try {
                        (this as any)[optimisticHandlers[name]](...args);
                        this.requestUpdate(); 
                    } catch (e) {
                        console.error(`Error in optimistic handler for '${name}':`, e);
                    }
                }

                this.loading[name] = (this.loading[name] || 0) + 1;
                this.requestUpdate();

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
                        formData.append('action', name);
                        formData.append('state', JSON.stringify(this.getPublicState()));
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
                                    if (typeof (this as any)[progressProp] === 'number') {
                                        (this as any)[progressProp] = percentComplete;
                                        this.requestUpdate();
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
                                            (this as any)[key] = data[key];
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
                                action: name,
                                state: this.getPublicState(),
                                payload: processedArgs, // Note: We use processedArgs for JSON RPC
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
                            (this as any)[key] = data[key];
                        }
                        return returnValue;
                    }
                } catch (error) {
                    console.error(`Error calling server action '${name}':`, error);
                } finally {
                    delete this.loading[name];
                    this.requestUpdate();
                }
            };
        }
    }

    @Client()
    private proxyServerMethods(serverMethods: { name: string, channel: string, provider: string }[]) {
        const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', this.constructor) || {};

        for (const method of serverMethods) {
            const { name, channel, provider } = method;
            (this as any)[name] = (...args: any[]) => {
                const ws = this.websockets.get(provider);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    
                    // Optimistic UI Handler
                    if (optimisticHandlers[name] && typeof (this as any)[optimisticHandlers[name]] === 'function') {
                        try {
                            (this as any)[optimisticHandlers[name]](...args);
                            this.requestUpdate(); // Render immediately after optimistic update
                        } catch (e) {
                            console.error(`Error in optimistic handler for '${name}':`, e);
                        }
                    }

                    this.loading[name] = (this.loading[name] || 0) + 1;
                    this.requestUpdate();
                    
                    const payload = args.filter(arg => typeof arg !== 'object' || arg === null);
                    ws.send(JSON.stringify({
                        type: 'action',
                        action: name,
                        payload: payload,
                        channel: channel,
                    }));
                } else {
                    console.error(`WebSocket for provider '${provider}' not connected. Cannot call server method '${name}'.`);
                }
            };
        }
    }

    private async runTasks() {
        if (this.isRunningTasks) return;
        this.isRunningTasks = true;
        try {
            const tasks = Reflect.getMetadata('cossack:tasks', this.constructor) || [];
            for (const task of tasks) {
                if (typeof (this as any)[task] === 'function') {
                    try {
                        const result = (this as any)[task]();
                        if (result instanceof Promise) {
                            await result;
                        }
                    } catch (e) {
                        console.error(`[Cossack] Error in task '${String(task)}':`, e);
                    }
                }
            }
        } finally {
            this.isRunningTasks = false;
        }
    }

    private setupEventListeners() {
        if (this.isServer) return;

        // Helper to attach and track events
        const attach = (target: EventTarget, eventName: string, method: Function) => {
            const handler = method.bind(this);
            target.addEventListener(eventName, handler);
            this.eventCleanupFns.push(() => target.removeEventListener(eventName, handler));
        };

        // 1. @On (Component/Container Events)
        if (this.container) {
            const domEvents = Reflect.getMetadata('cossack:dom-events', this.constructor) || [];
            for (const { eventName, propertyKey } of domEvents) {
                if (typeof (this as any)[propertyKey] === 'function') {
                    attach(this.container, eventName, (this as any)[propertyKey]);
                }
            }
        }

        // 2. @OnDocument
        if (typeof document !== 'undefined') {
            const documentEvents = Reflect.getMetadata('cossack:document-events', this.constructor) || [];
            for (const { eventName, propertyKey } of documentEvents) {
                if (typeof (this as any)[propertyKey] === 'function') {
                    attach(document, eventName, (this as any)[propertyKey]);
                }
            }
        }

        // 3. @OnWindow
        if (typeof window !== 'undefined') {
            const windowEvents = Reflect.getMetadata('cossack:window-events', this.constructor) || [];
            for (const { eventName, propertyKey } of windowEvents) {
                if (typeof (this as any)[propertyKey] === 'function') {
                    attach(window, eventName, (this as any)[propertyKey]);
                }
            }
        }
    }

    private setupVisibleTasks() {
        if (this.isServer) return;

        const visibleTasks = Reflect.getMetadata('cossack:visible-tasks', this.constructor) || [];
        for (const { propertyKey, options } of visibleTasks) {
            const strategy = options.strategy || 'intersection-observer';
            
            if (typeof (this as any)[propertyKey] !== 'function') continue;

            const execute = () => {
                 try {
                     const cleanup = (this as any)[propertyKey]();
                     // TODO: Handle cleanup if needed, possibly store it in a map to call on component destroy
                 } catch (e) {
                     console.error(`[Cossack] Error in visible task '${String(propertyKey)}':`, e);
                 }
            };

            if (strategy === 'document-ready') {
                execute();
            } else if (strategy === 'intersection-observer') {
                if (!this.container) {
                     console.warn(`[Cossack] Cannot setup intersection observer for '${String(propertyKey)}': container not found.`);
                     continue;
                }

                let targetElement: Element | null = this.container;
                if (options.selector) {
                    targetElement = this.container.querySelector(options.selector);
                    if (!targetElement) {
                        console.warn(`[Cossack] VisibleTask '${String(propertyKey)}' specifies selector '${options.selector}', but element was not found in the component container.`);
                        continue;
                    }
                }

                const observer = new IntersectionObserver((entries) => {
                    if (entries[0].isIntersecting) {
                        execute();
                        observer.disconnect(); // Run once
                    }
                }, { threshold: options.threshold || 0 });
                
                observer.observe(targetElement);
            }
        }
    }

    private isStateInitialized = false;

    private initializeState(initialState?: any) {
        if (this.isStateInitialized && !initialState) return;
        this.isStateInitialized = true;

        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        const clientStateProperties = Reflect.getMetadata('cossack:client-state', this.constructor) || new Set();
        
        const stateKeys = Object.keys(stateProperties);
        const clientKeys = Array.from(clientStateProperties) as string[];
        const allKeys = [...new Set([...stateKeys, ...clientKeys])];
        
        const privateState = new Map<string, any>();

        const stateSource = this.isServer 
            ? initialState 
            : (initialState || (window as any)?.__INITIAL_STATE__ || {});

        for (const key of allKeys) {
            let value = (this as any)[key];

            // Only sync properties that are NOT client-only
            if (!clientStateProperties.has(key) && stateSource && stateSource[key] !== undefined) {
                value = stateSource[key];
            }
            
            privateState.set(key, value);

            Object.defineProperty(this, key, {
                get: () => privateState.get(key),
                set: (newValue: any) => {
                    const oldValue = privateState.get(key);
                    if (oldValue !== newValue) {
                        privateState.set(key, newValue);
                        
                        // Sync logic for server-connected state
                        if (stateProperties[key]) {
                            if (this.isServer) {
                                this.dirtyProperties.add(key);
                                if (!this.broadcastScheduled) {
                                    this.broadcastScheduled = true;
                                    queueMicrotask(async () => {
                                        await this.runTasks();
                                        const partialState: Record<string, any> = {};
                                        for (const key of this.dirtyProperties) {
                                            partialState[key] = (this as any)[key];
                                        }
                                        
                                        this._runtime?.broadcastState(partialState);
                                        this._runtime?.persistState();
                                        this.dirtyProperties.clear();
                                        this.broadcastScheduled = false;
                                    });
                                }
                            } else if (!this.isBootstrapping) {
                                this.requestUpdate(key, oldValue);
                            }
                        } else if (clientStateProperties.has(key)) {
                            // Client-only state just triggers a render on the client
                            if (!this.isServer && !this.isBootstrapping) {
                                this.requestUpdate(key, oldValue);
                            }
                        }
                    }
                },
                enumerable: true,
                configurable: true,
            });
        }
    }

    @Server()
    private proxyClientMethods() {
        const clientMethods = Reflect.getMetadata('cossack:client-methods', this.constructor) || {};
        for (const key in clientMethods) {
            if (typeof (this as any)[key] !== 'function') continue;

            (this as any)[key] = (...args: any[]) => {
                if (!this.isServer) {
                    console.warn(`[Cossack] Client method '${String(key)}' cannot be called from the client.`);
                    return;
                }
                if (!this._cossack_ws_context) {
                    console.warn(`[Cossack] Client method '${String(key)}' was called from a non-WebSocket context and could not be sent.`);
                    return;
                }
                this._runtime?.sendClientAction(this._cossack_ws_context, key, args);
            };
        }
    }

    @Server()
    private validateChannels() {
        const pageOptions = Reflect.getMetadata('page:options', this.constructor);
        const definedChannels = new Set(pageOptions?.channels || ['global']);
        if (!definedChannels.has('global')) {
            definedChannels.add('global');
        }

        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        for (const prop in stateProperties) {
            const channel = stateProperties[prop].channel || 'global';
            if (!definedChannels.has(channel)) {
                throw new Error(`[Cossack] State property '${prop}' uses channel '${channel}', which is not defined in the @Page decorator for ${this.constructor.name}.`);
            }
        }

        const serverMethods = Reflect.getMetadata('cossack:server-methods', this.constructor) || {};
        for (const method in serverMethods) {
            const channel = serverMethods[method].channel || 'global';
            if (!definedChannels.has(channel)) {
                throw new Error(`[Cossack] Server method '${method}' uses channel '${channel}', which is not defined in the @Page decorator for ${this.constructor.name}.`);
            }
        }
    }

    public render(): TemplateResult | null { return null; }
    public async get(): Promise<any> {}
    public async init(): Promise<any> {}

    public head(context: HeadContext): HeadValue {
        return {};
    }

    // Overriding CossackElement updated to handle head updates
    updated(changedProperties: Map<string | number | symbol, unknown>) {
        super.updated(changedProperties);
        if (!this.isServer) {
            this.updateHead();
        }
    }

    @Client()
    public updateHead() {
        // NOTE: In a multi-layout scenario on the client, we need access to the whole stack
        // to correctly re-run header merging. For now, we'll keep it simple as most head
        // updates are page-specific. Complex layout-based head updates might need the App instance.
        const emptyCtx: HeadContext = { title: '', description: '', image: '', meta: [], links: [], scripts: [], tags: [] };
        const value = this.head(emptyCtx);
        const tags = Cossack.mergeHead(emptyCtx, value);
        Cossack.applyHeadTags(tags);
    }

    public _getWrappedTemplate(): TemplateResult | null {
        // Special case: check if we should render a loading UI instead of standard output
        if (this.loading.init && typeof (this as any).loadingTemplate === 'function') {
            return (this as any).loadingTemplate();
        }

        let template = this.render();
        
        // Inject devtools markers if source info is present
        // Since __source is injected by the Vite plugin only in DEV mode, 
        // we can safely assume if it exists, we are in DEV.
        const source = (this.constructor as any).__source;
        if (template && source) {
            const Ctor = this.constructor as any;
            if (!Ctor.__devStrings) {
                const marker = JSON.stringify(source);
                // Create a stable TemplateStringsArray with the marker embedded
                // We use manual construction to avoid interpolation issues with comments
                // and to ensure stable references for the renderer.
                const strings = [`<!--cossack-start:${marker}-->`, `<!--cossack-end:${marker}-->`];
                (strings as any).raw = strings;
                Ctor.__devStrings = strings;
            }
            
            // Wrap the template. The new template has 1 value (the original template).
            // The strings array has 2 parts (start marker, end marker).
            template = new TemplateResult(Ctor.__devStrings, [template]);
        }
        return template;
    }

    @Client()
    public async _checkPreventNavigation(): Promise<boolean> {
        const method = Reflect.getMetadata('cossack:prevent-navigation', this.constructor);
        if (method && typeof (this as any)[method] === 'function') {
            const allow = await (this as any)[method]();
            return !allow; // Returns TRUE if PREVENTED (blocked)
        }
        return false;
    }

    @Client()
    public confirmNavigation(allow: boolean) {
        if (allow && this._pendingNavigation) {
            const nav = this._pendingNavigation;
            this._pendingNavigation = null;
            nav();
        } else {
            this._pendingNavigation = null;
            this.requestUpdate();
        }
    }

    public _render(): string {
        if (!this.isServer && !this.skipRenderTasks) {
            this.runTasks();
        }
        
        const template = this._getWrappedTemplate();
        
        if (!template) {
            return '';
        }

        if (this.isServer) {
            if (isTemplateResult(template)) {
                return renderToString(template);
            }
            return renderToString(html`${template}`);
        }
        return '';
    }

    public getInitialHtml(): string {
        return this._render();
    }
    
    // Lifecycle hooks
    public onMount(): void {
        this.setupVisibleTasks();
        this.setupEventListeners();
    }
    public onCleanup(): void {}

    public static _onNavigate?: (url: string) => Promise<void>;

    @Server()
    public redirect(url: string, status: RedirectStatusCode = 302) {
        if (!this.isServer) {
            if (Cossack._onNavigate) {
                window.history.pushState({}, '', url);
                Cossack._onNavigate(url);
            } else {
                window.location.href = url;
            }
            return;
        }
        return this.c.redirect(url, status);
    }

    public broadcastEvent(eventName: string, ...payload: any[]) {
        if (!this.isServer) {
            console.warn('[Cossack] broadcastEvent() can only be called on the server.');
            return;
        }
        this._runtime?.broadcastEvent(eventName, payload);
    }

    public getInitialState(): Record<string, any> {
        const state: Record<string, any> = {};
        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        for (const key in stateProperties) {
            state[key] = (this as any)[key];
        }

        const params = (this.c as Context)?.req.param() || {};
        const baseState = { ...state, params, user: this.user, componentId: this.constructor.name, pathname: (this.c as Context)?.req.path };

        const serverMethodsMetadata = Reflect.getMetadata('cossack:server-methods', this.constructor) || {};
        const serverMethods = Object.entries(serverMethodsMetadata).map(([name, options]: [string, any]) => ({
            name,
            channel: options.channel || 'global',
            provider: options.provider || 'page',
        }));

        const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', this.constructor);
        if (pageOptions?.transport === 'http') {
            return { ...baseState, serverMethods };
        }

        const providerTargets: Record<string, string> = {};
        if (this.providers) {
            for (const [name, provider] of this.providers.entries()) {
                const target = provider.getConnectionTarget();
                if (target) {
                     providerTargets[name] = (target as any).toString();
                }
            }
        }

        return { ...baseState, serverMethods, providerTargets };
    }

    public getPublicState(): Record<string, any> {
        const state: Record<string, any> = {};
        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        for (const key in stateProperties) {
            state[key] = (this as any)[key];
        }
        return state;
    }

    public destroy() {
        this.onCleanup();
        if (!this.isServer) {
            this.websockets.forEach(ws => {
                ws.close();
            });
            this.websockets.clear();
            
            // Clean up event listeners
            this.eventCleanupFns.forEach(cleanup => cleanup());
            this.eventCleanupFns = [];
        }
    }
}