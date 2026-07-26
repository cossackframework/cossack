// src/shared/decorators.ts
import './metadata';
import type { MiddlewareHandler, Context } from 'hono';
import { isServer } from './environment';
import { CossackOptions } from './cossack';
import { StateProvider } from './StateProvider';
import { createRef } from './ref';
import { ValidationRule, ValidationConfig, ValidationRulesStore, StoreRuleMap, setValidationRules, flattenRuleTree } from './validation';
import type { ServiceClass } from './container';

export type Middleware = MiddlewareHandler;
export type CossackTransport = 'durable-object' | 'websocket' | 'http' | 'sse';

export interface PageOptions {
  middlewares?: Middleware[];
  channels?: string[];
  providers?: { [key: string]: StateProvider };
  /** Services owned by this layout and shared throughout its active subtree. */
  services?: ServiceClass[];
  transport?: CossackTransport;
  route?: string;
  ssg?: boolean | SsgOptions;
  stateful?: boolean;
  /**
   * Determines which state backend (SSE store entry or Durable Object instance)
   * a request connects to. Receives the Hono Context and returns a scope key string.
   *
   * - SSE default: per-user (`user:${user?.id || 'anonymous'}`)
   * - DO default: per-URL (current behavior, no change)
   *
   * @example
   * ```typescript
   * // Per-team
   * @Page({ transport: 'sse', scope: (c) => `team:${c.get('user').teamId}` })
   *
   * // Shared broadcast
   * @Page({ transport: 'sse', scope: () => 'shared' })
   * ```
   */
  scope?: (c: Context) => string | Promise<string>;
}

export interface SsgOptions {
  enabled?: boolean;
  generateStaticParams?: () => Promise<Record<string, string>[]>;
}

export function Page(options: PageOptions = {}): ClassDecorator {
  return (target: object) => {
    const existingOptions = Reflect.hasOwnMetadata('page:options', target)
      ? Reflect.getOwnMetadata('page:options', target)
      : {};

    const mergedOptions: PageOptions = {
      transport: 'http',
      ...existingOptions,
      ...options,
    };

    // Ensure 'global' is always a channel if channels are defined
    if (mergedOptions.channels && !mergedOptions.channels.includes('global')) {
      mergedOptions.channels.unshift('global');
    } else if (!mergedOptions.channels) {
      mergedOptions.channels = ['global'];
    }
    Reflect.defineMetadata('page:options', mergedOptions, target);
  };
}

/**
 * Decorator for reusable components. 
 * Currently behaves like @Page but semantic distinction is important for future tooling.
 */
export function Component(options: PageOptions = {}): ClassDecorator {
    return Page(options);
}

const noop = () => {};

/**
 * Discriminate the two `rules` shapes by VALUE, not by key name.
 *
 * - A single `ValidationRule` (for `@State`/`@ClientState`) has values that
 *   are primitives (`boolean`/`number`/`string`), a `RegExp` (for `pattern`),
 *   or a `Function` (for `custom`/`customAsync`).
 * - A rule-map (for `@Store`/`@ClientStore`) maps field paths to nested
 *   `ValidationRule` objects — so its values are themselves plain objects.
 *
 * Discriminating by value is robust against store field names that collide
 * with rule keys (e.g. a store with a field literally named `required` or
 * `message`), which would defeat a key-name-based heuristic.
 */
function isValidationRuleMap(rules: Record<string, unknown>): boolean {
    const values = Object.values(rules);
    if (values.length === 0) return false;
    // Map shape: at least one value is a plain object (a nested ValidationRule).
    // A single rule never has a plain-object value (RegExp is special-cased;
    // custom/customAsync are functions).
    return values.some(v =>
        v !== null
        && typeof v === 'object'
        && !(v instanceof RegExp),
    );
}

export interface ServerOptions {
  channel?: string;
  provider?: string;
  /** @internal Compiler marker for generated server$ loaders. */
  serverResource?: boolean;
}

/**
 * A "universal" decorator that marks a method or property as server-only.
 * This decorator attaches metadata, and the Cossack base class handles the logic
 * of replacing the member with a WebSocket proxy on the client.
 */
export function Server(options: ServerOptions = {}): any {
  return (target: any, propertyKey: string | symbol) => {
    const serverMethods = Reflect.hasOwnMetadata('cossack:server-methods', target.constructor)
      ? Reflect.getOwnMetadata('cossack:server-methods', target.constructor)
      : {};

    serverMethods[propertyKey] = {
      channel: options.channel || 'global',
      provider: options.provider || 'page',
      ...(options.serverResource ? { serverResource: true } : {}),
    };
    Reflect.defineMetadata('cossack:server-methods', serverMethods, target.constructor);
  };
}

export interface ClientOptions {
  channel?: string;
}

export function Client(options: ClientOptions = {}): any {
  return (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => {
    const metadataStoreKey = 'cossack:client-methods';
    const existingMetadata = Reflect.hasOwnMetadata(metadataStoreKey, target.constructor)
      ? Reflect.getOwnMetadata(metadataStoreKey, target.constructor)
      : {};

    // The server needs the channel for proxying.
    // The client just needs a flag to know the method is callable.
    existingMetadata[propertyKey] = isServer
      ? { channel: options.channel || 'global' }
      : true;

    Reflect.defineMetadata(metadataStoreKey, existingMetadata, target.constructor);

    if (descriptor) {
      if (isServer) descriptor.value = noop;
      return descriptor;
    }
    if (isServer) {
      Object.defineProperty(target, propertyKey, {
        get: () => noop,
        set: noop,
        enumerable: true,
        configurable: true,
      });
    }
  };
}

export interface StateOptions {
  channel?: string;
  provider?: string;
  /**
   * Auto-bind this property from a flashed value (`flashed()`) during bootstrap.
   * `true` uses the property name as the key; a string is an explicit key.
   * The flashed value wins over the class-field initializer. Server-only — on
   * the client `flashed()` returns `undefined`, so the initializer is kept.
   */
  flash?: boolean | string;
  /**
   * Auto-bind this property from old input (`old()`) during bootstrap.
   * `true` uses the property name as the key; a string is an explicit key
   * (supports dot-paths like `'address.street'`). The old value wins over the
   * class-field initializer. Server-only — no-ops on the client.
   *
   * Mutually exclusive with `flash`: a property binds from one source only.
   * `flash` takes precedence if both are set.
   */
  old?: boolean | string;
}

export function State(options: StateOptions = {}): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const stateProperties = Reflect.hasOwnMetadata('cossack:state', target.constructor)
      ? Reflect.getOwnMetadata('cossack:state', target.constructor)
      : {};

    stateProperties[propertyKey] = {
      channel: options.channel || 'global',
      provider: options.provider || 'page',
      flash: options.flash,
      old: options.old,
    };
    Reflect.defineMetadata('cossack:state', stateProperties, target.constructor);
  };
}

/**
 * Decorator for client-only state.
 * These properties trigger UI re-renders when changed on the client,
 * but are NEVER synchronized with the server.
 */
export function ClientState(): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const clientStateProperties = Reflect.hasOwnMetadata('cossack:client-state', target.constructor)
      ? Reflect.getOwnMetadata('cossack:client-state', target.constructor)
      : new Set();

    (clientStateProperties as Set<string | symbol>).add(propertyKey);
    Reflect.defineMetadata('cossack:client-state', clientStateProperties, target.constructor);
  };
}

/**
 * Options for the @Store decorator. Mirrors @State so a store can target a
 * specific channel/provider exactly like an individual @State property, and
 * also supports the `flash` / `old` auto-bind options (see {@link StateOptions}).
 */
export interface StoreOptions {
  channel?: string;
  provider?: string;
  /** Auto-bind from a flashed value. `true` = property name; string = explicit key. */
  flash?: boolean | string;
  /** Auto-bind from old input. `true` = property name; string = explicit key (dot-paths ok). */
  old?: boolean | string;
}

/**
 * Decorator for a *store*: a single object property that groups multiple
 * related fields together (`@Store() form = { email: '', password: '' }`).
 *
 * The framework wraps the value in a recursive reactive Proxy at runtime, so
 * nested mutations (`this.form.address.zip = x`, `this.items.push(...)`,
 * `this.tags[0] = y`) trigger the same broadcast / re-render path as a
 * `@State` setter — at any depth.
 *
 * Like `@State`, a store is isomorphic public state: serialized into the
 * initial state, hydrated on the client, and broadcast to connected clients
 * when mutated on the server.
 */
export function Store(options: StoreOptions = {}): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const storeProperties = Reflect.hasOwnMetadata('cossack:store', target.constructor)
      ? Reflect.getOwnMetadata('cossack:store', target.constructor)
      : {};

    storeProperties[propertyKey] = {
      channel: options.channel || 'global',
      provider: options.provider || 'page',
      flash: options.flash,
      old: options.old,
    };
    Reflect.defineMetadata('cossack:store', storeProperties, target.constructor);
  };
}

/**
 * Decorator for a client-only store. Behaves like `@ClientState`: nested
 * mutations trigger client re-renders, but the store is NEVER serialized or
 * sent over the wire. Use for ephemeral UI state grouped together (multi-step
 * form drafts, collapsible panels, transient filters).
 */
export function ClientStore(): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const clientStoreProperties = Reflect.hasOwnMetadata('cossack:client-store', target.constructor)
      ? Reflect.getOwnMetadata('cossack:client-store', target.constructor)
      : new Set();

    (clientStoreProperties as Set<string | symbol>).add(propertyKey);
    Reflect.defineMetadata('cossack:client-store', clientStoreProperties, target.constructor);
  };
}

export interface ValidateDecoratorOptions {
  /**
   * Validation rules. Two shapes are supported:
   *
   * 1. **Single-rule** (for `@State`/`@ClientState` fields): a `ValidationRule`
   *    applied to the decorated property itself.
   * 2. **Nested rule tree** (for `@Store`/`@ClientStore`): a map whose keys are
   *    the store's fields, mirroring the store shape. Primitive, array, and
   *    built-in (Date/RegExp/…) fields take a `ValidationRule`; object fields
   *    nest a sub-tree. Use the type-safe {@link storeRules}`<T>()` helper to
   *    compile-time-check the field paths.
   *
   * The two shapes are distinguished by VALUE: a single rule never carries a
   * plain-object value (its `pattern` is a `RegExp`, its `custom` a function);
   * a rule tree has at least one plain-object value (a nested child node).
   */
  rules?: ValidationRule | StoreRuleMap;
  config?: ValidationConfig;
}

/**
 * Decorator for validating form fields.
 * Works with @State, @ClientState, @Store, and @ClientStore decorated properties.
 *
 * - On a `@State`/`@ClientState` property, pass a single `ValidationRule`.
 * - On a `@Store`/`@ClientStore` property, pass a NESTED rule tree — either
 *   inline or via the type-safe `storeRules<T>()` helper. The tree mirrors the
 *   store shape; relative keys are auto-prefixed to full runtime paths.
 *
 * @example single field
 * ```typescript
 * @State()
 * @Validate({ rules: { required: true, email: true, message: 'Please enter a valid email' } })
 * email = '';
 * ```
 *
 * @example store with typed, nested rules (recommended)
 * ```typescript
 * interface FormState { email: string; address: { zip: string }; tags: string[] }
 *
 * @Store()
 * @Validate({
 *   rules: storeRules<FormState>({
 *     email: { required: true, email: true, message: '...' },
 *     address: { zip: { required: true, pattern: /^\d{5}$/, message: '...' } },
 *     tags: { required: true, minLength: 1, message: 'Add at least one tag' },
 *   }),
 *   config: { trigger: 'all', runOn: 'both' },
 * })
 * form: FormState = { email: '', address: { zip: '' }, tags: [] };
 * ```
 *
 * At runtime, validators and `errors` use the full prefixed dot-paths
 * (`'form.email'`, `'form.address.zip'`), so `validateProperty('form.email')`,
 * `hasError('form.address.zip')`, and `getError('form.tags')` all work.
 */
export function Validate(options: ValidateDecoratorOptions = {}): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const propertyName = String(propertyKey);

    // Get existing validation rules or create new store
    const existingRules = Reflect.hasOwnMetadata('cossack:validation', target.constructor)
      ? Reflect.getOwnMetadata('cossack:validation', target.constructor)
      : {};

    const config = {
      trigger: 'all',
      runOn: 'both',
      errorProperty: 'errors',
      debounce: 0,
      ...options.config,
    };

    const rules = options.rules as Record<string, ValidationRule> | ValidationRule | undefined;

    // Detect the rule-map shape by VALUE (see isValidationRuleMap). A single
    // ValidationRule is detected when `rules` is an object with no plain-object
    // values. This is robust against store field names that collide with rule
    // keys (e.g. a store field named 'required' or 'message').
    const isRuleMap = !!(rules && typeof rules === 'object' && isValidationRuleMap(rules as Record<string, unknown>));

    if (isRuleMap) {
      // Map shape (a nested rule tree): flatten it to full prefixed dot-paths.
      // Each top-level key is RELATIVE to the store ('email', 'address.zip'),
      // so `flattenRuleTree(rules, propertyName)` emits the full runtime paths
      // ('form.email', 'form.address.zip'). Stacked @Validate decorators on
      // the same store merge into the same path entry.
      const flatRules = flattenRuleTree(rules, propertyName);
      for (const [fullPath, pathRules] of Object.entries(flatRules)) {
        const existingPathRules = existingRules[fullPath]?.rules || {};
        existingRules[fullPath] = {
          rules: { ...existingPathRules, ...pathRules },
          config,
        };
      }
    } else {
      // Single-rule shape (existing behavior): rules apply to the decorated
      // property itself.
      const existingPropertyRules = existingRules[propertyName]?.rules || {};
      const mergedRules = { ...existingPropertyRules, ...(rules as ValidationRule) };
      existingRules[propertyName] = {
        rules: mergedRules,
        config,
      };
    }

    Reflect.defineMetadata('cossack:validation', existingRules, target.constructor);

    // Also mark this property as validated for the security plugin
    const validatedProperties = Reflect.hasOwnMetadata('cossack:validated-properties', target.constructor)
      ? Reflect.getOwnMetadata('cossack:validated-properties', target.constructor)
      : new Set<string>();

    (validatedProperties as Set<string>).add(propertyName);
    Reflect.defineMetadata('cossack:validated-properties', validatedProperties, target.constructor);
  };
}

export function Ref(): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const privateKey = Symbol(String(propertyKey));

    Object.defineProperty(target, propertyKey, {
      get: function() {
        if (!this[privateKey]) {
          this[privateKey] = createRef();
        }
        return this[privateKey];
      },
      set: function(val) {
        this[privateKey] = val;
      },
      enumerable: true,
      configurable: true
    });
  };
}

/**
 * Cossack lifecycle events that can be used with the `@On` decorator as
 * decorator-based alternatives to the `onMount()` / `onNavigateComplete()`
 * lifecycle hooks. Useful when you need multiple handlers for the same phase.
 */
export type CossackLifecycleEvent = 'mount' | 'navigate-complete';

/**
 * Common DOM events fired on HTMLElement targets. Provided for IDE
 * autocompletion when using `@On`. Any other string is also accepted.
 */
export type HTMLElementEventName =
  | 'click'
  | 'dblclick'
  | 'mousedown'
  | 'mouseup'
  | 'mouseover'
  | 'mouseenter'
  | 'mouseleave'
  | 'mousemove'
  | 'keydown'
  | 'keyup'
  | 'keypress'
  | 'input'
  | 'change'
  | 'submit'
  | 'reset'
  | 'focus'
  | 'blur'
  | 'scroll'
  | 'wheel'
  | 'contextmenu'
  | 'drag'
  | 'dragstart'
  | 'dragend'
  | 'drop'
  | 'touchstart'
  | 'touchmove'
  | 'touchend';

/**
 * Common events fired on the global `document` object. Provided for IDE
 * autocompletion when using `@OnDocument`. Any other string is also accepted.
 */
export type DocumentEventName =
  | 'keydown'
  | 'keyup'
  | 'keypress'
  | 'click'
  | 'mousedown'
  | 'mouseup'
  | 'mousemove'
  | 'DOMContentLoaded'
  | 'visibilitychange'
  | 'selectionchange'
  | 'scroll'
  | 'fullscreenchange';

/**
 * Common events fired on the global `window` object. Provided for IDE
 * autocompletion when using `@OnWindow`. Any other string is also accepted.
 */
export type WindowEventName =
  | 'resize'
  | 'scroll'
  | 'load'
  | 'beforeunload'
  | 'unload'
  | 'hashchange'
  | 'popstate'
  | 'online'
  | 'offline'
  | 'storage'
  | 'focus'
  | 'blur'
  | 'error'
  | 'message';

export function OnEvent(eventName: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const eventHandlers = Reflect.getOwnMetadata('cossack:event-handlers', target.constructor) || {};
    if (!eventHandlers[eventName]) {
      eventHandlers[eventName] = [];
    }
    eventHandlers[eventName].push(propertyKey);
    Reflect.defineMetadata('cossack:event-handlers', eventHandlers, target.constructor);
    return descriptor;
  };
}

/**
 * Attaches a handler to the component's root element (`this.container`) for the
 * given DOM event (e.g. `'click'`).
 *
 * Also supports the Cossack lifecycle events `'mount'` and `'navigate-complete'`
 * as decorator-based alternatives to the `onMount()` / `onNavigateComplete()`
 * hooks. Unlike the hooks, multiple `@On('mount')` / `@On('navigate-complete')`
 * methods are supported on a single component.
 *
 * `'navigate-complete'` fires on the App, active layouts, and current page,
 * mirroring the `onNavigateComplete()` hook.
 */
export function On(
  eventName: CossackLifecycleEvent | HTMLElementEventName | (string & {}),
): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const domEvents = Reflect.getOwnMetadata('cossack:dom-events', target.constructor) || [];
    domEvents.push({ eventName, propertyKey });
    Reflect.defineMetadata('cossack:dom-events', domEvents, target.constructor);
    return descriptor;
  };
}

export interface EventListenerOptions {
  throttle?: number;
  debounce?: number;
}

export function OnDocument(
  eventName: DocumentEventName | (string & {}),
  options: EventListenerOptions = {},
): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const documentEvents = Reflect.getOwnMetadata('cossack:document-events', target.constructor) || [];
    documentEvents.push({ eventName, propertyKey, options });
    Reflect.defineMetadata('cossack:document-events', documentEvents, target.constructor);
    return descriptor;
  };
}

export function OnWindow(
  eventName: WindowEventName | (string & {}),
  options: EventListenerOptions = {},
): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const windowEvents = Reflect.getOwnMetadata('cossack:window-events', target.constructor) || [];
    windowEvents.push({ eventName, propertyKey, options });
    Reflect.defineMetadata('cossack:window-events', windowEvents, target.constructor);
    return descriptor;
  };
}

/**
 * Rate-limit a method so it only runs once after `ms` milliseconds of inactivity.
 * Each new call within the window resets the timer, so only the final invocation
 * (with its latest arguments) actually executes.
 *
 * `@Debounce` is a **client-only** modifier: on the server the method runs
 * immediately. It composes with any classification decorator — `@Client`,
 * `@Shared`, `@On` keep the real body; `@Server` debounces the RPC *proxy*
 * call (useful for search-as-you-type hitting the server).
 *
 * The wrapped method returns `void` — the original return value is lost because
 * execution is deferred. Per-instance timers prevent leakage between component
 * instances.
 *
 * @example
 * ```ts
 * @Client()
 * @Debounce(500)
 * search(query: string) {
 *   console.log('Searching for:', query);
 * }
 * ```
 *
 * Standalone usage (without `@Client`/`@Server`/`@Shared`/`@On`) leaves the
 * method server-only by default and emits a dev warning on the client.
 */
export function Debounce(ms: number): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const store = Reflect.hasOwnMetadata('cossack:debounce', target.constructor)
      ? Reflect.getOwnMetadata('cossack:debounce', target.constructor)
      : {};
    store[String(propertyKey)] = ms;
    Reflect.defineMetadata('cossack:debounce', store, target.constructor);
    return descriptor;
  };
}

/**
 * Rate-limit a method so it runs at most once per `ms` milliseconds. The first
 * call executes immediately (leading edge); subsequent calls within the window
 * are ignored.
 *
 * Like `@Debounce`, this is a **client-only** modifier and composes with the
 * classification decorators (`@Client`, `@Server`, `@Shared`, `@On`).
 *
 * @example
 * ```ts
 * @Client()
 * @Throttle(200)
 * onScroll() {
 *   this.loadMore();
 * }
 * ```
 */
export function Throttle(ms: number): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const store = Reflect.hasOwnMetadata('cossack:throttle', target.constructor)
      ? Reflect.getOwnMetadata('cossack:throttle', target.constructor)
      : {};
    store[String(propertyKey)] = ms;
    Reflect.defineMetadata('cossack:throttle', store, target.constructor);
    return descriptor;
  };
}

export function Computed(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('computed', true, target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator for methods that are safe to run on both client and server.
 * This marks the method as shared, ensuring it is NOT stripped from the client bundle.
 *
 * Unlike @Server methods (which are stubbed on the client) and @Client methods (which are stubbed on the server),
 * @Shared methods retain their full implementation on both sides.
 *
 * Use this decorator for:
 * - Pure functions that don't access server-only resources
 * - Validation logic that needs to run consistently on both sides
 * - Data transformation utilities
 *
 * @example
 * ```ts
 * @Shared()
 * validateEmail(email: string): boolean {
 *   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
 * }
 * ```
 */
export function Shared(): MethodDecorator {
    return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
        // Shared methods are local-only. This metadata keeps their bodies in
        // client bundles without registering either RPC direction.
        Reflect.defineMetadata('cossack:shared', true, target, propertyKey);

        return descriptor;
    };
}

export function Optimistic(actionName: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const optimisticHandlers = Reflect.getOwnMetadata('cossack:optimistic-handlers', target.constructor) || {};
    optimisticHandlers[actionName] = propertyKey;
    Reflect.defineMetadata('cossack:optimistic-handlers', optimisticHandlers, target.constructor);
    return descriptor;
  };
}

/**
 * Options for `@Task`, `@ServerTask`, and `@ClientTask`.
 */
export interface TaskOptions {
    /**
     * Restrict this task to run only when one of the listed state/store
     * properties changes. Each entry is a property name (`'user'`) or, for a
     * `@Store` / `@ClientStore`, a dot-path addressing a nested field
     * (`'form.address.zip'`).
     *
     * Prefix semantics (segment-wise): tracking `'store'` fires on ANY nested
     * mutation of `store`; tracking `'store.user.zip'` also fires when
     * `'store'` or `'store.user'` is reassigned wholesale.
     *
     * Omit `track` (or pass an empty array) to run on every state change —
     * the legacy behavior. A tracked task also runs once during bootstrap
     * (the mount run), regardless of `track`.
     */
    track?: (string | symbol)[];
}

/**
 * Signature for a `@Task` / `@ServerTask` / `@ClientTask` method. It may be
 * sync or async, and may optionally return a cleanup function.
 *
 * The cleanup function follows the React `useEffect` contract: it runs before
 * the next tracked re-run of the task and once when the component is destroyed
 * (via `destroy()` / `onCleanup`). Use it to release timers, subscriptions,
 * observers, etc.
 */
export type TaskMethod = () => void | Promise<void> | (() => void | Promise<void>);

/**
 * Registry entry stored under the `cossack:tasks` / `cossack:server-tasks` /
 * `cossack:client-tasks` metadata keys. Mirrors the `{ propertyKey, options }`
 * shape already used by `@VisibleTask`.
 */
export interface TaskRegistration {
    propertyKey: string | symbol;
    track?: (string | symbol)[];
}

/** Shared registration body for the three task decorators. */
function registerTask(
    metadataKey: string,
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
    options: TaskOptions,
): PropertyDescriptor {
    const tasks: TaskRegistration[] =
        Reflect.getOwnMetadata(metadataKey, target.constructor) || [];
    tasks.push({ propertyKey, track: options.track });
    Reflect.defineMetadata(metadataKey, tasks, target.constructor);
    return descriptor;
}

/**
 * Marks a method as a *task*: it runs before each render (bootstrap, server
 * state broadcasts, client prop/state-driven re-renders) on BOTH server and
 * client.
 *
 * By default a task runs on EVERY state change. Pass `track` to restrict it to
 * specific properties — see {@link TaskOptions}.
 *
 * A task may `return` a cleanup function; it is invoked before the next
 * tracked re-run and on component destroy — see {@link TaskMethod}.
 *
 *   @Task()
 *   syncDerived() { /* runs on every change *\/ }
 *
 *   @Task({ track: ['user', 'posts'] })
 *   async reloadFeed() { /* runs only when user/posts change *\/ }
 *
 *   @Task({ track: ['form.email'] })
 *   validateEmail() {
 *       const id = setInterval(...);
 *       return () => clearInterval(id);   // auto cleanup
 *   }
 */
export function Task(options: TaskOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    return registerTask('cossack:tasks', target, propertyKey, descriptor, options);
  };
}

/**
 * Like `@Task()`, but the method runs **only on the server**. Its body is
 * stripped from the client bundle by the security plugin (like `@Server`).
 *
 * This replaces the manual `if (this.isServer) return;` guard at the top of a
 * `@Task` method. The task executes during `runTasks()` on the server
 * (bootstrap, state broadcasts) and is a no-op on the client.
 *
 * Accepts the same {@link TaskOptions} as `@Task` (including `track`).
 *
 *   @ServerTask()
 *   syncOpenState() {
 *       if (!this.isServer) return;  // ← NOT needed, decorator handles it
 *       // server-only logic here
 *   }
 */
export function ServerTask(options: TaskOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    return registerTask('cossack:server-tasks', target, propertyKey, descriptor, options);
  };
}

/**
 * Like `@Task()`, but the method runs **only on the client**. Its body is
 * preserved in the client bundle (like `@Client`) and skipped by `runTasks()`
 * when running on the server.
 *
 * This replaces the manual `if (!this.isServer) { ... }` guard inside a
 * `@Task` method.
 *
 * Accepts the same {@link TaskOptions} as `@Task` (including `track`).
 *
 *   @ClientTask()
 *   attachListeners() {
 *       // client-only logic: DOM measurements, event setup, etc.
 *   }
 */
export function ClientTask(options: TaskOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    return registerTask('cossack:client-tasks', target, propertyKey, descriptor, options);
  };
}

export interface VisibleTaskOptions {
    strategy?: 'intersection-observer' | 'document-ready';
    threshold?: number;
    selector?: string;
}

/**
 * Signature for a `@VisibleTask` method. The first argument is the element that
 * intersected (or `null` for the `document-ready` strategy), and the second is
 * the matching `IntersectionObserverEntry` (or `null` for `document-ready`).
 * May optionally return a cleanup function.
 *
 * Methods declaring zero parameters still work — extra arguments are ignored
 * by the runtime, so this change is backward compatible.
 */
export type VisibleTaskMethod = (
    target: Element | null,
    entry: IntersectionObserverEntry | null,
) => void | (() => void);

export function VisibleTask(options: VisibleTaskOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const visibleTasks = Reflect.getOwnMetadata('cossack:visible-tasks', target.constructor) || [];
    visibleTasks.push({ propertyKey, options });
    Reflect.defineMetadata('cossack:visible-tasks', visibleTasks, target.constructor);
    return descriptor;
  };
}

export function PreventNavigation(): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('cossack:prevent-navigation', propertyKey, target.constructor);
    return descriptor;
  };
}

/**
 * (Optional) Creates typed versions of the @State and @Server decorators
 * for a specific component, providing compile-time safety and autocompletion
 * for channel names.
 */
export function createTypedDecorators<T extends CossackOptions>() {
  return {
    State: (options: StateOptions & { channel?: T['Channels'] | 'global' } = {}) => State(options),
    Server: (options: ServerOptions & { channel?: T['Channels'] | 'global' } = {}) => Server(options),
  };
}

/**
 * Options for the @Service decorator.
 */
export interface ServiceOptions {
  scope?: 'singleton' | 'transient';
}

/**
 * Decorator for service classes that can be injected via dependency injection.
 * Marks the class as injectable so the DI container can resolve it.
 *
 * @example
 * ```typescript
 * @Service()
 * export class PaymentService {
 *   @State() status: string = 'idle';
 *
 *   @Server()
 *   async processPayment(amount: number) {
 *     this.status = 'processing';
 *   }
 * }
 * ```
 */
export function Service(options: ServiceOptions = {}): ClassDecorator {
  return (target: object) => {
    Reflect.defineMetadata('cossack:service', {
      scope: options.scope || 'singleton',
    }, target);
  };
}

/** Lazily inject a service declared by the nearest active layout scope. */
export function Inject<T>(serviceClass: ServiceClass<T>): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const injections: Map<string | symbol, ServiceClass> = Reflect.hasOwnMetadata('cossack:inject', target.constructor)
      ? new Map(Reflect.getOwnMetadata('cossack:inject', target.constructor))
      : new Map();
    injections.set(propertyKey, serviceClass);
    Reflect.defineMetadata('cossack:inject', injections, target.constructor);
  };
}
