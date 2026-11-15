# The sign-in pages and the dashboard are served from a package

Status: built 2026-11-15. Follows `specs/cms-served-app.md` ("Update 2") and
closes the first open item of `NOTES.md`. The user approved the recommendations there.

## Why

A project with `auth` or `dashboard` on the database ORM holds about 49 shell files
(sign-in pages, dashboard pages and kit, `auth.ts`, services). `cossack upgrade` must
merge each one, so these projects still record file hashes and stored texts. A CMS
project has neither, because the CMS package serves its shell. The same split for
ORM projects removes file records from every project.

## Decisions

- **The package is `@cossackframework/dashboard`** (`packages/dashboard`), built like
  the CMS package: `app/src` is the served root and also a development application
  (`pnpm dev:dashboard`). A project mounts it through `package.json#cossack.packages`.
- **The scaffold template stays the source of the shell.** `packages/dashboard/app`
  is written by `pnpm sync` from `packages/scaffold/template`, like the CMS's copy,
  and shipped with the package (`prepack`, `app/.npmignore`). One source feeds both
  packages. The scaffold lists the served paths (`src/dashboard-recipe.js`), and the
  package's test checks its shipped files and its host contract against that list.
- **Served:** `pages/auth/`, `pages/dashboard/`, `dashboard/`, `auth.ts`,
  `auth-*.ts`, `brand.ts`, `passkeys.client.ts`, `middlewares/auth.ts`,
  `services/{users,roles,rbac}.ts`, `lib/{permissions,uuid}.ts`, `config/auth.ts`.
- **The project keeps its schema:** `src/models/`, `src/migrations/`,
  `src/seeders/`, `src/orm/`, `src/middlewares/orm.ts`. Served code imports the
  models as `@/models/<Name>` (host contract), with `@/stores.client` and
  `@/dashboard.config`. A release that needs a new column lists the migration in
  `cossack.hostSteps`.
- **Recipe choices are values, not edited text.** `src/dashboard.config.ts` exports
  `dashboard: DashboardConfig`: `authMethods`, `oauth`, `modules`, `dashboard`
  (false for `auth` without the dashboard) and `redirectAfterLogin`. Served code
  reads them through its own `auth-options.ts`:
  - the login page shows the OAuth buttons and hides the password form without
    `credentials`;
  - `/auth/<provider>/redirect` and `/callback` are served routes, so `src/index.ts`
    has no OAuth block;
  - the sign-in guard answers 404 for a page whose method or module is off;
  - the dashboard's navigation lists the chosen modules.
- **RBAC is always installed with ORM auth**: the `Role` and `UserRole` models and
  their migrations. Removing the queries from `auth.ts` per recipe is gone.
- **The CMS keeps its copy of the shell** (`pnpm sync`), with its own
  `auth-options.ts` (fixed values). Sharing one served shell needs `@/` imports that
  resolve across packages; not in this change.
- **Every project records no files** once this is in: `recordsFiles()`, the
  manifest's `files`, the stored texts of scaffold files and the scaffold-file merge
  of `cossack upgrade` are removed. The recipe is in `package.json#cossack`.
  `.cossack/scaffold.json` and `.cossack/base/` remain for `cossack eject` copies and
  plugins only.

## Order

1. The shell reads `auth-options.ts`; OAuth routes become served pages; RBAC always.
2. `packages/dashboard`: package, recipe list, `sync.mjs`, development app.
3. The scaffold mounts the package for ORM `auth`, renders `dashboard.config.ts`
   and leaves the served paths out.
4. No project records files; remove the merge of scaffold files.
5. Docs, `NOTES.md`.

## Done when

- A new `auth`/`dashboard` project has no `src/pages/auth`, `src/pages/dashboard`,
  `src/dashboard`, `src/services` or `src/auth.ts`, and no `.cossack/`.
- The generated-app auth suites pass on both runtimes, with OAuth and without
  credentials.
- `cossack upgrade` on any project changes dependencies only.
