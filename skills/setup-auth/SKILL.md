---
name: setup-auth
description: Set up authentication in a Cossack application
disable-model-invocation: true
user-invocable: true
---

# Set Up Authentication in Cossack

Sign-in comes from `@cossackframework/dashboard`. The project does not get copies of the
sign-in pages: the package serves them, and the project keeps only its choices and its schema.

## Step 1: Add it with the CLI

```bash
cossack add auth                                   # email and password
cossack add auth --oauth github,google             # add OAuth providers
cossack add auth --auth-methods oauth --oauth github   # OAuth only
cossack add dashboard --features users,roles       # sign-in plus the dashboard
```

| Option | Behavior |
|---|---|
| `--auth-methods <list>` | `credentials`, `oauth`. Written to `authMethods` in `src/dashboard.config.ts`. |
| `--oauth <list>` | `github`, `google`, `gitlab`, `facebook`, `microsoft`. Written to `oauth` in `src/dashboard.config.ts`. |
| `--database <provider>` | ORM provider when `database` is added too (see `references/database.md`). |
| `--features <list>` | Only with `add dashboard`: `users`, `sessions`, `settings`, `roles`. |
| `--force`, `--dry-run`, `--yes` | Overwrite, preview, accept defaults. |

`auth` also adds `ui` and `database` when they are missing. `dashboard` needs `auth`.

## Step 2: Know what the project holds

| In the project | Purpose |
|---|---|
| `src/dashboard.config.ts` | `authMethods`, `oauth`, `modules` (or `dashboard: false` for sign-in only), `redirectAfterLogin`, `registration`, `navigation`, `tenants`. Type: `DashboardConfig`. |
| `src/models`, `src/migrations`, `src/seeders` | The account schema (users, sessions, roles, OAuth accounts, security, API tokens, tenants). Add your own models and migrations here. |
| `src/bootstrap/middlewares.ts` | Spreads `authMiddlewares` from `@cossackframework/dashboard/app/middlewares/auth`. |
| `package.json#cossack` | The recipe; it mounts the package. |

Served by the package (do not create these in `src/`): `/auth/login`, `/auth/register`,
`/auth/forgot-password`, `/auth/reset-password`, `/auth/setup`, `/auth/two-factor`,
`/auth/magic`, `/auth/verify`, the OAuth routes `/auth/[provider]/redirect` and
`/auth/[provider]/callback`, and `/dashboard/*`. The list is `SERVED_DASHBOARD_PATHS` in
`packages/scaffold/src/dashboard-recipe.js`. To change one of these files, eject it:
`cossack eject dashboard /auth/login` (see `references/project-upkeep.md`).

## Step 3: Configure

- **OAuth:** no routes to wire in `src/index.ts`. Set `<PROVIDER>_CLIENT_ID` and
  `<PROVIDER>_CLIENT_SECRET` for each provider. See `docs/oauth.md`.
- **Database:** on D1, fill the `database_id` in `wrangler.jsonc`
  (`pnpm exec wrangler d1 create <name>`), then run `pnpm run migrate`.
- **Email:** Cloudflare projects get a `send_email` binding named `EMAIL` for reset and
  verification mail. Set `MAIL_FROM` and `APP_URL`.
- **Redirects:** `redirectAfterLogin` in `src/dashboard.config.ts`, or the
  `AUTH_REDIRECT_AFTER_LOGIN` variable.

## Step 4: Use the user

`this.user` is the signed-in user on every component, or `undefined`:

```typescript
render() {
    return this.user
        ? html`<p>Welcome, ${this.user.name}</p>`
        : html`<a href="/auth/login">Sign in</a>`;
}
```

Guard your own pages with a layout or page middleware, or check `this.user` in a
`@Server()` method. Check ownership per record in every `@Server()` method: a session is not
a permission. See `references/auth.md`.

## Step 5: Verify

1. `pnpm typecheck` (or `cossack typecheck` in an application) passes.
2. `pnpm run migrate` ran cleanly.
3. `/auth/register` creates an account and sign-in lands on `redirectAfterLogin`.
4. A signed-out visit to `/dashboard` goes to `/auth/login`.

## Without the dashboard package

For hand-wired auth, use `createAuth()` from `@cossackframework/auth` and register
`auth.middleware` in `src/bootstrap/middlewares.ts`. See `references/auth.md` and
`docs/authentication.md`.

## Access policy

Read `cossack docs --package @cossackframework/auth --json` and the Core
`server-action-access-policy` guide (`cossack docs --package @cossackframework/core --json`).
Never accept a submitted `user` parameter or client state as authentication. Keep provider
secrets server-only.
