# Cossack 0.9.0 — Unreleased release notes

0.9.0 brings typed application contracts, safer runtime ownership, offline agent
tooling and Cloudflare deployment checks into one release. This document is the
verified release preparation record. Root and package versions are **0.9.0**;
all 58 release tasks are complete within their recorded scope. Packages remain unpublished.

Read the [migration guide](migration-0.9.0.md) before applying scaffold upgrades.
The [checklist](release-0.9.0.md) and [verification archive](release-0.9.0-verification-archive.md)
are the source of truth for acceptance; these notes do not replace them.

## Developer and AI-agent workflows

The CLI now has consistent command-specific validation, help, lifecycle flag
handling, noninteractive behavior and versioned JSON envelopes. Dry-run creation
is read-only. Compiler-backed inspection explains routes, method classification,
source origins and effective application options. Recipes compose resources,
validated mutations, protected routes and scoped services. Upgrade plans expose
dependency changes, file conflicts, preserved files and follow-up work instead
of implying an upgrade is complete after changing dependencies.

Local MCP and CLI tools share inspection and cancellation boundaries. Installed
package discovery reports exports, signatures, native component props and
package-owned usage guides without loading application entrypoints. Offline
coverage distinguishes available guidance from runtime verification. Stored test
results retain the selected run's scope and freshness; development traces join
bounded browser/server observations without storing application payloads.
A stored record is historical evidence, not a live query or a guarantee that
all tests passed.

For an agent working in an application, start with the
[CLI contract](../docs/cossack-cli.md), [local tools](../docs/local-agent-tools.md),
[test evidence](../docs/test-results.md) and [trace guide](../docs/development-traces.md).
Use the installed package's guidance rather than guessing deep imports or treating
a declaration as proof that an API runs on every target.

## Application contracts and runtime ownership

Server actions accept typed input schemas with nested errors and explicit
resource authorization. Public server resources expose pending/error/retry
status and typed refresh/invalidation. Task dependencies are checked against the
component shape, and task-owned commits reject stale/disposed executions. State,
store and computed guidance makes shallow mutation and serialization boundaries
explicit. Optimistic previews, loading and rollback belong to individual calls;
reconnect or cancellation does not replay uncertain mutations.

Generated routes and native API contracts share file identities. URL state covers
search/filter/sort/pagination, while navigation reports completion and cache,
scroll and transition behavior. DI tracks component/service ownership, contextual
resolution failures and cleanup. Development hydration diagnostics name relative
source/field paths without printing state values. SSG emits structured per-route
outcomes, preflights output collisions and keeps private pages out of static
publication. Markdown validates metadata, preserves canonical URLs/static aliases
and isolates locale rendering. Generated configuration and translation declarations
check names and values before factories or requests run. Translation extraction
and catalog checks share CLI/MCP diagnostics. Build-time capability checks reject
unsupported runtime/feature combinations instead of silently changing transport.

See [input](../docs/validation.md), [policies](../docs/authorization.md),
[resources](../docs/server-functions.md), [tasks](../docs/tasks.md),
[optimistic updates](../docs/optimistic.md), [URL state](../docs/url-state.md),
[services](../docs/services.md), [hydration](../docs/hydration.md),
[SSG](../docs/static-site-generation.md), [Markdown](../docs/markdown.md),
[configuration](../docs/config.md) and [localization](../docs/localization.md).

Shared transport contracts now preserve request context, cancellation and
one-time cleanup across supported runtimes. Durable Object publication waits
for initialization/persistence or restoration, so concurrent consumers do not
observe a partially initialized owner. Node development tooling supports
cold upgrades and server reload while Vite owns browser HMR. Generated standalone
Node entries drain accepted HTTP and dispose the runtime within one shared
deadline; embedded imports install no process signal owner. Work that ignores
cancellation may still complete external effects.

## Authentication, forms, data and UI

Shared credentials and session primitives replace duplicated generated auth logic.
Native cookie handling, explicit safe old input, atomic OAuth state consumption,
session rotation and authenticated SSE revalidation have defined concurrency and
replay limits. Resource policies authorize server operations; client visibility
helpers are presentation only.

Native/UI form bindings handle nested arrays/files, keyboard/focus behavior,
validation races, submission ownership and reset. UI contracts cover typed
DataTable inputs, native events/attributes, stable control identity, overlays,
menus, layout, feedback and chat components. The migration guide describes
component-specific changes, including InputOTP, Combobox, DatePicker, modal/menu
ownership, Sidebar, Toast, Carousel and MessageScroller.

Database inspection exposes finalized entity/capability facts and redacted query
structure. Pagination adds primary-key tie breakers where valid; complex pages
require explicit unique ordering. Unsupported provider operations fail before
execution. Migration/seeder planning reads authoritative declarations without
running callbacks, and live plans reject changed target/history/definitions.
Studio and CLI share read-only schema/model/relationship and migration-history
inspection. Published test helpers cover production-fetch/RPC, credentials,
browser hydration/DI and awaitable cleanup.

Read [auth primitives](../docs/auth-primitives.md), [sessions](../docs/session-concurrency.md),
[OAuth](../docs/oauth.md), [forms](../docs/forms.md), [database](../docs/database.md),
[migrations](../docs/migrations.md), [UI migration sections](migration-0.9.0.md#textarea-and-native-select-values)
and [test helpers](../docs/test-utils.md).

## Services and storage

Jobs provide typed payloads, explicit actor/tenant context, retries, delays and
fenced durable D1 ownership with Cloudflare Queues. UTC schedules dispatch through
jobs and deduplicate occurrences. Notifications combine typed escaped templates,
scoped preferences/inboxes and persisted delivery state with explicit Cloudflare
email or Node SMTP providers. Turnstile has an accessible widget and bounded
server verifier; a successful widget never authorizes a mutation.

Cloudflare Workflows integrates typed definitions, native persisted steps/events,
inspection and administrative operations. The separate local test adapter is
process-only. Applications authorize invocation, inspection and event/control
operations and protect side effects with idempotency keys or receipts.

Authorized object storage streams CRUD through local, R2 and S3 providers, with
metadata/progress/cancellation and signed application access. Image requests
validate fit/format/options and require a transform provider for transformations.
Cache and limiter requirements distinguish locality, durability, consistency,
expiry and atomic operations before use.

See [jobs](../docs/jobs.md), [schedules](../docs/schedules.md),
[notifications](../docs/notifications.md), [provider setup](../docs/notification-providers.md),
[Workflows](../docs/workflows.md), [Turnstile](../packages/auth/docs/turnstile.md),
[storage](../docs/storage.md), [images](../docs/images.md),
[cache](../docs/cache.md) and [rate limiting](../docs/rate-limiting.md).

Queue acknowledgements do not establish exactly-once effects. Schedule support
performs no missed-run catch-up. Provider email acceptance is not inbox delivery;
uncertain non-idempotent sends remain unknown. Signed storage URLs still require
current application authorization. Cancellation and multipart cleanup do not
undo an already published object.

## Cloudflare deployment and operations

Environment selection happens before Vite builds and stays consistent through
SSG, bindings, migrations and deployment. Database operations select local/remote
targets explicitly. Required variables/secrets/bindings and generated binding
types are checked without exposing values. Resource plans support authenticated
selection and repeatable local configuration apply, while unsupported discovery
or provisioning returns a precise unresolved action.

Cloudflare SSE uses distributed coordinator state while preserving response-owned
streams. Protected assets retain Worker-first handling and SSG remains public-only.
Failure events carry fixed fields and request IDs; private server maps support
provider diagnostics. Build budgets measure native upload/startup facts where
available, bind supported artifact/tool identities and fail closed when a required
measurement is unavailable. Local dry-run startup evidence is not a provider
startup measurement. Tracked credential values have been removed; required external
credential rotation remains an operator action, distinct from repository cleanup.

Native Worker previews use explicit staging references/secrets and saved immutable
ownership receipts. The reviewed manual CI template installs dependencies before
receiving deployment credentials, preserves journals around cleanup and can restore
an earlier journal for retry. Hosted CI isolation/lifecycle acceptance is still
open. Cleanup retains existing staging D1/KV/R2 resources; branch previews sharing
those references also share data. Production promotion remains a separate reviewed
deployment, with compatible migrations before dependent code. Code rollback does
not restore database rows, object data, Durable Object state or external effects.

Read [deployment](../docs/deployment.md), [resource planning](../docs/cloudflare-resources.md),
[SSE](../docs/sse.md), [failure logging](../docs/server-logging.md),
[build budgets](../docs/build-budgets.md) and [preview lifecycle](../docs/cloudflare-previews.md).

## Breaking changes to review

- **Deno support removed:** the Deno adapter package, `deno` scaffold/CLI adapter,
  `@cossackframework/database/deno` export and `'deno'` runtime name are gone.
  Supported web runtimes are Cloudflare Workers and Node.js. Switch 0.8.x Deno
  applications to the Node adapter before upgrading.
  [Migration](migration-0.9.0.md#deno-support-removed).
- **RPC results and types:** await ordinary results; only generators yield.
  Serialized client types represent Dates as strings and omit native prototypes.
  Invalid JSON/native values and malformed stream completion reject. Use the
  explicit native Response contract for supported HTTP/SSE actions.
  [Migration](migration-0.9.0.md#ordinary-rpc-results-no-longer-appear-as-generator-yields).
- **Input and authorization:** plain action rule maps are removed; typed schemas
  reject unknown fields unless stripping is explicit. Native server/API calls
  still need explicit parsing and authorization. Client/server builds must agree
  on generated contracts. [Migration](migration-0.9.0.md#typed-server-input-contracts).
- **Credentials and sessions:** old password encoding is rejected; migrate known
  records or reset passwords. Apply returned cookie changes after successful
  storage operations. Authenticated SSE needs live validation, OAuth needs atomic
  state consumption, and old input requires explicit public selection.
  [Migration](migration-0.9.0.md#shared-credential-and-session-primitives).
- **Streaming and state:** late headers/cookies reject. Resource hydration includes
  dependency identity; Node socket snapshots use flat public state. Optimistic
  previews are excluded from server input, and uncertain mutations need an
  authoritative read. [Migration](migration-0.9.0.md#typed-server-resources-and-dependency-aware-hydration).
- **Configuration and limits:** required variables/bindings fail before factories;
  invalid limiter/back-end data rejects instead of falling back silently. Durations
  are milliseconds. New framed limiter keys start fresh budgets; coordinate mixed
  versions. Custom storage declarations do not verify remote guarantees.
  [Migration](migration-0.9.0.md#storage-guarantees-and-limiter-key-migration).
- **Migrations and public APIs:** preserve applied definitions/checksums, add new
  operations in new migrations, and never rewrite migration history to bypass a
  mismatch. Use declared public package imports, strict image options and current
  native UI value/event contracts. Scaffold ownership alone does not authorize
  replacing applied migrations or application-owned configuration.
  [Migration-history procedure](migration-0.9.0.md#codex-preserve-applied-generated-migration-definitions-2026-10-06).

## Release status and verification

The implementation includes source, installed-consumer, generated-application,
native runtime and browser evidence. Actual hosted Worker acceptance establishes
failure correlation in native tail/stored Logs, authored-source remapping and
provider startup.

Workflow completion uses the [user-approved scope](release-0.9.0-workflow-acceptance.md):
native local interruption/restart/step reuse/retry/events/failure and real hosted
literal Waiting plus lifecycle checks. The revised full CLI gate passes: 1,267
passed, zero failed, 18 skipped (six Desktop waivers and twelve scoped opt-ins).
Final 0.9.0 builds/types/package units/providers, installed imports/examples,
generated applications/configuration/migrations and affected runtime checks pass.
REL-03/04/05 are complete. [Final verification](release-0.9.0-verification-archive.md#codex-final-release-acceptance-2026-10-09).

Earlier hosted Workflow/preview/staging/logging and 297-case browser receipts
retain their original versions and scope through reviewed unchanged runtime graphs;
they are not claimed as fresh 0.9.0 hosted runs. Owned hosted resources/repositories
were independently confirmed absent. Changed database tooling now activates its
TypeScript loader only on configuration load; guarded import, configuration and
installed migration acceptance pass. Native Cloudflare acceptance uses Wrangler
4.114.0 / plugin 1.47.0 / Vite 8.1.4; the newer 4.148.0 native Workflow failure is
not passing evidence. Ordinary newer-tool generated builds pass separately.

Desktop scope is closed for this release by user decision. Its remaining platform
checks are waived, not passing evidence. Node component/SSE locality and
provider-specific storage/transaction limits remain documented contracts, not
new distributed guarantees.

Current facts and later changes belong in the
[checklist](release-0.9.0.md), [handoff](handoff-0.9.0.md) and
[verification archive](release-0.9.0-verification-archive.md). Release preparation is not approval to publish packages or promote production.
