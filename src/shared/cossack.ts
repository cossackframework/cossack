// src/shared/cossack.ts
import { renderToString } from '@cossackframework/renderer/server';
import { render, type TemplateResult } from '@cossackframework/renderer';
import { isServer } from './environment';
import { Client, Server, State } from './decorators';
import type { Context } from 'hono';

// Define a user type for clarity. In a real app, this would be more complex.
type AuthenticatedUser = {
    id: string;
    [key: string]: any; // Allow other properties like friends, roles, etc.
};

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
        const initialState = (window as any).__INITIAL_STATE__;
        const wsUrl = initialState?.webSocketUrl;

        if (!wsUrl) {
            // This page does not have a real-time channel.
            return;
        }

        const fullWsUrl = `ws://${window.location.host}${wsUrl}`;
        this.ws = new WebSocket(fullWsUrl);

        this.ws.onopen = () => {
            // The server now knows our identity from the initial request,
            // but we still need to tell it which component to associate with this socket.
            this.ws?.send(JSON.stringify({
                type: 'init',
                componentId: initialState?.componentId
            }));
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'state-update') {
                for (const key in data.state) {
                    // The 'loading' state and 'isServer' are client-side only concerns.
                    // Never accept these state properties from the server.
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

    @Client()
    private proxyServerMethods() {
        const serverOnlyKeys = Reflect.getMetadata('cossack:server-only', this.constructor) || [];
        for (const key of serverOnlyKeys) {
            if (typeof (this as any)[key] !== 'function') continue;

            (this as any)[key] = (...args: any[]) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.loading = { ...this.loading, [key as string]: true };
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
                            const ws = Cossack._wsMap.get(this);
                            if (ws) {
                                // This logic is now handled by the DO's broadcast method.
                                // The setter on the server is primarily for direct state manipulation in actions.
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
        const instanceState = Cossack._stateMap.get(this);

        if (!instanceState) {
            // If state hasn't been initialized, return a safe empty object.
            return {};
        }

        for (const key of stateKeys) {
            state[key as string] = instanceState.get(key);
        }
        return state;
    }

    /**
     * (Server-side only) If this method is implemented, the framework will use it
     * to filter the component's state before broadcasting it to a specific user.
     * This is the hook for implementing secure, personalized views of a shared resource.
     * @param state The complete, shared state of the component instance in the Durable Object.
     * @param user The authenticated user object for the recipient of the broadcast.
     * @returns The partial state that should be sent to this specific user.
     */
    @Server()
    public webSocketBroadcastFilter(state: this, user: AuthenticatedUser): Partial<this> {
        // By default, no filtering is applied. Subclasses can override this method
        // to provide a personalized, secure view of the state for each user.
        return state;
    }
}
