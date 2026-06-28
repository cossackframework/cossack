# Cossack Framework — Improvement Plan

Prioritized list of improvements (security, correctness, leaks, maintainability).
Execution: top-to-bottom, one commit per numbered item, tests + `pnpm tsc --noEmit` before each commit.

Progress: `[ ]` pending · `[~]` in progress · `[x]` done

---

## Phase 1 — Critical Runtime Security (HIGH impact / LOW effort)

The "secure by default" promise is currently bypassable at runtime regardless of how
well the client bundle is stripped. These are small fixes with large security uplift.

- [x] **1.1** XSS via unescaped `__INITIAL_STATE__` — `framework/src/root.ts:60-62`. Escape `<>&\u2028\u2029` before embedding in `<script>`.
- [x] **1.2** No method-name allowlist on RPC — clients can invoke `bootstrap`, `setProperty`, `proxyClientMethods`, etc. Files: `framework/src/router.ts:514`, `transports/http.ts:67`, `core/src/shared/cossack.ts:625` (`executeAction`). Validate `action` against `cossack:server-methods` metadata; reject `_`-prefixed/builtins.
- [x] **1.3** Unvalidated state splat → privilege escalation (client sets `user`, `_runtime`). Files: `framework/src/router.ts:510-512`, `transports/http.ts:63-65`, + 5 state-merge sites in core. Only accept keys in `cossack:state` metadata; block `__proto__`/`constructor`/`_`-prefixed.
- [x] **1.4** SSE `scopeKey` is client-controlled → cross-user eavesdropping. File: `framework/src/transports/sse.ts:80-107`. Recompute scope server-side from authed user; reject mismatched client values.
- [x] **1.5** WebSocket/SSE no Origin validation (CSWSH). Files: `framework/src/transports/websocket.ts:13-38`, `node-adapter/src/index.ts`. Compare `Origin` header to allowlist before upgrade; `verifyClient` in Node.

## Phase 2 — Security Plugin Hardening (HIGH impact / MED effort)

The plugin is architecturally sound but its hand-rolled parser misses several ES member kinds, silently leaking server code.

- [x] **2.1** Leaks via class-property arrow functions, undecorated getters/setters, generators, async generators, computed-name methods — `vite-security-plugin.ts:643, 840-1070`. _(Getters/setters deferred: stripping needs access-aware transitive preservation; documented in code.)_
- [x] **2.2** Duplicate constructor → syntax error breaks the whole client bundle when a class has both `@Server` + `constructor` — `:756-784`.
- [x] **2.3** Brace-depth tracking ignores regex literals → premature method close → leaks — `:108-150, 1057-1067, 1115-1160`.
- [x] **2.4** Add regression tests for 2.1–2.3 + static `@Server` methods. — _woven into each item's commit; static `@Server` covered by existing metadata path._
- [x] **2.5** SSR 500 leaks raw `err.stack` into HTML (XSS + info disclosure) — `framework/src/router.ts:462`.

## Phase 3 — Correctness & Resource Leaks (HIGH impact / MED effort)

Confirmed leaks that compound over SPA sessions and per-navigation.

- [x] **3.1** Renderer never calls `destroy()` on disposed child components → leaks WebSockets, IntersectionObservers, listeners — `renderer/src/cossack-html.ts:279,419`. _(Also fixed: `render()` + `_clearTemplateCache()` now dispose parts on template change, the common leak path.)_
- [ ] **3.2** Optimistic-lock cleanup ordering bug — `_optimisticPendingState` never freed on WS/SSE — `core/src/shared/transport-connections.ts:85-92,172-178`.
- [ ] **3.3** `setInterval(ping, 25000)` handle never captured/cleared — leak per WS provider — `transport-connections.ts:117-121`.
- [ ] **3.4** `@VisibleTask` IntersectionObservers never `disconnect()`-ed in `destroy()` — `cossack.ts:147,1436-1466`.
- [ ] **3.5** WS payload filter drops ALL objects (not just DOM/Event) — breaks `this.updateItem({id:5})` over WS — `method-proxy.ts:689-696`.
- [ ] **3.6** `_cossack_ws_context` shared-mutable per instance → concurrent WS actions cross-route client calls — `cossack.ts:625-639`.
- [ ] **3.7** Unbounded `pageCache` serves stale state after mutations — `framework/src/client/app.ts:71`.
- [ ] **3.8** Unbounded `sseStateStore` + 200ms-poll-per-client driver — `framework/src/transports/sse.ts:26,140-182`.
- [ ] **3.9** `JSON.parse` unguarded in all transport/runtime handlers (cheap DoS) — add try/catch + schema validation.
- [ ] **3.10** `executeAction` has no error boundary → `loading[action]` stuck forever on server throw.

## Phase 4 — Node Adapter & SSG Robustness (HIGH impact / LOW-MED effort)

- [ ] **4.1** Path traversal in `static-serve` — `node-adapter/src/static-serve.ts:79-89` — `path.resolve` + containment check.
- [ ] **4.2** `serveStatic` ignores computed `Content-Type` (serves everything as `text/html`) + uses sync I/O — `:108-111, 93`.
- [ ] **4.3** Path traversal in SSG output writing — `framework/src/ssg-build.ts:91-117` — validate param values.
- [ ] **4.4** SSG build swallows per-page errors and exits 0 — `ssg-build.ts:119-122`.
- [ ] **4.5** SSE framing breaks on multi-line strings — `core/src/shared/runtimes/sse.ts:57-79`.
- [ ] **4.6** DevTools server: `shell:true` + binds `0.0.0.0` = RCE — `framework/vite.config.ts:17-51`.
- [ ] **4.7** Node adapter: hardcoded `user={id:'guest'}`, bypasses DI (`new ComponentClass()`), references global `WebSocket` (Node<22 ReferenceError in core).

## Phase 5 — Routing & SPA Correctness (MED impact / MED effort)

- [ ] **5.1** Catch-all `[...slug]` not supported → invalid Hono route — `router.ts:548-554`.
- [ ] **5.2** Head-merge iteration order appears inverted vs. documented inside-out — `router.ts:399-406` (verify + test).
- [ ] **5.3** Double `pushState` on `this.redirect()` — `client/app.ts:456-461` + `cossack.ts:1322-1324`.
- [ ] **5.4** View-transition object-form `{types}` not feature-detected (Chrome 125+) → throws → full reload.
- [ ] **5.5** Any nav error → `window.location.reload()`, losing client state — `client/app.ts:449-453`.
- [ ] **5.6** Prefetch/navigation fetch race — no in-flight de-dup — `client/app.ts:114-130,465-469`.

## Phase 6 — Maintainability: De-duplication & Dead Code (MED impact / MED effort)

**Duplication to consolidate:**
- [ ] **6.1** `RouterContext` interface declared 3× (`transports/{websocket,sse,http}.ts`).
- [ ] **6.2** `filePathToRoutePath` 3× — SSG & client copies already drifted (missing `.tsx`).
- [ ] **6.3** `getModulePreloads` 2× (`router.ts` ↔ `ssg-renderer.ts`).
- [ ] **6.4** Head-merge sequence 3× (SSR/SSG/client) → `composeHead` helper.
- [ ] **6.5** Optimistic state-application block 6× — hoist `applyState`.
- [ ] **6.6** `extractFiles` 2× + optimistic-handler prologue 3× in `method-proxy.ts`.
- [ ] **6.7** SSR vs SSG render pipeline ~80 lines duplicated → extract `preparePageRender`.

**Dead code to remove:**
- [ ] **6.8** Unused framework deps: `@cossackframework/auth`, `@mdx-js/mdx`, `workerd`, duplicate `tailwindcss` key.
- [ ] **6.9** Unused renderer devDeps: `htmlparser2`, `magic-string`.
- [ ] **6.10** `test-utils` unused `renderer` dep.
- [ ] **6.11** Dead exports: `generateSitemap`, `generateSitemapIndex`, `svg`, + trim internal helpers re-exported through `core/src/index.ts`.
- [ ] **6.12** Dead post-`delete` lookup in `action-complete` handlers (`transport-connections.ts:85-92,173-178`).

**Other:**
- [ ] **6.13** Centralize magic strings (`'cossack_app'`, transport names, reserved keys, `_cossack_*` props).
- [ ] **6.14** Replace pervasive `any` at security boundaries with structural types.
- [ ] **6.15** Add `console.warn` to bare `catch {}` blocks (silent failures are the dominant debuggability theme).

## Phase 7 — `create-cossack-app` Template Health (MED impact / LOW effort)

- [ ] **7.1** Template ships `build:types` referencing non-existent `tsconfig.declarations.json`; `cf-typegen` required before `tsc` works.
- [ ] **7.2** `tsconfig.template.json` references `./worker-configuration.d.ts` which doesn't exist post-scaffold.
- [ ] **7.3** Hardcoded version strings (`^0.1.0`, `^8.16.0`) will drift.
- [ ] **7.4** Regex-based Node-adapter config rewriting (fragile) → placeholder approach.
- [ ] **7.5** Missing `types` field on package; `prettier` in template but not in deps.

---

## Verification strategy (per item)

Each fix gets: a unit test (vitest for core/framework unit; new regression tests for the security plugin), `pnpm tsc --noEmit`, and relevant e2e (`cd packages/framework && pnpm exec playwright test <file>`). Security fixes 1.1–1.5 get a dedicated penetration-style e2e spec.
