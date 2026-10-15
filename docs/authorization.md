---
title: "Authorization"
description: "Protect routes and components with role and permission checks, driven by your own callbacks."
---

# Authorization (roles & permissions)

The `@cossackframework/auth` package provides an unopinionated authorization
layer on top of authentication. It has no built-in RBAC engine. It does not
know how your roles and permissions are stored. You supply callbacks that
answer yes or no. The package produces Hono middleware that gates access.

It works the same for session login and OAuth login. Both populate
`c.get('user')` through an upstream authentication middleware.

## `createAuthorizer()`

```ts
import { createAuthorizer } from '@cossackframework/auth';

export const guard = createAuthorizer<User>({
    hasRole: (user, role) => user.roles.includes(role),
    hasPermission: (user, permission) => user.permissions.includes(permission),
    onUnauthorized: (c, reason) =>
        c.redirect(reason === 'unauthenticated' ? '/login' : '/403'),
});
```

### Options

| Option | Description |
| --- | --- |
| `hasRole(user, role, c)` | Whether `user` holds `role`. Async allowed. |
| `hasPermission(user, permission, resource?, c)` | Whether `user` holds `permission`, optionally against a domain object. Async allowed. |
| `onUnauthorized(c, reason)` | Produce the failure response. `reason` is `'unauthenticated'` (no user on context) or `'forbidden'` (user present but lacks role/permission). Defaults: `401 JSON` / `403 JSON`. |

Both `hasRole` and `hasPermission` are optional. The matching
middleware factories deny access (`403`) when called without the callback
configured. This makes the failure mode obvious during development.

### Returned middleware factories

| Factory | Behavior |
| --- | --- |
| `guard.requireUser` | Allow any authenticated user. Deny all other users. |
| `guard.requireRole(...roles)` | Allow if the user holds any of the given roles (OR semantics). |
| `guard.requireAllRoles(...roles)` | Allow only if the user holds every role (AND semantics). |
| `guard.requirePermission(perm, resource?)` | Allow only if the user holds the permission, optionally against a `resource` object. |
| `guard.requireAllPermissions(...perms)` | Allow only if the user holds every permission (AND semantics). |

All factories are Hono `MiddlewareHandler`s, so they work wherever Hono
middleware works.

## Protecting pages

Page and enclosing layout guards run for page requests, HTTP RPC, file uploads,
SSE subscriptions, and WebSocket upgrades. Global authentication middleware runs
first.

RPC calls, uploads and WebSocket upgrades run the guards once, with the route
params of the page that the browser is on (`c.req.param()`), as a request for
that URL does. An action of a layout component or of a layout service runs
under that page: every layout guard and the page's own guards run. The params
are client input. The server checks them against the page's route (the same
param names and non-empty values) and answers 400 for other params before any
guard runs. A guard that decides on a param then decides as it does for a
request to that URL. SSE subscriptions run the guards again, with the params,
each time they revalidate the connection.

Transport guards receive the transport request (`/crpc`, `/upload`, `/sse`, or
`/ws`). Check resource access through `@Server({ authorize })` or an explicit
policy check inside the server method. Public state, method arguments, query
values, and scope names are client input. A connection guard does not authorize
permissions again on each WebSocket message. An action authorizer runs for each call.

Pass guards to `@Page({ middlewares })`:

```ts
import { Page, Cossack, Server } from '@cossackframework/core';
import { guard } from '../auth';

@Page({ middlewares: [guard.requireUser] })
export class Dashboard extends Cossack {}

@Page({ middlewares: [guard.requireRole('admin')] })
export class AdminPanel extends Cossack {}

@Page({ middlewares: [guard.requirePermission('posts.create')] })
export class NewPost extends Cossack {}

// Multiple guards compose (all must pass):
@Page({ middlewares: [guard.requireUser, guard.requireRole('editor')] })
export class EditorDashboard extends Cossack {}
```

## Typed resource policies

Use a resource policy when access depends on a particular record. The application
supplies its user/resource types, named actions, and record lookup. Authentication
middleware must populate `c.get('user')` from a trusted server source first.

```ts
import { createResourcePolicy } from '@cossackframework/auth';
import { input, Server, type InputOf } from '@cossackframework/core';
import { loadPost, updateOwnedPost } from './post-repository'; // Application-owned database operations.

interface User { id: string; tenantId: string; }
interface Post { id: number; ownerId: string; tenantId: string; title: string; }

const posts = createResourcePolicy<Post, User>()({
    read: ({ user, resource }) => user.tenantId === resource.tenantId,
    edit: ({ user, resource }) =>
        user.tenantId === resource.tenantId && user.id === resource.ownerId,
});
const editInput = input.object({
    id: input.number({ integer: true, min: 1 }),
    title: input.string({ required: true, maxLength: 200 }),
});
type EditInput = InputOf<typeof editInput>;

// Inside a Cossack component or service:
@Server({
    input: editInput,
    authorize: posts.action('edit', (data: EditInput, { context, signal }) =>
        loadPost(context, data.id, { signal })),
})
async edit(data: EditInput) {
    // Use an application transaction or conditional write that repeats the
    // trusted actor/tenant/ownership predicates if the record can change.
    return updateOwnedPost(this.c, data.id, data.title);
}
```

The action names retain their literal union. TypeScript rejects an unknown
action such as `posts.action('publish', ...)`, a lookup with the wrong resource
shape, or an authorizer whose input differs from the schema's parsed type.
`createTypedDecorators<T>().Server` preserves this type safety and channel typing.
Keep factory aliases static: a local factory result, a destructured `Server`
alias, or a directly selected `.Server` is recognized by the compiler.

The inbound action boundary parses input first, looks up the record from trusted
server context, evaluates the policy, then invokes the method. This applies to
HTTP/SSE component actions, multipart uploads, explicit/forwarded services and
socket actions. A forged payload owner, user, tenant or permission flag never
substitutes for the lookup or authenticated actor. Avoid changing state in lookup
and policy callbacks. Only boolean `true` grants access. Nonboolean decisions and
unexpected exceptions are internal errors.

| Helper | Result and use |
| --- | --- |
| `posts.can(c, 'edit', post, { signal })` | `Promise<boolean>` for one presentation decision. Missing user/record or unknown runtime action returns false. |
| `posts.permissions(c, post, { signal })` | Frozen named booleans such as `{ read: true, edit: false }`, suitable for public UI state. It does not serialize the user, record, callback or lookup. |
| `posts.authorize(c, 'edit', post, { signal })` | Returns the resource when allowed. Otherwise it throws a fixed authorization error. Use in reads, API handlers and native server calls. |
| `posts.action('edit', lookup)` | Callback for `@Server({ authorize })` over parsed input and the owned action signal. |
| `posts.middleware('edit', lookup)` | Hono middleware that checks a request-specific resource before the handler. |

For a server read loader or API handler, authorize access before you expose the record:

```ts
async init() {
    const post = await posts.authorize(
        this.c, 'read', await loadPost(this.c, this.postId),
    );
    this.title = post.title;
    this.permissions = await posts.permissions(this.c, post);
}
// render() uses this.permissions.edit to decide whether to show the edit control.
```

Native API methods and internal `this.edit(...)` calls execute authored code.
Decorator metadata does not wrap them. Explicitly authorize those paths. The
framework normalizes expected denials in API handlers, server reads and actions
to `COSSACK_AUTH_UNAUTHENTICATED` / `COSSACK_AUTH_FORBIDDEN`, fixed public messages,
and request IDs. HTTP uses 401/403. Socket callers receive correlated RPC errors.
A missing record is a forbidden decision for an authenticated actor. Unexpected
lookup/policy failures remain internal. Resource middleware returns the same
denial envelope and stops its handler.

Permission booleans only control presentation. Authorize each mutation again on the
server even if its button is hidden. Policy metadata, private callbacks and
module dependencies used solely by server methods are stripped from client
builds. Keep private policy contracts separate from exported/client-reachable
bindings and shared form rules. The compiler rejects private metadata that
retains local contracts or foreign module initializers on the client.

Callbacks and lookups receive an abort signal. Direct helpers default to the
request signal. Inbound action adapters use the framework's action signal.
Cancellation releases pending work and prevents a later mutation. It does not
stop ignored I/O and it does not roll back callback side effects. The policy kit does not
revalidate an existing socket session, provide transaction atomicity, or retry
mutations. Session freshness and revocation remain the job of the authentication layer.

## Conditional UI in `render()`

The `require*` factories are route-level middleware. They deny access with
an HTTP response. For conditional UI (show/hide a button, toggle a menu item),
use the boolean helpers on the same kit:

| Helper | Returns | Use when |
| --- | --- | --- |
| `guard.can(c, permission, resource?)` | `boolean` (sync) | `hasPermission` is sync (in-memory array). |
| `guard.hasRole(c, ...roles)` | `boolean` (sync, OR) | `hasRole` is sync. |
| `guard.canAsync(c, permission, resource?)` | `Promise<boolean>` | `hasPermission` is async (DB-backed). |
| `guard.hasRoleAsync(c, ...roles)` | `Promise<boolean>` | `hasRole` is async. |

All four read the user from `c.get('user')` and return `false` (never throw)
when there is no user. Unauthenticated visitors do not see the gated UI.

### Pattern 1: inline sync check (in-memory permissions)

When your `hasPermission` callback is synchronous (for example the user has a
`permissions: string[]` array), call `guard.can(this.c, ...)` directly inside
`render()`:

```ts
import { Page, Cossack } from '@cossackframework/core';
import { html } from 'lit';
import { guard } from '../auth';

@Page()
export class PostList extends Cossack {
    render() {
        return html`
            <ul>${this.posts.map(/* ... */)}</ul>
            ${guard.can(this.c, 'posts.create')
                ? html`<button @click=${this.createPost}>New Post</button>`
                : null}
        `;
    }
}
```

If `hasPermission` returns a Promise, `guard.can()` throws a clear error
instead of silently returning `false`. Use Pattern 2 instead.

### Pattern 2: async check via `init()` + `@State` (DB-backed permissions)

When `hasPermission` queries a database or external service, resolve the
result in `init()` (server-only) and store it in `@State`. The state syncs to
the client automatically and survives re-renders without re-querying:

```ts
import { Page, Cossack, State, Server } from '@cossackframework/core';
import { html } from 'lit';
import { guard } from '../auth';

@Page()
export class PostList extends Cossack {
    @State() canCreatePosts = false;
    @State() posts: Post[] = [];

    @Server()
    async init() {
        this.posts = await db.posts.findMany();
        // Async permission check — runs once on the server during SSR.
        this.canCreatePosts = await guard.canAsync(this.c, 'posts.create');
    }

    render() {
        return html`
            <ul>${this.posts.map(/* ... */)}</ul>
            ${this.canCreatePosts
                ? html`<button @click=${this.createPost}>New Post</button>`
                : null}
        `;
    }
}
```

Use this pattern for anything non-trivial. It keeps
`render()` synchronous, works identically on server and client, and avoids
repeated permission queries on every re-render.

### Pattern 3: a reusable `<Guard>` wrapper (userland)

For deeply nested conditional UI, a small wrapper component keeps templates
readable. The auth package cannot ship a renderer component (it does not depend
on `@cossackframework/core`), but you can define one in your app:

```ts
// src/components/Can.ts
import { Cossack, Component } from '@cossackframework/core';
import { html } from 'lit';
import { guard } from '../auth';

@Component()
export class Can extends Cossack {
    declare permission!: string;

    render() {
        return guard.can(this.c, this.permission)
            ? this.props.children
            : '';
    }
}
```

```ts
// Usage:
import './components/Can';

render() {
    return html`
        ${component(Can, { permission: 'posts.create' }, html`
            <button @click=${this.createPost}>New Post</button>
        `)}
    `;
}
```

Use the `init()` + `@State` pattern (Pattern 2) inside `<Can>` if your
permission check is async.

## Resource-aware permission checks

Pass a domain object as the third argument when the permission depends on
ownership or state. The object is forwarded as-is to your `hasPermission`
callback. Middleware factories are constructed at module load. For
request-specific resources like "the post being edited", resolve the resource
inside the callback using `c.req.param()` instead.

```ts
// Static resource hint (rarely useful in route middleware; more common when
// calling the guard imperatively):
guard.requirePermission('billing:read', { feature: 'invoicing' });

// Typical: derive the resource from the request inside hasPermission:
const guard = createAuthorizer<User>({
    hasPermission: async (user, permission, _resource, c) => {
        if (permission === 'posts:edit') {
            const postId = c.req.param('id');
            const post = await db.posts.findUnique({ where: { id: postId } });
            return post?.authorId === user.id;
        }
        return user.permissions.includes(permission);
    },
});
```

## Default failure responses

If you do not provide `onUnauthorized`, failures return:

- `401 { "error": "Authentication required" }` when no user is on the context.
- `403 { "error": "Forbidden" }` when the user is present but lacks the role/permission.

For browser flows, override to redirect:

```ts
onUnauthorized: (c, reason) =>
    c.redirect(reason === 'unauthenticated' ? '/login' : '/403'),
```

## Async checks

Both `hasRole` and `hasPermission` can be async. For example, they can query a database or
an external authorization service. The middleware `await`s the result.

```ts
const guard = createAuthorizer<User>({
    hasPermission: async (user, permission) => {
        const roles = await db.userRoles.findMany({ where: { userId: user.id }, include: { role: true } });
        return roles.some((r) => r.role.permissions.includes(permission));
    },
});
```

## How it composes with authentication

`createAuthorizer()` does not perform authentication. It only reads
`c.get('user')`. Mount an authentication middleware upstream (such as
`createAuth().middleware`) so that `user` is populated before the guard runs:

```ts
// src/bootstrap/middlewares.ts
import { auth } from '../auth';

export default [auth.middleware];
```

## What this is not

- It is not a full RBAC/ABAC engine (no policies, no Casbin-style rules). For complex
 authorization logic, encode it in your `hasPermission` callback.
- It is not tied to any ORM. The `User` type is your own.
- It is not a session store. Sessions are handled by `createAuth` or OAuth callbacks.
