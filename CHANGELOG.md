# Changelog

## 0.9.0 — 2026-10-10

This release introduces the 0.9.0 framework and developer tooling contracts.
Workspace packages use version 0.9.0; external Solar Icons keeps its existing
version. The [release record](specs/release-0.9.0.md) lists final verification
and the user's Desktop platform waiver.
See the [release notes](specs/release-notes-0.9.0.md) and
[migration guide](specs/migration-0.9.0.md) before upgrading.

### Added

- CLI inspection, checks and explanations built from compiler/scaffold metadata;
  versioned JSON results, fixed diagnostic codes, noninteractive execution,
  conflict-aware upgrades, and complete resource/mutation/protected-route/service
  recipes. [CLI guide](docs/cossack-cli.md).
- Shared local CLI/MCP inspection, installed package signatures and usage guides,
  offline API-family coverage, stored test-result freshness and bounded development
  traces. Discovery reads metadata; it does not execute examples or prove live
  runtime behavior. [Agent tools](docs/local-agent-tools.md),
  [test records](docs/test-results.md), [traces](docs/development-traces.md).
- Typed action input schemas and resource policies; public server-resource
  status/refresh; task dependency types and owned commits; typed routes/API
  contracts and URL state. [Validation](docs/validation.md),
  [authorization](docs/authorization.md), [resources](docs/server-functions.md),
  [tasks](docs/tasks.md), [routing](docs/routing.md), [URL state](docs/url-state.md).
- Native/UI form bindings with nested and file fields, accessible interaction,
  stale-result protection and reset; typed server DataTable and revised native
  component contracts. [Forms](docs/forms.md), [UI guidance](packages/ui/agent-docs.json).
- Read-only database, migration/seeder and Studio inspection; provider capability
  checks, deterministic pagination and declarative SQL plans.
  [Database](docs/database.md), [migrations](docs/migrations.md), [seeders](docs/seeders.md).
- Portable jobs, UTC schedules, notifications, Cloudflare Workflows and Turnstile
  composition. Durable storage and delivery remain explicit provider contracts.
  [Jobs](docs/jobs.md), [schedules](docs/schedules.md),
  [notifications](docs/notifications.md), [Workflows](docs/workflows.md),
  [Turnstile](packages/auth/docs/turnstile.md).
- Authorized streamed object storage through local, R2 and S3 providers; validated
  image options; typed Markdown metadata, static aliases and collision checks.
  [Storage](docs/storage.md), [images](docs/images.md), [Markdown](docs/markdown.md).
- Cloudflare environment/target validation, resource selection plans, required
  secrets, distributed SSE, private server source maps, correlated failure events
  and build/startup budget checks. Native preview CLI and a trusted manual CI
  template include staging secrets and ownership journals. Actual hosted CI proves
  creation, failed-smoke cleanup, cleanup retry and unchanged production. [Deployment](docs/deployment.md),
  [resources](docs/cloudflare-resources.md), [SSE](docs/sse.md),
  [logging](docs/server-logging.md), [budgets](docs/build-budgets.md),
  [previews](docs/cloudflare-previews.md).
- Build-time runtime/feature capability checks and removal of tracked credential
  values. External credential rotation remains an operator action.
- Published production-fetch/RPC, credential, hydration and DI test helpers;
  generated configuration/translation types; request-scoped SSR/SSG locale and
  configuration handling. [Test helpers](docs/test-utils.md),
  [configuration](docs/config.md), [localization](docs/localization.md).

### Changed — migration required

- Ordinary RPC values now arrive at completion rather than as a synthetic
  generator yield. Client result/yield types describe serialized JSON values.
  Invalid payloads and incomplete streaming replies reject. Native Response
  results have an explicit client contract. [RPC migration](specs/migration-0.9.0.md#ordinary-rpc-results-no-longer-appear-as-generator-yields).
- Server action input uses typed schemas; plain action rule maps are removed.
  Unknown object keys reject by default. Native server calls still require
  explicit parsing and authorization. [Input migration](specs/migration-0.9.0.md#typed-server-input-contracts).
- Late headers/cookies and session operations that need headers reject after
  streaming headers commit. Internal service failures stay private in development.
  [Streaming migration](specs/migration-0.9.0.md#streaming-writes-now-reject-after-headers-finalize).
- Password hashes include their algorithm and work factor; the old ambiguous
  encoding is rejected. Generated auth uses shared credential/session primitives.
  Authenticated SSE requires live revalidation, and OAuth requires atomic state
  consumption. Public old input is explicitly selected.
  [Auth migration](specs/migration-0.9.0.md#shared-credential-and-session-primitives).
- Resource hydration carries dependency identity; task/state inheritance retains
  siblings; optimistic previews are owned per call and excluded from server-input
  snapshots. Uncertain mutations require a fresh authoritative read.
  [Resource migration](specs/migration-0.9.0.md#typed-server-resources-and-dependency-aware-hydration),
  [optimistic migration](specs/migration-0.9.0.md#optimistic-call-ownership-and-flat-connection-snapshots).
- Invalid limiter configuration/backend replies fail closed. Durations are
  milliseconds, framed limiter keys start fresh budgets on upgrade, and storage
  requirements reject unknown guarantees. [Limiter/storage migration](specs/migration-0.9.0.md#storage-guarantees-and-limiter-key-migration).
- Generated migrations declare authoritative operations. Preserve every applied
  migration definition and checksum; add new migrations instead of converting
  applied callback history. [Migration-history guidance](specs/migration-0.9.0.md#codex-preserve-applied-generated-migration-definitions-2026-10-06).
- Public route identities, native UI event/value contracts, image options and
  declared package exports are stricter. Port application-owned files deliberately;
  scaffold upgrades preserve them. [Full migration guide](specs/migration-0.9.0.md).

### Removed — migration required

- Deno support is removed; supported web runtimes are Cloudflare Workers and
  Node.js, and Desktop remains a side target. Removed: the
  `@cossackframework/deno-adapter` package; `cossack create --adapter deno`,
  `cossack adapter deno`, the `deno` package-manager option and
  `COSSACK_DENO_BINARY`; the `@cossackframework/database/deno` export (`deno()`,
  `denoSQLite()`, `DenoDriver`, `InjectedDenoDriver`, `DenoSQLiteOptions`);
  `'deno'` in core `RuntimeName` and in framework `ConfigRuntime` and
  configuration requirement `runtimes`; and the renderer `"deno"` export
  condition. Before upgrading, run `cossack adapter node` on 0.8.x, or recreate
  the application with `--adapter node`.
  [Deno migration](specs/migration-0.9.0.md#deno-support-removed).

### Fixed

- Request disconnect/cancellation and disposal ownership; concurrent Durable Object
  initialization/restoration; session/OAuth replay and rotation boundaries.
- Navigation/cache/scroll ownership, realtime resynchronization, optimistic loading
  and rollback, hydration mismatch diagnostics and server-only code stripping.
- Node development reload and cold WebSocket startup; generated standalone
  shutdown drains accepted HTTP and disposes runtime work within one deadline.
- Native UI keyboard/focus/form behavior, chat scrolling and Sidebar ownership;
  package export/dependency and SSG regressions exposed by reports and
  installed-consumer acceptance.

### Limits retained

Cancellation does not undo committed effects. Node SSE and component state
remain process-local. Queue deduplication is not exactly-once delivery. Preview
cleanup retains external staging storage, and code rollback does not restore data.
Desktop's remaining platform checks are waived by the user's release decision,
not reported as passing. See [release scope and verification](specs/release-notes-0.9.0.md#release-status-and-verification).
