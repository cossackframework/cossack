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

Your project includes a `wrangler.jsonc` with the required bindings:

```jsonc
{
  "name": "my-app",
  "main": "./src/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "COSSACK_OBJECT", "class_name": "AppDurableObject" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["AppDurableObject"] }
  ]
}
```

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
the asset binding; the framework streams those responses.

Page policies also protect files inside that page's URL namespace. Known
`index.html` and `.html` page aliases pass through those policies and redirect
to the canonical route. Source route groups and dynamic parameters retain
their enclosing layout policies. Global middleware can protect asset paths
that have no page component; match the entire protected path namespace.

Global middleware now runs for asset requests too. Put work needed only by a
page in its route or layout middleware. `cossack check cloudflare` and deploy
preflight reject asset configurations that bypass the Worker or rename the
framework's `ASSETS` binding.

SSG only publishes anonymous, public HTML. A route that requires login or
sets visitor cookies must use SSR. See [Static Site Generation](./static-site-generation.md).

SSE pages use the `COSSACK_SSE` Durable Object binding to coordinate scoped
state and broadcasts across Worker requests. Generated apps export
`SseDurableObject` and configure its SQLite migration. Declare this binding
in each named environment too. Node and Deno use a process-local SSE backend;
multiple server processes need a shared coordinator for cross-process state.

Generated Cloudflare configurations include `enable_request_signal` in
`compatibility_flags` so incoming disconnects can cancel pending RPC work.
Existing apps must add it explicitly: upgrades preserve Wrangler files.
Named environments inherit flags unless they override them. A coordinator
without the flag fails preflight with `COSSACK_REQUEST_SIGNAL_REQUIRED`.
The built artifact must retain the selected compatibility date and flags,
as well as its bindings. See [Cloudflare's compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-requestsignal-for-incoming-requests).

### Inspect configuration

Inspect and check local configuration without writing build files:

```sh
pnpm exec cossack inspect cloudflare --env staging --json
pnpm exec cossack check cloudflare --env staging --json
```

Both commands report the resolved Worker, environment, bindings, required
secret names, and diagnostics. Inspection succeeds when configuration can be
read; `check` fails if it contains deployment errors. Their results explicitly
mark build and remote readiness as `not-checked`. They do not provision
resources, fetch secrets, or verify permissions.

### Deploy

```sh
pnpm exec cossack deploy --dry-run
pnpm exec cossack deploy
```

`cossack deploy` checks local configuration, generates binding types, builds
with Vite, checks the built configuration against the selected environment,
and deploys that artifact with the project's installed Wrangler. Invalid
environments, secrets in `vars`, placeholder resources, and a placeholder
`APP_URL` stop deployment. Set the application's URL before deploying.

`--dry-run` writes generated types and build artifacts and runs Wrangler's
local deployment validation. It does not upload or provision resources.
It does not prove that remote secrets, permissions, or resources are ready.
Wrangler validates required remote secrets during a real deployment.

### Environments and CI

```sh
pnpm exec cossack dev --env staging
pnpm exec cossack build --env staging
pnpm exec cossack ssg --env staging
pnpm exec cossack deploy --env staging --dry-run --json
pnpm exec cossack deploy --env staging
```

Define `env.staging` in Wrangler first. Declare its variables and bindings
explicitly because these settings do not inherit from the top-level config.
Cossack sets `CLOUDFLARE_ENV` before Vite loads the project configuration, so
local development, regular builds, SSG, and deployment use the selected
environment for configuration, bindings, and static URLs. `--mode` optionally
selects a separate Vite mode. For example,
`cossack build --env staging --mode development` selects staging bindings and
variables while retaining Vite's development mode.

JSON mode emits one versioned result containing the Worker name, environment,
binding resources, required secret names, step exit codes and timings, artifact
path, and diagnostics. Raw tool output is suppressed because it may contain
configuration values. Run without `--json` for tool-specific error details.

Use distinct resources for previews. A preview URL alone does not isolate a
database or bucket. Apply migrations explicitly to the intended database;
this command does not apply migrations. Rolling back Worker code does not
restore database, bucket, or Durable Object state.

### Development compatibility checkpoint

The 0.9.0 work uses this installed combination for its development browser checks:

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
before asset lookup; global request and transport policies still run.

The focused navigation, guard, and view-transition suites pass with this fix.
This checkpoint does not yet certify other dependency combinations or the
complete deployment guide. Keep the release checklist open until generated
projects and all release gates pass.

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

Wrangler can provision D1 when `database_id` is omitted. Set the real ID when
binding an existing database. Hyperdrive requires an existing configuration
ID; replace its scaffold placeholder before deployment.

### Custom Domains

Add a custom domain to your Worker in the Cloudflare dashboard under **Workers & Pages > your Worker > Settings > Domains & Routes**, or via `wrangler.jsonc`:

```jsonc
{
  "routes": [
    { "pattern": "www.example.com", "custom_domain": true }
  ]
}
```

---

## Node.js

For Node.js deployments, see the [Adapters guide](./adapters.md).

```sh
# Build for production
pnpm build

# Start the server
node dist/server/index.js
```

State is memory-only in Node.js mode : use an external database for persistence.

---

## Static Site Generation (SSG)

For fully static pages, use the SSG feature to pre-render pages at build time. See [Static Site Generation](./static-site-generation.md).
