# Cossack 0.9.0 release record

Release target: `master`, version/tag `0.9.0`. Supported web runtimes are
Cloudflare Workers and Node.js. Deno support was removed during final review;
see the [migration guide](./migration-0.9.0.md#deno-support-removed).

All twelve workspace packages use version 0.9.0. Eleven are public;
`test-utils` is private and remains internal by the user's decision. Solar Icons is external and
keeps its existing `^0.7.1` dependency range; it is not part of this publication.
Desktop's remaining platform acceptance is waived by the user's decision.
No waived Windows/macOS installer, signing or Desktop runtime check is claimed
as passed. Desktop publication includes its package artifact only.

## Changes and review

The original 58-item implementation checklist was completed before final review.
Historical plans, handoffs and verbose test journals remain in Git history at
`36df3388`; this file replaces those working documents. Deno acceptance is no
longer part of the supported runtime matrix.

Claude's final review fixes cover server-source stripping and client source maps,
trusted rate-limit addresses, concurrent action identities, immutable RPC state,
optimistic state snapshots, SSE long-poll invalidation, and duplicate Workflow
invocation keys. Integration tests now run in explicit CLI/UI browser tiers.
The installed-package gate was repaired after Deno removal. Codex reviews these
changes, reconciles release automation and verifies the final artifacts.

Read the [release notes](./release-notes-0.9.0.md),
[migration guide](./migration-0.9.0.md) and [changelog](../CHANGELOG.md) for the
supported API changes. Architecture and feature specifications remain under
`specs`; temporary release plans and local logs are removed.

## Final verification — Codex, 2026-10-10

Verified implementation revision: `a298265b4099bf98c80498600e5224926c8d650b`.
Later release-record edits do not change package behavior.

- [x] Non-Desktop release build and database bundle audit (32 neutral modules; Workers-safe entry).
- [x] Root `pnpm tsc --noEmit` and `pnpm run typecheck -- --exclude-desktop`.
- [x] Non-Desktop unit suites: 6,393 passed and five skipped locally. Final clean-checkout CI: 6,387 passed and eleven skipped; the six artifact-dependent SSG cases skipped during unit execution were covered by the subsequent SSG output suite.
- [x] Final installed-package/scaffold acceptance: declaration/runtime imports, offline CLI/MCP, configuration secrecy, budgets, native D1 migrations, generated recipes and bidirectional Node RPC. Private test-utils is a local acceptance artifact; Desktop platform checks are excluded.
- [x] Final [CLI integration and UI browser run](https://github.com/cossackframework/cossack/actions/runs/38030885483): 397 CLI tests passed, eleven skipped; all 35 UI browser tests passed.
- [x] Final [Framework/Studio run](https://github.com/cossackframework/cossack/actions/runs/38030885475): 281 Framework E2E tests, 14 SSG output tests and the complete Studio browser scenario passed, together with build, typechecks, units and installed acceptance.
- [ ] PR merged into master and 0.9.0 release created at the verified revision.
- [ ] npm publication verified for all eleven public workspace packages.

Codex fixed three runtime issues exposed during acceptance: late popup-close
notifications clearing MultiSelect validation; short transcripts resuming
following after upward keyboard intent; and a background tooltip consuming
Escape intended for a foreground modal. Deterministic browser regressions,
component tests, rebuilt Studio and the final combined hosted checks passed.

The normal workspace build now includes internal test-utils. Acceptance fixtures
read complete RPC frames across network chunks, allow only Node 22's exact
SQLite experimental warning, await controlled/native callback state, save
malformed authored pages atomically, and exercise Worker API contracts through
the native HTTP listener. Studio creates migration history through the public
MigrationRunner; its full scenario uses a two-minute budget with individual
assertion limits unchanged. Temporary debug instrumentation was removed.

Installed documentation checks cover 108 guides and 114 examples, including
35 changed examples. That helper's native Workflow execution was not run;
its server fixture check is helper-contract-only and its browser fixture check
uses jsdom. These are not represented as hosted provider or browser acceptance.
Separate installed/native browser suites passed as listed above.

Historical plans/handoffs remain at `36df3388`. Seven obsolete working journals
and 353 owned historical temporary artifacts were removed. This compact record
replaces the checklist, plan, verification archive and handoff for the release.
The only outstanding release tasks are merge/release creation and registry
publication verification; no implementation task or Desktop platform check is
reopened.

## Publishing

GitHub's `publish.yml` uses the `Publish to npm` environment and npm trusted
publishing through OIDC. It builds package artifacts, runs the release acceptance
checks and publishes public workspace packages in dependency order. `test-utils` is
excluded. Desktop platform jobs remain manual under the release waiver.

A GitHub release alone does not prove npm publication. The published registry
versions and workflow result are checked separately before calling release done.
