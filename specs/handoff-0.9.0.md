# Cossack 0.9.0 agent handoff

Prepared on 2026-10-02 for GLM to continue implementation and Codex to review later.

> **Latest handoff — Codex review (2026-10-02):** read the
> [Codex findings, fixes, and continuation instructions](./release-0.9.0.md#codex-review-2026-10-02)
> before starting the next phase. The seven GLM commits through `e6b7153` were
> reviewed and regression fixes were added. CLI-02, CLI-03, and RT-12 are reopened;
> **8/58 tasks remain checked**. Start with the six concrete continuation tasks
> in that review, then resume the detailed 58-task plan. The older distributed
> SSE prototype instructions below describe the original checkpoint and are
> superseded by the GLM implementation and Codex fixes.

> **GLM continuation (2026-10-02):** the "Immediate continuation: distributed
> SSE" work below is finished — CF-05 is checked in
> [release-0.9.0.md](./release-0.9.0.md) and the design/verification record is
> [specs/sse.md](./sse.md). Deviations from the suggested approach: the
> coordinator's `execute()` takes no AbortSignal (AbortSignal-over-RPC needs
> the experimental `abort_signal` flag, unavailable on the pinned wrangler
> 4.114.0 baseline; cancellation uses response-body cancel propagation and the
> router wires `c.req.raw.signal` to `body.cancel()`), non-stream responses
> pass through `execute()` with an explicit `publish()` by the router callback,
> and the scaffold additionally emits a `COSSACK_ENV_BINDING_NOT_INHERITED`
> preflight diagnostic because Wrangler environments do not inherit Durable
> Object bindings. Environment note: the workspace pnpm virtual store was
> found emptied before this session; `pnpm install` was rerun. The rest of
> this handoff is the original checkpoint record.

Read [the detailed implementation plan](./release-0.9.0-plan.md) before continuing.
It explains all 58 checklist tasks, including their purpose, current baseline,
proposed implementation, dependencies, source locations, and acceptance criteria.
It also gives the suggested execution order and cross-feature acceptance scenarios.

## Status and scope

This is a work-in-progress checkpoint, not a release. The full objective is to
implement all agreed framework, developer-experience, agent-tooling, and
Cloudflare improvements for 0.9.0. The authoritative scope and verification
history are in [release-0.9.0.md](./release-0.9.0.md). Unchecked rows remain in
scope even where a partial implementation already exists. All versions remain
0.8.3 until the entire release passes its gates.

The current branch is `fix-084`. This handoff is committed with the implementation
checkpoint. The user will arrange GLM's continuation; no new agent or chat was
started. The original checkpoint paused the release implementation goal; the later
Codex review has its own completion and verification record above. No packages were published, no changes
were pushed, and no Cloudflare deployment, provisioning, or credential rotation
was performed.

`reports.md` contains the user's own uncommitted replacement of earlier reports
with CSM-004. It is intentionally excluded from the checkpoint. Preserve it.
Its final blank line is the existing exception to `git diff --check`.

## Working rules

- Read root `AGENTS.md`, `specs/architecture.md`, and applicable specs.
- Use pnpm. Run `pnpm tsc --noEmit` after source changes and meaningful tests for
  features and bug fixes. Alpha-stage API breaks are acceptable.
- Keep reusable libraries independent of the framework/application. Keep
  `cloudflare:workers` imports out of core and the Node/Deno runtime import graph.
- Use the installed Cloudflare skills and current official documentation when
  changing Workers, Durable Objects, or Wrangler behavior.
- The tested dependency baseline resolves Wrangler 4.114.0, Cloudflare Vite
  plugin 1.47.0, and Vite 8.1.4. Native Worker Previews require Wrangler 4.135.0
  or later; that upgrade needs compatibility testing.
- Build dependencies before tests that consume published `dist` exports.
  Do not run type checks alongside builds that delete those directories.
  `pnpm test:unit` also runs package pretest builds, so keep it separate from
  `pnpm typecheck`.
- No subagent work was authorized for this checkpoint. Do not assume permission
  to start chats, delegate, send messages, publish, or deploy.

## Implemented and exercised

The release checklist's verification log describes each completed slice. The
main changes in this checkpoint are:

1. **CLI and deployment:** lifecycle flags/help, read-only creation dry runs,
   versioned JSON for creation/deployment/database tools, local Cloudflare
   inspect/check commands, environment selection before Vite/type generation,
   and deployment of the verified built artifact. A deployment dry run writes
   local build artifacts; it performs no upload. Remote readiness is explicitly
   unverified by local checks.
2. **Database tooling:** explicit local/remote and environment context, SQL
   migration plans, read-only history/schema inspection, shared Studio/CLI D1
   discovery, and isolated child-process JSON output. D1 uses real local
   Wrangler/workerd tests. Hyperdrive resource setup is still incomplete.
3. **SSG and assets:** real anonymous Hono requests, middleware/auth checks,
   public-only generation, full validation before writing static output,
   grouped/dynamic layout ancestry, working catch-all routes, and Worker-first
   protected asset handling. SSG constructs and disposes actual DI scopes.
4. **Lifecycle:** awaitable component/service disposal, descendant cleanup, and
   response-owned middleware cleanup. Streaming ORM factories stay alive through
   completion or cancellation. Cloudflare ORM scaffolding supplies async-local
   scope without adding Node imports to neutral database entry points.
5. **HTTP/SSE component RPC:** one POST per action, shared promise/iterator result,
   incremental bounded NDJSON frames, correlated errors, cancellation, and
   original request/ORM context during generator pulls. Failures now reject
   instead of resolving `undefined`. WebSocket and explicit service RPC parity
   are unfinished; authored generator methods still lack precise client-result
   type inference. Automatic optimistic rollback and stale-task cancellation
   remain unfinished.
6. **Reported regressions:** Tabs uses one sliding underline, UI accepts compatible
   Solar Icons patch releases, and framework library declarations no longer
   compile the demo through generated Worker types.

Generated-app tests in `packages/cossack/tests/deploy-integration.test.js` use
actual published package exports, Vite, Wrangler, and workerd. They cover staging
configuration, D1 queries between stream frames, layout services, cancellation
over native HTTP, public SSG, and protected assets. These are local tests, not
evidence of a live deployment.

## Original checkpoint history: distributed SSE prototype

**Historical baseline at `289d181`, superseded by the later GLM/Codex work.**
At that checkpoint the application still used Worker-local SSE state. The last
implementation step had added a coordinator prototype:

- `packages/framework/src/SseDurableObject.ts`: native Cloudflare Durable Object,
  SQLite snapshot/event history, first-initialization-wins behavior, bounded
  pending actions/history, explicit per-scope action serialization, and callback
  RPC to execute the action in its original Worker request. Each action owns
  its response stream and holds the serialization slot until that stream closes.
- `packages/cossack/tests/sse-coordinator-integration.test.js`: two real Workers
  call the same DO namespace. It checks concurrent increments, callback
  AsyncLocalStorage context, separate scopes, state after harness reload, and
  continued progress after canceling a native HTTP response.

The prototype is **not exported from package.json, not included in the library
declaration build, not called by the router, and not scaffolded**. Its source is
covered by the framework package's normal type check. The integration test
imports the source directly; it does not prove that a generated application
uses the new backend. TypeScript errors from the initial prototype were fixed
before this checkpoint (SQL row type aliases and explicit iterator return values).

Continue with these concrete tasks:

1. Review the coordinator's stream ownership and queue release on callback
   failure, malformed/oversized frames, cancellation before and during execution,
   a disconnected queued caller, and DO restart during an action. Do not claim
   exactly-once external database side effects or automatically replay mutations.
2. Add a Cloudflare-only public entry and generated `COSSACK_SSE` binding with
   `new_sqlite_classes`. Keep native Cloudflare imports outside neutral runtime
   modules. Missing required bindings should produce an actionable diagnostic.
3. Replace Cloudflare's global store in `framework/src/transports/sse.ts` and
   integrate SSR and `/crpc` in `framework/src/router.ts`. Recompute authorized
   scopes before constructors/actions. Use collision-safe tuple keys. Preserve
   request middleware, layout DI, ORM lifetime, rate limits, and action allowlists.
4. Initialize shared state once, hydrate authoritative state before executing a
   mutation, and prevent stale browser snapshots or another SSR request from
   overwriting it. Define child-component/service state ownership explicitly.
5. Support ordinary results, redirects, cookies, custom Responses, and generators
   consistently. The current coordinator only accepts successful NDJSON responses;
   the existing router still returns JSON for ordinary calls.
6. Add subscriptions with bounded buffering, cursor-based reconnect, and snapshot
   resynchronization when history expires. The coordinator's `updates()` is only
   a polling primitive; no browser subscription currently uses it. Add broadcast
   events/client actions; the prototype currently records state updates only.
7. Decide and document the Node/Deno backend contract. Their process-local behavior
   must not accidentally become the Cloudflare fallback.
8. Expand actual generated-app/workerd tests to cover the integrated backend,
   authorization, stale concurrent mutations, reconnect, failure, cleanup, history
   bounds, and restart behavior. Retain the existing D1/context stream tests.

Useful official references:

- [RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)
- [RPC supported values and streams](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Durable Object base class](https://developers.cloudflare.com/durable-objects/api/base/)

Do not hold `blockConcurrencyWhile()` across callback RPC or application I/O.
Use it for initialization. The prototype uses an explicit queue for actions.

## Remaining release work and later review

After SSE, follow every unchecked item in the release checklist. Major untouched
areas include compiler-backed inspection/explanation, local MCP, offline agent
guides, upgrades/recipes, validated actions/forms, typed routes/URL state,
transport parity, resource authorization, jobs/Cron/Workflows/notifications,
storage/Turnstile, observability, and isolated preview/CI lifecycles. This list is
orientation only; it does not replace or reduce the checklist.

For Codex's later review, compare GLM's commits against this checkpoint. Verify
the actual runtime behavior, published entry points, and generated applications,
not just new tests or checked boxes. Pay particular attention to request I/O
ownership across RPC, cleanup under cancellation, shared-state concurrency,
authorization before execution, secret redaction, and runtime import boundaries.
Keep release versions and release-complete claims gated on the full audit.

Tracked demo secret values were removed earlier. Any still-active credentials
need external rotation; rotation was not performed. Do not copy old values from
Git history into notes or logs.

## Checkpoint verification

The following commands passed on 2026-10-02 after the prototype type fixes:

- `pnpm build`
- `pnpm tsc --noEmit`
- `pnpm typecheck` — all 11 package checks, including the prototype source.
- `pnpm audit:bundle` — 28 neutral modules and the Workers-safe Cloudflare entry.
- `pnpm test:unit` — 2,125 tests across 12 packages, including both real-workerd
  integration tests. Counts: auth 118, renderer 256, database 84, scaffold 82,
  core 615, node-adapter 10, UI 112, framework 515, CLI 262, desktop 16,
  deno-adapter 3, and Studio 52.
- `git diff --check -- . ':!reports.md'`

No Playwright E2E suite, full published-tarball matrix, or live remote deployment
was run for this checkpoint. Existing local integration coverage does not close
those release gates. No test or build process remains running from this handoff.
