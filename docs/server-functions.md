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

`server$` is valid only in these two places: a class-field initializer and a
direct call inside `render()`, both on a component class. Anywhere else, such as
module scope, another method, a nested function, or a class that is not a
component, the build fails. The compiler cannot move the loader to the server
from those places, so it refuses to ship it to the browser.

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

The `deps` callback remains in the client bundle. Its values and dependency identity are public hydration data. Use browser-safe values, never secrets or private bindings. The loader does not. When dependencies change, Cossack keeps the last successful value while the new call runs. It schedules an update when the call resolves. Concurrent reads of the same call share one request.

Dependency arguments and returned values must be transport-safe: finite numbers,
strings, booleans, null, arrays, and plain acyclic objects. Repeated references
are allowed. Use ISO strings for dates. Custom `toJSON` hooks and class instances
are rejected before serialization. Dependencies cannot contain `undefined`: use
`null` for absent values so JSON does not change their identity. A loader can
return `undefined`. Map model instances to plain data inside the loader. Keep
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

### Read a resource outside render()

A `server$` field loads lazily. Cossack calls the loader only when code reads
the field. When `render()` reads the field, a change to `deps` starts a new call
on the next render. When only an event handler reads the field, a change to
`deps` starts nothing. The first read in the handler starts the call and
returns the last value or `initial`, not the new data.

Use `await this.load$('name')` in handlers. It reads the current `deps`, starts
the call if needed, shares a call that is already running, and returns the
loaded value. If the call fails, `load$` rejects with the error.

```typescript
@Client()
async submitLead() {
    const property = await this.load$('leadProperty');
    if (!property) return;
    // property is loaded for the current selectedAddressId.
}
```

If a client refresh fails, the resource keeps its last successful value and records the error without continuously retrying. A dependency change, explicit refresh, or invalidation allows another attempt. During SSR, loader failures propagate into the hierarchical error-boundary flow.

`this.resourceStatus$('users')` returns a snapshot with `state` (`pending`,
`ready`, or `error`), `hasValue`, `value`, `error`, and `stale`. For a named field,
status starts its initial load even before render. `refresh$` binds the field's
current dependencies and starts one new invocation, including immediately after
hydration. It retains the last successful value. Only the newest invocation can
update status. Unknown names throw without evaluating unrelated getters.

Declare the public field names in the component's `Resources` option. The compiler
then validates status, refresh, and invalidation calls at compile time. Status
values are inferred from those fields. No wrapper or second copy of their value
types is needed.

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
public fields fail type checking. `ready` means `hasValue: true`. It preserves
nullable or optional result types. For `pending` and `error`, read `hasValue`
before you use the data. Without `Resources`, names remain validated at runtime
and status values are `unknown`. Inline
render resources retain compiler IDs and require a render pass before lifecycle
calls. Use named fields when you need a typed refresh target.

Hydration carries the value and the dependencies that produced it. Matching
dependencies reuse SSR data without an initial RPC. Changed dependencies keep
that data while a new load runs. Failed refreshes retain the last good data and
allow retry. Invalidation drops it and the next read uses the declared initial
value. Unmount discards outstanding results and errors. It does not stop ignored
external I/O. Reading a destroyed component's resource fails before loading.

## Read after an uncertain mutation

Call `await this.reconcile$(failure, 'users')` in the mutation's catch handler.
The helper selects known uncertain RPC diagnostics and refreshes the declared resource.
It never retries the mutation.
Multiple target names, current dependency identity, and repeated calls share the same resource lifecycle.
The result distinguishes a completed read, failed recovery, obsolete ownership, and destruction.
A failed read keeps its own error separate from the original mutation failure.
Read the [complete recovery example and limits](./optimistic.md#handle-an-uncertain-result).

RPC tree reconstruction binds resource getters without starting incidental loaders.
The selected generated resource action still performs its read.
Ordinary SSR discovery and browser rendering keep their loading behavior.
This avoids a second read when a resource action reconstructs its own component tree.

## Where `server$` is allowed

The compiler accepts:

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

Request-scoped ORM models plus `config()`, `session()`, and `flash()` can be called inside a loader. Cossack does not add `this.orm`, `this.server$`, or broad helpers such as `session$` and `env$`.

## Queries, not mutations

Use `server$` for repeatable, read-only queries. Use `@Server()` methods for operations with effects:

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

See the runnable demo at [`packages/framework/src/pages/examples/server-functions`](https://github.com/cossackframework/cossack/tree/master/packages/framework/src/pages/examples/server-functions).
