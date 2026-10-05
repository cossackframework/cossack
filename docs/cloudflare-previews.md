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
settings using the flag advertised by the installed Wrangler: `--ignore-base-config`
in current versions or `--ignore-defaults` in compatible older versions. Both bypass
shared defaults; unsupported flag contracts fail before mutation.

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
Cron triggers remain unsupported. Secret-like variable names such as `APP_SECRET`
or `API_TOKEN` cannot go in `previews.vars`.

Generated apps declare `APP_SECRET`. Supply an explicit staging JSON map through
`--secrets-file`; its keys must exactly match `secrets.required`. Cossack never
copies production secrets or local `.dev.vars` automatically. For example, create
a private file with a staging-only secret and restrict its permissions:

```sh
chmod 600 /secure/staging-secrets.json
```

The input is a JSON object such as `{"APP_SECRET":"<STAGING_ONLY_SECRET>"}`. Replace
the placeholder; do not commit the file. Cossack accepts at most 64 declared names,
a 64 KiB regular file, and 16 KiB per nonempty string value. It rejects duplicate
keys, missing/extra names, NUL values, symlink/hardlink files and, on POSIX, files
owned by another user or accessible to group/others.

Secrets are attached to this preview deployment as native `secret_text` bindings
with `--ignore-defaults`; shared preview defaults and production secrets are not
changed. Only the CLI's private prepared configuration contains the supplied
values. It is mode 600 and removed after the operation. Values do not appear in
journals, CLI results or client bundles. Native Wrangler warnings can contain
values, so the provider captures stderr and writes logs to a private temporary
directory that it removes. Abrupt process termination can leave private local
files; retain filesystem access restrictions and remove abandoned private files
after the owning process stops.

## Plan, create, and smoke-test

Use the intended 32-character Cloudflare account ID explicitly. A real operation
requires `CLOUDFLARE_API_TOKEN` from a protected secret store, scoped to that account
with the permissions required for previews and their referenced resources.
Cossack checks authenticated account membership before mutation; membership alone
does not prove every permission or binding is ready. Do not print or commit tokens.

```sh
pnpm exec cossack preview create --account "$CLOUDFLARE_ACCOUNT_ID" \
  --name pr-42 --state .cossack/preview.json --secrets-file /secure/staging-secrets.json --smoke / --dry-run --json
```

This dry-run validates the local declaration and reports planned ownership. It
performs no authentication, build, journal writes, or cloud writes. It does not
prove the staging resources exist or that the token can deploy.

After reviewing the plan, omit `--dry-run` to create the preview:

```sh
pnpm exec cossack preview create --account "$CLOUDFLARE_ACCOUNT_ID" \
  --name pr-42 --state .cossack/preview.json --secrets-file /secure/staging-secrets.json --smoke / --json
```

Creation runs the existing `cossack deploy --dry-run` build gate, including
configuration checks and configured build budgets. It builds locally without a
production upload, prepares the selected preview configuration, records intent,
creates an empty preview without inherited settings, and saves the provider
creation ID/time before invoking native deployment. The parent Worker must already
exist in the selected account; Cossack does not create or modify it.
The actual provider name adds a random
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
latest deployment ID and its Cossack ownership tag. An older tagged deployment
cannot authorize cleanup after the latest deployment changes. A matching name alone never
authorizes deletion. Cleanup targets the verified immutable ID and confirms remote
absence before saving `cleaned`. It never deletes the retained D1, KV, or R2 bindings.

A failed cleanup can be retried with the same journal and account. If a delete
response was lost, confirmed remote absence can complete cleanup. A replaced
preview, unreadable provider state, or changed deployment ownership blocks deletion.
Do not repair a journal by inventing IDs or tags.

If creation loses its response after the tagged deployment was committed,
inspection reads the real latest deployment and verifies the journal's exact
ownership tag. Inspection performs no journal writes. Cleanup persists that
recovered receipt before deleting by immutable ID. Foreign tags, unknown reads, or a replacement preview block deletion.

If creation stops before deployment, cleanup can use the creation receipt saved
before native upload. It must match the independently read preview ID, name and
creation time, and the provider must confirm that its latest deployment is absent.
A failed deletion remains retryable; only confirmed preview absence completes it.

If the creation response was lost before that receipt was saved, intent and a name
do not prove ownership. Preserve the journal and provider evidence for manual
recovery in the intended account. A missing latest deployment is not an absent
preview. Cancellation can also stop CI before its journal artifact upload.

## Trusted CI and retained artifacts

The scaffold's `.github/workflows/preview.yml` template uses manual
`workflow_dispatch`, with `create` and `cleanup` operations. Run it only on reviewed,
trusted repository code. Do not combine privileged preview tokens with untrusted
pull-request code or change it to `pull_request_target`.

Set repository variable `CLOUDFLARE_ACCOUNT_ID` and protected secret
`CLOUDFLARE_API_TOKEN`, plus `COSSACK_PREVIEW_SECRETS_JSON` containing the exact
staging secret map (`{}` for apps without required secrets). The template installs locked dependencies without exposing
the deployment token, then supplies it only to preview creation and verified cleanup.
Creation writes a mode-600 temporary secret file, unsets the environment blob
before invoking the CLI, and removes the file on shell exit. Journal artifacts
exclude secret files. It uses Node 24, pnpm 11.19.0, and a 30-minute job limit. Same-label concurrency does
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
