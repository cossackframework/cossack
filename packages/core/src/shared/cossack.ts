// src/shared/cossack.ts
import {
    renderToString,
    html,
    TemplateResult,
    CossackElement,
    isTemplateResult,
    createContext,
    pushCurrentInstance,
    popCurrentInstance,
    instanceStack
} from '@cossackframework/renderer';
import { isServer } from './environment';
import { Client, PageOptions, Server, State, ClientState, VisibleTaskOptions } from './decorators';
import type { Context } from 'hono';
import type { CossackServerRuntime } from './runtime';
import { PageStateProvider, StateProvider } from './StateProvider';
import { HeadTag, HeadContext, HeadValue } from './head';
import { createCossackContext, HydratedContext, EnvContext, UserContext, RequestContext } from './context';

export const RootContext = createContext<Cossack | null>(null);

/**
 * Lifecycle phases for explicit state management and preventing invalid transitions.
 */
export enum LifecyclePhase {
    /** Component is being constructed */
    Creating = 'Creating',
    /** bootstrap() is being called (not yet connected to DOM) */
    Bootstrapping = 'Bootstrapping',
    /** Component is connected to DOM and ready */
    Mounted = 'Mounted',
    /** An update is in progress (willUpdate) */
    Updating = 'Updating',
    /** Component has been destroyed */
    Destroyed = 'Destroyed',
}

/**
 * Unified state management interface.
 * Separates concerns between public/shared state, internal/private state, and children state.
 */
export interface ComponentState {
    /** Public state that is synced between server and client (decorated with @State()) */
    public: Record<string, unknown>;
    /** Internal state that lives only on the client (decorated with @ClientState()) */
    internal: Record<string, unknown>;
    /** Nested children component states */
    children: Record<string, SerializedComponentState>;
}

/**
 * Serialized state format for transmission between server and client.
 * Contains both the state values and metadata needed for hydration.
 */
export interface SerializedComponentState {
    /** Public state values */
    public: Record<string, unknown>;
    /** Internal state values (only present for client-side restoration) */
    internal?: Record<string, unknown>;
    /** Metadata needed for initialization */
    metadata?: {
        componentId: string;
        componentPath?: string;
        pathname?: string;
        params?: Record<string, string>;
        user?: unknown;
    };
    /** Server methods metadata for proxy setup */
    serverMethods?: Array<{ name: string; channel: string; provider: string }>;
    /** Provider targets for WebSocket connections */
    providerTargets?: Record<string, string>;
    /** Nested children states */
    children?: Record<string, SerializedComponentState>;
    /** Component route ID for HTTP transport */
    componentRouteId?: string;
}

/**
 * Internal state container for a component.
 * This is the single source of truth for all component state.
 */
class StateContainer {
    private _publicState = new Map<string, unknown>();
    private _internalState = new Map<string, unknown>();
    private _initializedKeys = new Set<string>();

    /** Get all public state as a plain object */
    getPublicState(): Record<string, unknown> {
        return Object.fromEntries(this._publicState);
    }

    /** Get all internal state as a plain object */
    getInternalState(): Record<string, unknown> {
        return Object.fromEntries(this._internalState);
    }

    /** Get a public state value */
    getPublic(key: string): unknown {
        return this._publicState.get(key);
    }

    /** Get an internal state value */
    getInternal(key: string): unknown {
        return this._internalState.get(key);
    }

    /** Set a public state value */
    setPublic(key: string, value: unknown): void {
        this._publicState.set(key, value);
        this._initializedKeys.add(key);
    }

    /** Set an internal state value */
    setInternal(key: string, value: unknown): void {
        this._internalState.set(key, value);
        this._initializedKeys.add(key);
    }

    /** Check if a key has been initialized */
    isInitialized(key: string): boolean {
        return this._initializedKeys.has(key);
    }

    /** Check if this container has any public state */
    hasPublicState(): boolean {
        return this._publicState.size > 0;
    }

    /** Check if this container has any internal state */
    hasInternalState(): boolean {
        return this._internalState.size > 0;
    }
}

/**
 * Internal interfaces for type-safe property access.
 * These define the shape of internal properties and methods that were previously accessed via `as any`.
 */

/** Dynamic method/function type that can be called with any arguments */
type DynamicFunction = (...args: unknown[]) => unknown;

/** Map of component methods by name */
type ComponentMethods = Record<string, DynamicFunction>;

/** Internal properties from CossackElement that need to be accessed */
interface CossackElementInternal {
    /** Parent component in the render tree */
    __parent?: CossackElement & { registerComponent?(comp: Cossack): void };
    /** Changed properties pending update */
    __changedProperties: Map<string | number | symbol, unknown>;
    /** Update promise for concurrent updates */
    __updatePromise: Promise<boolean> | null;
    /** Controllers attached to this element */
    __controllers: unknown[];
    /** Notify listeners of template changes */
    __notifyListeners(template: TemplateResult | null): void;
}

/** Internal state properties that exist on component instances */
interface CossackInternalState {
    /** Initial state loaded from window for hydration */
    __INITIAL_STATE__?: SerializedComponentState;
}

/** Dynamic property access interface for state properties */
interface DynamicPropertyAccess {
    [key: string]: unknown;
}

export interface CossackOptions {
  Channels?: string;
}

import type { AuthenticatedUser } from './user';
import { RedirectStatusCode } from 'hono/utils/http-status';

export abstract class Cossack<Env = any, T extends CossackOptions = {}> extends CossackElement {
    // Standard Properties
    protected container?: Element;
    protected isServer: boolean = isServer;
    
    private _c!: Context;
    private _user?: AuthenticatedUser;
    private _env!: Env;

    protected get c(): Context { 
        return this._c || this.consume(RequestContext) as Context; 
    }
    protected set c(val: Context) { 
        this._c = val; 
    }

    protected get user(): AuthenticatedUser | undefined { return this._user || this.consume(UserContext); }
    protected set user(val: AuthenticatedUser | undefined) { this._user = val; }

    protected get env(): Env { return this._env || this.consume(EnvContext) as Env; }
    protected set env(val: Env) { this._env = val; }

    protected providers!: Map<string, StateProvider>;
    public props: Record<string, any> = {};

    // Component Registry (Server-Side mostly)
    public activeComponents: Map<string, Cossack> = new Map();

    // Unified State Management
    private _stateContainer = new StateContainer();
    /** Serialized children state for restoration during hydration */
    private _childrenStateRegistry: Record<string, SerializedComponentState> = {};

    // Track the current page component (client-side only)
    private _currentPage?: Cossack;

    // Track if server methods have been proxied to prevent re-proxying
    private _serverMethodsProxied = false;

    // Map of server-only method names to their proxy functions
    // This allows client methods to call server-only methods seamlessly
    public __cossack_proxies: Map<string, (...args: any[]) => any> = new Map();

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

    // Lifecycle phase management
    protected _phase: LifecyclePhase = LifecyclePhase.Creating;
    private _phaseTransitionStack: LifecyclePhase[] = [];

    // Navigation blocking state
    public _pendingNavigation: (() => void) | null = null;

    // DevTools Metadata (Injected by Vite plugin)
    public static __source?: { file: string };

    constructor() {
        super();
        this._id = 'root'; // Default for root components (App, Page)
        this.autoBindMethods();
    }

    connectedCallback() {
        // Transition to Mounted phase from Creating phase
        this._transitionToPhase(LifecyclePhase.Mounted, [LifecyclePhase.Creating]);

        try {
            // Register first so parent can provide restored child state
            this.registerSelf();
            this.initializeState();
            super.connectedCallback();
        } finally {
            // Restore phase after lifecycle complete
            this._restorePhase();
        }
    }

    willUpdate(changedProperties: Map<string | number | symbol, unknown>) {
        // Transition to Updating phase from Creating, Bootstrapping, or Mounted phase
        // This allows willUpdate to be called during:
        // - SSR: bootstrap() → render() → willUpdate() (from Creating/Bootstrapping)
        // - Client: connectedCallback() → willUpdate() (from Mounted)
        this._transitionToPhase(LifecyclePhase.Updating, [
            LifecyclePhase.Creating,
            LifecyclePhase.Bootstrapping,
            LifecyclePhase.Mounted
        ]);

        try {
            // Don't call registerSelf on updates - it's only for initial registration
            // This prevents re-initializing with old state from childrenStateRegistry
            this.initializeState();
            super.willUpdate(changedProperties);
        } finally {
            // Restore phase after update complete
            this._restorePhase();
        }
    }

    private registerSelf() {
        // Use __parent directly instead of RootContext
        // RootContext points to the App component, but we need the actual rendering parent
        const parent = this.getParentComponent();
        if (parent && parent !== this && this._id && typeof (parent as any).registerComponent === 'function') {
            (parent as any).registerComponent(this);
        } else {
            // Fall back to RootContext for root-level components
            const root = this.consume(RootContext);
            if (root && root !== this && this._id) {
                root.registerComponent(this);
            }
        }
    }

    public registerComponent(component: Cossack) {
        // If this component doesn't have the child state but is the App component,
        // it might be a client-side render where the actual parent is in the rendering tree.
        // Try to find the actual parent component that has the child state.
        if (!this._childrenStateRegistry[component._id] && this._id === 'root') {
            // Check current page first (if it exists and has the child state)
            if (this._currentPage && this._currentPage._childrenStateRegistry && this._currentPage._childrenStateRegistry[component._id]) {
                this._currentPage.registerComponent(component);
                return;
            }

            // Search through activeComponents to find the component that should have this child
            for (const [id, comp] of this.activeComponents) {
                if (comp._childrenStateRegistry && comp._childrenStateRegistry[component._id]) {
                    comp.registerComponent(component);
                    return;
                }
            }
        }

        if (component._id) {
            this.activeComponents.set(component._id, component);
            const childState = this._childrenStateRegistry[component._id];
            if (childState) {
                component.initializeState(childState);
            }
        }
    }

    // Set the current page component (for client-side rendering)
    public setCurrentPage(page: Cossack) {
        this._currentPage = page;
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
                this.setProperty(name, descriptor.value.bind(this));
            }
        }
    }

    /**
     * Transition to a new lifecycle phase with validation.
     * Prevents invalid state transitions that could cause bugs.
     */
    private _transitionToPhase(newPhase: LifecyclePhase, allowedFrom: LifecyclePhase[]): void {
        if (this._phase === LifecyclePhase.Destroyed) {
            throw new Error(`[Cossack] Cannot transition from Destroyed phase. Component has been destroyed.`);
        }

        if (!allowedFrom.includes(this._phase)) {
            throw new Error(
                `[Cossack] Invalid phase transition from ${this._phase} to ${newPhase}. ` +
                `Allowed transitions: ${allowedFrom.join(', ')}.`
            );
        }

        // Push current phase to stack for restoration
        this._phaseTransitionStack.push(this._phase);
        this._phase = newPhase;
    }

    /**
     * Restore the previous lifecycle phase.
     * Used when a lifecycle operation completes.
     */
    private _restorePhase(): void {
        const previousPhase = this._phaseTransitionStack.pop();
        if (previousPhase !== undefined) {
            this._phase = previousPhase;
        }
    }

    /**
     * Check if the component is in a specific lifecycle phase.
     */
    protected isInPhase(phase: LifecyclePhase): boolean {
        return this._phase === phase;
    }

    /**
     * Check if the component is in one of the specified lifecycle phases.
     */
    protected isInAnyPhase(phases: LifecyclePhase[]): boolean {
        return phases.includes(this._phase);
    }

    /**
     * Get the current lifecycle phase for debugging purposes.
     */
    public getPhase(): LifecyclePhase {
        return this._phase;
    }

    // ========== Type-safe internal property access helpers ==========

    /**
     * Get parent component from the render tree.
     */
    protected getParentComponent(): CossackElement | undefined {
        return (this as unknown as CossackElementInternal).__parent;
    }

    /**
     * Get a method by name with type-safe function access.
     * Returns undefined if the method doesn't exist or isn't a function.
     */
    protected getMethod(name: string): DynamicFunction | undefined {
        const value = (this as unknown as DynamicPropertyAccess)[name];
        return typeof value === 'function' ? (value as DynamicFunction) : undefined;
    }

    /**
     * Check if a method exists on this component.
     */
    protected hasMethod(name: string): boolean {
        return typeof (this as unknown as DynamicPropertyAccess)[name] === 'function';
    }

    /**
     * Get a property value by name.
     */
    protected getProperty(name: string): unknown {
        return (this as unknown as DynamicPropertyAccess)[name];
    }

    /**
     * Set a property value by name.
     */
    protected setProperty(name: string, value: unknown): void {
        (this as unknown as DynamicPropertyAccess)[name] = value;
    }

    /**
     * Get the initial state from window (client-side only).
     */
    protected getInitialStateFromWindow(): SerializedComponentState | undefined {
        if (typeof window === 'undefined') return undefined;
        const win = window as unknown as CossackInternalState;
        return win.__INITIAL_STATE__;
    }

    /**
     * Get internal element properties from CossackElement base class.
     */
    protected getElementInternal(): CossackElementInternal {
        return this as unknown as CossackElementInternal;
    }

    public async bootstrap({ container, initialState, context, user, env, page, providerName, skipInit }: { container?: Element | string, initialState?: any, context?: Context | HydratedContext, user?: AuthenticatedUser, env?: any, page?: string, providerName?: string, skipInit?: boolean } = {}) {
        // Transition to Bootstrapping phase from Creating phase
        this._transitionToPhase(LifecyclePhase.Bootstrapping, [LifecyclePhase.Creating]);

        try {
            this.isBootstrapping = true;

            if (!this._id) this._id = 'root';

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
            const clientInitialState = initialState || this.getInitialStateFromWindow();
            // Access metadata from the new state structure
            const metadata = clientInitialState?.metadata || {};
            this.user = metadata.user;
            const clientParams = metadata.params || {};
            this._cossack_path = metadata.pathname || window.location.pathname;

            // Capture component reference for the getter
            const component = this;
            const hydratedContext: HydratedContext = {
                req: {
                    param: (key?: string) => key ? clientParams[key] : clientParams,
                    get path() { return (this as any)._component?._cossack_path || component._cossack_path; },
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

        // Provide Contexts (After initialization)
        this.provide(RootContext, this);
        this.provide(EnvContext, this.env);
        this.provide(UserContext, this.user);
        this.provide(RequestContext, this.c);

        this.initializeState(initialState);

        // Restore children state registry for nested component initialization
        if (initialState?.children) {
            this._childrenStateRegistry = initialState.children;
        }

        // Run tasks after state initialization
        await this.runTasks();

        if (this.isServer) {
            this.proxyClientMethods();
        } else {
            const clientInitialState = initialState || this.getInitialStateFromWindow();
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

        // Mount to DOM if we have a container (for root/app components)
        if (this.container && !this.isServer) {
            this.skipRenderTasks = true;
            this.mount(this.container as HTMLElement);
            this.skipRenderTasks = false;
        }

        // Call onMount() and clientInit() for all components (not just those with containers)
        // Page components don't have containers, but they still need their lifecycle hooks
        if (!this.isServer && !this.isMounted) {
            this.isMounted = true;
            this.onMount();

            // Run clientInit() if it exists - for client-only initialization
            // that should show loading state on initial page load
            if (this.hasMethod('clientInit')) {
                const clientInitMethod = this.getMethod('clientInit');
                if (clientInitMethod) {
                    (clientInitMethod as any)().catch((err: Error) => console.error('clientInit error:', err));
                }
            }
        }
        } finally {
            // Restore phase after bootstrap complete
            this._restorePhase();
        }
    }

    private _wrapLifecycleMethods() {
        const wrap = (methodName: 'init' | 'get' | 'clientInit') => {
            // Get the original method from the prototype, before any proxy is set up
            const proto = Object.getPrototypeOf(this);
            const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
            const original = descriptor?.value;
            if (!original || typeof original !== 'function') return;

            const wrapped = async (...args: any[]) => {
                this.loading.init = (this.loading.init || 0) + 1;
                if (!this.isServer && this.container) {
                    this.requestUpdate();
                }
                try {
                    return await (original as any).apply(this, args);
                } finally {
                    this.loading.init--;
                    if (this.loading.init <= 0) delete this.loading.init;
                    if (!this.isServer && this.container) {
                        this.requestUpdate();
                    }
                }
            };
            (wrapped as any).__cossack_wrapped = true;
            this.setProperty(methodName, wrapped);
        };

        wrap('init');
        wrap('get');
        // Wrap clientInit if it exists for client-only initialization with loading state
        wrap('clientInit');
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
        const actionMethod = this.getMethod(action);
        if (actionMethod) {
            this._cossack_ws_context = clientContext;
            try {
                await (actionMethod as any)(...(payload || []), user);
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
        const initialState = this.getInitialStateFromWindow();
        const providerTargets = initialState?.providerTargets || {};

        for (const providerName in providerTargets) {
            const target = providerTargets[providerName];

            // Access metadata from the new state structure
            const componentPath = initialState?.metadata?.componentPath;
            if (!componentPath) {
                console.error('[Cossack] Cannot connect WebSocket: componentPath not found in initial state.');
                continue;
            }

            const pathname = initialState?.metadata?.pathname;
            const params = new URLSearchParams({
                componentPath,
                pathname: pathname || '',
                ...(initialState?.metadata?.params || {}),
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
                    // Update public state from the new structure
                    const stateUpdate = data.state || {};
                    for (const key in stateUpdate) {
                        if (key === 'loading' || key === 'isServer' || key === 'params') continue;
                        this.setProperty(key, stateUpdate[key]);
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
                    if (clientMethods[action] && this.hasMethod(action)) {
                        const method = this.getMethod(action);
                        (method as any)(...payload);
                    }
                } else if (data.type === 'event') {
                    const { eventName, payload } = data;
                    const eventHandlers = Reflect.getMetadata('cossack:event-handlers', this.constructor) || {};
                    if (eventHandlers[eventName]) {
                        for (const handlerMethod of eventHandlers[eventName]) {
                            if (this.hasMethod(handlerMethod)) {
                                const method = this.getMethod(handlerMethod);
                                (method as any)(...payload);
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
        const initialState = this.getInitialStateFromWindow();
        const componentRouteId = initialState?.componentRouteId;
        if (!componentRouteId) {
            console.error('[Cossack] Cannot create HTTP proxies: componentRouteId not found in initial state.');
            return;
        }

        const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', this.constructor) || {};

        for (const method of serverMethods) {
            const { name } = method;
            const proxy = async (...args: any[]) => {
                // Optimistic UI Handler
                if (optimisticHandlers[name] && this.hasMethod(optimisticHandlers[name])) {
                    try {
                        const optimisticMethod = this.getMethod(optimisticHandlers[name]);
                        (optimisticMethod as any)(...args);
                        this.requestUpdate();
                    } catch (e) {
                        console.error(`Error in optimistic handler for '${name}':`, e);
                    }
                }

                this.loading[name] = (this.loading[name] || 0) + 1;
                this.requestUpdate();
                // Optimistic UI Handler
                if (optimisticHandlers[name] && this.hasMethod(optimisticHandlers[name])) {
                    try {
                        const optimisticMethod = this.getMethod(optimisticHandlers[name]);
                        (optimisticMethod as any)(...args);
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
                        if (this._id) formData.append('target', this._id);
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
                                    const progressValue = this.getProperty(progressProp);
                                    if (typeof progressValue === 'number') {
                                        this.setProperty(progressProp, percentComplete);
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
                                            this.setProperty(key, data[key]);
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
                                target: this._id,
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
                            this.setProperty(key, data[key]);
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

            // Store proxy in the map so stubbed methods can find it
            this.__cossack_proxies.set(name, proxy);

            // Set the method on the instance
            this.setProperty(name, proxy);
        }
    }

    @Client()
    private proxyServerMethods(serverMethods: { name: string, channel: string, provider: string }[]) {
        const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', this.constructor) || {};

        for (const method of serverMethods) {
            const { name, channel, provider } = method;
            const originalMethod = this.getMethod(name);
            const proxy = (...args: any[]) => {
                let ws = this.websockets.get(provider);
                if (!ws) {
                    const root = this.consume(RootContext);
                    if (root) {
                        ws = (root as any).websockets.get(provider);
                    }
                }

                if (ws && ws.readyState === WebSocket.OPEN) {
                    // Optimistic UI Handler
                    if (optimisticHandlers[name] && this.hasMethod(optimisticHandlers[name])) {
                        try {
                            const optimisticMethod = this.getMethod(optimisticHandlers[name]);
                            (optimisticMethod as any)(...args);
                            this.requestUpdate(); // Render immediately after optimistic update
                        } catch (e) {
                            console.error(`Error in optimistic handler for '${name}':`, e);
                        }
                    }

                    this.loading[name] = (this.loading[name] || 0) + 1;
                    this.requestUpdate();

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
                        target: this._id,
                    }));
                } else {
                    console.error(`WebSocket for provider '${provider}' not connected. Cannot call server method '${name}'.`);
                }
            };

            // Store proxy in the map so stubbed methods can find it
            this.__cossack_proxies.set(name, proxy);

            // Set the method on the instance
            this.setProperty(name, proxy);
        }
    }

    private async runTasks() {
        if (this.isRunningTasks) return;
        this.isRunningTasks = true;
        try {
            const tasks = Reflect.getMetadata('cossack:tasks', this.constructor) || [];
            for (const task of tasks) {
                if (this.hasMethod(task)) {
                    try {
                        const taskMethod = this.getMethod(task);
                        const result = (taskMethod as any)();
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
                if (this.hasMethod(propertyKey)) {
                    const method = this.getMethod(propertyKey);
                    attach(this.container, eventName, method as any);
                }
            }
        }

        // 2. @OnDocument
        if (typeof document !== 'undefined') {
            const documentEvents = Reflect.getMetadata('cossack:document-events', this.constructor) || [];
            for (const { eventName, propertyKey } of documentEvents) {
                if (this.hasMethod(propertyKey)) {
                    const method = this.getMethod(propertyKey);
                    attach(document, eventName, method as any);
                }
            }
        }

        // 3. @OnWindow
        if (typeof window !== 'undefined') {
            const windowEvents = Reflect.getMetadata('cossack:window-events', this.constructor) || [];
            for (const { eventName, propertyKey } of windowEvents) {
                if (this.hasMethod(propertyKey)) {
                    const method = this.getMethod(propertyKey);
                    attach(window, eventName, method as any);
                }
            }
        }
    }

    private setupVisibleTasks() {
        if (this.isServer) return;

        const visibleTasks = Reflect.getMetadata('cossack:visible-tasks', this.constructor) || [];
        for (const { propertyKey, options } of visibleTasks) {
            const strategy = options.strategy || 'intersection-observer';

            if (!this.hasMethod(propertyKey)) continue;

            const execute = () => {
                 try {
                     const method = this.getMethod(propertyKey);
                     const cleanup = (method as any)();
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

    /**
     * Initialize state properties using the unified state container.
     * This method sets up reactive getters/setters for all @State and @ClientState properties.
     */
    private initializeState(serializedState?: SerializedComponentState) {
        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        const clientStateProperties = Reflect.getMetadata('cossack:client-state', this.constructor) || new Set();

        const stateKeys = Object.keys(stateProperties);
        const clientKeys = Array.from(clientStateProperties) as string[];
        const allKeys = [...new Set([...stateKeys, ...clientKeys])];

        // Determine the state source based on environment
        // Ensure stateSource is always a Record<string, unknown> for type-safe indexing
        const stateSource: Record<string, unknown> = this.isServer
            ? (serializedState?.public || {})
            : (serializedState?.public || (this._id === 'root' ? this.getInitialStateFromWindow()?.public : undefined) || {});

        for (const key of allKeys) {
            // Skip if this property has already been initialized (to prevent resetting state)
            if (this._stateContainer.isInitialized(key)) {
                continue;
            }

            const isClientOnly = clientStateProperties.has(key);
            const isPublic = stateProperties[key];

            // Get initial value from state source or from existing property value
            let value = this.getProperty(key);

            // Only sync properties that are NOT client-only
            if (!isClientOnly && stateSource && stateSource[key] !== undefined) {
                value = stateSource[key];
            }

            // Store in the appropriate container
            if (isPublic) {
                this._stateContainer.setPublic(key, value);
            } else {
                this._stateContainer.setInternal(key, value);
            }

            // Create reactive property with getter/setter
            Object.defineProperty(this, key, {
                get: () => {
                    return isPublic
                        ? this._stateContainer.getPublic(key)
                        : this._stateContainer.getInternal(key);
                },
                set: (newValue: any) => {
                    const oldValue = isPublic
                        ? this._stateContainer.getPublic(key)
                        : this._stateContainer.getInternal(key);

                    if (oldValue !== newValue) {
                        // Update the container
                        if (isPublic) {
                            this._stateContainer.setPublic(key, newValue);
                        } else {
                            this._stateContainer.setInternal(key, newValue);
                        }

                        // Handle reactivity based on state type
                        if (isPublic) {
                            // Public state: sync to server and trigger re-render
                            if (this.isServer) {
                                this._scheduleStateBroadcast(key);
                            } else if (!this.isBootstrapping) {
                                this.requestUpdate(key, oldValue);
                            }
                        } else {
                            // Client-only state: just trigger re-render on client
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

        // Setup server method proxies for nested components (client-side only)
        if (!this.isServer && serializedState?.serverMethods) {
            this._setupServerMethodProxies(serializedState.serverMethods);
        }
    }

    /**
     * Schedule state broadcast to connected clients.
     * Batches updates and broadcasts them together via microtask.
     */
    private _scheduleStateBroadcast(changedKey: string) {
        this.dirtyProperties.add(changedKey);
        if (!this.broadcastScheduled) {
            this.broadcastScheduled = true;
            queueMicrotask(async () => {
                await this.runTasks();
                const partialState: Record<string, any> = {};
                for (const key of this.dirtyProperties) {
                    partialState[key] = this._stateContainer.getPublic(key);
                }

                this._runtime?.broadcastState(partialState);
                this._runtime?.persistState();
                this.dirtyProperties.clear();
                this.broadcastScheduled = false;
            });
        }
    }

    /**
     * Setup server method proxies for nested components.
     * Skips re-proxying if methods have already been proxied.
     */
    private _setupServerMethodProxies(serverMethods: Array<{ name: string; channel: string; provider: string }>) {
        if (this._serverMethodsProxied) {
            return; // Already proxied
        }

        const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', this.constructor);

        if (pageOptions?.transport === 'http') {
            this.proxyHttpMethods(serverMethods);
        } else {
            this.proxyServerMethods(serverMethods);
        }
        this._serverMethodsProxied = true;
    }

    @Server()
    private proxyClientMethods() {
        const clientMethods = Reflect.getMetadata('cossack:client-methods', this.constructor) || {};
        for (const key in clientMethods) {
            if (!this.hasMethod(key)) continue;

            this.setProperty(key, (...args: any[]) => {
                if (!this.isServer) {
                    console.warn(`[Cossack] Client method '${String(key)}' cannot be called from the client.`);
                    return;
                }
                if (!this._cossack_ws_context) {
                    console.warn(`[Cossack] Client method '${String(key)}' was called from a non-WebSocket context and could not be sent.`);
                    return;
                }
                this._runtime?.sendClientAction(this._cossack_ws_context, key, args);
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
        if (this.loading.init && this.hasMethod('loadingTemplate')) {
            const method = this.getMethod('loadingTemplate');
            return (method as any)();
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
        if (method && this.hasMethod(method)) {
            const methodFn = this.getMethod(method);
            // Call with proper 'this' context - method returns true to PREVENT navigation
            return await (methodFn as any).call(this);
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
        
        pushCurrentInstance(this);
        this.resetRenderState();

        const template = this._getWrappedTemplate();
        
        let res = '';
        if (template) {
            if (this.isServer) {
                if (isTemplateResult(template)) {
                    res = renderToString(template);
                } else {
                    res = renderToString(html`${template}`);
                }
            }
        }
        
        popCurrentInstance();
        return res;
    }

    public getInitialHtml(): string {
        return this._render();
    }
    
    // Override performUpdate to wrap template with devtools markers for client-side rendering
    protected async performUpdate() {
        await Promise.resolve();
        let shouldUpdate = false;
        const elementInternal = this.getElementInternal();
        const changedProperties = elementInternal.__changedProperties;
        const controllers = elementInternal.__controllers;
        try {
            shouldUpdate = this.shouldUpdate(changedProperties);
            if (shouldUpdate) {
                // Controller hostUpdate
                controllers.forEach((c: any) => c.hostUpdate && c.hostUpdate());

                this.willUpdate(changedProperties);

                this.resetRenderState();
                pushCurrentInstance(this);

                const template = this._getWrappedTemplate();

                elementInternal.__notifyListeners(template);

                popCurrentInstance();

                this.updated(changedProperties);

                // Controller hostUpdated
                controllers.forEach((c: any) => c.hostUpdated && c.hostUpdated());
            }
        } catch (e) {
            console.error('Error during update:', e);
            if (instanceStack[instanceStack.length - 1] === this) {
                popCurrentInstance();
            }
        }

        elementInternal.__changedProperties = new Map();
        elementInternal.__updatePromise = null;
        return shouldUpdate;
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

    /**
     * Serialize the component's state for transmission between server and client.
     * Returns a unified SerializedComponentState containing public state, metadata, and children.
     */
    public getInitialState(): SerializedComponentState {
        const params = (this.c as Context)?.req.param() || {};

        // Build the serialized state object
        const serializedState: SerializedComponentState = {
            public: this._stateContainer.getPublicState(),
            metadata: {
                componentId: this.constructor.name,
                pathname: (this.c as Context)?.req.path,
                params,
                user: this.user,
            },
        };

        // Add server methods metadata
        let serverMethodsMetadata = Reflect.getMetadata('cossack:server-methods', this.constructor) || {};

        // On server side, automatically detect methods without decorators as server-only
        if (this.isServer) {
            const clientSafeMethods = new Set(
                Object.keys(Reflect.getMetadata('cossack:client-methods', this.constructor) || {})
            );
            const optimisticHandlers = Reflect.getMetadata('cossack:optimistic-handlers', this.constructor) || {};
            const computedMethods = Reflect.getMetadata('computed', this.constructor) || {};

            // Add client-safe methods to the set
            Object.values(optimisticHandlers).forEach((handler: any) => clientSafeMethods.add(handler));
            Object.keys(computedMethods).forEach(key => clientSafeMethods.add(key));

            // Add @PreventNavigation() decorated methods as client-safe
            const preventNavigationMethod = Reflect.getMetadata('cossack:prevent-navigation', this.constructor);
            if (preventNavigationMethod) {
                clientSafeMethods.add(preventNavigationMethod);
            }

            // Scan for methods without decorators (server-only by default)
            const proto = Object.getPrototypeOf(this);
            const propertyNames = Object.getOwnPropertyNames(proto);

            const builtInMethods = new Set([
                'constructor', 'render', 'head', 'onMount', 'onCleanup', 'escapeHtml',
                'loadingTemplate', 'toString', 'valueOf', 'getProperty', 'setProperty',
                'hasMethod', 'getMethod', 'getInitialState', 'getPublicState',
                'registerComponent', 'setCurrentPage', 'bootstrap', 'destroy',
                'initializeState', 'initializeProviders', 'connectWebSocket',
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
                'clientInit' // Client-only initialization method
            ]);

            for (const name of propertyNames) {
                if (builtInMethods.has(name)) continue;
                if (clientSafeMethods.has(name)) continue;
                if (name.startsWith('_')) continue; // Skip private properties

                const descriptor = Object.getOwnPropertyDescriptor(proto, name);
                if (descriptor && typeof descriptor.value === 'function') {
                    // This is a method without any client-safe decorator - mark as server-only
                    if (!serverMethodsMetadata[name]) {
                        serverMethodsMetadata[name] = { channel: 'global', provider: 'page', __serverOnly: true };
                    }
                }
            }
        }

        serializedState.serverMethods = Object.entries(serverMethodsMetadata).map(([name, options]: [string, any]) => ({
            name,
            channel: options.channel || 'global',
            provider: options.provider || 'page',
        }));

        const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', this.constructor);
        if (pageOptions?.transport === 'http') {
            return serializedState;
        }

        // Add provider targets for WebSocket connections
        const providerTargets: Record<string, string> = {};
        if (this.providers) {
            for (const [name, provider] of this.providers.entries()) {
                const target = provider.getConnectionTarget();
                if (target) {
                    providerTargets[name] = (target as any).toString();
                }
            }
        }
        serializedState.providerTargets = providerTargets;

        // Add nested children states
        const childrenState: Record<string, SerializedComponentState> = {};
        for (const [id, comp] of this.activeComponents) {
            childrenState[id] = comp.getInitialState();
        }
        serializedState.children = childrenState;

        return serializedState;
    }

    /**
     * Get only the public state (for HTTP transport state sync).
     * This is a simple accessor that returns the public state from the container.
     */
    public getPublicState(): Record<string, unknown> {
        return this._stateContainer.getPublicState();
    }

    public destroy() {
        // Transition to Destroyed phase from any phase except already Destroyed
        this._transitionToPhase(LifecyclePhase.Destroyed, [
            LifecyclePhase.Creating,
            LifecyclePhase.Bootstrapping,
            LifecyclePhase.Mounted,
            LifecyclePhase.Updating
        ]);

        try {
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
        } finally {
            // Don't restore phase after destroy - the component is destroyed
            // This ensures any subsequent operations will throw an error
        }
    }
}