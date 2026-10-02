# Cossack 0.9.0 release checklist

This release implements the framework, developer experience, agent tooling,
and Cloudflare work agreed in the feature review. An unchecked item remains
in scope. Package versions change only after implementation and verification.

Read [the detailed implementation plan](./release-0.9.0-plan.md) for each task's
purpose, baseline, approach, dependencies, and acceptance criteria. The task IDs
below link directly to those explanations.

## CLI and agent tooling

- [x] [CLI-01](./release-0.9.0-plan.md#cli-01) Preserve lifecycle flags, dispatch command help, and make creation dry runs read-only.
- [ ] [CLI-02](./release-0.9.0-plan.md#cli-02) Validate command-specific flags and reject ambiguous/unknown options consistently. GLM (2026-10-02): shared `CommandSpec` (flags, aliases, positionals, `forwardsArgs` boundary for vite/wrangler forwarding) validates every converted command before effects with `COSSACK_OPTION_UNKNOWN`/`COSSACK_ARGUMENT_*` codes and supported alternatives; remaining: conflict/repeat rules beyond last-wins and per-subcommand flag sets (lang/image/generate subcommands share one set).
- [ ] [CLI-03](./release-0.9.0-plan.md#cli-03) Versioned JSON output, stable diagnostics, consistent exit codes, and noninteractive behavior across commands. GLM (2026-10-02): `runWithSpec` emits the versioned envelope for 16 converted commands (version, info, routes, build, dev, start, ssg, studio, adapter, lang, add, generate, remove, delete, upgrade, image); build/ssg capture child output under `--json`; thrown failures become coded diagnostics with exit 1; remaining: the database cluster's child-process JSON already conforms but is not yet on `runWithSpec`, and long-running commands still need their event-output contract.
- [ ] [CLI-04](./release-0.9.0-plan.md#cli-04) Inspect/check/explain commands using compiler and scaffold metadata, including source locations and method classification reasons.
- [ ] [CLI-05](./release-0.9.0-plan.md#cli-05) Complete resource, validated mutation, protected route, and scoped service recipes with tests and capability checks.
- [ ] [CLI-06](./release-0.9.0-plan.md#cli-06) Structured upgrades with dependency changes, conflicts, preserved files, and follow-up actions.
- [ ] [CLI-07](./release-0.9.0-plan.md#cli-07) Local MCP tools sharing inspection, documentation, checks, test results, and trace services with the CLI.
- [ ] [CLI-08](./release-0.9.0-plan.md#cli-08) Installed-version offline AGENTS guide, generated API/component catalog, and executable documentation/skill examples.

## Runtime and application APIs

- [ ] [RT-01](./release-0.9.0-plan.md#rt-01) Consistent HTTP/SSE/WebSocket RPC promises, results, errors, timeouts, and request IDs; precise serialization diagnostics. GLM (2026-10-02): WebSocket and explicit service RPC now use the shared request-scoped contract (correlated frames, cancellation, `@Server({ timeout })` deadlines with uncertain-outcome semantics, RpcError taxonomy, generator streaming for service RPC) with a conformance suite; still open: compiler-level client typing of yielded/final results and value-path serialization diagnostics.
- [ ] [RT-02](./release-0.9.0-plan.md#rt-02) Validated server actions with input schemas, field errors, and shared resource policies.
- [ ] [RT-03](./release-0.9.0-plan.md#rt-03) Public server resource pending/error/retry state and typed refresh/invalidation.
- [ ] [RT-04](./release-0.9.0-plan.md#rt-04) State/store/computed guidance and serialization/shallow mutation diagnostics.
- [ ] [RT-05](./release-0.9.0-plan.md#rt-05) Typed task dependencies, contextual failures, and cancellation of stale async work.
- [ ] [RT-06](./release-0.9.0-plan.md#rt-06) Consistent optimistic updates and rollback under failure, concurrency, and disconnects.
- [ ] [RT-07](./release-0.9.0-plan.md#rt-07) Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection.
- [ ] [RT-08](./release-0.9.0-plan.md#rt-08) Typed URL state for search, filtering, sorting, and pagination, with history/defaults.
- [ ] [RT-09](./release-0.9.0-plan.md#rt-09) Navigation completion and cache/scroll/transition diagnostics.
- [ ] [RT-10](./release-0.9.0-plan.md#rt-10) Typed form controller: values, errors, touched state, submit/reset, and existing validation integration.
- [ ] [RT-11](./release-0.9.0-plan.md#rt-11) Session/flash recipes covering RPC failure, redirects, old input, and rotation.
- [ ] [RT-12](./release-0.9.0-plan.md#rt-12) DI resolution errors and scope/lifetime inspection with clear global/scoped guidance.
- [ ] [RT-13](./release-0.9.0-plan.md#rt-13) Auth/OAuth failure diagnostics and reusable credential/session primitives in the auth library.
- [ ] [RT-14](./release-0.9.0-plan.md#rt-14) Typed resource authorization policies and client visibility helpers.
- [ ] [RT-15](./release-0.9.0-plan.md#rt-15) Database metadata, relationships, provider capabilities, query diagnostics, pagination, and transactions.
- [ ] [RT-16](./release-0.9.0-plan.md#rt-16) Structured migration/seeder plans including SQL, destructive operations, environment, and target.
- [ ] [RT-17](./release-0.9.0-plan.md#rt-17) Shared Studio/CLI database inspection service.
- [ ] [RT-18](./release-0.9.0-plan.md#rt-18) Cache/rate-limit capability checks, consistent TTL units, and transport coverage.
- [x] [RT-19](./release-0.9.0-plan.md#rt-19) Realtime connection state, reconnect/resync, and pending action handling without blind mutation replay. GLM (2026-10-02): `component.realtime` exposes per-connection state/attempts/lastError/lastEventId/resynced; WebSocket reconnect uses bounded exponential backoff (0.5s→30s, reset on open, none after intentional disposal); SSE resends an authoritative snapshot with a `resync` marker when history expired; pending calls reject with explicit uncertain-outcome errors (`COSSACK_RPC_TRANSPORT_CLOSED`) and never replay. Covered by core recovery/conformance tests plus the workerd coordinator suite.
- [ ] [RT-20](./release-0.9.0-plan.md#rt-20) SSR/hydration diagnostics with component/field/source information and test helpers.
- [ ] [RT-21](./release-0.9.0-plan.md#rt-21) SSG entry/plugin validation, per-route results/timings, and dependency compatibility tests.
- [ ] [RT-22](./release-0.9.0-plan.md#rt-22) Typed markdown frontmatter, route/URL collision checks, and locale static output.
- [ ] [RT-23](./release-0.9.0-plan.md#rt-23) Typed DataTable with server data, filtering, sorting, selection, and pagination; native UI attributes/events and accessibility catalog.
- [ ] [RT-24](./release-0.9.0-plan.md#rt-24) Inferred configuration factories, required binding validation, and secret redaction. GLM (2026-10-02): `requireBinding`/`requireEnv` fail with `COSSACK_BINDING_MISSING` naming the binding, listing available binding NAMES only (never values, secrets stay redacted), and pointing at per-environment wrangler configuration; remaining: config-path misspelling type tests and registry generation from project configuration.
- [ ] [RT-25](./release-0.9.0-plan.md#rt-25) Build-time capability checks across Cloudflare, Node, Deno, and Desktop. GLM (2026-10-02): explicit `runtime-capabilities` model (transports, realtime coordination, process-local realtime, scheduled handlers, storage, filesystem) with per-runtime profiles, binding-gated availability (`COSSACK_SSE`), and available/missing-binding/unsupported status distinction; remaining: scaffold recipe gating and CLI inspection must consume the same model.
- [ ] [RT-26](./release-0.9.0-plan.md#rt-26) Storage providers for local/R2/S3, uploads/downloads/deletes, signed URLs, progress, metadata, and authorization; image diagnostics.
- [ ] [RT-27](./release-0.9.0-plan.md#rt-27) Localization extraction/checks, placeholder validation, missing/unused keys, and typed translation keys.
- [ ] [RT-28](./release-0.9.0-plan.md#rt-28) Devtools snapshots and timelines with correlation IDs.
- [ ] [RT-29](./release-0.9.0-plan.md#rt-29) Test utilities using real lifecycle/context/auth/DI/SSR/hydration/RPC behavior, published exports, and their own test suite.

## New services

- [ ] [SVC-01](./release-0.9.0-plan.md#svc-01) Background jobs with delays, retries, idempotency, failure inspection, and local test adapters.
- [ ] [SVC-02](./release-0.9.0-plan.md#svc-02) Schedules/Cron integration.
- [ ] [SVC-03](./release-0.9.0-plan.md#svc-03) Email/in-app notification templates, preferences, and delivery status using existing SMTP support where applicable.
- [ ] [SVC-04](./release-0.9.0-plan.md#svc-04) Durable multi-step Workflows integration.
- [ ] [SVC-05](./release-0.9.0-plan.md#svc-05) Turnstile component and server token verification.

## Cloudflare deployment

- [ ] [CF-01](./release-0.9.0-plan.md#cf-01) Select environment before Vite build and share it across SSG, bindings, migrations, and deployment.
- [ ] [CF-02](./release-0.9.0-plan.md#cf-02) Explicit local/remote database targets using the existing migration system.
- [x] [CF-03](./release-0.9.0-plan.md#cf-03) Required secret declarations, placeholder checks, environment-specific ignore rules, and deployment binding type generation. Remote secret validation remains Wrangler's deployment responsibility.
- [ ] [CF-04](./release-0.9.0-plan.md#cf-04) Real resource selection or Wrangler provisioning in place of fake resource IDs.
- [x] [CF-05](./release-0.9.0-plan.md#cf-05) Distributed SSE coordination for cross-request state/broadcasts, retaining per-response streams. GLM (2026-10-02): coordinator wired through SSR, `/crpc`, and `/sse`; scaffolded `COSSACK_SSE` binding (`new_sqlite_classes`) and `SseDurableObject` entry; missing-binding and environment-inheritance diagnostics; cursor reconnect with bounded history; broadcasts. Node/Deno keep the documented process-local backend (see [specs/sse.md](./sse.md)). Not claimed: exactly-once external side effects, queued-caller cancellation on the pinned wrangler baseline, stream-response cookie handling (RT-11).
- [ ] [CF-06](./release-0.9.0-plan.md#cf-06) Built artifact/workerd tests for authentication, RPC, assets, SSG, bindings, migrations, and realtime.
- [x] [CF-07](./release-0.9.0-plan.md#cf-07) Public-only SSG and correct Worker-first routing for protected assets.
- [ ] [CF-08](./release-0.9.0-plan.md#cf-08) Production logs, source maps, correlation IDs, and build/startup budgets.
- [ ] [CF-09](./release-0.9.0-plan.md#cf-09) Isolated preview/CI resources, smoke checks, promotion, cleanup, and accurate code/state rollback guidance.
- [ ] [CF-10](./release-0.9.0-plan.md#cf-10) Correct custom-domain/build deployment documentation and tested compatibility baseline.
- [x] [CF-11](./release-0.9.0-plan.md#cf-11) Remove tracked credential values; report any required external credential rotation without exposing values.

## Release gates

- [x] [REL-01](./release-0.9.0-plan.md#rel-01) Fix reports.md issues and verify package/SSG regressions.
- [ ] [REL-02](./release-0.9.0-plan.md#rel-02) Compile documentation examples and validate generated applications and published tarballs.
- [ ] [REL-03](./release-0.9.0-plan.md#rel-03) Run build, root TypeScript command, package type checks, unit tests, and relevant end-to-end/runtime tests.
- [ ] [REL-04](./release-0.9.0-plan.md#rel-04) Update all release versions to 0.9.0, lockfile, changelog, migration guide, and release notes.
- [ ] [REL-05](./release-0.9.0-plan.md#rel-05) Audit every checklist item against implementation and verification evidence before marking the goal complete.

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

### Group 2 start: CLI spec, required bindings, capability model (GLM, 2026-10-02)

- `command-spec.js` (CLI-02/CLI-03): `CommandSpec` declares flags (type,
  aliases), positionals, and forwarding boundaries; `runWithSpec` validates
  before any effect (unknown options list their `--`-prefixed supported
  alternatives; missing/extra positionals fail with stable codes), keeps the
  `help` flag/positional convention, and emits the versioned JSON envelope —
  data handlers, exit-code results, and `{ exitCode, data }` captured-output
  results. 16 commands converted; database cluster commands already emit
  isolated JSON via their child-process path and move to `runWithSpec` later.
  `build`/`ssg` capture child output under `--json` via `runCaptured` so
  stdout carries exactly one envelope. Existing tests updated to the new
  validation contract; new `command-spec.test.js` (10 tests).
- RT-24: `requireBinding`/`requireEnv` + `ConfigBindingError`
  (`COSSACK_BINDING_MISSING`) name the missing binding, list available binding
  names only — secret values never enter diagnostics — and point at
  per-environment Wrangler configuration. Covered in `config.test.ts`.
- RT-25: `runtime-capabilities.ts` models transports, durable realtime
  coordination (binding-gated on `COSSACK_SSE`), process-local realtime,
  scheduled handlers, serverless storage, and filesystem per runtime
  (cloudflare/node/deno/desktop), distinguishing available, missing-binding,
  and unsupported; `describeRuntimeCapabilities`/`formatCapabilityResult`
  expose it for inspection. Covered in `runtime-capabilities.test.ts` (5
  tests). Scaffold/CLI consumption remains open.
- `pnpm --filter cossack exec vitest run` (273 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (554 tests), and
  both packages' `tsc --noEmit` passed.

### Group 1 runtime work: unified RPC contract and realtime recovery (GLM, 2026-10-02)

- RT-01 slice: WebSocket `@Server` calls are now request-scoped RPCs on the
  shared `createRpcCall` contract — correlated `yield`/`done`/`error` frames
  by request id through `executeAction` and both socket runtimes (in-memory
  and Durable Object), cancellation frames that close the server generator,
  forbidden/not-found error frames, and per-socket cancellation registries.
  Explicit service RPC (`/crpc` service envelope) streams generators through
  the same NDJSON response protocol with service state per frame, awaits
  scoped-service disposal on ordinary results (matching component RPC), and
  its client proxy consumes `createRpcCall` with redirects, stream frames,
  cancellation, and RpcError mapping. `@Server({ timeout })` adds client-side
  deadlines on HTTP/SSE, WebSocket, and service calls; expiry rejects with
  `COSSACK_RPC_TIMEOUT` and an unknown-outcome message, never a retry.
  Transport failures reject: unopened sockets `COSSACK_RPC_TRANSPORT_UNAVAILABLE`,
  send failures `COSSACK_RPC_TRANSPORT_FAILED`, socket loss mid-call
  `COSSACK_RPC_TRANSPORT_CLOSED`.
- RT-19: `component.realtime` (sse + per-provider websockets) exposes
  `state`, `attempts`, `lastEventId`, `lastError`, `resynced`; WebSocket
  reconnect uses bounded exponential backoff and never revives sockets closed
  by component disposal; the SSE subscription endpoint announces snapshot
  resynchronization with a `resync` event carrying the cursor.
- CF-06 slice: the generated staging app now exercises credentials
  authentication through the built artifact — D1-backed sessions via
  `@cossackframework/auth` `createAuth`, a login API route, a protected page,
  and authenticated SSE coordinator scope isolation (`user:u1` state separate
  from the anonymous scope). Artifact-level application of the migration
  system is still open, so CF-06 stays unchecked.
- Tests: core `rpc-conformance.test.ts` (WS loopback through the real runtime:
  ordinary/generator/error/cancel/timeout/disconnect/duplicate-consumer,
  service proxy over mocked fetch, protocol helpers) and
  `realtime-recovery.test.ts` (status transitions, backoff bounds and reset,
  no reconnect after disposal); framework service-stream router tests;
  expanded deploy-integration auth assertions.
- `pnpm --filter @cossackframework/core exec vitest run` (638 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (528 tests),
  `pnpm --filter cossack exec vitest run` (263 tests), and core/framework
  `tsc --noEmit` passed.

### DI resolution diagnostics (GLM, 2026-10-02, RT-12 slice)

- Missing `@Inject` declarations now fail with an actionable error: the
  requested service, the requesting component, the active scope chain
  innermost-first (each layout with the services it declares, ending at the
  request root), the `@Page({ services: [...] })` fix, and the
  global-singleton alternative. `ServiceScope.describeScopeChain()` exposes
  the same ancestry for inspection without failing; `resolveDeclared` accepts
  an optional consumer used only for diagnostics.
- specs/service.md now documents the global-singleton versus layout versus
  request ownership table and when each is request-safe.
- RT-12 remains open: SSR, navigation, and explicit service RPC cleanup
  completion parity and inspection that matches actual ownership (CLI-04
  dependency) are not done.
- `pnpm --filter @cossackframework/core exec vitest run` (616 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (526 tests), and
  `pnpm tsc --noEmit` passed.

### Distributed SSE coordinator integration (GLM, 2026-10-02)

- Finished CF-05 from the agent handoff. `SseDurableObject` now publishes an
  explicit RPC surface (`initialize` with a `fresh` flag via `rowsWritten`,
  `currentState`, `updates`, `publish`, `broadcast`, `execute`) with
  first-initialization-wins snapshots, per-scope action serialization through
  an explicit queue, per-frame state publication for RPC streams, pass-through
  for materialized responses, explicit failure for frames without object
  state, and a bounded (128 events / 1 MiB) SQLite event log.
- The neutral router and SSE transport reach the coordinator only through the
  `COSSACK_SSE` binding (a structural stub contract; no `cloudflare:workers`
  imports outside the Cloudflare-only `@cossackframework/framework/SseDurableObject`
  entry). On Cloudflare without the binding, `/crpc`, `/sse`, and SSR fail
  with `COSSACK_SSE_BINDING_MISSING` instead of falling back to
  process-local state; Node and Deno keep the documented process-local
  backend.
- SSR initializes the scope with the rendered public state and hydrates the
  authoritative snapshot on later renders; it never resets shared state.
  `/crpc` executes SSE actions inside the coordinator's serialization slot
  with the request's AsyncLocalStorage snapshot, hydrating from the
  authoritative state — a stale browser snapshot cannot overwrite shared
  state. Middleware, layout DI, ORM scope, rate limits, and the `@Server`
  allowlist are preserved; component broadcasts fan out through the
  coordinator.
- The `/sse` subscription streams the snapshot plus incremental events with
  SSE `id` cursors, resumes from `Last-Event-ID` without replaying observed
  events, resynchronizes from the snapshot when history expired, and
  reconnects by closing the stream on poll failure. Ordinary results,
  redirects, custom Responses, and generators are supported through the
  coordinator.
- Scaffold/template/demo wiring: generated Cloudflare apps declare the
  `COSSACK_SSE` binding with a `new_sqlite_classes` migration and export
  `SseDurableObject` from the Worker entry; the framework library type
  generation includes the binding. New preflight diagnostic
  `COSSACK_ENV_BINDING_NOT_INHERITED` (Cloudflare environments do not inherit
  bindings — re-declare `durable_objects` per environment).
- Tests: two-Worker coordinator integration under workerd (serialization,
  publish/broadcast, disconnected queued caller, invalid frames, history
  bounds with resync, reload persistence, cancel slot release); framework
  router/endpoint tests against a structural fake coordinator (SSR hydration,
  authoritative stale-state protection, redirects, subscriptions,
  Last-Event-ID resume, missing-binding diagnostics); the generated staging
  app now builds and runs with the coordinator and covers shared-state
  continuation, stale client state, redirects, subscriptions, broadcasts, and
  reconnect under workerd. Existing D1/context stream, SSG, and asset checks
  retained.
- Environment note: the workspace `node_modules` pnpm virtual store was found
  emptied (2026-10-02 05:29, before this session); `pnpm install` was rerun
  after removing the stale state markers. The earlier intermittent deploy-test
  build failures came from this broken install, not from source changes.
- `pnpm build`, `pnpm tsc --noEmit`, `pnpm typecheck` (all packages),
  `pnpm audit:bundle` (28 neutral modules; Cloudflare entry Workers-safe), and
  `git diff --check -- . ':!reports.md'` passed after the final documentation
  edits. `pnpm test:unit` passed with 2,137 tests across 12 packages (auth 118,
  renderer 256, database 84, scaffold 82, core 615, node-adapter 10, UI 112,
  framework 526, CLI 263, desktop 16, deno-adapter 3, Studio 52), including
  both real-workerd integration tests.

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
