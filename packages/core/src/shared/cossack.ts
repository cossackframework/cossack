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
import { Client, PageOptions, Server, ClientState } from './decorators';
import type { Context } from 'hono';
import type { CossackServerRuntime } from './runtime';
import { StateProvider } from './StateProvider';
import {
    initializeProviders as initializeProvidersFn,
    connectWebSocket as connectWebSocketFn,
    connectSSE as connectSSEFn,
} from './transport-connections';
import {
    proxyHttpMethods as proxyHttpMethodsFn,
    proxyServerMethods as proxyServerMethodsFn,
    setupServerMethodProxies as setupServerMethodProxiesFn,
} from './method-proxy';
import { HeadTag, HeadContext, HeadValue } from './head';
import {
    buildHeadContext as buildHeadContextFn,
    mergeHead as mergeHeadFn,
    applyHeadTags as applyHeadTagsFn,
} from './head';
import { createCossackContext, HydratedContext, EnvContext, UserContext, RequestContext } from './context';
import {
    getError as getErrorFn,
    hasError as hasErrorFn,
    validateProperty as validatePropertyFn,
    validateAll as validateAllFn,
    clearErrors as clearErrorsFn,
    clearValidationError as clearValidationErrorFn,
    setValidationError as setValidationErrorFn,
    getValidationErrorProperty as getValidationErrorPropertyFn,
} from './validation';
import {
    bootstrapServices as bootstrapServicesFn,
    registerServiceState as registerServiceStateFn,
    forwardServiceMethods as forwardServiceMethodsFn,
    proxyServiceMethods as proxyServiceMethodsFn,
    findServiceInstance as findServiceInstanceFn,
    getConstructorParamNames as getConstructorParamNamesFn,
} from './service-bootstrap';
import { StateContainer } from './state-container';
import { LifecyclePhase } from './component-types';
import type {
    ComponentState,
    SerializedComponentState,
    CossackOptions,
    BootstrapOptions,
    DynamicFunction,
    CossackElementInternal,
    CossackInternalState,
    DynamicPropertyAccess,
} from './component-types';
import type { AuthenticatedUser } from './user';
import type { RedirectStatusCode } from 'hono/utils/http-status';

// Re-export public types so `export * from './shared/cossack'` in index.ts
// continues to surface them to consumers. Split runtime vs type-only so
// bundlers with isolatedModules don't try to resolve types as values.
export { LifecyclePhase };
export type {
    ComponentState,
    SerializedComponentState,
    CossackOptions,
    BootstrapOptions,
};

export const RootContext = createContext<Cossack | null>(null);

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
    private _sseConnection?: EventSource;

    public loading: Record<string, number> = {};
    private _lastHeadTags?: string;

    // Tracks @State keys modified by optimistic handlers per action
    private _optimisticLockedKeys: Record<string, Set<string>> = {};
    // Buffers server state updates for locked keys
    private _optimisticPendingState: Record<string, any> = {};

    // Track observed elements per visible task for auto-refresh on navigation
    private _visibleTaskObservers: Map<string | symbol, { observer: IntersectionObserver, observed: Set<Element> }> = new Map();

    private _isOptimisticLocked(key: string): boolean {
        for (const action of Object.keys(this._optimisticLockedKeys)) {
            if (this.loading[action] && this._optimisticLockedKeys[action]?.has(key)) {
                return true;
            }
        }
        return false;
    }

    @Server()
    private _runtime?: CossackServerRuntime;

    private dirtyProperties: Set<string> = new Set();
    private broadcastScheduled: boolean = false;
    private isMounted: boolean = false;
    private skipRenderTasks: boolean = false;
    private isRunningTasks: boolean = false;
    private isBootstrapping: boolean = false;
    private eventCleanupFns: (() => void)[] = [];
    /**
     * Method keys registered via `@On('navigate-complete')`. Stored so the
     * framework can invoke them whenever `onNavigateComplete()` runs.
     */
    private _navigateCompleteHandlers: (string | symbol)[] = [];

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
        // Skip if component is already destroyed
        if (this._phase === LifecyclePhase.Destroyed) {
            return;
        }

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
        return buildHeadContextFn(tags);
    }

    public static mergeHead(context: HeadContext, value: HeadValue): HeadTag[] {
        return mergeHeadFn(context, value);
    }

    public static applyHeadTags(tags: HeadTag[]) {
        applyHeadTagsFn(tags);
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
     * Bootstrap services injected via constructor parameters.
     * Delegates to bootstrapServices() in service-bootstrap.ts.
     */
    private _bootstrapServices(): void {
        bootstrapServicesFn(this);
    }

    private _registerServiceState(serviceInstance: any): void {
        registerServiceStateFn(this, serviceInstance);
    }

    private _forwardServiceMethods(serviceInstance: any): void {
        forwardServiceMethodsFn(this, serviceInstance);
    }

    private _proxyServiceMethods(serviceInstance: any): void {
        proxyServiceMethodsFn(this, serviceInstance);
    }

    private _findServiceInstance(serviceClass: new (...args: any[]) => any): any | null {
        return findServiceInstanceFn(this, serviceClass);
    }

    private _getConstructorParamNames(): string[] {
        return getConstructorParamNamesFn(this);
    }

    /**
     * Transition to a new lifecycle phase with validation.
     * Prevents invalid state transitions that could cause bugs.
     */
    private _transitionToPhase(newPhase: LifecyclePhase, allowedFrom: LifecyclePhase[]): void {
        // Silently return if component is destroyed (defensive programming)
        if (this._phase === LifecyclePhase.Destroyed) {
            return;
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

    public async bootstrap({ container, initialState, context, user, env, page, providerName, skipInit, deferMount }: BootstrapOptions = {}) {
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

        // Bootstrap injected services
        this._bootstrapServices();

        // Restore children state registry for nested component initialization
        if (initialState?.children) {
            this._childrenStateRegistry = initialState.children;
        }

        // Run tasks after state initialization
        await this.runTasks();

        if (this.isServer) {
            this.proxyClientMethods();
        } else {
            const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', this.constructor);

            // Get server methods directly from Reflect metadata instead of serialized state
            const serverMethodsMetadata = Reflect.getMetadata('cossack:server-methods', this.constructor) || {};
            const serverMethods = Object.entries(serverMethodsMetadata).map(([name, options]: [string, any]) => ({
                name,
                channel: options.channel || 'global',
                provider: options.provider || 'page',
            }));

            if (pageOptions?.transport === 'http') {
                this.proxyHttpMethods(serverMethods);
            } else if (pageOptions?.transport === 'sse') {
                this.connectSSE();
                this.proxyHttpMethods(serverMethods);
            } else {
                this.connectWebSocket();
                this.proxyServerMethods(serverMethods);
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
        if (!this.isServer && !this.isMounted && !deferMount) {
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
                    if (!this.isServer) {
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
        initializeProvidersFn(this);
    }

    @Client()
    private connectWebSocket() {
        connectWebSocketFn(this);
    }

    @Client()
    private connectSSE() {
        connectSSEFn(this);
    }

    @Client()
    private proxyHttpMethods(serverMethods: { name: string }[]) {
        proxyHttpMethodsFn(this, serverMethods);
    }

    @Client()
    private proxyServerMethods(serverMethods: { name: string, channel: string, provider: string }[]) {
        proxyServerMethodsFn(this, serverMethods);
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

    /**
     * Processes `@On('mount')` and `@On('navigate-complete')` lifecycle event
     * handlers registered via the `@On` decorator.
     *
     * - `'mount'` handlers run immediately (called once during `onMount()`).
     * - `'navigate-complete'` handlers are stored in `_navigateCompleteHandlers`
     *   and replayed every time `onNavigateComplete()` runs.
     *
     * This is a client-only feature; it is a no-op on the server.
     */
    private setupLifecycleEventHandlers() {
        if (this.isServer) return;

        const domEvents = Reflect.getMetadata('cossack:dom-events', this.constructor) || [];
        for (const { eventName, propertyKey } of domEvents) {
            if (eventName === 'mount') {
                if (this.hasMethod(propertyKey)) {
                    try {
                        (this.getMethod(propertyKey) as any).call(this);
                    } catch (e) {
                        console.error(`[Cossack] Error in @On('mount') handler '${String(propertyKey)}':`, e);
                    }
                }
            } else if (eventName === 'navigate-complete') {
                this._navigateCompleteHandlers.push(propertyKey);
            }
        }
    }

    private setupEventListeners() {
        if (this.isServer) return;

        // Throttle helper
        const throttle = (fn: Function, ms: number) => {
            let lastCall = 0;
            return (...args: any[]) => {
                const now = Date.now();
                if (now - lastCall >= ms) {
                    lastCall = now;
                    fn(...args);
                }
            };
        };

        // Debounce helper
        const debounce = (fn: Function, ms: number) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            return (...args: any[]) => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => fn(...args), ms);
            };
        };

        // Helper to attach and track events, with optional throttle/debounce
        const attach = (target: EventTarget, eventName: string, method: Function, options?: { throttle?: number; debounce?: number }) => {
            let handler = method.bind(this);
            if (options?.throttle) {
                handler = throttle(handler, options.throttle);
            } else if (options?.debounce) {
                handler = debounce(handler, options.debounce);
            }
            target.addEventListener(eventName, handler as EventListener);
            this.eventCleanupFns.push(() => target.removeEventListener(eventName, handler as EventListener));
        };

        // 1. @On (Component/Container Events)
        if (this.container) {
            const domEvents = Reflect.getMetadata('cossack:dom-events', this.constructor) || [];
            for (const { eventName, propertyKey } of domEvents) {
                // Lifecycle events are handled by setupLifecycleEventHandlers()
                if (eventName === 'mount' || eventName === 'navigate-complete') continue;
                if (this.hasMethod(propertyKey)) {
                    const method = this.getMethod(propertyKey);
                    attach(this.container, eventName, method as any);
                }
            }
        }

        // 2. @OnDocument
        if (typeof document !== 'undefined') {
            const documentEvents = Reflect.getMetadata('cossack:document-events', this.constructor) || [];
            for (const { eventName, propertyKey, options } of documentEvents) {
                if (this.hasMethod(propertyKey)) {
                    const method = this.getMethod(propertyKey);
                    attach(document, eventName, method as any, options);
                }
            }
        }

        // 3. @OnWindow
        if (typeof window !== 'undefined') {
            const windowEvents = Reflect.getMetadata('cossack:window-events', this.constructor) || [];
            for (const { eventName, propertyKey, options } of windowEvents) {
                if (this.hasMethod(propertyKey)) {
                    const method = this.getMethod(propertyKey);
                    attach(window, eventName, method as any, options);
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

                // Track observer and observed elements for refreshVisibleTasks()
                const observed = new Set<Element>();
                observed.add(targetElement);
                this._visibleTaskObservers.set(propertyKey, { observer, observed });
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

                        if (import.meta.env.DEV) {
                            console.log(`[Cossack] State change: ${key}`, oldValue, '->', newValue);
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
                            } else if (import.meta.env.DEV && this.isBootstrapping) {
                                console.warn(`[Cossack] requestUpdate suppressed during bootstrapping for "${key}".`);
                            }
                        }
                    } else if (import.meta.env.DEV) {
                        console.log(`[Cossack] State change suppressed (same value): ${key}`, oldValue);
                    }
                },
                enumerable: true,
                configurable: true,
            });
        }

        // Setup server method proxies for nested components (client-side only)
        if (!this.isServer) {
            this._setupServerMethodProxies();
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

    private _setupServerMethodProxies() {
        setupServerMethodProxiesFn(this);
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

    // ========== Validation Methods ==========

    public getError(propertyName: string): string | undefined {
        return getErrorFn(this, propertyName);
    }

    public hasError(propertyName: string): boolean {
        return hasErrorFn(this, propertyName);
    }

    public async validateProperty(propertyName: string): Promise<boolean> {
        return validatePropertyFn(this, propertyName);
    }

    public async validateAll(): Promise<boolean> {
        return validateAllFn(this);
    }

    public clearErrors(): void {
        clearErrorsFn(this);
    }

    private clearValidationError(propertyName: string): void {
        clearValidationErrorFn(this, propertyName);
    }

    private setValidationError(propertyName: string, message: string): void {
        setValidationErrorFn(this, propertyName, message);
    }

    private getValidationErrorProperty(): string {
        return getValidationErrorPropertyFn(this);
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
        const serialized = JSON.stringify(tags);
        if (serialized === this._lastHeadTags) return;
        this._lastHeadTags = serialized;
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
        // Skip if component is destroyed
        if (this._phase === LifecyclePhase.Destroyed) {
            return false;
        }

        await Promise.resolve();

        // Check again after async boundary (component may have been destroyed during await)
        // Use type assertion to avoid TS narrowing issue
        if ((this._phase as LifecyclePhase) === LifecyclePhase.Destroyed) {
            return false;
        }

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
        this.setupLifecycleEventHandlers();
        this.setupEventListeners();
    }
    public onCleanup(): void {}

    public onNavigateComplete(pathname: string): void {
        // Override in subclass. Fires after SPA navigation completes.
        this.refreshVisibleTasks();
        // Invoke @On('navigate-complete') handlers (App-only in practice, since
        // the framework only calls this on the App instance).
        for (const propertyKey of this._navigateCompleteHandlers) {
            const key = String(propertyKey);
            if (this.hasMethod(key)) {
                try {
                    (this.getMethod(key) as any).call(this, pathname);
                } catch (e) {
                    console.error(`[Cossack] Error in @On('navigate-complete') handler '${String(propertyKey)}':`, e);
                }
            }
        }
    }

    private refreshVisibleTasks() {
        const visibleTasks = Reflect.getMetadata('cossack:visible-tasks', this.constructor) || [];
        for (const { propertyKey, options } of visibleTasks) {
            const observerInfo = this._visibleTaskObservers?.get(propertyKey);
            if (!observerInfo) continue;
            const { observer, observed } = observerInfo;
            const selector = options.selector;
            if (!selector || !this.container) continue;
            const elements = Array.from(this.container.querySelectorAll(selector));
            for (const el of elements) {
                if (!observed.has(el as Element)) {
                    observer.observe(el as Element);
                    (observed as Set<Element>).add(el as Element);
                }
            }
        }
    }

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

        // Note: serverMethods is no longer included in serialized state for security.
        // Client-side proxies are set up using Reflect metadata directly in _setupServerMethodProxies.

        const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', this.constructor);
        if (pageOptions?.transport === 'http' || pageOptions?.transport === 'sse') {
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

                if (this._sseConnection) {
                    this._sseConnection.close();
                    this._sseConnection = undefined;
                }

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