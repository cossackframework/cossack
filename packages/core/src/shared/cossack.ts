// src/shared/cossack.ts
import { renderToString } from '@cossackframework/renderer/server';
import { render, type TemplateResult } from '@cossackframework/renderer';
import { isServer } from './environment';
import { Client, Server, State } from './decorators';
import type { Context } from 'hono';
import type { CossackDurableObject } from './CossackDurableObject';
import { PageStateProvider, StateProvider } from './StateProvider';

export interface CossackOptions {
  Channels?: string;
}

import type { AuthenticatedUser } from './user';

// A lightweight, client-side representation of the Hono context for params.
type HydratedContext = {
    req: {
        param: (key?: string) => any;
    }
}

export abstract class Cossack<T extends CossackOptions = {}> {
    protected container?: Element;
    protected isServer: boolean = isServer;
    
    protected c!: Context | HydratedContext;
    protected user?: AuthenticatedUser;
    protected env: any;
    protected providers!: Map<string, StateProvider>;
    public props: Record<string, any> = {};

    @Server()
    private _cossack_provider_name?: string;

    @Client()
    private websockets: Map<string, WebSocket> = new Map();

    // `loading` is a public property available on server and client,
    // but it is NOT decorated with @State, so its state is managed on the client.
    public loading: Record<string, boolean> = {};

    @Server()
    private _cossack_DO_instance?: CossackDurableObject;

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
            this.c = context;
            this.env = env;
            this._cossack_provider_name = providerName;
            this.initializeProviders();
        } else {
            const clientInitialState = initialState || (window as any).__INITIAL_STATE__;
            this.user = clientInitialState?.user;
            const clientParams = clientInitialState?.params || {};
            this.c = {
                req: {
                    param: (key?: string) => key ? clientParams[key] : clientParams
                }
            };
        }

        this.initializeState(initialState);

        if (this.isServer) {
            this.proxyClientMethods();
            await this.init();
        } else {
            const clientInitialState = initialState || (window as any).__INITIAL_STATE__;
            this.connectWebSocket();
            this.proxyServerMethods(clientInitialState?.serverMethods || []);
        }

        if (this.container && !this.isServer) {
            this.render();
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
        const providerDurableObjectIds = initialState?.providerDurableObjectIds || {};

        for (const providerName in providerDurableObjectIds) {
            const durableObjectId = providerDurableObjectIds[providerName];
            
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

            const wsUrl = `/ws/${providerName}/${durableObjectId}?${params}`;
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
                    this.loading = {};
                    this.render();
                } else if (data.type === 'action-complete') {
                    const { action } = data;
                    delete this.loading[action];
                    this.render();
                } else if (data.type === 'client-action') {
                    const { action, payload } = data;
                    const clientMethods = Reflect.getMetadata('cossack:client-methods', this.constructor) || {};
                    if (clientMethods[action] && typeof (this as any)[action] === 'function') {
                        (this as any)[action](...payload);
                    } else {
                        console.warn(`[Cossack] Server tried to call un-callable client method '${action}'.`);
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
    private proxyServerMethods(serverMethods: { name: string, channel: string, provider: string }[]) {
        for (const method of serverMethods) {
            const { name, channel, provider } = method;
            (this as any)[name] = (...args: any[]) => {
                const ws = this.websockets.get(provider);
                if (ws && ws.readyState === WebSocket.OPEN) {
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

        for (const key of stateKeys) {
            let initialValue = (this as any)[key];

            if (!this.isServer) {
                const clientInitialState = initialState || (window as any)?.__INITIAL_STATE__ || {};
                if (clientInitialState[key] !== undefined) {
                    initialValue = clientInitialState[key];
                }
            }
            
            privateState.set(key, initialValue);

            Object.defineProperty(this, key, {
                get: () => privateState.get(key),
                set: (value: any) => {
                    if (privateState.get(key) !== value) {
                        privateState.set(key, value);
                        if (this.isServer) {
                            const propertyProvider = stateProperties[key]?.provider || 'page';
                            if (propertyProvider === this._cossack_provider_name) {
                                this.dirtyProperties.add(key);
                                if (!this.broadcastScheduled) {
                                    this.broadcastScheduled = true;
                                    queueMicrotask(() => {
                                        this._cossack_DO_instance?.broadcast(Array.from(this.dirtyProperties));
                                        this._cossack_DO_instance?.persistState();
                                        this.dirtyProperties.clear();
                                        this.broadcastScheduled = false;
                                    });
                                }
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

            const { channel } = clientMethods[key];

            (this as any)[key] = (...args: any[]) => {
                if (!this.isServer) {
                    console.warn(`[Cossack] Client method '${String(key)}' cannot be called from the client.`);
                    return;
                }
                this._cossack_DO_instance?.sendClientAction(channel, key, args);
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

    protected abstract template(): TemplateResult;

    public render(): string {
        if (this.container && !this.isServer) {
            render(this.template(), this.container);
            return '';
        }
        if (this.isServer) {
            return renderToString(this.template());
        }
        return '';
    }

    public getInitialHtml(): string {
        return this.render();
    }

    public async init(): Promise<void> {}

    public broadcast(eventName: string, ...payload: any[]) {
        if (!this.isServer) {
            console.warn('[Cossack] broadcast() can only be called on the server.');
            return;
        }
        this._cossack_DO_instance?.broadcastEvent(eventName, payload);
    }

    public getInitialState(): Record<string, any> {
        const state: Record<string, any> = {};
        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        for (const key in stateProperties) {
            state[key] = (this as any)[key];
        }

        const serverMethodsMetadata = Reflect.getMetadata('cossack:server-methods', this.constructor) || {};
        const serverMethods = Object.entries(serverMethodsMetadata).map(([name, options]: [string, any]) => ({
            name,
            channel: options.channel || 'global',
            provider: options.provider || 'page',
        }));

        const providerDurableObjectIds: Record<string, string> = {};
        if (this.providers) {
            for (const [name, provider] of this.providers.entries()) {
                providerDurableObjectIds[name] = provider.getDurableObjectId().toString();
            }
        }

        const params = (this.c as Context)?.req.param() || {};
        return { ...state, params, serverMethods, user: this.user, providerDurableObjectIds, componentId: this.constructor.name };
    }
}
