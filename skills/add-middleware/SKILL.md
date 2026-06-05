---
name: add-middleware
description: Add server middleware to a Cossack page or layout
disable-model-invocation: true
user-invocable: true
---

# Add Middleware to a Cossack Application

You are adding server-side middleware to a Cossack Framework application. Middleware runs on the server before a page is rendered or a server action is handled.

## Step 1: Determine the Middleware Scope

Ask or infer:
1. Is this middleware specific to one page (colocated) or reusable across pages?
2. Should it apply to a single route, a layout section, or globally?

## Step 2: Create the Middleware

### Reusable Middleware (Recommended)

Create a file in `src/middlewares/`:

```typescript
// src/middlewares/logging.ts
import { defineServerMiddleware } from '@cossackframework/core';

export const loggingMiddleware = defineServerMiddleware(async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(`[${c.req.method}] ${c.req.path} - ${c.res.status} (${duration}ms)`);
});
```

**`defineServerMiddleware()`** is a semantic wrapper from `@cossackframework/core` that documents the middleware as server-only. It does not add runtime guards — middlewares passed to `@Page` are only ever invoked by the Hono router on the server.

### Colocated Middleware

For one-off middleware specific to a single page, define it inline:

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

## Step 3: Apply the Middleware

### On a Page

```typescript
import { loggingMiddleware } from '@/middlewares/logging';

@Page({
    middlewares: [loggingMiddleware],
})
export default class MyPage extends Cossack {
    // ...
}
```

### On a Layout (Applies to All Nested Pages)

```typescript
import { authGuard } from '@/middlewares/auth-guard';

@Page({
    transport: 'http',
    middlewares: [authGuard],
})
export default class ProtectedLayout extends Cossack {
    render() {
        return html`<div>${this.children}</div>`;
    }
}
```

## Step 4: Common Middleware Patterns

### Auth Guard

```typescript
// src/middlewares/auth-guard.ts
import { defineServerMiddleware } from '@cossackframework/core';

export const authGuard = defineServerMiddleware(async (c, next) => {
    const user = c.get('user');
    if (!user) {
        return c.redirect('/login');
    }
    await next();
});
```

### Logging

```typescript
// src/middlewares/logging.ts
import { defineServerMiddleware } from '@cossackframework/core';

export const loggingMiddleware = defineServerMiddleware(async (c, next) => {
    console.log(`[${c.req.method}] ${c.req.path}`);
    await next();
});
```

### Rate Limiting / Headers

```typescript
import { defineServerMiddleware } from '@cossackframework/core';

export const corsMiddleware = defineServerMiddleware(async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    await next();
});
```

## Step 5: Understand Middleware Execution Order

Middleware from layouts and pages stack in root-to-leaf order:

```
src/pages/layout.ts           ← middleware A
src/pages/dashboard/
    layout.ts                  ← middleware B
    settings/index.ts          ← middleware C
```

Execution order: **A → B → C → page handler**

This means root-level layout middleware runs first, allowing you to place global concerns (auth, logging, CORS) at the top of the layout hierarchy.

## Step 6: Access User in Components

After auth middleware sets `c.set('user', user)`, the user is available in all components:

```typescript
@Page()
export class Dashboard extends Cossack {
    @Server()
    async init() {
        if (!this.user) {
            this.redirect('/login');
            return;
        }
        console.log(`Welcome, ${this.user.name}`);
    }
}
```

## Step 7: Verify

1. Middleware file is in `src/middlewares/` (if reusable) or inline in the page
2. Uses `defineServerMiddleware()` from `@cossackframework/core` (recommended) or `MiddlewareHandler` from `hono`
3. Middleware is added to the `middlewares` array in `@Page()` or `@Component()`
4. Middleware calls `await next()` (unless intentionally short-circuiting with a response)
5. Run type checks: `pnpm tsc --noEmit`
