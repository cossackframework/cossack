# The CMS app is served from the package

Status: planned 2026-11-15. Part 2 of 4. Needs `specs/package-routes.md` first;
`specs/upgrade-merges.md` covers upgrades and `specs/cms-updates.md` the dashboard's Update button. Builds on
`specs/cms-package-app.md`, whose "Not in this change" named this step.

## Why

A CMS project today holds about 240 copied CMS files: in gif84
(`~/Sites/gif84-cossack-cms`), 89 under `src/cms`, 135 under `src/pages` and 14 in
`src/plugins/default-theme`. Upgrades must merge each one, and an edited file
stops getting fixes. gif84 shows what really happens. Its 40 changed core files
and 6 new API routes were not customisation. They were features and fixes
(the theme context API, image caching, logo-only branding, menu loading,
management operations), written into the project and then copied back into
`packages/cms/app`. The project's own code is two plugins (`src/plugins/gif84`,
`src/plugins/gif84-telegram`), `content/` and `scripts/seed.mjs`.

The goal is the WordPress split. The CMS is replaced whole by a package update.
The repository holds the project's code: plugins and themes, the CMS
configuration, the per-runtime glue, and any file it chose to override.

## What is true today (2026-11-15)

- **Ownership list:** `packages/cms/app/cossack-recipe.json`.
  - `files` lists the CMS-only paths.
  - `replaces` lists 12 shell modules with RomeDB versions:
    - `src/brand.ts`
    - `src/auth.ts`
    - `src/passkeys.client.ts`
    - `src/services/{users,roles,rbac}.ts`
    - `src/lib/permissions.ts`
    - `src/dashboard/{access,icons,head,user-sections}.ts`
    - `src/pages/dashboard/index.ts`
  - `rendered` lists the adapter glue, `src/cms/{database,media,pending}.ts`. Its text is in `scaffold/src/cms-recipe.js` 45-283.
- **Rendering:**
  - `scaffold/src/cms-recipe.js` `cmsAppDir` (14) resolves `@cossackframework/cms/package.json` + `app`.
  - `cmsAppFiles` (29-43) returns `files` + `replaces`, expanded, minus `rendered`.
  - `renderRecipe` (`scaffold/src/index.js` 1888-1895) copies them over the template.
- **Wiring outside the copied files:**
  - Worker entry: `patchCmsWorkerEntry` (`cms-recipe.js` 289-308) imports `./cms/index`, `./cms/maintenance` and `./cms/middleware`, and exports `RomeDBPendingWrites`, `PluginBridge` and `PluginTail`.
  - Node entry: `patchCmsNodeEntry` (311-322).
  - Vite config: `patchCmsViteConfig` (329-343).
  - Middleware registry: `../cms/middleware` (`index.js` 512-516).
  - `style.css` imports `./cms/blocks.css` (1727-1734).
  - wrangler bindings (544-568), env values (1648-1690) and the `.gitignore` entry for `storage/` (1873-1876).
- **The composition root,** `app/src/cms/index.ts` (156 lines):
  - It imports the glue (`./database`, `./pending`, `./media`, lines 8-10) and the user's `./resources` (7: `resources`, and `modules = [contentModule, formsModule]`).
  - It hard-codes the `createCMS` options (86-107): Stripe, the Cloudflare purger, AI, mail and secrets. It never passes `reservedPaths`, `blocks` or `settings`.
  - It augments Hono's `ContextVariableMap` (32-49).
- **CMS code that imports app shell modules by relative path:**
  - `cms/ui.ts` 18-19: `../dashboard/tabs`, `../dashboard/page`.
  - Pages: `dashboard/list-table` (content list, forms, network sites and users), `dashboard/bulk`, `dashboard/time-ago` (media summary).
  - `api/auth/session.ts:3`: `auth-bot-check`.
  - `pages/dashboard/index.ts` 8-9: `dashboard/agent-icons`, `session-list`.
  - `dashboard/access.ts:8`: `./registry`. This file is generated per project from `dashboardModules` (`index.js` 1958-1968).
- **The other direction:** the shell imports the `replaces` modules by relative path. `pages/dashboard/layout.ts` 6-12 and `pages/auth/layout.ts` import `dashboard/access`, `head`, `icons`, `brand` and `auth`. In turn, the replaced modules import CMS core (`auth.ts` 19-21, `brand.ts` 4-5, ...).
- **Globals the CMS uses:** `config('app.name')` and `config('auth.redirectAfterLogout')` (`brand.ts:9`, `cms/guards.ts:16`, `(site)/layout.ts` 165 and 205, `services/rbac.ts:26`), and `__()`. They are typed by the app's `.cossack/config.d.ts`.
- **The page registry:** `virtual:cossack-pages` is read by `(site)/sitemap.xml` and `sitemaps/[file]` through `cms/sitemaps.ts` 16 and 29-38, which strips `/src/pages/`. Route keys stay `/src/pages/...` under `specs/package-routes.md`, so this keeps working.
- **Reserved slugs:** `packages/cms/src/server/host.ts:543` defaults to `api, auth, dashboard, feed, media, preview, search, author, indexnow, sitemaps`. The app's and the plugins' own top-level routes are not reserved.
- **Package shape:** `@cossackframework/cms` ships `src` and `app` as TypeScript (`main: src/index.ts`). Its `files` exclude `app/src/plugins/example`, and `app/.gitignore` keeps the rendered shell out of the tarball. There is no export into `app/`.
- **The docs invite edits to core:**
  - "Edit or copy" the default theme: `docs/cms/index.md:14`, `themes.md:14`, `cossack-cli.md` 465-467.
  - Add operations to `src/cms/manage.ts` and `mcp-tools.ts`: `docs/cms/api.md` 237-238.
  - `src/cms/collab/room.ts` is "of the application": `collaboration.md:96`.

## Decisions

- **Three kinds of file:**

  | Kind | Where | Paths |
  | --- | --- | --- |
  | Served | the package, mounted (`cossack` field) | today's recipe `files` and `replaces`, except the glue and `resources.ts` |
  | Rendered glue | the project, written by `cossack add cms`, owned by the scaffold manifest | `src/cms/{database,media,pending}.ts`; the facades below; entry, Vite, middleware, wrangler, env, style patches |
  | Project | the project, written once, then the project's | `src/cms.config.ts`; `src/plugins/<own>/`; `content/`; `src/lang/`; overrides from `cossack eject` |

- **The host contract.** Served code reaches the project only through `@/` imports
  (`specs/package-routes.md`), listed in `package.json` `cossack.host`:
  - the glue: `cms/database.ts`, `cms/media.ts`, `cms/pending.ts`;
  - the project's configuration: `cms.config.ts`;
  - the dashboard kit the template renders: `dashboard/{list-table,bulk,tabs,page,time-ago,session-list,agent-icons}.ts`;
  - the generated `dashboard/registry.ts`;
  - `auth-bot-check.ts`.

  Every other import in served code is relative and package-internal. The 13 or so
  imports listed above become `@/...`. In `packages/cms/app` the alias points at its
  own `src`, where the shell is rendered, so the dev app (`pnpm dev:cms`) runs
  unchanged and does not mount itself. A unit test reads every served file and
  fails on:
  - an `@/` import outside `cossack.host`;
  - a relative import that leaves the served set;
  - a served file that imports a glue path relatively.
- **The composition root stays in the package.** `cms/index.ts` imports
  `@/cms/database`, `@/cms/media`, `@/cms/pending` and `@/cms.config`. The project
  keeps no copy of it, so the core files that import `./index` relatively keep
  doing so. The Hono `ContextVariableMap` augmentation stays in it, and a project
  sees it once its program imports a served file.
- **`src/cms.config.ts` is the project's.** It holds what `resources.ts` held:
  `resources`, `modules`, and the `createCMS` options a project may set:
  `reservedPaths`, `blocks`, `settings`, and the payments, AI, purger and mail
  providers. `cms/index.ts` merges it over the current defaults, so a project that
  sets nothing behaves as today. `cossack add cms` writes it with the defaults
  commented. Upgrades merge it like any owned file.
- **Facades for the replaced modules.** The shell imports `../auth`,
  `dashboard/access`, `dashboard/head`, `dashboard/icons`, `brand`, `services/*`,
  `lib/permissions` and `passkeys.client` by relative path. Those paths stay as
  one-line rendered glue: `export * from '@cossackframework/cms/app/auth';`. A
  facade re-exports the served module itself, so the app and the package share one
  instance.
  - None of them has a default export today, so `export *` covers each module. A test fails if a served facade target gains one.
  - `src/pages/dashboard/index.ts` is a page, so it is served, and the scaffold stops rendering the template's version of it when the cms feature is on.
- **Package shape.**
  - `exports` gains `"./app/*": "./app/src/*.ts"`.
  - The `cossack` field lists `root: "app/src"`, `pages`, `plugins: ["plugins/default-theme/"]`, `config: ["config/cms.ts"]`, `middlewares`, `host` and `hostTemplate` (the oldest template whose dashboard kit and glue the served code works with; an older project fails the build with `run cossack upgrade`).
  - The tarball keeps excluding the rendered shell, the glue and the example plugin. The packed test asserts that the tarball has no `app/src/cms/{database,media,pending}.ts`.
- **The scaffold renders glue only.**
  - `cossack-recipe.json` becomes `served` (today's `files` and `replaces`, minus glue and `resources.ts`), `facades` (the `replaces` modules that are not pages) and `rendered` (glue). `cms-recipe.js` stops copying served files.
  - The entry patches and the middleware registry import `@cossackframework/cms/app/cms/{index,maintenance,middleware}`.
  - `style.css` gets `@import "@cossackframework/cms/app/cms/blocks.css"` and `@source "../node_modules/@cossackframework/cms/app/src"`.
  - The rendered `package.json` names the package: `"cossack": { "packages": ["@cossackframework/cms"] }`.
  - `withClientDependencies` no longer needs the CMS's imports: the framework adds them from the mount.
- **The default theme is a served plugin.** It is mounted from the package, not copied. A project changes it with a child theme (`"theme": { "extends": "default-theme" }`, `docs/cms/themes.md` 350-358), which keeps receiving the parent's fixes. Alternatively, it ejects the theme whole, as an app plugin of the same name shadowing the package's (`specs/package-routes.md`). The docs recommend the child theme.
- **Reserved slugs come from the routes.** At boot, `cms/index.ts` passes `reservedPaths` as the defaults, plus every static top-level segment in the page registry (app, package and plugin routes), plus `cms.config.ts`'s own. An entry slug cannot hide a page the project added.
- **Changes a project used to make in core files now go through extension points:**
  - Management operations become plugin commands (`docs/cms/plugins.md`). A plugin way to add REST and MCP operations is a follow-up if one is asked for.
  - The collaboration room stays core.
  - Every page can still be overridden, as a whole file, with `cossack eject`.

  The docs listed under "What is true today" are rewritten to match.

## Order

1. In source, with no behaviour change: the `@/` host imports, `cms.config.ts`
   instead of `resources.ts` (with the options merge), the host-contract test.
   `pnpm dev:cms` and every CMS suite pass.
2. Package: the `exports` and the `cossack` field; facades checked against the
   default exports.
3. Scaffold: the recipe split, the patches, `style.css`, Vite `packages`, the
   template's dashboard index skipped. `scaffold/tests/cms-recipe.test.js` asserts
   what a new project gets: glue, facades and `cms.config.ts`, and no served file.
4. Reserved slugs from the registry; a test where a project page `/pricing` blocks
   an entry slug `pricing`.
5. Docs: `docs/cms/index.md` (what the project holds, how it updates),
   `themes.md` (child theme first), `api.md`, `collaboration.md`, `cossack-cli.md`
   (`add cms`), and `packages/cms/app/README` for contributors.
6. Projects that hold a copied CMS are not migrated; gif84 is rebuilt as a new
   project (`specs/upgrade-merges.md`).

## Done when

- `cossack create --features cms` on both adapters gives a project with no served
  file in it. It runs, builds and deploys. `pnpm test:cms:packed`, the
  `generated-runtime-cms*.test.js` suites (which link the workspace package) and
  `recipe-tracked.test.ts` (updated for `served`, `facades` and `rendered`) pass.
- A CMS fix released as a package version reaches the project with `pnpm up` and no
  file changes.
- gif84 runs on the served CMS with only its glue, facades, `cms.config.ts`,
  plugins and content in `src/`, and keeps its Lighthouse score (97 on desktop at
  localhost:3085 before the change).

## Not in this change

- Moving the dashboard kit (`list-table`, `bulk`, `tabs`, ...) out of the template
  into a package. It stays template-owned and updates through `cossack upgrade`.
- Plugin-defined REST and MCP management operations.
- Splitting `src/auth.ts` and the services into a separate auth-store package.
