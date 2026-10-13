---
title: "Authentication"
description: "The auth package provides a minimal, flexible interface for handling authentication with any strategy while protecting routes."
---

# Authentication

The `@cossackframework/auth` package provides a small, flexible interface for handling authentication in your Cossack application. It works with Hono. You can implement any authentication strategy (Session/Cookie, JWT, OAuth, etc.). It gives you one standard way to protect your routes and components.

## Core Concepts

You provide an auth provider. The library returns an auth kit.

* Auth provider: a set of functions that define how to extract a session, validate it, and fetch the user.
* Auth kit: the object returned by `createAuth`. It exposes:
    * `middleware`: Hono middleware that runs on every request to populate `c.get('user')`.
    * `createLoginHandler(options)`: builds a credentials-based login route handler. This member is optional. See the `@Server` pattern below.
    * `createSession`: the reusable session creator, if you configured it on the provider. Any auth path can reuse it (login handler, OAuth callback, `@Server` methods).

> `createAuth()` returns a kit object. Access `createLoginHandler` and `createSession` as `auth.createLoginHandler(...)` and `auth.createSession(...)`.

> Run `cossack add auth` to generate a complete, working session-auth setup in your project. The setup includes PBKDF2 hashing, login/register/forgot-password/reset-password pages, a session middleware, a guard, and the `send_email` wiring for password resets.

The generated application uses the shared password, credential and session APIs.
Read [credential and session primitives](./auth-primitives.md) for typed storage
callbacks, atomic rotation, cookie policy and the password-format migration.

## Example: Email/Password with Cookie Sessions

This example shows a standard authentication flow:
1. Login: the user sends an email and a password. The system verifies them, creates a session in the database, and sets an HTTP-only cookie.
2. Request: the user makes a request. The system reads the cookie, looks up the session in the database, and attaches the user object to the context.

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

Create a file (for example `src/auth.ts`) to configure your authentication logic using `createAuth`.

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

`createApp()` auto-loads global middleware from `src/bootstrap/middlewares.ts` (a Laravel-style "kernel" list). Register `auth.middleware` there so it populates `c.get('user')` on every request. Do not pass it to `createApp`:

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

The generated login page keeps its draft in `ClientStore`. Client validation gives
feedback without copying passwords into shared page state or validation RPCs.
The server accepts one object with an input contract from `src/auth-input.ts`.
It parses the contract again for native calls, which bypass decorator gates.

```typescript
// src/pages/auth/login/index.ts
import { Cossack, Page, State, ClientStore, Client, Server } from '@cossackframework/core';
import { authSessions, loginUser } from '../../../auth';
import { loginInput, type LoginInput } from '../../../auth-input';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
    @ClientStore() form = { email: '', password: '' };
    @State() error = '';

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        this.error = '';
        try {
            await this.login({ email: this.form.email, password: this.form.password });
        } catch {
            this.error = 'Could not sign in. Check your details and try again.';
        }
    }

    @Server({ input: loginInput })
    async login(submitted: LoginInput) {
        const { email, password } = await loginInput.parse(submitted);
        this.error = '';
        try {
            const user = await loginUser(email, password);
            if (!user) { this.error = 'Invalid credentials'; return; }
            const { headers } = await authSessions.create(user.id, this.c);
            headers.forEach((value, key) => this.c.header(key, value));
            this.redirect(config('auth.redirectAfterLogin'));
        } catch {
            this.error = 'Could not sign in. Try again.';
        }
    }

    render() { /* bind the form controls to this.form */ }
}
```

The scaffold adds `Validate` with `runOn: 'client'` to the draft. Server schemas
reject missing, malformed and extra fields. Passwords need at least eight
characters and at most 1024 UTF-8 bytes. They are not normalized or truncated.
Keep custom credentials out of public state, old input and arbitrary flash data.
Explicit submission payloads carry credentials to the server. `ClientStore`
does not encrypt the network and does not hide values from browser scripts.

Login, register and reset failures show fixed messages and retain the browser
draft. The register page also recognizes the exact duplicate-account error.
The reset-request page shows the same confirmation for known and unknown emails.
Configure email delivery before you expect a reset email. An absent email binding
is a no-op. Reset tokens are carried in the link query and explicit action input,
not a public page field. Treat the reset URL as a credential.

### Generated session actions and partial failures

A dashboard with the sessions module has a Rotate current session action.
Rotation atomically replaces the bearer token while retaining its public
management reference. The page applies the replacement cookie and redirects to
`/dashboard/sessions`. The next request lists the new token as current. Two
rotations using the same token have one winner. An already-started request can
retain its resolved user. A new HTTP request validates the incoming token again.
Rotation affects every tab that shares the browser cookie. Authenticated SSE
tests the old token's server-only descriptor before each delivery, closes the
old subscription and requires a reload with the new cookie. WebSocket identity
refresh remains separate work. An already-validated frame can be in flight
when rotation finishes. Read the [SSE session contract](./sse.md#session-changes-on-an-open-subscription)
for provider setup, guard and idle behavior, and limits.

The dashboard layout guard also protects its logout RPC. Logout expires the
cookie and redirects only after storage revocation succeeds. Storage failures
keep the cookie and show fixed feedback. A lost response can leave a revoked
session cookie in the browser. The next request must sign in again.

These operations are not a transaction spanning account writes, sessions and
HTTP delivery. Registration can create an account before session creation fails.
The user can retry by signing in. A reset consumes its token before hashing,
updating the account and revoking sessions. Later failures can leave partial
writes and require a new reset link. A failed response does not establish that
nothing changed. Do not automatically repeat a mutation based on that assumption.

### Alternative: Login via a Hono Route

For a raw endpoint, for example for an API consumer, use `auth.createLoginHandler(...)` and mount it in `src/index.ts`:


The handler uses the provider's `createSession` when omitted. Pass a per-handler
`createSession` to override it. If neither is configured, the handler returns
a configuration error (HTTP 500).

The handler checks each request before it reads credentials. These checks stop
login CSRF, where another site signs the browser in to an attacker's account:

| Check | Failure |
| --- | --- |
| `Sec-Fetch-Site` is `same-origin`, `same-site`, `none` or absent | 403 |
| A present `Origin` equals the request origin (`https://` + host is also accepted when `X-Forwarded-Proto: https` is set) | 403 |
| `Content-Type` is `application/json` (parameters such as `charset` are allowed) | 415 |
| The body is valid JSON | 400 |
| The JSON body is an object | 400 |

A cross-site HTML form cannot send `application/json` without a CORS preflight.
Send credentials with `fetch()` and `Content-Type: application/json`. Clients on
another origin are rejected. Add your own route if you need cross-origin login.

```typescript
// src/auth.ts
export const loginHandler = auth.createLoginHandler({
    validateCredentials: async ({ email, password }, c) => { /* ... */ },
    // Uses the provider's createSession by default.
});

// src/index.ts
import { loginHandler } from './auth';
const app = createApp({ AppComponent: App, htmlTemplate: template });
app.post('/api/login', loginHandler);
export default { fetch: app.fetch };
```

Every request handled by your pages and components then has access to `this.user` if the user is logged in.

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

## Generated token boundaries

The auth recipe stores login sessions and password-reset tokens in one table.
It accepts only rows with `meta.type === 'auth'` for login, and only
`meta.type === 'password_reset'` for password reset. A reset consumes the token
once and revokes the user's existing sessions.
