# Service / Dependency Injection — Technical Specification

This document describes the internal architecture and data flow of the DI system. It is intended for LLM-assisted development and contributors who need to modify or extend the feature.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  @Service() decorator                                    │
│  Writes: Reflect metadata 'cossack:service' on class    │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  DIContainer (container.ts)                              │
│  - resolve<T>(): recursive ctor param resolution         │
│  - Singleton cache: Map<Function, instance>              │
│  - Circular dep detection: Set<Function> (resolving)    │
│  - Global instance via getContainer() / resetContainer() │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  createInstance<T>(Class) (container.ts)                 │
│  Entry point used by router.ts and client/app.ts         │
│  instead of `new`. Reads design:paramtypes, resolves     │
│  @Service deps via container, passes rest as undefined.  │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  Component.bootstrap() calls _bootstrapServices()        │
│  (cossack.ts, after initializeState, before init/get)    │
│                                                          │
│  For each injected service:                              │
│    1. bootstrapService() — @State getters/setters        │
│    2. _registerServiceState() — bridge to component      │
│    3. _forwardServiceMethods() [server] OR               │
│       _proxyServiceMethods()  [client]                   │
└─────────────────────────────────────────────────────────┘
```

---

## File Map

| File | Responsibility |
|------|---------------|
| `packages/core/src/shared/decorators.ts` | `@Service()` class decorator. Writes `Reflect.defineMetadata('cossack:service', { scope }, target)`. |
| `packages/core/src/shared/container.ts` | `DIContainer`, `createInstance`, `isService`, `getContainer`, `resetContainer`. |
| `packages/core/src/shared/service-bootstrap.ts` | `bootstrapService(instance)` — sets up `@State` getter/setter closures on the plain service object. |
| `packages/core/src/shared/cossack.ts` | `_bootstrapServices`, `_registerServiceState`, `_forwardServiceMethods`, `_proxyServiceMethods`, `_findServiceInstance`, `_getConstructorParamNames`. |
| `packages/framework/src/router.ts` | All `new X()` replaced with `createInstance(X)`. No other changes needed — RPC mechanism works transparently. |
| `packages/framework/src/client/app.ts` | All `new X()` replaced with `createInstance(X)`. |
| `packages/framework/src/vite-security-plugin.ts` | Added `@Service` class detection regex + `hasExtends` flag for constructor injection. |

---

## Phase 1: Instantiation

### `createInstance<T>(ComponentClass)`

Called at every site where a component is instantiated (SSR, CRPC, client hydration, navigation).

```
createInstance(PageComponent)
  │
  ├─ Reflect.getMetadata('design:paramtypes', PageComponent) → [CounterService]
  │   (requires tsconfig: emitDecoratorMetadata: true)
  │
  ├─ For each param:
  │    isService(dep)?
  │      YES → container.resolve(dep)    // DI container
  │      NO  → undefined                  // non-service params left empty
  │
  └─ new PageComponent(...deps)
       // TypeScript ctor parameter properties (private x: X)
       // store the service as an own property on the instance
```

### `DIContainer.resolve<T>(target)`

```
resolve(CounterService)
  │
  ├─ Check 'cossack:service' metadata → must exist
  ├─ scope === 'singleton' && cached? → return cached
  ├─ Already in resolving set? → throw circular dependency error
  │
  ├─ Add to resolving set
  ├─ Reflect.getMetadata('design:paramtypes', CounterService) → []
  │   // CounterService has no deps, but PaymentService might → [LoggerService]
  ├─ new CounterService()
  ├─ Cache if singleton
  └─ Remove from resolving set
```

**Key constraint**: `emitDecoratorMetadata` is a TypeScript compiler feature. Vitest uses esbuild which does NOT support it. Tests that depend on constructor injection must manually call `Reflect.defineMetadata('design:paramtypes', [DepClass], ConsumerClass)`.

---

## Phase 2: Bootstrap (inside `Cossack.bootstrap()`)

Called after `initializeState()` but before `init()`/`get()`. Only runs if the component has constructor params that are `@Service`.

### Step 2a: `bootstrapService(instance)`

**File**: `service-bootstrap.ts`

Sets up simple getter/setter closures on the service's `@State` properties. This turns the raw class field into a reactive property:

```typescript
// Before: count = 0 is a plain value field
// After:
Object.defineProperty(instance, 'count', {
    get() { return value; },     // closure over `value`
    set(v) { value = v; },       // updates closure, no requestUpdate
});
```

No re-render triggering here — the component handles that.

### Step 2b: `_registerServiceState(serviceInstance)`

**File**: `cossack.ts`

This is the critical bridge. It makes the existing RPC mechanism work without any router changes.

**What it does**:
1. Reads service `@State` keys from `cossack:state` metadata.
2. Registers each key in the **component's** `_stateContainer` (internal map used by `getPublicState()`).
3. Creates a **pass-through property** on the component:

```
component.count
  │
  ├─ get → serviceInstance.count    // reads from service
  │
  └─ set(v) →
       serviceInstance.count = v    // writes to service
       stateContainer.setPublic(key, v)  // keeps container in sync
       // triggers broadcast or requestUpdate
```

**Why this matters**: The router's CRPC handler does:
```typescript
targetInstance[key] = state[key];        // applies client state
targetInstance[action](...args);          // calls the action
responseData = targetInstance.getPublicState(); // returns state
```

Without `_registerServiceState`, `targetInstance.count` would be a plain field (not the service's), `getPublicState()` wouldn't include `count`, and the client would receive an empty response.

### Step 2c (server): `_forwardServiceMethods(serviceInstance)`

Creates forwarding methods on the **component** instance:

```
componentInstance.increment(...args)
  │
  └─ serviceInstance.increment(...args)
       // executes on server
       // then syncs service state → component stateContainer
       stateContainer.setPublic('count', serviceInstance.count)
```

**Filtering rules**:
- Methods in both `cossack:server-methods` AND `cossack:client-methods` → **skipped** (these are `@Shared`, keep their original impl on both sides)
- Methods only in `cossack:server-methods` → **forwarded** (these are `@Server`-only)
- Methods already on the component → **not overwritten**

**Post-call sync**: After the service method executes, all service `@State` values are copied into the component's `_stateContainer` so that `getPublicState()` returns the latest values.

### Step 2c (client): `_proxyServiceMethods(serviceInstance)`

Replaces `@Server`-only methods on the **service instance** with HTTP fetch proxies:

```
serviceInstance.increment(1, 2)
  │
  ├─ Build state from service @State keys: { count: 0 }
  ├─ this.loading['increment']++
  ├─ this.requestUpdate()    // show loading
  │
  ├─ fetch('/crpc', {
  │     componentRouteId,    // borrowed from parent component
  │     target: this._id,
  │     action: 'increment',
  │     state: { count: 0 },
  │     payload: [1, 2]
  │   })
  │
  ├─ On response:
  │    for key in data:
  │      serviceInstance[key] = data[key]   // e.g. count = 1
  │    this.requestUpdate()                  // trigger re-render
  │
  └─ finally:
       delete this.loading['increment']
       this.requestUpdate()
```

`componentRouteId` is obtained the same way the component's own `proxyHttpMethods` does: from `window.__INITIAL_STATE__`.

---

## Phase 3: Security Plugin

**File**: `vite-security-plugin.ts`

### Detection

Two regex passes in `transformCossackClass`:

1. **Existing regex**: matches `class Foo extends Cossack { ... }` or `class Foo extends CossackElement { ... }`.
2. **New regex** (`serviceClassRegex`): matches `@Service()\nclass Foo { ... }` or `@Service()\nclass Foo extends Bar { ... }`.

Both produce entries in `classRanges[]` with a `hasExtends` boolean.

### Constructor injection (`createMetadataInjection`)

When server-only methods are found, the plugin injects a static `__registerServerOnlyMethods()` and a `constructor()` at the end of the class body.

**Critical**: `hasExtends` flag controls whether `super()` is included:

```typescript
// hasExtends = true (extends Cossack)
constructor() {
    super();
    (this.constructor as any).__registerServerOnlyMethods?.();
}

// hasExtends = false (plain @Service, no extends)
constructor() {
    (this.constructor as any).__registerServerOnlyMethods?.();
}
```

Omitting `super()` when the class has no parent prevents `SyntaxError: 'super' keyword unexpected here`.

---

## Complete Request Flow (HTTP transport)

### SSR (server)

```
request → router.ts → createSsrHandler()
  │
  ├─ createInstance(App)         // App has no service deps
  ├─ createInstance(LComp)       // Layout, may have deps
  ├─ createInstance(PageComponent) // Page, resolves services
  │     └─ container.resolve(CounterService) → new CounterService()
  │
  ├─ component.bootstrap({ context, user, env })
  │     ├─ initializeState()       // component's own @State
  │     ├─ _bootstrapServices()
  │     │     ├─ bootstrapService(counterService)
  │     │     │     └─ @State getter/setter on service
  │     │     ├─ _registerServiceState(counterService)
  │     │     │     └─ component.count ↔ service.count bridge
  │     │     └─ _forwardServiceMethods(counterService)
  │     │           └─ component.increment → service.increment + sync
  │     └─ init() / get()
  │
  ├─ component._render()          // SSR HTML
  └─ component.getInitialState()  // includes service state via bridge
```

### CRPC action (server)

```
POST /crpc { componentRouteId, action: 'increment', state: { count: 0 } }
  │
  ├─ createInstance(PageComponent)
  │     └─ resolves CounterService
  ├─ bootstrap({ skipInit: true })
  │     └─ _bootstrapServices() sets up bridge + forwarding
  ├─ _render()                     // rebuild component tree
  │
  ├─ Apply state: component.count = 0  → goes through bridge → service.count = 0
  ├─ Call action: component.increment() → forwards to service.increment()
  │     └─ service.count becomes 1
  │     └─ forwarding syncs: stateContainer.setPublic('count', 1)
  │
  └─ component.getPublicState()   → { count: 1 }
      // Returns to client
```

### Client-side proxy

```
user clicks "+" → serviceInstance.increment()
  │
  ├─ Proxy replaces increment on service
  ├─ Builds state: { count: 0 } from service @State
  ├─ POST /crpc { action: 'increment', state: { count: 0 }, payload: [] }
  │
  ├─ Server processes, returns { count: 1 }
  │
  ├─ Response handler:
  │    serviceInstance.count = 1   // updates service via setter
  │    this.requestUpdate()        // triggers component re-render
  │
  └─ Re-render: render() reads this.counterService.formatCount()
                → formatCount is @Shared, runs locally → "Count: 1"
```

---

## `_findServiceInstance` — How Services Are Located

After `createInstance` stores a service as an own property (via TypeScript parameter properties like `constructor(private counterService: CounterService)`), `_findServiceInstance` locates it by scanning `Object.keys(this)` for values that are `instanceof serviceClass`.

Fallback: parses the constructor source to extract parameter names, then checks each by name. This handles edge cases where the property isn't enumerable at scan time.

---

## Metadata Keys Used

| Key | Set By | Location | Contents |
|-----|--------|----------|----------|
| `cossack:service` | `@Service()` | class constructor | `{ scope: 'singleton' \| 'transient' }` |
| `cossack:state` | `@State()` | class constructor | `{ [key]: { channel, provider } }` |
| `cossack:server-methods` | `@Server()`, `@Shared()` | class constructor | `{ [methodName]: { channel, provider } }` |
| `cossack:client-methods` | `@Client()`, `@Shared()` | class constructor | `{ [methodName]: true \| { channel } }` |
| `design:paramtypes` | TypeScript compiler (emitDecoratorMetadata) | class constructor | `[Class, Class, ...]` |
| `page:options` | `@Page()` | class constructor | `{ channels, transport, ... }` |

---

## Known Constraints

1. **`emitDecoratorMetadata` required**: Without it, `design:paramtypes` is undefined and no services are resolved. Must be set in `tsconfig.json`.

2. **Test environment limitation**: Vitest uses esbuild which doesn't emit `design:paramtypes`. Tests must manually call `Reflect.defineMetadata('design:paramtypes', [...], Class)` before testing DI resolution.

3. **No file-convention auto-discovery**: Services must be explicitly imported in components. Placing a file in `src/services/` does nothing automatically.

4. **State is per-component-lifecycle**: Service `@State` lives inside the component's state container. On HTTP transport, state resets on page reload (same as component state). On durable-object transport, state persists in the DO.

5. **No lifecycle hooks on services**: Services don't have `onMount`/`onCleanup`. Use the parent component's hooks.

6. **Method name collisions**: If the component and a service both define a method with the same name, the component's method wins. `_forwardServiceMethods` skips methods that already exist on the component.

7. **`@Shared` is dual-registered**: Both `cossack:server-methods` and `cossack:client-methods` contain `@Shared` methods. All filtering logic must check: `if (clientMethods[methodName]) continue` to avoid proxying shared methods.

8. **Global container is per-JS-environment**: Server and client each have their own global container. Singletons are not shared between server and client (they are separate processes/runtimes).
