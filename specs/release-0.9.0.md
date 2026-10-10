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

Results are recorded here after the corresponding checks finish. Earlier task
counts and receipts are not substituted for verification of the reviewed source.

- [x] Non-Desktop release build (`pnpm run build:release`) and database bundle audit (32 neutral modules; Workers-safe entry).
- [x] Root `pnpm tsc --noEmit` and `pnpm run typecheck -- --exclude-desktop`.
- [x] Non-Desktop unit suites: 6,390 passed, five skipped; includes the CLI unit project (806 passed, three skipped).
- [ ] Installed-package/scaffold acceptance with current 0.9.0 tarballs.
- [ ] GitHub PR checks: CLI integration shards, UI browser and framework E2E.
- [ ] PR merged into master and 0.9.0 release created at the verified revision.
- [ ] npm publication verified for all eleven public workspace packages.

The first clean-checkout CI attempt exposed an omitted internal test-utils build.
The normal workspace build now includes it; publication still excludes it.
The affected guidance inventory (two tests), executable guide coverage (four
tests), publication coverage (two tests) and typechecks passed after the fix.

## Publishing

GitHub's `publish.yml` uses the `Publish to npm` environment and npm trusted
publishing through OIDC. It builds package artifacts, runs the release acceptance
checks and publishes public workspace packages in dependency order. `test-utils` is
excluded. Desktop platform jobs remain manual under the release waiver.

A GitHub release alone does not prove npm publication. The published registry
versions and workflow result are checked separately before calling release done.
