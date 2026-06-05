---
name: setup-auth
description: Set up authentication in a Cossack application
disable-model-invocation: true
user-invocable: true
---

# Set Up Authentication in Cossack

You are setting up authentication for a Cossack Framework application using `@cossackframework/auth`.

## Step 1: Install the Auth Package

```bash
pnpm add @cossackframework/auth
```

If the package is already installed, skip this step.

## Step 2: Define Types

Create `src/types.ts` (or add to an existing types file):

```typescript
export type User = {
    id: string;
    name: string;
    email: string;
    password: string; // Hashed in production!
};

export type Session = {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
};
```

## Step 3: Create the Auth Configuration

Create `src/auth.ts`:

```typescript
import { createAuth } from '@cossackframework/auth';
import { getCookie, setCookie } from 'hono/cookie';
import type { User } from './types';

// Replace with your actual database client
const db = {
    sessions: { find: async (query: any) => null },
    users: { find: async (query: any) => null },
};

export const { middleware, createLoginHandler } = createAuth<User>({
    // 1. Extract session ID from the request (e.g., from a cookie)
    extractSessionId: (c) => {
        return getCookie(c, 'session_token');
    },

    // 2. Validate the session and return the user ID (or null)
    validateSessionId: async (sessionId, c) => {
        const session = await db.sessions.find({ token: sessionId });

        if (!session || session.expiresAt < new Date()) {
            return null;
        }

        return session.userId;
    },

    // 3. Resolve the full user object from the user ID
    resolveUserById: async (userId, c) => {
        const user = await db.users.find({ id: userId });
        return user || null;
    },
});

export const loginHandler = createLoginHandler({
    // Verify credentials
    validateCredentials: async (credentials, c) => {
        const { email, password } = credentials;
        const user = await db.users.find({ email });

        // Use bcrypt/argon2 in production!
        if (user && user.password === password) {
            return user;
        }
        return null;
    },

    // Create session and set cookie
    createSession: async (user, c) => {
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week

        await db.sessions.create({
            token,
            userId: user.id,
            expiresAt,
        });

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

## Step 4: Integrate with the App

Modify `src/index.ts` to attach auth middleware:

```typescript
// src/index.ts
import { createApp } from './router';
import { AppDurableObject } from './DurableObject';
import { middleware as authMiddleware, loginHandler } from './auth';

const app = createApp({
    authMiddleware,
});

// Add login endpoint
app.post('/api/login', loginHandler);

export { AppDurableObject };
export default {
    fetch: app.fetch,
};
```

**Note:** `createApp` accepts an `authMiddleware` option. When provided, it runs on every request and populates `c.get('user')`.

## Step 5: Create Auth Pages

Create a route group for auth-related pages:

```
src/pages/(auth)/
    layout.ts            ← Shared auth layout (centered card, etc.)
    login/index.ts       ← Login page
    register/index.ts    ← Registration page
```

### Login Page

```typescript
import { Cossack, Page, Client } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
    @Client()
    async handleLogin(event: Event) {
        event.preventDefault();
        const form = event.target as HTMLFormElement;
        const formData = new FormData(form);
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: formData.get('email'),
                password: formData.get('password'),
            }),
        });
        if (response.ok) {
            window.location.href = '/dashboard';
        }
    }

    render() {
        return html`
            <h3>Login</h3>
            <form @submit="${this.handleLogin}">
                <div>
                    <label>Email</label>
                    <input type="email" name="email" required />
                </div>
                <div>
                    <label>Password</label>
                    <input type="password" name="password" required />
                </div>
                <button type="submit">Sign In</button>
            </form>
        `;
    }
}
```

## Step 6: Protect Routes

### Option A: Auth Guard Middleware

Create `src/middlewares/auth-guard.ts`:

```typescript
import { defineServerMiddleware } from '@cossackframework/core';

export const authGuard = defineServerMiddleware(async (c, next) => {
    const user = c.get('user');
    if (!user) {
        return c.redirect('/login');
    }
    await next();
});
```

Apply to a layout or page:

```typescript
import { authGuard } from '@/middlewares/auth-guard';

@Page({
    transport: 'http',
    middlewares: [authGuard],
})
export default class DashboardLayout extends Cossack {
    render() {
        return html`<div>${this.children}</div>`;
    }
}
```

### Option B: Check in init()

```typescript
@Page()
export class Dashboard extends Cossack {
    @Server()
    async init() {
        if (!this.user) {
            this.redirect('/login');
            return;
        }
        // Load dashboard data
    }
}
```

## Step 7: Access User in Components

After setup, `this.user` is available in all components:

```typescript
render() {
    return html`
        <div>
            ${this.user
                ? html`<p>Welcome, ${this.user.name}</p>`
                : html`<a href="/login">Sign in</a>`}
        </div>
    `;
}
```

The user object has the shape: `{ id: string; [key: string]: any }` (as defined by your `User` type).

## Step 8: Verify

1. `@cossackframework/auth` is installed
2. `src/auth.ts` exports `middleware` and `loginHandler`
3. `src/index.ts` passes `authMiddleware` to `createApp()`
4. Protected routes use `authGuard` middleware or check `this.user` in `init()`
5. Run type checks: `pnpm tsc --noEmit`
