# Cloudflare build budgets

Set local project budgets in `package.json`:

```json
{
  "cossack": {
    "buildBudgets": {
      "uploadKiB": { "warning": 800, "error": 1200 },
      "gzipUploadKiB": { "warning": 250, "error": 400 }
    }
  }
}
```

These are example project thresholds, not Cloudflare plan limits. Limits must
be positive finite numbers. Warning limits cannot exceed error limits.

`cossack build` and `cossack deploy` compare the fresh Cloudflare artifact with
these budgets, then run the project's installed Wrangler locally with `deploy --dry-run`.
An exceeded error limit stops the command before upload. Warning limits report diagnostics
and allow the command to continue. `deploy --dry-run` reuses this comparison without a
second deployment invocation. Without budgets, normal commands keep their
current measurement behavior. These settings require Cloudflare
artifacts. They do not govern Node builds.

New Cloudflare projects include this plugin. For an existing project, add it after
`cloudflare()` to enforce budgets through direct `vite build`:

```ts
import { cloudflare } from '@cloudflare/vite-plugin';
import { cossackBuildBudgets } from '@cossackframework/framework/vite-plugin';

export default {
  plugins: [cloudflare(), cossackBuildBudgets()],
};
```

The plugin measures the primary deployment Worker after Cloudflare's application
build completes. It compares the selected source target with the fresh built
artifact and rejects unfinished Worker environments. Auxiliary Workers receive
separate measurements only through explicit policies described below. Choose the environment through
`CLOUDFLARE_ENV` or `cossackBuildBudgets({ environment: 'staging' })`, matching the
Cloudflare plugin's target selection. Built configs are already environment-specific.
Measurement does not apply that environment a second time.

Use the installed Vite CLI or `createBuilder().buildApp()` for this gate. The
single-environment `vite.build()` API does not invoke application build hooks.

For supported no-bundle Worker artifacts, the CLI reuses the plugin's complete
measurement batch through a private `.cossack/build-budget-receipt.json` file. Each
build gets a fresh signing key that is never saved. Reuse requires matching
settings, selected environment, artifact contents and metadata, installed Wrangler
identity, and Node version. Startup receipts also bind the installed Miniflare
entry and manifest, workerd loader and manifests, native executable contents,
and runtime override/autogate settings. A failed Vite build yields structured budget errors
only when a valid receipt proves a budget failure. Other build failures retain
their build diagnostics. Raw tool output and binding values never enter receipts.

Reuse is conservative. Symlinks, external modules, custom builds,
rebundling, unselected auxiliary Workers and unsupported legacy configuration trigger a fresh
CLI measurement after a successful build. Inventory is bounded to 4,096 files
and 64 MiB of artifacts/metadata, 4,096 directories and 8,192 directory entries.
Tool/runtime identity has a separate 256 MiB bound because native workerd binaries
can exceed the artifact bound. Directory membership is tested before and after
traversal. Exceeding a bound disables reuse, not budget enforcement. Empty
directories created by Wrangler do not change the fingerprint. A file added
there later does. Startup reuse
requires a supported native package or an absolute, regular, nonsymlink
`MINIFLARE_WORKERD_PATH`. Relative overrides and downloaded fallback binaries
trigger fresh measurement. These identities do not cover every transitive tool
dependency. Budgeted watch builds are rejected with `COSSACK_BUILD_BUDGET_WATCH_UNSUPPORTED`.
Vite application hooks do not cover every watch rebuild. Run `vite build` for a
completed measurement. This guard reads root and environment watch settings,
including custom builders. It adds no restriction when budgets are absent.

JSON results contain `data.buildBudgets.measurements`, `diagnostics` and `valid`.
Only selected metrics enter the result. Tool stdout/stderr stays private because
Wrangler can print binding values. Capture is bounded to one MiB. Overflow or a
failed tool fails the measurement. Each measurement subprocess has a 30-second deadline. A timeout also fails the measurement. Local
measurement writes build/tool artifacts but
does not upload or provision remote resources.

Sizes come from Wrangler's combined module upload summary, not a sum of gzipped
files or every file in `dist`. The reported unit is KiB (1024 bytes). Wrangler
rounds to 0.01 KiB. The comparison requires the upper rounding bound (`value + 0.005`)
to fit the limit. Unsupported or ambiguous summaries are unavailable and cannot
pass an error budget. Missing metrics are warnings for warning-only settings.

`providerStartupMs` is recognized but unavailable from local dry runs. An error
limit for it stops the command. A warning limit reports that the value was not
measured. Vite duration is not Worker startup time.

For opt-in local profiling, configure `localStartupProfileMs` (the CPU profile's
elapsed window) or `localStartupActiveMs` (sampled time excluding idle samples,
including garbage collection). Both use milliseconds and report source
`wrangler-local-startup-profile`. They measure local initialization with profiler
overhead and depend on the machine, Wrangler version and sampling. They do not
establish Cloudflare's provider startup time or production CPU limits. Empty
samples leave active time unavailable.

When either metric is configured, Wrangler writes a private multipart bundle
with `deploy --dry-run --outfile`, then runs `check startup --worker --outfile`.
These files can contain application code, binding values and source paths.
Cossack uses an OS temporary directory with mode 0700, bounds each file to
64 MiB, rejects symlinks, and removes the directory after success or failure.
Only derived numeric timings enter JSON results and signed receipts. Missing,
invalid, oversized or failed profiles fail the measurement. They do not pass a gate.
The profiler executes application initialization locally. It can fail on
unsupported bindings or modules. Size-only budgets do not invoke it.
Remote startup measurement remains separate work. See [Wrangler startup profiling](https://developers.cloudflare.com/workers/wrangler/commands/workers/#startup).

The Cloudflare platform limit uses uncompressed Worker size.
Gzip is informational. The framework does not hardcode a provider limit.
See [Cloudflare's size-limit change](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/).

For a custom source Wrangler file, set the same path for the CLI and Vite:

```sh
CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=deployment/worker.jsonc pnpm exec cossack deploy --dry-run
```

Paths resolve from the project/Vite root. A missing selected file fails without
falling back to a root Wrangler file. For direct Vite composition, explicit
`configPath` takes priority over the environment variable. Pass one shared value
to every plugin that inspects the Worker:

```ts
import { cloudflare } from '@cloudflare/vite-plugin';
import { cossackBuildBudgets, cossackPages, cossackConfig } from '@cossackframework/framework/vite-plugin';
import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';

const configPath = 'deployment/worker.jsonc';
const plugins = [
  cloudflare({ configPath }),
  cossackBuildBudgets({ configPath }),
  cossackPages({ configPath, capabilities: { runtime: 'cloudflare' } }),
  cossackConfig({ configPath }),
  // If the application uses SSG:
  cossackSsg({ configPath }),
];
```

The CLI does not evaluate the Vite configuration to discover plugin options. Use the
environment variable for CLI inspection and deployment. Then preflight, binding
inspection, type generation, SSG URL discovery and artifact
comparison select the same source. The
selection order matches the [Cloudflare plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/).


## Auxiliary Worker policies

Declare each selected auxiliary Worker by its source configuration path:

```json
{
  "cossack": {
    "auxiliaryBuildBudgets": [
      {
        "configPath": "workers/jobs/wrangler.jsonc",
        "budgets": { "uploadKiB": { "warning": 200, "error": 300 } }
      }
    ]
  }
}
```

Configure the same source file in Cloudflare's `auxiliaryWorkers` plugin option.
Cossack reads these literal policies without evaluating the Vite configuration. Paths must
be unique, relative to the project, and cannot contain `..` or backslashes.
The selected environment must exist in each source configuration. Policies can
use all primary metrics and activate the gate even without primary budgets.

The CLI and direct Vite gate capture source targets before building. After the
build, they match exactly one auxiliary redirect artifact per source path and
compare normalized deployment fields with the independent source target. All
selected artifacts are compared with their source targets before any auxiliary measurement. Changed
policies, changed sources, ambiguous matches, primary/prerender entries and
non-project/symlink configuration files fail the gate. Artifact configuration
is compared again after measurement and before primary upload. Ordinary binding
families, account, migration, routing and schedule settings are compared. D1
migration directories/patterns and empty Cron schedules are normalized to account
for generated configuration rewrites. Compiled entrypoints and bundling options are
owned by the build. The gate does not treat them as literal source target fields.

The gate accepts at most 32 policies and 32 auxiliary redirect entries. Each
configuration file must be a regular project file no larger than 1 MiB.
Prerender and dev-only Workers cannot satisfy an auxiliary policy. JSON returns
`data.auxiliaryBuildBudgets.workers`, each with `configPath` and `buildBudgets`.
Only authored paths and safe metric results are returned. Binding values and
raw tool output stay private.

A complete batch can reuse one signed version-2 receipt for the primary Worker
and every selected auxiliary Worker. All auxiliary redirect entries must have
policies. An unselected entry disables reuse. The receipt binds independent
source snapshots and files, settings, selected environment, redirect membership,
ordered artifacts, and tool/runtime identity. The primary artifact remains bound
when only auxiliary limits exist. Supported prerender artifacts are also included
in the identity but cannot satisfy an auxiliary policy.

The gate fingerprints the whole batch before all measurements and again after
the last result. It never signs a measured prefix. Receipts contain only numeric
metrics, fixed outcomes and hashed identity, without source or configuration values or tool
messages. The CLI reconstructs diagnostics from current limits. Successful builds
reuse only a complete matching batch. Unsupported or changed inventories receive
fresh measurements. A failed build can report an auxiliary budget failure only from a
complete authenticated receipt. Passing or incomplete receipts never hide an
unrelated compiler failure. Broader external/rebundled module graphs remain
unsupported for reuse. Local measurement still enforces their budgets.

These policies perform local budget enforcement. `cossack deploy` currently uploads
only the primary Worker. It does not deploy the auxiliary Workers. Deploy those
Workers separately until upload orchestration is implemented.
