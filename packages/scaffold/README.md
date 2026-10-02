# @cossackframework/scaffold

Node-only recipe engine consumed by the `cossack` CLI.

It owns the application templates, preset and feature registries, dependency
resolution, dashboard modules, conflict-safe change sets, and schema-v3
scaffold manifests.

Versions for third-party packages written to generated applications are
configured in `package.json` under `scaffold.dependencyVersions`. Workspace
Cossack packages use the scaffold package's own version.

Schema-v3 manifests also record `dependencyBaseline`, grouped by package
dependency section. These are the recipe-owned values before user edits, not
the full merged application package. Creation, feature composition, removal,
and adapter switching maintain this baseline. Existing user dependencies are
not adopted merely because they match a recipe value. Upgrade planning compares
the baseline, current package, and requested release; it preserves local pins
and deletions while updating unchanged owned entries.
For older manifests without dependency ownership, composition can reconstruct
the baseline locally only when the recorded template version matches this
scaffold package. Otherwise run `cossack upgrade` first so it can load the
recorded release and establish the baseline.

Node recipes generate a gitignored `.env` with safe local defaults and random
application/OAuth secrets, plus a tracked `.env.example` containing documented
placeholder values. Their generated pnpm configuration allows the trusted
native build dependencies used by SQLite and Vite.

The `desktop` feature is an independent Electron side target for every web
adapter. It generates the main-process entry, Forge config, native icon set,
host package scripts, and pnpm settings required by Forge. Adding or removing
the feature owns those files without changing the selected web runtime.

```js
import {
  createApp,
  addFeature,
  removeFeatureFromProject,
  switchAdapter,
} from '@cossackframework/scaffold';

const project = await createApp('my-app', {
  adapter: 'cloudflare',
  preset: 'minimal',
  interactive: false,
});

await addFeature(project.projectDir, 'dashboard', {
  features: ['users', 'sessions'],
  interactive: false,
});

await removeFeatureFromProject(project.projectDir, 'database', {
  interactive: false,
});

await switchAdapter(project.projectDir, 'node', {
  database: 'sqlite',
  interactive: false,
});

await addFeature(project.projectDir, 'desktop', { interactive: false });
```

`switchAdapter()` requires a schema-v3 scaffold manifest and re-renders the
recorded recipe for the target runtime. It returns a conflict-safe change set
for confirmation or dry-run use. Local `.env` and `.dev.vars` files are merged
without becoming scaffold-owned, and the source environment file is retained.
Database configuration may change, but database contents are never migrated.

## Testing the workspace CLI end to end

A generated project normally installs the latest published packages. The local
smoke test builds and packs every workspace package, forces direct and
transitive Cossack dependencies to those tarballs, installs a generated Node
Full Stack app offline, runs migrations, and verifies its production SSG build:

```sh
pnpm run test:scaffold:local
```

Retain the generated app for inspection when diagnosing a failure:

```sh
COSSACK_KEEP_SMOKE=1 pnpm run test:scaffold:local
```

`recipeCapabilityRequirements(recipe, target)` returns serializable selected
requirements for `web` (the default) or `desktop`. Generated Vite configurations
include these declarations and CLI inspection exposes them without reading secret
values. SQLite contributes a filesystem requirement only when database support
is selected; Desktop contributes one only to its side target. Source locations
point to `.cossack/scaffold.json`, where the recipe selection is recorded.
D1 declares the native `DB` binding; Hyperdrive providers declare `HYPERDRIVE`.
These requirements apply to both targets because the generated database code is
shared. A Desktop build that retains either provider fails with a recipe diagnostic;
select a portable provider or provide a separate target-specific database setup.
Page transports and durable-state requirements remain discovered from page code.
The shared framework checker evaluates availability; this registry does not copy
runtime capability profiles. Requirements for other features must be added as
those features acquire runtime dependencies.

Generated Cloudflare projects disable the Workers Vite plugin in Desktop mode.
The web build still uses that plugin; the Desktop build uses Electron's runtime
boundary and evaluates its own selected capability requirements.

## Read-only resource recipe

Run `cossack add resource` to add `/resource` to an existing app, or select
`--features=resource` during creation. The recipe uses `server$`, explicit category
dependencies, and `resourceStatus$` for loading, stale data, errors, and empty
results. Refresh and retry use `refresh$`; client handlers use `@Client`.

The sample catalog is public and read-only. Replace its server loader with an
application service or a database read when needed. Database support is not added
implicitly. Keep authorization inside the server loader for private data.
Composition records ownership, supports repeated application, and preserves edited
pages. The recipe declares HTTP transport capability for every selected target.
