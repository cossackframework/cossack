---
title: "Deployment"
description: "Deploy Cossack applications to Cloudflare Workers with Wrangler."
---

# Deployment

## Cloudflare Workers (Default)

Cossack applications deploy to Cloudflare Workers using Wrangler.

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Project dependencies installed with `pnpm install`, including Wrangler and Vite.

### Configure

The minimal Cloudflare preset writes `wrangler.jsonc` with `src/index.ts`,
the `COSSACK_SSE` binding, and a SQLite Durable Object migration:

```jsonc
{
  "name": "my-app",
  "main": "./src/index.ts",
  "compatibility_date": "2026-06-06",
  "compatibility_flags": ["nodejs_als", "enable_request_signal"],
  "durable_objects": {
    "bindings": [{ "name": "COSSACK_SSE", "class_name": "SseDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SseDurableObject"] }]
}
```

This excerpt shows the entry and coordinator configuration. Keep the generated
assets, variables, and required-secret declarations too. Set `vars.APP_URL` to
your application's URL before you run deployment checks. The default `https://example.com`
URL deliberately fails preflight. Feature presets can add bindings that require
explicit resource selection before deployment.

### Static assets and authentication

Generated applications configure assets as follows:

```jsonc
"assets": {
  "binding": "ASSETS",
  "run_worker_first": true
}
```

Every request enters the Worker middleware pipeline. The framework returns
matching assets after global and owning page/layout policies run. Missing
assets continue to SSR or API handlers. Client JavaScript and CSS still use
the asset binding. The framework streams those responses.

Page policies also protect files inside that page's URL namespace. Known
`index.html` and `.html` page aliases pass through those policies and redirect
to the canonical route. Source route groups and dynamic parameters retain
their enclosing layout policies. Global middleware can protect asset paths
that have no page component. Match the entire protected path namespace.

Global middleware runs for asset requests too. Put work needed only by a
page in its route or layout middleware. `cossack check cloudflare` and deploy
preflight reject asset configurations that bypass the Worker or rename the
framework's `ASSETS` binding.

SSG only publishes anonymous, public HTML. A route that requires login or
sets visitor cookies must use SSR. See [Static Site Generation](./static-site-generation.md).

SSE pages use the `COSSACK_SSE` Durable Object binding to coordinate scoped
state and broadcasts across Worker requests. Generated apps export
`SseDurableObject` and configure its SQLite migration. Declare this binding
in each named environment too. Node uses a process-local SSE backend.
Multiple server processes need a shared coordinator for cross-process state.

Generated Cloudflare configurations include `enable_request_signal` in
`compatibility_flags` so incoming disconnects can cancel pending RPC work.
Existing apps must add the flag explicitly. Upgrades preserve Wrangler files.
Named environments inherit flags unless they override them. A coordinator
without the flag fails preflight with `COSSACK_REQUEST_SIGNAL_REQUIRED`.
The built artifact must retain the selected compatibility date and flags,
as well as its bindings. See [Cloudflare's compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-requestsignal-for-incoming-requests).

### Inspect configuration

Inspect and test local configuration without writing build files:

```sh
pnpm exec cossack inspect cloudflare --env staging --json
pnpm exec cossack check cloudflare --env staging --json
```

Both commands report the resolved Worker, environment, bindings, required
secret names, and diagnostics. Inspection succeeds when configuration can be
read. `check` fails if the configuration contains deployment errors. Their results explicitly
mark build and remote readiness as `not-checked`. They do not provision
resources, fetch secrets, or test permissions. Each binding identifies its
configured resource reference or the setup action needed when that reference is
missing. A configured name or ID does not prove that the resource exists in the
selected Cloudflare account.

Use `pnpm exec cossack resources plan --account <ACCOUNT_ID> --env staging --json`
to record explicit account ownership and unresolved resource actions. Add
`--select resources.json --verify` to test existing D1, KV, R2 and Hyperdrive
references through project Wrangler. `resources apply` tests before it updates
local JSON/JSONC, preserves comments, and converges without repeated writes.
Unsupported discovery/provisioning stays unresolved. These commands never create
or delete cloud resources. See [selection schema and limits](./cloudflare-resources.md).

### Deploy

```sh
pnpm exec cossack deploy --dry-run
pnpm exec cossack deploy
```

`cossack deploy` tests local configuration, generates binding types, builds
with Vite, compares the built configuration with the selected environment,
and deploys that artifact with the project's installed Wrangler. Invalid
environments, secrets in `vars`, placeholder resources, and a placeholder
`APP_URL` stop deployment. Set the application's URL before deploying.

`--dry-run` writes generated types and build artifacts and runs Wrangler's
local deployment test. It does not upload or provision resources.
It does not prove that remote secrets, permissions, or resources are ready.
Wrangler tests required remote secrets during a real deployment. A dry-run
can succeed without `.dev.vars` or remotely stored secrets. Its generated
artifact retains the required secret names, and remote readiness remains unchecked.

### Environments and CI

```sh
pnpm exec cossack dev --env staging
pnpm exec cossack build --env staging
pnpm exec cossack ssg --env staging
pnpm exec cossack deploy --env staging --dry-run --json
pnpm exec cossack deploy --env staging
```

Define `env.staging` in Wrangler first. Declare its variables and bindings
explicitly because these settings do not inherit from the top-level configuration.
For the minimal preset, a staging environment can use this configuration inside
its generated Wrangler file. Keep the top-level SQLite migration. Provide a
separate Worker name and repeat the coordinator binding:

```jsonc
"env": {
  "staging": {
    "name": "my-app-staging",
    "vars": { "APP_URL": "https://staging.example.net", "APP_LOCALE": "en" },
    "secrets": { "required": ["APP_SECRET"] },
    "durable_objects": {
      "bindings": [{ "name": "COSSACK_SSE", "class_name": "SseDurableObject" }]
    }
  }
}
```

Cossack sets `CLOUDFLARE_ENV` before Vite loads the project configuration, so
local development, regular builds, SSG, and deployment use the selected
environment for configuration, bindings, and static URLs. `--mode` optionally
selects a separate Vite mode. For example,
`cossack build --env staging --mode development` selects staging bindings and
variables while retaining Vite's development mode.

JSON mode emits one versioned result containing the Worker name, environment,
binding resources, required secret names, step exit codes and timings, artifact
path, and diagnostics. Raw tool output is suppressed because it can contain
configuration values. Run without `--json` for tool-specific error details.

Use distinct resources for previews. A preview URL alone does not isolate a
database or bucket. Apply migrations explicitly to the intended database.
This command does not apply migrations. Rolling back Worker code does not
restore database, bucket, or Durable Object state.

### Development compatibility checkpoint

The development browser tests use this installed combination:

| Tool or setting | Tested value |
| --- | --- |
| Node.js | 24.19.0 |
| Vite | 8.1.4 |
| `@cloudflare/vite-plugin` | 1.47.0 |
| Wrangler | 4.114.0 |
| Miniflare | 4.20260722.0 |
| Demo Worker compatibility date | 2025-08-03 |
| Demo Worker compatibility flags | `nodejs_compat` |

Static-asset middleware must let requests with an `Upgrade` header reach the
transport handler. Forwarding a WebSocket handshake to `ASSETS` crashes this
combination's development HTTP asset bridge. Cossack excludes those handshakes
before asset lookup. Global request and transport policies still run.

This browser checkpoint does not certify other dependency combinations.

### Environment Variables and Secrets

Set secrets via the Wrangler CLI (never commit them to `wrangler.jsonc`):

```sh
pnpm exec wrangler secret put APP_SECRET
# For a named environment:
pnpm exec wrangler secret put APP_SECRET --env staging
```

Generated apps declare required names in `secrets.required` and generate an
ignored `.dev.vars` with a random local `APP_SECRET`. Keep production secrets
separate. `.dev.vars.staging` replaces `.dev.vars` for staging, so include all
required values in that file. The scaffold ignores `.dev.vars*` and `.env*`
while retaining example files. Never commit real secrets in examples.

Non-sensitive variables can go in `wrangler.jsonc` under `"vars"`:

```jsonc
{
  "vars": {
    "PUBLIC_API_URL": "https://api.example.com"
  }
}
```

### Bindings

Cossack integrates with Cloudflare bindings. Access them in your components via `this.env`:

```typescript
@Server()
async getTasks() {
    const db = this.env.DB; // D1 binding
    const bucket = this.env.MY_BUCKET; // R2 binding
}
```

Add bindings to `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "my-db" }
  ],
  "r2_buckets": [
    { "binding": "MY_BUCKET", "bucket_name": "my-bucket" }
  ]
}
```

Wrangler's [D1 configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)
requires both `database_name` and `database_id` for a remote binding. The
scaffold leaves the ID unset for local development, so
`cossack check cloudflare` reports an unresolved D1 binding until you select an
existing database ID or create one. Use `pnpm exec wrangler d1 list` to find an
existing ID, or run the [Wrangler D1 create command](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
to create a remote database and update the Wrangler configuration:

```sh
pnpm exec wrangler d1 create <NAME> --update-config --binding <BINDING>
```

That command changes Cloudflare and the local configuration. Cossack does not run it
automatically. Add `--env <ENV>` when creating a database for a named Wrangler
environment. Hyperdrive requires a real configuration ID. Replace the scaffold
placeholder before deployment. Keep its origin credentials in Cloudflare-managed
Hyperdrive settings.

### Custom Domains

Add a custom domain to your Worker in the Cloudflare dashboard under Workers & Pages > your Worker > Settings > Domains & Routes, or via `wrangler.jsonc`:

```jsonc
{
  "routes": [
    { "pattern": "www.example.com", "custom_domain": true }
  ]
}
```

A [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
uses the Worker as the origin for the whole hostname. A
[route](https://developers.cloudflare.com/workers/configuration/routing/routes/)
intercepts matching requests in an existing Cloudflare zone, for example:

```jsonc
"routes": [
  { "pattern": "www.example.net/api/*", "zone_name": "example.net" }
]
```

Put staging domains and routes inside `env.staging`. Test that the built artifact
contains those selected values. A local dry-run tests configuration and output.
Activating DNS, certificates, and routes needs a real deployment in your account.

---

## Node.js

For Node.js deployments, see the [Adapters guide](./adapters.md).

```sh
# Build for production
pnpm build

# Start the server
node dist/server/index.js
```

Component, WebSocket, and SSE coordinator state is local to each Node process.
Use database or storage providers for persisted application data. Multiple server
processes need a shared coordinator for cross-process state and broadcasts.

The generated production entry handles `SIGTERM` and `SIGINT` by stopping new
HTTP admissions, finishing accepted responses, and disposing the runtime. Repeated
signals share the same shutdown operation. The default deadline is 10 seconds.
Forced shutdown or failed cleanup exits with status 1. Disposal can cancel framework
work. External I/O that ignores cancellation can still complete. Shutdown does
not roll back database writes or other side effects.

---

## Static Site Generation (SSG)

For fully static pages, use the SSG feature to pre-render pages at build time. See [Static Site Generation](./static-site-generation.md).

### Project build budgets

Optional `package.json` `cossack.buildBudgets` limits gate fresh Cloudflare
artifacts before upload. Warning/error diagnostics report measured upload/gzip
KiB and their rounding resolution. See [Build budgets](./build-budgets.md).

### Generated deployment baseline

The deployment guide uses this installed combination as its baseline. Newer tool
versions are not assumed to pass every native lifecycle test.

| Tool or setting | Verified value |
| --- | --- |
| Node.js | 24.19.0 |
| Cossack CLI and Framework | installed public tarballs |
| Vite | 8.1.4 |
| `@cloudflare/vite-plugin` | 1.47.0 |
| Wrangler | 4.114.0 |
| Generated compatibility date | 2026-06-06 |
| Generated flags | `nodejs_als`, `enable_request_signal` |

The baseline covers local build and deployment dry runs for the minimal preset,
including explicit staging configuration and SSG output. The
browser-development checkpoint above is separate. A project Wrangler
without the required configuration parser APIs fails with
`COSSACK_WRANGLER_API_UNSUPPORTED`. Install a compatible project Wrangler.

### Repeatable local guide acceptance

Repository maintainers can run `node scripts/verify-deployment-guide.mjs <installed-project>`
against a generated project with installed package tarballs. The verifier creates
a disposable minimal app using the installed CLI, tests the generated placeholder
rejection, sets the documented application URL, runs inspection, check, build, and
Wrangler dry-run, and tests an unavailable Wrangler parser. It also exercises
named-environment development HTTP and shutdown, builds, explicit Vite mode
selection, SSG HTML and sitemap
output, required-secret declarations without local secrets, and custom-domain
and route configuration preserved in built artifacts. It reports the exact
installed tool versions. It does not certify remote provisioning, preview isolation,
CI promotion, rollback, or unpublished dependency combinations.

The generated-app CI gate runs this verifier through `pnpm test:scaffold:local`.
For a focused run, use `node scripts/test-local-scaffold.mjs --deployment-guide-only`.
The `--reuse-artifacts=<directory>` option reuses an existing release tarball set. The verifier
disables optional Cloudflare metadata fetching and telemetry, and rejects any
non-loopback network attempt. Local dry-run success does not prove remote readiness.

The generated Node production entry has a separate repeatable signal check:

```sh
COSSACK_NODE_SHUTDOWN_INSTALLED_ROOT=/absolute/path/to/installed-project \
pnpm --filter cossack exec vitest run tests/generated-node-shutdown.test.js
```

This repository acceptance command uses the installed CLI to generate a disposable
Node project and exercises the built `dist/server/index.js` with real signals.
It tests that an accepted response drains under `SIGTERM`, and that uncooperative
work reaches the deadline under `SIGINT` with a repeated signal. Omit the environment
variable to use the workspace development packages instead of installed tarballs.
