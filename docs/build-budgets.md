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
artifacts; they do not govern Node/Deno or direct `vite build` commands.

JSON results contain `data.buildBudgets.measurements`, `diagnostics` and `valid`.
Only selected metrics enter the result. Tool stdout/stderr stays private because
Wrangler may print binding values. Capture is bounded to one MiB; overflow or a
failed tool fails measurement. Local validation writes build/tool artifacts but
does not upload or provision remote resources.

Sizes come from Wrangler's combined module upload summary, not a sum of gzipped
files or every file in `dist`. The reported unit is KiB (1024 bytes). Wrangler
rounds to 0.01 KiB. The check requires the upper rounding bound (`value + 0.005`)
to fit the limit; unsupported or ambiguous summaries are unavailable and cannot
pass an error budget. Missing metrics are warnings for warning-only settings.

`providerStartupMs` is recognized but unavailable from local dry runs. An error
limit for it stops the command; a warning limit reports that it was not verified.
Vite duration is not Worker startup time. Native local profiles and remote
startup acceptance remain separate work. See [Wrangler startup profiling](https://developers.cloudflare.com/workers/wrangler/commands/workers/#startup).

Cloudflare changed its platform limit to uncompressed Worker size in September
2026; gzip is informational. The framework does not hardcode a provider limit.
See [Cloudflare's size-limit change](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/).
