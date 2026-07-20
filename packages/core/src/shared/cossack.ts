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
import type { TaskRegistration } from './decorators';
import { enterRender, exitRender, isRendering as isRenderingFn } from './server-fn';
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
    isRpcCallableAction,
} from './method-proxy';
import { isSharedMethod } from './shared-method';
import { HeadTag, HeadContext, HeadValue, composeHead as composeHeadFn, type Headed } from './head';
import {
    buildHeadContext as buildHeadContextFn,
    mergeHead as mergeHeadFn,
    applyHeadTags as applyHeadTagsFn,
} from './head';
import { createCossackContext, HydratedContext, EnvContext, UserContext, RequestContext, CossackContext } from './context';
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
import { createStoreProxy, isPlainObjectOrArray, matchesTrackedPath } from './store';
import { flashed, old } from './flash';
import { LifecyclePhase } from './component-types';
import { supportsViewTransitions, type NavigateOptions } from '../client/navigation';
import type {
    ComponentState,
    SerializedComponentState,
    CossackOptions,
    BootstrapOptions,
    DynamicFunction,
    CossackElementInternal,
    CossackInternalState,
} from './component-types';
import type { User } from './user';
import type { RedirectStatusCode } from 'hono/utils/http-status';
import { ServerResourceSerializationError, type ServerResourceOptions } from './server-resource';

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

/**
 * Wraps `fn` in a trailing-edge debounce: each call resets the timer, so `fn`
 * only runs once after `ms` milliseconds of inactivity (with the latest args).
 * Shared by `@OnWindow({ debounce })`, `@OnDocument({ debounce })`, and the
 * `@Debounce(ms)` method decorator.
 */
function createDebounce(fn: Function, ms: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: any[]) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

/**
 * Wraps `fn` in a leading-edge throttle: the first call runs immediately, and
 * further calls within the `ms` window are ignored. Shared by
 * `@OnWindow({ throttle })`, `@OnDocument({ throttle })`, and the
 * `@Throttle(ms)` method decorator.
 */
function createThrottle(fn: Function, ms: number) {
    let lastCall = 0;
    return (...args: any[]) => {
        const now = Date.now();
        if (now - lastCall >= ms) {
            lastCall = now;
            fn(...args);
        }
    };
}

export abstract class Cossack<Env = any, T extends CossackOptions = {}> extends CossackElement {
    private _serverResources = new Map<string, {
        argsKey: string;
        value: unknown;
        hasValue: boolean;
        resolved: boolean;
        pending?: Promise<unknown>;
        error?: unknown;
    }>();

    private _serverResourceKey(
        name: string,
        args: readonly unknown[],
        subject: 'dependencies' | 'result' = 'dependencies',
    ): string {
        const seen = new WeakSet<object>();
        try {
            return JSON.stringify(args, (_key, value) => {
                if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
                    throw new TypeError(`unsupported dependency type ${typeof value}`);
                }
                if (value && typeof value === 'object') {
                    if (seen.has(value)) throw new TypeError('circular dependency');
                    seen.add(value);
                    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
                        throw new TypeError(`unsupported dependency ${value.constructor?.name || 'object'}`);
                    }
                    if (!Array.isArray(value)) {
                        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
                    }
                }
                return value;
            }) ?? '[]';
        } catch (error) {
            throw new ServerResourceSerializationError(name, `${subject} is not transport-safe: ${(error as Error).message}`);
        }
    }

    /** @internal Entry point emitted by the server$ compiler transform. */
    public __serverResource<TValue, TArgs extends readonly unknown[]>(
        name: string,
        loader: (...args: TArgs) => Promise<TValue> | TValue,
        options: ServerResourceOptions<TValue, TArgs> = {},
    ): TValue | undefined {
        const args = (options.deps?.() ?? []) as TArgs;
        const argsKey = this._serverResourceKey(name, args);
        let entry = this._serverResources.get(name);
        if (entry?.argsKey === '') entry.argsKey = argsKey;
        if (!entry || entry.argsKey !== argsKey) {
            entry = { argsKey, value: entry?.hasValue ? entry.value : options.initial, hasValue: entry?.hasValue || 'initial' in options, resolved: false };
            this._serverResources.set(name, entry);
        }
        if (!entry.resolved && !entry.pending && !entry.error) {
            entry.pending = Promise.resolve(loader(...args)).then((value) => {
                // Results use the same JSON-safe contract as hydration/RPC.
                this._serverResourceKey(name, [value], 'result');
                if (this._serverResources.get(name) !== entry || this._phase === LifecyclePhase.Destroyed) return value;
                entry!.value = value;
                entry!.hasValue = true;
                entry!.resolved = true;
                entry!.error = undefined;
                entry!.pending = undefined;
                if (!this.isServer) void this.requestUpdate();
                return value;
            }).catch((error) => {
                if (this._serverResources.get(name) === entry) {
                    entry!.pending = undefined;
                    entry!.error = error;
                    if (!this.isServer) console.error(`[Cossack server$:${name}]`, error);
                }
                if (this.isServer) throw error;
            });
        }
        return entry.value as TValue | undefined;
    }

    public async refresh$(name: string): Promise<void> {
        const entry = this._serverResources.get(name);
        if (!entry) throw new Error(`[Cossack] Unknown server$ resource "${name}".`);
        entry.error = undefined;
        entry.pending = undefined;
        entry.resolved = false;
        await this.requestUpdate();
        await this._serverResources.get(name)?.pending;
    }

    public invalidate$(name: string): void {
        if (!this._serverResources.delete(name)) throw new Error(`[Cossack] Unknown server$ resource "${name}".`);
        if (!this.isServer) void this.requestUpdate();
    }

    /** @internal Promises collected during the current synchronous SSR pass. */
    public __serverResourcePending(): Promise<unknown>[] {
        return [...this._serverResources.values()].flatMap((entry) => entry.pending ? [entry.pending] : []);
    }
    // Standard Properties
    protected container?: Element;
    protected isServer: boolean = isServer;
    
    private _c!: Context;
    private _user?: User;
    private _env!: Env;

    protected get c(): Context & CossackContext {
        // The context is wrapped by `createCossackContext`, whose proxy adds
        // `getFormData` at runtime. Cast through to the augmented type so
        // `this.c.getFormData` type-checks for developers.
        return (this._c || this.consume(RequestContext)) as Context & CossackContext;
    }
    protected set c(val: Context) {
        this._c = val;
    }

    protected get user(): User | undefined { return this._user || this.consume(UserContext); }
    protected set user(val: User | undefined) { this._user = val; }

    protected get env(): Env { return this._env || this.consume(EnvContext) as Env; }
    protected set env(val: Env) { this._env = val; }

    protected providers!: Map<string, StateProvider>;
    public props: Record<string, any> = {};

    // Component Registry (Server-Side mostly)
    public activeComponents: Map<string, Cossack> = new Map();

    // Unified State Management
    private _stateContainer = new StateContainer();
    /**
     * Top-level reactive Proxy caches for `@Store` / `@ClientStore` properties,
     * keyed by store property name. Child proxies (for nested objects/arrays)
     * live in the module-level WeakMap inside store.ts. The cache is invalidated
     * by the setter on whole-store reassignment so a fresh proxy tree is built
     * over the new target.
     */
    private _storeProxies = new Map<string, object>();
    /** Serialized children state for restoration during hydration */
    private _childrenStateRegistry: Record<string, SerializedComponentState> = {};

    // Track the current page component (client-side only)
    private _currentPage?: Cossack;

    // Track if server methods have been proxied to prevent re-proxying
    private _serverMethodsProxied = false;

    // Map of server-only method names to their proxy functions
    // This allows client methods to call server-only methods seamlessly
    public __cossack_proxies: Map<string, (...args: any[]) => any> = new Map();

    /**
     * Throw (dev) or warn (prod) if a server-only method is being invoked during
     * a render pass. Called by the client `@Server` stubs generated by the
     * security plugin so that a stripped method called from `render()` fails
     * loudly instead of returning a Promise that renders as "[object Promise]".
     */
    public __cossackAssertNotRendering(methodName?: string): void {
        // Uses the shared render-depth flag (see ./server-fn.ts).
        if (!isRenderingFn()) return;
        const msg =
            '[Cossack] ' +
            (methodName ? `${this.constructor.name}.${methodName}` : 'A server method') +
            ' was called during a synchronous render phase (render/head/loadingTemplate). Server methods return Promises that ' +
            'render as "[object Promise]". Move the call into an event handler, ' +
            'or load data in get()/init() before render.';
        const env = (globalThis as any).process?.env?.NODE_ENV;
        if (env === 'production') {
            // eslint-disable-next-line no-console
            console.warn(msg);
            return;
        }
        throw new Error(msg);
    }

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
     * Dotted paths of state changes accumulated since the last task run, used
     * to filter `@Task({ track })` deps. Top-level keys report as their own
     * name; nested store mutations report `storeKey.a.b`.
     */
    private _dirtyPaths: Set<string> = new Set();
    /**
     * Cleanup functions returned by tracked/untracked tasks, keyed by task
     * property key. Invoked before the next run of the task and on destroy().
     */
    private _taskCleanups: Map<string | symbol, () => unknown> = new Map();
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

            // Child components rendered via component() go through
            // connectedCallback() but NOT bootstrap(). Without this, their
            // onMount() / @On('mount') / setupEventListeners() / @VisibleTask
            // observers would never fire. Root/page components call
            // _frameworkMount() from bootstrap() (guarded by isMounted), so
            // this is a no-op for them.
            if (!this.isServer && !this.isMounted) {
                this.isMounted = true;
                this._frameworkMount();
            }
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

    public static composeHead(page: Headed, layouts: Headed[], app: Headed): HeadTag[] {
        return composeHeadFn(page, layouts, app);
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
    protected getMethod(name: string | symbol): DynamicFunction | undefined {
        const value = (this as any)[name];
        return typeof value === 'function' ? (value as DynamicFunction) : undefined;
    }

    /**
     * Check if a method exists on this component.
     */
    protected hasMethod(name: string | symbol): boolean {
        return typeof (this as any)[name] === 'function';
    }

    /**
     * Get a property value by name.
     */
    protected getProperty(name: string | symbol): unknown {
        return (this as any)[name];
    }

    /**
     * Set a property value by name.
     */
    protected setProperty(name: string | symbol, value: unknown): void {
        (this as any)[name] = value;
    }

    /**
     * Resolve an auto-bind value for a @State/@Store property from flash or old
     * input. Returns `undefined` on the client (or when no flash store is wired),
     * so the caller falls back to the class-field initializer. `opt` is `true`
     * (use the property name as the key) or an explicit key string (old-input
     * keys support dot-paths, e.g. `'address.street'`). `false`/`undefined`
     * mean "no binding" — return undefined to keep the initializer.
     */
    private _resolveFlashBinding(
        key: string,
        opt: boolean | string,
        kind: 'flash' | 'old',
    ): unknown {
        if (opt === undefined || opt === false) return undefined;
        const flashKey = opt === true ? key : opt;
        return kind === 'flash' ? flashed(flashKey) : old(flashKey);
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

        for (const [name, value] of Object.entries(initialState?.serverResources ?? {})) {
            this._serverResources.set(name, { argsKey: '', value, hasValue: true, resolved: true });
        }

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
            const serverMethods = Object.entries(serverMethodsMetadata)
                .filter(([name]) => !isSharedMethod(this.constructor, name))
                .map(([name, options]: [string, any]) => ({
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

        // Perform initialization (wrapped hooks). get()/init() are server-only;
        // the security plugin strips them from client bundles, so we must not
        // invoke them during hydration (use clientInit() for client-side setup).
        if (this.isServer) {
            await this.get();
            if (!skipInit) {
                await this.init();
            }
        }

        this.isBootstrapping = false;

        // Mount to DOM if we have a container (for root/app components).
        // Honour `deferMount`: when set, the caller takes responsibility for
        // invoking `mount()` once the component tree is fully composed. This is
        // critical for the client app bootstrap — mounting before the page
        // content is loaded would render the App shell with empty `children`,
        // wiping the SSR DOM and flashing an empty main (a major CLS source).
        if (this.container && !this.isServer && !deferMount) {
            this.skipRenderTasks = true;
            try {
                this.mount(this.container as HTMLElement);
            } finally {
                this.skipRenderTasks = false;
            }
        }

        // Call onMount() and clientInit() for all components (not just those with containers)
        // Page components don't have containers, but they still need their lifecycle hooks
        if (!this.isServer && !this.isMounted && !deferMount) {
            this.isMounted = true;
            this._frameworkMount();

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
                if (!this.isServer) {
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

    /**
     * Serialised queue of in-flight RPC actions on this instance.
     *
     * In a Durable Object (or Node adapter) a single component instance serves
     * many WebSocket clients, whose action messages can dispatch concurrently.
     * `_cossack_ws_context` (used by @Client method proxies to route
     * client-actions back to the originating socket) is per-instance state, so
     * overlapping actions would cross-route: client A's action body could fire
     * a @Client call against client B's socket. Serialising execution — one
     * action at a time per instance — eliminates the race. It also bounds
     * re-entrancy on shared component state.
     */
    private _actionQueue: Promise<void> = Promise.resolve();

    public executeAction(action: string, payload: any[], user: User | undefined, clientContext: unknown): Promise<void> {
        // Authorisation gate: only @Server-registered methods may be invoked
        // remotely. Without this, any public/inherited method (bootstrap,
        // setProperty, getPublicState, destroy, ...) would be callable by a
        // crafted WebSocket message, bypassing the client-side stripping.
        if (!isRpcCallableAction(this.constructor, action)) {
            return Promise.resolve();
        }
        // Chain onto the queue so actions run one at a time. The runner catches
        // its own errors so a failing action never breaks the chain for later
        // callers (and never surfaces as an unhandled rejection).
        const run = () => this._runAction(action, payload, user, clientContext);
        this._actionQueue = this._actionQueue.then(run, run);
        return this._actionQueue;
    }

    private async _runAction(action: string, payload: any[], user: any, clientContext: unknown): Promise<void> {
        const actionMethod = this.getMethod(action);
        if (!actionMethod) return;
        this._cossack_ws_context = clientContext;
        try {
            await (actionMethod as any)(...(payload || []), user);
        } catch (e) {
            // Error boundary: log and continue so the runtime doesn't receive an
            // unhandled rejection and so `loading[action]` is always released.
            console.error(`[Cossack] Error executing action '${action}':`, e);
        } finally {
            this._cossack_ws_context = undefined;
            const ws = clientContext as { readyState?: number; send: (d: string) => void };
            // Use the numeric literal (1 === WebSocket.OPEN) rather than the
            // global so this works in the Node adapter where `WebSocket` is
            // imported from 'ws' and may not be a global.
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'action-complete', action }));
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

    /**
     * Runs every registered task (`@Task` always; `@ServerTask` on the server;
     * `@ClientTask` on the client).
     *
     * When `changedPaths` is omitted (bootstrap mount run, SSR `_render`) all
     * tasks run. When it is provided (state broadcasts, client re-renders) a
     * task with a `track` list runs only if one of its tracked deps matches a
     * changed path (segment-wise prefix either direction — see
     * `matchesTrackedPath`); a task without `track` always runs (legacy
     * behavior).
     *
     * A task may return a cleanup function (React `useEffect` style). The
     * previous cleanup runs before each re-run, and all are drained on
     * `destroy()`.
     */
    /**
     * @returns `true` if the tasks ran, `false` if skipped (another run was in
     *           progress). Callers use the return value to decide whether to
     *           preserve accumulated paths for the in-progress run.
     */
    private async runTasks(changedPaths?: Set<string>): Promise<boolean> {
        if (this.isRunningTasks) return false;
        this.isRunningTasks = true;
        try {
            // Regular @Task — always runs (both server and client).
            const tasks: TaskRegistration[] =
                Reflect.getMetadata('cossack:tasks', this.constructor) || [];
            // @ServerTask — only runs on the server (body stripped on client).
            const serverTasks: TaskRegistration[] = this.isServer
                ? (Reflect.getMetadata('cossack:server-tasks', this.constructor) || [])
                : [];
            // @ClientTask — only runs on the client (skipped on server).
            const clientTasks: TaskRegistration[] = !this.isServer
                ? (Reflect.getMetadata('cossack:client-tasks', this.constructor) || [])
                : [];
            const allTasks = [...tasks, ...serverTasks, ...clientTasks];
            const isFilteredRun = changedPaths !== undefined;
            for (const { propertyKey: task, track } of allTasks) {
                if (isFilteredRun && track && track.length > 0) {
                    if (!track.some(dep => matchesTrackedPath(dep, changedPaths!))) {
                        continue;
                    }
                }
                if (this.hasMethod(task)) {
                    // Run the previous cleanup before re-invoking (React style).
                    this._runTaskCleanup(task);
                    try {
                        const taskMethod = this.getMethod(task);
                        const result = (taskMethod as any)();
                        const resolved = result instanceof Promise ? await result : result;
                        if (typeof resolved === 'function') {
                            this._taskCleanups.set(task, resolved as () => unknown);
                        }
                    } catch (e) {
                        console.error(`[Cossack] Error in task '${String(task)}':`, e);
                    }
                }
            }
        } finally {
            this.isRunningTasks = false;
        }
        return true;
    }

    /**
     * Invoke (and drop) the stored cleanup function for a task, if any.
     * Swallows errors so one failing cleanup can't abort sibling tasks.
     */
    private _runTaskCleanup(task: string | symbol) {
        const cleanup = this._taskCleanups.get(task);
        if (!cleanup) return;
        this._taskCleanups.delete(task);
        try {
            const result = cleanup();
            if (result instanceof Promise) {
                result.catch(e =>
                    console.error(`[Cossack] Error in task cleanup '${String(task)}':`, e),
                );
            }
        } catch (e) {
            console.error(`[Cossack] Error in task cleanup '${String(task)}':`, e);
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

        // Helper to attach and track events, with optional throttle/debounce
        const attach = (target: EventTarget, eventName: string, method: Function, options?: { throttle?: number; debounce?: number }) => {
            let handler = method.bind(this);
            if (options?.throttle) {
                handler = createThrottle(handler, options.throttle);
            } else if (options?.debounce) {
                handler = createDebounce(handler, options.debounce);
            }
            target.addEventListener(eventName, handler as EventListener);
            this.eventCleanupFns.push(() => target.removeEventListener(eventName, handler as EventListener));
        };

        // 1. @On (Component/Container Events)
        // Regular components delegate through their container element. Page and
        // layout components don't have one (their content is composed into the
        // App), so fall back to document-level delegation — a page-level @On
        // handler is expected to observe events across the whole page.
        const onTarget: EventTarget | undefined = this.container || (typeof document !== 'undefined' ? document : undefined);
        if (onTarget) {
            const domEvents = Reflect.getMetadata('cossack:dom-events', this.constructor) || [];
            for (const { eventName, propertyKey } of domEvents) {
                // Lifecycle events are handled by setupLifecycleEventHandlers()
                if (eventName === 'mount' || eventName === 'navigate-complete') continue;
                if (this.hasMethod(propertyKey)) {
                    const method = this.getMethod(propertyKey);
                    attach(onTarget, eventName, method as any);
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

    /**
     * Wraps methods decorated with `@Debounce(ms)` / `@Throttle(ms)` so any
     * direct call to them is rate-limited. Runs client-only and *after* server
     * method proxies are installed (`bootstrap` runs proxying before
     * `_frameworkMount`), so a `@Server` method gets its RPC *proxy*
     * debounced/throttled — ideal for search-as-you-type hitting the server.
     *
     * Each wrapper closes over its own timer/last-call timestamp, created fresh
     * per instance, so there is no leakage between component instances.
     */
    private setupRateLimitedMethods() {
        if (this.isServer) return;

        const apply = (metaKey: 'cossack:debounce' | 'cossack:throttle', wrap: (fn: Function, ms: number) => Function, kind: string) => {
            const entries: Record<string, number> | undefined = Reflect.getMetadata(metaKey, this.constructor);
            if (!entries) return;
            for (const propertyKey of Object.keys(entries)) {
                const ms = entries[propertyKey];
                if (!this.hasMethod(propertyKey)) {
                    console.warn(
                        `[Cossack] @${kind}(${ms}) is applied to '${propertyKey}' but the method ` +
                        `is not callable on the client. Pair it with @Client, @Shared, @On, or ` +
                        `@Server so the method (or its RPC proxy) is available client-side.`,
                    );
                    continue;
                }
                const bound = (this.getMethod(propertyKey) as any).bind(this);
                this.setProperty(propertyKey, wrap(bound, ms));
            }
        };

        apply('cossack:debounce', createDebounce, 'Debounce');
        apply('cossack:throttle', createThrottle, 'Throttle');
    }

    private setupVisibleTasks() {
        if (this.isServer) return;

        const visibleTasks = Reflect.getMetadata('cossack:visible-tasks', this.constructor) || [];
        for (const { propertyKey, options } of visibleTasks) {
            const strategy = options.strategy || 'intersection-observer';

            if (!this.hasMethod(propertyKey)) continue;

            if (strategy === 'document-ready') {
                try {
                    const method = this.getMethod(propertyKey);
                    (method as any).call(this, null, null);
                } catch (e) {
                    console.error(`[Cossack] Error in visible task '${String(propertyKey)}':`, e);
                }
                continue;
            }

            if (strategy === 'intersection-observer') {
                if (!this.container) {
                     console.warn(`[Cossack] Cannot setup intersection observer for '${String(propertyKey)}': container not found.`);
                     continue;
                }

                // Collect initial target elements. When a selector is provided we
                // observe every match; otherwise we observe the container itself.
                let initialTargets: Element[] = [];
                if (options.selector) {
                    initialTargets = Array.from(this.container.querySelectorAll(options.selector));
                    if (initialTargets.length === 0) {
                        console.warn(`[Cossack] VisibleTask '${String(propertyKey)}' specifies selector '${options.selector}', but no elements were found in the component container.`);
                        // Fall through: refreshVisibleTasks() may add targets later.
                    }
                } else {
                    initialTargets = this.container ? [this.container] : [];
                }

                const observed = new Set<Element>(initialTargets);

                const observer = new IntersectionObserver((entries) => {
                    for (const entry of entries) {
                        if (!entry.isIntersecting) continue;
                        try {
                            const method = this.getMethod(propertyKey);
                            (method as any).call(this, entry.target, entry);
                        } catch (e) {
                            console.error(`[Cossack] Error in visible task '${String(propertyKey)}':`, e);
                        }
                        // Run once per element: unobserve THIS element only so
                        // selector-matched siblings can still fire independently.
                        observer.unobserve(entry.target);
                        observed.delete(entry.target);
                    }
                }, { threshold: options.threshold || 0 });

                for (const el of initialTargets) {
                    observer.observe(el);
                }

                this._visibleTaskObservers.set(propertyKey, { observer, observed });
            }
        }
    }

    /**
     * Initialize state properties using the unified state container.
     * Sets up reactive getters/setters for all @State, @ClientState,
     * @Store, and @ClientStore properties.
     *
     * @State / @ClientState use a plain reactive setter (reassignment triggers
     * reactivity). @Store / @ClientStore additionally wrap their value in a
     * recursive reactive Proxy (see store.ts) so nested mutations trigger the
     * same broadcast / re-render path at any depth.
     */
    private initializeState(serializedState?: SerializedComponentState) {
        const stateProperties = Reflect.getMetadata('cossack:state', this.constructor) || {};
        const clientStateProperties = Reflect.getMetadata('cossack:client-state', this.constructor) || new Set();
        const storeProperties = Reflect.getMetadata('cossack:store', this.constructor) || {};
        const clientStoreProperties = Reflect.getMetadata('cossack:client-store', this.constructor) || new Set();

        const stateKeys = Object.keys(stateProperties);
        const clientKeys = Array.from(clientStateProperties) as string[];
        const storeKeys = Object.keys(storeProperties);
        const clientStoreKeys = Array.from(clientStoreProperties) as string[];
        const allKeys = [...new Set([...stateKeys, ...clientKeys, ...storeKeys, ...clientStoreKeys])];

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

            // Determine the kind of state for this key.
            const isStore = !!storeProperties[key] || clientStoreProperties.has(key);
            const isClientOnly = clientStateProperties.has(key) || clientStoreProperties.has(key);
            const isPublic = !isClientOnly; // @State / @Store are public; @ClientState / @ClientStore are internal

            // Get initial value from state source or from existing property value
            let value = this.getProperty(key);

            // Auto-bind from flash/old (server-only). `flash`/`old` are set via
            // @State/@Store options; the bound value wins over the class-field
            // initializer, mirroring the manual `old('x') ?? ''` pattern. On the
            // client flashed()/old() return undefined, so the initializer is kept
            // and the SSR-bound value arrives via the hydration overlay below.
            const flashOpt = (stateProperties[key]?.flash ?? storeProperties[key]?.flash) as boolean | string | undefined;
            const oldOpt = flashOpt === undefined
                ? (stateProperties[key]?.old ?? storeProperties[key]?.old) as boolean | string | undefined
                : undefined;
            if (flashOpt !== undefined) {
                const bound = this._resolveFlashBinding(String(key), flashOpt, 'flash');
                if (bound !== undefined) value = bound;
            } else if (oldOpt !== undefined) {
                const bound = this._resolveFlashBinding(String(key), oldOpt, 'old');
                if (bound !== undefined) value = bound;
            }

            // Only sync properties that are NOT client-only
            if (!isClientOnly && stateSource && stateSource[key] !== undefined) {
                value = stateSource[key];
            }

            // Store the raw value in the appropriate container. Object/array
            // store values are wrapped in a Proxy on read (lazily); primitive
            // store values behave like a plain @State (reassignment triggers
            // reactivity). Coercion is intentionally avoided so primitives
            // (string/number/boolean) keep their real value.
            if (isPublic) {
                this._stateContainer.setPublic(key, value);
            } else {
                this._stateContainer.setInternal(key, value);
            }

            // The reactive trigger shared by the plain setter and the store
            // Proxy. Routes to broadcast (server, public) or requestUpdate
            // (client), honoring the bootstrapping suppression. `path` carries
            // the dotted mutation path for `@Task({ track })` filtering.
            const triggerReactivity = (path?: string) => {
                const current = isPublic
                    ? this._stateContainer.getPublic(key)
                    : this._stateContainer.getInternal(key);
                this._applyStateChange(key, current, current, isPublic, path);
            };

            if (isStore) {
                // Helper: only object/array values get a reactive Proxy.
                // Primitives are returned raw so methods like trim()/toFixed()
                // work, and so serialization reflects the real value.
                const readStoreValue = () => {
                    const raw = isPublic
                        ? this._stateContainer.getPublic(key)
                        : this._stateContainer.getInternal(key);
                    // Only plain objects/arrays are wrapped in a reactive Proxy.
                    // Built-ins (Date/Map/Set/RegExp) and class instances are
                    // returned raw — proxying them throws on method calls.
                    if (raw === null || typeof raw !== 'object' || !isPlainObjectOrArray(raw)) {
                        return raw;
                    }
                    // Object/array: return the cached top-level proxy so nested
                    // mutations are reactive. Child proxies (nested objects/
                    // arrays) live in the module-level WeakMap inside store.ts.
                    let cached = this._storeProxies.get(key);
                    if (!cached) {
                        cached = createStoreProxy(
                            raw as Record<PropertyKey, unknown>,
                            key,
                            (_storeKey, path) => triggerReactivity(path),
                        );
                        this._storeProxies.set(key, cached);
                    }
                    return cached;
                };

                Object.defineProperty(this, key, {
                    get: () => readStoreValue(),
                    set: (newValue: any) => {
                        const oldValue = isPublic
                            ? this._stateContainer.getPublic(key)
                            : this._stateContainer.getInternal(key);

                        if (oldValue !== newValue) {
                            if (isPublic) {
                                this._stateContainer.setPublic(key, newValue);
                            } else {
                                this._stateContainer.setInternal(key, newValue);
                            }
                            // Drop the cached proxy so the next read builds a
                            // fresh proxy tree over the new target (or returns
                            // a raw primitive if newValue is not an object).
                            this._storeProxies.delete(key);

                            if (import.meta.env.DEV) {
                                console.log(`[Cossack] Store change: ${key}`, oldValue, '->', newValue);
                            }
                            triggerReactivity();
                        } else if (import.meta.env.DEV) {
                            console.log(`[Cossack] Store change suppressed (same value): ${key}`, oldValue);
                        }
                    },
                    enumerable: true,
                    configurable: true,
                });
            } else {
                // Plain @State / @ClientState reactive getter/setter.
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
                            this._applyStateChange(key, oldValue, newValue, isPublic);
                        } else if (import.meta.env.DEV) {
                            console.log(`[Cossack] State change suppressed (same value): ${key}`, oldValue);
                        }
                    },
                    enumerable: true,
                    configurable: true,
                });
            }
        }

        // Setup server method proxies for nested components (client-side only)
        if (!this.isServer) {
            this._setupServerMethodProxies();
        }
    }

    /**
     * Apply a state change through the reactivity pipeline. Shared by the
     * @State/@ClientState setters and the @Store/@ClientStore Proxy triggers.
     *
     * - Public state (@State/@Store) on the server: schedule a broadcast to
     *   connected clients + persistence.
     * - Public state on the client: request a re-render (unless bootstrapping).
     * - Client-only state (@ClientState/@ClientStore): re-render on the client
     *   only (never broadcast).
     *
     * The `oldValue`/`newValue` are forwarded to `requestUpdate` for lifecycle
     * hooks (PropertyValues); for store Proxy triggers they are the same store
     * reference (the nested mutation did not reassign the top-level object).
     */
    private _applyStateChange(
        key: string,
        oldValue: unknown,
        newValue: unknown,
        isPublic: boolean,
        path?: string,
    ): void {
        // Record the dotted path for `@Task({ track })` filtering. For nested
        // store mutations `path` is `storeKey.a.b`; for plain state / top-level
        // assignments it falls back to the property key.
        this._dirtyPaths.add(path ?? String(key));
        if (isPublic) {
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
        // Reference newValue so it is part of the signature for future hooks;
        // currently only forwarded indirectly via the broadcast payload.
        void newValue;
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
                // Snapshot so async tasks don't observe paths added during the
                // run, and clear so the next cycle starts fresh. If runTasks
                // early-returns (isRunningTasks), the snapshot is unused but
                // _dirtyPaths was already cleared — so re-add the paths to keep
                // them visible to the in-progress run.
                const paths = new Set(this._dirtyPaths);
                this._dirtyPaths.clear();
                const ran = await this.runTasks(paths);
                if (!ran) {
                    // Another run was in progress; preserve these paths for it.
                    for (const p of paths) this._dirtyPaths.add(p);
                }
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
            if (isSharedMethod(this.constructor, key)) continue;
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

    public async validateProperty(propertyName: string, trigger?: 'input' | 'blur' | 'submit'): Promise<boolean> {
        return validatePropertyFn(this, propertyName, trigger);
    }

    public async validateAll(trigger?: 'input' | 'blur' | 'submit'): Promise<boolean> {
        return validateAllFn(this, trigger);
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
        // Mark the head window so a @Server method invoked from head() is caught
        // (same footgun as render(): a server call returns a Promise the head
        // machinery would stringify as "[object Promise]"). See `_render`.
        enterRender();
        let value: HeadValue;
        try {
            value = this.head(emptyCtx);
        } finally {
            exitRender();
        }
        const tags = Cossack.mergeHead(emptyCtx, value);
        const serialized = JSON.stringify(tags);
        if (serialized === this._lastHeadTags) return;
        this._lastHeadTags = serialized;
        Cossack.applyHeadTags(tags);
    }

    public _getWrappedTemplate(): TemplateResult | null {
        // Mark the render window around every render()/loadingTemplate()
        // invocation. `_getWrappedTemplate` is the single chokepoint used by
        // `_render()` and `performUpdate()` (this package) AND by the framework's
        // direct composition calls (router.ts / ssg-renderer.ts / client app.ts),
        // so guarding here covers all paths uniformly. A @Server method invoked
        // from render()/loadingTemplate() returns a Promise the synchronous
        // renderer would stringify as "[object Promise]"; the client stubs call
        // `__cossackAssertNotRendering` which throws in dev / warns in prod.
        enterRender();
        try {
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
        } finally {
            exitRender();
        }
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

        // `_getWrappedTemplate` self-guards the render window (so that direct
        // framework callers — router/ssg-renderer/client app — are covered too,
        // not just `_render`/`performUpdate`), so no enterRender/exitRender wrap
        // is needed here.
        const template = this._getWrappedTemplate();

        let res = '';
        if (template) {
            if (this.isServer) {
                // Emit hydratable SSR (node positions wrapped in marker
                // comments) so the client can hydrate the existing DOM in
                // place instead of wiping and rebuilding it. Controlled by a
                // static flag so non-hydrating SSR contexts can opt out.
                const ssrOpts = Cossack.SSR_HYDRATABLE ? { hydrate: true } : {};
                if (isTemplateResult(template)) {
                    res = renderToString(template, ssrOpts);
                } else {
                    res = renderToString(html`${template}`, ssrOpts);
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

                // Run @Task methods before willUpdate/render. On the server,
                // tasks run during `bootstrap()` and state broadcasts. On the
                // client, `_render()` also calls `runTasks()` — this block
                // ensures the same happens during client-side prop-driven
                // re-renders via `performUpdate()`. Without it, tasks only fire
                // on mount and on the component's own @State broadcasts, never
                // on a prop change (e.g. a Modal reacting to an `open` prop).
                if (!this.skipRenderTasks) {
                    // Snapshot so tasks (some async) see a stable view; clear
                    // so the next render cycle starts fresh. If runTasks is
                    // already in progress (early-returns), re-add the paths so
                    // the in-progress run observes them instead of dropping them.
                    const paths = new Set(this._dirtyPaths);
                    this._dirtyPaths.clear();
                    void this.runTasks(paths).then(ran => {
                        if (!ran) for (const p of paths) this._dirtyPaths.add(p);
                    });
                }

                this.willUpdate(changedProperties);

                this.resetRenderState();
                pushCurrentInstance(this);

                // `_getWrappedTemplate` self-guards the render window (see `_render`).
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

    // ========== Lifecycle hooks ==========
    //
    // These are user-facing hooks. The base implementations are intentionally
    // empty — the framework runs its own lifecycle setup (@VisibleTask observers,
    // event listeners, @On('mount') / @On('navigate-complete') handlers) via
    // _frameworkMount() and _frameworkNavigateComplete(), which are called by
    // the framework at the appropriate times. Override these hooks freely;
    // no super call is needed.

    /**
     * Called once after the component's first client render. Override to
     * initialize client-only state, start timers, or kick off side effects.
     * No need to call `super.onMount()`.
     */
    public onMount(): void {}

    /**
     * Called immediately before the component is destroyed. Override to
     * release resources, close connections, or cancel timers. No need to
     * call `super.onCleanup()`.
     */
    public onCleanup(): void {}

    /**
     * Called after every SPA navigation completes on the App, active layouts,
     * and current page. Override to react to route changes in persistent
     * layouts without wiring document-level navigation events. No need to
     * call `super.onNavigateComplete()`.
     */
    public onNavigateComplete(pathname: string): void {}

    /**
     * @internal Called by the framework during bootstrap and client init.
     * Runs the internal lifecycle setup (visible-task observers, @On('mount')
     * handlers, DOM event listeners), then calls the user's `onMount()` hook.
     */
    public _frameworkMount(): void {
        this.setupVisibleTasks();
        this.setupLifecycleEventHandlers();
        this.setupEventListeners();
        this.setupRateLimitedMethods();
        this.onMount();
    }

    /**
     * @internal Called by the framework after SPA navigation. Refreshes
     * visible-task observers, fires @On('navigate-complete') handlers, then
     * calls the user's `onNavigateComplete()` hook.
     */
    public _frameworkNavigateComplete(pathname: string): void {
        this.refreshVisibleTasks();
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
        this.onNavigateComplete(pathname);
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

    public static _onNavigate?: (url: string, options?: NavigateOptions) => Promise<void>;

    /**
     * When true (default), server-side rendering emits hydratable marker
     * comments around dynamic node positions so the client can hydrate the
     * existing DOM in place. Set to false for SSR contexts that do not pair
     * with client hydration (e.g. rendering to a string for email/API output).
     */
    public static SSR_HYDRATABLE = true;

    public redirect(url: string, status?: RedirectStatusCode): Response | void;
    public redirect(url: string, options: { status?: RedirectStatusCode; types?: string[] }): Response | void;
    @Server()
    public redirect(
        url: string,
        statusOrOptions: RedirectStatusCode | { status?: RedirectStatusCode; types?: string[] } = 302,
    ): Response | void {
        if (!this.isServer) {
            const opts = typeof statusOrOptions === 'object' ? statusOrOptions : {};
            const types = opts.types;
            if (Cossack._onNavigate) {
                // _onNavigate (the SPA entry) performs the navigation AND the
                // history.pushState on success. Pushing state here too would
                // create two history entries per redirect (Back needed twice).
                Cossack._onNavigate(url, types ? { types } : undefined);
            } else {
                window.location.href = url;
            }
            return;
        }
        const status = typeof statusOrOptions === 'object' ? (statusOrOptions.status ?? 302) : statusOrOptions;
        // Return the Response so API/HTTP handlers (createApiHandler) propagate
        // the redirect. The CRPC path also reads c.res.headers Location.
        return this.c.redirect(url, status);
    }

    /**
     * Redirect back to the previous page (the request's `Referer`), with an
     * optional fallback if there is no referer. Pairs naturally with `flash()`
     * for the POST→redirect→GET pattern:
     *
     *   async post() {
     *     flash('success', 'Saved!');
     *     return this.back('/forms');   // must `return` to propagate the redirect
     *   }
     *
     * Returns the redirect Response on the server (like `redirect()`); performs
     * client-side `history.back()` on the client, falling back to the URL.
     */
    public back(fallback = '/'): Response | void {
        if (!this.isServer) {
            if (typeof history !== 'undefined' && history.length > 1) {
                history.back();
                return;
            }
            return this.redirect(fallback);
        }
        const referer = this.c.req.header('referer') || fallback;
        return this.c.redirect(referer, 302);
    }

    /**
     * Wrap a DOM-mutating callback in a same-route View Transition.
     *
     * Use this to animate state changes that don't involve a navigation —
     * tab switches, list reordering, expanding a panel, etc. On the server,
     * or when the browser lacks View Transitions support, the callback runs
     * directly with no transition.
     *
     * `types` correspond to `::view-transition-group(.<type>)` CSS selectors
     * and let authors apply different animations per call site.
     *
     * The returned promise resolves with the callback's result once the
     * transition's snapshot is ready (i.e. after the reactive re-render
     * triggered by the callback has committed). If the browser skips the
     * transition (e.g. a subsequent transition supersedes it), the promise
     * still resolves with the callback's result.
     */
    public async startViewTransition<T>(
        callback: () => T | Promise<T>,
        types?: string[],
    ): Promise<T | void> {
        if (this.isServer || !supportsViewTransitions()) {
            return await callback();
        }
        let result: T | undefined;
        const update = async () => {
            result = await callback();
            // Ensure the reactive re-render commits before the browser
            // snapshots the new state.
            await this.requestUpdate();
        };
        const transition = types && types.length
            ? (document as any).startViewTransition({ update, types })
            : (document as any).startViewTransition(update);
        await transition.updateReady;
        return result;
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
        if (this._serverResources.size) {
            serializedState.serverResources = Object.fromEntries(
                [...this._serverResources].filter(([, entry]) => entry.hasValue).map(([name, entry]) => [name, entry.value]),
            );
        }

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
            // Drain task cleanup functions (React `useEffect` style). Runs on
            // both server and client since tasks themselves run on both.
            for (const taskKey of [...this._taskCleanups.keys()]) {
                this._runTaskCleanup(taskKey);
            }
            this._taskCleanups.clear();
            if (!this.isServer) {
                this.websockets.forEach(ws => {
                    ws.close();
                });
                this.websockets.clear();

                if (this._sseConnection) {
                    this._sseConnection.close();
                    this._sseConnection = undefined;
                }

                // Disconnect @VisibleTask IntersectionObservers — otherwise they
                // retain references to the destroyed component and keep firing
                // callbacks that mutate destroyed state.
                this._visibleTaskObservers.forEach(({ observer }) => observer.disconnect());
                this._visibleTaskObservers.clear();

                // Clean up event listeners
                this.eventCleanupFns.forEach(cleanup => cleanup());
                this.eventCleanupFns = [];

                // Drop cached store proxies so their raw targets (and the
                // component's state) can be GC'd once the component is gone.
                this._storeProxies.clear();
            }
        } finally {
            // Don't restore phase after destroy - the component is destroyed
            // This ensures any subsequent operations will throw an error
        }
    }
}
