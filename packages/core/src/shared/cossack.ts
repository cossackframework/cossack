// src/shared/cossack.ts
import { renderToString } from '@cossackframework/renderer/server';
import { render, type TemplateResult } from '@cossackframework/renderer';
import { isServer } from './environment';
import { Client, PageOptions, Server, State } from './decorators';
import type { Context } from 'hono';
import type { CossackServerRuntime } from './runtime';
import { PageStateProvider, StateProvider } from './StateProvider';
import { HeadTag } from './head';
import { createCossackContext, HydratedContext } from './context';

export interface CossackOptions {
  Channels?: string;
}

import type { AuthenticatedUser } from './user';
import { RedirectStatusCode } from 'hono/utils/http-status';

export abstract class Cossack<T extends CossackOptions = {}> {
    protected container?: Element;
    protected isServer: boolean = isServer;
    
    protected c!: Context;
    protected user?: AuthenticatedUser;
    protected env: any;
    protected providers!: Map<string, StateProvider>;
    public props: Record<string, any> = {};

    @Server()
    private _cossack_provider_name?: string;

    @Server()
    private _cossack_ws_context?: unknown;

    @Client()
    private websockets: Map<string, WebSocket> = new Map();

    // `loading` is a public property available on server and client,
    // but it is NOT decorated with @State, so its state is managed on the client.
    public loading: Record<string, boolean> = {};

    @Server()
    private _runtime?: CossackServerRuntime;

    private dirtyProperties: Set<string> = new Set();
    private broadcastScheduled: boolean = false;

    public async bootstrap({ container, initialState, context, user, env, page, providerName }: { container?: Element, initialState?: any, context?: Context | HydratedContext, user?: AuthenticatedUser, env?: any, page?: string, providerName?: string } = {}) {
        this.container = container;
        this.user = user;
        this.props = { page };

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
            const hydratedContext: HydratedContext = {
                req: {
                    param: (key?: string) => key ? clientParams[key] : clientParams
                }
            };
            this.c = createCossackContext(hydratedContext, false);
        }

        this.initializeState(initialState);

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

        if (this.container && !this.isServer) {
            this.render();
        }
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
                    delete this.loading[action];
                    requestAnimationFrame(() => this.render());
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
        const componentPath = (window as any).__INITIAL_STATE__?.componentPath;
        if (!componentPath) {
            console.error('[Cossack] Cannot create HTTP proxies: componentPath not found in initial state.');
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
                        this.render(); 
                    } catch (e) {
                        console.error(`Error in optimistic handler for '${name}':`, e);
                    }
                }

                this.loading[name] = true;
                this.render();

                try {
                    const response = await fetch('/crpc', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            componentPath,
                            action: name,
                            state: this.getPublicState(),
                            payload: args,
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

                    for (const key in data) {
                        if (key === 'loading' || key === 'isServer' || key === 'params') continue;
                        (this as any)[key] = data[key];
                    }
                } catch (error) {
                    console.error(`Error calling server action '${name}':`, error);
                } finally {
                    delete this.loading[name];
                    this.render();
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
                            this.render(); // Render immediately after optimistic update
                        } catch (e) {
                            console.error(`Error in optimistic handler for '${name}':`, e);
                        }
                    }

                    this.loading[name] = true;
                    this.render();
                    
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

    private initializeState(initialState?: any) {
        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        const stateKeys = Object.keys(stateProperties);
        const privateState = new Map<string, any>();

        // Determine the single source of truth for the initial state values.
        // On the server, it's the `initialState` from the action.
        // On the client, it's the global `__INITIAL_STATE__` object.
        const stateSource = this.isServer 
            ? initialState 
            : (initialState || (window as any)?.__INITIAL_STATE__ || {});

        for (const key of stateKeys) {
            // Start with the class property's default value.
            let value = (this as any)[key];

            // Overwrite with the value from our state source if it exists.
            if (stateSource && stateSource[key] !== undefined) {
                value = stateSource[key];
            }
            
            privateState.set(key, value);

            Object.defineProperty(this, key, {
                get: () => privateState.get(key),
                set: (newValue: any) => {
                    if (privateState.get(key) !== newValue) {
                        privateState.set(key, newValue);
                        if (this.isServer) {
                            this.dirtyProperties.add(key);
                            if (!this.broadcastScheduled) {
                                this.broadcastScheduled = true;
                                queueMicrotask(() => {
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
                        } else {
                            this.render();
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

    protected template(): TemplateResult | null { return null; }

    public header(): HeadTag[] {
        return [];
    }

    @Client()
    private updateHead() {
        const headTags = this.header();
        const head = document.head;

        // Clear existing managed tags
        head.querySelectorAll('[data-cossack]').forEach(el => el.remove());

        for (const tag of headTags) {
            const el = document.createElement(tag.tag);
            el.setAttribute('data-cossack', '');
            if (tag.attributes) {
                for (const [key, value] of Object.entries(tag.attributes)) {
                    el.setAttribute(key, String(value));
                }
            }
            if (tag.children) {
                el.textContent = tag.children;
            }
            head.appendChild(el);
        }
    }

    public render(): string {
        const template = this.template();
        if (!template) {
            return '';
        }

        if (this.container && !this.isServer) {
            render(template, this.container);
            this.updateHead();
            return '';
        }
        if (this.isServer) {
            return renderToString(template);
        }
        return '';
    }

    public getInitialHtml(): string {
        return this.render();
    }

    public async init(): Promise<void> {}

    @Server()
    public redirect(url: string, status: RedirectStatusCode = 302) {
        if (!this.isServer) {
            console.warn('[Cossack] redirect() can only be called on the server.');
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
        const baseState = { ...state, params, user: this.user, componentId: this.constructor.name };

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

        // For real-time transports, add the WebSocket-related info.
        const providerTargets: Record<string, string> = {};
        if (this.providers) {
            for (const [name, provider] of this.providers.entries()) {
                const target = provider.getConnectionTarget();
                if (target) {
                     providerTargets[name] = target.toString();
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
        if (!this.isServer) {
            this.websockets.forEach(ws => {
                ws.close();
            });
            this.websockets.clear();
        }
    }
}
