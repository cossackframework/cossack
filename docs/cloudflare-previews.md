---
title: "Cloudflare Previews"
description: "Plan, smoke-test, inspect, and clean a narrowly scoped native Worker preview."
---

# Cloudflare Previews

`cossack preview` uses native Worker Previews with an explicit account and a saved
ownership journal. The current implementation supports existing staging D1, KV,
and R2 bindings, plus local Durable Object classes. It does not provision external
storage, promote previews to production, or establish hosted CI acceptance from a
local test.

Cloudflare requires project Wrangler 4.135.0 or later for
[Worker Previews](https://developers.cloudflare.com/workers/previews/). Cossack
accepts compatible 4.x versions and checks the required native command flags.
A newer global Wrangler does not replace the project's installed dependency.

## Configure isolation explicitly

Add a top-level `previews` object to the source Wrangler configuration. This is
native preview configuration; `env.staging` alone does not configure this command.
Cossack builds the default Worker configuration and passes explicit preview
settings to native Wrangler with `--ignore-defaults`.

Repeat every top-level variable name in `previews.vars`, using appropriate
non-secret values. For each production D1, KV, or R2 binding, declare the same
binding name with a different staging reference. For example:

```jsonc
"previews": {
  "vars": {
    "APP_URL": "https://preview.example.net",
    "APP_LOCALE": "en"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "app-preview-db",
      "database_id": "<EXISTING_STAGING_DATABASE_ID>"
    }
  ],
  "kv_namespaces": [
    { "binding": "CACHE", "id": "<EXISTING_STAGING_NAMESPACE_ID>" }
  ],
  "r2_buckets": [
    { "binding": "UPLOADS", "bucket_name": "app-preview-uploads" }
  ]
}
```

This is an excerpt, not a complete Worker configuration. Replace placeholders
with actual resources in the selected account, include every variable your
application declares, and keep only binding groups your application uses.
Configure the production references separately. Cossack rejects staging references
that match a production reference in the same resource group.

D1, KV, and R2 resources are **retained** during preview cleanup. Cossack does not
create, reset, copy production data into, or delete them. Distinct staging
references separate a preview from production; multiple previews using the same
staging references still share data. Choose separate resources per branch when
branch-to-branch isolation is required. See Cloudflare's
[resource isolation guidance](https://developers.cloudflare.com/workers/previews/resources/).

Local Durable Object bindings are copied from the Worker when omitted from
`previews.durable_objects`. Existing local class bindings must remain present.
Native previews own their isolated Durable Object namespaces; cleanup delegates
that lifecycle to the provider. Bindings to another Worker's class or environment
are rejected.

Service, Workflow, Queue, Hyperdrive, and other unsupported bindings fail closed.
Cron triggers and declared required Worker secrets are also rejected. Secret-like
variable names such as `APP_SECRET` or `API_TOKEN` cannot go in `previews.vars`.
Generated apps normally declare required `APP_SECRET`, so the current flow rejects
them while that requirement is present. This CLI does not yet automate native
preview secret setup. Do not remove an application's
security requirements merely to pass preview validation. Native Cloudflare supports
more configuration than this first Cossack implementation.

## Plan, create, and smoke-test

Use the intended 32-character Cloudflare account ID explicitly. A real operation
requires `CLOUDFLARE_API_TOKEN` from a protected secret store, scoped to that account
with the permissions required for previews and their referenced resources.
Cossack checks authenticated account membership before mutation; membership alone
does not prove every permission or binding is ready. Do not print or commit tokens.

```sh
pnpm exec cossack preview create --account "$CLOUDFLARE_ACCOUNT_ID" \
  --name pr-42 --state .cossack/preview.json --smoke / --dry-run --json
```

This dry-run validates the local declaration and reports planned ownership. It
performs no authentication, build, journal writes, or cloud writes. It does not
prove the staging resources exist or that the token can deploy.

After reviewing the plan, omit `--dry-run` to create the preview:

```sh
pnpm exec cossack preview create --account "$CLOUDFLARE_ACCOUNT_ID" \
  --name pr-42 --state .cossack/preview.json --smoke / --json
```

Creation runs the existing `cossack deploy --dry-run` build gate, including
configuration checks and configured build budgets. It builds locally without a
production upload, prepares the selected preview configuration, records intent,
and invokes native preview deployment. The actual provider name adds a random
suffix to your label, so separate creations do not update an older preview by name.

The smoke request uses a same-origin HTTPS path on the returned `workers.dev` URL,
a 15-second timeout, and no redirect following. Only a 2xx response passes; an
HTTP redirect to login fails the smoke check. The command records `smoke-failed`
when deployment succeeded but smoke did not. That failure leaves the ownership
receipt available for inspection and cleanup.

## Inspect and clean the owned preview

Keep the journal under `.cossack` with a `.json` extension. Paths outside this
directory and symlinks are rejected. Writes are atomic, use file mode `0600`, and
retain intent before the first cloud mutation. A lock prevents competing operations
on the same journal. An existing journal is never overwritten by another creation.
Use a separate state file for each independent run.

```sh
pnpm exec cossack preview inspect --account "$CLOUDFLARE_ACCOUNT_ID" \
  --state .cossack/preview.json --json
pnpm exec cossack preview cleanup --account "$CLOUDFLARE_ACCOUNT_ID" \
  --state .cossack/preview.json --json
```

Both commands authenticate in the account saved in the journal. An explicitly
supplied different account fails. Inspection and cleanup compare the remote
preview's immutable ID and creation time with the saved receipt, then inspect the
saved deployment ID and its Cossack ownership tag. A matching name alone never
authorizes deletion. Cleanup targets the verified immutable ID and confirms remote
absence before saving `cleaned`. It never deletes the retained D1, KV, or R2 bindings.

A failed cleanup can be retried with the same journal and account. If a delete
response was lost, confirmed remote absence can complete cleanup. A replaced
preview, unreadable provider state, or changed deployment ownership blocks deletion.
Do not repair a journal by inventing IDs or tags.

If creation loses its response before the preview and tagged deployment receipt
are saved, intent does not prove ownership. A still-present preview then requires
manual provider recovery. Preserve the journal and provider evidence; identify the
actual resource in the intended account before any manual removal. Cancellation can
also stop a CI runner before its journal artifact upload. Automatic cleanup cannot
recover proof that was never saved.

## Trusted CI and retained artifacts

The scaffold's `.github/workflows/preview.yml` template uses manual
`workflow_dispatch`, with `create` and `cleanup` operations. Run it only on reviewed,
trusted repository code. Do not combine privileged preview tokens with untrusted
pull-request code or change it to `pull_request_target`.

Set repository variable `CLOUDFLARE_ACCOUNT_ID` and protected secret
`CLOUDFLARE_API_TOKEN`. The template installs locked dependencies without exposing
the deployment token, then supplies it only to preview creation and verified cleanup.
It uses Node 24, pnpm 11.19.0, and a 30-minute job limit. Same-label concurrency does
not cancel an in-flight ownership operation.

A create run deploys and smokes, saves `cossack-preview-intent` before teardown,
then always attempts verified inspection and cleanup. It saves the final
`cossack-preview-journal` afterward. Both artifacts contain `.cossack/preview.json`,
include hidden files, and have seven-day retention. The preview is therefore
short-lived; this workflow does not leave a persistent review deployment behind.

To retry cleanup, select `cleanup`, supply the earlier numeric `source_run_id`,
and choose its journal artifact. Restoration is limited to the same repository.
Use the intent artifact if the final upload was lost, while respecting the missing
receipt limitation above. Treat artifacts as operational records with restricted
access. A green local template test does not prove a hosted workflow completed.

## Production promotion and rollback

Production promotion is a separate reviewed deployment. First verify the production
account, bindings, secrets, and migration target. Apply backward-compatible
production database migrations before deploying code that requires them, keeping
the previous code compatible until the rollback window closes. Preview cleanup does
not migrate production or promote preview data.

Build and validate the explicitly selected production configuration, deploy it
through the normal [deployment workflow](./deployment.md), then smoke production.
The preview workflow has no automatic production deployment or promotion command.

Code rollback changes the active Worker version; it does not restore D1 rows, KV
values, R2 objects, Durable Object state, or external side effects. Deleted resources
and Durable Object lifecycle changes can also prevent rollback. Keep data recovery
and schema rollback procedures separate. See Cloudflare's
[rollback limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
