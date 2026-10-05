# Cloudflare resource verification

The CLI resource provider checks an explicit account before selecting existing resources. It runs read-only Wrangler commands. It does not create, deploy, delete, or provision cloud resources. A missing resource requires an explicit provisioning step outside this provider.

```js
import { createWranglerResourceProvider } from 'cossack/src/cloudflare-resource-provider.js';
const provider = createWranglerResourceProvider(projectRoot, {
  accountId: '0123456789abcdef0123456789abcdef',
  environment: 'production',
  configPath: '/absolute/project/wrangler.jsonc',
});
const account = await provider.verifyAccount();
if (account.status === 'verified') {
  const selected = await provider.find('d1', { id: databaseId, name: databaseName });
  // Only selected.status === 'verified' establishes this account's resource identity.
}
```

`accountId` must contain exactly 32 hexadecimal characters. The authenticated `whoami --json` account list must include that account. Environment variables alone never establish account access. Each lookup repeats the account check. A mismatch stops before resource discovery.

Wrangler configuration can override its account environment variable. The provider therefore creates a temporary account-only configuration, with the same explicit account in the selected environment, and removes it after the operation. The application configuration path is provenance for the CLI's separate validation and local apply step; it is never passed to resource discovery. The CLI rejects an application account declaration that conflicts with the explicit target.

| Kind | Machine-readable evidence | Limits |
| --- | --- | --- |
| D1 | `d1 list --json` | Complete paginated list; match ID and/or name |
| KV | `kv namespace list` | Wrangler's default JSON; match ID and/or title |
| R2 | `r2 bucket info NAME --json` | Name required; failure remains unknown, not inferred missing |
| Hyperdrive | `hyperdrive get ID` | ID required; origin details and credentials are discarded |
| Queue | Unsupported | Select and verify in target account; human tables are not evidence |
| Workflow | Unsupported | Verify deployed name, script, and class explicitly |
| Service | Unsupported | Deployment history does not prove entrypoint compatibility |
| Durable Object | Unsupported | Verify exported class, script, and migrations explicitly |

The provider requires Wrangler 4.114 or a newer 4.x version and checks relevant command help. Other major versions require renewed command-contract verification. It parses whole JSON output, never strips banners or scrapes tables. Unknown schemas, unsupported identity characters, ambiguous names, permission failures, and tool errors do not establish existence. Identity fields are bounded to 128 ASCII characters; IDs use letters, digits, underscores, and hyphens, while names also permit spaces and dots.

Every result has `{ status, accountId, reference: { id?, name? }, code?, action? }`. Only sanitized identity fields are retained. Raw stdout, stderr, response objects, error messages, email addresses, tokens, and Hyperdrive origin credentials are excluded.

| Status/code | Meaning |
| --- | --- |
| `verified` | Authenticated account membership or unique resource match proved |
| `missing` / `COSSACK_CF_RESOURCE_MISSING` | No match in a successfully returned complete D1/KV list |
| `unsupported` / `COSSACK_CF_DISCOVERY_UNSUPPORTED` | No supported machine-readable discovery contract |
| `COSSACK_CF_RESOURCE_KIND_UNSUPPORTED` | Unknown resource kind |
| `COSSACK_CF_LOOKUP_REFERENCE_UNSUPPORTED` | Required name or ID absent |
| `COSSACK_CF_WRANGLER_VERSION_UNSUPPORTED`, `COSSACK_CF_ACCOUNT_JSON_UNSUPPORTED`, `COSSACK_CF_COMMAND_UNSUPPORTED` | Tool upgrade or explicit verification needed |
| `COSSACK_CF_ACCOUNT_MISMATCH`, `COSSACK_CF_ACCOUNT_UNVERIFIED` | Account access not established |
| `COSSACK_CF_REFERENCE_INVALID`, `COSSACK_CF_REFERENCE_AMBIGUOUS`, `COSSACK_CF_REFERENCE_MISMATCH` | Selection cannot safely resolve |
| `COSSACK_CF_OUTPUT_INVALID`, `COSSACK_CF_OUTPUT_LIMIT` | Tool output failed schema or byte limits |
| `COSSACK_CF_CANCELLED`, `COSSACK_CF_TIMEOUT` | Operation ended without evidence |
| `COSSACK_CF_TOOL_UNAVAILABLE`, `COSSACK_CF_TOOL_FAILED`, `COSSACK_CF_INSPECTION_FAILED` | Tool or local inspection unavailable |

Cancellation uses an optional `{ signal }` argument to either method. Default command deadline is 15 seconds, and combined native stdout/stderr is limited to 512 KiB. Optional `timeoutMs` (1–30,000) and `maxOutputBytes` (128–1,048,576) can reduce or raise those limits. Lists are limited to 5,000 identities. A hanging injected runner cannot hold up the result; injected runners remain responsible for terminating their own work when their supplied signal aborts.

For deterministic tests, `runner(args, context)` returns `{ exitCode, stdout, code? }`. Context supplies `cwd`, isolated account/environment, provenance `configPath`, child `env`, `signal`, and limits. Runner output goes through the same schema checks. Native execution uses the installed project's Wrangler entrypoint with `shell: false`. The tests run actual Wrangler against a local Cloudflare protocol fixture with a fixture-only token; no external account or cloud mutation is required.

Command contracts follow the official [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/), [D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/), and [R2 commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/) references. Unsupported results are unresolved actions, not automatic provisioning promises.

## CLI plans and local application

```sh
cossack resources plan --account ACCOUNT_ID --json
cossack resources plan --account ACCOUNT_ID --env preview --select resources.json --verify --json
cossack resources apply --account ACCOUNT_ID --env preview --select resources.json --json
```

`plan` reads the selected project's Wrangler configuration and writes nothing. Without `--verify`, resource existence remains `not-checked`; this mode makes no authenticated cloud calls. `--verify` explicitly opts into account and supported resource checks. `apply` always verifies and only updates local JSON/JSONC references. Cloud writes remain zero for both commands. Resource commands require explicit `--env` for named environments and ignore inherited `CLOUDFLARE_ENV`; without the flag they select top-level declarations. Named environments use Wrangler's actual inheritance rules; non-inherited bindings must be declared in that environment. TOML can be planned, but automatic application requires JSON/JSONC.

The selection file is a strict JSON object:

```json
{
  "schemaVersion": 1,
  "resources": [
    { "binding": "DB", "kind": "d1", "mode": "existing", "id": "12345678-1234-1234-1234-123456789abc", "name": "application-db" },
    { "binding": "CACHE", "kind": "kv", "mode": "existing", "id": "1234567890abcdef1234567890abcdef" },
    { "binding": "FILES", "kind": "r2", "mode": "existing", "name": "application-files" },
    { "binding": "TUNNEL", "kind": "hyperdrive", "mode": "existing", "id": "1234567890abcdef1234567890abcdef" }
  ]
}
```

Each declared binding may appear once. D1 requires both ID and name; KV and Hyperdrive require ID; R2, Queue, Workflow, and service require name. IDs must be UUIDs or 32 hexadecimal characters, and cannot be zero placeholders. Names use bounded letters, digits, underscores, dots, and hyphens. Supported kinds are `d1`, `kv`, `r2`, `hyperdrive`, `queue`, `workflow`, `service`, and `durable-object`.

`mode: "existing"` selects an existing resource; local application requires successful account and resource verification for every selected item. `mode: "create"` always returns `COSSACK_RESOURCE_PROVISION_UNSUPPORTED`, with an explicit provisioning action. This is supported for each selectable kind, but never creates anything. Durable Object bindings instead have `provider-managed` mode: author their classes and migrations, rather than selecting or creating an external ID. Explicit Durable Object selections fail with `COSSACK_RESOURCE_PROVIDER_MANAGED`.

Application preserves unrelated configuration and JSONC comments, updates only selected environment references, and binds the selected configuration account ID to the verified account. Replanning and applying the same references returns `applied: "unchanged"` with zero local writes. A modified configuration invalidates the old in-process plan (`COSSACK_RESOURCE_PLAN_STALE`). Serialized plans cannot be applied. Unsupported discovery, missing resources, unverified accounts, and unresolved selections prevent local application.

With `--json`, command output uses `{ schemaVersion: 1, command: "resources", ok, data, diagnostics }`. Success data includes account verification, per-binding mode/reference/remote evidence, and `{ cloudWrites: 0, localWrites }`. Invalid account, conflicting configured account, invalid selection, or unknown binding returns a failed envelope before writes. Private variable values are omitted from plans and failure envelopes.
