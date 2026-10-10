---
title: "Cossack CLI"
description: "Create and manage Cossack projects with the cossack command-line interface."
---

# Cossack CLI

Use the `cossack` command-line interface to create and manage projects. It creates applications, generates pages and components, runs development and build commands, applies database migrations, adds features, optimizes images, and updates framework dependencies.

## Installation

The CLI is an npm package. Run it with `npx`:

```bash
npx cossack <command> [args] [options]
```

### Install globally

```bash
pnpm add -g cossack
# or: npm install -g cossack
```

Make sure that the installation works:

```bash
cossack --version
```

## Usage

```bash
cossack <command> [args] [options]
```

- `cossack` or `cossack --help` lists every command.
- `cossack <command> --help` prints command-specific options.

### Global options

File-changing commands support `--force` and `--dry-run` where documented.
Lifecycle commands (`dev`, `build`, `start`, and `ssg`) forward options to
their underlying tool. Command help is handled before starting that tool.

| Option | Description |
| --- | --- |
| `--force`, `-f` | Overwrite existing files or skip confirmation prompts. |
| `--dry-run` | Show planned changes without writing them. |
| `--json` | Emit a machine-readable result envelope. Dev, start, and Studio emit lifecycle events (see below). |
| `--yes`, `-y` | Apply changes without confirmation (noninteractive mode). |
| `--help`, `-h` | Show help. |
| `--version`, `-V` | Print the CLI version. |

### Machine-readable output contract

Under `--json`, a finite command prints exactly one result envelope on
stdout and nothing else. Dev, start, and Studio use the same envelope for their
lifecycle events:

```json
{ "schemaVersion": 1, "command": "generate", "ok": true,
  "data": { "effects": [{ "action": "planned", "path": "src/components/X.ts" }] },
  "diagnostics": [] }
```

- Success carries `data` (file effects with `created|overwritten|planned|planned-delete|skipped|deleted`
  actions, planned paths for dry runs, structured facts for inspection).
- Failure carries `ok: false`, a nonzero exit code, and `diagnostics` with
  stable codes such as `COSSACK_OPTION_UNKNOWN` (including the supported
  alternatives), `COSSACK_OPTION_VALUE_REQUIRED`, `COSSACK_OPTION_REPEATED`,
  `COSSACK_ARGUMENT_MISSING`, `COSSACK_ARGUMENT_UNEXPECTED`,
  `COSSACK_FILE_EXISTS`, and command-specific failure codes. Human-oriented
  notes go to stderr or are suppressed. They never mix into stdout.
- Exit codes: `0` success, `1` failure, `130` an interactive prompt was
  canceled, or a supervised command was interrupted before completion.
  JSON/non-TTY execution never prompts. Supply required choices or use documented
  defaults. Scaffold creation defaults to Cloudflare/full-stack. Adding a feature
  to an unrecognized legacy project requires an explicit runtime.
- `dev --json` and `start --json` emit newline-delimited JSON. `data.event:
  "started"` confirms child process creation and includes its PID and tool.
  It does not claim HTTP readiness. A clean exit or requested graceful stop
  emits `"stopped"`. Spawn/runtime/shutdown failures emit `"failed"` with
  coded diagnostics and a nonzero exit. SIGINT/SIGTERM requests cleanup.
  Unresponsive children are force-stopped after a bounded grace period.
  Tool argv, URLs, and raw logs do not enter events. `build` and `ssg` emit one envelope
  with `exitCode` and coded failures. Raw project/tool logs are omitted because
  they can contain credentials. Run human mode to inspect those logs locally.
- `studio --json` emits newline-delimited JSON: a `data.event: "ready"`
  envelope after the server starts, then `"stopped"` on clean shutdown or a
  failed envelope with a nonzero exit. A startup failure produces one failed
  envelope. Project logs and launch tokens are isolated in a child process.
  The ready event contains the loopback origin and remote/local selection.
  Studio stays running after readiness. Send SIGINT or SIGTERM to stop it.
  `--timeout <milliseconds>` bounds startup (default 30000, maximum 300000).
  JSON mode never opens a browser. Use human mode to open its authenticated UI.
- JSON execution uses an isolated process with ignored stdin/stdout/stderr.
  Only validated framework envelopes cross IPC. Project imports, inherited
  subprocess logs, thrown connection values, and parser excerpts are excluded.
  Database results use the public command `seeder` for both `seed` and `seeder`,
  with the ORM action in `data.action`. Database failures identify
  `data.phase` and provide a follow-up action. Detailed SQL/cause chains remain
  available in human mode. Public target metadata excludes extra factory fields.
- Finite commands have a default 300000 ms execution deadline. Set
  `COSSACK_COMMAND_TIMEOUT_MS` to an integer from 1 to 86400000 to change it.
  Dev/start have a startup deadline of at most 30000 ms, then run until stopped.
  Studio uses its `--timeout` readiness deadline, also bounded by the execution
  deadline. Deadline failures use `COSSACK_COMMAND_TIMEOUT`. Unexpected process
  exits use `COSSACK_COMMAND_PROCESS_FAILED`. Cancellation reclaims process
  descendants (POSIX process groups, Windows taskkill).
- File-changing dry runs perform no writes: `generate component X --dry-run
  --json` emits planned paths and leaves the filesystem untouched. Deployment
  dry runs write generated types and build artifacts while preventing uploads.

---

## Project lifecycle

### `cossack create <name>`

Scaffold a new Cossack project in a directory named `<name>`. Prompts for the runtime adapter (Cloudflare Workers or Node.js) unless `--adapter` is provided.

```bash
cossack create my-app
cossack create my-app --adapter node --preset full-stack
cossack create my-app --adapter cloudflare --preset minimal --features desktop
```

`cossack create` writes a `.cossack/scaffold.json` manifest used by
`cossack add`, `cossack remove`, `cossack adapter`, and `cossack upgrade`.

Use `--dry-run` to inspect planned files without creating the project or its
manifest. It does not prompt and does not test for CLI updates. Use `--json` for scripts
and coding agents:

```sh
cossack create my-app --adapter node --preset minimal --dry-run --json
```

JSON mode writes one object to stdout with `schemaVersion: 1`, `command`,
`ok`, `data`, and `diagnostics`. Creation data includes the status, public
recipe, project directory, manifest path, and planned file changes. It excludes
generated secret values. Errors use stable diagnostic codes and a nonzero exit
code. JSON mode does not prompt. Specify the desired recipe through flags.
Without a terminal, creation also uses flag values and defaults without prompts.

### `cossack add desktop`

Add the independent Electron target without changing the web adapter. The
command writes `src/desktop/index.ts`, `forge.config.ts`, platform icons,
Electron/Forge dependencies, and `desktop:dev`, `desktop:package`, and
`desktop:make` scripts. Electron installers are built on their native host.

### `cossack inspect routes` and `cossack check routes`

```bash
cossack inspect routes --json
cossack inspect routes /team
cossack check routes --json
```

Inspection lists route facts or explains a selected route. Method facts come
from the compiler: retained client implementations, explicit or automatic RPC,
and stripped methods without RPC registration are separate categories.

Checks return a nonzero exit code when static options are unknown, compiler
method facts are unavailable, or a transport is invalid. JSON diagnostics use
`COSSACK_ROUTE_OPTIONS_UNKNOWN`, `COSSACK_ROUTE_METHODS_UNKNOWN`, or
`COSSACK_ROUTE_TRANSPORT_INVALID` and identify the source file. Unresolved base
declarations produce `COSSACK_ROUTE_INHERITANCE_UNKNOWN`. Unknown declared member
precedence produces `COSSACK_ROUTE_DISPATCH_UNKNOWN`. Inspection can
still succeed for those files and report the available facts.

Functional API modules under `src/pages/api/` are marked
`routeStyle: "http-handlers"`. Recognized named method exports and local default
functions use HTTP without requiring component decorators or a default component
class. Component dispatch/classification fields are `not-applicable`, and layout
service scopes are not applied to these functional routes. These facts describe
source declarations. Inspection does not execute handler factories.

Component pages and layouts include `moduleExport`: `resolved` means its default export
is a local class declaration, `missing` means no default export exists, and
`unknown` means the export cannot be resolved without executing or importing it.
Checks fail with `COSSACK_ROUTE_DEFAULT_EXPORT_MISSING` or
`COSSACK_ROUTE_DEFAULT_EXPORT_UNKNOWN`. A resolved class is not proof that its
constructor or lifecycle succeeds.

Services remain listed as source expressions on their declaring layouts. The
`serviceOwnership` field also uses a static TypeScript source resolver to resolve
identifier/member expressions through import aliases, re-exports and inherited
layout decorators to the class declaration file and line. It does not import or
execute project modules. Each token reports whether an imported core `@Service()`
decorator is declared, missing, or unknown. Static syntax does not prove that
decorator execution or the runtime lifecycle succeeds. Dynamic lookups remain
unknown. Page-level service declarations fail with
`COSSACK_PAGE_SERVICES_UNSUPPORTED`: pages use layout scopes rather than creating
their own. Layout/page middleware counts follow outer-to-inner layout order,
then the page, and exclude global bootstrap middleware. An unknown count makes
the combined total unknown.

Route JSON also includes `scaffold` metadata. Schema-v3 manifests are resolved
through the scaffold recipe registry, including feature dependencies and provider
compatibility. Missing manifests have status `unrecorded`. Malformed or unsupported
manifests have status `invalid` and make the command fail with
`COSSACK_SCAFFOLD_METADATA_INVALID`. Arbitrary manifest fields and secret values
are excluded. Recorded recipes do not prove that generated files are unchanged.

Local base declarations appear under `inheritedDeclarations`, grouped by declaring
class with compiler facts and source locations. They are not flattened into own
methods or presented as a resolved runtime dispatch table. Relative TypeScript imports and explicit re-exports resolve through source files.
Package imports, path aliases, wildcard exports, dynamic bases, and ambiguous
extensionless paths remain unresolved. `declarationDispatch` resolves declared instance-field and prototype precedence,
including overrides and accessor replacement, with declaring owners and sources.
Unknown computed keys, unresolved bases, or constructor parameter properties
produce an unknown result. Erased TypeScript `declare` fields are excluded. Constructor,
decorator, initializer side effects, and later property mutations are not evaluated.
This is not a guarantee of runtime method availability.

These commands do not execute page constructors or server methods. Current
coverage is static metadata only. Inheritance resolution and runtime behavior
are reported as `not-checked`. Success does not prove that the application runs.
Resource macros expose generated RPC method names, resource names, and authored
loader locations. Unsupported resource declarations produce unknown method facts.
Route commands accept `--env <name>` for Cloudflare configuration selection, or
use `CLOUDFLARE_ENV` when the flag is absent. Their `runtime` metadata evaluates
route transports with the shared framework capability model. Missing required
transport bindings or unsupported transports make the command fail. Configuration
presence does not prove that remote resources exist or that adapter setup is correct.
Node supports the `durable-object` transport name through process-local
adapters. This does not provide durable cross-instance coordination.

### `cossack inspect cloudflare` and `cossack check cloudflare`

```sh
cossack inspect cloudflare --env staging --json
cossack check cloudflare --env staging --json
```

These commands use the application's Wrangler to resolve the selected
environment. They report Worker and binding identities, required secret names,
and local configuration diagnostics without building or deploying.
`inspect` returns success when configuration can be read. `check` returns a
nonzero exit code for deployment errors. JSON output marks build and remote
readiness as `not-checked` and omits variable and secret values.

### `cossack deploy`

Build and deploy a Cloudflare application with the project's installed tools:

```sh
cossack deploy --env staging --dry-run --json
```

The environment is selected before Vite builds the application. The CLI tests
configuration, generates binding types, builds, tests the built environment,
and calls Wrangler on that artifact. `--mode` selects a Vite mode independently.
Unlike creation dry runs, deployment dry runs write local build artifacts and
generated types. They test deployment without uploading or provisioning.

`--json` emits one versioned result with diagnostics and step results. Raw tool
output is suppressed. Required remote secrets are not tested during a local
dry run. See [Deployment](./deployment.md) for environment and secret setup.

### `cossack adapter <node|cloudflare>`

Switch an existing schema-v3 scaffolded project to one active runtime. The
command re-renders the complete recorded recipe, previews the change set,
preserves installed features and unrelated local edits, and updates the
manifest and `package.json` runtime metadata.

```bash
cossack adapter node
cossack adapter cloudflare --database=turso
cossack adapter node --database=sqlite --yes
```

Options:

| Option | Description |
| --- | --- |
| `--database <d1\|sqlite\|turso>` | Select a provider supported by the target runtime. Required for non-interactive or dry-run D1 → Node and SQLite → Cloudflare switches. |
| `--yes` | Apply without confirmation. |
| `--dry-run` | Preview every write, deletion, and preserved edit without changing files. |
| `--force` | Replace or delete conflicting runtime/provider-specific files. Unrelated application edits remain protected. |

Turso works with either runtime and is preserved unless another provider is
selected. D1 must change to SQLite or Turso when targeting Node. SQLite must
change to D1 or Turso when targeting Cloudflare. If database support is not
installed, the target runtime default is recorded silently.

Recognized application, OAuth, and Turso values are transferred between `.env`
and `.dev.vars`. Existing target-file values win, and the source file is never
deleted. Local environment files remain gitignored and are not added to the
scaffold manifest.

> The command does not migrate database data. It changes application code and
> configuration only. Deployment resources, D1/SQLite/Turso contents,
> lockfiles, and dependency installation remain your responsibility. After a
> successful switch, run the install command printed by the CLI, configure the
> selected provider, and run `cossack migration up` where appropriate.

### `cossack dev`

Starts the Vite dev server with hot module replacement. This is the default command for local development.

### `cossack build`

Production build. Runs `vite build` followed by `cossack ssg` to pre-render any pages marked `ssg: true`.

### `cossack start`

Starts the production server from the built output (Cloudflare Workers via `wrangler`, or the Node.js adapter).

---

## Code generation

### `cossack generate` (alias: `g`)

Generate a file for a given type. Files are placed following the framework's conventions (pages under `src/pages/`, components under `src/components/`, etc.).

```bash
cossack generate <type> <name> [options]
```

Types and aliases:

| Type | Alias | Target |
| --- | --- | --- |
| `page` | `p` | `src/pages/<name>/index.ts` |
| `layout` | `l` | `src/pages/<segments>/<leaf>/layout.ts` |
| `component` | `c` | `src/components/<Name>.ts` |
| `middleware` | `m` | `src/middlewares/<name>.ts` |
| `service` | `s` | `src/services/<Name>Service.ts` |
| `model` | | `src/models/<Name>.ts` |
| `migration` | | `src/migrations/<timestamp>_<name>.ts` |
| `seeder` | | `src/seeders/<name>.ts` |

Page options:

| Option | Description |
| --- | --- |
| `--head` | Include a `head()` method (SEO) with title/description. |
| `--title <string>` | Set the head `<title>` and the `<h1>`. Implies `--head`. |
| `--description <string>` | Set the head description and a `<p>` under the `<h1>`. Implies `--head`. |
| `--no-index`, `--ni` | Generate a flat `src/pages/<name>.ts` (or `.md`) instead of a directory with `index.ts`. Both resolve to the same route. |

When `--head` is given without `--title`/`--description`, the page name is converted to title case (for example `my-page` → `My Page`).

Examples:

```bash
# A page with SEO head()
cossack g page dashboard --head
# -> src/pages/dashboard/index.ts with head() { return { title: 'Dashboard', description: 'Dashboard' } }

# Custom title and description
cossack g page dashboard --title "Dashboard" --description "Overview of your account"

# Flat page (no folder) — concise for simple pages
cossack g page hello --no-index
# -> src/pages/hello.ts  (route: /hello)

# Nested route + markdown
cossack g page /blog/hello-world.md
# -> src/pages/blog/hello-world/index.md

# A layout colocated with a route section
cossack g layout admin/dashboard
# -> src/pages/admin/dashboard/layout.ts (class DashboardLayout)

# Components, middleware, services, models, migrations, seeders
cossack g component UserCard
cossack g middleware request-logger
cossack g service counter
cossack g model User
cossack g migration create_posts
cossack g seeder posts
```

> The framework's router discovers layouts in `src/pages/**/layout.ts`. Generate layouts under `src/pages/...`. The router does not scan `src/layouts/`.

### `cossack delete` (alias: `d`)

Delete a generated file and clean up its directory if it becomes empty.

```bash
cossack delete page dashboard
cossack d component UserCard
```

---

## Features

### `cossack add <feature>`

Add an opinionated, working feature to the current project. Each feature wires its dependencies, scaffolds the necessary files, and registers middleware in `src/bootstrap/middlewares.ts`.

```bash
cossack add <feature> [options]
```

#### `cossack add database`

Adds `@cossackframework/database`, decorated entities, deterministic migrations and
seeders, `orm.config.ts`, a runtime-specific ORM factory, ORM/session/cache
middleware, and the selected provider binding.

> The Database and Full Stack presets include database support. Use
> this command for Minimal projects or to compose it later.

```bash
cossack add database
cossack add database --database turso
```

#### `cossack add auth`

Adds full working session authentication: `@cossackframework/auth` plus the `database` support it depends on. Generates a `createAuth`-backed `src/auth.ts` (PBKDF2 password hashing, session create/validate/resolve, password-reset helpers), a `Session` model, a real auth guard middleware, and functional login/register/forgot-password/reset-password pages using `@Server` methods and `@Validate` form fields. Registers `auth.middleware` and `authGuard` in `src/bootstrap/middlewares.ts` and wires the Cloudflare `send_email` binding for password-reset emails.

```bash
cossack add auth
cossack add auth --auth-methods credentials,oauth --oauth github,google
```

Options:

| Option | Description |
| --- | --- |
| `--auth-methods <methods>` | `credentials`, `oauth`, or both. |
| `--oauth <providers>` | OAuth providers: `github`, `google`, `gitlab`, `facebook`, `microsoft`. |
| `--database <d1\|sqlite\|turso>` | Database provider, validated against the runtime. |

#### `cossack add dashboard`

Adds the authenticated dashboard shell and every module by default. Select a
subset with `--features`.

```bash
cossack add dashboard
cossack add dashboard --features users,sessions
```

#### `cossack remove <feature>`

Removes a feature and dependent features. Automatically installed
prerequisites are removed when no remaining feature needs them.

```bash
cossack remove dashboard
cossack remove database --dry-run
```

See [Authentication](/docs/authentication.md) and [Social Login](/docs/oauth.md) for the concepts these files implement.

---

## Localization

### `cossack lang`

Manage translation catalogs under `src/lang/`.

```bash
cossack lang publish          # Extract strings and publish the English catalog
cossack lang add fr           # Add a locale catalog (French)
```

See [Localization](/docs/localization.md) for details.

---

## Database lifecycle

### `cossack migration` (alias: `migrate`)

Run deterministic ORM migrations registered by `orm.config.ts`.

```bash
cossack migration up        # Apply all pending migrations
cossack migration down      # Roll back the most recent migration
cossack migration status    # Show applied/pending migrations
cossack migration rehash 0010_create_addresses 0011_create_outreach_records --dry-run
cossack migration rehash 0010_create_addresses 0011_create_outreach_records
cossack migration plan --env staging --target remote --json
```

The database tooling loads TypeScript configuration through `tsx`. Use
`--env` and `--target local|remote` to select the database. `--dry-run` previews
queued migration SQL or generated files without applying them. Incomplete
plans are marked explicitly. See [Migrations](./migrations.md).

JSON database commands run configuration, adapters, and callbacks in a child
process with isolated output. Connection logs, console calls, and subprocess
output cannot mix with the single result on stdout. If the child exits before
returning a result, the command emits `COSSACK_ORM_PROCESS_FAILED`. Run without
`--json` to see raw tool diagnostics. This isolates output and process state.
Application callbacks remain trusted code.

### `cossack seeder` (alias: `seed`)

Run database seeders under `src/seeders/`.

```bash
cossack seeder run
```

See [Database](/docs/database.md), [Queries](/docs/queries.md), [Migrations](/docs/migrations.md), and [Seeders](/docs/seeders.md).

---

## Static site generation

### `cossack ssg`

Pre-render pages decorated with `ssg: true` to static HTML at build time. Run automatically as part of `cossack build`, or standalone for integration into a custom pipeline.

```typescript
@Page({ ssg: true })
export default class About extends Cossack { /* ... */ }
```

See [Static Site Generation](/docs/static-site-generation.md).

---

## Image optimization

### `cossack image optimize`

Scan `src/` for [`<Image>`](/docs/images.md) usages and generate optimized variants next to the originals in `public/`. Useful for hosts without a built-in image CDN (for example the Node.js adapter). ImageMagick must be installed.

```bash
cossack image optimize
cossack image optimize --format avif --quality 85
cossack image optimize --dry-run
```

For each `Image({ src, width })` call with a local asset under `public/`, the command writes a resized variant beside the original. Set `width`. Set `height` to include it in the filename:

```
public/img/hero.png  +  Image({ src: '/img/hero.png', width: 800 })               ->  public/img/hero-800.webp
public/img/hero.png  +  Image({ src: '/img/hero.png', width: 800, height: 600 })  ->  public/img/hero-800x600.webp
```

Options:

| Option | Description |
| --- | --- |
| `--format <webp\|avif>` | Output format (default: `webp`). |
| `--quality <0-100>` | Output quality (default: `80`). |
| `--dry-run` | List the image variants without writing them or launching ImageMagick. |

`--json` reports file effects and optimized/planned/skipped counts. Quality must
be an integer from 0 through 100. Missing sources, unsafe paths, and conversion
failures return coded diagnostics and a nonzero exit. Converter output does not
enter the JSON result. Empty projects succeed without requiring ImageMagick.

Install ImageMagick before you apply an optimization plan:

```bash
# macOS
brew install imagemagick
# Debian/Ubuntu
sudo apt-get install imagemagick
# Windows (Chocolatey)
choco install imagemagick
```

On Cloudflare deployments, prefer runtime resizing via `/cdn-cgi/image/...`. See [Images](/docs/images.md).

---

## Introspection

### `cossack routes`

List all routes discovered in the project (pages, layouts, API routes).

Run `cossack routes --generate` to write `.cossack/routes.ts` before a standalone
TypeScript compile. Use `--generate --dry-run --json` to preview generation without
writes. Plain route inspection stays read-only. JSON output includes the shared
structural manifest and the effective inspection facts.

Markdown requires a recorded scaffold feature or explicit `--markdown` selection.
For a custom processor, configure the same feature in Vite.
See [typed URLs](./routing.md#typed-urls) for imports, parameters, and existing-project setup.

### `cossack info`

Print system and environment information (OS, Node version, package versions) for inclusion in bug reports.

### `cossack version` (alias: `v`)

Print the installed CLI version.

---

## Upgrades

### `cossack upgrade [dir]`

Upgrade Cossack dependencies in the current project and report template drift. The command is non-destructive by default. It updates `package.json`, reinstalls, and prints which scaffolded files have upstream changes. It never overwrites source files unless you opt in.

```bash
cossack upgrade                       # bump deps + print drift report
cossack upgrade --apply-template      # also update files you have NOT edited
cossack upgrade --force               # apply safe updates + restore deleted files
cossack upgrade --force-file <path>   # surgically overwrite one file, even if edited
```

Options:

| Option | Description |
| --- | --- |
| `--tag <latest\|canary\|<version>>` | Version to upgrade to (default: `latest`). |
| `--apply-template` | Update scaffolded files you have not modified. Modified files are always skipped. |
| `--force` | Apply safe updates and restore deleted scaffold files. Locally modified files remain protected. |
| `--force-file <path>` | Force-update one specific file even if you modified it. You can use this option more than once. |
| `--dry-run` | Show planned changes without writing them. |

Drift detection uses the `.cossack/scaffold.json` manifest written at project-creation time, which records a SHA-256 of every scaffolded file. `upgrade` classifies each file as `upToDate`, `canUpdate` (unchanged locally, changed upstream), `canDelete` (unchanged locally and removed upstream), `modified` (you edited it), or `missing` (deleted). You decide which changes the command applies.

Use `cossack upgrade --dry-run --json` to inspect the complete current plan.
It includes dependency updates, additions and removals, selected file writes and
deletions, preserved edits, conflicts, manifest changes, build-setting migration,
installation requirements, and follow-up actions. `--tag` resolves the scaffold
release used for both templates and recipe dependencies. `templateVersion` is
that exact version. Foreign releases are installed into temporary storage with
pnpm and lifecycle scripts disabled, then removed. Dry runs leave all application
files unchanged. pnpm can populate its package cache.

The manifest records `dependencyBaseline` separately from the merged package.
Unchanged owned versions follow the target recipe, including additions, removals,
and moves between dependency sections. Local pins, intentionally deleted
dependencies, and user-added packages remain intact. Existing schema-v3 manifests
without this field reconstruct it from their recorded exact scaffold release.
The plan labels this ownership source as `reconstructed`. An unavailable baseline
or target release fails before project writes. Custom URL/path specifiers are
redacted from JSON plans.

`--apply-template` also deletes unchanged owned files removed by the target
recipe. Edited obsolete files remain preserved conflicts. `--force-file` cannot
replace package/runtime configuration or local secret files. Symbolic links in
owned paths are rejected before effects.

An unknown `--force-file` or an unresolved package version fails before writes.
If an owned file, package, workspace configuration, or ownership manifest changes
during target resolution, the plan fails as stale.
An installation failure returns `status: "partial-failure"`, the changes already
applied, and a retry command. It does not report a successful upgrade. Raw package
manager output stays outside the machine-readable protocol.

---

## Exit codes

Every command returns `0` on success and a non-zero code on failure. The CLI is therefore safe in scripts, CI, and `&&` chains.

Cloudflare `cossack build` and `cossack deploy` can enforce literal project
`cossack.buildBudgets` settings in `package.json`. Machine results report public
measurements without binding output. See [Build budgets](./build-budgets.md).
