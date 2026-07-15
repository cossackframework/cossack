# Cossack CLI

The official CLI for the [Cossack Framework](https://cossack.dev) — scaffolding, codegen, management, and upgrades for Cossack projects.

## Installation

### In a Cossack project

The CLI is installed automatically when you scaffold a project:

```bash
pnpm cossack create my-app
cd my-app
```

It's available via the project's `devDependency` on `cossack`, usually through `pnpm`-script shortcuts like `pnpm dev`, `pnpm build`, and `pnpm start`.

### Globally (optional)

```bash
pnpm add -g cossack
# or: npm install -g cossack
# or: yarn global add cossack
```

Requires **Node.js >= 22**.

## Usage

```bash
cossack <command> [args] [options]
```

Run `cossack --help` to list all commands, or `cossack <command> --help` for command-specific options.

### Commands at a glance

| Command | Description |
| --- | --- |
| `create <name>` | Scaffold a new Cossack project. |
| `dev` | Start the Vite dev server. |
| `build` | Production build (`vite build` + SSG pre-render). |
| `start` | Start the production server. |
| `generate <type> <name>` (`g`) | Generate a page/component/layout/middleware/service/model/migration/seeder. |
| `delete <type> <name>` (`d`) | Delete a generated file/folder. |
| `add <feature>` | Add a feature — `auth`, `database`, or `ui`. |
| `lang <sub>` | Manage localization catalogs (`publish`, `add <locale>`). |
| `migration <sub>` (`migrate`) | Run Kysely migrations (`up`, `down`, `status`). |
| `seeder <sub>` (`seed`) | Run seeders (`run`). |
| `routes` | List all routes in the project. |
| `ssg` | Pre-render pages marked `ssg:true` to static HTML. |
| `image optimize` | Generate optimized image variants from `<Image>` usages (requires ImageMagick). |
| `upgrade [dir]` | Upgrade Cossack deps and report template drift. |
| `info` | Print system/environment info for bug reports. |
| `version` (`v`) | Print the CLI version. |

### Global options

| Option | Description |
| --- | --- |
| `--force`, `-f` | Overwrite existing files / skip confirmation. |
| `--dry-run` | Show what would happen without writing. |
| `--help`, `-h` | Show help. |
| `--version`, `-V` | Print the CLI version. |

## Examples

```bash
# Scaffold and run
cossack create my-app
cd my-app && cossack dev

# Generate code
cossack g page dashboard --head --title "Dashboard"
cossack g page hello --no-index          # -> src/pages/hello.ts (flat, no folder)
cossack g layout admin/dashboard
cossack g component UserCard
cossack g migration create_posts

# Add features
cossack add database --dialect d1
cossack add auth --path admin/auth --oauth github
cossack add ui --theme dark

# Database lifecycle
cossack migration up
cossack seeder run

# Image optimization (build-time, via ImageMagick)
cossack image optimize --format webp --quality 80

# Stay current
cossack upgrade --apply-template
```

## How it works

The CLI is a small, dependency-light Node.js program (no `commander`/`yargs`). Commands are registered in [`src/dispatch.js`](./src/dispatch.js); each command lives in [`src/commands/`](./src/commands) and follows the contract `async function run(args, ctx): Promise<exitCode>`. Generated file contents are pure template functions in [`src/templates.js`](./src/templates.js) (string in, string out) for easy testing.

Scaffolding reuses [`create-cossack-app`](../create-cossack-app) so `cossack create` and `create-cossack-app` produce identical projects, and both write a `.cossack/scaffold.json` manifest that `cossack upgrade` uses for non-destructive template-drift detection.

## Documentation

- **Full CLI reference** — [`docs/cossack-cli.md`](../../docs/cossack-cli.md) in the framework repository.
- **Framework docs** — [https://cossack.dev/docs](https://cossack.dev/docs).
