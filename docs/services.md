---
title: "Services & Dependency Injection"
description: "Share reactive state and request-aware business logic within a layout subtree using explicit service scopes and lazy injection."
---

# Services & Dependency Injection

Services hold business logic and reactive state that several pages or components
need to share. A layout explicitly owns its services with `services`, and any
descendant can inject the same instance with `@Inject()`.

```typescript
@Page({ services: [DashboardService] })
export default class DashboardLayout extends Cossack {}

@Page()
export default class DashboardPage extends Cossack {
    @Inject(DashboardService)
    private dashboard!: DashboardService;
}
```

The scope follows the layout's lifetime: it is isolated per server request,
survives client navigation while the layout is reused, and is disposed when the
user leaves that layout subtree.

## Basic Usage

### 1. Define a Service

Decorate the class with `@Service()`. Extend `CossackService` when server methods
need the current request, authenticated user, environment bindings, or redirects.

```typescript
// src/services/DashboardService.ts
import {
    CossackService,
    Service,
    Shared,
    State,
    Store,
    Server,
} from '@cossackframework/core';

interface Env {
    API_URL: string;
}

@Service()
export class DashboardService extends CossackService<Env> {
    @State() count = 0;
    @Store() filters = { query: '', archived: false };

    @Server()
    async increment(): Promise<number | Response> {
        if (!this.user) return this.redirect('/login');

        // `this.env`, `this.c`, and `this.user` belong to this request.
        this.count++;
        return this.count;
    }

    @Shared()
    formatCount(): string {
        return `Count: ${this.count}`;
    }
}
```

Use `@Server()` for database access, external APIs, secrets, and other
server-only work. Use `@Shared()` for logic that can run locally in
both runtimes.

### 2. Declare Ownership on a Layout

Add the service class to the layout's `services` array:

```typescript
// src/pages/dashboard/layout.ts
import { Cossack, Inject, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { DashboardService } from '../../services/DashboardService';

@Page({ services: [DashboardService] })
export default class DashboardLayout extends Cossack {
    @Inject(DashboardService)
    private dashboard!: DashboardService;

    render() {
        return html`
            <aside>${this.dashboard.formatCount()}</aside>
            ${this.children}
        `;
    }
}
```

Service ownership is explicit. The framework does not create a scoped service
from the first place that injects it.

### 3. Inject It Anywhere Below the Layout

Pages, layouts, and renderer-created nested components resolve the nearest
active declaration lazily:

```typescript
// src/pages/dashboard/index.ts
import { Cossack, Inject, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { DashboardService } from '../../services/DashboardService';

@Page()
export default class DashboardPage extends Cossack {
    @Inject(DashboardService)
    private dashboard!: DashboardService;

    render() {
        return html`
            <button @click=${() => this.dashboard.increment()}>
                ${this.dashboard.formatCount()}
            </button>
        `;
    }
}
```

`@Inject()` defines a lazy, read-only property. No prop plumbing or public
renderer context API is needed. If no active parent layout declares the class,
the framework throws an error that names the missing service and shows where to
declare it.

## Scope and Lifetime

Every declaration creates one instance for that layout scope, regardless of
how many descendants inject it. All consumers rerender when one of the
service's `@State` fields or nested `@Store` values changes.
If a later declared service fails during construction or hydration, the
partially built scope disposes services that were already created; async
cleanup remains tracked by its parent scope.

- Each SSR request gets a fresh root scope, so requests cannot share service
 state or user data.
- Each SSG render gets its own anonymous request scope. Layout services,
 constructor injection, and service hydration use the same hierarchy as SSR.
- Each service RPC request reconstructs the applicable layout hierarchy in a
 fresh request scope.
- Component RPC also resolves services from a fresh layout hierarchy. A streamed
 action keeps its components and services alive until completion or cancellation.
- In the browser, a reused layout keeps its scope across navigation between
 pages in the same subtree.
- Leaving the subtree disposes the scope. Returning later creates a new service
 instance with fresh or newly hydrated state.

Each pending browser service action contributes to `loading[action]` on consumers
that inject that service. A new consumer inherits the count when it joins the
retained scope during an action. This includes sibling pages and nested components.
Consumers of another service do not inherit that action's loading count.
Duplicate subscriptions and unsubscribe/rejoin count once per invocation.

Each invocation releases its count once when it settles. A consumer that already
exited also releases its count, without another render. Independent component
calls and services with the same action name contribute separate counts.
Navigation within the retained layout does not repeat the mutation. Loading is
client invocation ownership and does not establish whether a server write committed.

Services can define an optional cleanup hook:

```typescript
@Service()
export class SearchService {
    private controller = new AbortController();

    onDispose() {
        this.controller.abort();
    }
}
```

`onDispose()` runs once when the owning scope is destroyed. `dispose()` starts
cleanup without waiting; `await scope.disposeAsync()` waits for child scopes
and Promise-returning hooks, and rejects with an `AggregateError` if any fail.
It also waits for cleanup already started by `dispose()`.
If a hook throws, rejects, or fails while its property is read, disposal still
attempts every other service hook and child scope.

Components have the equivalent `destroy()` and `destroyAsync()` methods.
Destruction releases renderer-created descendants, subscriptions, and owned
services even when `onCleanup()` fails. Async component hooks finish before
their owned services are disposed. Use `await component.destroyAsync()` when
the caller needs to wait for cleanup.

SSG waits for component and scoped-service cleanup before publishing a render.
Cleanup failures fail generation; a preceding render failure is retained as
the error's `cause`. SSR and ordinary component/service RPC await cleanup before
completing their response. Streamed and native-body RPC responses keep services
until the response body completes, fails, or is cancelled. SSR logs cleanup
failures with the request ID; it still attempts the remaining cleanup.
Browser callers using `destroy()` start cleanup without waiting. Use
`destroyAsync()` when an explicit caller needs to wait for completion.

## Nested Layouts and Shadowing

Resolution starts at the innermost active layout and walks outward. A nested
layout can declare the same class to create an isolated instance for its own
subtree:

```typescript
// The outer dashboard subtree has one instance.
@Page({ services: [PreferencesService] })
export class DashboardLayout extends Cossack {}

// Everything below this layout receives a different instance.
@Page({ services: [PreferencesService] })
export class AdminLayout extends Cossack {}
```

Duplicate entries in one `services` array are rejected, as are classes that do
not have `@Service()`.

## Request-Aware Services

`CossackService<Env>` provides protected facilities for server methods:

| Member | Purpose |
| :--- | :--- |
| `this.c` | Current Hono request context plus Cossack context helpers. |
| `this.user` | Current authenticated `User`, or `undefined`. |
| `this.env` | Current runtime bindings, typed by the `Env` generic. |
| `this.redirect(url, status?)` | Return a server redirect response. |

Prefer `this.user` for authenticated-user data. Do not cache a request context,
user, or bindings in a module-level variable or a legacy global singleton.
Explicit layout scopes bind these values to the current SSR or RPC request.

The request facilities are intended for request-bound server work. A browser
render has only a hydrated context shim, and server-only context operations
remain unavailable there.

## Reactive State and Hydration

Scoped services support the same public reactive state primitives as
components:

| Decorator | Service behavior |
| :--- | :--- |
| `@State()` | A reactive public field synchronized during hydration and service RPC. |
| `@Store()` | A reactive object or array. Nested mutations also notify every consumer. |
| `@Server()` | An allowlisted server action, proxied automatically in the browser. |
| `@Shared()` | A method whose implementation runs locally on both client and server. |
| `@Client()` | A client-only method whose server implementation is stubbed. |
| `@Computed()` | A computed value evaluated locally rather than serialized as state. |

The framework serializes a service's state once under its owning layout, in a
separate `services` section. It does not copy service fields or methods onto
consumer components, so a component and service can safely use the same member
names.

Only declared `@State` and `@Store` fields are restored. Unknown client-supplied
keys and prototype-pollution keys are ignored. Values use the same JSON-safe
serialization contract as component state. Do not store cyclic structures or
non-JSON values in synchronized service state.

During client navigation, state from a still-active layout is kept rather than
overwritten by a newly fetched SSR snapshot. A newly entered layout hydrates
its services before descendant components render.

## Server Actions

Calling an injected service's `@Server()` method in the browser uses Cossack's
built-in RPC channel. The request identifies the owning layout, a stable service
slot, the action, arguments, and current public service state. The server then:

1. Rebuilds the layout scope for the request.
2. Restores only the declared service state fields.
3. Verifies that the target method has `@Server()` metadata.
4. Invokes the method with request-local `c`, `user`, and `env` values.
5. Returns the method result, redirect metadata, and updated service state.

Undecorated helpers, `@Shared()` methods, `@Client()` methods, internal members,
and forged action names are not RPC-callable. The Vite security transform also
strips server-only method bodies from client bundles.

Use `rpc$(this.service.action(...))` in a client handler when you need typed
generator yields, final results, or cancellation. It returns the same service
proxy call and infers its types from the authored method. See
[server calls and client types](./rpc.md).

## Service Dependencies

Services can use constructor injection for other services:

```typescript
@Service()
export class AuditService {
    @Server()
    record(message: string) {
        // Persist the audit event.
    }
}

@Service()
export class BillingService {
    constructor(private audit: AuditService) {}

    @Server()
    async charge(amount: number) {
        this.audit.record(`Charging ${amount}`);
        // Process the charge.
    }
}

@Page({ services: [AuditService, BillingService] })
export class BillingLayout extends Cossack {}
```

Declare dependencies in the same layout or an ancestor when they must share
that subtree's scope. Circular dependency graphs are rejected.

## Constructor Injection Compatibility

Existing constructor injection remains supported:

```typescript
@Page()
export class LegacyPage extends Cossack {
    constructor(private logger: LoggerService) {
        super();
    }
}
```

When a matching explicit layout declaration exists, constructor injection uses
that scoped instance. Otherwise it falls back to the legacy DI container and
honors `@Service({ scope: 'singleton' | 'transient' })`.

The `scope` option controls only that legacy fallback. A class explicitly listed
in `services` always has one instance owned by that layout scope. Prefer explicit
layout ownership for shared reactive state or request-aware work. The legacy global
singletons must never retain request- or user-specific mutable data.

## `services` Is Not `providers`

These similarly named page options solve different problems:

| API | Use it for |
| :--- | :--- |
| `services: [DashboardService]` | DI ownership, subtree-shared logic, reactive state, and request-aware actions. |
| `providers: { room: roomProvider }` | Selecting WebSocket, SSE, or Durable Object state transports. |

Adding a service does not configure a transport provider, and adding a provider
does not make a class injectable.

For browser-only application-global UI state shared across unrelated trees,
such as theme, toast, or command-palette state, continue to use
[`createStore()` and `connectStore()`](/docs/reactive-store.md).

## File Convention

Services are commonly kept in `src/services/` and imported explicitly by the
layout that owns them and by each consumer:

```text
src/
  services/
    DashboardService.ts
  pages/
    dashboard/
      layout.ts
      index.ts
      settings/
        index.ts
```

There is no service auto-discovery. This keeps ownership visible and prevents a
consumer from silently creating a new scope.

## Cancel an optimistic service stream

Use rpc$(service.method(...)) to iterate and cancel the same invocation.
The service proxy uses HTTP on HTTP, SSE and socket pages. Each subscribed consumer
owns one loading contribution. Late consumers inherit it; duplicate injection does
not add a second count. Cancellation also releases ownership before iteration starts.
A request producer that ignores abort cannot hold the client response wait open.
Its late body is released and cannot hydrate service state.

A confirmed yield supplies public state. A later malformed frame, error or cancellation
keeps that state, removes only unconfirmed previews and settles each consumer once.
ClientState/ClientStore drafts remain local. Canceling does not roll back a server
write or terminate ignored application I/O. Use an application-chosen authoritative
read after uncertain completion. See the [optimistic guide](./optimistic.md#cancel-a-stream).
