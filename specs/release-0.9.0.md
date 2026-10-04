# Cossack 0.9.0 release checklist

This release implements the framework, developer experience, agent tooling,
and Cloudflare work agreed in the feature review. An unchecked item remains
in scope. Package versions change only after implementation and verification.

Read [the detailed implementation plan](./release-0.9.0-plan.md) for each task's
purpose, baseline, approach, dependencies, and acceptance criteria. The task IDs
below link directly to those explanations. Completed items retain a short summary.
Their [completion details and limits](./release-0.9.0-plan-archive.md#codex-completed-handoff-2026-10-04)
remain archived, and the verification log below retains test evidence.

## CLI and agent tooling

- [x] [CLI-01](./release-0.9.0-plan.md#cli-01) Preserve lifecycle flags, dispatch command help, and make creation dry runs read-only.
- [x] [CLI-02](./release-0.9.0-plan.md#cli-02) Validate command-specific flags and reject ambiguous/unknown options consistently.
- [x] [CLI-03](./release-0.9.0-plan.md#cli-03) Versioned JSON output, stable diagnostics, consistent exit codes, and noninteractive behavior across commands.
- [x] [CLI-04](./release-0.9.0-plan.md#cli-04) Inspect/check/explain commands using compiler and scaffold metadata, including source locations and method classification reasons.
- [x] [CLI-05](./release-0.9.0-plan.md#cli-05) Complete resource, validated mutation, protected route, and scoped service recipes with tests and capability checks.
- [x] [CLI-06](./release-0.9.0-plan.md#cli-06) Structured upgrades with dependency changes, conflicts, preserved files, and follow-up actions.
- [ ] [CLI-07](./release-0.9.0-plan.md#cli-07) Local MCP tools sharing inspection, documentation, checks, test results, and trace services with the CLI. Codex (2026-10-04): project-bound stdio inspection, versioned schemas, installed versions, redaction and bounded cancellable workers now pass SDK/CLI parity and lifecycle tests. Documentation, stored test results and devtools trace access remain open. See the [checkpoint](#codex-local-mcp-2026-10-04).
- [ ] [CLI-08](./release-0.9.0-plan.md#cli-08) Installed-version offline AGENTS guide, generated API/component catalog, and executable documentation/skill examples. Codex (2026-10-04): offline installed export-target catalogs, command schemas and packaged/scaffolded guides now share CLI/MCP services. Named-symbol signatures now use a pinned compiler API, with partial results and runtime limits explicit. Wildcard and implicit declaration discovery now preserve exclusions, precedence and partial results. Package-owned route/renderer and four feature-recipe guides compile and execute from installed tarballs. Broader API/component/recipe coverage and runtime guidance remain open. See the [guidance checkpoint](#codex-package-guidance-2026-10-04).

## Runtime and application APIs

- [ ] [RT-01](./release-0.9.0-plan.md#rt-01) Consistent HTTP/SSE/WebSocket RPC promises, results, errors, timeouts, and request IDs; precise serialization diagnostics. Authored inference, JSON wire types, native body completion, shared multipart ownership and a 421-case matrix are verified. Known IDs survive malformed frames; HTTP completion validates EOF before final state hydration. Ordinary JSON/error replies now have bounded strict UTF-8 decoding, validated service/redirect envelopes and correlated diagnostic fields before hydration. Child state stays separate from SSE page snapshots; limits apply to HTTP/socket actions with canonical ownership and correlated denials. Production workerd verifies limited D1 writes and shared layout-service budgets. Native Cloudflare peer/IP/header/custom-key and cross-Worker counter acceptance now passes; Node/Deno pass per-connection contexts. DO counter persistence now survives actual native eviction and Worker reload; concurrent two-Worker counts and spent HTTP/socket budgets pass. Invalid configured stores, first-env ownership and runtime options/counter replies now reject before mutation; the shared matrix has 421 cases. Backend reply bounds/deadlines and explicit cross-Worker coordinator cancellation now pass; cancelled queued callbacks never start. Remaining: actual native pre-header disconnect delivery, arbitrary action deadlines and initialization/restoration concurrency, plus RT-02/RT-14 resource policies and RT-11 session criteria. RT-18 provider contracts are now complete. See the [latest checkpoint](#codex-sse-cancellation-2026-10-03).
- [x] [RT-02](./release-0.9.0-plan.md#rt-02) Validated server actions with input schemas, field errors, and shared resource policies.
- [x] [RT-03](./release-0.9.0-plan.md#rt-03) Public server resource pending/error/retry state and typed refresh/invalidation.
- [x] [RT-04](./release-0.9.0-plan.md#rt-04) State/store/computed guidance and serialization/shallow mutation diagnostics.
- [x] [RT-05](./release-0.9.0-plan.md#rt-05) Typed task dependencies, contextual failures, and cancellation of stale async work.
- [x] [RT-06](./release-0.9.0-plan.md#rt-06) Consistent optimistic updates and rollback under failure, concurrency, and disconnects.
- [x] [RT-07](./release-0.9.0-plan.md#rt-07) Typed routes and API schemas; effective layout, middleware, transport, error, and SSG inspection.
- [x] [RT-08](./release-0.9.0-plan.md#rt-08) Typed URL state for search, filtering, sorting and pagination.
- [x] [RT-09](./release-0.9.0-plan.md#rt-09) Navigation completion and cache/scroll/transition diagnostics.
- [ ] [RT-10](./release-0.9.0-plan.md#rt-10) Typed form controller: values, errors, touched state, submit/reset, and existing validation integration.
- [ ] [RT-11](./release-0.9.0-plan.md#rt-11) Session/flash recipes covering RPC failure, redirects, old input, and rotation. Codex verifies native redirect cookies and old-input consumption, preserves valid flash during background transports/failures, and rejects late rotation/destruction before storage changes. Remaining: secret exclusion, complete recipes, rotation/concurrency semantics, and Workers/realtime acceptance.
- [ ] [RT-12](./release-0.9.0-plan.md#rt-12) DI resolution errors and scope/lifetime inspection with clear global/scoped guidance. GLM implemented contextual resolution failures, scoped disposal, and layout declaration inspection. Codex reviews retain this task open: the AST scanner does not prove runtime/compiler ownership for inheritance and dynamic declarations. Finish compiler-backed ownership inspection and browser navigation lifetime verification.
- [ ] [RT-13](./release-0.9.0-plan.md#rt-13) Auth/OAuth failure diagnostics and reusable credential/session primitives in the auth library.
- [x] [RT-14](./release-0.9.0-plan.md#rt-14) Typed resource authorization policies and client visibility helpers.
- [ ] [RT-15](./release-0.9.0-plan.md#rt-15) Database metadata, relationships, provider capabilities, query diagnostics, pagination, and transactions.
- [ ] [RT-16](./release-0.9.0-plan.md#rt-16) Structured migration/seeder plans including SQL, destructive operations, environment, and target.
- [ ] [RT-17](./release-0.9.0-plan.md#rt-17) Shared Studio/CLI database inspection service.
- [x] [RT-18](./release-0.9.0-plan.md#rt-18) Cache/rate-limit capability checks, consistent TTL units, and transport coverage.
- [x] [RT-19](./release-0.9.0-plan.md#rt-19) Realtime connection state, reconnect/resync, and pending action handling without blind mutation replay.
- [ ] [RT-20](./release-0.9.0-plan.md#rt-20) SSR/hydration diagnostics with component/field/source information and test helpers.
- [ ] [RT-21](./release-0.9.0-plan.md#rt-21) SSG entry/plugin validation, per-route results/timings, and dependency compatibility tests.
- [ ] [RT-22](./release-0.9.0-plan.md#rt-22) Typed markdown frontmatter, route/URL collision checks, and locale static output.
- [ ] [RT-23](./release-0.9.0-plan.md#rt-23) Typed DataTable with server data, filtering, sorting, selection, and pagination; native UI attributes/events and accessibility catalog. Codex (2026-10-04): controlled DataTable, stable selection, public types, SSR, HTTP-backed Chromium keyboard/focus coverage and installed guidance are implemented. Generated Cossack app integration and the broader UI audit remain open. See the [checkpoint](#codex-data-table-2026-10-04).
- [ ] [RT-24](./release-0.9.0-plan.md#rt-24) Inferred configuration factories, required binding validation, and secret redaction. GLM (2026-10-02): `requireBinding`/`requireEnv` fail with `COSSACK_BINDING_MISSING` naming the binding, listing available binding NAMES only (never values, secrets stay redacted), and pointing at per-environment wrangler configuration; remaining: config-path misspelling type tests and registry generation from project configuration.
- [x] [RT-25](./release-0.9.0-plan.md#rt-25) Build-time capability checks across Cloudflare, Node, Deno, and Desktop.
- [ ] [RT-26](./release-0.9.0-plan.md#rt-26) Storage providers for local/R2/S3, uploads/downloads/deletes, signed URLs, progress, metadata, and authorization; image diagnostics.
- [ ] [RT-27](./release-0.9.0-plan.md#rt-27) Localization extraction/checks, placeholder validation, missing/unused keys, and typed translation keys.
- [ ] [RT-28](./release-0.9.0-plan.md#rt-28) Devtools snapshots and timelines with correlation IDs.
- [ ] [RT-29](./release-0.9.0-plan.md#rt-29) Test utilities using real lifecycle/context/auth/DI/SSR/hydration/RPC behavior, published exports, and their own test suite. GLM (2026-10-02): `@cossackframework/test-utils/server` — `withRequestScope` (production request-context ALS + root service scope, awaited disposal, restoration on failure) and `controlledAsync` (settle-once deferred + shared AbortSignal); own suite now runs in root `pnpm test:unit`; remaining: framework-level RPC dispatch fixtures, auth fixtures, hydration helpers, and tarball-import verification.

## New services

- [ ] [SVC-01](./release-0.9.0-plan.md#svc-01) Background jobs with delays, retries, idempotency, failure inspection, and local test adapters.
- [ ] [SVC-02](./release-0.9.0-plan.md#svc-02) Schedules/Cron integration.
- [ ] [SVC-03](./release-0.9.0-plan.md#svc-03) Email/in-app notification templates, preferences, and delivery status using existing SMTP support where applicable.
- [ ] [SVC-04](./release-0.9.0-plan.md#svc-04) Durable multi-step Workflows integration.
- [ ] [SVC-05](./release-0.9.0-plan.md#svc-05) Turnstile component and server token verification.

## Cloudflare deployment

- [ ] [CF-01](./release-0.9.0-plan.md#cf-01) Select environment before Vite build and share it across SSG, bindings, migrations, and deployment.
- [ ] [CF-02](./release-0.9.0-plan.md#cf-02) Explicit local/remote database targets using the existing migration system.
- [x] [CF-03](./release-0.9.0-plan.md#cf-03) Required secret declarations, placeholder checks, environment-specific ignore rules, and deployment binding type generation.
- [ ] [CF-04](./release-0.9.0-plan.md#cf-04) Real resource selection or Wrangler provisioning in place of fake resource IDs.
- [x] [CF-05](./release-0.9.0-plan.md#cf-05) Distributed SSE coordination for cross-request state/broadcasts, retaining per-response streams.
- [x] [CF-06](./release-0.9.0-plan.md#cf-06) Built artifact/workerd tests for authentication, RPC, assets, SSG, bindings, migrations, and realtime.
- [x] [CF-07](./release-0.9.0-plan.md#cf-07) Public-only SSG and correct Worker-first routing for protected assets.
- [ ] [CF-08](./release-0.9.0-plan.md#cf-08) Production logs, source maps, correlation IDs, and build/startup budgets.
- [ ] [CF-09](./release-0.9.0-plan.md#cf-09) Isolated preview/CI resources, smoke checks, promotion, cleanup, and accurate code/state rollback guidance.
- [ ] [CF-10](./release-0.9.0-plan.md#cf-10) Correct custom-domain/build deployment documentation and tested compatibility baseline. Codex continuation (2026-10-02): resolved the development WebSocket crash by keeping Upgrade requests out of the ASSETS bridge; 24 navigation/guard/transition browser tests pass. The installed combination is recorded in deployment docs. Generated guide execution and the complete compatibility acceptance remain open.
- [x] [CF-11](./release-0.9.0-plan.md#cf-11) Remove tracked credential values; report any required external credential rotation without exposing values.

## Release gates

- [x] [REL-01](./release-0.9.0-plan.md#rel-01) Fix reports.md issues and verify package/SSG regressions.
- [ ] [REL-02](./release-0.9.0-plan.md#rel-02) Compile documentation examples and validate generated applications and published tarballs.
- [ ] [REL-03](./release-0.9.0-plan.md#rel-03) Run build, root TypeScript command, package type checks, unit tests, and relevant end-to-end/runtime tests.
- [ ] [REL-04](./release-0.9.0-plan.md#rel-04) Update all release versions to 0.9.0, lockfile, changelog, migration guide, and release notes.
- [ ] [REL-05](./release-0.9.0-plan.md#rel-05) Audit every checklist item against implementation and verification evidence before marking the goal complete.

## Verification log

Record new checkpoints here with exact commands, results and remaining limits.
Focused checks do not replace the final monorepo and runtime release gates.

<a id="codex-auth-form-2026-10-04"></a>
### Codex AuthForm (2026-10-04)

Author: Codex. AuthForm now has a stable required identity, closed native root/form
props, separate controlled/default modes, explicit credential/provider callbacks
and localized labels/errors. Both modes render on the server. Native field labels,
IDs, names and autocomplete are connected. Credentials stay in browser fields;
submission snapshots FormData, including pre-hydration typing and autofill without
input events. No credential values are copied into block reactive state.

The previous handoff incorrectly said PasswordInput's value/onChange props had
been removed; they still exist. AuthForm actually omitted its label ID. Review
also found PasswordInput wrote an empty value when value was omitted. It now
leaves native ownership intact, while parent-controlled values retain their
existing behavior. One composed spread preserves native attributes during fresh
client rendering. Dynamic noscript markup caused a hydration mismatch; a normal
pre-hydration notice now avoids it.

Actions stay disabled until hydration, while fields remain editable. Native POST
and unconditional submit-event prevention avoid accidental credential navigation.
Applications still own no-JavaScript endpoints, authentication, authorization,
sessions and server validation. Signup checks its configured minimum against the
snapshot as well as native attributes: adding minlength after a mode change does
not always invalidate existing values. Login imposes no new minimum policy.

Provider actions are explicit keyed non-submit controls and never send empty
credentials. One pending request disables actions and rejects duplicate submits.
Mode changes and onCleanup abort the owned signal and invalidate late results.
Callback errors remain observed; thrown messages are replaced with safe localized
text. Field errors have descriptions and focus recovery that respects outside
focus. Abort cannot stop ignored I/O or reverse backend effects.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 584 tests
  across 43 files pass. SSR, contract validation and published type failures cover
  identities, mode ownership, callbacks, providers, native targets and labels.
- `pnpm --filter cossack exec vitest run tests/auth-form-browser.test.js tests/ui-ejection.test.js tests/native-controls-browser.test.js tests/native-form-ssr-browser.test.js`:
  44 tests pass. AuthForm runs through published and ejected implementations with
  real Tailwind/HTTP Chromium. Checks include no-JavaScript action disabling,
  pre-hydration edits, native Enter/Space, password reveal, validation, FormData,
  repeated submits, safe errors, focus, external mode changes, provider identity,
  fieldset disabling, unmount/remount, stale results and eventless autofill.
  Existing parent-controlled PasswordInput and native SSR form checks also pass.
  Forty source-ejection checks include strict NodeNext compilation and AuthForm's
  new CLI entry. Ejected blocks use public primitive/type imports.
- Command-spec and command-contract suites passed in the earlier 114-case run;
  its one failing native-controls case was fixed and rerun in the final browser
  command above. No CLI contract failure was suppressed.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed declarations expose both mode
  branches, required callbacks, native targets and public helper types. The
  authored block guide is discoverable; exact AuthForm CLI/MCP output matches.
  Six existing packaged examples compile and execute. Discovery disables Node
  networking; installation can use the registry. No new executable guide example
  or backend authentication acceptance is claimed.

Logs: `/tmp/cossack-auth-form-{build,ui-final,browser-final,types-final,regressions,agent-docs}.log`.
All 65 component foundations plus Icon and AuthForm are reviewed. CommandPalette,
DashboardStat and SettingsPanel remain pending, along with wider generated-app,
backend/session, browser/assistive-technology and runtime gates. RT-23 and
CLI-07/CLI-08 remain open. Status stays 24/58 complete; versions remain 0.8.3.

### Archived checkpoints

Codex compacted the recorded checkpoints on 2026-10-04. Full evidence and limits
remain in the [verification archive](./release-0.9.0-verification-archive.md). Existing checkpoint
anchors below link to those records. Archiving a checkpoint does not complete its
parent task. Status remains 24 complete and 34 open.

| Recorded checkpoint and full evidence |
| --- |
| <a id="codex-icon-2026-10-04"></a>[Codex Icon (2026-10-04)](./release-0.9.0-verification-archive.md#codex-icon-2026-10-04) |
| <a id="codex-message-scroller-2026-10-04"></a>[Codex MessageScroller (2026-10-04)](./release-0.9.0-verification-archive.md#codex-message-scroller-2026-10-04) |
| <a id="codex-chat-display-2026-10-04"></a>[Codex Bubble, Marker and Message (2026-10-04)](./release-0.9.0-verification-archive.md#codex-chat-display-2026-10-04) |
| <a id="codex-attachment-2026-10-04"></a>[Codex Attachment (2026-10-04)](./release-0.9.0-verification-archive.md#codex-attachment-2026-10-04) |
| <a id="codex-carousel-2026-10-04"></a>[Codex Carousel (2026-10-04)](./release-0.9.0-verification-archive.md#codex-carousel-2026-10-04) |
| <a id="codex-toast-2026-10-04"></a>[Codex Toast (2026-10-04)](./release-0.9.0-verification-archive.md#codex-toast-2026-10-04) |
| <a id="codex-sidebar-2026-10-04"></a>[Codex Sidebar (2026-10-04)](./release-0.9.0-verification-archive.md#codex-sidebar-2026-10-04) |
| <a id="codex-resizable-2026-10-04"></a>[Codex Resizable (2026-10-04)](./release-0.9.0-verification-archive.md#codex-resizable-2026-10-04) |
| <a id="codex-table-scroll-area-2026-10-04"></a>[Codex Table and ScrollArea (2026-10-04)](./release-0.9.0-verification-archive.md#codex-table-scroll-area-2026-10-04) |
| <a id="codex-typography-item-2026-10-04"></a>[Codex Typography and Item (2026-10-04)](./release-0.9.0-verification-archive.md#codex-typography-item-2026-10-04) |
| <a id="codex-avatar-2026-10-04"></a>[Codex Avatar and AvatarGroup (2026-10-04)](./release-0.9.0-verification-archive.md#codex-avatar-2026-10-04) |
| <a id="codex-field-empty-2026-10-04"></a>[Codex Field and Empty (2026-10-04)](./release-0.9.0-verification-archive.md#codex-field-empty-2026-10-04) |
| <a id="codex-status-controls-2026-10-04"></a>[Codex Alert, Progress and Spinner (2026-10-04)](./release-0.9.0-verification-archive.md#codex-status-controls-2026-10-04) |
| <a id="codex-display-controls-2026-10-04"></a>[Codex Skeleton, Card, Badge and Kbd (2026-10-04)](./release-0.9.0-verification-archive.md#codex-display-controls-2026-10-04) |
| <a id="codex-layout-controls-2026-10-04"></a>[Codex ButtonGroup, Separator and AspectRatio (2026-10-04)](./release-0.9.0-verification-archive.md#codex-layout-controls-2026-10-04) |
| <a id="codex-breadcrumb-2026-10-04"></a>[Codex Breadcrumb (2026-10-04)](./release-0.9.0-verification-archive.md#codex-breadcrumb-2026-10-04) |
| <a id="codex-pagination-2026-10-04"></a>[Codex Pagination and union prop catalogs (2026-10-04)](./release-0.9.0-verification-archive.md#codex-pagination-2026-10-04) |
| <a id="codex-navigation-menu-2026-10-04"></a>[Codex NavigationMenu (2026-10-04)](./release-0.9.0-verification-archive.md#codex-navigation-menu-2026-10-04) |
| <a id="codex-menubar-2026-10-04"></a>[Codex Menubar (2026-10-04)](./release-0.9.0-verification-archive.md#codex-menubar-2026-10-04) |
| <a id="codex-toggles-2026-10-04"></a>[Codex Toggle and ToggleGroup (2026-10-04)](./release-0.9.0-verification-archive.md#codex-toggles-2026-10-04) |
| <a id="codex-tabs-2026-10-04"></a>[Codex Tabs (2026-10-04)](./release-0.9.0-verification-archive.md#codex-tabs-2026-10-04) |
| <a id="codex-disclosures-2026-10-04"></a>[Codex Accordion and Collapsible (2026-10-04)](./release-0.9.0-verification-archive.md#codex-disclosures-2026-10-04) |
| <a id="codex-command-2026-10-04"></a>[Codex Command (2026-10-04)](./release-0.9.0-verification-archive.md#codex-command-2026-10-04) |
| <a id="codex-alert-dialog-2026-10-04"></a>[Codex AlertDialog (2026-10-04)](./release-0.9.0-verification-archive.md#codex-alert-dialog-2026-10-04) |
| <a id="codex-hover-controls-2026-10-04"></a>[Codex hover controls (2026-10-04)](./release-0.9.0-verification-archive.md#codex-hover-controls-2026-10-04) |
| <a id="codex-websocket-ownership-2026-10-04"></a>[Codex WebSocket ownership (2026-10-04)](./release-0.9.0-verification-archive.md#codex-websocket-ownership-2026-10-04) |
| <a id="codex-runtime-ownership-2026-10-03"></a>[Codex runtime and SSE ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-runtime-ownership-2026-10-03) |
| <a id="codex-same-url-history-2026-10-03"></a>[Codex same-URL history (2026-10-03)](./release-0.9.0-verification-archive.md#codex-same-url-history-2026-10-03) |
| <a id="codex-url-backend-reads-2026-10-03"></a>[Codex URL-state backend reads (2026-10-03)](./release-0.9.0-verification-archive.md#codex-url-backend-reads-2026-10-03) |
| <a id="codex-navigation-diagnostics-2026-10-03"></a>[Codex navigation diagnostics (2026-10-03)](./release-0.9.0-verification-archive.md#codex-navigation-diagnostics-2026-10-03) |
| <a id="codex-route-inheritance-2026-10-03"></a>[Codex route inheritance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-route-inheritance-2026-10-03) |
| <a id="codex-root-ownership-2026-10-03"></a>[Codex root ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-root-ownership-2026-10-03) |
| <a id="codex-inactive-cache-2026-10-03"></a>[Codex inactive cache (2026-10-03)](./release-0.9.0-verification-archive.md#codex-inactive-cache-2026-10-03) |
| <a id="codex-nested-drafts-2026-10-03"></a>[Codex nested drafts (2026-10-03)](./release-0.9.0-verification-archive.md#codex-nested-drafts-2026-10-03) |
| <a id="codex-scope-retirement-2026-10-03"></a>[Codex scope retirement (2026-10-03)](./release-0.9.0-verification-archive.md#codex-scope-retirement-2026-10-03) |
| <a id="codex-render-recovery-2026-10-03"></a>[Codex render recovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-render-recovery-2026-10-03) |
| <a id="codex-draft-isolation-2026-10-03"></a>[Codex draft target isolation (2026-10-03)](./release-0.9.0-verification-archive.md#codex-draft-isolation-2026-10-03) |
| <a id="codex-staged-navigation-2026-10-03"></a>[Codex staged navigation review (2026-10-03)](./release-0.9.0-verification-archive.md#codex-staged-navigation-2026-10-03) |
| <a id="codex-fetch-ownership-2026-10-03"></a>[Codex navigation fetch ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-fetch-ownership-2026-10-03) |
| <a id="codex-terminal-disposal-2026-10-03"></a>[Codex terminal disposal review (2026-10-03)](./release-0.9.0-verification-archive.md#codex-terminal-disposal-2026-10-03) |
| <a id="codex-pending-history-2026-10-03"></a>[Codex checkpoint: pending history and module preflight (2026-10-03)](./release-0.9.0-verification-archive.md#codex-pending-history-2026-10-03) |
| <a id="codex-query-ownership-2026-10-03"></a>[Codex checkpoint: query ownership review (2026-10-03)](./release-0.9.0-verification-archive.md#codex-query-ownership-2026-10-03) |
| <a id="codex-url-state-contracts-2026-10-03"></a>[Codex checkpoint: typed query contracts and destination contexts (2026-10-03)](./release-0.9.0-verification-archive.md#codex-url-state-contracts-2026-10-03) |
| <a id="codex-route-boundaries-2026-10-03"></a>[Codex completion: typed routes and source boundaries (2026-10-03)](./release-0.9.0-verification-archive.md#codex-route-boundaries-2026-10-03) |
| <a id="codex-api-contracts-2026-10-03"></a>[Codex checkpoint: native API contracts and generated declarations (2026-10-03)](./release-0.9.0-verification-archive.md#codex-api-contracts-2026-10-03) |
| <a id="codex-typed-routes-2026-10-03"></a>[Codex checkpoint: generated typed URLs and shared route discovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-typed-routes-2026-10-03) |
| <a id="codex-schema-migration-2026-10-03"></a>[Codex checkpoint: schema-only actions, function fields and private callbacks (2026-10-03)](./release-0.9.0-verification-archive.md#codex-schema-migration-2026-10-03) |
| <a id="codex-resource-policies-2026-10-03"></a>[Codex checkpoint: typed resource policies and trusted action identity (2026-10-03)](./release-0.9.0-verification-archive.md#codex-resource-policies-2026-10-03) |
| <a id="codex-typed-input-2026-10-03"></a>[Codex checkpoint: typed input and private validator dependencies (2026-10-03)](./release-0.9.0-verification-archive.md#codex-typed-input-2026-10-03) |
| <a id="codex-storage-capabilities-2026-10-03"></a>[Codex completion: storage guarantees, limiter policies and provider inspection (2026-10-03)](./release-0.9.0-verification-archive.md#codex-storage-capabilities-2026-10-03) |
| <a id="codex-sse-cancellation-2026-10-03"></a>[Codex continuation: native coordinator cancellation (2026-10-03)](./release-0.9.0-verification-archive.md#codex-sse-cancellation-2026-10-03) |
| <a id="codex-rate-decision-io-2026-10-03"></a>[Codex continuation: bounded counter decisions and cancellation (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rate-decision-io-2026-10-03) |
| <a id="codex-rate-store-contracts-2026-10-03"></a>[Codex continuation: request-owned rate stores and validated counters (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rate-store-contracts-2026-10-03) |
| <a id="codex-rate-window-persistence-2026-10-03"></a>[Codex continuation: persistent Durable Object rate windows (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rate-window-persistence-2026-10-03) |
| <a id="codex-socket-peer-context-2026-10-03"></a>[Codex review: WebSocket peer context and native Cloudflare acceptance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-socket-peer-context-2026-10-03) |
| <a id="codex-rpc-json-envelopes-2026-10-03"></a>[Codex review: ordinary JSON and HTTP failure envelopes (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-json-envelopes-2026-10-03) |
| <a id="codex-rpc-target-limits-2026-10-03"></a>[Codex review: child targets and RPC action limit ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-target-limits-2026-10-03) |
| <a id="codex-rpc-protocol-boundaries-2026-10-03"></a>[Codex review: RPC correlation and terminal response validation (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-protocol-boundaries-2026-10-03) |
| <a id="codex-workers-rpc-acceptance-2026-10-03"></a>[Codex review: built Workers multipart and native RPC acceptance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-workers-rpc-acceptance-2026-10-03) |
| <a id="codex-rpc-multipart-2026-10-03"></a>[Codex review: shared multipart RPC ownership and streaming (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-multipart-2026-10-03) |
| <a id="codex-rpc-native-response-2026-10-03"></a>[Codex review: native HTTP RPC response completion (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-native-response-2026-10-03) |
| <a id="codex-rpc-json-values-2026-10-03"></a>[Codex review: JSON RPC values and client types (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-json-values-2026-10-03) |
| <a id="codex-rpc-conformance-matrix-2026-10-03"></a>[Codex continuation: shared RPC conformance matrix (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-conformance-matrix-2026-10-03) |
| <a id="codex-rpc-response-timing-2026-10-03"></a>[Codex review: RPC response cookies and header timing (2026-10-03)](./release-0.9.0-verification-archive.md#codex-rpc-response-timing-2026-10-03) |
| <a id="codex-authored-rpc-types-2026-10-03"></a>[Codex continuation: authored client RPC types (2026-10-03)](./release-0.9.0-verification-archive.md#codex-authored-rpc-types-2026-10-03) |
| <a id="codex-four-recipe-capabilities-2026-10-03"></a>[Codex completion: four recipes and shared capability planning (2026-10-03)](./release-0.9.0-verification-archive.md#codex-four-recipe-capabilities-2026-10-03) |
| <a id="codex-mutation-browser-recipe-2026-10-03"></a>[Codex continuation: validated mutation and browser acceptance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-mutation-browser-recipe-2026-10-03) |
| <a id="codex-resource-recipe-2026-10-03"></a>[Codex continuation: resource recipe and RT-25 audit (2026-10-03)](./release-0.9.0-verification-archive.md#codex-resource-recipe-2026-10-03) |
| <a id="codex-native-database-capabilities-2026-10-03"></a>[Codex continuation: native database bindings (2026-10-03)](./release-0.9.0-verification-archive.md#codex-native-database-capabilities-2026-10-03) |
| <a id="codex-recipe-requirements-2026-10-03"></a>[Codex continuation: selected recipe requirements (2026-10-03)](./release-0.9.0-verification-archive.md#codex-recipe-requirements-2026-10-03) |
| <a id="codex-bundled-route-exports-2026-10-03"></a>[Codex continuation: bundled route export audit (2026-10-03)](./release-0.9.0-verification-archive.md#codex-bundled-route-exports-2026-10-03) |
| <a id="codex-durable-state-capability-2026-10-03"></a>[Codex continuation: durable page capability (2026-10-03)](./release-0.9.0-verification-archive.md#codex-durable-state-capability-2026-10-03) |
| <a id="codex-node-development-runtime-2026-10-03"></a>[Codex continuation: Node development runtime (2026-10-03)](./release-0.9.0-verification-archive.md#codex-node-development-runtime-2026-10-03) |
| <a id="codex-node-guarded-runtime-2026-10-03"></a>[Codex continuation: guarded Node runtime (2026-10-03)](./release-0.9.0-verification-archive.md#codex-node-guarded-runtime-2026-10-03) |
| <a id="codex-deno-shutdown-2026-10-03"></a>[Codex continuation: Deno shutdown and action lifetime (2026-10-03)](./release-0.9.0-verification-archive.md#codex-deno-shutdown-2026-10-03) |
| <a id="codex-deno-runtime-eviction-2026-10-03"></a>[Codex continuation: Deno runtime eviction (2026-10-03)](./release-0.9.0-verification-archive.md#codex-deno-runtime-eviction-2026-10-03) |
| <a id="codex-runtime-websocket-scopes-2026-10-03"></a>[Codex review: runtime WebSocket service scopes (2026-10-03)](./release-0.9.0-verification-archive.md#codex-runtime-websocket-scopes-2026-10-03) |
| <a id="codex-generated-runtime-builds-2026-10-03"></a>[Codex continuation: generated Node/Deno/Desktop builds (2026-10-03)](./release-0.9.0-verification-archive.md#codex-generated-runtime-builds-2026-10-03) |
| <a id="codex-handler-default-parity-2026-10-03"></a>[Codex review: functional handlers and default component selection (2026-10-03)](./release-0.9.0-verification-archive.md#codex-handler-default-parity-2026-10-03) |
| <a id="codex-recipe-capability-wiring-2026-10-03"></a>[Codex continuation: recipe wiring and environment binding discovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-recipe-capability-wiring-2026-10-03) |
| <a id="codex-page-capability-discovery-2026-10-03"></a>[Codex continuation: shared source parser and page capability discovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-page-capability-discovery-2026-10-03) |
| <a id="codex-schedule-capability-2026-10-03"></a>[Codex review: adapter-dependent schedule capability (2026-10-03)](./release-0.9.0-verification-archive.md#codex-schedule-capability-2026-10-03) |
| <a id="codex-capability-build-2026-10-03"></a>[Codex continuation: selected build capability requirements (2026-10-03)](./release-0.9.0-verification-archive.md#codex-capability-build-2026-10-03) |
| <a id="codex-module-inspection-2026-10-03"></a>[Codex review: module validity and CLI-04 acceptance audit (2026-10-03)](./release-0.9.0-verification-archive.md#codex-module-inspection-2026-10-03) |
| <a id="codex-service-inspection-2026-10-03"></a>[Codex review: executed service inspection acceptance (2026-10-03)](./release-0.9.0-verification-archive.md#codex-service-inspection-2026-10-03) |
| <a id="codex-inspection-acceptance-2026-10-03"></a>[Codex review: combined inspection fixture and middleware order (2026-10-03)](./release-0.9.0-verification-archive.md#codex-inspection-acceptance-2026-10-03) |
| <a id="codex-inherited-options-2026-10-03"></a>[Codex review: inherited options and action receivers (2026-10-03)](./release-0.9.0-verification-archive.md#codex-inherited-options-2026-10-03) |
| <a id="codex-inherited-rpc-2026-10-03"></a>[Codex review: inherited compiler RPC registration (2026-10-03)](./release-0.9.0-verification-archive.md#codex-inherited-rpc-2026-10-03) |
| <a id="codex-runtime-inspection-2026-10-03"></a>[Codex continuation: binding-aware transport inspection (2026-10-03)](./release-0.9.0-verification-archive.md#codex-runtime-inspection-2026-10-03) |
| <a id="codex-declaration-dispatch-2026-10-03"></a>[Codex continuation: declared member precedence (2026-10-03)](./release-0.9.0-verification-archive.md#codex-declaration-dispatch-2026-10-03) |
| <a id="codex-member-facts-2026-10-02"></a>[Codex continuation: compiler member facts for dispatch (2026-10-02)](./release-0.9.0-verification-archive.md#codex-member-facts-2026-10-02) |
| <a id="codex-inspection-integration-2026-10-02"></a>[Codex verification: inspection integration checkpoint (2026-10-02)](./release-0.9.0-verification-archive.md#codex-inspection-integration-2026-10-02) |
| <a id="codex-imported-inheritance-2026-10-02"></a>[Codex continuation: relative imported base declarations (2026-10-02)](./release-0.9.0-verification-archive.md#codex-imported-inheritance-2026-10-02) |
| <a id="codex-local-inheritance-2026-10-02"></a>[Codex continuation: local inheritance declarations (2026-10-02)](./release-0.9.0-verification-archive.md#codex-local-inheritance-2026-10-02) |
| <a id="codex-scaffold-inspection-2026-10-02"></a>[Codex continuation: shared scaffold recipe inspection (2026-10-02)](./release-0.9.0-verification-archive.md#codex-scaffold-inspection-2026-10-02) |
| <a id="codex-resource-inspection-2026-10-02"></a>[Codex continuation: authored resource inspection (2026-10-02)](./release-0.9.0-verification-archive.md#codex-resource-inspection-2026-10-02) |
| <a id="codex-parser-unavailable-2026-10-02"></a>[Codex continuation: remove heuristic route facts (2026-10-02)](./release-0.9.0-verification-archive.md#codex-parser-unavailable-2026-10-02) |
| <a id="codex-static-options-2026-10-02"></a>[Codex review: truthful static option extraction (2026-10-02)](./release-0.9.0-verification-archive.md#codex-static-options-2026-10-02) |
| <a id="codex-namespace-methods-2026-10-02"></a>[Codex review: namespace method decorators (2026-10-02)](./release-0.9.0-verification-archive.md#codex-namespace-methods-2026-10-02) |
| <a id="codex-route-checks-2026-10-02"></a>[Codex continuation: static route checks (2026-10-02)](./release-0.9.0-verification-archive.md#codex-route-checks-2026-10-02) |
| <a id="codex-compiler-facts-2026-10-02"></a>[Codex continuation: compiler-backed own-method inspection (2026-10-02)](./release-0.9.0-verification-archive.md#codex-compiler-facts-2026-10-02) |
| <a id="codex-compiler-preservation-2026-10-02"></a>[Codex review: deep client helper preservation (2026-10-02)](./release-0.9.0-verification-archive.md#codex-compiler-preservation-2026-10-02) |
| <a id="codex-cli-upgrades-2026-10-02"></a>[Codex continuation: complete release-aligned upgrade plans (2026-10-02)](./release-0.9.0-verification-archive.md#codex-cli-upgrades-2026-10-02) |
| <a id="codex-cli-json-2026-10-02"></a>[Codex continuation: complete JSON command contracts (2026-10-02)](./release-0.9.0-verification-archive.md#codex-cli-json-2026-10-02) |
| <a id="codex-cli-metadata-2026-10-02"></a>[Codex continuation: complete CLI validation metadata (2026-10-02)](./release-0.9.0-verification-archive.md#codex-cli-metadata-2026-10-02) |
| <a id="codex-continuation-2026-10-02"></a>[Codex continuation: development upgrades and machine contracts (2026-10-02)](./release-0.9.0-verification-archive.md#codex-continuation-2026-10-02) |
| <a id="codex-review-group3-2026-10-02"></a>[Codex review of GLM command-contract follow-up and Group 3 (2026-10-02)](./release-0.9.0-verification-archive.md#codex-review-group3-2026-10-02) |
| <a id="codex-review-2026-10-02"></a>[Codex review of GLM Groups 1–2 (2026-10-02)](./release-0.9.0-verification-archive.md#codex-review-2026-10-02) |
| <a id="codex-cache-contracts-2026-10-03"></a>[Codex cache contract review — 2026-10-03](./release-0.9.0-verification-archive.md#codex-cache-contracts-2026-10-03) |
| <a id="codex-resource-lifecycle-2026-10-03"></a>[Codex resource lifecycle review — 2026-10-03](./release-0.9.0-verification-archive.md#codex-resource-lifecycle-2026-10-03) |
| <a id="codex-task-ownership-2026-10-03"></a>[Codex typed task ownership review — 2026-10-03](./release-0.9.0-verification-archive.md#codex-task-ownership-2026-10-03) |
| <a id="codex-state-diagnostics-2026-10-03"></a>[Codex state contracts and diagnostics review — 2026-10-03](./release-0.9.0-verification-archive.md#codex-state-diagnostics-2026-10-03) |
| <a id="codex-optimistic-ownership-2026-10-03"></a>[Codex optimistic invocation ownership checkpoint — 2026-10-03](./release-0.9.0-verification-archive.md#codex-optimistic-ownership-2026-10-03) |
| <a id="codex-optimistic-operations-2026-10-03"></a>[Codex explicit optimistic operation checkpoint — 2026-10-03](./release-0.9.0-verification-archive.md#codex-optimistic-operations-2026-10-03) |
| <a id="codex-optimistic-reconciliation-2026-10-03"></a>[Codex review: authoritative optimistic reads (2026-10-03)](./release-0.9.0-verification-archive.md#codex-optimistic-reconciliation-2026-10-03) |
| <a id="codex-optimistic-socket-2026-10-03"></a>[Codex review: native optimistic socket recovery (2026-10-03)](./release-0.9.0-verification-archive.md#codex-optimistic-socket-2026-10-03) |
| <a id="codex-retained-service-loading-2026-10-03"></a>[Codex continuation: retained service consumers and loading (2026-10-03)](./release-0.9.0-verification-archive.md#codex-retained-service-loading-2026-10-03) |
| <a id="codex-optimistic-sse-ordering-2026-10-03"></a>[Codex optimistic SSE ordering and resync (2026-10-03)](./release-0.9.0-verification-archive.md#codex-optimistic-sse-ordering-2026-10-03) |
| <a id="codex-optimistic-completion-2026-10-03"></a>[Codex RT-06 completion and stream ownership (2026-10-03)](./release-0.9.0-verification-archive.md#codex-optimistic-completion-2026-10-03) |
| <a id="codex-navigation-acceptance-2026-10-04"></a>[Codex: RT-08/RT-09 acceptance audit (2026-10-04)](./release-0.9.0-verification-archive.md#codex-navigation-acceptance-2026-10-04) |
| <a id="codex-local-mcp-2026-10-04"></a>[Codex: Local MCP inspection foundation (2026-10-04)](./release-0.9.0-verification-archive.md#codex-local-mcp-2026-10-04) |
| <a id="codex-installed-catalog-2026-10-04"></a>[Codex: Installed-version catalog foundation (2026-10-04)](./release-0.9.0-verification-archive.md#codex-installed-catalog-2026-10-04) |
| <a id="codex-declaration-index-2026-10-04"></a>[Codex: Compiler-backed declaration catalog (2026-10-04)](./release-0.9.0-verification-archive.md#codex-declaration-index-2026-10-04) |
| <a id="codex-export-discovery-2026-10-04"></a>[Codex: Public export and implicit declaration discovery (2026-10-04)](./release-0.9.0-verification-archive.md#codex-export-discovery-2026-10-04) |
| <a id="codex-installed-docs-acceptance-2026-10-04"></a>[Codex: Installed documentation acceptance (2026-10-04)](./release-0.9.0-verification-archive.md#codex-installed-docs-acceptance-2026-10-04) |
| <a id="codex-package-guidance-2026-10-04"></a>[Codex: Package-owned guidance and executable examples (2026-10-04)](./release-0.9.0-verification-archive.md#codex-package-guidance-2026-10-04) |
| <a id="codex-recipe-guidance-2026-10-04"></a>[Codex: Recipe guidance and pure registry declarations (2026-10-04)](./release-0.9.0-verification-archive.md#codex-recipe-guidance-2026-10-04) |
| <a id="codex-prop-catalog-2026-10-04"></a>[Codex: Installed component prop contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-prop-catalog-2026-10-04) |
| <a id="codex-data-table-2026-10-04"></a>[Codex: Controlled DataTable foundation (2026-10-04)](./release-0.9.0-verification-archive.md#codex-data-table-2026-10-04) |
| <a id="codex-data-table-integration-2026-10-04"></a>[Codex: Generated DataTable integration and navigation focus (2026-10-04)](./release-0.9.0-verification-archive.md#codex-data-table-integration-2026-10-04) |
| <a id="codex-native-controls-2026-10-04"></a>[Codex: Typed native controls and mapped prop discovery (2026-10-04)](./release-0.9.0-verification-archive.md#codex-native-controls-2026-10-04) |
| <a id="codex-choice-controls-2026-10-04"></a>[Codex: Themed choice controls and range state (2026-10-04)](./release-0.9.0-verification-archive.md#codex-choice-controls-2026-10-04) |
| <a id="codex-select-values-2026-10-04"></a>[Codex: Dynamic select values (2026-10-04)](./release-0.9.0-verification-archive.md#codex-select-values-2026-10-04) |
| <a id="codex-form-ssr-2026-10-04"></a>[Codex: SSR form controls and focused agent contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-form-ssr-2026-10-04) |
| <a id="codex-input-addons-2026-10-04"></a>[Codex: InputGroup and PasswordInput contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-input-addons-2026-10-04) |
| <a id="codex-input-otp-2026-10-04"></a>[Codex: Native InputOTP contract (2026-10-04)](./release-0.9.0-verification-archive.md#codex-input-otp-2026-10-04) |
| <a id="codex-combobox-2026-10-04"></a>[Codex: Combobox selection and form contract (2026-10-04)](./release-0.9.0-verification-archive.md#codex-combobox-2026-10-04) |
| <a id="codex-multiselect-2026-10-04"></a>[Codex: MultiSelect tags, validation and form values (2026-10-04)](./release-0.9.0-verification-archive.md#codex-multiselect-2026-10-04) |
| <a id="codex-date-controls-2026-10-04"></a>[Codex: Calendar and native DatePicker (2026-10-04)](./release-0.9.0-verification-archive.md#codex-date-controls-2026-10-04) |
| <a id="codex-dialog-controls-2026-10-04"></a>[Codex: native Modal, Sheet and Drawer contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-dialog-controls-2026-10-04) |
| <a id="codex-popover-2026-10-04"></a>[Codex: native Popover contract (2026-10-04)](./release-0.9.0-verification-archive.md#codex-popover-2026-10-04) |
| <a id="codex-action-menus-2026-10-04"></a>[Codex: DropdownMenu and ContextMenu contracts (2026-10-04)](./release-0.9.0-verification-archive.md#codex-action-menus-2026-10-04) |
