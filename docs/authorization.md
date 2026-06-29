---
title: "Authorization"
description: "Protect routes and components with role and permission checks, driven by your own callbacks."
---

# Authorization (roles & permissions)

The `@cossackframework/auth` package provides an **unopinionated** authorization
layer on top of authentication. It has no built-in RBAC engine and no knowledge
of how your roles/permissions are stored — you supply callbacks that answer
yes/no, and the package produces Hono middleware that gates access.

It works identically for session login and OAuth login, since both populate
`c.get('user')` via an upstream authentication middleware.

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

Both `hasRole` and `hasPermission` are optional — but the corresponding
middleware factories will deny access (`403`) when called without the callback
configured. This makes the failure mode obvious during development.

### Returned middleware factories

| Factory | Behavior |
| --- | --- |
| `guard.requireUser` | Allow any authenticated user; deny otherwise. |
| `guard.requireRole(...roles)` | Allow if the user holds **any** of the given roles (OR semantics). |
| `guard.requireAllRoles(...roles)` | Allow only if the user holds **every** role (AND semantics). |
| `guard.requirePermission(perm, resource?)` | Allow only if the user holds the permission, optionally against a `resource` object. |
| `guard.requireAllPermissions(...perms)` | Allow only if the user holds **every** permission (AND semantics). |

All factories are Hono `MiddlewareHandler`s, so they work wherever Hono
middleware works.

## Protecting pages

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

## Conditional UI in `render()`

The `require*` factories are **route-level** middleware — they deny access with
an HTTP response. For conditional UI (show/hide a button, toggle a menu item),
use the boolean helpers on the same kit:

| Helper | Returns | Use when |
| --- | --- | --- |
| `guard.can(c, permission, resource?)` | `boolean` (sync) | `hasPermission` is sync (in-memory array). |
| `guard.hasRole(c, ...roles)` | `boolean` (sync, OR) | `hasRole` is sync. |
| `guard.canAsync(c, permission, resource?)` | `Promise<boolean>` | `hasPermission` is async (DB-backed). |
| `guard.hasRoleAsync(c, ...roles)` | `Promise<boolean>` | `hasRole` is async. |

All four read the user from `c.get('user')` and return `false` (never throw)
when there is no user — unauthenticated visitors simply don't see the gated UI.

### Pattern 1: inline sync check (in-memory permissions)

When your `hasPermission` callback is synchronous (e.g. the user has a
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

If `hasPermission` returns a Promise, `guard.can()` **throws a clear error**
rather than silently returning `false` — use Pattern 2 instead.

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

This is the **recommended** pattern for anything non-trivial: it keeps
`render()` synchronous, works identically on server and client, and avoids
repeated permission queries on every re-render.

### Pattern 3: a reusable `<Guard>` wrapper (userland)

For deeply nested conditional UI, a small wrapper component keeps templates
readable. The auth package can't ship a renderer component (it doesn't depend
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
callback. (Note: middleware factories are constructed at module load, so for
request-specific resources like "the post being edited", resolve the resource
inside the callback using `c.req.param()` instead.)

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

If you don't provide `onUnauthorized`, failures return:

- `401 { "error": "Authentication required" }` when no user is on the context.
- `403 { "error": "Forbidden" }` when the user is present but lacks the role/permission.

For browser flows, override to redirect:

```ts
onUnauthorized: (c, reason) =>
    c.redirect(reason === 'unauthenticated' ? '/login' : '/403'),
```

## Async checks

Both `hasRole` and `hasPermission` may be async (e.g. they query a database or
an external authorization service). The middleware `await`s the result.

```ts
const guard = createAuthorizer<User>({
    hasPermission: async (user, permission) => {
        const roles = await db.userRoles.findMany({ where: { userId: user.id }, include: { role: true } });
        return roles.some((r) => r.role.permissions.includes(permission));
    },
});
```

## How it composes with authentication

`createAuthorizer()` does **not** perform authentication — it only reads
`c.get('user')`. Mount an authentication middleware upstream (such as
`createAuth().middleware`) so that `user` is populated before the guard runs:

```ts
import { Hono } from 'hono';
import { createApp } from '@cossackframework/framework';
import { auth, guard } from './auth';

const app = createApp({ authMiddleware: auth.middleware });
// authMiddleware runs on '*' before page middleware → guards see c.get('user').
```

## What this is not

- Not a full RBAC/ABAC engine (no policies, no Casbin-style rules). For complex
  authorization logic, encode it in your `hasPermission` callback.
- Not tied to any ORM. The `User` type is your own.
- Not a session store. Sessions are handled by `createAuth` or OAuth callbacks.
