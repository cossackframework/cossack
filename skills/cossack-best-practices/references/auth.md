# Authentication

Use `createAuth()` from `@cossackframework/auth`. **Do not hand-roll session/cookie logic or per-route auth checks** — the auth kit gives you middleware that populates `this.user` on every request, plus a login handler helper.

## What the kit gives you

`createAuth<User>(provider)` returns:
- **`middleware`** — Hono middleware that runs on every request, populating `c.get('user')` (surfaced as `this.user` in components).
- **`createLoginHandler`** — builds a secure login route handler.

The provider you pass in defines three functions: *extract* the session ID, *validate* it, *resolve* the user.

## 1. Install

```bash
pnpm add @cossackframework/auth
```

## 2. Define types (`src/types.ts`)

```typescript
export type User = {
    id: string;
    name: string;
    email: string;
    password: string; // hashed in production
};

export type Session = {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
};
```

## 3. Configure auth (`src/auth.ts`)

```typescript
import { createAuth } from '@cossackframework/auth';
import { getCookie, setCookie } from 'hono/cookie';
import { db } from './db';
import type { User } from './types';

export const { middleware, createLoginHandler } = createAuth<User>({
    extractSessionId: (c) => getCookie(c, 'session_token'),

    validateSessionId: async (sessionId, c) => {
        const session = await db.sessions.find({ token: sessionId });
        if (!session || session.expiresAt < new Date()) return null;
        return session.userId;
    },

    resolveUserById: async (userId, c) => {
        const user = await db.users.find({ id: userId });
        return user || null;
    },
});

export const loginHandler = createLoginHandler({
    validateCredentials: async (credentials, c) => {
        const { email, password } = credentials;
        const user = await db.users.find({ email });
        // use bcrypt/argon2 in production
        if (user && user.password === password) return user;
        return null;
    },
    createSession: async (user, c) => {
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.sessions.create({ token, userId: user.id, expiresAt });

        const headers = new Headers();
        setCookie(headers as any, 'session_token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
            path: '/',
            expires: expiresAt,
        });
        return { headers };
    },
});
```

## 4. Integrate (`src/index.ts`)

```typescript
import { createApp } from './router';
import { middleware as authMiddleware, loginHandler } from './auth';

const app = createApp({ authMiddleware });
app.post('/api/login', loginHandler);

export default { fetch: app.fetch };
```

`createApp` accepts an `authMiddleware` option. When provided, it runs on every request and populates `c.get('user')`.

## 5. Use `this.user` in components

After setup, `this.user` is available on every component instance (typed as your `User` or `undefined`):

```typescript
@Page()
export class Dashboard extends Cossack {
    @Server()
    async init() {
        if (!this.user) {
            this.redirect('/login');
            return;
        }
        // load dashboard data scoped to this.user.id
    }

    render() {
        return html`<p>Welcome, ${this.user?.name ?? 'guest'}</p>`;
    }
}
```

## 6. Protect routes

### Option A — auth guard middleware (preferred for protected areas)

```typescript
// src/middlewares/auth-guard.ts
import { defineServerMiddleware } from '@cossackframework/core';

export const authGuard = defineServerMiddleware(async (c, next) => {
    if (!c.get('user')) return c.redirect('/login');
    await next();
});

// apply on a layout or page
@Page({ transport: 'http', middlewares: [authGuard] })
export default class DashboardLayout extends Cossack {
    render() { return html`<div>${this.children}</div>`; }
}
```

### Option B — check `this.user` in `init()`

```typescript
@Server()
async init() {
    if (!this.user) { this.redirect('/login'); return; }
    // ...
}
```

Use Option A for whole route trees (cleaner), Option B for single pages or conditional logic.

## Supported strategies

The kit is unopinionated — the three provider functions can implement any strategy: session/cookie (shown above), JWT, OAuth, etc. You bring the validation logic; the framework provides the wiring.
