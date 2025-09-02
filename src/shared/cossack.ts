// src/shared/cossack.ts
import { renderToString } from '@cossackframework/renderer/server';
import { render, type TemplateResult } from '@cossackframework/renderer';
import { isServer } from './environment';
import { Client, Server, State } from './decorators';
import type { Context } from 'hono';
import type { CossackDurableObject } from './CossackDurableObject';

export interface CossackOptions {
  Channels?: string;
}

type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

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

    @Client()
    private websockets: Map<string, WebSocket> = new Map();

    @State() public loading: Record<string, boolean> = {};

    @Server()
    private _cossack_DO_instance?: CossackDurableObject;

    private dirtyProperties: Set<string> = new Set();
    private broadcastScheduled: boolean = false;

    public async bootstrap({ container, initialState, context }: { container?: Element, initialState?: any, context?: Context | HydratedContext } = {}) {
        this.container = container;

        if (this.isServer) {
            if (!context) {
                throw new Error('[Cossack] Context must be provided during bootstrap on the server.');
            }
            this.c = context;
        } else {
            const clientInitialState = initialState || (window as any).__INITIAL_STATE__;
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

    @Client()
    private connectWebSocket() {
        const initialState = (window as any).__INITIAL_STATE__;
        const channels = initialState?.channels || ['global'];
        const componentId = initialState?.componentId;
        const params = (this.c as HydratedContext).req.param();
        const query = new URLSearchParams(params).toString();

        for (const channel of channels) {
            const wsUrl = `/ws/${componentId}/${channel}?${query}`;
            const fullWsUrl = `ws://${window.location.host}${wsUrl}`;
            const ws = new WebSocket(fullWsUrl);
            this.websockets.set(channel, ws);

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
                    const newLoading = { ...this.loading };
                    delete newLoading[action];
                    this.loading = newLoading;
                } else if (data.type === 'client-action') {
                    const { action, payload } = data;
                    const clientMethods = Reflect.getMetadata('cossack:client-methods', this.constructor) || {};
                    if (clientMethods[action] && typeof (this as any)[action] === 'function') {
                        (this as any)[action](...payload);
                    } else {
                        console.warn(`[Cossack] Server tried to call un-callable client method '${action}'.`);
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
    private proxyServerMethods(serverMethods: { name: string, channel: string }[]) {
        for (const method of serverMethods) {
            const { name, channel } = method;
            // We don't check for function existence anymore, we just overwrite it.
            // This allows for the client-side method to be a placeholder.
            (this as any)[name] = (...args: any[]) => {
                const ws = this.websockets.get(channel);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    this.loading = { ...this.loading, [name]: true };
                    const payload = args.filter(arg => typeof arg !== 'object' || arg === null);
                    ws.send(JSON.stringify({
                        type: 'action',
                        action: name,
                        payload: payload,
                    }));
                } else {
                    console.error(`WebSocket for channel '${channel}' not connected. Cannot call server method '${name}'.`);
                }
            };
        }
    }

    private initializeState(initialState?: any) {
        if (this.isServer) {
            this.validateChannels();
        }

        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        const stateKeys = Object.keys(stateProperties);
        const clientInitialState = !this.isServer ? (initialState || (window as any).__INITIAL_STATE__) : {};

        const privateState = new Map<string, any>();

        for (const key of stateKeys) {
            const initialValue = clientInitialState[key] !== undefined
                ? clientInitialState[key]
                : (this as any)[key];
            
            privateState.set(key, initialValue);

            Object.defineProperty(this, key, {
                get: () => privateState.get(key),
                set: (value: any) => {
                    if (privateState.get(key) !== value) {
                        privateState.set(key, value);
                        if (this.isServer) {
                            this.dirtyProperties.add(key);
                            if (!this.broadcastScheduled) {
                                this.broadcastScheduled = true;
                                queueMicrotask(() => {
                                    this._cossack_DO_instance?.broadcast(Array.from(this.dirtyProperties));
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

    public getInitialState(): Record<string, any> {
        const state: Record<string, any> = {};
        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        for (const key in stateProperties) {
            state[key] = (this as any)[key];
        }

        const serverMethodsMetadata = Reflect.getMetadata('cossack:server-methods', this.constructor) || {};
        const serverMethods = Object.entries(serverMethodsMetadata).map(([name, options]: [string, any]) => ({
            name,
            channel: options.channel || 'global'
        }));

        const params = (this.c as Context)?.req.param() || {};
        return { ...state, params, serverMethods };
    }
}
