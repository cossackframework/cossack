# Cossack 0.9.0 release checklist

This release implements the framework, developer experience, agent tooling,
and Cloudflare work agreed in the feature review. An unchecked item remains
in scope. Package versions change only after implementation and verification.

## CLI and agent tooling

- [x] Preserve lifecycle flags, dispatch command help, and make creation dry runs read-only.
- [ ] Validate command-specific flags and reject ambiguous/unknown options consistently. Explicit boolean values are implemented.
- [ ] Versioned JSON output, stable diagnostics, consistent exit codes, and noninteractive behavior across commands.
- [ ] Inspect/check/explain commands using compiler and scaffold metadata, including source locations and method classification reasons.
- [ ] Complete resource, validated mutation, protected route, and scoped service recipes with tests and capability checks.
- [ ] Structured upgrades with dependency changes, conflicts, preserved files, and follow-up actions.
- [ ] Local MCP tools sharing inspection, documentation, checks, test results, and trace services with the CLI.
- [ ] Installed-version offline AGENTS guide, generated API/component catalog, and executable documentation/skill examples.

## Runtime and application APIs

- [ ] Consistent HTTP/SSE/WebSocket RPC promises, results, errors, timeouts, and request IDs; precise serialization diagnostics.
- [ ] Validated server actions with input schemas, field errors, and shared resource policies.
- [ ] Public server resource pending/error/retry state and typed refresh/invalidation.
- [ ] State/store/computed guidance and serialization/shallow mutation diagnostics.
- [ ] Typed task dependencies, contextual failures, and cancellation of stale async work.
- [ ] Consistent optimistic updates and rollback under failure, concurrency, and disconnects.
- [ ] Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection.
- [ ] Typed URL state for search, filtering, sorting, and pagination, with history/defaults.
- [ ] Navigation completion and cache/scroll/transition diagnostics.
- [ ] Typed form controller: values, errors, touched state, submit/reset, and existing validation integration.
- [ ] Session/flash recipes covering RPC failure, redirects, old input, and rotation.
- [ ] DI resolution errors and scope/lifetime inspection with clear global/scoped guidance.
- [ ] Auth/OAuth failure diagnostics and reusable credential/session primitives in the auth library.
- [ ] Typed resource authorization policies and client visibility helpers.
- [ ] Database metadata, relationships, provider capabilities, query diagnostics, pagination, and transactions.
- [ ] Structured migration/seeder plans including SQL, destructive operations, environment, and target.
- [ ] Shared Studio/CLI database inspection service.
- [ ] Cache/rate-limit capability checks, consistent TTL units, and transport coverage.
- [ ] Realtime connection state, reconnect/resync, and pending action handling without blind mutation replay.
- [ ] SSR/hydration diagnostics with component/field/source information and test helpers.
- [ ] SSG entry/plugin validation, per-route results/timings, and dependency compatibility tests.
- [ ] Typed markdown frontmatter, route/URL collision checks, and locale static output.
- [ ] Typed DataTable with server data, filtering, sorting, selection, and pagination; native UI attributes/events and accessibility catalog.
- [ ] Inferred configuration factories, required binding validation, and secret redaction.
- [ ] Build-time capability checks across Cloudflare, Node, Deno, and Desktop.
- [ ] Storage providers for local/R2/S3, uploads/downloads/deletes, signed URLs, progress, metadata, and authorization; image diagnostics.
- [ ] Localization extraction/checks, placeholder validation, missing/unused keys, and typed translation keys.
- [ ] Devtools snapshots and timelines with correlation IDs.
- [ ] Test utilities using real lifecycle/context/auth/DI/SSR/hydration/RPC behavior, published exports, and their own test suite.

## New services

- [ ] Background jobs with delays, retries, idempotency, failure inspection, and local test adapters.
- [ ] Schedules/Cron integration.
- [ ] Email/in-app notification templates, preferences, and delivery status using existing SMTP support where applicable.
- [ ] Durable multi-step Workflows integration.
- [ ] Turnstile component and server token verification.

## Cloudflare deployment

- [ ] Select environment before Vite build and share it across SSG, bindings, migrations, and deployment.
- [ ] Explicit local/remote database targets using the existing migration system.
- [x] Required secret declarations, placeholder checks, environment-specific ignore rules, and deployment binding type generation. Remote secret validation remains Wrangler's deployment responsibility.
- [ ] Real resource selection or Wrangler provisioning in place of fake resource IDs.
- [ ] Distributed SSE coordination for cross-request state/broadcasts, retaining per-response streams.
- [ ] Built artifact/workerd tests for authentication, RPC, assets, SSG, bindings, migrations, and realtime.
- [x] Public-only SSG and correct Worker-first routing for protected assets.
- [ ] Production logs, source maps, correlation IDs, and build/startup budgets.
- [ ] Isolated preview/CI resources, smoke checks, promotion, cleanup, and accurate code/state rollback guidance.
- [ ] Correct custom-domain/build deployment documentation and tested compatibility baseline.
- [x] Remove tracked credential values; report any required external credential rotation without exposing values.

## Release gates

- [x] Fix reports.md issues and verify package/SSG regressions.
- [ ] Compile documentation examples and validate generated applications and published tarballs.
- [ ] Run build, root TypeScript command, package type checks, unit tests, and relevant end-to-end/runtime tests.
- [ ] Update all release versions to 0.9.0, lockfile, changelog, migration guide, and release notes.
- [ ] Audit every checklist item against implementation and verification evidence before marking the goal complete.

## Verification log

Record completed slices and exact verification commands here. Focused checks do
not replace the final monorepo and runtime release gates.

### CLI lifecycle and creation

- Dispatcher regression tests exercise all command help handlers, Vite argument
  forwarding, legacy SSG diagnostics, and real temporary-directory creation plans.
- `create --dry-run --json` emits one versioned result without writing files,
  prompting, checking updates, or exposing generated secret values. Creation
  failures have diagnostic codes. Other commands still need JSON conversion.
- Explicit boolean flags accept `true`/`false`, reject other values, and use the
  last repeated value. Canonical `--force=false` takes precedence over `-f`.
- `pnpm --filter cossack exec vitest run`: 222 tests passed.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 81 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed after all code changes in this slice.

### SSG environment resolution

- Named Cloudflare environments resolve APP_URL from JSON, JSONC, and TOML
  without inheriting top-level vars. Explicit environment selection overrides
  CLOUDFLARE_ENV, and explicit shell APP_URL remains highest priority.
- Dotenv files follow environment/local precedence. Tests cover these rules,
  quoted TOML environment names, and the existing build plugin behavior.
- `pnpm --filter @cossackframework/framework exec vitest run tests/ssg-config.test.ts tests/vite-ssg-plugin.test.ts`: 35 tests passed.
- Updated SSG and sitemap documentation to describe the integrated Vite build
  and remove obsolete CLI flag examples. Deployment orchestration, binding
  selection, and remote migrations remain open.

### Cloudflare deployment and scaffold secrets

- Added `cossack deploy --env <name> --dry-run --json`. It uses the project's
  Wrangler parser and executable, selects CLOUDFLARE_ENV before type generation
  and Vite build, verifies target configuration in the artifact, and passes
  the exact built config to Wrangler. Dry runs build and validate locally;
  they do not upload or provision. Remote secret checks are explicitly reported
  as not checked during local validation.
- Preflight rejects unknown environments, secrets in vars, invalid/default
  APP_URL, missing Worker entry points, and placeholder resource IDs. JSON
  results contain names and diagnostics, not raw configuration values.
- Stale deployment metadata is removed before building. A build without the
  Cloudflare plugin cannot deploy metadata left by a previous build.
- New Cloudflare apps generate a local APP_SECRET, preserve it during feature
  composition, declare required secret names, ignore environment-specific local
  files, and use automatic D1 provisioning. Hyperdrive resource selection is
  still open; its placeholder is rejected by deployment preflight.
- Removed R2 credential values and APP_SECRET from the tracked demo Wrangler
  vars and regenerated binding/runtime types. A scan of tracked working-tree
  files found no copies of the removed R2 credentials. Any active credentials
  need external rotation; no rotation or cloud deployment was performed.
- Updated deployment documentation for environment selection, dry-run effects,
  secrets, custom domains, Node entry path, and code/state rollback differences.
- `pnpm --filter cossack exec vitest run`: 235 tests passed before adding the
  integration test; `tests/deploy-integration.test.js` then passed separately.
- The integration test generates a staging app, uses real project Vite and
  Wrangler, generates types, builds, verifies the environment, and completes
  a Wrangler deployment dry run without uploading.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 82 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed with regenerated types.
- Migrations, remote database target selection, broader runtime tests, preview
  automation, and the remaining release checklist are still open.

### Database plans and Cloudflare inspection

- ORM adapter factories receive project root, config path, environment,
  local/remote target, and read-only intent. Commands validate flags by action,
  reject extra arguments and conflicting targets before adapter creation, and
  emit versioned JSON results. CLI forwarding preserves false/repeated values.
- Migration plans include SQL, parameter counts, destructive risk, direction,
  checksum, completeness, and squash consolidation. The disconnected driver
  substitutes the application's ORM scope, including static entity/shared SQL
  calls, and retains its naming strategy. Live query callbacks produce an
  incomplete result. Seeder previews select metadata without executing callbacks.
- History inspection does not initialize bookkeeping and correctly recognizes
  already-applied migrations. Snapshot/generation/squash/schema-pull dry runs
  return proposed changes without writing application files.
- Generated D1 tooling uses project Wrangler, shares local development storage,
  forces local or the selected remote D1 binding, preserves the configured
  account, and disposes proxy resources. Remote binding setup is tested with an
  injected Wrangler; no live Cloudflare database was changed.
- Real local D1 tests cover schema inspection, queued migration plans, applying
  migrations and reading their history, reversal plans, and unique columns.
  D1 inspection avoids a catalog query rejected by workerd and hides Cloudflare
  internal tables. SQLite tests also cover squash consolidation; catalog query
  tests cover PostgreSQL/MySQL history without writes.
- Studio now shares D1 discovery with database tooling instead of maintaining
  separate JSONC/TOML parsers. Tests reject missing environment declarations and
  prevent fallback to top-level bindings, including quoted TOML environment names.
- Added read-only `cossack inspect cloudflare` and `cossack check cloudflare`.
  They share deployment preflight, emit resource/secret names without values,
  report diagnostics, and distinguish local configuration validity from
  unchecked build/remote readiness. Inspection describes invalid configurations;
  checks fail on them. Tests verify no project artifact/config changes.
- Ran the inspection CLI against packages/framework: it returned one JSON
  envelope with the Worker, Durable Object binding, required secret names, valid
  local configuration, and build/remote readiness explicitly not checked.
- The remaining provider target semantics, broader compiler inspection/MCP,
  runtime services, distributed SSE, resource setup, preview automation, and
  release gates remain in scope. These changes do not complete the release.
- Database JSON output is now isolated in a child process. Configuration,
  adapter, migration, disposal, and inherited subprocess logs cannot enter
  stdout/stderr; one validated result returns over IPC. Tests cover console
  output, direct writes, spoofed stdout JSON, parent environment isolation,
  and premature process termination. Live remote D1 verification remains open.
- `pnpm --filter @cossackframework/database build`: passed.
- `pnpm --filter @cossackframework/database exec vitest run`: 81 tests passed.
- `pnpm --filter @cossackframework/database audit:bundle`: passed; neutral
  imports and the Cloudflare runtime retain their runtime boundaries.
- `pnpm --filter cossack exec vitest run`: 245 tests passed. After the final
  help text change, inspection and dispatcher suites passed again (37 tests).
- `pnpm --filter @cossackframework/studio exec vitest run`: 52 tests passed.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 82 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed after the database changes.

### Current reports.md: CSM-004 Tabs underline

- Removed static active/inactive bottom borders from Tabs triggers. The sliding
  indicator remains the single underline; variant props still stay out of the
  DOM attribute spread.
- Server rendering tests verify one indicator and no trigger border classes.
  A browser-method test verifies that selected tab widths/offsets continue to
  position the indicator when the controlled tab changes.
- `pnpm --filter @cossackframework/ui build`: passed.
- `pnpm --filter @cossackframework/ui exec vitest run`: 112 tests passed.
- Root and all package type checks passed after the component change.
- Final `pnpm tsc --noEmit` and UI package TypeScript checks passed after adding
  the browser-method test.
- `pnpm --filter @cossackframework/framework exec vitest run tests/package-contract.test.ts tests/ssg-config.test.ts tests/vite-ssg-plugin.test.ts`:
  51 tests passed, including the package and SSG regressions from earlier reports.
- No edits were made to the user's reports.md contents. Its existing final
  blank line is the only reported issue from `git diff --check`; the remaining
  tracked changes pass the whitespace check.

### Public SSG and Worker-first assets

- SSG now uses a real anonymous Hono request and runs global, layout, and page
  middleware. Synthetic user state and the context mock were removed. Denied
  or redirected requests cannot bootstrap protected pages; authenticated
  identities, cookies, credential-dependent output, and private cache policies
  fail generation. Middleware failures remain build failures.
- SSR and SSG share layout ancestry from source paths, including route groups
  and dynamic layouts. Disabled SSG is honored. Catch-all HTTP routes now use
  a real Hono multi-segment parameter; an actual request test exposed and
  replaced the former nonmatching `:name*` pattern.
- The plugin validates all routes before writing HTML or sitemap files. Failed
  renders, output collisions, and traversal attempts publish no generated
  routes. Static parameter replacement handles catch-alls and rejects missing
  parameters instead of publishing template URLs.
- Generated apps and the demo use Worker-first assets. Framework middleware
  serves matching files within global and page/layout policies, retains
  middleware headers, redirects known HTML aliases to canonical routes, and
  falls through to SSR/API handling for missing assets. Deployment preflight
  requires Worker-first routing and the ASSETS binding and verifies these
  settings in the built artifact.
- A generated staging application's actual Vite artifact ran locally under
  workerd: public SSG and client JavaScript loaded, protected static HTML/files
  were denied, and authorized responses retained policy headers. No upload or
  remote resource mutation was performed. Wider auth/database/realtime runtime
  gates and the remaining release work remain open.

### Static render services and awaitable cleanup

- SSG now creates App, layouts, and pages through core DI. Each render has an
  anonymous request root and explicit nested layout scopes, including grouped
  and dynamic source ancestry. Scoped services bind real request parameters
  and the resolved APP_URL. Layout service slots and scope keys hydrate with
  the same ownership metadata as SSR.
- Added `ServiceScope.disposeAsync()` and `Cossack.destroyAsync()`. They await
  hooks already started by synchronous disposal, release descendants and
  subscriptions even when a hook throws, and report collected failures.
  Completed successful child disposals are removed from long-lived roots.
  Component hooks finish before owned service disposal. Registered async task
  cleanup is awaited without delaying ordinary synchronous task execution.
- SSG awaits all constructed instances and service scopes on success and after
  construction, init, render, or head failures. Cleanup failures fail the render;
  an earlier render failure remains the cause. Constructor DI, lazy injection,
  nested shadowing, concurrent render isolation, public service hydration, and
  renderer-created child cleanup have focused regression coverage.
- The generated staging app integration now hydrates a real layout-owned
  service through published packages and Vite, then runs the artifact under
  workerd. SSG and repeated live SSR requests each get fresh state and the
  staging APP_URL. Protected static files, global/layout/page guards, and the
  failed-public-SSG build gate remain covered. No cloud upload was performed.
- A production framework build generated all six expected static pages and
  the sitemap. Core and framework library builds, root TypeScript, and all
  package type checks passed. Full core tests passed: 40 files, 594 tests.
- `pnpm test:unit` passed: 2,080 tests across all 12 packages that have unit suites,
  including the expanded generated-app/workerd integration. Framework: 495
  tests; CLI: 259 tests. This does not replace the remaining end-to-end and
  final release gates.
- After adding a separate successful-render/failed-cleanup case, the focused
  SSG service suite passed all 10 tests; root and framework TypeScript checks
  passed again. This verifies cleanup failure alone prevents a successful render.
- Library type generation uses a dedicated entry-free Wrangler configuration;
  application-generated declarations no longer import the demo into published
  library output. Package-contract tests check the boundary and generated
  asset/Durable Object binding types.
- Current SSR/RPC completion and browser navigation remain nonblocking.
  Cancellation of in-flight tasks and client compilation of service disposal
  hooks still require work; the broader DI, transport, and release gates remain
  unchecked. This slice does not complete 0.9.0.

### Response-local component RPC streams

- Replaced the separate HTTP/SSE client implementations with one request per
  component action. The call supports iteration, shared promise completion,
  cancellation, and automatic draining for unobserved event-handler calls.
  Iterating SSE actions no longer dispatches a second mutation. Awaiting an
  ordinary async SSE action now waits for its actual result.
- Added a versioned UTF-8 NDJSON frame protocol for yields, final values, state,
  and correlated errors. Both sides enforce a 1 MiB frame limit; the incremental
  parser also bounds buffering overhead for tiny network chunks. Malformed,
  truncated, oversized, and inconsistent frames fail explicitly. HTTP/SSE
  component calls reject failures instead of silently resolving undefined.
- Generator pulls and cleanup use the original action's AsyncLocalStorage
  snapshot. Component RPC reconstructs layout DI scopes and waits for component,
  descendant, and scope cleanup. SSE scopes are checked before constructors.
  SSE's subscription store no longer retains or drives action generators.
- Request-context middleware exposes a structural response-lifetime contract.
  ORM middleware defers factory-owned database closure for retained streams,
  including cancellation, without depending on framework. Ordinary responses
  and caller-owned databases retain their ownership behavior. Generated
  Cloudflare ORM factories now supply async-local scopes for static models and
  global SQL. The database's neutral and Cloudflare entry graphs stay unchanged.
- Real generated staging-app tests build published packages with Vite, validate
  the artifact, and run it under workerd. They verify D1 queries between yields,
  middleware/config/request context, layout-service state, final results,
  client-visible failures, and cancellation through a real HTTP listener. The
  existing public SSG and protected asset checks remain covered.
- These tests exposed Vite's source-relative D1 migration-path rewrite. Artifact
  validation now compares resolved migration directories while still comparing
  every other binding setting. Regression tests reject changed databases, IDs,
  and migration targets, including custom source migration directories.
- `pnpm build`, `pnpm tsc --noEmit`, and `pnpm typecheck` passed. All 11 package
  type checks passed after the dependency build completed. A concurrent earlier
  type check saw temporarily missing core declarations during rebuilding; the
  post-build check passed without a source workaround. Database bundle audit
  passed for the 28 neutral modules and the Workers-safe Cloudflare entry.
- `pnpm test:unit` passed: 2,124 tests across all 12 packages with unit suites.
  Core: 615; framework: 515; database: 84; CLI: 261. The expanded real-worker
  integration is included. No cloud upload or remote provisioning was performed.
- Distributed SSE coordination is still incomplete: its shared state store
  remains Worker-local. WebSocket and explicit service RPC parity, cancellation
  of stale tasks, typed client generator-result inference, preview/release
  tooling, and all other unchecked release requirements remain in scope.
  Versions remain 0.8.3 until the complete 0.9.0 checklist and release gates pass.

### Distributed SSE prototype and agent handoff

- Added a native SQLite-backed `SseDurableObject` prototype with serialized
  actions, bounded snapshots/event history, and callback RPC that runs actions
  in their original Worker request context. Its native integration test uses
  two Workers sharing one namespace and exercises concurrent increments,
  scope isolation, AsyncLocalStorage, persistence after reload, and progress
  after canceling an HTTP response.
- This prototype is not connected to SSR, `/crpc`, or `/sse`, is not scaffolded,
  and is not yet a published package entry. The application still uses the
  Worker-local SSE store. The distributed SSE checklist item remains open.
- The user requested a commit and handoff to GLM. See
  [handoff-0.9.0.md](./handoff-0.9.0.md) for the implementation map, exact remaining
  integration work, verification results, and the later review checklist.
- Fixed the prototype's SQL row generic types and explicit async-iterator
  return arguments. The checkpoint build, root TypeScript check, all 11 package
  type checks, and database bundle audit passed. `pnpm test:unit` passed 2,125
  tests across 12 packages, including the new coordinator test. Exact commands
  and outstanding verification gates are recorded in the handoff note.
