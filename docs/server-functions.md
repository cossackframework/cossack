---
title: "Server Functions"
description: "Load reactive, read-only server data inline with server$, including dependencies, hydration, refresh, and invalidation."
---

# Server functions with `server$`

`server$` declares read-only data whose loader runs on the server while its resolved value is available directly to rendering code. It replaces the common combination of `init()`, `@State()`, and a separate `@Server()` query method.

```typescript
import { Cossack, Page, server$ } from '@cossackframework/core';
import { User } from '@/models/User';

@Page({ transport: 'http' })
export default class UsersPage extends Cossack {
    users = server$(
        () => User.find({ order: { createdAt: 'desc' } }),
        { initial: [] },
    );

    render() {
        return html`${this.users.map((user) => html`<p>${user.name}</p>`)}`;
    }
}
```

The compiler extracts the loader into a generated server method. Its body and loader-only imports are removed from the client bundle. SSR waits for discovered resources, serializes their values into hydration state, and the browser reuses those values instead of issuing a duplicate initial request.

## Named resources

A class-field resource must provide `initial`. The field exposes the resolved value directly, so no `.data` or resource wrapper is needed.

```typescript
profile = server$(
    () => getCurrentProfile(),
    { initial: null },
);
```

Set the initial value to a shape that the render method can use. Cossack keeps falsy results such as `false`, `0`, an empty string, and `null` as resolved values.

## Inline resources

Call `server$` directly inside `render()` for a one-off value:

```typescript
render() {
    return html`<h1>${server$(() => config('app.name'))}</h1>`;
}
```

Inline calls can omit `initial`. Their type is `T | undefined`, and they render empty while a client-side request is pending. Cossack identifies an inline call by its module, component class, and call order in `render()`. Keep the call order fixed.

## Reactive dependencies

Use `deps` to declare values that select a resource invocation. The dependency values are passed to the loader as arguments:

```typescript
@State()
userId = '42';

user = server$(
    (id) => User.findOne({ where: { id } }),
    {
        deps: () => [this.userId] as const,
        initial: null,
    },
);
```

The `deps` callback remains in the client bundle. The loader does not. When dependencies change, Cossack keeps the last successful value while the new call runs. It schedules an update when the call resolves. Concurrent reads of the same call share one request.

Dependency arguments and returned values must be transport-safe: use primitives, arrays, and plain objects without circular references. Unsupported values produce a named `ServerResourceSerializationError` during development.

## Refresh and invalidation

Named resources can be controlled by their field name:

```typescript
@Client()
async refreshUsers() {
    await this.refresh$('users');
}

@Client()
invalidateUsers() {
    this.invalidate$('users');
}
```

- `refresh$('users')` bypasses the resolved invocation and immediately fetches it again while retaining the last good value.
- `invalidate$('users')` removes the current invocation. The next render starts it again from the declared initial value.

If a client refresh fails, the resource keeps its last successful value and records the error without continuously retrying. A dependency change, explicit refresh, or invalidation allows another attempt. During SSR, loader failures propagate into the existing hierarchical error-boundary flow.

## Where `server$` is allowed

Version 1 supports:

- Class-field initializers with `{ initial }`.
- Direct calls inside `render()`.

Calls in constructors, lifecycle hooks, event handlers, helper methods, assignments, or nested callbacks are rejected by the compiler. Import aliases are supported because recognition follows the imported binding:

```typescript
import { server$ as resource } from '@cossackframework/core';

settings = resource(() => loadSettings(), { initial: {} });
```

Only the binding imported as `server$` from `@cossackframework/core` is treated as a macro. An unrelated local function named `server$` is left unchanged.

## Server context and helpers

Extracted loaders retain component `this`, so server context remains available:

```typescript
account = server$(
    () => loadAccount(this.user?.id),
    { initial: null },
);
```

Request-scoped ORM models plus `config()`, `session()`, and `flash()` can be called inside a loader. Cossack intentionally does not add `this.orm`, `this.server$`, or broad helpers such as `session$` and `env$`.

## Queries, not mutations

Use `server$` for repeatable, read-only queries. Continue using `@Server()` methods for operations with effects:

- Database writes and other mutations.
- Redirects.
- Session, cookie, or flash writes.
- Broadcasts and client actions.

```typescript
@Server()
async deleteUser(id: string) {
    await User.delete({ id });
    await this.refresh$('users');
}
```

See the runnable demo at [`/examples/server-functions`](/examples/server-functions).
