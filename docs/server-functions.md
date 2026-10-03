---
title: "Server Functions"
description: "Load reactive, read-only server data inline with server$, including dependencies, hydration, refresh, and invalidation."
---

# Server functions with `server$`

`server$` declares read-only data whose loader runs on the server while its resolved value is available directly to rendering code. It replaces the common combination of `init()`, `@State()`, and a separate `@Server()` query method.

```typescript
import { Cossack, Page, server$ } from '@cossackframework/core';
import { User } from '@/models/User';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class UsersPage extends Cossack<any, { Resources: 'users' }> {
    users = server$(
        async () => (await User.find({ order: { createdAt: 'desc' } })).map(user => ({ id: user.id, name: user.name })),
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
@ClientState()
userId = '42';

user = server$(
    async (id: string) => {
        const user = await User.findOne({ where: { id } });
        return user ? { id: user.id, name: user.name } : null;
    },
    {
        deps: () => [this.userId] as const,
        initial: null,
    },
);
```

Use `@ClientState` for browser-owned filters and selections. Their dependency
arguments are still sent to the loader, but server snapshots cannot reset the
selection. Use `@State` when the server owns the selected value. Authoritative
realtime snapshots can replace a browser write to shared state.

The `deps` callback remains in the client bundle. Its values and dependency identity are public hydration data; use browser-safe values, never secrets or private bindings. The loader does not. When dependencies change, Cossack keeps the last successful value while the new call runs. It schedules an update when the call resolves. Concurrent reads of the same call share one request.

Dependency arguments and returned values must be transport-safe: finite numbers,
strings, booleans, null, arrays, and plain acyclic objects. Repeated references
are allowed. Use ISO strings for dates; custom `toJSON` hooks and class instances
are rejected before serialization. Dependencies cannot contain `undefined`: use
`null` for absent values so JSON does not change their identity. A loader may
return `undefined`. Map model instances to plain data inside the loader; keep
model methods on the server. Both SSR and generated RPC methods validate results
before JSON conversion. Unsupported values produce a named
`ServerResourceSerializationError`.

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

`this.resourceStatus$('users')` returns a snapshot with `state` (`pending`,
`ready`, or `error`), `hasValue`, `value`, `error`, and `stale`. For a named field,
status starts its initial load even before render. `refresh$` binds the field's
current dependencies and starts one new invocation, including immediately after
hydration. It retains the last successful value; only the newest invocation may
update status. Unknown names throw without evaluating unrelated getters.

Declare the public field names in the component's `Resources` option to check
status, refresh, and invalidation calls at compile time. Status values are inferred
from those fields; no wrapper or second copy of their value types is needed.

```ts
class Users extends Cossack<Env, { Resources: 'users' | 'selected' }> {
    users = server$(async (): Promise<User[]> => loadUsers(), { initial: [] });
    selected = server$((): User | null => loadSelected(), { initial: null });

    render() {
        const status = this.resourceStatus$('users');
        if (status.state === 'ready') {
            // status.value is User[], including when the loaded array is empty.
            return html`${status.value.map(user => user.name)}`;
        }
        return html`Loading…`;
    }
}
```

Misspelled names, ordinary fields outside `Resources`, and names without matching
public fields fail type checking. `ready` means `hasValue: true`; it preserves
nullable or optional result types. For `pending` and `error`, check `hasValue`
before using data. Without `Resources`, names remain checked at runtime and status
values are `unknown`. Inline
render resources retain compiler IDs and require a render pass before lifecycle
calls; use named fields when you need a typed refresh target.

Hydration carries the value and the dependencies that produced it. Matching
dependencies reuse SSR data without an initial RPC. Changed dependencies keep
that data while a new load runs. Failed refreshes retain the last good data and
allow retry. Invalidation drops it and the next read uses the declared initial
value. Unmount discards outstanding results and errors; it does not stop ignored
external I/O. Reading a destroyed component's resource fails before loading.

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
