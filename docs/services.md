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
server-only work. Use `@Shared()` for safe logic that should execute locally in
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

- Each SSR request gets a fresh root scope, so requests cannot share service
  state or user data.
- Each service RPC request reconstructs the applicable layout hierarchy in a
  fresh request scope.
- In the browser, a reused layout keeps its scope across navigation between
  pages in the same subtree.
- Leaving the subtree disposes the scope. Returning later creates a new service
  instance with fresh or newly hydrated state.

Services may define an optional cleanup hook:

```typescript
@Service()
export class SearchService {
    private controller = new AbortController();

    onDispose() {
        this.controller.abort();
    }
}
```

`onDispose()` runs once when the owning scope is destroyed. Cleanup that must
finish before navigation continues should be synchronous: Promise-returning
hooks are started and rejection-logged, but are not awaited.

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
| `@Store()` | A reactive object or array; nested mutations also notify every consumer. |
| `@Server()` | An allowlisted server action, proxied automatically in the browser. |
| `@Shared()` | A method whose implementation runs locally on both client and server. |
| `@Client()` | A client-only method whose server implementation is stubbed. |
| `@Computed()` | A computed value evaluated locally rather than serialized as state. |

The framework serializes a service's state once under its owning layout, in a
separate `services` section. It does not copy service fields or methods onto
consumer components, so a component and service may safely use the same member
names.

Only declared `@State` and `@Store` fields are restored. Unknown client-supplied
keys and prototype-pollution keys are ignored. Values use the same JSON-safe
serialization contract as component state; cyclic structures and non-JSON
values should not be stored in synchronized service state.

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

## Service Dependencies

Services may use constructor injection for other services:

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

Declare dependencies in the same layout or an ancestor when they should share
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
layout ownership for shared reactive state or request-aware work; legacy global
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
