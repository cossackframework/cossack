# Dashboard, CMS and tenants

These features are served from packages. The project mounts them
(`package.json#cossack.packages`) and keeps only configuration and its own code. Do not
create files under `src/pages/auth/` or `src/dashboard/` for them.

## Dashboard (`@cossackframework/dashboard`)

```bash
cossack add dashboard                          # every module
cossack add dashboard --features users,roles   # users, sessions, settings, roles
```

`dashboard` needs `auth` and adds it. The project keeps `src/dashboard.config.ts`
(`DashboardConfig`):

| Key | What it sets |
|---|---|
| `authMethods`, `oauth` | Sign-in methods and OAuth providers. |
| `modules` | Dashboard modules. A page of a module not listed answers 404. |
| `dashboard: false` | Sign-in without a dashboard. |
| `redirectAfterLogin` | Where sign-in goes (`AUTH_REDIRECT_AFTER_LOGIN` overrides it). |
| `navigation` | The project's own screens in the dashboard menu. |
| `registration` | `open`, `verifyEmail`, `approve`, `defaultRole`. |
| `tenants` | Database per organization (below). |

`cossack add` and `cossack remove` keep this file in step with the recipe. The account schema
is in `src/models`, `src/migrations` and `src/seeders`.

## Tenants

`tenants: { enabled: true }` in `src/dashboard.config.ts` gives each organization its own
database, at `<slug>.<APP_URL host>` or its own domain. Accounts stay in the main database.
Your models need no change: a tenant's request runs in its database. Use `accounts()` and
`currentTenant()` from `@cossackframework/dashboard/app/tenants` to reach the main database.
See `docs/tenants.md`.

## CMS (`@cossackframework/cms`)

```bash
cossack add cms        # or: cossack create my-site --features cms
```

The CMS needs `ui`, `auth`, `dashboard` and `markdown`, stores its data in RomeDB, and
cannot be combined with `examples`. The project keeps `src/cms.config.ts` (exports `storage`,
`resources`, `modules`, `options`; `storage` comes from
`@cossackframework/cms/storage/cloudflare` or `@cossackframework/cms/storage/node`), the entry
files and `src/plugins/<name>/`. The first visit to `/auth/setup` creates the administrator.

Change CMS behaviour with a plugin, `src/cms.config.ts` or a child theme. Eject a page only
when those cannot do it.

`cossack cms <command>` manages a running site through its management API
(`cossack cms login --url …`, `entries`, `users`, `settings`, `sites`, `mcp`). Each site also
serves an MCP server. See `docs/cms/index.md`, `docs/cms/api.md`, `docs/cms/plugins.md`,
`docs/cms/themes.md`.
