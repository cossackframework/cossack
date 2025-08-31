// src/shared/cossack.ts
import { renderToString } from '@cossackframework/renderer/server';
import { render, type TemplateResult } from '@cossackframework/renderer';
import { isServer } from './environment';
import { Client, Server, State } from './decorators';
import type { Context } from 'hono';

export abstract class Cossack {
    protected container?: Element;
    protected isServer: boolean = isServer;
    protected params?: Record<string, string>;

    @Client()
    private ws?: WebSocket;

    @State() public loading: Record<string, boolean> = {};

    @Server()
    private c?: Context;

    public setContext(c: Context) {
        if (this.isServer) {
            this.c = c;
        }
    }

    public getContext(): Context | undefined {
        if (this.isServer) {
            return this.c;
        }
        return undefined;
    }

    public async bootstrap({ container, params }: { container?: Element, params?: Record<string, string> } = {}) {
        this.container = container;
        this.params = params;

        if (this.isServer) {
            await this.init();
        } else {
            this.connectWebSocket();
        }

        // This must run *after* the constructor finishes, so arrow function properties are assigned.
        if (!this.isServer) {
            this.proxyServerMethods();
        }
        this.initializeState();

        if (this.container && !this.isServer) {
            this.render();
        }
    }

    private static _stateMap: WeakMap<object, Map<string | symbol, any>> = new WeakMap();
    private static _wsMap: WeakMap<object, any> = new WeakMap();

    @Server()
    public setServerWebSocket(ws: any) {
        Cossack._wsMap.set(this, ws);
    }

    @Client()
    private connectWebSocket() {
        const wsUrl = `ws://${window.location.host}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            const componentId = (window as any).__INITIAL_STATE__?.componentId;
            if (componentId) {
                this.ws?.send(JSON.stringify({
                    type: 'init',
                    componentId: componentId
                }));
            } else {
                console.error('Component ID not found in initial state. Cannot initialize WebSocket.');
            }
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'state-update') {
                for (const key in data.state) {
                    (this as any)[key] = data.state[key];
                }
            } else if (data.type === 'action-complete') {
                const { action } = data;
                this.loading = { ...this.loading, [action]: false };
            }
        };
    }

    @Client()
    private proxyServerMethods() {
        const serverOnlyKeys = Reflect.getMetadata('cossack:server-only', this.constructor) || [];
        for (const key of serverOnlyKeys) {
            if (typeof (this as any)[key] !== 'function') continue;

            (this as any)[key] = (...args: any[]) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    // Set loading state to true optimistically on the client
                    this.loading = { ...this.loading, [key as string]: true };

                    // Avoid sending large, unnecessary event objects as payload
                    const payload = args.filter(arg => typeof arg !== 'object' || arg === null);
                    this.ws.send(JSON.stringify({
                        type: 'action',
                        action: key,
                        payload: payload,
                    }));
                } else {
                    console.error(`WebSocket not connected. Cannot call server method '${String(key)}'.`);
                }
            };
        }
    }

    private initializeState() {
        const stateKeys = Reflect.getMetadata('cossack:state', this.constructor) || [];
        if (!stateKeys) return;

        if (!Cossack._stateMap.has(this)) {
            Cossack._stateMap.set(this, new Map());
        }
        const instanceState = Cossack._stateMap.get(this)!;

        const initialState = !this.isServer ? (window as any).__INITIAL_STATE__ : null;

        for (const key of stateKeys) {
            const initialValue = initialState && initialState[key] !== undefined
                ? initialState[key]
                : this[key as keyof this];

            instanceState.set(key, initialValue);

            Object.defineProperty(this, key, {
                get() {
                    return Cossack._stateMap.get(this)!.get(key);
                },
                set: (newValue) => {
                    const state = Cossack._stateMap.get(this)!;
                    if (state.get(key) !== newValue) {
                        state.set(key, newValue);

                        if (this.isServer) {
                            console.log(`[Cossack Server Setter] State changed for key: ${String(key)}`);
                            const ws = Cossack._wsMap.get(this);
                            if (!ws) {
                                console.error('[Cossack Server Setter] WebSocket not found for this component instance.');
                                return;
                            }
                            console.log(`[Cossack Server Setter] WebSocket readyState: ${ws.readyState}`);
                            if (ws.readyState === 1 /* OPEN */) {
                                const message = JSON.stringify({
                                    type: 'state-update',
                                    state: { [key]: newValue }
                                });
                                console.log(`[Cossack Server Setter] Sending state update: ${message}`);
                                ws.send(message);
                            } else {
                                console.error('[Cossack Server Setter] WebSocket not open, cannot send state update.');
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
        const stateKeys = Reflect.getMetadata('cossack:state', this.constructor) || [];
        for (const key of stateKeys) {
            state[key as string] = this[key as keyof this];
        }
        return state;
    }
}