---
title: "Cossack CLI"
description: "The cossack command-line interface — scaffolding, code generation, lifecycle, features, and upgrades for Cossack projects."
---

# Cossack CLI

The `cossack` command-line interface is the primary tool for working with Cossack projects. It scaffolds new applications, generates pages and components, runs the dev/build/start lifecycle, applies database migrations, adds features like authentication and database support, optimizes images, and keeps framework dependencies up to date.

## Installation

The CLI is distributed as an npm package. You can call it via `npx` directly:

```bash
npx cossack <command> [args] [options]
```

### Install globally

```bash
pnpm add -g cossack
# or: npm install -g cossack
```

Verify the installation:

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

These work across every command:

| Option | Description |
| --- | --- |
| `--force`, `-f` | Overwrite existing files or skip confirmation prompts. |
| `--dry-run` | Show what would happen without writing anything. |
| `--help`, `-h` | Show help. |
| `--version`, `-V` | Print the CLI version. |

---

## Project lifecycle

### `cossack create <name>`

Scaffold a new Cossack project in a directory named `<name>`. Prompts for the runtime adapter (Cloudflare Workers or Node.js) unless `--adapter` is provided.

```bash
cossack create my-app
cossack create my-app --adapter node
```

`cossack create` and `create-cossack-app` produce identical projects and both write a `.cossack/scaffold.json` manifest used by `cossack upgrade` for template-drift detection.

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

**Types and aliases**

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

**Page options**

| Option | Description |
| --- | --- |
| `--head` | Include a `head()` method (SEO) with title/description. |
| `--title <string>` | Set the head `<title>` and the `<h1>`. Implies `--head`. |
| `--description <string>` | Set the head description and a `<p>` under the `<h1>`. Implies `--head`. |
| `--no-index`, `--ni` | Generate a flat `src/pages/<name>.ts` (or `.md`) instead of a directory with `index.ts`. Both resolve to the same route. |

When `--head` is given without `--title`/`--description`, the page name is converted to title case (e.g. `my-page` → `My Page`).

**Examples**

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

> **Layouts are colocated.** The framework's router discovers layouts via `src/pages/**/layout.ts`. Always generate layouts under `src/pages/...`; a separate `src/layouts/` directory is not scanned.

### `cossack delete` (alias: `d`)

Delete a generated file and clean up its directory if it becomes empty.

```bash
cossack delete page dashboard
cossack d component UserCard
```

---

## Features

### `cossack add <feature>`

Add an opinionated, working feature to the current project. Each feature wires its dependencies, scaffolds the necessary files, and registers middleware in `src/config/middlewares.ts`.

```bash
cossack add <feature> [options]
```

#### `cossack add database`

Adds `@cossackframework/database` (Kysely with D1 and Turso dialects), a default `User` model, starter migrations (`users`, `sessions`, `roles`, `permissions`, `oauth_accounts`), a seeder, `src/db/config.ts`, the `dbMiddleware`, and the D1 binding in `wrangler.jsonc`. Prompts for the dialect (default: D1).

```bash
cossack add database
cossack add database --dialect turso
```

#### `cossack add auth`

Adds full working session authentication: `@cossackframework/auth` plus the `database` support it depends on. Generates a `createAuth`-backed `src/auth.ts` (PBKDF2 password hashing, session create/validate/resolve, password-reset helpers), a `Session` model, a real auth guard middleware, and functional login/register/forgot-password/reset-password pages using `@Server` methods and `@Validate` form fields. Registers `auth.middleware` and `authGuard` in `src/config/middlewares.ts` and wires the Cloudflare `send_email` binding for password-reset emails.

```bash
cossack add auth
cossack add auth --path admin/auth
cossack add auth --oauth github,google
```

**Options**

| Option | Description |
| --- | --- |
| `--path <route-group>` | Custom route group for the auth pages (default: `(auth)`). |
| `--oauth <providers>` | Generate OAuth provider config. Comma-separated or repeated: `github`, `google`, `gitlab`, `facebook`, `microsoft`. Bare `--oauth` prompts interactively. |
| `--dialect <d1\|turso>` | Database dialect to scaffold (default: prompt, or `d1`). |

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

Run [Kysely](https://kysely.dev/) migrations under `src/migrations/`.

```bash
cossack migration up        # Apply all pending migrations
cossack migration down      # Roll back the most recent migration
cossack migration status    # Show applied/pending migrations
```

> The migration commands import your TypeScript files, so the CLI respawns itself under `tsx` automatically.

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

Scan `src/` for [`<Image>`](/docs/images.md) usages and generate optimized variants next to the originals in `public/`. Useful for hosts without a built-in image CDN (e.g. the Node.js adapter). Requires **ImageMagick** to be installed.

```bash
cossack image optimize
cossack image optimize --format avif --quality 85
cossack image optimize --dry-run
```

For each `Image({ src, width })` call whose `src` points to a local asset under `public/`, the command writes a resized, re-encoded variant beside the original. `width` is required; `height` is optional and, when present, is included in the filename:

```
public/img/hero.png  +  Image({ src: '/img/hero.png', width: 800 })               ->  public/img/hero-800.webp
public/img/hero.png  +  Image({ src: '/img/hero.png', width: 800, height: 600 })  ->  public/img/hero-800x600.webp
```

**Options**

| Option | Description |
| --- | --- |
| `--format <webp\|avif>` | Output format (default: `webp`). |
| `--quality <0-100>` | Output quality (default: `80`). |
| `--dry-run` | List the variants that would be generated without writing. |

**Installing ImageMagick**

If the binary is missing, the command prints platform-specific instructions:

```bash
# macOS
brew install imagemagick
# Debian/Ubuntu
sudo apt-get install imagemagick
# Windows (Chocolatey)
choco install imagemagick
```

On Cloudflare deployments, runtime resizing via `/cdn-cgi/image/...` is preferred — see [Images](/docs/images.md).

---

## Introspection

### `cossack routes`

List all routes discovered in the project (pages, layouts, API routes).

### `cossack info`

Print system and environment information (OS, Node version, package versions) for inclusion in bug reports.

### `cossack version` (alias: `v`)

Print the installed CLI version.

---

## Upgrades

### `cossack upgrade [dir]`

Upgrade Cossack dependencies in the current project and report template drift. **Non-destructive by default:** it updates `package.json`, reinstalls, and prints which scaffolded files have upstream changes — source files are never overwritten unless you opt in.

```bash
cossack upgrade                       # bump deps + print drift report
cossack upgrade --apply-template      # also update files you have NOT edited
cossack upgrade --force               # overwrite ALL edited files + restore deleted ones (destructive)
cossack upgrade --force-file <path>   # surgically overwrite one file, even if edited
```

**Options**

| Option | Description |
| --- | --- |
| `--tag <latest\|canary\|<version>>` | Version to upgrade to (default: `latest`). |
| `--apply-template` | Update scaffolded files you have **not** modified. Modified files are always skipped. |
| `--force` | Overwrite **all** modified files and restore any deleted ones from the template. Destructive — local edits are lost. Implies `--apply-template`. |
| `--force-file <path>` | Force-update one specific file even if you modified it. May be repeated. |
| `--dry-run` | Show what would happen without writing. |

Drift detection is powered by the `.cossack/scaffold.json` manifest written at project-creation time, which records a SHA-256 of every scaffolded file. `upgrade` classifies each file as `upToDate`, `canUpdate` (unchanged locally, changed upstream), `modified` (you edited it), or `missing` (deleted), so you stay in control of your changes.

---

## Exit codes

Every command returns `0` on success and a non-zero code on failure, making the CLI safe to use in scripts, CI, and `&&` chains.
