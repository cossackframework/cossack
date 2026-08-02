# Reactive server resources (`server$`)

Use `server$` for read-only server data consumed by `render()`. The compiler
extracts its loader into an internal server RPC method, removes the loader and
loader-only imports from the client, resolves it during SSR, and hydrates the
result.

## Choose the primitive

| Need | Use |
|---|---|
| Read-only query rendered by a component | `server$` |
| Mutation, redirect, session/flash write | `@Server()` |
| Broadcast or server-to-client action | `@Server()` |
| Code that runs on both sides | `@Shared()` |

Do not invent `this.server$`, `this.orm`, `session$`, or `env$`. Import
`server$` from core; use decorated models, `config()`, `session()`, and
`flash()` inside loaders.

## Named resource

Class fields require `{ initial }` and expose the value directly:

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

Choose an initial value safe for every render access. Preserve resolved falsy
values (`false`, `0`, `''`, `null`).

## Dependencies

Declare reactive inputs explicitly; values become loader arguments:

```typescript
@State()
userId = '42';

user = server$(
    (id) => getUser(id),
    {
        deps: () => [this.userId] as const,
        initial: null,
    },
);
```

Retain the last resolved value while changed dependencies load. Do not infer
dependencies from reads inside the loader.

## Inline value

Use a direct call in `render()` for a one-off value:

```typescript
render() {
    return html`<h1>${server$(() => config('app.name'))}</h1>`;
}
```

Inline calls may omit `initial`, returning `T | undefined`. Keep call order
stable because identity uses module, class, and render-call ordinal.

## Refresh and invalidate

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

- `refresh$` bypasses the resolved invocation and retains the previous value
  while fetching.
- `invalidate$` removes it; the next render fetches it again.
- After a client failure, retry only after dependency change, refresh, or
  invalidation.

## Compiler constraints

- Recognize only `server$` imported from `@cossackframework/core`; aliases work.
- Use it only as a class-field initializer or direct call in `render()`.
- Require `{ initial }` for class fields.
- Pass an inline arrow/function loader, not a function reference.
- Use transport-safe primitive, array, and plain non-circular object arguments
  and results.
- Keep loaders repeatable and read-only.

Inspect `packages/framework/src/pages/examples/server-functions/index.ts` for
a runnable example and `docs/server-functions.md` for the public guide.
