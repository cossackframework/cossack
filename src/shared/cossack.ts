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

    public setContext(c: Context) {
        if (this.isServer) {
            this.c = c;
        }
    }

    public async bootstrap({ container, params }: { container?: Element, params?: Record<string, string> } = {}) {
        this.container = container;

        if (!this.isServer) {
            const initialState = (window as any).__INITIAL_STATE__;
            const clientParams = initialState?.params || {};
            this.c = {
                req: {
                    param: (key?: string) => key ? clientParams[key] : clientParams
                }
            };
        } else if (params) {
            this.c = {
                req: {
                    param: (key?: string) => key ? params[key] : params
                }
            } as any;
        }

        this.initializeState();

        if (this.isServer) {
            await this.init();
        } else {
            this.connectWebSocket();
            this.proxyServerMethods();
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
    private proxyServerMethods() {
        const serverMethods = Reflect.getMetadata('cossack:server-methods', this.constructor) || {};
        for (const key in serverMethods) {
            if (typeof (this as any)[key] !== 'function') continue;

            const { channel } = serverMethods[key];

            (this as any)[key] = (...args: any[]) => {
                const ws = this.websockets.get(channel);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    this.loading = { ...this.loading, [key as string]: true };
                    const payload = args.filter(arg => typeof arg !== 'object' || arg === null);
                    ws.send(JSON.stringify({
                        type: 'action',
                        action: key,
                        payload: payload,
                    }));
                } else {
                    console.error(`WebSocket for channel '${channel}' not connected. Cannot call server method '${String(key)}'.`);
                }
            };
        }
    }

    private initializeState() {
        if (this.isServer) {
            this.validateChannels();
        }

        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        const stateKeys = Object.keys(stateProperties);
        const initialState = !this.isServer ? (window as any).__INITIAL_STATE__ : {};

        const privateState = new Map<string, any>();

        for (const key of stateKeys) {
            const initialValue = initialState[key] !== undefined
                ? initialState[key]
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
        const params = (this.c as Context)?.req.param() || {};
        return { ...state, params };
    }
}
