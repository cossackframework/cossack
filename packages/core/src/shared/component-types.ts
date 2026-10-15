// src/shared/component-types.ts
import type { TemplateResult, CossackElement } from '@cossackframework/renderer';
import type { Context } from 'hono';
import type { User } from './user';
import type { HydratedContext } from './context';

/**
 * Lifecycle phases for explicit state management and preventing invalid transitions.
 *
 * A component moves `Creating` → `Mounted` → `Destroyed`. `Bootstrapping` and
 * `Updating` are transient: they last while `bootstrap()` or `willUpdate()`
 * runs. A live, idle component reports `Mounted`.
 */
export enum LifecyclePhase {
    /** Constructed, but not yet bootstrapped or connected */
    Creating = 'Creating',
    /** bootstrap() is running */
    Bootstrapping = 'Bootstrapping',
    /** Bootstrapped or connected by the renderer, and not updating */
    Mounted = 'Mounted',
    /** willUpdate() is running */
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
    /** State owned by this layout's declared services, keyed by stable slot. */
    services?: Record<string, Record<string, unknown>>;
    /** Internal state values (only present for client-side restoration) */
    internal?: Record<string, unknown>;
    /** Metadata needed for initialization */
    metadata?: {
        componentId: string;
        /** @deprecated Use routePath instead - kept for backward compatibility */
        componentPath?: string;
        /** Simplified route path (e.g., /hello/[name] instead of /src/pages/hello/[name]/index.ts) */
        routePath?: string;
        pathname?: string;
        /** Public path and query for destination-owned hydration. */
        url?: string;
        params?: Record<string, string>;
    };
    /**
     * Browser-visible user (`{ id }` plus `publicUser` fields). Set once, at
     * the root of the page hydration payload; layout, App and child states
     * never repeat it.
     */
    user?: User;
    /**
     * Server-computed realtime instance for the page's WebSocket connection
     * (`durable-object`/`websocket` transports). The server recomputes it from
     * the page identity or scope key for every upgrade; it never authorizes.
     */
    realtimeTarget?: string;
    /**
     * Server-computed realtime connection of this page or layout. A layout's
     * state carries its own; `null` means the owner has none for this request
     * (for example, its scope failed) and stays offline.
     */
    realtime?: { owner: 'page' | 'layout'; target: string } | null;
    /**
     * Server-computed targets of the realtime child components rendered by
     * this page, its layouts and the App, by registry id. The page payload
     * carries it once, at its root.
     */
    realtimeComponents?: Record<string, string>;
    /** Nested children states */
    children?: Record<string, SerializedComponentState>;
    /** Component route ID for HTTP transport */
    componentRouteId?: string;
    /** App component route ID for HTTP transport (used for global App methods) */
    appRouteId?: string;
    /** Route path at top level for easier access */
    routePath?: string;
    /** Transport mode for this page (set by router) */
    transport?: string;
    /** Scope key for SSE/DO transport (computed once during SSR) */
    scopeKey?: string;
    /** Resolved compiler-generated server$ invocations. */
    serverResources?: Record<string, { argsKey: string; value: unknown }>;
    /** Runtime-specific, browser-safe metadata contributed by an adapter. */
    runtime?: Record<string, unknown>;
}

export interface CossackOptions {
  Channels?: string;
  /** Optional explicit contract for named server$ values and lifecycle methods. */
  Resources?: string;
}

export type CossackRuntimePlatform = 'web' | 'desktop';

/** Runtime identity available to component server methods and hydrated clients. */
export interface CossackRuntimeInfo extends Record<string, unknown> {
  platform: CossackRuntimePlatform;
  adapter?: string;
}

/**
 * Options for {@link Cossack.bootstrap}.
 * All fields are optional; pass `{}` (or omit) to bootstrap with defaults.
 */
export interface BootstrapOptions {
  /** CSS selector or Element to mount the component into. */
  container?: Element | string;
  /** Serialized state used to hydrate the component (typically from SSR output). */
  initialState?: any;
  /** Hono request context (server) or hydrated client context. */
  context?: Context | HydratedContext;
  /** Authenticated user, if any. */
  user?: User;
  /** Environment bindings (server) or emulated env (client). */
  env?: any;
  /** Runtime target and adapter metadata. Defaults to the web platform. */
  runtime?: CossackRuntimeInfo;
  /** Current page route identifier. */
  page?: string;
  /** Skip calling `init()` after bootstrap. */
  skipInit?: boolean;
  /**
   * Skip calling `get()` after bootstrap. HTTP verb handlers set this: `get()`
   * is the GET handler itself, so it must not run before `post()` or twice
   * for a GET.
   */
  skipGet?: boolean;
  /** Defer `onMount()`/`clientInit()` to a later manual call. */
  deferMount?: boolean;
  /** @internal Prepare navigation without binding shared services or activating browser hooks. */
  stageNavigation?: boolean;
}

// ========== Internal type helpers (not exported publicly) ==========

/** Dynamic method/function type that can be called with any arguments */
export type DynamicFunction = (...args: unknown[]) => unknown;

/** Map of component methods by name */
export type ComponentMethods = Record<string, DynamicFunction>;

/** Internal properties from CossackElement that need to be accessed */
export interface CossackElementInternal {
    /** Parent component in the render tree */
    __parent?: CossackElement & { registerComponent?(comp: any): void };
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
export interface CossackInternalState {
    /** Initial state loaded from window for hydration */
    __INITIAL_STATE__?: SerializedComponentState;
}

/** Dynamic property access interface for state properties */
export interface DynamicPropertyAccess {
    [key: string]: unknown;
}

/**
 * State keys that are framework-internal and must never be overwritten by an
 * incoming state update from the server (they hold framework bookkeeping, not
 * application state). Centralised so every state-merge site agrees.
 */
export const RESERVED_STATE_KEYS: ReadonlySet<string> = new Set([
    'loading',
    'isServer',
    'params',
]);
