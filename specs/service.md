# Layout-Scoped Services / Dependency Injection

This specification describes Cossack's DI model after layout-scoped ownership.

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

`PageOptions.services` is DI ownership. `PageOptions.providers` remains the
transport-provider map for WebSocket/Durable Object state and has no DI role.

`@Inject(ServiceClass)` is a lazy, read-only property injection. The property
resolves when first read, after renderer-created components have acquired their
rendering parent. A missing declaration throws an error that names the service
and recommends adding it to a parent layout.

`CossackService` exposes these protected request facilities:

- `c`: the current Hono request context;
- `user`: the authenticated user, when present;
- `env`: the current runtime bindings;
- `redirect(url, status?)`: a server redirect response.

## Scope hierarchy and lifetime

`ServiceScope` forms a parent-linked tree. Each layout receives a child scope;
its `services` entries are instantiated and owned there. Resolution searches
from the active scope toward the root, so a nested declaration of the same
class shadows an outer instance.

The framework creates:

- a fresh root scope for every SSR request;
- a fresh root scope for every service RPC request;
- one browser root scope, with child scopes retained alongside reused layouts.

The page receives the innermost layout scope. A nested component inherits the
scope through its renderer parent in `connectedCallback()`. No public renderer
context API is required.

When a layout leaves the client route stack, `destroy()` disposes its owned
scope. Disposal removes service subscriptions, recursively disposes child
scopes, and invokes each optional `onDispose()` hook once. SSR/RPC root scopes
are disposed in request-handler `finally` blocks. `dispose()` is synchronous;
an async `onDispose()` hook is started and rejection-logged, but navigation and
request completion do not wait for it. Use synchronous cleanup when ordering is
required.

Duplicate entries in one `services` array and entries lacking `@Service()` are
configuration errors. Service ownership is never inferred from the first
consumer.

## Compatibility

`DIContainer` and constructor injection remain supported. With an active layout
scope, constructor resolution first uses an explicit declaration. Otherwise it
falls back to the existing global container and continues honoring
`@Service({ scope: 'singleton' | 'transient' })`.

Legacy global services must not retain request/user-specific mutable state.
Explicitly declared services are the request-safe choice for subtree state.
The legacy component bridge remains only for undeclared constructor-injected
services; explicitly scoped services are never flattened onto components.

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
`@State`/`@Store` fields hydrate; client-supplied unknown keys and prototype
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

The server validates the layout route and slot, reconstructs its ancestor layout
scope hierarchy, restores allowlisted service state, and accepts only actions in
the service class's `cossack:server-methods` metadata. Framework internals,
shared/client methods, undecorated helpers, and forged names are rejected.

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
