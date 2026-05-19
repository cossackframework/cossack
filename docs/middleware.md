# Middleware

Cossack integrates directly with Hono's middleware system. Middleware functions are executed on the server before a page is rendered or a server action is handled.

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

Middleware in Cossack runs on both server and client bundles (since the same component code is shipped to both). When middleware contains server-only logic — such as reading headers, checking cookies, or logging — you need to ensure it only executes on the server.

`defineServerMiddleware()` wraps a Hono middleware handler so it only runs on the server and is a no-op on the client:

```typescript
import { defineServerMiddleware } from '@cossackframework/core';

export const myMiddleware = defineServerMiddleware(async (c, next) => {
    // This only runs on the server
    const token = c.req.header('Authorization');
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    await next();
});
```

Without the helper, you would need to manually check `isServer`:

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
