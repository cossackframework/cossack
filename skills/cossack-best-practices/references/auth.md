# Authentication

Use `createAuth()` from `@cossackframework/auth`. **Do not hand-roll session/cookie logic or per-route auth checks** — the kit gives you middleware that populates `this.user` on every request.

## Quick start: `cossack add auth`

`cossack add auth` mounts `@cossackframework/dashboard`, which serves the sign-in pages
(`/auth/login`, `/auth/register`, password reset, two-step sign-in, magic links, OAuth
routes), its `createAuth()` module and its guards. The project keeps only:

- `src/dashboard.config.ts`: `authMethods`, `oauth`, `modules`, `registration`, `tenants`.
- `src/models`, `src/migrations`, `src/seeders`: the account schema.
- `...authMiddlewares` in `src/bootstrap/middlewares.ts`.

```bash
cossack add auth --auth-methods credentials,oauth --oauth github
```

Do not write `src/auth.ts` or login pages for a project with the dashboard package. To change a
served page, `cossack eject dashboard /auth/login`. See the `/setup-auth` skill and
`dashboard-cms.md`. The rest of this file covers `createAuth()` for hand-wired projects.

## What `createAuth()` gives you

`createAuth<User>(provider)` from `@cossackframework/auth` returns an **auth kit**:

- **`middleware`** — Hono middleware that runs on every request, populating `c.get('user')` (surfaced as `this.user` in components).
- **`createSession`** — the session creator passed through from your provider (used to set the session cookie).
- **`createLoginHandler(options)`** — builds a raw login route handler, for the (less common) `/api/login` route pattern. Prefer a `@Server()` login method.

The provider you pass in defines the session lifecycle:

| Provider function | Job |
|---|---|
| `extractSessionId(c)` | Read the session ID from the request (e.g. a cookie). |
| `validateSessionId(sessionId, c)` | Return the user ID if the session is valid, else `null`. |
| `resolveUserById(userId, c)` | Return the full user object (the safe, public shape — no secrets), else `null`. |
| `createSession(user, c)` *(optional)* | Create a session row and return `{ headers }` carrying the Set-Cookie. |

## Wiring it by hand

> **There is no `createApp({ authMiddleware })` option.** Register `auth.middleware` in the
> middleware registry that `createApp()` loads.

```typescript
// src/auth.ts
export const auth = createAuth<{ id: string; email: string; name: string }>({
    extractSessionId: (c) => getCookie(c, 'session_id'),
    validateSessionId: async (sessionId, c) => { /* return the user ID or null */ },
    resolveUserById: async (userId, c) => { /* return the public user or null */ },
    createSession: async (user, c) => { /* store the session, return { headers } with Set-Cookie */ },
});

// src/bootstrap/middlewares.ts
const middlewares: MiddlewareHandler[] = [ormRequestMiddleware, auth.middleware];
export default middlewares;
```

When `validateSessionId` or `resolveUserById` throws (the session store is down), the
middleware logs a warning and continues **as a guest** by default. For an application whose
pages are all behind sign-in, add `sessionFailure: 'fail'` to the provider: the request then
fails with status 500 and the `error` page, instead of a redirect to a sign-in page that
cannot work either.

Guard routes with `createAuthorizer()` from `@cossackframework/auth` or a
`defineServerMiddleware` that checks `c.get('user')`, applied per layout or page with
`@Page({ middlewares: [guard] })`.

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

## Login in a `@Server()` method

Log in from a `@Server()` method on the page: verify the password, then call
`auth.createSession(user, this.c)` and copy its headers onto `this.c`. Do not add an
`/api/login` route or call `fetch()`. See `docs/authentication.md`.

## Checklist without the dashboard package

Without the dashboard package, the minimal steps are:

1. `pnpm add @cossackframework/auth`.
2. Create `src/auth.ts` with a `createAuth<User>({ extractSessionId, validateSessionId, resolveUserById, createSession })` call (see above).
3. Register `auth.middleware` in `src/bootstrap/middlewares.ts`.
4. Provide `this.user`'s type by augmenting the `User` interface: `declare module '@cossackframework/core' { interface User { id: string; … } }`.
5. Add a guard and login/register pages.

The kit is unopinionated — the provider functions can implement any strategy: session/cookie (shown), JWT, OAuth, etc. You bring the validation logic; the framework provides the wiring.
