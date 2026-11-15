# The dashboard application

The sign-in pages and the dashboard of `@cossackframework/dashboard`, as an application.

- **The served sources are here, tracked:** `src/pages/auth/`, `src/pages/dashboard/`,
  `src/dashboard/`, `src/auth.ts` and the modules beside it (the scaffold lists them as
  `SERVED_DASHBOARD_PATHS`). Edit them here. A project with `auth` or `dashboard` on the
  database ORM mounts them from the package (`package.json#cossack.packages`).
- **The CMS ships a copy of the shell** (the pages, the dashboard kit, the guard), with its
  own `auth.ts`, services and access rules. `pnpm --filter @cossackframework/cms sync`
  writes that copy from this folder; `pnpm pack` of the CMS does it first.
- **The rest of this folder is a development application** (`pnpm dev:dashboard`): entry
  files, models, migrations and seeders, written by `pnpm sync` from the scaffold and not
  tracked. A project has its own.
