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
- `cossack <command>:<subcommand>` is the same as `cossack <command> <subcommand>`, for
  example `cossack image:optimize`. A name with a colon that is not a command runs a
  [plugin command](#cossack-add-plugin) (`cossack <plugin>:<command>`).

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
  defaults. Scaffold creation defaults to Cloudflare/full-stack, and to the
  minimal preset with `--features cms`. Adding a feature
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

The directory name becomes the package name and the Cloudflare Worker name. It must be 1 to 63 lowercase letters, digits and dashes, must start and end with a letter or digit, and must not be a Node.js built-in module name such as `http`. Other names fail with `COSSACK_PROJECT_NAME_INVALID` before any file is written.

```bash
cossack create my-app
cossack create my-app --adapter node --preset full-stack
cossack create my-app --adapter cloudflare --preset minimal --features desktop
```

`cossack create` records the project's recipe in `package.json#cossack` (`features`,
`template`, and `options` that are not the defaults) for `cossack add`,
`cossack remove`, `cossack adapter` and `cossack upgrade`. It records nothing about
the files it wrote: they are yours (see [Upgrading](./upgrading.md)).

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

Options:

| Option | Description |
| --- | --- |
| `--adapter <cloudflare\|node>` | Web runtime adapter (default: `cloudflare`). |
| `--preset <minimal\|database\|auth\|full-stack>` | Application preset (default: `full-stack`, or `minimal` with `--features cms`). |
| `--features <list>` | Features to add to the preset, comma separated (see [`cossack add`](#cossack-add-feature)). |
| `--database <provider>` | `d1`, `sqlite`, `turso`, `postgres`, `mysql`, `hyperdrive-postgres`, `hyperdrive-mysql` or `romedb`, validated against the adapter (default: `d1` on Cloudflare, `sqlite` on Node, `romedb` with `cms`). |
| `--auth-methods <list>` | `credentials`, `oauth`, or both. |
| `--oauth <list>` | OAuth providers: `github`, `google`, `gitlab`, `facebook`, `microsoft`. |
| `--theme <name>` | UI theme: `default`, `neutral`, `zinc`, `stone`, `gray`, `slate`, `blue`, `green` or `red`. |
| `--dashboard-features <list>` | Dashboard modules: `users`, `sessions`, `settings`, `roles` (default: all). |
| `--package-manager <npm\|pnpm\|yarn\|bun>` | Package manager for the printed next steps (default: the one that ran the CLI). |
| `--yes`, `-y` | Accept defaults without prompting. |
| `--force`, `--dry-run`, `--json` | See [Global options](#global-options). |

### `cossack add desktop`

Add the independent Electron target without changing the web adapter. The
command writes `src/desktop/index.ts`, `forge.config.ts`, platform icons,
Electron/Forge dependencies, and `build:desktop`, `desktop:dev`, `desktop:package`, and
`desktop:make` scripts. Electron installers are built on their native host.

### `cossack inspect routes` and `cossack check routes`

```bash
cossack inspect routes --json
cossack inspect routes /team --verbose
cossack check routes --json
```

Inspection lists route facts or explains a selected route; `--verbose` adds route details. Method facts come
from the compiler: retained client implementations, explicit or automatic RPC,
and stripped methods without RPC registration are separate categories.

Checks return a nonzero exit code when static options are unknown, compiler
method facts are unavailable, or a transport is invalid. JSON diagnostics use
`COSSACK_ROUTE_OPTIONS_UNKNOWN`, `COSSACK_ROUTE_METHODS_UNKNOWN`, or
`COSSACK_ROUTE_TRANSPORT_INVALID` and identify the source file. Unresolved base
declarations produce `COSSACK_ROUTE_INHERITANCE_UNKNOWN`. Unknown declared member
precedence produces `COSSACK_ROUTE_DISPATCH_UNKNOWN`. Inspection can
still succeed for those files and report the available facts.

Checks also fail for routes that can never run, with the same diagnostics as
`vite build` and deploy preflight. `COSSACK_TRANSPORT_ROUTE_RESERVED` marks a
page or API route at a framework transport path (`/crpc`, `/upload`, or below
`/sse/` or `/ws/`). `COSSACK_ASSETS_NAMESPACE_RESERVED` marks a route below
`/assets/` or a `public/assets/` directory. A Node project sees them before it
builds.

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

### `cossack check templates`

```bash
cossack check templates
cossack check templates --json --verbose
```

Check every `html` and `svg` template in the project's TypeScript program
(tests and declaration files excluded) and report each problem with its file,
line and column: malformed markup, bindings that render nothing, unknown
attributes, wrong attribute, event and property values, and component tag
props. Errors return a nonzero exit code; warnings do not. `--verbose` also
lists hints, such as a `component()` call that can be a component tag; JSON
reports hints with `info` severity. The Vite build runs the same check. See
[Template checks](/docs/template.md#template-checks).

### `cossack inspect` and `cossack check`: providers, workflows, schedules

```sh
cossack inspect providers --env staging --json
cossack check workflows
cossack check schedules --env production
```

`providers` reports the declared cache and rate limiter backends: units, locality,
persistence, consistency and supported operations; `check providers` fails on invalid
requirements, binding names or limiter selection. `workflows` and `schedules` read the
static manifests of [workflows](/docs/workflows.md) and [schedules](/docs/schedules.md).
Modules are never executed, so dynamic configuration stays unknown. See
[Cache](/docs/cache.md) and [Rate Limiting](/docs/rate-limiting.md).

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

### `cossack preview`

```sh
cossack preview create --account <ID> --name pr-42 [--secrets-file staging.json] [--dry-run]
cossack preview inspect --account <ID>
cossack preview cleanup --account <ID>
```

Deploys a Cloudflare preview with staging bindings after the production build gate,
records what it created in `.cossack/preview.json`, and later inspects or removes it.
Cleanup never deletes storage bound from outside. See
[Cloudflare Previews](/docs/cloudflare-previews.md).

### `cossack resources <plan|apply>`

```sh
cossack resources plan --account <ID> --env staging
cossack resources apply --account <ID> --select resources.json --verify
```

Plans which Cloudflare bindings the project still needs and writes chosen existing
resources into `wrangler.jsonc`. It never creates or deletes cloud resources. See
[Cloudflare Resources](/docs/cloudflare-resources.md).

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
| `--database <provider>` | Select a provider supported by the target runtime: `d1`, `hyperdrive-postgres` or `hyperdrive-mysql` on Cloudflare; `sqlite`, `postgres` or `mysql` on Node; `turso` or `romedb` on both. Required for non-interactive or dry-run switches when the target runtime does not support the current provider. |
| `--yes` | Apply without confirmation. |
| `--dry-run` | Preview every write, deletion, and preserved edit without changing files. |
| `--force` | Replace or delete conflicting runtime/provider-specific files. Unrelated application edits remain protected. |

Turso and RomeDB work with either runtime and are preserved unless another provider is
selected. D1 and Hyperdrive must change to a Node provider when targeting Node. SQLite,
PostgreSQL and MySQL must change to a Cloudflare provider when targeting Cloudflare. If
database support is not installed, the target runtime default is recorded silently.

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

Starts the Vite dev server (`vite dev`) with hot module replacement. This is the default command for local development.

`--env <name>` sets `CLOUDFLARE_ENV` before Vite loads the project configuration. Other
arguments are forwarded to Vite unchanged. `--json` emits lifecycle events (see
[Machine-readable output contract](#machine-readable-output-contract)).

### `cossack build`

Production build. Runs the project's `vite build`. Static site generation is not a separate step: the `cossackSsg()` Vite plugin pre-renders pages marked `ssg: true` (and Markdown pages) inside that build.

`--env <name>` sets `CLOUDFLARE_ENV` before Vite loads the project configuration. Other arguments, such as `--mode`, are forwarded to `vite build` unchanged. When `package.json` declares `cossack.buildBudgets` (or `cossack.auxiliaryBuildBudgets`), the command measures the built Workers against them and fails when a budget is exceeded (see [Build budgets](./build-budgets.md)). `--json` prints one result envelope with `exitCode` instead of Vite's output.

### `cossack start`

Starts the production server from the built output: `wrangler dev` on Cloudflare, or `node dist/server/index.js` on Node.js. Extra arguments are forwarded to that command. `--json` emits lifecycle events.

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

Delete a generated page, component, layout, middleware or service (`p`, `c`, `l`, `m`, `s`), and clean up its directory if it becomes empty.

```bash
cossack delete page dashboard
cossack d component UserCard
```

---

## Features

### `cossack add <feature>`

Add an opinionated, working feature to the current project. Each feature adds its package dependencies and files, and wires them into the application (for example, middleware in `src/bootstrap/middlewares.ts`). Missing prerequisites are added first. The result is recorded in `package.json#cossack`. A file you edited is merged with the feature's change; the command stops when both changed the same lines.

```bash
cossack add <feature> [options]
```

| Feature | Also adds |
| --- | --- |
| `ui` | |
| `database` | |
| `studio` | `database` |
| `auth` | `ui`, `database` |
| `dashboard` | `auth` |
| `markdown` | |
| `examples` | `ui`, `markdown` |
| `desktop` | |
| `resource` | |
| `mutation` | |
| `scoped-service` | |
| `protected-route` | `auth` |
| `jobs` | |
| `turnstile` | `ui` |
| `schedules` | `jobs` |
| `notifications` | `jobs` |
| `workflows` | |
| `cms` | `ui`, `auth`, `dashboard`, `markdown` |

Prerequisites are resolved transitively: `dashboard` also adds `ui` and
`database` through `auth`. With `cms`, `database` uses the `romedb` provider, so
accounts are kept in the CMS's RomeDB database. Files you changed are reported as
conflicts and are not overwritten unless you pass `--force`. Run `pnpm install` afterwards.

`cossack add ui <component>` adds the `ui` feature when it is missing and copies one
UI component (for example `button`, `modal` or `table`) into `src/components/ui/`. `--force` replaces a copy that exists.

`--runtime <cloudflare|node>` names the runtime of a project whose recipe does not
record one. `--yes` applies without prompts; `--dry-run` lists the planned changes.

#### `cossack add cms`

Adds the RomeDB CMS to the `auth` and `dashboard` pages: users, roles and
sessions stored in RomeDB, posts and pages written in a rich text editor that
saves JSON, collections you define in the dashboard (fields and blocks, each in
its own document table), categories, tags and other taxonomies, a media library,
site settings, themes, menus with drag and drop, plugins and the plugin policy
lints. The CMS's pages and modules are not copied into the project: the project mounts them
from the `@cossackframework/cms` package (`package.json#cossack.packages`) and gets
`src/cms.config.ts` (its configuration, which also names the storage for its runtime) and a
workflow for the dashboard's Update button. The sign-in pages and the dashboard are served from
the package too, so the project holds no `src/pages/auth/` or `src/dashboard/` folder (see [CMS](/docs/cms/index.md#what-the-project-holds)). The public site is drawn by the
active theme, a plugin; the default one is served from the package. It serves
collections, term archives, nested pages, `/search`, `/feed`, `/sitemap.xml`,
`/robots.txt` and a content API (`/api/cms/content/<collection>`,
`/api/cms/menus/<location>`, `/api/cms/comments`) that apps write to with
application passwords. Editors schedule entries, share preview links, compare and
restore revisions and recover autosaves; published URLs that change redirect
automatically, and Tools manages redirects and signed webhooks. Comments are
moderated under Comments (Turnstile when `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` are set), patterns are reusable content, and Settings →
Languages publishes translations under `/<code>/`. Staff can sign in with an
authenticator app or a passkey, and General settings can require it. It needs a
RomeDB database, named by `ROMEDB_URL`. On Node the default is a file,
`storage/romedb/app.romedb`, opened in the server's process: no service, port or
token, and one process at a time. A URL with `ROMEDB_TOKEN` reaches `romedb serve`
(to share a live database with Studio) or a RomeDB Cloud database. Workers reach
RomeDB over HTTP: `pnpm dev` starts `romedb serve` for the loopback URL in
`.dev.vars` and passes its token, and production uses RomeDB Cloud. To look into a
file while its app runs, run the app on `romedb serve` instead; a plain copy of a
live file can miss committed writes. The first visit to `/auth/setup` applies the
schema and creates the administrator; it asks for `CMS_SETUP_CODE`. Media goes to
R2 (`MEDIA` binding) on Workers, and to S3 (`S3_BUCKET`) or `MEDIA_DIR` on Node;
images are resized with the Images binding (`IMAGES`) on Workers and `sharp` on
Node. Maintenance runs every minute, publishing scheduled entries and delivering
webhooks.

A project whose `database` feature uses a provider other than `romedb` cannot add
`cms`; create a new project with `--features cms`. The CMS serves the site's
pages, so it cannot be combined with `examples`: `cossack create --features cms`
starts from the minimal preset, and a project with the examples runs
`cossack remove examples` first. Email and password sign-in is always on with `cms`;
`--auth-methods credentials,oauth --oauth github` adds OAuth providers, which
`src/cms.config.ts` lists under `oauth`.

```bash
cossack add cms
pnpm dev   # Node: creates storage/romedb/app.romedb; Workers: starts romedb serve
```

#### `cossack add plugin`

Renders a plugin package (a directory, an `npm pack` tarball or an npm package)
into `src/plugins/<name>/`. The package is read as data and never executed;
npm installs run with `--ignore-scripts`. `cossack plugins list|check|upgrade|remove`
manage rendered plugins, and `cossack <plugin>:<command>` runs a command a
plugin manifest declares. A plugin that asks for unrestricted access can do
anything in the application, so rendering it stops with a danger message until
you accept it: a terminal asks, and anything else needs `--allow-unrestricted`.

Each render says where the plugin's server code runs. On Cloudflare a plugin
with only server code runs isolated in a Worker of its own, and the first one
adds the Worker Loader binding (`LOADER`, Workers Paid) to `wrangler.jsonc`.
`--in-app`, on `add plugin` and `plugins upgrade`, keeps a plugin in the
application instead, and upgrades keep the choice. `cossack plugins list`
shows `isolated` or `in app` for each plugin. See
[Where server code runs](/docs/cms/plugins.md#where-server-code-runs).

```bash
cossack add plugin ./support-desk-1.0.0.tgz
cossack plugins check
cossack plugins upgrade support-desk --source ./support-desk-1.1.0.tgz
CMS_PASSWORD=… cossack support-desk:close-all --email admin@example.com
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

Adds full working session authentication: `@cossackframework/auth` plus the `database` support it depends on. The sign-in pages (login, register, forgot and reset password, two-step sign-in), the `createAuth`-backed auth module (PBKDF2 password hashing, sessions, password reset) and the guard are served from the `@cossackframework/dashboard` package, which the project mounts (`package.json#cossack.packages`). The project gets:

- `src/dashboard.config.ts`: its choices (`authMethods`, `oauth`, the dashboard's `modules` and `navigation`), which the served code reads. A page of something that is off answers 404.
- its schema: the `User`, `Session`, `Role`, `UserRole` and `OAuthAccount` models and their migrations.
- `...authMiddlewares` in `src/bootstrap/middlewares.ts`, and the Cloudflare `send_email` binding for password-reset emails.

To restyle or change one page, copy it into the project with `cossack eject dashboard /auth/login`.

```bash
cossack add auth
cossack add auth --auth-methods credentials,oauth --oauth github,google
```

Options:

| Option | Description |
| --- | --- |
| `--auth-methods <methods>` | `credentials`, `oauth`, or both. |
| `--oauth <providers>` | OAuth providers: `github`, `google`, `gitlab`, `facebook`, `microsoft`. |
| `--database <d1\|sqlite\|turso\|postgres\|mysql\|hyperdrive-postgres\|hyperdrive-mysql\|romedb>` | Database provider, validated against the runtime. A CMS project's database is RomeDB: another one is refused (`COSSACK_CMS_DATABASE`). |

#### `cossack add dashboard`

Adds the authenticated dashboard shell and every module by default. Select a
subset with `--features`.

```bash
cossack add dashboard
cossack add dashboard --features users,sessions
```

Your own screens go in `src/pages/dashboard/` (the layout wraps them; guard them yourself).
To link them in the navigation without replacing the layout, list them in
`src/dashboard.config.ts`:

```ts
import { ChartIcon } from '@cossackframework/solar-icons/chart/line';

export const dashboard: DashboardConfig = {
  modules: ['users', 'sessions', 'settings', 'roles'],
  navigation: [
    // Any signed-in user sees it; `authorization: 'admin'` or `{ permission }` narrows it.
    { id: 'reports', label: 'Reports', href: '/dashboard/reports', icon: { line: ChartIcon },
      children: [{ label: 'Weekly', href: '/dashboard/reports/weekly' }] },
    // Inside the Users group, after its own links.
    { id: 'invites', label: 'Invitations', href: '/dashboard/invites', parent: 'users', authorization: 'admin' },
  ],
};
```

The items appear after the modules and in the Ctrl/Meta+K palette. The layout itself is
`DashboardShell` from `@cossackframework/ui/blocks`: an application with another user store
builds its own layout from it, passing the user, the navigation and the callbacks, and keeps
the shell's later fixes.

#### `cossack remove <feature>`

Removes a feature and dependent features. Automatically installed
prerequisites are removed when no remaining feature needs them.

```bash
cossack remove dashboard
cossack remove database --dry-run
```

See [Authentication](/docs/authentication.md) and [Social Login](/docs/oauth.md) for the concepts these files implement.

---

### `cossack plugins <list|check|upgrade|remove> [name]`

Manages plugins rendered into `src/plugins/<name>/` (render one with
`cossack add plugin <directory|tarball|npm-package>`).

- `list`: rendered plugins, installed plugin packages not rendered yet, and where each runs.
- `check [name]`: the policy lints that builds with the CMS also run.
- `upgrade <name>`: re-renders from the recorded source or `--source`. Edited files are kept;
  an edited file that also changed upstream is a conflict unless you pass `--force`.
  `--in-app` keeps the plugin in the application on Cloudflare. `--allow-unrestricted`
  accepts a new version that starts asking for unrestricted access.
- `remove <name>`: deletes the plugin's unedited files.

See [Plugins](/docs/cms/plugins.md#commands).

## CMS management

### `cossack cms <command>`

Manage a running CMS site through its management API, as a signed-in user:

```bash
cossack cms login --url https://example.com        # email from --email or CMS_EMAIL, password from CMS_PASSWORD or a prompt
cossack cms whoami
cossack cms entries list posts --status draft --json
cossack cms entries search walrus facts --per-page 5
cossack cms entries create posts --set title="Hello" --data @body.json
cossack cms entries publish posts <id> --at 2026-12-01T09:00:00Z
cossack cms notes add posts <id> --body "Shorter title?" --target field:title
cossack cms users create --email grace@example.com --password … --role editor
cossack cms settings set general --set siteTitle="My site"
cossack cms sites create Blog --host blog.example.com
cossack cms mcp                                    # the MCP client configuration for the same site
cossack cms password reset --email you@example.com # recovery mode: a reset link with the site's CMS_RECOVERY_CODE, no login
```

`login` creates an application password through a session and keeps it in
`~/.config/cossack/cms-logins.json` (0600). The address comes from `--url`, `COSSACK_CMS_URL`,
the project's `APP_URL`, then the current login; `COSSACK_CMS_TOKEN` and `COSSACK_CMS_SITE`
override the login for CI. `--site <id>` acts on one site of a network through the network
host. Writes take `--data '{…}'` (`@file`, `@-` for stdin) and `--set field=value`; deletes need
`--yes`; nothing prompts under `--json`, whose `data` is the API's answer. Commands: `login`,
`logout`, `whoami`, `mcp`, `password reset`, `import wxr`, `collections`, `taxonomies`, `terms`,
`entries`, `notes`, `users`, `roles`, `settings`, `media`, `menus`, `locations`, `areas`,
`themes`, `plugins`, `cache purge`, `sites`. `cossack cms --help` lists every verb and option. Failures use `COSSACK_CMS_*` codes
(`COSSACK_CMS_LOGIN_REQUIRED`, `COSSACK_CMS_FORBIDDEN`, `COSSACK_CMS_CONFLICT`,
`COSSACK_CMS_INVALID`, …). The API, every command and the MCP tools are described in
[Management API, CLI and MCP](./cms/api.md).

---

## Localization

### `cossack lang`

Manage translation catalogs under `src/lang/`.

```bash
cossack lang publish          # Write a starter English catalog, wire root.ts and APP_LOCALE
cossack lang add fr           # Add a locale catalog (French) with the English keys
cossack lang extract          # List static __() calls and unresolved keys
cossack lang check            # Validate catalogs, placeholders and source calls
cossack lang types            # Generate .cossack/translations.d.ts
```

`lang init` is an alias of `lang publish`. `lang publish` does not scan your source files. It writes a starter catalog
(`src/lang/en.json` by default, or `--locale <code>`), adds `{{ cossackLang }}`
to `src/root.ts`, and adds `APP_LOCALE` to the `vars` of `wrangler.jsonc` when
that file exists. The `wrangler.jsonc` edit keeps comments and other values.
Use `lang extract` to find the translation calls in your sources.

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

| Subcommand | Description |
| --- | --- |
| `generate <name>` | Generate a migration from the model snapshot diff (`--output <path>`, `--allow-destructive`). |
| `snapshot` | Record the current model metadata as the generation baseline (`--force` replaces it). |
| `squash <name>` | Generate one baseline migration from the current models (`--output <path>`; `--prune` replaces the migration files and barrel). |
| `up` (`latest`) | Apply all pending migrations. |
| `down` | Revert the most recent migration. |
| `status` | List migration state and changed checksums. |
| `rehash <name...>` | Accept the current checksums without running migrations. |
| `check` | Fail unless all migrations are applied and checksums match. |
| `baseline` | Record an existing schema after a clean drift check. |
| `plan` | Preview pending migration SQL without applying it (`--direction up\|down`, default `up`). |

The database tooling loads TypeScript configuration through `tsx`. `--config <path>`
selects another ORM configuration (default: `orm.config.ts`). Use `--env` and
`--target local|remote` (or `--local`, `--remote`) to select the database. `--dry-run` previews
queued migration SQL or generated files without applying them. Incomplete
plans are marked explicitly. See [Migrations](./migrations.md).

JSON database commands run configuration, adapters, and callbacks in a child
process with isolated output. Connection logs, console calls, and subprocess
output cannot mix with the single result on stdout. If the child exits before
returning a result, the command emits `COSSACK_ORM_PROCESS_FAILED`. Run without
`--json` to see raw tool diagnostics. This isolates output and process state.
Application callbacks remain trusted code.

### `cossack seeder` (alias: `seed`)

Run the seeders registered in `orm.config.ts`.

```bash
cossack seeder list
cossack seeder run
cossack seeder run --only users,posts
```

`--only` takes seeder names, comma separated. The database options are the same as for
`cossack migration`.

See [Database](/docs/database.md), [Queries](/docs/queries.md), [Migrations](/docs/migrations.md), and [Seeders](/docs/seeders.md).

---

## Static site generation

### `cossack ssg`

Pre-render pages decorated with `ssg: true` to static HTML. SSG runs inside `vite build` through the `cossackSsg()` plugin, so `cossack build` already does it. `cossack ssg` runs the same `vite build`; use it when a pipeline expects an explicit SSG command.

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

`--verbose` adds route details, and `--env <name>` selects the Cloudflare environment.
Run `cossack routes --generate` to write `.cossack/routes.ts` before a standalone
TypeScript compile. Use `--generate --dry-run --json` to preview generation without
writes. Plain route inspection stays read-only. JSON output includes the shared
structural manifest and the effective inspection facts.

Routes that a mounted package serves are listed with the package's name after the file, and JSON entries carry a `package` field. The generated `.cossack/routes.ts` imports a package's API modules by package specifier (`@cossackframework/cms/app/pages/api/cms/…`), so the file does not change with the package's version or install path.

Markdown requires a recorded scaffold feature or explicit `--markdown` selection.
For a custom processor, configure the same feature in Vite.
See [typed URLs](./routing.md#typed-urls) for imports, parameters, and existing-project setup.

### `cossack config`

Lists the project's configuration factories without running them. `--check --env <name>`
validates their declared requirements against the selected Wrangler variables and
bindings; `--generate` writes `.cossack/config.d.ts` (`--generate --dry-run` previews it). See [Configuration](/docs/config.md).

### `cossack schema <inspect|pull|diff|check>`

Compares the database with the ORM models in `orm.config.ts`. `inspect` reports the physical
schema, `pull` writes models from the database (`--output`, `--force`), `diff` prints the
differences and `check` fails when they differ. `--remote` reads the remote database;
`--allow-destructive` (on `diff` and `check`) accepts drops. The database options are the
same as for `cossack migration`. See
[Migrations](/docs/migrations.md).

### `cossack studio`

Opens Studio, a database inspector on a loopback port, with the project's `orm.config.ts`.
It needs `@cossackframework/studio` (`cossack add studio`).

| Option | Description |
| --- | --- |
| `--port <number>` | Loopback port, 1 to 65535 (default: `4983`). |
| `--driver <name>` | `d1`, `sqlite`, `turso`, `postgres`, `mysql`, `hyperdrive-postgres` or `hyperdrive-mysql`, when detection is not enough. |
| `--remote` | Open the remote D1 database. Requires the D1 driver. |
| `--database <binding>` | The D1 binding or database name. |
| `--env <name>` | Cloudflare environment. |
| `--no-open` | Do not open the browser. |
| `--timeout <ms>` | Startup deadline under `--json` (default: `30000`, at most `300000`). |
| `--dry-run` | Print the resolved options without starting Studio. |

See [Studio](/docs/studio.md).

### `cossack docs`

Reads the installed packages' exports, the CLI command schemas and agent guidance offline.
`--package <name> --symbols` indexes a package's declarations; `--symbol <name>` returns one.
See [Local agent tools](/docs/local-agent-tools.md).

### `cossack traces`

Reads the browser snapshots saved by the opt-in development bridge, the latest by default
(`--session <uuid>` for another). See [Development traces](/docs/development-traces.md).

### `cossack test-results`

Reads the reports `cossack/vitest-reporter` writes to `.vitest/cossack`, the latest run by
default (`--run <uuid>` for another). It succeeds when the report can be read, even if tests
failed. See [Stored test results](/docs/test-results.md).

### `cossack typecheck`

Check the files the mounted packages need, write the generated types, then run the project's TypeScript compiler with `--noEmit`. A project's `typecheck` script is this command.

1. The mounted packages' host files and template. A project behind a package's template stops here with `COSSACK_PACKAGE_HOST_OUTDATED` and the package's steps, as the build does, rather than with the type errors they cause.
2. Cloudflare projects: `wrangler types`, which writes `worker-configuration.d.ts` from `wrangler.jsonc`.
3. `.cossack/routes.ts`: the typed URLs of the project's pages and of the pages a mounted package serves.
4. `.cossack/config.d.ts`: the keys and types of `config()`.
5. `tsc --noEmit`.

A clean checkout has none of the generated files, and the command needs no build to write them. When a release adds a generated file, the command writes it: the project's script does not change.

### `cossack specs`

```bash
cossack specs --output app-model.json
cossack specs --schema
```

Print the app model as one versioned JSON document: routes and layouts, every
application class (decorators, props, state, server and client methods,
`server$` resources, injected services and comments), and one UI tree per
`render()` with element, component, control, text and expression nodes.
Expressions carry their source text and TypeScript type. Project modules are
never executed. `--output <file>` writes the document to a file, and `--env <name>` selects
the Cloudflare environment. `--schema` prints the document's JSON Schema;
`@cossackframework/core/app-model` exports the schema, its types and
`validateAppModel()`.

### `cossack info`

Print system and environment information (OS, Node version, package versions) for inclusion in bug reports.

### `cossack version` (alias: `v`)

Print the installed CLI version.

---

## Upgrades

### `cossack upgrade [dir]`

Update a project to a release with one command. It moves the Cossack dependencies to the release and reinstalls. It does not compare or change the project's own files: the packages a project mounts (the CMS, the sign-in pages and dashboard) serve what a release changes.

```bash
cossack upgrade                       # update dependencies, install, merge ejected copies and plugins
cossack upgrade --dry-run             # show the plan and write nothing
cossack upgrade --conflicts=markers   # write both versions into a conflicting copy
```

| Option | Description |
| --- | --- |
| `--tag <latest\|canary\|<version>>` | Version to upgrade to (default: `latest`). |
| `--dry-run` | Show planned changes without writing them. |
| `--conflicts=markers` | Write git-style conflict markers into an ejected copy or a plugin file whose merge conflicts. Without it the file is not changed. |

What it does, in order:

1. **Dependencies.** The versions the recipe owns follow the release, with additions, removals and moves between dependency sections. What the recipe owns is what the release your project declares renders for it; local pins, dependencies you deleted and packages you added stay, and the plan lists them. A project without a recipe (`package.json#cossack.features`) gets only its Cossack packages moved.
2. **`pnpm-workspace.yaml`.** The release's keys (build approvals, overrides) go over the file; your own stay. A file with nothing to add keeps its text.
3. **The install.**
4. **Host modules.** A module a mounted package needs and the project lacks (`cossack.host`) is written, and so is a file a newer template adds (`cossack.hostFiles`): a folder only when the project has none. An existing file is never replaced.
5. **Host steps.** When a package needs a change in one of your files, the upgrade lists it (`cossack.hostSteps`). The build and `cossack typecheck` then stop with `COSSACK_PACKAGE_HOST_OUTDATED` and the same list until you make the change and set `cossack.template` in `package.json` to the version the message names.
6. **Ejected copies and plugins.** The package's new text is merged into each file copied with `cossack eject`, and each plugin that came from an npm package is rendered again from its installed version. A plugin rendered from a folder or a tarball is skipped: run `cossack plugins upgrade <name> --source <new source>` for it.

A copy whose merge conflicts is kept as it is and listed. To resolve it, edit the file by hand, or run `cossack upgrade --conflicts=markers` and edit between the markers:

```
<<<<<<< yours
...
||||||| base
...
=======
...
>>>>>>> <package> <version>
```

While a copy still contains marker lines, `cossack upgrade` stops with `COSSACK_UPGRADE_UNRESOLVED_CONFLICT`. The command exits with 0 when it lists conflicts, so a pipeline can open a pull request with the plan.

Use `cossack upgrade --dry-run --json` to inspect the complete plan: dependency updates, additions and removals, preserved edits, the build-setting migration, the ejected copies with what a merge does to each, whether the recipe moves into `package.json`, installation requirements and follow-up actions. `--tag` resolves the release; `templateVersion` is that exact version. Foreign releases are installed into temporary storage with pnpm and lifecycle scripts disabled, then removed. Dry runs leave all application files unchanged. pnpm can populate its package cache.

An unresolved package version or an unavailable release fails before writes. If `package.json`, `pnpm-workspace.yaml` or `.cossack/scaffold.json` changes during target resolution, the plan fails as stale. Symbolic links in those paths are rejected before effects. Custom URL and path specifiers are redacted from JSON plans. An installation failure returns `status: "partial-failure"`, the changes already applied, and a retry command. It does not report a successful upgrade. Raw package manager output stays outside the machine-readable protocol.

A project from an earlier release that still has file records in `.cossack/scaffold.json` loses them on its first upgrade: the recipe moves into `package.json#cossack`, and the manifest stays only for `cossack eject` copies.

---

### `cossack eject <package> <path>`

Copy a file that a mounted package serves into the project, where it overrides the package's file (see [Routes from a package](routing.md#routes-from-a-package)). Use it when a plugin, the project's configuration or a child theme cannot make the change.

```bash
cossack eject cms /search                              # by route
cossack eject cms "src/pages/(site)/search/index.ts"   # by application path
cossack eject cms plugins/default-theme                # a served plugin, as a whole
cossack eject --diff "src/pages/(site)/search/index.ts"
cossack eject --restore "src/pages/(site)/search/index.ts"
```

`<package>` is the package's name or the short name it declares (`cms` for `@cossackframework/cms`).

| Option | Description |
| --- | --- |
| `--force` | Replace a file that already exists at the path. With `--restore`, delete a copy that you edited. |
| `--dry-run` | Show what would be copied or deleted. |
| `--diff` | Show what the package changed since the copy was made, and what the project changed in the copy. |
| `--restore` | Delete the copy and its record. The package's file is served again. |

Rules:

- Only pages, layouts, loading states, configuration files and whole plugins can be ejected. A shared module such as `cms/site.ts` cannot: the package's own code imports it by its path in the package and would never use a copy. The command stops with `COSSACK_EJECT_NOT_OVERRIDABLE`.
- In the copy, an import that stays in the package is rewritten to the package's name (`'#app/cms/site'` or `'../site'` becomes `'@cossackframework/cms/app/cms/site'`). The copy and the package then share one instance of each module.
- The copy is recorded in `.cossack/scaffold.json` under `ejected`, with the package text it was made from.
- `cossack upgrade` merges the package's later changes into every ejected copy, after it installs the new version. A copy you did not edit takes the package's new text. A copy whose merge conflicts is kept and listed, or gets conflict markers with `--conflicts=markers`.
- If you update the package with `pnpm up` alone, nothing is merged. The dev server and the build then name each override that fell behind: `src/pages/(site)/search/index.ts overrides @cossackframework/cms 0.10.0; the package changed it since 0.9.0: run cossack upgrade`.

## Exit codes

Every command returns `0` on success and a non-zero code on failure. The CLI is therefore safe in scripts, CI, and `&&` chains.

Cloudflare `cossack build` and `cossack deploy` can enforce literal project
`cossack.buildBudgets` settings in `package.json`. Machine results report public
measurements without binding output. See [Build budgets](./build-budgets.md).
