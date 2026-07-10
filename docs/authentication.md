---
title: "Authentication"
description: "The auth package provides a minimal, flexible interface for handling authentication with any strategy while protecting routes."
---

# Authentication

The `@cossackframework/auth` package provides a minimal, flexible, and unopinionated interface for handling authentication in your Cossack application. It is designed to work seamlessly with Hono and allows you to implement any authentication strategy (Session/Cookie, JWT, OAuth, etc.) while providing a standardized way to protect your routes and components.

## Core Concepts

The library allows you to create an **Auth Kit** by providing an **Auth Provider**.

*   **Auth Provider**: A set of functions that define *how* to extract a session, validate it, and fetch the user.
*   **Auth Kit**: The object returned by `createAuth`, exposing:
    *   `middleware`: Hono middleware that runs on every request to populate `c.get('user')`.
    *   `createLoginHandler(options)`: builds a credentials-based login route handler (optional — see the `@Server` pattern below).
    *   `createSession`: the reusable session creator (if configured on the provider), reusable by any auth path (login handler, OAuth callback, `@Server` methods).

> **Note:** `createAuth()` returns a kit *object*; `createLoginHandler` and `createSession` are accessed as `auth.createLoginHandler(...)` / `auth.createSession(...)`, not as standalone imports.

> **Don't want to wire this by hand?** Run `cossack add auth` to generate a complete, working session-auth setup (PBKDF2 hashing, login/register/forgot-password/reset-password pages, a session middleware, a guard, and the `send_email` wiring for password resets) in your project.

## Example: Email/Password with Cookie Sessions

This example demonstrates a standard authentication flow:
1.  **Login**: User sends email/password. System verifies them, creates a session in the DB, and sets an HTTP-only cookie.
2.  **Request**: User makes a request. System reads the cookie, verifies the session in the DB, and attaches the User object to the context.

### 1. Define Your Types

First, define what your User and Session look like. These usually map to your database tables.

```typescript
// The shape exposed to your app via `this.user` / `c.get('user')`.
// Keep password hashes OUT of this type — store them only in the DB row.
export type User = {
    id: string;
    name: string;
    email: string;
};

export type Session = {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
};
```

### 2. Configure Authentication

Create a file (e.g., `src/auth.ts`) to configure your authentication logic using `createAuth`.

```typescript
import { createAuth } from '@cossackframework/auth';
import { getCookie, setCookie } from 'hono/cookie';
import { db } from './db'; // Your imaginary database client
import type { User } from './types';

export const auth = createAuth<User>({
    // 1. Extract the session ID (token) from the request
    extractSessionId: (c) => {
        return getCookie(c, 'session_token');
    },

    // 2. Validate the session ID against your database
    validateSessionId: async (sessionId, c) => {
        // Query your sessions table
        const session = await db.sessions.find({ token: sessionId });

        // Check if session exists and is not expired
        if (!session || session.expiresAt < new Date()) {
            return null;
        }

        // Return the User ID associated with the session
        return session.userId;
    },

    // 3. Fetch the full user object
    resolveUserById: async (userId, c) => {
        const user = await db.users.find({ id: userId });
        // Return the user object (or null if not found)
        return user || null;
    },

    // 4. Create a session (exposed on the kit as auth.createSession, reusable
    //    by login handlers, OAuth callbacks, and @Server methods alike).
    createSession: async (user, c) => {
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.sessions.create({ token, userId: user.id, expiresAt });
        const headers = new Headers();
        setCookie(c, 'session_token', token, {
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

### 3. Register the Session Middleware

`createApp()` auto-loads global middleware from `src/bootstrap/middlewares.ts` (a Laravel-style "kernel" list). Register `auth.middleware` there so it populates `c.get('user')` on every request — you do **not** pass it to `createApp`:

```typescript
// src/bootstrap/middlewares.ts
import type { MiddlewareHandler } from 'hono';
import { auth } from '../auth';

const middlewares: MiddlewareHandler[] = [
    auth.middleware, // populates c.get('user') / this.user
];

export default middlewares;
```

### 4. Login via a `@Server` Method (Recommended)

The cleanest login flow is a `@Server` method on the login page component. Inside a `@Server` method, `this.c` is the live Hono context, so calling `auth.createSession(user, this.c)` writes the `Set-Cookie` header onto the `/crpc` response, and `this.redirect(...)` navigates the browser:

```typescript
// src/pages/(auth)/login/index.ts
import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { auth } from '../../../auth';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
    @State() @Validate({ rules: { required: true, email: true } }) email = '';
    @State() @Validate({ rules: { required: true, minLength: 8 } }) password = '';
    @State() error = '';

    @Client()
    async handleSubmit(e: Event) {
        e.preventDefault();
        if (!(await this.validateAll())) { this.requestUpdate(); return; }
        await this.login(this.email, this.password);
    }

    @Server()
    async login(email: string, password: string) {
        // Look up the user and verify the password hash (use bcrypt/argon2
        // or PBKDF2 in production — `cossack add auth` generates this for you).
        const user = await verifyCredentials(this.c, email, password);
        if (!user) { this.error = 'Invalid credentials'; this.requestUpdate(); return; }
        // auth.createSession writes the session row and returns Set-Cookie headers;
        // copying them onto this.c puts the cookie on the /crpc response.
        const { headers } = await auth.createSession!(user, this.c);
        headers.forEach((value, key) => this.c.header(key, value));
        this.redirect('/dashboard');
    }

    render() { /* a form bound to this.email / this.password */ }
}
```

`verifyCredentials` is your own helper (the generated `src/auth.ts` from `cossack add auth` exports `loginUser`, which does the lookup + PBKDF2 verification against the `users` table).

### Alternative: Login via a Hono Route

If you prefer a raw endpoint (e.g. for an API consumer), use `auth.createLoginHandler(...)` and mount it in `src/index.ts`:

```typescript
// src/auth.ts
export const loginHandler = auth.createLoginHandler({
    validateCredentials: async ({ email, password }, c) => { /* ... */ },
    createSession: auth.createSession!, // reuse the provider's creator
});

// src/index.ts
import { loginHandler } from './auth';
const app = createApp({ AppComponent: App, htmlTemplate: template });
app.post('/api/login', loginHandler);
export default { fetch: app.fetch };
```

Now, any request handled by your pages and components will have access to `this.user` if the user is logged in.

## Using Authenticated User in Components

In your Cossack components, the authenticated user is automatically available on the instance.

```typescript
import { Cossack, Page, Server } from '@cossackframework/core';

@Page()
export class Dashboard extends Cossack {
    @Server()
    async init() {
        if (!this.user) {
            // Redirect unauthenticated users
            this.redirect('/login');
            return;
        }
        
        console.log(`Welcome back, ${this.user.name}`);
    }
}
```
