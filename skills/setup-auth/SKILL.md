---
name: setup-auth
description: Set up authentication in a Cossack application
disable-model-invocation: true
user-invocable: true
---

# Set Up Authentication in Cossack

You are setting up authentication for a Cossack Framework application using `@cossackframework/auth`.

**Prefer the CLI scaffold.** `cossack add auth` generates a complete, working auth setup (PBKDF2 password hashing via Web Crypto, session-based login, register, forgot/reset-password pages, an auth guard, database migrations, and UI components) in one command. Only drop into the manual steps below to customize what the scaffold produced.

## Step 1: Scaffold with the CLI

```bash
cossack add auth
```

Options:

| Option | Behavior |
|---|---|
| `--path <route-group>` / `-p` | Route group for the auth pages (default `(auth)` — URL-prefix-stripped). E.g. `--path admin/auth` → pages under `/admin/login`. |
| `--oauth <providers>` | Comma-separated or repeated: `github, google, gitlab, facebook, microsoft`. Adds an `oauth` block to `src/auth.ts` and "Sign in with …" buttons to the login page. Bare `--oauth` prompts interactively. |
| `--database <provider>` | Select `d1`, `sqlite`, `turso`, `postgres`, `mysql`, or a Hyperdrive provider supported by the current runtime. |
| `--force` / `-f` | Overwrite existing files. |
| `--dry-run` | Print actions without writing. |

```bash
# common cases:
cossack add auth                          # default — session/cookie + DB
cossack add auth --oauth github,google    # add social login
```

## Step 2: Review what was generated

`cossack add auth` wires the full stack. If the database feature is absent it also adds `@cossackframework/database` (decorated Active Record models, migrations, seeders, and the runtime ORM factory), and it ensures `@cossackframework/ui` is present (the auth pages use its `Input`, `Button`, `Field`, `Alert`, `PasswordInput` components).

**Auth files:**

| File | Purpose |
|---|---|
| `src/auth.ts` | `createAuth()` config — session cookie (`session_id`, 7-day TTL), PBKDF2 hash/verify helpers, `loginUser` / `registerUser` / `requestPasswordReset` / `resetPassword` exports. (+ an `oauth` block if `--oauth`.) |
| `src/middlewares/auth.ts` | `authGuard` — redirects unauthenticated requests to `/login`, skipping the public paths (`/login`, `/register`, `/forgot-password`, `/reset-password`). |
| `src/models/Session.ts` | Decorated Active Record model for the `sessions` table. |
| `src/pages/(auth)/layout.ts` | Shared centered-card auth layout. |
| `src/pages/(auth)/login/index.ts` | Login page (validation + `@Server` login). |
| `src/pages/(auth)/register/index.ts` | Registration page (validation + `@Server` register). |
| `src/pages/(auth)/forgot-password/index.ts` | Forgot-password page (emails a 1-hour reset link). |
| `src/pages/(auth)/reset-password/index.ts` | Reset-password page (consumes the token). |

**Wiring edits (automatic):**
- `src/bootstrap/middlewares.ts` — registers `auth.middleware` (populates `c.get('user')`) **and** `authGuard`.
- `package.json` — adds `@cossackframework/auth` (+ `database`, `ui` if they were missing).
- `wrangler.jsonc` — adds a `send_email` binding (`EMAIL`) for password-reset emails (Cloudflare projects only).
- `src/models/User.ts` — decorated Active Record model (the `id`/`email`/`name` shape is surfaced as `this.user`; `passwordHash` remains private).

Key design points of the scaffold (different from rolling it by hand):
- **Password hashing uses PBKDF2 via Web Crypto** — no `bcrypt` dependency. `hashPassword` / `verifyPassword` are exported from `src/auth.ts`.
- **Login uses a `@Server()` method on the page** calling the generated `loginUser()` helper + `auth.createSession` — there is **no `/api/login` route** and **no `createLoginHandler`** in the scaffold.
- **No `src/types.ts`** — the decorated `User` and `Session` models own their database types.
- **Password reset reuses the `sessions` table** for tokens (1-hour TTL rows, deleted on consume).

## Step 3: Configure environment / bindings

- **Database (D1):** if `wrangler.jsonc` has a placeholder `<database_id>`, create the database and fill it in: `npx wrangler d1 create <name>`.
- **Email:** the `send_email` binding (`env.EMAIL.send({ to, from, subject, html, text })`) is used by password reset. Verify the `from` domain in the Cloudflare dashboard, and set `MAIL_FROM` if you want a custom sender. (On the Node adapter this is a polyfill you provide.)

## Step 4: Run migrations + seed

```bash
pnpm run migrate                # creates users, sessions, roles, oauth_accounts, and cache_items
cossack seeder run              # optional — edit src/seeders/application.seeder.ts first
```

## Step 5: Access the user in components

After setup, `this.user` (typed as `{ id, email, name }`) is available on every component instance, or `undefined` when unauthenticated:

```typescript
render() {
    return html`
        ${this.user
            ? html`<p>Welcome, ${this.user.name}</p>`
            : html`<a href="/login">Sign in</a>`}
    `;
}
```

## Step 6: Protect additional routes

The scaffolded `authGuard` (registered globally in `src/bootstrap/middlewares.ts`) already redirects unauthenticated users to `/login` for every path except the four public auth pages. So by default **everything except the auth pages is protected**. To customize:

- **Exclude more public paths** — edit the `PUBLIC_PATHS` array in `src/middlewares/auth.ts`.
- **Per-page check** — for conditional logic on a single page, check `this.user` in `init()`:

```typescript
@Server()
async init() {
    if (!this.user) { this.redirect('/login'); return; }
    // load data scoped to this.user.id
}
```

If you prefer route-level guards over the global one, remove `authGuard` from `src/bootstrap/middlewares.ts` and apply it per layout/page instead:

```typescript
import { authGuard } from '@/middlewares/auth';

@Page({ transport: 'http', middlewares: [authGuard] })
export default class DashboardLayout extends Cossack {
    render() { return html`<div>${this.children}</div>`; }
}
```

## Step 7: (Optional) Mount OAuth routes

If you ran `cossack add auth --oauth`, the `oauth` object and a `handleOAuthUser` helper are generated in `src/auth.ts`, but the routes are **not** mounted automatically. Add them to `src/index.ts`:

```typescript
import { oauth, handleOAuthUser } from './auth';

app.get('/auth/:provider/redirect', (c) => oauth.redirect(c.req.param('provider')));
app.get('/auth/:provider/callback', (c) =>
    oauth.callback(c.req.param('provider'), { onUser: handleOAuthUser }),
);
```

Set the provider env vars (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OAUTH_SECRET`, …). See `references/auth.md` and the OAuth docs for the full `handleOAuthUser` upsert/flow.

## Step 8: Customize the generated code

The scaffold is a starting point — edit the files freely:

- **Different fields on `User`** — add columns to a new migration, update the decorated `User` model, and adjust `publicUser()` in `src/auth.ts`.
- **Different hashing** — replace the PBKDF2 `hashPassword`/`verifyPassword` in `src/auth.ts` with bcrypt/argon2 (install the dep; both have edge-compatible builds).
- **Different session strategy** — the `createAuth<User>(provider)` call in `src/auth.ts` is the seam. The three provider functions (`extractSessionId`, `validateSessionId`, `resolveUserById`) plus `createSession` can implement JWT, OAuth-only, etc. See `references/auth.md`.

## Step 9: Verify

1. `pnpm tsc --noEmit` — no type errors.
2. `pnpm run migrate` ran cleanly.
3. `src/auth.ts` exports `auth` (and `loginUser` / `registerUser` / reset helpers).
4. `src/bootstrap/middlewares.ts` registers `auth.middleware` and `authGuard`.
5. Visit `/register` → create an account → redirected to `/dashboard`; `this.user` is populated.
6. Log out (clear the `session_id` cookie) → protected routes redirect to `/login`.

## Checklist

- [ ] `cossack add auth` ran (or files wired by hand per `references/auth.md`)
- [ ] `src/auth.ts` exports `auth` with session + PBKDF2 hashing
- [ ] `src/bootstrap/middlewares.ts` registers `auth.middleware` + `authGuard`
- [ ] `wrangler.jsonc` has the `send_email` binding (Cloudflare) or a Node polyfill
- [ ] `pnpm run migrate` created the `users` + `sessions` tables
- [ ] `/register` → `/dashboard` flow works; `this.user` populated
- [ ] Unauthenticated visit to a protected route redirects to `/login`
- [ ] `pnpm tsc --noEmit` passes
