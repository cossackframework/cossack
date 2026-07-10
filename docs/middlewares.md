---
title: "Middleware"
description: "Integration with Hono's middleware system for executing server-side logic before page rendering or action handling."
---

# Middleware

Cossack integrates directly with Hono's middleware system. Middleware functions are executed on the server before a page is rendered or a server action is handled.

There are two kinds of middleware in Cossack:

- **[Global request middleware](#global-request-middleware)** — runs on *every* request, sets up request-scoped context (database client, auth session, feature flags). Defined in `src/middlewares/*.ts` and registered in `src/bootstrap/middlewares.ts`.
- **[Route-level middleware](#colocated-middleware)** — runs for specific pages/layouts via `@Page({ middlewares })`. Used for per-route concerns like auth guards ("redirect to /login").

## Global request middleware

For middleware that must run on every request and set up context the rest of the app reads (`c.get('db')`, `c.get('user')`, etc.), use the **`src/bootstrap/middlewares.ts` registry**. `createApp()` auto-loads this file and registers each middleware with `app.use('*', ...)` in array order, before the locale middleware.

This is a Laravel-style "kernel" list: middleware *definitions* live in `src/middlewares/*.ts`, and `src/bootstrap/middlewares.ts` only holds the ordered references — so adding or removing a feature is a clean one-line edit (no surgery on your `createApp()` call).

```ts
// src/bootstrap/middlewares.ts
import type { MiddlewareHandler } from 'hono';
import { dbMiddleware } from '../middlewares/db';
import { sessionMiddleware } from '../middlewares/session';

const middlewares: MiddlewareHandler[] = [
  sessionMiddleware, // resolves c.get('user')
  dbMiddleware,      // exposes c.get('db') + the db() helper
];

export default middlewares;
```

```ts
// src/middlewares/logging.ts — a definition
import { defineServerMiddleware } from '@cossackframework/core';

export const loggingMiddleware = defineServerMiddleware(async (c, next) => {
  console.log(`[${c.req.method}] ${c.req.path}`);
  await next();
});
```

Feature commands add to the registry for you — for example `cossack add database` registers `dbMiddleware` (see [Database](/docs/database.md)). The locale middleware is framework-built-in and always runs (a no-op without `src/lang/`); it doesn't need an entry in this file.

> If `src/bootstrap/middlewares.ts` is absent, no global middlewares run — existing apps are unaffected.

## Colocated Middleware


For one-off middleware specific to a single page, define it inline in the page file:

```typescript
import type { MiddlewareHandler } from 'hono';
import { Cossack, Page } from '@cossackframework/core';

const myMiddleware: MiddlewareHandler = async (c, next) => {
    console.log(`Request to ${c.req.path}`);
    await next();
};

@Page({
    middlewares: [myMiddleware],
})
export default class MyPage extends Cossack {
    // ...
}
```

## Reusable Middleware

For middleware shared across multiple pages, create a separate file in `src/middlewares/`:

```typescript
// src/middlewares/logging.ts
import { defineServerMiddleware } from '@cossackframework/core';

export const loggingMiddleware = defineServerMiddleware(async (c, next) => {
    console.log(`[${c.req.method}] ${c.req.path}`);
    await next();
});
```

Then import it in your page:

```typescript
import { loggingMiddleware } from '@/middlewares/logging';

@Page({
    middlewares: [loggingMiddleware],
})
export default class Dashboard extends Cossack {
    // ...
}
```

## `defineServerMiddleware()`

Middlewares passed to `@Page` are only ever invoked by the Hono router on the server, so they never run in the browser. `defineServerMiddleware()` is a semantic wrapper that documents this intent — it makes it clear that the middleware is server-only:

```typescript
import { defineServerMiddleware } from '@cossackframework/core';

export const myMiddleware = defineServerMiddleware(async (c, next) => {
    const token = c.req.header('Authorization');
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    await next();
});
```

Without the helper, you would need to manually guard with `isServer`:

```typescript
import { isServer } from '@cossackframework/core';

export const myMiddleware: MiddlewareHandler = async (c, next) => {
    if (isServer) {
        // server-only logic
    }
    await next();
};
```

## Examples

### Logging Middleware

```typescript
import { defineServerMiddleware } from '@cossackframework/core';

export const loggingMiddleware = defineServerMiddleware(async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(`[${c.req.method}] ${c.req.path} - ${c.res.status} (${duration}ms)`);
});
```

### Auth Guard Middleware

```typescript
import { defineServerMiddleware } from '@cossackframework/core';

export const authGuard = defineServerMiddleware(async (c, next) => {
    const session = c.get('session');
    if (!session) {
        return c.redirect('/login');
    }
    await next();
});
```

## Middleware in Layouts

Layouts can also define middleware. When a page is nested within layouts, middleware from all parent layouts are applied first, in root-to-leaf order:

```
src/pages/
  layout.ts          ← middleware A
  dashboard/
    layout.ts        ← middleware B
    page.ts          ← middleware C
```

Execution order: A → B → C

This means root-level layout middleware runs first, allowing you to place global concerns (like auth or logging) at the top of the layout hierarchy.

See the [`@Page` options table](./page.md#options) for the full list of decorator configuration.
