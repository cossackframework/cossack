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
