// src/shared/cossack.ts
import { renderToString } from '@cossackframework/renderer/server';
import { render, type TemplateResult } from '@cossackframework/renderer';
import { isServer } from './environment';
import { Client, Server, State } from './decorators';
import type { Context } from 'hono';
import type { CossackDurableObject } from './CossackDurableObject';

type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

export abstract class Cossack {
    protected container?: Element;
    protected isServer: boolean = isServer;
    protected params?: Record<string, string>;

    @Client()
    private websockets: Map<string, WebSocket> = new Map();

    @State() public loading: Record<string, boolean> = {};

    @Server()
    private c?: Context;

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
        this.params = params;

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

        for (const channel of channels) {
            const wsUrl = `/ws/${componentId}/${channel}`;
            const fullWsUrl = `ws://${window.location.host}${wsUrl}`;
            const ws = new WebSocket(fullWsUrl);
            this.websockets.set(channel, ws);

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'state-update') {
                    for (const key in data.state) {
                        if (key === 'loading' || key === 'isServer') continue;
                        (this as any)[key] = data.state[key];
                    }
                } else if (data.type === 'action-complete') {
                    const { action } = data;
                    const newLoading = { ...this.loading };
                    delete newLoading[action];
                    this.loading = newLoading;
                }
            };
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
        return state;
    }
}