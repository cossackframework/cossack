# Authentication

Use `createAuth()` from `@cossackframework/auth`. **Do not hand-roll session/cookie logic or per-route auth checks** — the kit gives you middleware that populates `this.user` on every request.

## Quick start — `cossack add auth`

The fastest path is the CLI scaffold, which generates a complete working setup (PBKDF2 hashing, session login, register, forgot/reset-password, an auth guard, DB migrations, UI pages) and wires it for you:

```bash
cossack add auth                    # session/cookie auth + DB
cossack add auth --oauth github     # add social login
```

See the `/setup-auth` skill for the full walkthrough. The rest of this reference documents what the scaffold produces and how to build/customize it by hand.

## What `createAuth()` gives you

`createAuth<User>(provider)` from `@cossackframework/auth` returns an **auth kit**:

- **`middleware`** — Hono middleware that runs on every request, populating `c.get('user')` (surfaced as `this.user` in components).
- **`createSession`** — the session creator passed through from your provider (used to set the session cookie).
- **`createLoginHandler(options)`** — builds a raw login route handler, for the (less common) `/api/login` route pattern. **The `cossack add auth` scaffold does not use this** — it logs in via a `@Server()` method instead.

The provider you pass in defines the session lifecycle:

| Provider function | Job |
|---|---|
| `extractSessionId(c)` | Read the session ID from the request (e.g. a cookie). |
| `validateSessionId(sessionId, c)` | Return the user ID if the session is valid, else `null`. |
| `resolveUserById(userId, c)` | Return the full user object (the safe, public shape — no secrets), else `null`. |
| `createSession(user, c)` *(optional)* | Create a session row and return `{ headers }` carrying the Set-Cookie. |

## The scaffolded `src/auth.ts`

`cossack add auth` generates a module that wires `createAuth` against the `users` and `sessions` tables (via `c.get('db')` / Kysely). The shape (condensed):

```typescript
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createAuth } from '@cossackframework/auth';

const SESSION_COOKIE = 'session_id';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// PBKDF2 hashing via Web Crypto — no bcrypt dependency.
export async function hashPassword(password: string): Promise<string> { /* … */ }
export async function verifyPassword(password: string, stored: string): Promise<boolean> { /* … */ }

export const auth = createAuth<{ id: string; email: string; name: string }>({
    extractSessionId: (c) => getCookie(c, SESSION_COOKIE),
    validateSessionId: async (sessionId, c) => {
        const row = await db(c).selectFrom('sessions')
            .where('id', '=', sessionId)
            .where('expires_at', '>', new Date().toISOString())
            .select('user_id').executeTakeFirst();
        return row?.user_id ?? null;
    },
    resolveUserById: async (userId, c) => {
        const row = await db(c).selectFrom('users')
            .where('id', '=', userId)
            .select(['id', 'email', 'name']).executeTakeFirst();
        return row ? { id: row.id, email: row.email, name: row.name ?? '' } : null;
    },
    createSession: async (user, c) => { /* insert session row, set cookie, return { headers } */ },
});

// Credential helpers used by the page @Server methods:
export async function loginUser(c, email, password) { /* verify, return public user or null */ }
export async function registerUser(c, email, password, name?) { /* insert user, return public user */ }
export async function requestPasswordReset(c, email, resetBaseUrl) { /* email a 1-hour token */ }
export async function resetPassword(c, token, newPassword) { /* consume token, update hash */ }
```

Key facts about the scaffold:
- **PBKDF2 / Web Crypto** for hashing — no extra dependency. Swap for bcrypt/argon2 by replacing `hashPassword`/`verifyPassword`.
- **Login runs in a `@Server()` method** on the login page (calling `loginUser` + `auth.createSession`) — there is **no `/api/login` route** and no `createLoginHandler`.
- **Password reset reuses the `sessions` table** for tokens (1-hour TTL rows, deleted on consume), and sends email via the `EMAIL` (`send_email`) binding.
- **Types live in `src/models/User.ts` / `Session.ts`** via `declare module` augmentation — there is no `src/types.ts`. `User` is the safe public shape surfaced as `this.user`; `password_hash` is excluded.

## Wiring the middleware

> **There is no `createApp({ authMiddleware })` option.** Register `auth.middleware` in the middleware registry that `createApp()` auto-loads.

`cossack add auth` edits `src/bootstrap/middlewares.ts` for you:

```typescript
// src/bootstrap/middlewares.ts
import type { MiddlewareHandler } from 'hono';
import { dbMiddleware } from '../middlewares/db';
import { auth } from '../auth';
import { authGuard } from '../middlewares/auth';

const middlewares: MiddlewareHandler[] = [
    auth.middleware,   // populates c.get('user') / this.user on every request
    authGuard,         // redirects unauthenticated requests to /login (except public paths)
    dbMiddleware,
];
export default middlewares;
```

If wiring by hand, do the same — import `auth` from your `src/auth.ts` and add `auth.middleware` to the array.

## The auth guard

The scaffolded `src/middlewares/auth.ts` exports `authGuard` — a `defineServerMiddleware` that redirects unauthenticated requests to `/login`, skipping a `PUBLIC_PATHS` list (`/login`, `/register`, `/forgot-password`, `/reset-password`):

```typescript
import { defineServerMiddleware } from '@cossackframework/core';
import { auth } from '../auth';

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

export const authGuard = defineServerMiddleware(async (c, next) => {
    if (PUBLIC_PATHS.includes(c.req.path)) return next();
    if (!c.get('user')) return c.redirect('/login');
    await next();
});
```

Registered globally (above), it protects **every** route except the public auth pages. To customize which paths are public, edit `PUBLIC_PATHS`. To protect only specific subtrees instead, remove `authGuard` from `src/bootstrap/middlewares.ts` and apply it per layout/page via `@Page({ middlewares: [authGuard] })`.

## Use `this.user` in components

After setup, `this.user` is available on every component instance (typed as your `User` or `undefined`):

```typescript
@Page()
export class Dashboard extends Cossack {
    @Server()
    async init() {
        if (!this.user) { this.redirect('/login'); return; }
        // load data scoped to this.user.id
    }

    render() {
        return html`<p>Welcome, ${this.user?.name ?? 'guest'}</p>`;
    }
}
```

## The login page pattern (what the scaffold generates)

The generated login page uses `@Validate` + a `@Server()` method (not a raw API route):

```typescript
import { Cossack, Page, State, Validate, Client, Server } from '@cossackframework/core';
import { auth, loginUser } from '../../../auth';

@Page({ transport: 'http' })
export default class LoginPage extends Cossack {
    @State() @Validate({ rules: { required: true, email: true, message: 'Enter a valid email' } })
    email = '';
    @State() @Validate({ rules: { required: true, minLength: 8, message: 'Min 8 characters' } })
    password = '';
    @State() error = '';

    @Client()
    async handleSubmit(event: Event) {
        event.preventDefault();
        if (!await this.validateAll()) { this.requestUpdate(); return; }
        try { await this.login(this.email, this.password); }
        catch (e: any) { this.error = e?.message || 'Login failed'; this.requestUpdate(); }
    }

    @Server()
    async login(email: string, password: string) {
        const user = await loginUser(this.c, email, password);
        if (!user) { this.error = 'Invalid credentials'; this.requestUpdate(); return; }
        const { headers } = await auth.createSession(user, this.c);
        headers.forEach((v, k) => this.c.header(k, v));
        this.redirect('/dashboard');
    }
}
```

Register/reset/forgot/reset-password pages follow the same pattern (see `/setup-auth`).

## Building it by hand (no scaffold)

If you are not using `cossack add auth`, the minimal steps are:

1. `pnpm add @cossackframework/auth`.
2. Create `src/auth.ts` with a `createAuth<User>({ extractSessionId, validateSessionId, resolveUserById, createSession })` call (model it on the scaffolded version above).
3. Register `auth.middleware` in `src/bootstrap/middlewares.ts`.
4. Provide `this.user`'s type by augmenting the `User` interface: `declare module '@cossackframework/core' { interface User { id: string; … } }`.
5. Add an auth guard (the `authGuard` pattern above) and login/register pages.

The kit is unopinionated — the provider functions can implement any strategy: session/cookie (shown), JWT, OAuth, etc. You bring the validation logic; the framework provides the wiring.
