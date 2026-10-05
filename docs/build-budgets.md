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

`cossack build` and `cossack deploy` validate the fresh Cloudflare artifact,
then run the project's installed Wrangler locally with `deploy --dry-run`.
An exceeded error limit stops before upload. Warning limits report diagnostics
and allow continuation. `deploy --dry-run` reuses this validation without a
second deployment invocation. Without budgets, normal commands retain their
existing measurement behavior. These settings currently require Cloudflare
artifacts; they do not govern Node/Deno builds.

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
build completes. It validates the selected source target against the fresh built
artifact and rejects unfinished Worker environments. Auxiliary Workers do not
receive separate budget measurements. Choose the environment through
`CLOUDFLARE_ENV` or `cossackBuildBudgets({ environment: 'staging' })`, matching the
Cloudflare plugin's target selection. Built configs are already environment-specific;
verification and measurement do not apply that environment a second time.

Use the installed Vite CLI or `createBuilder().buildApp()` for this gate. The
single-environment `vite.build()` API does not invoke application build hooks.

For supported no-bundle primary Worker artifacts, the CLI reuses the plugin's
measurement through a private `.cossack/build-budget-receipt.json` file. Each
build gets a fresh signing key that is never saved. Reuse requires matching
settings, selected environment, artifact contents and metadata, installed Wrangler
identity, and Node version. A failed Vite build yields structured budget errors
only when a valid receipt proves a budget failure. Other build failures retain
their build diagnostics. Raw tool output and binding values never enter receipts.

Reuse is deliberately conservative. Symlinks, external modules, custom builds,
rebundling, auxiliary Workers and unsupported legacy configuration trigger a fresh
CLI measurement after a successful build. Inventory is bounded to 4,096 files
and 64 MiB, including tool identity files; exceeding that bound disables reuse,
not budget enforcement. Budgeted watch builds are rejected with `COSSACK_BUILD_BUDGET_WATCH_UNSUPPORTED`:
Vite application hooks do not verify every watch rebuild. Run `vite build` for a
completed measurement. This guard checks root and environment watch settings,
including custom builders; it adds no restriction when budgets are absent.

JSON results contain `data.buildBudgets.measurements`, `diagnostics` and `valid`.
Only selected metrics enter the result. Tool stdout/stderr stays private because
Wrangler may print binding values. Capture is bounded to one MiB; overflow or a
failed tool fails measurement. Each measurement subprocess has a 30-second deadline; timeout also fails measurement. Local validation writes build/tool artifacts but
does not upload or provision remote resources.

Sizes come from Wrangler's combined module upload summary, not a sum of gzipped
files or every file in `dist`. The reported unit is KiB (1024 bytes). Wrangler
rounds to 0.01 KiB. The check requires the upper rounding bound (`value + 0.005`)
to fit the limit; unsupported or ambiguous summaries are unavailable and cannot
pass an error budget. Missing metrics are warnings for warning-only settings.

`providerStartupMs` is recognized but unavailable from local dry runs. An error
limit for it stops the command; a warning limit reports that it was not verified.
Vite duration is not Worker startup time.

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
invalid, oversized or failed profiles fail measurement; they do not pass a gate.
The profiler executes application initialization locally and may fail on
unsupported bindings or modules. Size-only budgets do not invoke it.
Remote startup acceptance remains separate work. See [Wrangler startup profiling](https://developers.cloudflare.com/workers/wrangler/commands/workers/#startup).

Cloudflare changed its platform limit to uncompressed Worker size in September
2026; gzip is informational. The framework does not hardcode a provider limit.
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

The CLI does not evaluate Vite config to discover plugin options. Use the
environment variable for CLI inspection and deployment so preflight, binding
checks, type generation, SSG URL discovery and artifact validation select the same source. The
selection order matches the [Cloudflare plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/).
