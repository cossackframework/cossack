# @cossackframework/scaffold

Node-only recipe engine consumed by the `cossack` CLI.

It owns the application templates, preset and feature registries, dependency
resolution, dashboard modules, conflict-safe change sets, and schema-v3
scaffold manifests.

Versions for third-party packages written to generated applications are
configured in `package.json` under `scaffold.dependencyVersions`. Workspace
Cossack packages use the scaffold package's own version.

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
