# Client Bundle Security: Method Stripping

Cossack is "secure by default" when it comes to the client bundle: any method on
a `Cossack` / `CossackElement` subclass that does not need to run in the browser
is **stripped** from the client build and replaced with a stub. This prevents
database queries, API keys, secrets, and server-side business logic from
accidentally leaking to the browser.

This document explains the rule, the escape hatches, and what happens when you
call a method that was stripped.

## The Rule

During the client build, the Cossack Vite security plugin walks every class that
`extends Cossack`, `extends CossackElement`, or is decorated with `@Service`,
and for each top-level method it asks:

> Is this method client-safe — either explicitly decorated as such, or a
> built-in lifecycle method, or reachable (directly or transitively) from a
> client-safe method on the same class?

If the answer is **no**, the method body is replaced with a stub. The original
source — including any literals, imports, and logic — is removed from the bundle.

### Built-in allowlist

These method names are always preserved because the framework calls them on the
client:

| Method | Notes |
| --- | --- |
| `render()` | Returns the template |
| `head()` | Head metadata |
| `onMount()` | Client mount hook |
| `onCleanup()` | Pre-destroy hook |
| `onNavigateComplete()` | Post-navigation hook (App) |
| `clientInit()` | Client-only init |
| `loadingTemplate()` | Loading UI |
| `escapeHtml()` | HTML escaping helper |
| `getError`, `hasError`, `validateProperty`, `validateAll`, `clearErrors` | Validation API |
| `toString`, `valueOf` | Object defaults |

`init()` and `get()` are **not** in the allowlist — they are server-only by
default because they typically fetch data.

### Client-safe decorators

Any method decorated with one of these is preserved in the client bundle with
its full implementation:

- `@Client()` — client-only method (stubbed on the server); also the escape hatch for helpers the transitive scan can't detect
- `@Optimistic(action)` — optimistic UI handler
- `@Computed()` — memoized getter
- `@Shared()` — runs on both client and server
- `@On(event)` / `@OnDocument(event)` / `@OnWindow(event)` / `@OnEvent(event)` — event listeners
- `@Task()` — runs on mount and every state update
- `@VisibleTask()` — runs when an element enters the viewport
- `@PreventNavigation()` — navigation guard
- `@Validate(...)` — property validation (also marks the property)

### Transitive preservation (helpers called from client-safe methods)

You do **not** have to decorate every helper. If a preserved method calls
another method on the same class via `this.foo(...)`, the called method is kept
as well, recursively up to a fixed depth (currently 3 levels). This covers the
common pattern of splitting `onMount()` setup into smaller helpers:

```typescript
@Page()
export default class RevealList extends Cossack {
    onMount() {
        // onMount is preserved, and setupReveal is preserved transitively.
        this.setupReveal();
    }

    private setupReveal() {
        // No decorator needed — reachable from onMount.
        const observer = new IntersectionObserver((entries) => { /* ... */ });
        for (const el of this.container!.querySelectorAll('.reveal')) {
            observer.observe(el);
        }
    }

    render() {
        return html`<div class="reveal">...</div>`;
    }
}
```

The transitive scan only follows `this.methodName(...)` calls. Calls through
dynamic proxies, `Function.prototype.call` with an arbitrary receiver, or
methods passed as callbacks to external code are **not** detected — mark the
helper with `@Client()` in those cases (see below).

## `@Client()` as the escape hatch

When a helper is called from a client-safe hook but the call can't be detected
statically (e.g. it's passed as a callback to a third-party library), decorate
it with `@Client()`. This preserves the full implementation in the client
bundle and replaces the body with a no-op on the server.

```typescript
import { Cossack, Client } from '@cossackframework/core';

export default class Chart extends Cossack {
    onMount() {
        // draw() is registered as a global callback by the chart library,
        // so the static transitive scan can't see the call. Mark it explicitly.
        this.lib.registerCallback(() => this.draw());
    }

    @Client()
    private draw() {
        // full implementation kept in the client bundle
    }
}
```

## What happens when you call a stripped method

If client code calls a method that was stripped, the stub checks for an RPC
proxy:

- **`@Server` methods** receive a proxy at bootstrap, so the stub transparently
  forwards the call over WebSocket/HTTP/SSE. This is the normal server-method
  calling experience.
- **Undecorated helpers that were stripped** have **no** proxy (they are not
  registered as RPC methods), so the stub throws a descriptive error:

  ```
  [Cossack] App.helper was stripped from the client bundle because it has no
  client-safe decorator and is not reachable from a client-safe method. Add
  @Client, @On, @OnWindow, @OnDocument, @Computed, @Shared, @Task, or
  @VisibleTask; ensure it is called (directly or transitively) from a
  preserved method; or avoid calling it from client code.
  ```

This fails loudly so you discover the problem immediately, rather than shipping
a silently broken RPC call.

## Workarounds

If you hit the "stripped from the client bundle" error, pick one:

1. **Add a client-safe decorator** (`@Client`, `@Shared`, `@Computed`, etc.)
   to the helper. `@Client` is the right choice for pure client-side plumbing.
2. **Ensure reachability** — make sure the helper is called (directly or
   transitively, up to 3 levels) from a client-safe method such as `onMount`,
   `render`, or a `@Client` method, using `this.helper(...)`.
3. **Inline** the helper's logic into the calling method if it is only used in
   one place.

Do **not** work around this by adding `@Server` to the helper — that turns it
into an RPC method, which is rarely what you want for a pure client-side helper
and will execute the body on the server instead of the client.
