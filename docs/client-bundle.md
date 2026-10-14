---
title: "Client Bundle Security: Method Stripping"
description: "Cossack strips server-only methods from client bundles to prevent database queries and business logic from leaking to browsers."
---

# Client Bundle Security: Method Stripping

The client bundle is secure by default. The client build strips any method on
a `Cossack` / `CossackElement` subclass that does not need to run in the browser
and replaces it with a stub. This prevents
database queries, API keys, secrets, and server-side business logic from
accidentally leaking to the browser.

This page explains the rule, the escape hatches, and what happens when you
call a method that was stripped.

## Development requests and production dependencies

Vite serves application modules separately in development. `cossackPages()`
pre-bundles core and renderer, including linked local packages, to reduce the
number of browser requests. With an installed framework it also pre-bundles
`@cossackframework/framework/client/devtools`, which the development trace
bridge loads with every page. Vite would otherwise find it during the first page
load, re-bundle, and reload the page. This does not make the dev bundle a
measure of production size. After rebuilding a linked package, restart with
`pnpm dev --force` to refresh Vite's dependency cache.

Production builds remove unused library exports. The browser runtime also
excludes the server action dispatcher, its input validation, and rate-limit
providers unless the application explicitly imports those APIs. Components
without `static styles` do not include the CSS parser. Using `css` or `unsafeCSS`
keeps the parser so component styles work during rendering and hydration.

Default SPA navigation retains navigation draft handling. The client app also
installs translation globals, so it retains the i18n runtime. These are current
client app features even when a page contains only static text.

## The Rule

During the client build, the Cossack Vite security plugin walks every
framework class: a class that extends `Cossack`, `CossackElement` or
`CossackService`, is decorated with `@Page`, `@Component` or `@Service`, or
has an `@Server` member. See [class discovery](#build-failures-and-class-discovery)
for how the plugin recognizes these classes. For each top-level method it asks:

The plugin finds these classes wherever they are written: class declarations,
`export default`, class expressions such as `export const Page = class extends
Cossack {}` or `wrap(class extends Cossack {})`, and classes inside function
bodies. A component class declared inside another class's method fails the
build, because its members cannot be stripped safely there. Move it to module
scope.

> Is this method client-safe? A method is client-safe when an explicit
> decorator marks it, when it is a built-in lifecycle method, or when a
> client-safe method on the same class calls it directly or transitively.

If the answer is no, the method body is replaced with a stub. The original
source, including any literals, imports, and logic, is removed from the bundle.

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

`init()` and `get()` are not in the allowlist. They are server-only by
default because they typically fetch data.

### Client-safe decorators

Any method decorated with one of these is preserved in the client bundle with
its full implementation:

- `@Client()`: a client-only method. The server uses a stub. Use this decorator for helpers the transitive scan cannot detect.
- `@Optimistic(action)`: optimistic UI handler
- `@Computed()`: memoized getter
- `@Shared()`: runs locally on both client and server and is never proxied
- `@On(event)` / `@OnDocument(event)` / `@OnWindow(event)` / `@OnEvent(event)`: event listeners
- `@Task()`: runs on mount and every state update
- `@VisibleTask()`: runs when an element enters the viewport
- `@PreventNavigation()`: navigation guard
- `@Validate(...)`: property validation (also marks the property)

### Transitive preservation (helpers called from client-safe methods)

You do not have to decorate every helper. If a preserved method calls
another method on the same class via `this.foo(...)`, the called method is kept
as well, recursively, with no depth limit. Private methods (`this.#foo()`)
follow the same rule. This covers the common pattern of splitting `onMount()`
setup into smaller helpers:

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
methods passed as callbacks to external code are not detected. Mark the
helper with `@Client()` in those cases (see below).

### Event handlers are RPC boundaries

A call inside an event handler runs later, when the user acts. It does not keep
the called method in the client bundle. These two handlers behave the same:

```typescript
render() {
    return html`
        <button @click=${this.remove}>Remove</button>
        <button @click=${() => this.remove(item.id)}>Remove</button>
    `;
}
```

If `remove` has no decorator, both handlers call it on the server as an
automatic RPC endpoint, and its body is stripped from the client. This applies
to functions in template `@event` slots in any client method, and to `onX` /
`@x` component props written in `render()`. To run the handler in the browser,
mark the method `@Client()`.

During `vite dev`, the plugin logs the automatic RPC endpoints of each module,
and logs again when they change:

```
[cossack-security] src/pages/todos/index.ts: automatic RPC endpoints TodoPage.remove (undecorated methods used as event handlers run on the server).
```

Explicit `@Server` methods are not listed. The log follows the `devWarning`
option. Set `cossackSecurityPlugin({ logRpcEndpoints: false })` to turn it off,
or `true` to turn it on when `devWarning` is off. Production builds and Vitest
runs do not log unless `logRpcEndpoints` is `true`.

## `@Client()` as the escape hatch

When a helper is called from a client-safe hook but the call cannot be detected
statically (for example it is passed as a callback to a third-party library), decorate
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

If client code calls a method that was stripped, the stub looks for an RPC
proxy:

- `@Server` methods receive a proxy at bootstrap. The stub transparently
 forwards the call over WebSocket/HTTP/SSE. This is the normal server-method
 calling experience.
- Stripped helpers without a decorator have no proxy (they are not
 registered as RPC methods). The stub throws a descriptive error:

  ```
  [Cossack] App.helper was stripped from the client bundle because it has no
  client-safe decorator and is not reachable from a client-safe method. Add
  @Client, @On, @OnWindow, @OnDocument, @Computed, @Shared, @Task, or
  @VisibleTask; ensure it is called (directly or transitively) from a
  preserved method; or avoid calling it from client code.
  ```

The error appears immediately. You do not ship a silently broken RPC call.

## Workarounds

If you hit the "stripped from the client bundle" error, pick one:

1. Add a client-safe decorator (`@Client`, `@Shared`, `@Computed`, etc.)
 to the helper. `@Client` is the right choice for pure client-side plumbing.
2. Keep the helper reachable. Call the helper (directly or
 transitively) from a client-safe method such as `onMount`,
 `render`, or a `@Client` method, using `this.helper(...)`. A call inside an
 event handler function does not count, because the handler runs later.
3. Inline the helper's logic into the calling method if only one place uses it.

Do not work around this by adding `@Server` to the helper. `@Server` turns it
into an RPC method, which is rarely what you want for a pure client-side helper.
The body then executes on the server instead of the client.

## SSG `generateStaticParams`

The same secure-by-default treatment applies to the SSG helper
`generateStaticParams` passed inside `@Page(...)` / `@Component(...)`. The
plugin strips it from the `ssg` options of any class decorator call, including
an aliased or namespaced decorator. A module-level loader that only
`generateStaticParams` uses is removed too:

```typescript
@Page({
  ssg: {
    enabled: true,
    generateStaticParams: async () => {
      // This body is stripped from the client bundle.
      const users = await db.select().from('users');
      return users.map((u) => ({ username: u.name }));
    },
  },
})
export class UserProfile extends Cossack { /* ... */ }
```

`generateStaticParams` runs only at SSG build time (see
`getStaticParams` in `ssg-renderer.ts`). It never runs on the client, so its
body is a leak risk in the client bundle. The security plugin replaces each
occurrence with `async () => []`, preserving the declared type and acting as
a defensive no-op. The `enabled` flag and any other `@Page` options are
preserved.

The plugin strips `generateStaticParams` when it is written in one of these
places:

- the options object of the decorator call, written inline;
- a module-level `const` object that the decorator call names, such as
  `@Page(options)`;
- an `ssg` value that is inline or a module-level `const` object, such as
  `@Page({ ssg })`;
- an object spread into the options or the `ssg` value from a module-level
  `const` object, such as `@Page({ ...shared })`.

The property can be a function value, a method, a quoted key or a shorthand
property. The client build fails for any other runtime `generateStaticParams`
property in an application module, for example options that a function
returns, options exported for another module to use, or a later assignment
such as `options.ssg.generateStaticParams = load`. The build does not ship a
loader that it cannot strip. Type declarations, destructuring, and matches
inside string literals, comments and template literals (for example a `<pre>`
code sample that quotes the function) are not affected.

## Build failures and class discovery

The plugin removes unused server-only imports after stripping method bodies.
If client code still uses a server-only import, the build fails. The named
`createAuthorizer` import from `@cossackframework/auth` is allowed: page
decorators and conditional UI use its role and permission helpers in both
environments. Keep authentication and session operations in server methods.

Class discovery is fail closed. Every class in a client module is a framework
class (stripped), a plain class (left unchanged), or a class the plugin cannot
classify, which fails the build when stripping would change it.

A class is a framework class when one of these is true:

- Its superclass expression names `Cossack`, `CossackElement` or
  `CossackService`, directly, through an alias of a `@cossackframework/*`
  import, or through a namespace import (`core.Cossack`). The name can be
  anywhere in the expression, for example in a mixin call such as
  `extends WithTracking(Cossack)` or a cast such as `extends (Cossack as any)`.
- Its superclass is another framework class in the same module.
- Its superclass is imported from another application module and that class is
  a framework class. The plugin reads the module without running it. It follows
  relative imports, root-relative imports (`/src/...`), Vite `resolve.alias`
  entries, re-exports, `export *`, default exports, namespace imports and
  inheritance chains across modules, up to 8 modules deep. Every class that
  `@cossackframework/ui` exports is a framework class.
- It has a `@Page`, `@Component` or `@Service` decorator. The decorator can come
  from any module, including your own re-export, and can be namespaced
  (`@fw.Component()`).
- It has an `@Server` member.

A class is a plain class when it has no superclass, or extends a global such as
`HTMLElement` or `Error`, a plain class in the same module, a plain class in
another application module, or a class from an installed package other than
the framework classes above.

The plugin cannot classify a class whose superclass is one of these:

- an import that names no readable module, for example a TypeScript `paths`
  alias that is not a Vite alias;
- an export that is not a class, such as `export const Base = makeBase()`;
- a module-level value computed at runtime, such as `const Base = makeBase()`;
- an expression such as a call, unless it names a framework base.

The client build fails for such a class when treating it as a component would
strip at least one of its methods. Decorate the class with `@Page()` or
`@Component()` if it is a component. Otherwise mark the methods that run in the
browser with `@Client()`. A class whose methods are all built-ins, helpers that
`render()` calls, `@Client` methods, accessors or arrow function fields is left
unchanged.

The server build classifies classes in the same way, so automatic RPC endpoints
match on both sides.

The transform strips `.ts` and `.mts` application modules. A framework class in
another script module inside the Vite root (for example `.js`) fails the client
build. Formatting and Vite query suffixes do not disable the transform.

If the parser cannot analyze a client module, the build fails. It does not emit
the unchanged source. `@Server` accessors and dynamic computed names are rejected.
Use a method or function field with a static name for server code.

Keep secrets out of constructors, ordinary field initializers, accessors, and
client-safe methods. Those parts still run in the browser.
