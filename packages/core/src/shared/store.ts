// src/shared/store.ts

/**
 * Internal reactivity helpers for the `@Store` / `@ClientStore` decorators.
 *
 * A store object is wrapped in a *recursive* `Proxy` so that nested mutations
 * (`this.form.address.zip = x`, `this.items[0].qty = 2`, `this.tags.push('y')`)
 * trigger the same broadcast / re-render path used by the `@State` setter.
 *
 * The proxy is transparent to `JSON.stringify` and `Object.fromEntries`, so
 * serialization in `getInitialState()` / `getPublicState()` / broadcasts is
 * unaffected — those paths keep reading the raw object stored in the
 * `StateContainer`. The proxy is only materialized on property read.
 */

/**
 * Invoked once per qualifying mutation of a store (set/deleteProperty at any
 * depth). Implementations route to either `_scheduleStateBroadcast` (server)
 * or `requestUpdate` (client). Repeated synchronous mutations are coalesced
 * downstream (microtask for broadcasts; `__updatePromise` for renders).
 */
export type StoreProxyTrigger = (storeKey: string) => void;

/**
 * Per-trigger cache of child proxies, keyed outer by the store's `trigger`
 * closure and inner by the RAW target object.
 *
 * Why scope by trigger? A trigger closure is unique per (component instance,
 * store property) pair — it captures the instance and routes mutations to that
 * instance's broadcast / requestUpdate path. Without per-trigger scoping, a raw
 * object shared across two component instances (e.g. a module-level default
 * assigned to `@Store()` on both) would be reused, and the cached proxy would
 * keep the FIRST instance's trigger — so nested mutations in the second
 * instance would silently notify the first, cross-wiring reactivity and
 * pinning the first instance in memory.
 *
 * Scoping by trigger means each component/store pair gets its own proxy tree
 * over the (possibly shared) raw object. Identity is still stable WITHIN a
 * single trigger scope (`store.user === store.user`) and cycles terminate.
 *
 * Both WeakMaps so dead triggers/targets are GC-eligible. Keyed on the RAW
 * target (never on a proxy) and on the trigger function (stable for the
 * lifetime of the store binding).
 */
const childProxyCache = new WeakMap<StoreProxyTrigger, Map<object, object>>();

/**
 * Returns true only for plain objects (`{}` literals) and arrays — the shapes
 * that are SAFE to wrap in a recursive Proxy. Built-in non-plain objects
 * (`Date`, `Map`, `Set`, `RegExp`, `Promise`, typed arrays, `ArrayBuffer`,
 * `DataView`, etc.) and arbitrary class instances are returned raw because
 * Proxy-wrapping them breaks methods that perform internal-slot checks
 * (e.g. `Map.prototype.set` throws "incompatible receiver" when `this` is a
 * Proxy, not a real Map). Such values are treated as scalar state: mutations
 * to them are NOT reactive (reassign the property to trigger an update).
 *
 * Exported so the host (`initializeState`) can apply the same guard at the
 * top-level store boundary.
 */
export function isPlainObjectOrArray(value: object): boolean {
    if (Array.isArray(value)) return true;
    // Plain objects have Object.prototype as their direct prototype. Class
    // instances and built-ins have a different prototype, so they fail this
    // check and are returned raw.
    return Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Wrap a store target in a recursive reactive Proxy.
 *
 * - `get`: object/array values are returned through a cached child proxy;
 *   primitives are returned raw; functions (array methods etc.) are bound to
 *   the proxy receiver so they operate on the proxied collection.
 * - `set` / `deleteProperty`: invoke `trigger(storeKey)` after mutating. A
 *   strict equality check avoids firing on no-op writes at the top level; the
 *   trigger fires on any structural change for `deleteProperty`.
 *
 * The top-level target is also registered in the shared child cache, so a
 * circular reference (`a.b = b; b.a = a`) returns the SAME proxy when reached
 * via any path — `(store.b).a === store` — instead of allocating a duplicate.
 *
 * @param target   The raw store object (already stored in the StateContainer).
 * @param storeKey The component property name that exposes this store.
 * @param trigger  Called once per qualifying mutation; routes to broadcast /
 *                 re-render by the host component.
 */
export function createStoreProxy(
    target: Record<PropertyKey, unknown>,
    storeKey: string,
    trigger: StoreProxyTrigger,
): Record<PropertyKey, unknown> {
    const inner = childProxyCache.get(trigger) ?? new Map<object, object>();
    if (inner.size === 0) childProxyCache.set(trigger, inner);

    // Reuse an existing proxy for this raw target (within this trigger scope)
    // so identity is stable across paths (including cycles back to the root).
    const existing = inner.get(target);
    if (existing) {
        return existing as Record<PropertyKey, unknown>;
    }

    const handler: ProxyHandler<Record<PropertyKey, unknown>> = {
        get(obj, prop, receiver) {
            const value = Reflect.get(obj, prop, receiver);
            if (value !== null && typeof value === 'object') {
                // Only recurse into plain objects/arrays. Built-ins (Date, Map,
                // Set, RegExp, typed arrays) and class instances are returned
                // RAW — proxying them throws "incompatible receiver" on method
                // calls and is unsafe. They are treated as scalar state.
                if (!isPlainObjectOrArray(value as object)) {
                    return value;
                }
                const raw = value as object;
                const cached = inner.get(raw)
                    ?? createStoreProxy(
                        value as Record<PropertyKey, unknown>,
                        storeKey,
                        trigger,
                    );
                return cached;
            }
            if (typeof value === 'function') {
                // Array methods (push/splice/pop/sort/...) must run with
                // `this` bound to the (child) proxy so their internal writes
                // flow through the set trap.
                return (value as (...args: unknown[]) => unknown).bind(receiver);
            }
            return value;
        },
        set(obj, prop, value) {
            const oldValue = Reflect.get(obj, prop);
            const ok = Reflect.set(obj, prop, value);
            // Strict inequality, but treat NaN === NaN as a no-op (NaN !== NaN
            // is true, so without this guard an unchanged NaN field would
            // fire the trigger every time).
            if (oldValue !== value && !(Number.isNaN(oldValue) && Number.isNaN(value))) {
                trigger(storeKey);
            }
            return ok;
        },
        deleteProperty(obj, prop) {
            const ok = Reflect.deleteProperty(obj, prop);
            if (ok) {
                trigger(storeKey);
            }
            return ok;
        },
    };
    const proxy = new Proxy(target, handler);
    inner.set(target, proxy);
    return proxy;
}

/**
 * Resolve a (possibly dotted) state path on a component instance.
 *
 * - Plain names (`'email'`) resolve via the component's `getProperty` (the
 *   same accessor `validateProperty` historically used), so mock components
 *   and the `Cossack` base class behave identically to before.
 * - Dot-paths (`'submitFormStore.address.zip'`) resolve the first segment via
 *   `getProperty`, then walk the object graph by direct property access. A
 *   missing intermediate segment short-circuits to `undefined` rather than
 *   throwing.
 *
 * Used by `validateProperty()` so validation rules can address nested store
 * fields at any depth.
 */
export function resolveStatePath(component: any, path: string): unknown {
    const hasGetProperty = typeof component.getProperty === 'function';
    if (!path.includes('.')) {
        return hasGetProperty ? component.getProperty(path) : component[path];
    }
    const parts = path.split('.');
    let current: any = hasGetProperty
        ? component.getProperty(parts[0])
        : component[parts[0]];
    for (let i = 1; i < parts.length; i++) {
        if (current == null) return undefined;
        current = current[parts[i]];
    }
    return current;
}
