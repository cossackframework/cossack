# CMS and app builder with FastDB

Status: stages 1 to 4, the [CMS dashboard](cms-dashboard.md) and [appearance](cms-appearance.md)
implemented on branch `cms-foundation`; stages 5 and 6 belong to the Platform repository; stage 7 deferred.
Updated 2026-10-16. See [Outcome](#outcome).

## Products

| Product | Repository | What it is |
| --- | --- | --- |
| CMS | This repository, open source | `@cossackframework/fastdb`, `@cossackframework/cms` and `cossack add cms`. Users download it and deploy anywhere: Workers with FastDB Cloud, or Node.js with `fastdb serve`. |
| Platform | Separate private repository | The app builder. It provisions customers and environments, generates plugins against the CMS plugin architecture, validates them with the CLI, and releases them. It depends on published CMS packages and the CLI, never the reverse. |

## Baseline

| Component | Version |
| --- | --- |
| FastDB engine, CLI, and Node client | 2.8.0, released 2026-10-15 for Linux x64 |
| FastDB Cloud | 0.4.1 beta on engine 2.5.3 |
| Cossack workspace | 0.9.0 |

The CMS targets the latest released engine, 2.8.0, on every profile.
`packages/fastdb` reads `engineVersion`
from database details at preflight and refuses an older or missing value. Cloud
must deploy 2.8.0 before the managed profile works. When FastDB ships a newer
engine, the next CMS release moves to it and documents the upgrade.

## Decisions

- FastDB Cloud is the default database for generated applications. Self-hosted FastDB uses the same CMS data contract.
- The CMS is an opinionated foundation: auth, users, roles, dashboard, data management, sessions, cache policy, files, and extension management. Posts and pages are built-in collections; administrators define others in the dashboard. CRM, tickets, bookings, and other resources have their own schemas.
- The app builder generates and updates plugins against this foundation. A plugin is a coherent feature, not one prompt or one page.
- The framework stays database-agnostic. The CMS reaches FastDB through `packages/fastdb`; the `database` package remains for other applications.
- Plugins are recipes rendered into application source. Builder-generated plugins are trusted build-time modules. A restricted runtime for third-party plugins is deferred.
- Plugins declare schema as data. The CMS plans additive DDL from the live catalog. Renames, backfills, and tightened constraints are explicit steps.
- One Cloud organization per customer. Provisioning, migration, and release state machines run on Cossack Workflows.
- FastDB Cloud has no per-database request limit. Fairness is per-organization admission. Cost is rows read and written.
- The renderer stays `html` templates with `component()`. Its diagnostics, component tags, and the `cossack specs` app model are the [renderer improvements plan](plan-renderer-improvements.md), a prerequisite of stage 2.

## FastDB capabilities

| Capability | CMS use | Rule |
| --- | --- | --- |
| Relational tables and document collections in one database, joined through text record IDs | Relational ledgers and identities; documents for application records | Both need declared schemas and migrations. Document record IDs are immutable. |
| Strict collections, validation, defaults, computed fields, unique indexes | Storage validation generated with forms and input contracts | New constraints can reject existing records. |
| Typed record references and bounded fetching | Owners, related content, resource links | References do not enforce target existence or cascades. |
| Edge tables and bounded `GRAPH(...)` traversal | Relationships with properties and traversal | Endpoint existence and `ON DELETE` rules are enforced. No graph algorithms. |
| BM25 text search and HNSW vector search with an allowed-ID filter | Resource search, optional semantic search | The CMS supplies grants, budgets, and embeddings. The filter is a bound array of at most 4,096 IDs. |
| Indexed spatial queries | Location features | Only the documented Point, Polygon, and MultiPolygon operations. |
| Atomic `/query` batches with durable receipts | One commit for resource, revision, audit, and outbox | 1–32 statements, 64 KiB request, 1,000 rows per result, 256 KiB result JSON, 64 retained receipts. |
| `INFO` inspection and native backup | Schema planning and deployment checks | Backup export is not a Cloud branch. |

The engine has no application identity, roles, triggers, live queries,
changefeeds, or KV/TTL service. Stored JavaScript functions are bounded scalar
functions, not a plugin runtime.

## Ownership

| Owner | Responsibility |
| --- | --- |
| FastDB repository | Publish a portable Web API client and codec for the service protocol, separate from Node journals and native access. Until it does, `packages/fastdb` carries one. |
| `packages/fastdb` | The Web API service-protocol client (2.8.0 behavior), bound into request scopes: configuration, typed mapping, engine preflight, explicit `workLimits`, `warm: false` request defaults, durable pending-write stores (file, Durable Object), and a D1-shaped SQL facade. No CMS policy. |
| `@cossackframework/core/hooks` | Typed local action/filter dispatcher. No database, discovery, or CMS names. |
| `packages/framework`, existing | Compose `src/plugins/*/` into routes, layouts, middleware, translations, assets, and configuration. Emit a static plugin registry. |
| `packages/auth`, existing | Stay FastDB-free. New shared contracts, such as a grant model, are portable interfaces here. |
| `packages/cms` | Resource declarations, schema planner, migration ledger, repositories, authorization, auth integration, FastDB stores, dashboard recipe, host slots, manifests and grants, data operations. |
| `packages/cossack` and `packages/scaffold`, existing | CMS setup, plugin recipe rendering, discovery of installed plugin packages, policy lints, namespaced commands, deployment plans. |
| Platform (private repository) | Customers, projects, apps, environments, per-customer Cloud organizations, generation, validation, releases, credential rotation, and recovery, built on Cossack Workflows. |

Libraries never depend on `framework` or `cms`. This plan triggers the
third-party ecosystem clause of the [service providers decision](service-providers.md);
reopen it in stage 2. The mechanism is recipes rendered at build time, and
nothing scans packages at request time.

The CMS provides FastDB implementations of `AuthSessionStore`, the OAuth state
store, the framework `SessionStore`, `JobStore`, and `NotificationStore`. Each
operation is one atomic request whose affected count is checked.

The 2.8.0 `@fastdb/node/client` exposes `connect`, `info`, `read`, `prepareWrite`,
`submit`, `recover`, `writeAtomic`, `warm`, and `close` with an injectable `fetch`.
It imports `node:crypto`, `node:buffer`, `node:events`, `node:url`, and `node:fs`
for its journal, and it is not on npm. Stage 1 qualifies it on Workers under
`nodejs_compat` or extracts a Web API entry, publishes it, and replaces the file
journal. On a Cloud URL, `connect()` defers the details request and sends a
background `/warm`; request scopes disable that warm and warm from a scheduled path.

## Deployment profiles

### Managed: Workers and FastDB Cloud

One database per application environment, shared by core and plugins. The host
holds a `query`-scope database JWT for its database only. Browsers and plugins
never see it. The control plane rotates grants before expiry and revokes them on
offboarding.

Requested Cloud changes:

| Change | Status |
| --- | --- |
| Deploy engine 2.8.0 and track the latest release | Requested; blocks the managed profile |
| Remove the per-database request limit. Partition admission per organization with 503 and `retry-after`. Count the pre-authentication limiter on authentication failures only, because Workers share egress addresses. Keep a per-organization safety ceiling around 1,000 requests per second | Agreed |
| Replace the shared monthly native execution cap with per-organization allowances by plan | Requested |
| Longer service-grant lifetimes or in-place rotation, and automatic pruning of revoked grants | Requested |
| Raise the `/query` body to about 1 MiB and encode Binary and Vector values as base64 | Requested |
| Per-statement affected-count assertion that rolls back the batch | Requested |
| Subquery as the allowed-ID search filter, evaluated in the same snapshot | Requested |
| Partner API: create organizations in a chosen location, databases, grants, deletion, and customer claim | Requested, stage 5 |
| Create a database from an export archive | Requested, stage 5 |
| Capacity by plan, keep-warm for production databases, regional runtimes | Requested, stage 6 |
| `/migrate` endpoint reusing the native runner | Optional |

The CMS renders a page with as few read batches as possible, caches rendered
data, sends explicit `workLimits`, and treats 503 with `retry-after` as
backpressure with bounded retries.

### Self-hosted: Node and `fastdb serve`

Linux x64, one Cossack Node process, and a colocated `fastdb serve` on loopback
that owns the MVCC file. The operator owns storage, supervision, credentials, and
backups. Cache and SSE are process-local. Files use local storage or S3. Jobs,
notifications, and sessions use the CMS FastDB stores. Replicas are out of scope.
A remote self-hosted database for a Worker needs a separate HTTPS gateway profile
later. Native embedded access stays a separate Node option.

## Data contract

**Resources.** A resource declaration has a stable ID, fields, indexes,
relationships, access policy, and migration history. The host assigns storage
names and reserves its namespace. Relational tables hold users, credentials, auth
sessions, grants, job and notification ledgers, the migration ledger, and the
outbox. Document collections hold application records. Edge tables hold
relationships that need properties, endpoint enforcement, or traversal. Values
that must be replaced atomically, such as session tokens, are mutable fields or
relational keys. Plugins cannot create collections, run DDL, or submit raw FastQL.
Host operations compile to bounded parameterized FastQL and enforce resource,
field, user, tenant, and plugin grants.

**Typed values.** Preserve record identity including string versus integer keys,
int64, explicit floats, vectors, binary, and nesting through the codec. Results
are positional; never collapse duplicate columns. Repositories return explicit
public shapes with a versioned transport representation for values that do not
survive JSON, validated through SSR, hydration, RPC, and plugin boundaries.

**Reads, commits, recovery.** Use `/read` for fresh snapshots with `afterSequence`
as a causal lower bound and explicit `workLimits`. Each mutation is one atomic
batch. No transaction spans requests, and no callback awaits plugin code between
reads and writes. A zero-row statement does not fail a batch, so an optimistic
edit is one conditional statement whose affected count is checked, and dependent
audit and outbox statements carry the same guard until the affected-count
assertion ships. Allocate operation and record IDs before dispatch and persist the
exact request in a durable store on Workers. A timeout after dispatch is an
unknown outcome, recovered by exact ID and body, never by a replacement write.
Receipts cover 64 publications; beyond that, reconcile before writing.
`ifSequence` fences schema and publication changes and can conflict after
unrelated writes.

**Search and graph.** Authorize candidates before returning hits, snippets,
related records, or paths. The allowed-ID filter is a bound array computed in a
separate request, so the search statement's outer query revalidates every hit
against current ownership and grant rows. Larger access domains use separate
collections and indexes per domain, never truncation. Graph authorization covers
every returned node, edge, and field. Bound depth, fan-out, result size, and work,
and deny shapes the host cannot enforce.

## Application services

- **Auth.** Integrate `auth` through CMS repositories. Auth sessions are a relational table keyed by token, so rotation is one conditional update. Test uniqueness, expiry, rotation, revocation, OAuth state consumption, and concurrent updates.
- **Sessions and cache.** The framework session bag needs a field-level update statement. Choose cache providers by declared consistency and atomicity. Document storage is not a lock or a strict limiter.
- **Jobs and notifications.** FastDB relational ledgers with the same lease and fencing semantics as the D1 stores.
- **Files.** Bytes in Cossack object storage, R2 by default. Ownership and metadata in FastDB. Finalization and cleanup are recoverable operations across both.
- **Outbox.** After-commit work, embeddings, webhooks, cache invalidation, and realtime events go through an outbox committed with the mutation and a durable dispatcher. Deliveries repeat, so consumers use idempotency keys.
- **Realtime.** Cossack SSE and WebSocket deliver events. Authenticated SSE revalidates through the auth realtime provider. External writes do not run CMS hooks.

## Hooks and plugins

The core hooks entry is an explicit registry with deterministic order, a
documented error policy, and fresh invocation context. No global mutable
identity, no sandbox, no RPC. The CMS names and versions its extension points.
Before-write filters validate a draft under a deadline before the batch is
prepared. After-commit actions run from the outbox. No external effects inside a
filter.

A plugin package carries a JSON manifest and source and never executes during
installation. `cossack add plugin` renders it through the scaffold recipe engine
into `src/plugins/<name>/`, using the engine's conflict-safe change sets and
upgrade re-rendering. The builder writes generated plugins the same way.
Discovery is a CLI listing of installed packages that declare the manifest field,
read with manifest readers that never execute entrypoints. The manifest declares
compatibility, permissions, hooks, resource declarations, explicit migration
steps, UI contributions, translations, middleware, routes, and commands. The
build emits one static registry.

Rendered plugin source is application source. The security transform and the
route, layout, translation, middleware, and configuration globs extend to
`src/plugins/*/`. The CMS dashboard ships as a recipe the same way, with
library code split into client-safe and server-only entries.

The builder is the trust anchor for generated plugins: manifest validation,
policy lints (no raw FastQL, no undeclared network, no undeclared permissions,
no host secrets), type check, tests, build, and deploy. Each site is its own
Worker. Installing or upgrading a plugin is a new build and deployment.

The deferred restricted runtime for third-party plugins uses isolated server
code on Dynamic Workers, a brokered capability API, immutable validated artifacts,
no ambient credentials, pinned artifact and grant revisions, and a validated
`PluginSurface` UI description with no constructors, closures, raw HTML, or DOM
properties across the isolate.

Plugins contribute namespaced CLI commands whose help and schemas come from
manifests and whose handlers run behind the same permission boundary as the
dashboard. The renderer stays as it is. The CMS shell defines named host slots
that plugins fill with ordinary components.
Plugin UI uses the component tags and diagnostics from the renderer plan, and
`cossack specs` describes the rendered application for the builder.

## Provisioning, migrations, and releases

Create one Cloud organization per customer through the partner API, in the
customer's chosen location, claimable later for direct access and export.
Until the API ships, fixture organizations are created by hand. Provisioning,
migration, and release steps run as Cossack Workflows, idempotent and keyed by
environment ID. Previews use separate databases with seed data until
create-from-archive exists. One Worker per site in a Workers for Platforms
dispatch namespace, with Smart Placement near the Cloud runtime, is a candidate
pending cost review.

The schema planner reads the live catalog through `INFO`, diffs it against
declarations, and generates additive DDL. Renames, backfills, and tightened
constraints are explicit steps with catalog preconditions. The relational
migration ledger records plugin, declaration hash, step version, exact SQL, and
engine version. Each step is one atomic batch sent with `ifSequence` from the
planning read; a conflict re-plans. Upgrades expand before they contract:
generated upgrades are additive, and destructive changes need two releases.

Activate a plugin only when code, schema, and grants are compatible. Added
permissions need a new grant. Disabling revokes execution and grants; data
deletion needs an explicit policy. A code rollback does not undo a migration. A
release record holds the host and CMS versions, plugin artifact hashes, schema
revisions, grants, and the exact engine version.

## Stages

| Stage | Work | Done when |
| --- | --- | --- |
| 1. FastDB connection | Portable client on Workers, published; durable request store; `packages/fastdb` | Typed values, cancellation, read-after-write, rollback, and exact recovery pass on a local 2.8.0 service and, once Cloud runs 2.8.0, on a Cloud database. |
| 2. Extension foundation | After renderer stages 1 to 3: core hooks; plugin recipe rendering and discovery; `src/plugins/*/` composition; static registry; reopen the service providers decision | A plugin rendered from an npm tarball passes SSR, hydration, RPC, stripping, template diagnostics, and upgrade re-rendering with a conflict. Hook order, errors, cancellation, and isolation are tested. |
| 3. CMS vertical slice | Users, auth, sessions, FastDB stores, dashboard recipe, one resource, revisions, audit/outbox, storage, schema planner, migration ledger | The same app runs on Cloud and self-hosted. One declaration yields identical DDL on both. `ifSequence` conflicts re-plan. Concurrent edits, rotation, guarded side effects, and uncertain writes keep invariants. |
| 4. Plugin trust and policy | Manifest validation, policy lints, permissions and grants, host slots, upgrade re-rendering, CLI dispatch | A plugin adds a resource, hook, view, and command. Raw FastQL, undeclared network, and undeclared permissions fail the build. Failed migrations do not activate. |
| 5. App-builder pipeline | Per-customer organizations and environments on Workflows; generate and update plugin recipes; previews; upgrade validation; release records | A generated feature survives a second prompt, a migration failure, a retry, and a restart without duplicates or lost ownership. |
| 6. Managed capacity | Ship the requested Cloud changes; qualify capacity, allowances, provisioning, monitoring, backups, and recovery | Recorded load and failure evidence supports the intended site and preview count. |
| 7. Restricted runtime, deferred | Isolated executor, capability API, `PluginSurface`, runtime registry | Denied access is enforced inside the isolate on both profiles. |

First fixture: a support desk with users and roles, validated tickets, comments
and attachments, text search, optional semantic search, and relationships. A
location fixture follows when spatial is exposed. Fixtures verify that search and
relations do not leak, schema changes roll back together, unknown writes keep
their recovery identity, outbox consumers tolerate duplicates, and requests per
page view stay low. Run type checks and tests during implementation.

## Outcome

| Stage | Delivered | Verified by |
| --- | --- | --- |
| 1 | `@cossackframework/fastdb`: Web API client (no `node:*` imports), `createFastDB` binding with pending-write stores (`FilePendingWriteStore`, `FastDBPendingWrites` Durable Object), `recoverPending`, reconcilers, backpressure retries, opt-in conflict retries, engine preflight, transport codec, `sqlDatabase` | 40 tests: codec and protocol unit tests; a live suite on FastDB 2.8.0 (typed values, cancellation, read-after-write, rollback, `ifSequence`, exact recovery); the same client and Durable Object store inside workerd. Cloud runs 2.5.3, which preflight refuses. |
| 2 | `@cossackframework/core/hooks`; plugin pages, layouts and loading states overlay `src/pages`, plugin catalogs join as `<plugin>::key`, configuration as `<plugin>::<file>`, middleware after the application's; `virtual:cossack-plugins` and `@cossackframework/framework/plugins`; `@cossackframework/scaffold/plugins` with `.cossack/plugins.json`; `cossack add plugin`, `cossack plugins list\|check\|upgrade\|remove` | Hook tests (order, errors, deadlines, cancellation, frozen inputs). A plugin packed by `npm pack` renders without running its scripts and passes template and type checks, SSR, hydration, RPC and client stripping; an edited file that changes upstream is a conflict; a page collision fails the build. Framework suite: 162 files pass. |
| 3 | `@cossackframework/cms`: resources and fields, planner and ledger, repositories with guarded revision/audit/outbox rows, owner-scoped search, users and roles, `createCmsAuth`, auth session, OAuth state and session stores, core SQL ledgers on FastDB, outbox, files. `cossack add cms`: setup, posts at `/posts`, maintenance on cron (Workers) or a timer (Node); the [CMS dashboard](cms-dashboard.md) replaced the first `/cms` shell | 23 live tests (identical DDL on two databases, re-plan after a concurrent write, explicit steps, rollback without activation, one winner for concurrent edits and rotations, no side effects for stale writes, exact recovery, outbox retries per plugin) and 11 unit tests. One generated app passes setup, sign-in, records, conflicts, posts and outbox delivery on Node and on Workers against `fastdb serve`. |
| 4 | Manifest schema (`manifestProblems`, `requestedGrants`), grants in `cms_grants` (an upgrade that requests more needs a new grant), declared-hook and command checks, `context.fetch` limited to granted hosts, host slots `dashboard.nav` and `dashboard.overview`, `/dashboard/plugins`, `cossack/plugin-policy` lints in builds and `cossack plugins check`, `cossack <plugin>:<command>` | A generated app hosts a plugin with a resource, hook, view, slot widget and command; raw FastQL, undeclared network and undeclared permissions each fail the build; the command runs as the signed-in user; a failed migration rolls back and leaves the plugin inactive. |

Findings:

- Workers reject `fetch(..., { redirect: 'error' })`, which `@fastdb/node/client` uses. The
  Cossack client sends `redirect: 'manual'` and refuses 3xx responses.
- The service rejects unused parameters, and `DEFINE FIELD ... DEFAULT $param` reports the
  parameter as unused, so array defaults cannot be declared.
- Concurrent writes to one row fail with a rolled-back `FDB_WRITE_CONFLICT` rather than a
  zero-row update. Repositories report it as a conflict; stores retry it.
- The job and notification ledgers moved from the framework to core as portable SQL stores
  (`createSqlJobStore`, `createSqlNotificationStore`); the D1 names remain.

Requested FastDB changes: publish the Web API client entry; honor `redirect` on Workers;
bind typed `DEFAULT` parameters through the service.

Not yet built in this repository: edge-table relationships and graph authorization,
semantic search, comments and attachments in the support-desk fixture, CMS data export
and import, and deployment plans for releases.

Platform contract. The Platform calls only published interfaces:

| Step | Interface |
| --- | --- |
| Render or upgrade a generated plugin | `addPlugin` / `upgradePlugin` from `@cossackframework/scaffold/plugins` (conflicts are data, never overwritten without `force`) |
| Validate | `manifestProblems` (`@cossackframework/cms`), `lintProjectPlugins` (`cossack/plugin-policy`) or `cossack plugins check --json`, type check, `vite build`, tests |
| Describe the app for generation | `cossack specs --json` |
| Migrate and activate | `cms.plan()`, `cms.migrate()`, `cms.grantPlugin()`, `cms.status()` behind an operator command or the dashboard |
| Define content types | `cms.saveCollection()`, `cms.saveTaxonomy()`; plugin manifests add block types |
| Ship a site design | A plugin with a manifest `theme` field and `templates/` files (or a `ui.ts` `theme` export); `cms.activateTheme()`, `cms.menus` |

## Sources

- Cossack: [architecture](architecture.md), [service providers decision](service-providers.md), [cache](cache.md), [SSE](sse.md), [auth sessions](../packages/auth/src/sessions.ts), [framework sessions](../packages/framework/src/session.ts), [SQL job ledger](../packages/core/src/jobs/sql-store.ts), [security transform](../packages/framework/src/vite-security-plugin.ts), [page globs](../packages/framework/src/vite-plugin.ts), [route discovery](../packages/framework/src/route-codegen.ts), [installed packages](../packages/cossack/src/installed-packages.js), and [scaffold registry](../packages/scaffold/src/registry.js).
- FastDB: [status](../../fastdb/FastDB.md), [FastQL](../../fastdb/FastQL.md), [2.6.0](../../fastdb/turso/fastdb/docs/release-2.6.0.md), [2.7.0](../../fastdb/turso/fastdb/docs/release-2.7.0.md), [2.8.0](../../fastdb/turso/fastdb/docs/release-2.8.0.md), [service protocol](../../fastdb/turso/fastdb/docs/service-protocol.md), [service README](../../fastdb/turso/fastdb/service/README.md), [client types](../../fastdb/turso/fastdb/bindings/node/client.d.ts), [deployment](../../fastdb/turso/fastdb/docs/deployment.md), [language and filtered search](../../fastdb/turso/fastdb/docs/v2.2-language.md), [graph](../../fastdb/turso/fastdb/docs/graph.md), and [migrations](../../fastdb/turso/fastdb/docs/migrations.md).
- FastDB Cloud: [API and limits](../../fastdb/cloud/docs/api.md), [database grants](../../fastdb/cloud/docs/database-jwt.md), [0.4.1 notes](../../fastdb/cloud/docs/release-notes-0.4.1.md), [engine 2.5.3](../../fastdb/cloud/docs/engine-2.5.3-cloud.md), [2026-10-15 changes](../../fastdb/cloud/docs/all-users-20261015.md), [operating limits](../../fastdb/cloud/docs/beta-operating-limits.md), [query budgets](../../fastdb/cloud/docs/query-budgets.md), and [managed files roadmap](../../fastdb/plan-cloud-2.0.md).
