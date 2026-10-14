# Layout-Scoped Services / Dependency Injection

This document describes dependency injection (DI) when layouts own services.

## Public API

```ts
@Service()
class DashboardService extends CossackService {
  @State() count = 0;

  @Server()
  increment() { this.count++; }
}

@Page({ services: [DashboardService] })
class DashboardLayout extends Cossack {}

class DashboardChild extends Cossack {
  @Inject(DashboardService)
  private dashboard!: DashboardService;
}
```

`PageOptions.services` declares DI ownership on layouts. Pages use the nearest
layout scope. Putting `services` on a page does not create an owner.
`cossack check routes` reports `COSSACK_PAGE_SERVICES_UNSUPPORTED` for these
ignored declarations. Move them to an ancestor layout. `PageOptions.providers` maps
transport providers for WebSocket and Durable Object state. It does not declare
DI ownership.

`@Inject(ServiceClass)` injects a read-only property when code first reads it.
This happens after the renderer gives the component a parent. If no layout
declares the service, Cossack throws an error that names the requested service
and the requesting component, prints the active scope chain innermost-first
with the services each layout declares, and suggests the
`@Page({ services: [...] })` fix on the owning layout. `describeScopeChain()`
on a scope exposes the same ancestry for inspection without failing.

`CossackService` exposes these protected request facilities:

- `c`: the current Hono request context.
- `user`: the authenticated user, when present.
- `env`: the current runtime bindings.
- `redirect(url, status?)`: a server redirect response.

## Scope hierarchy and lifetime

`ServiceScope` forms a tree with parent and child scopes. Each layout gets a
child scope and owns the services in its `services` list. Resolution searches
from the active scope to the root. A nested declaration of the same class takes
priority over an outer declaration.

The framework creates:

- a fresh root scope for every SSR request,
- a fresh anonymous root scope for every SSG render,
- a fresh root scope for every component and service RPC request,
- one browser root scope, with child scopes retained alongside reused layouts.

The page receives the innermost layout scope. A nested component inherits the
scope through its renderer parent in `connectedCallback()`. No public renderer
context API is required.

When a layout leaves the client route stack, `destroy()` disposes its owned
scope. Disposal removes service subscriptions, recursively disposes child
scopes, and invokes each optional `onDispose()` hook once. SSR and ordinary
component/service RPC await disposal in request-handler cleanup.
Component RPC waits for component and scope cleanup. A streamed result retains
the scope until completion, failure, or cancellation. `dispose()` is synchronous.
An async `onDispose()` hook is started and rejection-logged, but navigation and
request completion do not wait for it. `disposeAsync()` waits for all child and
service hooks, including cleanup started earlier by `dispose()`, and reports
failures with an `AggregateError`. A throwing hook accessor is also collected.
It does not prevent other services or child scopes from being cleaned.
Successful completed child disposals are not
retained by a long-lived browser root.

`destroyAsync()` waits for component and descendant cleanup, then releases an
owned scope. Independent cleanup still runs if a hook throws. Repeated destroy
and dispose calls do not repeat hooks. SSG uses these awaitable operations before
returning HTML. Failed cleanup fails generation and retains a preceding render
error as the cause. SSR logs cleanup failures and continues remaining cleanup.
Browser callers using `destroy()` start cleanup without awaiting it. Explicit
callers can use `destroyAsync()` for completion ordering. Streamed and native-body
RPC keep their scope until the response completes, fails, or is cancelled.

Duplicate entries in one `services` array and entries lacking `@Service()` are
configuration errors. Service ownership is never inferred from the first
consumer.

## Global singletons versus layout and request scopes

Choose ownership by state lifetime, not convenience:

| Ownership | Lifetime | Use for |
| --- | --- | --- |
| Global container (`@Service({ scope: 'singleton' })`, undeclared constructor injection) | One isolate, survives across requests | Stateless helpers, pure functions over inputs, immutable configuration |
| Layout declaration (`@Page({ services: [...] })`) | Layout presence on the route stack, disposed when the layout leaves | Subtree state shared by pages and children under the layout |
| Request root scope | One SSR/SSG/RPC request | Request-local work, nothing shared with other requests |

A global singleton must not retain request-specific or user-specific mutable
state. Concurrent requests in one isolate can observe each other's data.
Component bootstrap enforces this for the legacy constructor-injection bridge:
an undeclared singleton service that declares `@State`/`@Store` throws, naming
the `@Page({ services: [...] })` fix. The
resolution error's scope chain shows which layouts are active and what they
declare, so a misplaced declaration is visible without tracing framework
internals. Undeclared constructor injection falls back to the global container
silently (legacy compatibility). `@Inject` on a property is strict and fails
with the diagnostic above when no active layout declares the service.

## Compatibility

`DIContainer` and constructor injection remain supported. With an active layout
scope, constructor resolution first uses an explicit declaration. Otherwise it
falls back to the global container and continues honoring
`@Service({ scope: 'singleton' | 'transient' })`.

Legacy global services must not retain request/user-specific mutable state.
Explicitly declared services are the request-safe choice for subtree state.
The legacy component bridge remains only for undeclared constructor-injected
services. Explicitly scoped services are never flattened onto components.

## Reactive state and hydration

Each declared service is bootstrapped once. `@State` setters and recursive
`@Store` proxies publish changes to every component that injected the instance.
Each consumer rerenders through its normal `requestUpdate()` path.

State is serialized once on the owning layout:

```ts
{
  public: { /* layout component state */ },
  services: {
    "0": { count: 2 }
  }
}
```

The stable slot is the declaration index, so independently minified server and
client class names cannot diverge. Service state is separate from component `public` state
and transport `providerTargets`, preventing key collisions. Only service
`@State`/`@Store` fields hydrate. Client-supplied unknown keys and prototype
pollution keys are ignored.

When the browser reuses a layout during navigation, it keeps the live scope and
does not overwrite it with newly fetched SSR state. Leaving and later re-entering
the subtree creates a new scope and hydrates that new layout response.

## Service RPC

A scoped service method is never forwarded onto a component. The client proxy
sends an explicit envelope to `/crpc`:

```ts
{
  service: {
    ownerRouteId: "<owning-layout-route-id>",
    slot: "0"
  },
  action: "increment",
  payload: [],
  state: { count: 2 },
  scopeKey: "..."
}
```

The server makes sure that the layout route and slot are valid, reconstructs its
ancestor layout scope hierarchy, restores allowlisted service state, and accepts
only actions in the service class's `cossack:server-methods` metadata. Framework
internals, shared/client methods, undecorated helpers, and forged names are
rejected.

The response keeps service state separate too:

```ts
{
  _cossack_service_state: { count: 3 },
  _cossack_return: "optional return value",
  _cossack_redirect: "/optional redirect"
}
```

The request scope binds `CossackService.c`, `user`, and `env` before invocation.
Because the instance and scope are request-local, concurrent users cannot share
request facilities or mutable service state.

## Internal file map

| File | Responsibility |
|---|---|
| `packages/core/src/shared/decorators.ts` | `services`, `@Service`, and `@Inject` metadata |
| `packages/core/src/shared/container.ts` | Legacy container and scope-aware constructor creation |
| `packages/core/src/shared/service-scope.ts` | Hierarchy, ownership, slots, RPC proxy, disposal, state sanitization |
| `packages/core/src/shared/service-bootstrap.ts` | Service `@State`/`@Store` bootstrap, hydration, subscriptions |
| `packages/core/src/shared/cossack-service.ts` | Request-aware service base class |
| `packages/core/src/shared/cossack.ts` | Scope attachment/inheritance, injection subscriptions, layout serialization |
| `packages/framework/src/router.ts` | SSR scope construction and service RPC dispatch |
| `packages/framework/src/client/app.ts` | Scope retention/disposal across layout navigation |

## Required regression coverage

Tests must cover declaration validation, lazy injection, nested shadowing,
missing declarations, constructor compatibility, reactive fan-out, serialization
and hydration isolation, disposal, request context isolation, service RPC return
and redirect metadata, allowlisting/forged-action rejection, layout navigation
persistence/reset, and unchanged transport-provider behavior.
