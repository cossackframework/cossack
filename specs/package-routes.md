# Package routes: pages and plugins served from an installed package

Status: built 2026-11-15. Part 1 of 4: this spec (framework), then
`specs/cms-served-app.md` (the CMS moves its app code here) and
`specs/upgrade-merges.md` (three-way merges, ejecting) and `specs/cms-updates.md`
(the Update button). Build in that order.

## Why

`cossack add cms` copies about 240 CMS files into the application (`src/cms/`,
`src/pages/dashboard/(cms)/`, `src/pages/(site)/`, `src/pages/api/cms/`, ...;
`packages/cms/app/cossack-recipe.json`). Every CMS release is then a file-by-file
merge, and a project that edits one page stops getting its fixes. The framework can
mount pages only from `<root>/src/pages` and `<root>/src/plugins/*/pages`, so the CMS
had no other way. This spec lets an installed package contribute pages, layouts,
API routes, plugins, config, global middlewares and realtime components. A file
the application keeps at the same place overrides the package's ("shadowing").

## What is true today (2026-11-15)

Paths are under `packages/`.

- **Discovery.** `framework/src/plugin-sources.ts` `scanPageSources` (75-109) scans
  `src/pages` (prefix `/src/pages/`) and each `src/plugins/<p>/pages`. `scanPagesDir`
  (`route-codegen.ts` 19-56) keys every file `/src/pages/<rel>` (line 39). Keys are the
  route identity everywhere: route ids (`route-ids.ts` `computeRouteIds` 455-485),
  layouts (`resolveLayoutPaths` 26-39), the client (`client/app.ts` 534-547, 917).
  The real location is a side map, `PageSources.sources` (58-67), and `plugins`
  maps a key to its owning plugin.
- **The virtual module globs.** `virtual:cossack-pages` (`vite-plugin.ts` 408-475)
  uses fixed globs `'/src/pages/**/*.ts'` and their `/src/plugins/*/pages/` twins,
  and `overlay()` derives the key and owner by `split('/')` indexes (434, 439).
  Vite 8 `import.meta.glob` skips `**/node_modules/**` unless `exhaustive: true`.
- **Conflicts.** The same key from two roots throws `COSSACK_PLUGIN_ROUTE_CONFLICT`,
  at scan time (`plugin-sources.ts` 86-90) and in `overlay()` (435-437). Different
  keys with the same URL go through `resolvePageRouteFiles` (`route-ids.ts` 213-243):
  fewer `(group)` segments win, a tie throws.
- **Owners.** A key with an owner is plugin-gated (`router.ts` 479-519,
  `pluginGate`), skipped by SSG (`ssg-renderer.ts` 103, `ssg-entry.ts` 105), and
  sees only its own plugin's layouts plus ownerless ones (`route-ids.ts` 28).
- **Bug: plugin pages get no modulepreloads.** `getModulePreloads`
  (`route-ids.ts` 408-447) looks the route key up in Vite's manifest, which is keyed
  by the real path (`src/plugins/<p>/pages/...`). Callers: `router.ts:893`,
  `ssg-renderer.ts:307`. Nothing maps through `sources`.
- **Server-code stripping skips `node_modules`.** `vite-security-plugin.ts`
  `shouldProcessFile` (109-130), `load` (162), `isProjectModule` (99-103), and the
  path regexes for page handler stubs (208-222), `src/config` (228-230) and
  `src/auth.ts` (242-245). Without the transform, `@Server` bodies and server
  imports reach the browser and automatic RPC methods are not registered
  (`injectServerMethodMetadata`, 314-317). A workspace link resolves to a real path
  without `node_modules`, so linked apps work and published installs would not:
  the two must behave the same. `server$` keys come from the root-relative path
  (`resourceModuleKey`, 502-511), which would contain a `.pnpm/<pkg>@<version>`
  segment.
- **Other `src`-only scans:** realtime components (`realtime-registry.ts` 66-76,
  166-168; ids in `vite-plugin.ts` 690-697), dev `__source` (604), capability checks
  (179-209, 304-348), config (`config-codegen.ts` 7-9, 24-34; `vite-plugin.ts`
  999-1017), translations (787-794), global middlewares (`virtual:cossack-middlewares`,
  887-920: `/src/bootstrap/middlewares.ts` and `/src/plugins/*/middlewares.ts`),
  plugins (`pluginRegistryModule`, `plugin-sources.ts` 136-196, name from
  `split('/')[3]` at 179; `plugin-isolation.ts` 81-138), the dev watcher regex
  (`vite-plugin.ts` 540), template checks (`cossack/src/template-check.js` 30, 44),
  `cossack routes` (`cossack/src/scan-routes.js` 10-29, 120-121), the Node adapter's
  dev reload (`node-adapter/src/vite.ts` 178).
- **Externals.** `cossackPages.config()` puts `@cossackframework/{framework,ui,solar-icons}`
  in `ssr.noExternal` (`vite-plugin.ts` 236-264); the SSG runner inlines the same
  three (`vite-ssg-plugin.ts` 288-293: "Node cannot strip types inside node_modules")
  and re-declares the `@` alias (296-301). Dependency pre-bundling lists come from
  the scaffold scanning rendered `src/**/*.ts` (`scaffold/src/index.js`
  `withClientDependencies` 94-111) into the `// @cossack:client-dependencies` and
  `// @cossack:server-dependencies` markers of `vite.config.ts`.
- **Generated types.** `.cossack/routes.ts` imports each API module as
  `typeof import('..' + source)` (`route-codegen.ts` 118), a path inside the root.
- **Tailwind** v4 does not scan `node_modules`; the template's `style.css` has one
  `@source "../node_modules/@cossackframework/ui/dist"`.
- **Path-prefix checks on keys** that must keep working: `ssg-renderer.ts` 102, 108,
  160; `cms/app/src/cms/sitemaps.ts:16`.

## Decisions

- **A package declares what it serves, in its `package.json`.** A `cossack` field:

  ```json
  "cossack": {
    "root": "app/src",
    "pages": ["pages/dashboard/(cms)/", "pages/(site)/", "pages/api/cms/", "..."],
    "plugins": ["plugins/default-theme/"],
    "config": ["config/cms.ts"],
    "middlewares": "cms/middleware.ts"
  }
  ```

  Paths are relative to `root`, and a trailing slash names a directory. The lists
  are explicit, not "everything under `root/pages`": the CMS's dev app renders the
  scaffold shell into the same folders (`packages/cms/app/scripts/sync.mjs`), and a
  workspace link must not mount those files. The application names the packages it
  mounts in its own `package.json`: `"cossack": { "packages": ["@cossackframework/cms"] }`.
  The list is explicit so installing a package never adds routes by itself. It is in
  `package.json`, not in `vite.config.ts`, because the CLI reads it too (`cossack routes`,
  template checks, `cossack lang add`) and must not evaluate the Vite configuration.
- **Package files take app keys.** A served file at `<root>/pages/<rel>` is keyed
  `/src/pages/<rel>`, like a plugin page. Route ids, layouts, boundaries and the
  client keep working on keys unchanged.
- **Origin, not owner.** `PageSources` gains `origins: Record<key, { kind: 'app' | 'package' | 'plugin'; name?: string; file: string }>`,
  where `file` is the absolute real path. Ownership (`plugins`) keeps its plugin
  meaning: a package page has no owner. So it is not plugin-gated, it gets the
  app's layouts, and SSG treats it like an app page. A plugin served by a package
  (`cossack.plugins`) is a plugin like any other, and its pages are owned by it.
- **The application overrides the package; nothing else does.** If the app and a
  package both have a key (page, layout, loading, config file, a plugin by name),
  the app's file wins and the package's is not bundled. The same applies when an
  app page and a package page differ in key but resolve to the same URL. A package
  against a plugin, or two packages, is still `COSSACK_PLUGIN_ROUTE_CONFLICT`. A
  plugin is shadowed as a whole by an app plugin of the same name (`src/plugins/<name>`),
  never file by file. Every override is reported once per dev start and per build
  (`[cossack] src/pages/(site)/search/index.ts overrides @cossackframework/cms`).
  `cossack eject` (specs/upgrade-merges.md) records overrides so upgrades can merge
  them; an override without a record is still allowed and stays a warning.
- **Explicit module maps, not globs.** `virtual:cossack-pages`, the plugin registry,
  config, middlewares and translations are generated from the scan as explicit
  `import()` (lazy) or `import * as` (eager) entries per file, keyed by route key.
  This removes the `node_modules` glob limit, the `split('/')` indexes and the
  shadowed file from the bundle in one move. The scan already runs in
  `configResolved`, `buildStart` and the dev watcher. The watcher also watches each
  mounted package's real directory when it lies outside `node_modules` (a workspace
  link). A published install does not change while the server runs.
- **The security transform covers served files.** `shouldProcessFile`, `load` and
  `isProjectModule` accept ids under a mounted package's real `root`. The page,
  config and auth stub regexes match on the route key or on `origins`, not on
  `src/`. `server$` and stub labels key on a stable id,
  `<package name>/<path under root>`, never on the `.pnpm` path. A test runs the
  same fixture package linked and packed and compares the client bundle.
- **Externals and pre-bundling follow the mount.** `cossackPages` adds each mounted
  package to `ssr.noExternal` and to the SSG runner's inline list. At config time it
  scans the served files' bare imports with the same filter the scaffold uses
  (`CLIENT_DEPENDENCY` and `SERVER_DEPENDENCY`, moved from `scaffold/src/index.js`
  into the framework and exported for the scaffold), and adds them to
  `optimizeDeps.include` for the client and SSR. The scaffold markers stay for
  the app's own files.
- **Everything else that scans `src` follows `origins`:** realtime components and
  their ids, dev `__source`, capability checks, template checks, `cossack routes`,
  the Node adapter's dev reload, and plugin isolation (a package plugin with only
  server code is isolated like a rendered one).
- **Module preloads use the real path.** `getModulePreloads` takes the manifest key
  from `origins[key].file`, relative to the Vite root, and falls back to the key.
  This also fixes plugin pages today. It ships first, on its own.
- **Generated route types use specifiers.** For a package file, `.cossack/routes.ts`
  writes `typeof import('<package>/<export path>')`. The package must export its
  served root (`"./app/*": "./app/src/*"`). TypeScript then type-checks served `.ts`
  files inside the application's program, with the app's `paths` and its generated
  `.cossack/config.d.ts`. That is intended: a package's served files are written
  against the host contract, not against the package's own app.
- **Tailwind.** The scaffold writes one `@source` per mounted package root into
  `style.css` (`@source "../node_modules/@cossackframework/cms/app/src"`). The
  framework does not edit CSS.
- **`#app/` is the served root** (2026-11-16). A served file names another served file
  two or more directories away as `#app/<path>` (`imports` in the package's
  `package.json`: `"#app/*": "./app/src/*.ts"`; the development application's own
  `package.json` has `"./src/*.ts"`). Node, Vite and TypeScript resolve it from the
  package.json nearest to the importing file, so a project configures nothing.
- **The `@` alias is the host contract.** Inside a served file, a relative or `#app/` import is
  package-internal, and `@/<path>` is a module the application provides. The
  template's alias (`'@': ./src` in `vite.config.ts`, `"@/*": ["./src/*"]` in
  `tsconfig.json`, and the SSG runner's copy) already resolves it, and it applies to
  `node_modules` files. A package lists the `@/` modules it needs in
  `cossack.host` (a list of paths), and the build fails with
  `COSSACK_PACKAGE_HOST_MISSING` when the app lacks one.
- **The host contract has a version.** Host modules are template files, so a
  package update can need a newer one than the project has. A package states the
  oldest template it works with (`cossack.hostTemplate: "0.10.0"`). Dev start and
  the build compare it with `templateVersion` in `.cossack/scaffold.json` and fail
  with `COSSACK_PACKAGE_HOST_OUTDATED` (`run cossack upgrade`) when the project is
  older. A project without a manifest is not checked. Raise `hostTemplate` in the
  same commit that changes what served code needs from a host module.
- **Compile settings do not depend on the nearest `tsconfig.json`.** Served files
  use decorators. An application's files get `experimentalDecorators` from the
  project's `tsconfig.json`; a linked package file would find the package's own
  and a packed one a different file or none. The framework applies the
  application's compile settings to every file under a mounted root. Step 4's
  linked-against-packed comparison covers this.

## Order

1. Module preloads through the real path; a test with a plugin page (also fixes today's bug).
2. `origins` in `PageSources`; explicit module maps for pages, layouts, loadings,
   handlers; app-over-package precedence and the override report; the watcher.
3. The `cossack` field, `package.json#cossack.packages`, keys for served pages; plugins,
   config, middlewares and translations from packages; the `cossack.host` and
   `cossack.hostTemplate` checks.
4. The security transform, stable `server$` ids, realtime ids, compile settings.
5. Externals, SSG inlining, pre-bundling from served imports (move the filters).
6. CLI: `cossack routes`, template checks, `.cossack/routes.ts` specifiers, and
   `cossack lang add`, which scans `src` for `__()` keys and must also scan served
   files.
7. Docs: `docs/routing.md` (package routes, overrides), `docs/cms/plugins.md`
   (plugins from packages), `docs/cossack-cli.md`.

## Done when

- A fixture package (`packages/framework/tests/fixtures/page-package`, with a page, a
  layout, an API route, a `@Server` method, a realtime component, a plugin and a
  config file) mounted in a fixture app:
  - serves its routes in dev and in a build, with the app's layouts;
  - has no `@Server` body or server-only import in the client bundle, linked and
    packed alike (byte-compare the stripped client modules);
  - preloads the page's and its layouts' chunks;
  - is overridden by an app file at the same key, which the bundle no longer
    contains, and the build prints the override;
  - is still a conflict against a plugin page of the same key.
- A plugin page has module preloads.
- `pnpm test:cms:packed` passes on both adapters once the CMS uses this
  (specs/cms-served-app.md).

## Not in this change

- Loading plugins from npm at runtime. Packages are mounted at build time.
- Partial overrides (one function of a page). Override means the whole file.
