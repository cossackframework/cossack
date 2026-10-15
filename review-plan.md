# Cossack review plan (2026-10-13)

Full read of all 12 packages on branch `fix-dev-errors` by twelve parallel reviewers, each covering one area and verifying claims against source. About 180 findings were reported. Every item in Phases 0 to 2 was confirmed by reading or executing the code; items marked *likely* were not executed.

## Baseline

| Check | Result |
|---|---|
| `pnpm typecheck` | pass, 10 packages, 11 s |
| `pnpm test:unit` | pass, 458 files, 6522 tests, 5 env-gated skips, 120 s |
| `pnpm audit --prod` | 0 vulnerabilities |
| Playwright e2e | 281 tests listed, runnable locally, not run |
| `pnpm outdated` | 35 outdated, `remark-sugar-high` deprecated |

Note: root `pnpm tsc --noEmit` is a no-op (`files: []`). Only `pnpm typecheck` checks anything. The CLI package has 65 of 123 test files that only run under `test:integration`.

## Phase 0: finish the current branch

Items found in the uncommitted diff. Do these before merging `fix-dev-errors`.

1. **SSG manifest path disagrees with the new `outDir` change.** `vite-plugin.ts:464` now writes `cossack-routes.json` to the client `outDir`, but `vite-ssg-plugin.ts:134` still reads `dist/client`. A custom `outDir` yields `COSSACK_SSG_MANIFEST_MISSING`. Default `cossackSsg` to `this.environment.config.build.outDir`.
2. **`remove desktop` leaves `nodeLinker: hoisted` behind.** `packages/scaffold/src/index.js:2087-2103` removes overrides and patches but not `nodeLinker`. Add the removal and assert it in `scaffold.test.js:1066-1087`.
3. **`source-map-js` added to renderer `dependencies`.** Only the new test imports it. Move to `devDependencies`.
4. **`packages/cossack/tests/e2e-workflow.test.js`** spawns `git` and `bash` and imports undeclared `yaml`. Rename to `*-integration.test.js` and add `yaml` to devDependencies.
5. **`load$` fix is correct** (all edge cases traced). Add tests for destroyed-while-waiting, `invalidate$`/`refresh$` during the wait, and server-side rejection.
6. **MultiSelect fix is correct.** Add a browser test with a parent that applies `onChange` in a `setTimeout`. Use `base` in the `add()` guard at `MultiSelect.ts:204` and in `candidates` so a just-added value disappears from the list immediately.
7. `node-adapter/src/vite.ts:38-42` duck-type guard should also check `environment.moduleGraph?.invalidateAll`.

## Phase 1: security and data exposure

Ship-blockers. Each is a confirmed path that leaks server code, data, or lets a caller act on another user's resources.

### Client bundle stripping (the security boundary)

| # | Finding | Where |
|---|---|---|
| 1.1 | **Class expressions, wrapped classes (`wrap(class …)`), and nested classes are never stripped.** `findClasses` only yields top-level declarations. Server method bodies ship verbatim. | `vite-security-plugin.ts:847-857` |
| 1.2 | **Inline arrow handlers in `render()` preserve undecorated methods on the client.** `@click=${() => this.remove(id)}` keeps `remove`'s body; `@click=${this.remove}` strips it. No diagnostic. | `vite-security-plugin.ts:1147,1324-1336` |
| 1.3 | **`generateStaticParams` stripping is bypassed by aliased or namespaced `@Page`.** Regex matches raw text; the rest of the file resolves aliases via AST. | `vite-security-plugin.ts:2129` |
| 1.4 | **Module-level `server$` is neither compiled nor rejected.** Loader body ships; runtime throws at module evaluation. | `vite-security-plugin.ts:354-458` |
| 1.5 | `#private` method with the same name as a public `@Client` method is preserved. | `vite-security-plugin.ts:1004,1283` |
| 1.6 | `generateStaticParams: identifier` leaves the referenced loader in the module. | `vite-security-plugin.ts:2129` |

Fix: walk the whole program for `ClassDeclaration|ClassExpression` and fail closed on unsupported positions. Do not descend into closures when computing the preserved set from `render()`. Reuse `decoratorCallee` and alias maps in `stripSsgGenerateStaticParams`. Add one test per row.

### Request handling

| # | Finding | Where |
|---|---|---|
| 1.7 | **Open redirect.** `//evil.com/index.html` yields `Location: //evil.com` when a root catch-all page exists. | `framework/src/assets.ts:36-70` |
| 1.8 | **Custom `htmlTemplate` string `.replace()` expands `$'`, `$&`, `$$` from user state.** Corrupts the document; reliable page-break DoS. Use function replacers. | `framework/src/root.ts:124-126`, `ssg-renderer.ts:318` |
| 1.9 | **`/crpc` and `/upload` have no body size limit.** `defineApi` enforces 1 MiB; RPC does not. | `transports/http.ts:13,45` |
| 1.10 | **Full `User` object serialized into hydration payload** for the page, each layout, and app state, and persisted to DO storage. Emit `{ id }` plus an opt-in projection. Add `Cache-Control: private, no-store` when a user is present. | `core/src/shared/cossack.ts:3052-3068`, `router.ts:633-652` |
| 1.11 | **Cloudflare WS proxy does not bind default-scope DO ids to the request URL.** Node path does. A logged-in user can attach to another URL's DO by id. | `transports/websocket.ts:43-44` |
| 1.12 | `back()` redirects to an unvalidated `Referer`. | `core/src/shared/cossack.ts:2993` |
| 1.13 | `@Server()` on private fields (`_runtime`, `_cossack_ws_context`, `_cossack_provider_name`) makes them RPC-callable per the allowlist; only a `typeof === 'function'` check blocks invocation. Use a separate stripping marker and add them to `RPC_BLOCKED_INTERNAL_METHODS`. | `cossack.ts:600-630`, `method-proxy.ts:625,646` |
| 1.14 | Singleton services with `@State` accept client-written state shared across requests on one isolate. Throw or warn at bootstrap. | `service-bootstrap.ts:177-239` |

### Auth

| # | Finding | Where |
|---|---|---|
| 1.15 | **Google `hostedDomain` is a UI hint; `hd` claim never verified.** Docs promise domain restriction. | `auth/src/oauth/providers/google.ts:44-60` |
| 1.16 | **Unverified emails returned as `OAuthUser.email`** (GitHub, GitLab fallback to `emails[0]`; Microsoft `preferred_username`; Google no `email_verified`). Account-linking takeover. | `github.ts:29`, `gitlab.ts:38`, `microsoft.ts:48`, `google.ts:56-60` |
| 1.17 | **`createLoginHandler` has no CSRF or content-type guard** and 500s on bad JSON. Login CSRF via `text/plain` form. | `auth/src/session.ts:134-158` |
| 1.18 | **Stateless OAuth mode drops CSRF `state` with no hook to add it.** Add `createState`/`verifyState` callbacks or remove the mode. | `auth/src/oauth/handler.ts:93,144-161` |
| 1.19 | User enumeration via timing: miss returns before PBKDF2. Verify against a dummy hash. | `auth/src/credentials.ts:28-30` |

### Platform features and database

| # | Finding | Where |
|---|---|---|
| 1.20 | **Workflow identity `scope` is caller-controlled and never bound to `id`.** `authorize` receives an unverified `tenantId`. Recompute the digest or pass only `{ id, namespace, name, version }`. | `core/src/workflows/runtime.ts:32-38,63` |
| 1.21 | **Legacy `storage/s3.ts` + `pages/r2-upload` demo return a presigned PUT for any client-chosen key with no auth.** Dead relative to the new provider. Delete and rewrite the demo on `Storage`. | `framework/src/storage/s3.ts`, `pages/r2-upload/index.ts:22-26` |
| 1.22 | **Functional `RateLimit()` keys budgets by concrete path, not route template.** Enumerating ids is unlimited. Use `c.req.routePath`. | `core/src/shared/rate-limit.ts:803` |
| 1.23 | **`@Column({ select: false })` is inert.** `passwordHash` hydrates on every `find`. `insert:false`/`update:false` bypassed by static `update()`. | `database/src/query/builder.ts:114-116,299-304` |
| 1.24 | Session cookie never `Secure` behind a TLS-terminating proxy on Node; cookie `maxAge` never refreshed. | `framework/src/session.ts:141-147` |
| 1.25 | WebSocket servers accept 100 MiB frames (no `maxPayload`). | `node-adapter/src/index.ts:96`, `adapter.ts:40` |

### Release and CI

| # | Finding | Where |
|---|---|---|
| 1.26 | **`cpina/github-action-push-to-another-repository@main` receives `SKILLS_REPO_TOKEN`.** Pin to SHA or replace with `git`. | `.github/workflows/sync-skills.yml:20-22` |
| 1.27 | **Publish is not idempotent.** Eleven sequential steps; a mid-run failure cannot be retried. Use `pnpm -r publish`. No tag/version/branch assertion. | `.github/workflows/publish.yml:3-16,63-100` |
| 1.28 | Publish ships `node-adapter`, `auth`, `desktop` without running their tests. Desktop tests never run in any CI job. | `publish.yml:45-55`, `e2e-tests.yml:99,105` |

## Phase 2: correctness bugs

Confirmed breakage from ordinary usage. Grouped by package, highest impact first.

### Renderer

- **Plain object, Promise, or `live()` in node position recurses until stack overflow.** `cossack-html.ts:1658-1667`. A forgotten `await` crashes the page.
- **camelCase property bindings silently no-op on the client.** `template.innerHTML` lowercases `.innerHTML` to `.innerhtml`. SSR emits bogus attributes. `cossack-html.ts:2466-2479`. Record original-cased names at compile.
- **Bindings in `<textarea>`, `<title>`, `<script>`, `<style>` emit hydration markers as visible text and never bind.** `cossack-html.ts:687-697,2450`.
- **Sibling components get duplicate `_id` after conditional insertion.** Counter resets each render but only advances on creation. Core restores one child's SSR state into another. `cossack-html.ts:1161,1328`; `core/cossack.ts:790-819`. Consume registry entries once and advance the counter for retained children.
- **SSR `component()` calls `connectedCallback` but never `disconnectedCallback`.** Controllers leak intervals per request on Node. `cossack-html.ts:181-196`.
- **`repeat()` with duplicate keys leaks DOM every render.** `cossack-html.ts:1360-1364`.
- **`@event` attribute part and `...=${{'@event'}}` spread on the same element conflict and accumulate listeners.** This is the documented `component(Button, {'@click'})` pattern. `cossack-html.ts:1776-1807,2130-2165`.
- Multi-expression attributes stringify `null`/`false` on the client, `''` on SSR. `:2118`.
- Spread part ignores `null`/`undefined` (stale attributes). `:1740`.
- `<` in text content flips the tag tracker; following `x=${v}` becomes an attribute. `:390,2432`.
- Bindings inside HTML comments break out in hydrate mode. `:687-697`.
- `styleMap` does not dash-case keys. `directives.ts:111-116`.

### Core client

- **State write during a render pass is silently dropped** (`updated()`, controller `hostUpdated`, nested child `onMount` calling a parent callback). `cossack-element.ts:171-181`, `cossack.ts:2720-2814`. Track an updating flag and chain a re-run.
- **`@On(event)` on nested components attaches to `document`.** `container` is only set in `bootstrap()`. N list items yield N document listeners. `cossack.ts:1989`.
- `@Store` setter stores the proxy when the proxy is assigned back (`this.form = Object.assign(this.form, patch)`). `cossack.ts:2242-2267`.
- WS proxy filters DOM/Event args, shifting positional parameters; HTTP path nulls them. `method-proxy.ts:451`.
- Render guards read `globalThis.process?.env?.NODE_ENV`, undefined in browsers, so they **throw in production** instead of warning. `cossack.ts:578-595`, `server-fn.ts:41-44`. Use `import.meta.env.PROD`.
- `startViewTransition(cb, types)` ignores `supportsViewTransitionTypes()`; callback never runs on Chrome < 125 / Safari 18. `cossack.ts:3014-3038`.
- Link interception routes `mailto:`, `tel:`, `javascript:` through the SPA router. `navigation.ts:208-216`.
- HTTP/SSE proxies freeze `scopeKey`/`pageParams` at creation; persistent layouts send stale params after navigation (SSE 403s). `method-proxy.ts:218`.
- `@Debounce` timers survive `destroy()`. `cossack.ts:135-141`.
- Nested components' `server$` results are not hydrated (double fetch). *Likely.* `cossack.ts:2135`.

### Core server

- **`_scheduleStateBroadcast` microtask has no `try/finally`.** One throw permanently disables broadcasts for that component; `persistState()` is unobserved. `cossack.ts:2417-2444`.
- **Socket state broadcasts run full middleware per frame per client; >32 pending frames disconnects the client.** Coalesce state frames, authorize per batch (SSE already does). `socket-delivery.ts:40-73`, `runtimes/durable-object.ts:85-91`.
- Socket action failures log `COSSACK_RPC_INTERNAL_ERROR` for every error type, never the real exception. `cossack.ts:1719`.
- DO restoration goes through reactive setters, triggering a redundant persist. `CossackDurableObject.ts:85`.

### Framework runtime

- **WS proxy sets `X-User-Data` to `JSON.stringify(user)`; throws `ByteString` for any non-Latin-1 user field.** Users with non-ASCII names cannot connect. `transports/websocket.ts:60`. Forward only `X-User-ID`.
- Flash middleware tests `path === '/sse'` but endpoint is `/sse/:id`; SSE reconnects consume flash messages. Test encodes the bug. `middlewares/flash.ts:149`.
- Node SSE store retains a **destroyed** page instance after SSR. `router.ts:596,716`.
- SSE Node cold-start builds the page without layout service scopes. `transports/sse.ts:375-381`.
- Default DO identity is the full URL including query string. `router.ts:487`.
- `head()` `<script>`/`<style>` children are HTML-escaped (`&&` becomes `&amp;&amp;`). `root.ts:58`.
- SSR/onError returns JSON 401/403 to browser navigations. `router.ts:355-362`.
- Sitemap exclusion uses substring matching (`/error` drops `/error-codes`). `sitemap-generator.ts:35-41`.
- Class-based HTTP handlers picked with `in` (walks prototype chain) and instantiated outside DI. `router.ts:1375`, `api-handler.ts:60-63`.

### Database

- **Reassigning an owning relation on an existing entity is not persisted by `save()`.** Change detection runs before `syncRelationColumns`. `orm.ts:329-355`.
- **SQLite driver cannot run concurrent transactions.** Second overlapping `orm.transaction()` fails; interleaved `ROLLBACK` discards another caller's writes. `runtime/node.ts:66-76`. Serialize with a mutex.
- **MySQL introspection is lossy; `schema check` can never pass.** No length/precision, no indexes, includes `_cossack_migrations`. `schema/introspection.ts:345-393`.
- `upsert()` with all columns in the conflict set emits `DO UPDATE SET` (empty). `builder.ts:350-358`.
- `insert({})` emits `INSERT INTO t () VALUES ()`. `builder.ts:306-327`.
- SQLite drift false positives: any `INTEGER PRIMARY KEY` reads as `increment`; explicit unique indexes read as column `unique`. `introspection.ts:126-131`.
- Postgres: `CURRENT_TIMESTAMP` vs `now()` never normalized; the ORM's own enum `CHECK` constraint makes introspection **throw**. `introspection.ts:43-52,237,283-295`.
- Datetime codec is dialect-blind; DB-default timestamps decode as local time (7 h off in `Asia/Bangkok`). `codec.ts:8-37`.
- Many-to-many sync chunks by rows not parameters; exceeds D1's limit **after** the DELETE ran. `orm.ts:596-619`.
- `@AfterLoad` hooks are fire-and-forget; async throw becomes unhandled rejection. `orm.ts:285`.
- Nested JSON mutations are not dirty-tracked. `orm.ts:732-738`.
- Hyperdrive drivers open and close a client per query. `runtime/cloudflare.ts:128-144,196-215`.
- `find({ where: { x: undefined } })` compiles to `x = NULL`; `delete({})` deletes everything.

### UI

- **ToggleGroup `multiple` has the MultiSelect stale-props bug verbatim.** `ToggleGroup.ts:582-590`.
- Same class in Tabs, Combobox, DatePicker, Calendar, InputOTP, Toggle, Accordion, Collapsible, Sidebar. Extract one shared controlled-value helper.
- SettingsPanel controlled text rows revert every keystroke (caret jumps). `blocks/SettingsPanel/index.ts:497-504`.
- `.checked` without `live()` in Checkbox, Switch, RadioGroup, DataTable; parent cannot reject a change.
- Toaster is not in the top layer; hidden behind any open `<dialog>`. Use `popover="manual"`. `Toast.ts:157`.
- Combobox and Popover walk for `<fieldset>` before DOM adoption. `Combobox.ts:585-587`, `Popover.ts:259-261`.
- Calendar falls back to `new Date()` at render (hydration mismatch when `today` omitted).

### Build tooling

- Type-only imports from server-only packages fail the client build. `vite-security-plugin.ts:277-316`.
- `[id]` and `[...slug]` siblings rejected as duplicate routes (collision key expects old `*` syntax). `route-ids.ts:164-167`.
- `[[...slug]]` emits `::slug{.+}` silently. `route-ids.ts:105-106`.
- Manifest and route-file write failures only `console.warn`; build exits 0 with no hydration. `vite-plugin.ts:474-488`.
- Cross-file base classes are fail-open (no stripping, no warning). `vite-security-plugin.ts:940-985`.
- Stub generation interpolates names into single quotes without escaping. `:578,1510-1522`.
- `server$` method names hash the absolute path; builds are not path-reproducible. `:389`.

### CLI, scaffold, adapters, studio

- `vite` is an undeclared runtime dependency of the CLI (works only via hoisting). `cossack/src/inheritance.js:7`.
- `generate`, `delete`, `image optimize` use `process.cwd()` not `findProjectRoot`. Running from `src/pages` nests paths.
- `cossack upgrade` breaks on Windows (`execFile('pnpm')` without shell). `upgrade-scaffold.js:17,38`.
- `dev`, `ssg`, `start` resolve `vite`/`wrangler` from PATH; global install fails. Route through `runProjectTool`.
- `addFeature`, `removeFeature`, `createApp` apply plans non-atomically; only `switchAdapter` is atomic. `scaffold/src/index.js:3061,3150,2404`.
- Legacy `CossackNodeAdapter` hardcodes `http://` (rejects all upgrades under TLS) and is still the documented path. Delete it.
- Unmatched `upgrade` requests are left open. `node-adapter/src/index.ts:111-113`.
- Desktop `application.mainWindow`/`shell` go stale after macOS re-activate. `desktop/src/index.ts:556-572`.
- Studio batch delete/update is not transactional. `studio/src/lib/service.ts:489-540`.
- Studio rejects Postgres `$$` bodies; remote D1 likely broken on Windows (`wrangler.cmd` without shell).
- Studio launch token reusable for the process lifetime. `security.ts:55-64`.
- `test-utils.click()` bypasses `disabled`.

## Phase 3: performance

Ordered by measured or structural impact.

1. **Renderer SSR re-analyses every template per render.** 60% of SSR time in a 40k-row benchmark is `scopeTemplateStrings` + `classifyPositions` + `findNothingAttributeGroups`. Cache per `TemplateStringsArray`. `cossack-html.ts:546-550`.
2. **`serializeFormValues` re-parses the whole output with parse5 for every nested template.** Run once at the outermost render. `ssr-form-values.ts:7-8`.
3. **Security plugin `load()` reads and Oxc-parses every client module id, including PNGs and CSS**; server-only pages are parsed up to four times. Gate on extension, parse once. `vite-security-plugin.ts:175,681`.
4. **Each client transform re-parses the module 3 to 6 times** and recomputes `frameworkClasses` per class. Compute once, thread the program through.
5. **Static `/assets/*` requests run the full middleware stack** (config, auth, locale catalogs, flash). `router.ts:404-462`. Needs a design decision first: worker-first routing deliberately runs project middleware for assets (the deploy acceptance test asserts it), so a fast path must be opt-in. Do not cache the config store per env object: factories can create request-bound I/O objects, and reusing them crashed Workers in Phase 2.
6. **`getInlineCss` never caches the negative decision**; every SSR request re-fetches and re-encodes the CSS bundle. `router.ts:248-274`.
7. **Studio re-introspects the whole schema on every browse and three times per mutation**; remote D1 spawns dozens of `wrangler` processes per click. `studio/src/lib/service.ts:193-204`.
8. `InMemoryRateLimitStore` runs an O(n) prune on every new-key insert at capacity. `rate-limit.ts:134-142`.
9. Every non-empty upload uses multipart, even 1-byte objects. `storage/r2.ts:95-101`, `s3-provider.ts:135-143`.
10. Cache facade serializes values 3 to 4 times per write. `framework/src/cache.ts:722-768`.
11. Incoming WS frames are stringified twice for size checks; state applier walks state three times per frame. `transport-connections.ts:38`, `rpc-state.ts:111-141`.
12. `collectReactiveMetadata` and task registration rebuilt every render; cache per constructor. `cossack.ts:2135,1792-1815`.
13. `serveStatic` is sync, buffered, no ETag/Range. `node-adapter/src/static-serve.ts:95-149`.
14. One `<style>` element per styled component instance. `cossack-element.ts:64,245`.
15. MessageScroller measures every row on every scroll event. `MessageScroller.ts:110-120`.
16. Studio truncates results after loading everything. `transport.ts:33-45`.
17. MCP spawns a fresh worker and re-imports the Wrangler bundle per call. `inspection-runner.js:23`.
18. Config requirements re-normalized per request. `config.ts:184-191`.
19. Hydration payload repeats the user per component (page, each layout, app). Phase 1 reduced it to `{ id }` plus opt-in fields, so this is now size only. Emit it once at the payload root and update the three client reads: core bootstrap (`cossack.ts` `this.user = metadata.user`), navigation hydration (`cossack.ts` `state.metadata?.user`) and `framework/src/client/app.ts`. Deferred from Phase 1.

### Phase 3 outcome (2026-10-14)

- PR #100 shipped items 3, 4, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18 and 19, plus a single-pass `escapeHtml`. Items 1, 2 and 6 were already fixed on master; Phase 3 froze the shared template analysis and pinned every cached inline-CSS decision with tests.
- Item 14 shipped separately as option B: one `<style data-cossack-style>` per component style scope in `<head>`, reference-counted per style root on the client.
- Item 5 still needs a design decision.
- Follow-ups found during Phase 3 (fixed in PR #103 except where noted below):
  - `runTasks()` creates an AbortController and context per task on every client render, about 100 µs with six tasks.
  - `InMemoryCacheStore.write` scans every entry at capacity, the pattern item 8 fixed for rate limits.
  - In dev, the framework demo's `/renderer/lit-compat` page logs four `cossack.hydration.mismatch` text-content warnings. They predate Phase 3.
  - Studio's Postgres and MySQL introspection still runs three or four queries per table.

## Phase 4: design, dead code, docs, tests

### Structural refactors that remove bug classes

- **One HTML tokenizer in the renderer.** Four hand-rolled scanners disagree on raw-text elements, comments, and `<` in text. Consolidating also enables the per-template cache.
- **One controlled-value helper in UI** (`internal/controlled.ts`): last emitted value until `props` identity changes. Ten components hand-roll it.
- **One layout-scope-chain helper in framework.** Duplicated in SSR, `/ws`, `/crpc`, and `sse.ts`; the SSE copy is already wrong.
- **Fail-closed class discovery in the security plugin** with a dev-time log listing automatic RPC endpoints.

### Dead code to delete

- `_optimisticLockedKeys` machinery (never written; ~40 lines across 5 files).
- `storage/s3.ts`, `@aws-sdk/s3-request-presigner`, `r2-upload` demo.
- `CossackNodeAdapter` legacy class.
- `ValueSanitizer`/`SanitizerFactory` exports (nothing consumes them).
- `Select.ts` vs `NativeSelect.ts` duplicate; `Accordion` is an alias of `AccordionItem`.
- `usocket` placeholder and stale overrides (`fast-uri`, `brace-expansion@2`) in `pnpm-workspace.yaml`.
- CLI: `fs-utils.js:99-101` no-op, `src/style.css`, duplicate route discovery in `routes.js:15-16`.

### API inconsistencies

- UI change callbacks: `onChange`, `onValueChange`, `onPressedChange`, `onToggle`, `onSizeChange`, `onOpenChange`; `delay` vs `hoverDelay`. Normalize now (alpha).
- `invalidate$` does not bind the field first, unlike `refresh$`/`load$`/`resourceStatus$`.
- `_phase` never rests in `Mounted`; `getPhase()` reports `Creating` for live components.
- `@cossackframework/test-utils` is `private: true` but listed as a published package in the CLI and release verifier.

### Docs that disagree with code

- `docs/template.md`: `href="${false}"` is said to omit the attribute; it renders `"false"`.
- `docs/components.md`: `onClick: this.handleClick` example silently does nothing (must be `@click`).
- `docs/client-bundle.md`: "3 levels" depth is actually unbounded; `generateStaticParams` removal promise is bypassable.
- `docs/adapters.md`: documents the legacy adapter.
- `docs/oauth.md`: promises `hostedDomain` restriction.
- `docs/errors-handling.md`: claims stack traces in 500 fallback.
- `docs/websockets.md`, `docs/session.md`: per-URL DO identity and sliding cookie claims.
- `docs/cossack-cli.md`: `build` description, `lang publish`; help text lists 7 of 17 features.
- `docs/local-agent-tools.md`: MCP schema and "no module execution" claim (Wrangler is imported).
- `packages/database/docs/models.md`: `select/insert/update` column options.

### Test coverage to add

Every Phase 1 and Phase 2 row lacks a test today. Highest value:

- Stripping boundary: class expressions, inline-arrow handlers, aliased `@Page`, top-level `server$`, `#private` collision, `import type`.
- Renderer: raw-text bindings, camelCase props, duplicate keys, objects in node position, duplicate `_id`.
- Core: `@On` on nested child, write during `updated()`, broadcast failure recovery, `isRpcCallableAction(Cossack, '_runtime') === false`, singleton `@State` isolation.
- Database: live Postgres/MySQL runs (currently only `MemoryDriver` text assertions), relation loading, concurrent transactions, datetime round-trips, `select:false`.
- Auth: `hostedDomain`, unverified email fallback, login handler content-type, timing.
- UI: controlled-parent timing for every controlled component; Toaster under modal.
- CI: run desktop and all package tests before publish; add `packages/core|framework|database/**` to integration-test paths; cache Playwright; SHA-pin actions; try `--workspace-concurrency=3`.

### Phase 4 outcome (2026-10-14)

- Done in PR #102: the last two hand-written HTML scanners now use the shared tokenizer; live components rest in `Mounted`; `ValueSanitizer`/`SanitizerFactory`, `Select`, the `AccordionItem` alias and the r2-upload demo are gone; six UI components moved onto `ControlledValue`; UI callbacks follow one naming rule; SSE cold starts and SSG use the shared layout scope chain; the security plugin fails closed and logs automatic RPC endpoints; `generateStaticParams` removal holds; the listed docs match the code; `test-utils` stays private everywhere; releases wait for the e2e suites, and integration runs for every package change.
- Also in PR #102: Phase 3 item 5 as option 3. Cloudflare serves hashed `/assets/*` without the Worker, and the Node entry runs policies before every other static file. Fixes found along the way: seven database bugs from the live suite (MySQL `findOne()`, UTC datetimes, one-to-one inverse loading, false drift), one auth timing bug, minification that dropped visible spaces, spread classes that differed between SSR and the client, and `cossack add ui` ejecting components that did not compile.
- Already done before Phase 4: `_optimisticLockedKeys`, `invalidate$` binding, `storage/s3.ts`, the presigner, `CossackNodeAdapter`, the CLI dead code, several docs, and every listed renderer and core test.
- Open items from Phases 3 and 4 were fixed in PR #103; see below.

### Open items outcome (2026-10-15)

- Fixed in PR #103:
  - Every trace of state providers is gone, including the removal error and the old WebSocket URL handling.
  - Builds, `cossack check`, `cossack check routes` and deploy preflight reject pages at the transport paths (`/ws/`, `/sse/`, `/crpc`, `/upload`); every transport path comes from `@cossackframework/core/transport-routes`.
  - Durable Object pages are built in their layout scopes. Component RPC, layout-service RPC and the WebSocket upgrade run every layout and page guard with checked route params, as SSR does.
  - Desktop production serves only hashed `/assets/*` before policies; the dev restart check was a broken test and passes.
  - `pnpm test:databases` and `pnpm test:desktop` are local pre-release suites, listed in `AGENTS.md`; CI does not run them.
  - Studio loads PostgreSQL and MySQL schemas in a constant number of queries, reads PostgreSQL keys from `pg_catalog`, and no longer fails on MySQL foreign keys.
  - The renderer applies every spread on an element and writes multi-value attributes once per render; the demo's dev hydration warnings came from its layout and are fixed.
  - `runTasks()` and `InMemoryCacheStore` writes no longer do per-task or per-entry work when nothing restarts or the cache is full.
- Remaining:
  - State shared per user across different page files, or a child component with its own scope, would be a new realtime feature.
  - The SSE endpoint's first guard pass runs without route params; every revalidation runs with them.
  - A route param that a more specific sibling route would match (`team: 'new'` next to `/teams/new`) is accepted; only that page's own guards run.

## Suggested order

| Week | Scope |
|---|---|
| 1 | Phase 0, then Phase 1 rows 1.1 to 1.4 (stripping), 1.7, 1.8, 1.9, 1.26, 1.27 |
| 2 | Phase 1 auth (1.15 to 1.19), 1.20 to 1.25, 1.10 to 1.14 |
| 3 | Phase 2 renderer and core client (the shared `_id` bug first), core server broadcast |
| 4 | Phase 2 database and framework runtime |
| 5 | Phase 2 UI (shared controlled helper), build tooling, CLI/scaffold |
| 6 | Phase 3 items 1 to 7, Phase 4 refactors and dead-code deletion |
| ongoing | Docs sync, test backfill per row as each fix lands |
