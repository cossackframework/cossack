# Cossack 0.9.0 agent handoff

Prepared on 2026-10-02 for GLM to continue implementation and Codex to review later.

> Latest checkpoint: Codex nested drafts (2026-10-03).
> Author: **Codex**. Continued after `3af248d`. Read the
> [verification](./release-0.9.0.md#codex-nested-drafts-2026-10-03),
> [RT-09 next steps](./release-0.9.0-plan.md#rt-09) and
> [draft contract](../docs/url-state.md).
>
> Renderer checkpoints preserve declared drafts in the rendered child tree.
> Matching checks template/position/key, class, parent and service scope.
> Separate destination and rollback checkpoints feed fresh child owners before
> state initialization and mount. Destroyed instances stay destroyed. Publication
> predicates reject late restores. Core releases consumed initialization maps.
> Partial repeat() failure now disposes early siblings instead of leaking them.
>
> Node/native workerd browsers cover nested page/layout drafts, grandchild File
> values and restored state observed by mount hooks after post-render rollback.
> Final renderer: 273 tests; full core: 1,432 before a final one-line map release,
> then all 9 focused draft tests. Final framework: 1,439. Rebuilt production
> browsers (Node/workerd), root TypeScript and all 11 package checks passed.
> Full CLI had 607 passes and one five-second creation-test timeout; that test
> passed on retry in 1.9 seconds. The full run preceded the final wrapper/map
> refinements. See the linked checkpoint for commands and precise limits.
> No owned test/build process remains.
>
> **No task closes: 22/58 checked, 36 unchecked.** Next implement inactive cache()
> stash recovery, including another navigation before a stashed branch is shown.
> Do not reuse single-use capabilities or read destroyed owners. Expand actual
> ownership-change/late-proxy/hook-failure cases, then same-URL interrupted history,
> backend read counts and diagnostic events. The detailed RT-09 plan explains
> these steps. Keep all other unchecked tasks and versions at 0.8.3 until REL-04.
>
> Preserve reports.md/.zcodeignore. No push, publication, live cloud change,
> external message or new chat occurred.
>

> Previous checkpoint: Codex scope retirement (2026-10-03).
> Author: **Codex**. Reviewed and continued after `773c9c3`. Read the
> [verification](./release-0.9.0.md#codex-scope-retirement-2026-10-03),
> [RT-09 next steps](./release-0.9.0-plan.md#rt-09) and
> [navigation contract](../docs/prevent-navigation.md).
>
> Fixed service disposal before renderer-created descendants finish cleanup.
> Navigation destruction still cancels tasks immediately. Scope disposal waits
> for DOM consumers and their async cleanup, including ancestor scopes. The same
> hold applies when successful navigation removes a child before cleanup finishes.
> New consumers cannot attach to retiring scopes; an owner cannot wait on its own
> scope hold. Renderer connection/hydration failures clean partial sibling parts,
> and throwing disconnection hooks cannot skip sibling destruction.
>
> Verification results are recorded in the linked checkpoint. Generated production
> Node/native workerd acceptance covers post-render failure, restored URL and
> page/layout/service/File state, plus gated child cleanup on both rollback and
> successful retirement. Renderer: 261 tests. Full core: 1,431 plus the final
> 5-case retirement file. Full CLI: 608 before the final successful-retirement
> change. After rebuilding, full framework (1,439), both production browsers,
> root TypeScript and all 11 package checks passed. No owned process remains.
>
> **No checkbox closes: 22/58 checked, 36 unchecked.** Next: capture nested local
> child drafts before partial DOM teardown and restore only into matching new
> owners. Never revive Destroyed components. Audit changed parent/scope/provider
> ownership, interrupted same-URL history, real backend read counts and diagnostic
> events. RT-08/RT-09 remain open; preserve every other unchecked release task.
> Versions remain 0.8.3 until REL-04.
>
> Preserve reports.md/.zcodeignore. No push, publication, live cloud change,
> external message or new chat occurred.
>

> Previous checkpoint: Codex render recovery (2026-10-03).
> Author: **Codex**. Continued after `457646e`. Read the
> [verification](./release-0.9.0.md#codex-render-recovery-2026-10-03),
> [RT-09 plan](./release-0.9.0-plan.md#rt-09) and
> [public contract](../docs/prevent-navigation.md#navigation-completion-contract-glm-2026-10-02).
>
> Core owns a navigation render pass that bypasses stale update promises,
> propagates render errors and stops later callbacks after revocation. Before
> history commit, failed/canceled publication restores the prior page/layout
> map, request/user/resource contexts, service binding and global SSR state.
> The outgoing page remains alive until success. After commit, cleanup errors
> leave the committed destination current. Pending restored reads can reload.
>
> Controlled cases cover error/veto/deadline recovery and newer navigation while
> an old render waits. Generated Node/native workerd apps verify App.render
> failure recovery and navigation past an actual never-settling App update.
> Full core: 1,427/84 files. Full framework: 1,439/68 files. Full CLI: 608/44 files
> before final callback guards. After the final rebuild, full framework, both
> production URL browser cases, root TypeScript and all 11 package checks passed
> again. No owned test/build process remains.
>
> **No checkbox closes: 22/58 checked, 36 unchecked.** Next: partial DOM teardown
> with nested drafts and transient scoped services. Do not revive destroyed
> components. Capture local child drafts before retirement and restore them only
> into matching new owners. Keep transient scopes available until rollback DOM
> reconciliation removes their descendants; revoke task publication immediately.
> Then finish changed/nested ownership, interrupted same-URL history, backend read
> counts and diagnostics. Application side effects remain outside rollback.
> Continue every other unchecked task. Versions stay 0.8.3 until REL-04.
>
> Preserve reports.md/.zcodeignore. No push, publication, live cloud change,
> external message or new chat occurred.
>

> Previous checkpoint: Codex draft target isolation (2026-10-03).
> Author: **Codex**. Continued after `c80fef6`. Read the
> [verification](./release-0.9.0.md#codex-draft-isolation-2026-10-03),
> [RT-09 plan](./release-0.9.0-plan.md#rt-09) and
> [draft contract](../docs/url-state.md).
>
> Fixed shared raw targets between old and new page drafts. Capabilities now
> snapshot plain records/arrays, including null-prototype records, as one graph.
> Cycles, aliases, data attributes and File identity survive. Native/class/function
> values remain opaque references; arbitrary capability internals are not isolated.
> Accessors in draft records fail before publication without invoking their getters.
>
> Saved-proxy and cleanup-time writes cannot alter copied new-owner targets.
> Actual Node/native workerd browsers now retain an old proxy, navigate, write
> through it, force the new page to render and check its draft. Both pass along
> with the previous query/File/history/resource cases. Full core: 1,420/84 files.
> Full framework: 1,435/68 files. Both builds, framework SSG, root TypeScript and
> all 11 package checks pass. Full CLI was not rerun. No owned process remains.
>
> **No checkbox closes: 22/58 checked, 36 unchecked.** The raw plain-draft target
> issue identified in the prior handoff is fixed. Continue shared App rendering
> and recovery after publication, interrupted history, changed/nested owners,
> actual backend read counts and the diagnostic acceptance matrix. Do not claim
> rollback of arbitrary application effects or isolation of opaque capabilities.
> Keep every other unchecked release task in scope. Versions stay 0.8.3 until REL-04.
>
> Preserve reports.md/.zcodeignore. No push, publication, live cloud change,
> external message or new chat occurred.
>

> Previous checkpoint: Codex staged navigation (2026-10-03).
> Author: **Codex**. Continued after `2aa46fb`. Read the
> [verification](./release-0.9.0.md#codex-staged-navigation-2026-10-03),
> [RT-09 continuation](./release-0.9.0-plan.md#rt-09) and
> [public contract](../docs/prevent-navigation.md#navigation-completion-contract-glm-2026-10-02).
>
> Page/layout preparation runs outside the commit queue. The old page survives
> until publication. New owners defer tasks, transport connections, retained
> service binding and mount hooks. Latest same-owner drafts transfer at publication.
> Canceled preparation destroys its new instances. A controlled regression now
> completes the newer navigation before releasing the old bootstrap.
>
> One NavigationOwner bounds asynchronous navigation waits to 30 seconds and
> reports COSSACK_NAVIGATION_TIMEOUT. Guards, fetch, imports, bootstrap and
> transition/commit waits race that owner. The shared fetch reader contract stays
> intact. History recovery retains its separate two-second limit. A late
> transition callback after expiry cannot publish its prepared tree.
>
> Full core: 1,415 tests / 83 files. Final full framework: 1,434 / 68 files.
> Both package builds, framework SSG, root TypeScript and all 11 package checks
> pass. Full CLI: 608 tests / 44 files, including generated production Node/native
> workerd acceptance. Total: 3,457 tests. No owned test/build process remains.
>
> **No checkbox closes: 22/58 checked, 36 unchecked.** Next: shared App render
> state and recovery after publication; late writes through disposed owners'
> saved store proxies; interrupted history; real changed/nested ownership and
> backend read counts; diagnostics and full RT-08/RT-09 criterion audits.
> Prepared-state cancellation does not roll back application effects after
> publication. Keep that limit explicit. Continue every other unchecked task.
> Versions remain 0.8.3 until REL-04. Preserve reports.md/.zcodeignore.
>
> No push, publication, live cloud change, external message or new chat occurred.
>

> Previous checkpoint: Codex navigation fetch ownership (2026-10-03).
> Author: **Codex**. Continued after `b0da7d0`. Read the
> [verification](./release-0.9.0.md#codex-fetch-ownership-2026-10-03),
> [RT-09 plan](./release-0.9.0-plan.md#rt-09) and
> [public contract](../docs/prevent-navigation.md#navigation-completion-contract-glm-2026-10-02).
>
> Navigation and prefetch now own independent readers of a shared page request.
> Supersession settles the old fetch wait immediately. The last reader leaving
> aborts the underlying fetch/body. Each reader has a 30-second response deadline
> with COSSACK_NAVIGATION_FETCH_TIMEOUT. Active readers keep their shared request.
> Late ignored work cannot preload modules or refill the cache after abandonment.
> Invalidation detaches old work while preserving existing readers and epoch checks.
>
> Eight new tests cover sharing, independent deadlines, invalidation, retry,
> ignored aborts, late failures and the real navigation fetch/body boundary.
> Full framework: 1,426 tests / 67 files. Framework ESM/declaration/SSG build,
> root TypeScript and all 11 package checks pass. Both generated production
> Node/native workerd URL browser tests pass. Full core/CLI suites were not rerun.
>
> **No checkbox closes: 22/58 checked, 36 unchecked.** This bounds response
> loading only. Guards, imports, bootstrap, rendering, transitions and the commit
> queue still need owned cancellation/deadlines and staged publication. Extend
> the existing fetch reader contract when implementing the whole-navigation
> owner. Do not remove shared-reader isolation or permit late cache writes.
> Keep retained services bound to the committed request until publication, and
> preserve outgoing draft edits while new components prepare. Continue every
> other unchecked release task. Versions remain 0.8.3 until REL-04.
>
> Preserve user-owned reports.md/.zcodeignore. No push, publication, live cloud
> change, external message or new chat occurred.
>

> Previous checkpoint: Codex terminal disposal review (2026-10-03).
> Author: **Codex**. Continued after `7b40e71`. Read the
> [verification](./release-0.9.0.md#codex-terminal-disposal-2026-10-03) and
> [RT-09 continuation](./release-0.9.0-plan.md#rt-09).
>
> Fixed component resurrection during bootstrap. Disposal is now terminal across
> lifecycle phase restoration. A destroyed component cannot restart bootstrap or
> reconnect through connectedCallback. Bootstrap checks disposal after task
> scheduling, server get/init, DOM mount and onMount. It does not open transports
> after disposal at the task boundary or call clientInit after disposal in onMount.
> The bootstrapping flag clears on every exit, including failure.
>
> Eight new regressions pass. Full core: 1,412 tests / 83 files. Full framework:
> 1,418 / 66 files. Root TypeScript, all 11 package checks and the core ESM/types
> build pass. CLI/native browser suites were not rerun for this focused change.
> Their previous results belong to the previous checkpoint.
>
> **No checkbox closes: 22/58 checked, 36 unchecked.** This fixes a prerequisite
> for staged navigation disposal. It does not add navigation cancellation,
> deadlines, atomic staging or rollback. GLM must continue RT-08/RT-09 using the
> plan below. Standard runTasks schedules async work in the background; test
> stalled bootstrap with an explicit delayed bootstrap override, not a normal
> async Task. Preserve outgoing edits and retained service request ownership.
> Aborting staged work must dispose only its new page/layout/scope instances.
>
> Versions remain 0.8.3 until REL-04. Preserve user-owned reports.md/.zcodeignore.
> No push, publication, live cloud change, external message or new chat occurred.
>

> Previous checkpoint: Codex pending history review (2026-10-03).
> Author: **Codex**. Continued after `f53961e`. Read the
> [verification](./release-0.9.0.md#codex-pending-history-2026-10-03),
> [updated RT-08 plan](./release-0.9.0-plan.md#rt-08),
> [RT-09 continuation](./release-0.9.0-plan.md#rt-09) and
> [public history guard contract](../docs/prevent-navigation.md#guards-during-back-and-forward).
>
> Fixed guarded back/forward leaving the browser address ahead of its visible
> page. Current-app entries carry positions while preserving application/scroll
> metadata. Restoration uses browser history and skips guard/fetch repetition.
> Confirmation resumes the original entry without adding another entry. Failed
> fetches/modules restore the prior owned entry before error reporting. Missing
> restoration events fail after two seconds with the documented code; foreign
> or overwritten positions cannot be inferred.
>
> All page/layout modules resolve before live contexts/resources/tree or global
> SSR state publication. Obsolete imports cannot create a stale page/layout.
> The final framework render is skipped after superseded bootstrap. This is not
> atomic rollback or bounded application bootstrap. Ordinary HTTP hydration
> uses getRandomValues for ownership tokens and does not require randomUUID.
>
> Actual generated Node/native workerd browsers cover guarded back, confirmation,
> retained application state, failed back fetch and back/replace/forward while
> an old actual SSR response stays held. File/page/layout/service drafts survive.
> Later patches exclude abandoned intent; matching resources make zero extra
> hydration RPCs. Controlled import/history tests and package checks are recorded
> in the linked verification. Final results: full core 1,404/83 files,
> framework 1,418/66 files, CLI 608/44 files (3,430 tests total). Root TypeScript
> and all 11 package checks passed. Both production browser cases passed again
> after the final HTTP token rebuild. Four guide examples compile; 400 local
> links/anchors resolve. No owned build/test process remains.
>
> No checkbox closes: **22/58 checked, 36 unchecked**. Next for GLM: finish
> staged bootstrap/render/transition ownership and cancellation/deadlines so a
> stalled old bootstrap cannot block a newer valid navigation. Handle interrupted
> history restoration and unknown entries. Then prove changed/nested owners,
> cleanup and actual backend read counts before auditing RT-08. RT-09 retains
> its complete cache/scroll/fragment/transition/diagnostic matrix. Continue all
> other unchecked release tasks. Versions stay 0.8.3 until REL-04.
>
> Preserve user-owned reports.md/.zcodeignore. No push, publication, live cloud
> changes, external messages or new chats were performed.
>

> Previous checkpoint: Codex query ownership review (2026-10-03).
> Author: **Codex**. Continued after `c133495`. Read the
> [verification](./release-0.9.0.md#codex-query-ownership-2026-10-03),
> [updated RT-08 context and four next steps](./release-0.9.0-plan.md#rt-08),
> [public API guide](../docs/url-state.md) and
> [migration notes](./migration-0.9.0.md#browser-query-context-and-history).
>
> Reviewed and fixed same-page draft loss, retained-layout stale resource entries,
> overlapping patch loss, and merging a disposed owner's abandoned patch.
> Typed updateUrlState delegates to existing navigation ownership. Reads stay
> committed while updates merge against pending intent. Guards, failures,
> supersession and disposal release the matching intent.
>
> Same-page replacement transfers only declared local ClientState/ClientStore
> values through a class-bound, single-use opaque capability. SSR internal JSON
> cannot restore drafts. Store proxies belong to the new page; declared native
> File values survive. Browser file-input DOM values do not restore. Query
> loading leaves the current page editable, so drafts changed during a delayed
> fetch transfer at commit. Copied tabs and unrelated pages start new drafts.
>
> Retained layouts adopt matching SSR resource entries before changing their
> destination. Old pending results/errors cannot publish into those entries.
> Layout services and local drafts stay owned by their layout. Review caught
> an initial ownership check using the child page's transport; it now uses the
> layout's own transport. SSE/HTTP child-page transitions must retain shared
> layout services and their in-flight calls. Do not revert this distinction.
>
> Controlled core/framework cases and both generated Node/native workerd
> browsers cover these contracts. Production cases include copied tabs,
> unrelated-page reset, File/page/layout/service drafts, ordinary back/forward,
> replace, rapid patches, guards, failed fetches and a held old SSR response.
> The newer query commits first with zero extra hydration /crpc requests.
> Final checks: root TypeScript and all 11 package checks; full core 1,396/83
> files; final full framework 1,412/66 files; revised guide examples; 387 local
> documentation links/anchors. The first full CLI run had 606 passes and two
> failures for the layout regression. Both failures plus both URL production
> cases passed after correction (four tests, two files). The complete CLI suite
> was not rerun after the focused fix. See the linked verification for commands.
> No owned build/test process remains.
>
> **No checkbox closes:** 22/58 checked, 36 unchecked. RT-08 remains open.
> Next for GLM: pending back/forward/replace and staged commits; changed/nested
> ownership and cleanup; actual backend read counts; full criterion audit.
> RT-09 retains bounded fetch/guard/bootstrap/transition completion and its
> cache/scroll/diagnostic matrix. Replacing resource entries does not abort
> application I/O or prove one backend read. The current fixtures do not prove
> atomic rollback of arbitrary application bootstrap or nested child drafts.
>
> Continue every other unchecked task. Versions remain 0.8.3 until REL-04.
> Preserve user-owned reports.md and .zcodeignore. No push, publication, live
> cloud changes, external messages or new chats were performed.
>

> Previous checkpoint: Codex RT-08 query contracts (2026-10-03). Author: Codex.
> Continued after `25eab9c`. Read the
> [verification](./release-0.9.0.md#codex-url-state-contracts-2026-10-03),
> [criterion audit and five next steps](./release-0.9.0-plan.md#rt-08),
> [URL-state guide](../docs/url-state.md), and
> [migration notes](./migration-0.9.0.md#browser-query-context-and-history).
>
> No checkbox closes: 22/58 checked, 36 unchecked. RT-08 remains open.
> Core now exports immutable inferred query declarations through its root and
> portable /url-state entry. Strict codecs/defaults cover strings, finite numbers,
> safe integers, booleans, enums, repeated arrays, optional and sync custom values.
> Patches preserve unrelated encoded pairs/fragments and reject extra keys,
> accessors, sparse arrays and invalid values. Bare array keys mean an empty list.
> Query/field bounds and fixed diagnostics are documented and tested.
>
> Browser request/query contexts now own the destination before history commits.
> Initial hydration retains the visible fragment; retained layouts receive the
> new URL. Navigation supports explicit push/replace and retains unrelated
> history data. Real generated Node/native workerd browser tests cover copied
> Unicode URLs, invalid defaults, back/forward, replace, fragments and page
> resource SSR hydration without extra RPCs. The guide's two examples compile.
>
> Final checks passed: root TypeScript, all 11 package type checks, full core
> 1,391/82 files, framework 1,406/66 files and CLI 608/44 files: 3,405 tests.
> Core and framework declarations built before these suites. The CLI run includes
> actual client/server builds and both new native browser fixtures. No owned
> build/test process remains.
>
> Next for GLM: continue RT-08 from the five concrete steps in the detailed plan.
> Add a typed updater that merges overlapping patches against pending intent.
> Preserve local declared ClientState/ClientStore drafts for same-page queries
> through trusted framework ownership; remote SSR JSON cannot supply them.
> Hydrate retained-layout resources from matching SSR data without duplicate
> reads, and prevent old reads from overwriting the new dependency or URL.
> Extend both native browser fixtures with delays, drafts, guards, failures,
> overlaps and pending history changes. Then audit every original criterion.
> Normal navigation currently recreates pages; the current fixture does not
> certify those remaining cases. RT-09 still owns bounded completion and its
> larger navigation matrix.
>
> Continue all other unchecked tasks. RT-01/RT-11, plain Node Vite dev and native
> Deno/Electron gates remain open. Versions stay 0.8.3 until REL-04. Preserve
> reports.md/.zcodeignore. No push, publication, live cloud changes, external
> messages or new chats.
>

> Previous checkpoint: Codex RT-07 completion (2026-10-03). Author: Codex.
> Continued after `b82ba4b`. Read the
> [completion evidence](./release-0.9.0.md#codex-route-boundaries-2026-10-03),
> [criterion audit](./release-0.9.0-plan.md#rt-07),
> [boundary guide](../docs/routing.md#unknown-urls-and-boundary-identity), and
> [migration notes](./migration-0.9.0.md#file-routes-and-boundary-identities).
>
> RT-07 is newly complete. All 58 original task IDs remain:
> 22 checked and 36 unchecked. No other checkbox changed.
>
> The production fixture reproduced grouped/dynamic unknown URLs selecting
> the root 404 without component policies. The pure source-prefix resolver now
> selects an effective owner, retains parameters and uses common ancestry for
> ambiguous groups. Every 404/error component retains its own source ID.
> Boundary middleware runs before rendering and entered source declarations run
> once. Guard responses, global scope and after-next headers remain intact.
> SSR and browser select the same boundary component. Valid 404/500 documents
> hydrate and navigate without entering the successful-page cache.
>
> PageOptions.route never registered an alternate URL and had no in-repo callers.
> Its public declaration is removed. JavaScript decorators and compiler
> inspection reject it without evaluating its value. File placement defines URLs.
> CLI explanations use the exact source path for nonaddressable boundaries.
> Default-export and decorator import aliases remain supported.
>
> Final checks passed: root TypeScript, all 11 package type checks, full core
> 1,348/78 files, framework 1,404/66 files and CLI 606/44 files. Core/framework
> full builds finished before these suites. The CLI run includes actual generated
> Node/native workerd and browser boundary acceptance plus final source/middleware
> inspection comparisons. The linked evidence records the earlier concurrent
> CLI timeout and unchanged passing rerun.
>
> Next for GLM: implement [RT-08](./release-0.9.0-plan.md#rt-08) from the six
> concrete starting steps. Define portable query codecs/defaults first, share
> parsing across SSR/hydration, then integrate push/replace history and resource
> dependencies. Prove copied URLs, Unicode, invalid numbers, arrays, defaults,
> unrelated keys, back/forward and rapid edits in real browsers. Native API query
> contracts do not supply page URL state. RT-09 still owns bounded navigation
> completion, cancellation and diagnostics.
>
> Continue all other 36 unchecked CLI/runtime/service/Cloudflare/release tasks.
> RT-01/RT-11, plain Node Vite dev and native Deno/Electron gates remain open.
> Versions stay 0.8.3 until REL-04. Preserve reports.md/.zcodeignore. No push,
> publication, live cloud changes, external messages or new chats.
> No owned build/test process remains at this checkpoint.
>

> **Previous checkpoint — Codex RT-07 native API contracts (2026-10-03). Author: Codex.**
> Continued after `7f4ce93`. Read the
> [review/evidence](./release-0.9.0.md#codex-api-contracts-2026-10-03),
> [detailed RT-07 checkpoint and remaining steps](./release-0.9.0-plan.md#rt-07),
> and [API guide](../docs/api-routes.md#declared-input-and-output).
>
> **21/58 checked, 37 unchecked. No checkbox newly closes. RT-07 stays open.**
> Native API declarations, guard ordering and generated API types are now
> implemented. `defineApi` lives at the portable framework `/api` entry.
> Its explicit params/query/body schemas infer parsed input. Authorization
> follows parsing and precedes the handler. JSON output schemas validate before
> serialization; omitting output requires a native Response. Cookies, redirects,
> status and streams have direct and production acceptance.
>
> Input uses bounded streamed JSON, fatal UTF-8 and explicit repeated query
> array declarations. Request abort/deadline stops framework waits through
> parsing, authorization, handler and output. Ignored callbacks remain observed;
> late bodies are cancelled. This does not roll back writes or terminate ignored
> application I/O. Native stream lifetime after headers remains application-owned.
>
> Shared AST classification follows canonical factory imports and local aliases,
> namespace imports and default aliases. It strips private modules before client
> dependency loading. CLI `apiContracts` reports source lines, effective methods,
> declared locations and structural output/authorization facts. Dynamic contracts
> stay unknown. Generated ApiRequest/ApiResponse use type-only actual exports.
> Plain handlers retain unknown contracts. Class defaults do not falsely expose
> ignored named native contracts. Default native precedence uses method `'*'`.
>
> Actual generated Node and native workerd apps pass the shared acceptance.
> D1 verifies zero mutations after invalid/unauthorized requests and exactly one
> after valid input. Package-export and generated-import negative types pass;
> client chunks contain no private schema/refinement/output sentinels or SQL.
> Review also fixed discarded context cookies and duplicate native cookies.
>
> **Next for GLM:** audit unknown-URL 404 behavior under grouped/dynamic source
> ancestry, then resolve unused `PageOptions.route` by removal with migration
> guidance or complete cross-runtime aliases. Compare every original RT-07
> criterion before checking it. Keep all other 37 unchecked tasks in scope.
> RT-01/RT-11, plain Node Vite dev and native Deno/Electron gates stay separate.
> Versions remain 0.8.3. Preserve reports.md/.zcodeignore. No push/publication,
> live cloud operations, external messages or new chats.
> Final commands/counts appear in the linked evidence. No owned process remains
> after this handoff.
>

> **Previous checkpoint — Codex RT-07 route generation (2026-10-03). Author: Codex.**
> Continued after `d3b8c5b`. Read the
> [review/evidence](./release-0.9.0.md#codex-typed-routes-2026-10-03),
> [detailed remaining RT-07 plan](./release-0.9.0-plan.md#rt-07), and
> [typed URL guide](../docs/routing.md#typed-urls).
>
> **21/58 checked, 37 unchecked. RT-06 is complete. RT-07 stays open.**
> Vite, emitted manifests and CLI now share discovery, URL translation, source
> ancestry and IDs. Declarations/tests/fixtures are excluded consistently.
> Markdown follows explicit selection. Client generated code contains public
> patterns plus core's portable helper and no application module imports.
>
> Import `routes` from `virtual:cossack-routes`. It resolves to the generated
> `.cossack/routes.ts`, which new recipes map in TypeScript and ignore in Git.
> CLI generation supports dry-run/machine output and does not execute Vite.
> Watchers update additions/deletions. Generation uses Vite root, not shell cwd.
>
> Public types reject missing/wrong/extra parameters, empty catch-alls, hidden
> union extras, union route names and erased pattern contracts. Runtime checks
> reject malformed values, sparse arrays and accessors without invoking getters.
> Catch-all strings are encoded separately. Core remains application-agnostic.
>
> Production Node/browser acceptance compares the emitted manifest with actual
> CLI generation, type-checks the virtual import and executes grouped/dynamic/
> catch-all pages and functional/class-init APIs. It proves aliased default and
> decorator imports, Unicode/reserved parameters, ordered root/group/page
> middleware and nearest grouped error/root 404 rendering. Functional API
> registration now uses public paths, so route groups no longer cause a 404.
> Inspection and capability checks use that same classification. It caught Node's
> outer Hono mounting discarding custom 404 handling. Requests now delegate
> after static assets, preserving the framework's handler and request scope.
>
> **Next for GLM: finish RT-07 API declarations and boundary acceptance.**
> Define explicit native input/output schemas and error/cancellation behavior.
> Parse/authorize before mutations. Extend the shared compiler/inspection and
> generated API types. Keep private factories/schemas out of client bundles.
> Prove actual Node/native Worker requests and published negative types.
>
> Unknown-URL 404 selection still needs grouped/dynamic ancestry acceptance.
> The router synthesizes a source path from a public URL, which omits groups
> and parameter directory names. Source manifest ancestry alone does not prove
> this case. `PageOptions.route` is also unused by registration. Resolve it
> explicitly; the current alias proof concerns default exports and decorators.
>
> Every other unchecked task and release gate remains in scope. RT-01/RT-11,
> Node plain Vite development and native Deno/Electron gates stay separate.
> Versions stay 0.8.3. Preserve reports.md/.zcodeignore. No push/publication,
> live cloud changes, external messages or new chats. Final commands/counts
> appear in the linked review. Two inspection test bounds now cover their
> two twenty-second subprocess deadlines. The full pre-fix CLI run passed
> 599/601; both timed cases and the new production fixture passed afterward.
> No command deadline or assertion changed. No owned build/test handle remains.
>

> **Previous checkpoint — Codex RT-06 completion (2026-10-03). Author: Codex.**
> Continued after `0272cba`. Read the
> [review/evidence](./release-0.9.0.md#codex-optimistic-completion-2026-10-03),
> [original RT-06 criterion audit](./release-0.9.0-plan.md#rt-06), and
> [executable example](../docs/optimistic.md#complete-streamed-recovery-example).
>
> **21/58 checked, 37 unchecked. RT-06 is complete. All original IDs remain.**
> The original overlap, independent-field, out-of-order, rejection, timeout,
> disconnect, loading and reconnect criteria now have the audit in the plan.
> Existing explicit operations, public snapshot authority, read reconciliation,
> native socket eviction/SSE resync and retained consumers remain verified.
>
> New review reproduced service cancellation before iterator startup retaining
> its preview/loading. Cleanup now runs explicitly and once. Component/service
> response waits also reject on cancellation/deadline when request producers ignore
> abort. Late response bodies are released without hydration. This releases
> client ownership and does not terminate ignored application I/O or roll back writes.
>
> **32** new controlled cases cover confirmed-yield errors, malformed JSON, wrong
> IDs, truncation, trailing terminal frames, repeated cancellation/result reads,
> before-iteration cancellation, pre-header cancellation/deadlines, post-yield
> deadlines, late consumers and independent streamed service fields/local edits.
> The shared **25-case** real browser matrix covers component HTTP/SSE streams and
> explicit-service HTTP streams on HTTP, open SSE and open socket pages. Backend
> audit proves one mutation per case. Page/layout/nested consumers settle together.
> Native workerd/D1 uses the actual published dispatcher. Browser delivery damage
> occurs only after consuming a real bounded two-frame reply and committed write.
>
> The example page and private SQL helper compile through published declarations.
> The fixture copies the exact page and native helper. Actual controls prove
> success, an authored post-write failure and cancel/read convergence with a local
> draft and three mutation dispatches. Node substitutes only the persistence
> provider. Its production test server now attaches the actual WebSocket runtime;
> without that fixture wiring the new socket-page check could not open.
>
> **Next for GLM: RT-07 and all other unchecked tasks.** Trace the compiler route
> registration model before generating typed URLs/params and API contracts. Use
> public negative type cases and actual handler/middleware-order acceptance.
> Extend existing CLI-04 inspection from the same effective metadata. Read the
> detailed RT-07 plan; preserve aliases, groups, catch-alls and nearest boundaries.
>
> Broader RT-01 execution/init/incoming-disconnect and RT-11 session gates remain
> open. Node plain Vite development 404 remains CF-10/REL-03 work. Deno/Electron
> native execution and full release gates are not certified here. Versions stay
> 0.8.3 until REL-04. Preserve reports.md/.zcodeignore. No push/publication/live
> cloud changes, external messages or new chats. Exact final checks are in the review.

> **Previous checkpoint — Codex optimistic SSE ordering (2026-10-03). Author: Codex.**
> Continued after `4d8fff0`. Read the
> [review/evidence](./release-0.9.0.md#codex-optimistic-sse-ordering-2026-10-03),
> [RT-06 remaining plan](./release-0.9.0-plan.md#rt-06), and
> [SSE ordering contract](../docs/sse.md#optimistic-confirmation-and-snapshot-order).
>
> **20/58 checked, 38 unchecked. All original IDs remain. RT-06 stays open.**
> A native D1 write committed once but its own SSE event doubled the pending
> browser preview. Publications now correlate only their target's pending call.
> Cursor metadata orders page snapshots across events, ordinary replies and
> stream frames. A late older reply returns its result without undoing newer
> state. Confirmation removes only that public contribution; terminal response
> ownership still settles loading. Higher revisions restore server authority,
> even for equal public values after settlement. Client-only drafts remain local.
> The persisted snapshot stays plain public state. Child replies keep their own
> domain and never use the parent page cursor.
>
> Native Chromium/workerd/D1 acceptance now holds a committed HTTP response,
> receives its actual SSE event, changes state before and after reply settlement,
> then ends the actual subscription response through private test middleware.
> Native EventSource reconnects after 130 real coordinator publications exceed
> retained history. Resync converges without mutation replay. Native optimistic
> stream post-yield failure and explicit cancellation also settle once. Production
> Node/browser covers actual SSE ordering and post-yield failure. Controlled tests
> cover coalesced publications, other callers, duplicate/older snapshots, pending
> user edits, equal newer authority, malformed cursor replies and reopened sources.
>
> Review found a second Node gap: SSR reset a cursor under a live subscriber.
> Process publication IDs now increase across entry replacement/recreation, and
> replacement preserves connection counts. An actual stream reader regression
> verifies updates before and after replacement. These IDs are per-process;
> they provide no durable history or cross-process generation ordering. EventSource
> reopen resets the client baseline. Cloudflare uses its persisted per-scope cursor.
>
> **Next for GLM: finish RT-06 step 4 and audit step 3's complete criteria.**
> Extend optimistic malformed payloads, post-yield failures and cancellation across
> remaining HTTP and explicit-service streams. Preserve call-owned loading,
> retained consumers, public authority and ClientState/ClientStore drafts. Add the
> complete published example and audit every original criterion before checking
> RT-06. Continue all other unchecked tasks and release gates.
>
> No server rollback or termination of ignored I/O is established. Native stream
> cancellation releases held application I/O explicitly in the fixture. Broader
> RT-01 deadlines/init/incoming disconnect and RT-11 session gates remain open.
> The Node plain Vite development 404 remains CF-10/REL-03 work. Versions stay
> 0.8.3 until REL-04. Preserve reports.md/.zcodeignore. No push/publication/live
> cloud changes, external messages or new chats. Exact checks are in the evidence.

> **Previous checkpoint — Codex retained service consumers (2026-10-03). Author: Codex.**
> Continued after `43c189a`. Read the
> [review/evidence](./release-0.9.0.md#codex-retained-service-loading-2026-10-03),
> [RT-06 remaining plan](./release-0.9.0-plan.md#rt-06), and
> [service lifetime](../docs/services.md#scope-and-lifetime).
>
> **20/58 checked, 38 unchecked. All original IDs remain. RT-06 stays open.**
> Six of eight initial controlled cases failed. A late consumer inherited the
> shared preview but no loading ownership. Consumers of another declaration
> received unrelated action counts. ServiceScope now tracks active invocations
> by declaration, with one loading release per consumer. Late sibling/nested
> consumers inherit matching counts. Duplicate subscriptions and unsubscribe/
> rejoin count once. Shadowed scopes and other declarations remain independent.
> Equal action names can contribute separate component/service counts.
> Exited consumers release without another render.
>
> Production Node/browser acceptance navigates during held success and rejection.
> New sibling and nested consumers see the shared preview and loading, then
> converge or roll back. Retained layout disposal still runs once on exit.
> The shared recovery fixture also consumes a committed service response before
> holding browser delivery. Navigation creates new consumers before settlement.
> A real input rejection on the return navigation makes no additional write.
> These actions use HTTP, including on genuinely connected SSE pages.
> They do not prove SSE resync delivery or the remaining stream matrix.
>
> **Next for GLM: finish RT-06 steps 3–4.** Prove actual SSE resync and different
> late snapshots before/after cleanup. Extend optimistic post-yield failure,
> malformed replies and cancellation across HTTP/SSE and explicit services.
> Preserve server snapshot authority and client-only drafts. Audit every original
> criterion before checking RT-06. Continue all other unchecked tasks and gates.
>
> This change does not cancel an invocation when its owning layout exits,
> terminate ignored I/O, add deadlines, or prove server rollback. RT-01 remains
> open for those wider gates. Value fingerprints do not order different server
> snapshots. RT-11 session gates and the Node plain Vite development 404 remain.
> Versions stay 0.8.3 until REL-04. Preserve reports.md/.zcodeignore.
> No push/publication/live cloud changes, external messages or new chats.
> Exact final verification is recorded in the linked review.

> **Previous checkpoint — Codex native optimistic socket recovery (2026-10-03). Author: Codex.**
> Continued after `51bef75`. Read the
> [review/evidence](./release-0.9.0.md#codex-optimistic-socket-2026-10-03),
> [RT-06 remaining plan](./release-0.9.0-plan.md#rt-06),
> [socket guide](../docs/websockets.md#application-component-registry-and-lost-replies), and
> [native API boundary](../docs/api-routes.md#browser-boundary-for-functional-handlers).
>
> **20/58 checked, 38 unchecked. All original IDs remain. RT-06 stays open.**
> Native Chromium/workerd/D1 acceptance now commits a write while its correlated
> reply stays held, initiates a real server socket close, releases held I/O and
> checks uncertainty/loading. Reconnect never repeats the mutation. Actual DO
> eviction closes any early reconnect too, forcing a new socket and persisted
> public snapshot. Browser drafts remain local. A two-pending-call case proves
> one committed write and one canceled queued invocation. Socket actions execute
> serially. Two pending browser calls do not mean both server writes started.
>
> Native streaming cases commit and yield before a client-visible failure or
> explicit cancellation. Each failure releases loading once, retains the persisted
> public count and draft, and dispatches exactly one action. Authenticated actor
> assertions use the socket's actual user u1. The test app now installs ORM context
> for /ws/ session validation, matching its existing /sse/ setup. This is fixture
> wiring, not a production auth policy change. Cancellation cannot prove rollback.
>
> A production bug surfaced: AppDurableObject scanned framework demo pages instead
> of generated application pages. It now uses the compiler's exact page/layout
> registry and accepts only default Cossack component exports. The regression
> failed before correction. Native acceptance uses that published default lookup.
> Its subclass adds only a test-only native socket-close endpoint.
>
> The client asset audit then found binding-only API SQL in an emitted browser
> chunk. The security load hook now recognizes functional HTTP routes through the
> shared classifier, replaces default/named exports before loading dependencies,
> and refuses ambiguous runtime export stars. SSR keeps original modules and
> component classes keep their normal transform. Explicit aliases/string exports
> retain their runtime shape. Tests cover export shape, misuse errors and body
> exclusion. Native asset checks exclude both socket SQL table names.
>
> **Next for GLM: finish RT-06 steps 3–4.** Prove actual SSE resync and different
> late snapshots before/after cleanup, multiple pending calls and retained layout/
> service consumers. The native socket stream matrix is component-owned. Extend
> optimistic post-yield errors, malformed replies and cancellation across HTTP/SSE
> and explicit services. A late subscriber joining pending service work still
> needs its ownership/loading audit. Audit every original criterion before
> checking RT-06. Continue all remaining tasks and release gates.
>
> The value fingerprint remains an echo comparison, not server revision ordering.
> Wider RT-01 deadlines/init/incoming disconnect, RT-11 session gates and the Node
> plain Vite development 404 gap remain open. Versions stay 0.8.3 until REL-04.
> Preserve reports.md/.zcodeignore. No push/publication/live cloud changes,
> external messages or new chats. Exact final verification appears in the review.

> **Previous checkpoint — Codex RT-06 authoritative reads (2026-10-03). Author: Codex.**
> Continued after `7cdb039`. Read the
> [review/evidence](./release-0.9.0.md#codex-optimistic-reconciliation-2026-10-03),
> [RT-06 remaining plan](./release-0.9.0-plan.md#rt-06), and
> [complete recovery example](../docs/optimistic.md#handle-an-uncertain-result).
>
> **20/58 checked, 38 unchecked. All original IDs remain. RT-06 stays open.**
> Step 2 now has an explicit read contract: `reconcile$(failure, ...names)`.
> The application supplies declared read-only resource targets. Known uncertain
> RpcError diagnostics trigger one refresh per resource. Same error object, target
> set and current dependencies share one recovery promise. Entries bind immediately.
> Dependency changes cannot redirect an earlier recovery to a later record.
> Results distinguish not-needed/recovered/failed/superseded/disposed. Original
> mutation errors remain intact. Failed recovery remains cached. Use refresh$ for
> an explicit retry. A completed read does not confirm which mutation committed.
>
> Framework RPC reconstruction now suppresses incidental resource loaders while
> retaining deterministic child reconstruction. The selected generated resource
> action performs one read. Ordinary SSR/client discovery keeps its behavior.
> A real regression previously performed two reads for one resource action.
>
> Generated Node production/browser and native Worker/D1 acceptance consume a
> committed mutation's response before aborting delivery to the browser. Both
> component and injected-service HTTP actions report network uncertainty, restore
> their previews, read once, converge and release loading without repeating writes.
> The SSE page waits for its actual authenticated EventSource to open first.
> Its mutations and recovery reads still use HTTP through the SSE coordinator.
> This does not prove socket mutation loss/reconnect or SSE resync delivery.
>
> Native acceptance exposed missing ORM setup on the fixture's /sse/ route.
> The test application now installs its database context before ORM-backed session
> validation there. Earlier checks that merely loaded SSE pages did not prove an
> open EventSource. The stronger check now does. No production auth policy changes.
>
> **Next for GLM: finish RT-06 steps 3–4.** Exercise actual native socket loss
> after a committed mutation, reconnect and authoritative state without replay.
> Test SSE resync and different late snapshots before/after cleanup, multiple
> pending calls, retained layouts and service consumers. Then cover post-yield
> stream failures and cancellation with indicators settling once. Audit every
> original criterion before checking RT-06. Continue all other unchecked IDs.
>
> Error codes are a bounded classification, not transaction evidence. Arbitrary
> application errors after writes need an explicit read. The helper does not infer
> persisted records, add deadlines, or terminate ignored external I/O. RT-01's
> wider disconnect/deadline/init gates and the Node plain Vite 404 gap remain open.
> Versions stay 0.8.3 until REL-04. Preserve reports.md/.zcodeignore. No push or
> publication, live cloud changes, external messages, or new chats.
>
> Exact final verification commands and counts appear in the linked review.

> **Previous checkpoint — Codex RT-06 explicit operations (2026-10-03). Author: Codex.**
> Continued after `231bcc1`. Read the
> [review/evidence](./release-0.9.0.md#codex-optimistic-operations-2026-10-03),
> [RT-06 remaining plan](./release-0.9.0-plan.md#rt-06),
> [operation guide](../docs/optimistic.md#record-relative-operations) and
> [migration](./migration-0.9.0.md#explicit-optimistic-operations).
>
> **20/58 checked, 38 unchecked; no task closes and all original IDs remain.**
> The explicit-operation contribution audit is implemented. RT-06 remains open
> for authoritative uncertain-result reads, actual reconnect/late broadcasts,
> retained consumers and stream/cancellation acceptance. Continue every other ID.
>
> Use public `optimistic<ConcreteClass>(this)` in synchronous @Optimistic handlers.
> It records finite increment, detached append and first-structurally-equal remove.
> Helpers bind one capture and reject after it ends or during another capture.
> Application handlers execute once. Internal replay folds only data operations.
> Failed earlier calls remove their operations without losing newer pending or
> committed local operations. Public confirmed replies replace confirmed entries.
> No-op removals retain intent; duplicate items preserve first-match order.
> Later local replacements remain the base of subsequent relative operations.
>
> Direct assignments still describe absolute field values. Do not mix them with
> operations on one field in a handler; that capture restores and logs an error.
> Operations validate reactive metadata at runtime and writable field/item shapes
> in published types. Use a concrete Host because polymorphic this cannot resolve
> these mapped types. Item data is finite and plain, without cycles or enumerable
> accessors/functions/symbols/native values. Arbitrary later nested writes still
> protect whole fields. This does not infer server persistence or transactionality.
>
> Controlled contributions first failed 2/3; a separate local-replacement test also
> failed before correction. Transport/scoped-service and published-declaration
> acceptance now pass. Full proof commands/counts are recorded in the review.
> A full browser run also reproduced a late equal SSE snapshot erasing count 99
> after settlement. Weak per-target history now protects surviving user edits
> from that known echo, even while a new call is pending. Changed state and explicit
> reads clear it; socket/EventSource open and SSE resync reset history while keeping
> active calls. Controlled reconnect tests cover those rules. This compares values,
> not server revisions; different late snapshots still need the remaining audit.
> Native Worker cases retain one increment/append while an older call rejects and
> a newer call remains pending. Loading releases once, and local fields are absent
> from actual requests. Generated Node browser cases cover both completion orders.
>
> **Next for GLM: finish RT-06 steps 2–4.** Choose an explicit authoritative read
> contract for HTTP/service uncertainty. Prove a mutation committed before its reply
> was deliberately lost, followed by one read and zero mutation replay. Exercise
> actual native socket loss/reconnect, SSE recovery and late snapshots before/after
> cleanup, retained layouts/service consumers, then yielded stream errors and
> cancellation. Audit the original criteria before checking the task. Follow the
> detailed plan; do not treat local preview rollback as server rollback.
>
> Versions remain **0.8.3** until REL-04. Preserve reports.md/.zcodeignore.
> No push/publication/live cloud changes/external messages/new chats.

> **Previous checkpoint — Codex RT-06 ownership continuation (2026-10-03). Author: Codex.**
> Continued after `83ea5e4`. Read the
> [review/evidence](./release-0.9.0.md#codex-optimistic-ownership-2026-10-03),
> [RT-06 implementation and remaining plan](./release-0.9.0-plan.md#rt-06),
> [optimistic guide](../docs/optimistic.md) and
> [migration](./migration-0.9.0.md#optimistic-call-ownership-and-flat-connection-snapshots).
>
> **No task closes: 20/58 checked, 38 unchecked; all original IDs retained.**
> RT-06 remains open for uncertain authoritative reads, actual reconnect delivery
> and the contribution-rebasing audit. RT-01/full release gates also remain open.
>
> Initial controlled matrix reproduced 17/20 failures. Per-call field ownership
> now removes a failed preview while retaining other calls/newer confirmed state,
> including same-method overlap. Plain trees capture nested Stores and local fields.
> Component/service setter hooks retain later user edits. Request public state
> excludes pending previews, preventing a previewed increment from running again
> on that value at the server. Client-only fields remain absent from requests.
>
> Handlers execute once and must be synchronous. Async handlers are refused before
> execution; promise-producing synchronous work, thrown undefined/errors and
> over-depth previews restore captured fields. This cannot stop already started
> asynchronous effects. Metadata retains inherited handler siblings. Explicit
> scoped services share the same ownership/merge/loading behavior for subscribers.
>
> The current representation is a whole-field resulting value, not arithmetic or
> array operations. A newer preview can include earlier preview data. A later
> nested user edit protects that complete field. Native objects remain scalar
> references. Do not claim arbitrary contribution rebasing or server transactions.
> Newer direct replies win for an owned field; ordinary post-settlement snapshots
> retain server authority. Use client-only fields for persistent browser drafts.
>
> Node/Deno connection frames previously wrapped hydration state although clients
> expect flat public state. The runtime getPublicState helper now serves both Node
> upgrade paths and Deno; existing adapter/generated snapshot assertions use actual
> flat keys. Cloudflare already sends flat snapshots. Uncorrelated action-complete
> messages cannot decrement loading for modern correlated calls.
> Explicit service subscriber loading also has invocation ownership, so ambient
> completion cannot clear it. Duplicate subscriptions count once; the original
> owner is released even after unsubscribe, without rendering an exited consumer.
> Unrelated response echoes cannot supersede another field's pending preview.
> Unsupported later local snapshot values retain references with diagnostics;
> cleanup drains sibling fields and releases loading without masking the RPC error.
>
> Generated production Node and native Worker HTTP/SSE acceptance proves delayed
> older validation rejection, newer result retention, preview exclusion, loading
> settlement and later user edits. Controlled timeout/socket/network cases prove
> uncertainty codes and no replay, then manually apply snapshots. They do not yet
> prove a universal HTTP refetch or actual socket reconnect after a lost mutation.
> Exact final commands/counts and intermediate corrections are in the review.
>
> **Next for GLM: finish RT-06**, following its four remaining steps. Define
> contribution semantics, choose an authoritative read contract for uncertain
> results, prove already committed/lost response recovery without repeating the
> mutation, and test native reconnect/late broadcasts/stream failures. Audit original
> criteria before checking the task. Continue all remaining IDs and the Node plain
> Vite dev integration gap; existing dev WebSocket fixtures do not certify CLI dev.
>
> Versions remain **0.8.3** until REL-04. Preserve reports.md/.zcodeignore. No
> push/publication/live deployment/cloud changes/external messages/new chats.
> Verification processes finish before commit. Native fixtures are local/disposable.

> **Previous checkpoint — Codex RT-04 completion (2026-10-03). Author: Codex.**
> Continued after `abd80ad`. Read the
> [review/evidence](./release-0.9.0.md#codex-state-diagnostics-2026-10-03),
> [RT-04 criterion audit](./release-0.9.0-plan.md#rt-04),
> [RT-06 continuation](./release-0.9.0-plan.md#rt-06),
> [state guide](../docs/states.md) and
> [migration](./migration-0.9.0.md#state-contracts-and-development-diagnostics).
>
> **20/58 checked, 38 unchecked; only RT-04 newly closes.** All original IDs
> remain in scope. RT-01 and full release/runtime gates stay open. Historical
> RT-04 remaining-work notes are superseded by this checkpoint.
>
> State/client state remain shallow; stores observe nested plain objects/arrays.
> Computed evaluates on read without a cache/dependency graph. createStore uses
> Object.is replacement notifications and explicit subscription ownership.
> Two complete public-export examples compile; the state page runs in development
> and production. Store proxies cannot be passed directly to structuredClone.
>
> Development warnings name component/field/path and print no values. Shallow
> warnings cover ClientState too, ignore failed/no-op writes and preserve stable
> proxies. Public-state inspection shares canonical RT-01 classifiers, skips
> getters/custom serialization hooks, and has depth/visit limits. Unknown skipped
> representations remain the real serializer's responsibility. Production keeps
> its original values and JSON behavior. Strict resource validation is separate.
> Core's library build must preserve consuming Vite DEV selection; optional env
> access keeps direct published Node imports safe with diagnostics disabled.
>
> Inherited metadata now collects own fields root-to-child. Child decorations
> replace the same field's public/client/shallow/deep kind; parent siblings stay.
> Component/service bootstrap, legacy forwarding, sanitizers, optimistic field
> discovery and channel validation agree. Inherited public Store channels validate.
> Forged overlays cannot restore a public parent field overridden as client-only.
> Client-only is a snapshot rule, not a secret rule: SSR values can appear in HTML,
> and authored explicit RPC arguments still cross the boundary.
>
> Native HTTP/SSE acceptance retains local Store edits and rejects forged local
> fields. HTTP uses allowed public overlays; SSE preserves authoritative state.
> Actual RPC request.state is flat. Do not test nonexistent state.public or weaken
> server authority to make a browser filter survive; use client-only fields.
>
> Evidence: core **1147/68**, framework **1316/57**, both builds, root tsc and all
> **11** package type configs pass. Selected generated browser **3 passed, 14
> skipped /17** covers both state modes and the prior task/navigation case. Native
> staging/socket **2/2**, about 110 seconds, retains existing D1/schema/resource/
> policy/stream/limiter acceptance. No full CLI, tarball, Deno or Electron gate claimed.
>
> **Open gap:** generated Node plain Vite dev returns 404. RT-04's development
> fixture supplies an explicit HTTP SSR test bridge using the real Vite module
> graph. It does not fix or certify CLI dev support. Follow the concrete
> [REL-03 integration plan](./release-0.9.0-plan.md#rel-03) and CF-10 guide gate.
>
> **Next for GLM: RT-06.** Trace optimistic settlement across HTTP/SSE/socket,
> write failing overlap/out-of-order tests, use action/field ownership for rollback,
> retain later user edits and independent fields, settle indicators once, and
> distinguish rejection from uncertain completion. Reuse RT-19 resync without
> mutation replay. Finish browser/native acceptance and the original audit before
> checking the task. Continue all other remaining IDs, including Node dev integration.
>
> Versions remain **0.8.3** until REL-04. Preserve reports.md/.zcodeignore. No
> push/publication/live deployment/cloud changes/external messages/new chats.
> All owned verification processes finished. Native fixtures are local/disposable.

> **Previous checkpoint — Codex RT-05 completion (2026-10-03). Author: Codex.**
> Continued after `95b2dd4`. Read the
> [review/evidence](./release-0.9.0.md#codex-task-ownership-2026-10-03),
> [RT-05 criterion audit and next plan](./release-0.9.0-plan.md#rt-05),
> [task API](../docs/tasks.md#typed-dependency-paths) and
> [migration](./migration-0.9.0.md#typed-task-dependencies-and-owned-commits).
>
> **19/58 checked, 39 unchecked; only RT-05 newly closes.** All original task
> IDs remain in scope. RT-03 is already complete; broader RT-01 and release gates
> stay open. This supersedes the earlier RT-05 remaining-work notes.
>
> Use `@Task<Host>({ track: [...] as const })` (also ServerTask/ClientTask) and
> `(signal, task: TaskContext<Host>)`. Paths check public/dependency-shape names,
> nullable nesting and arrays, up to six segments. Private fields need an explicit
> shape; untyped decorators keep untyped paths. Types do not prove reactive metadata.
> Use concrete Host rather than polymorphic this for typed field patches.
>
> `task.commit({ result: value })` synchronously replaces initialized reactive
> fields only while this execution owns the task. Stale/disposed returns false.
> All keys validate before writes; callbacks/promises/classes/getters/ordinary
> fields/injected services reject with TaskCommitError. Retain whole nested-store
> shape. Frozen contexts expose signal/isCurrent/component/task/trigger. This is
> not an arbitrary commit callback, transaction, rollback, I/O termination or
> general side-effect guard. Direct writes still need cooperative checks.
>
> Review fixed child task declarations hiding inherited siblings. Gather own
> metadata root-to-child and replace matching method kind/dependencies before
> environment filtering. Do not revert this or settled-controller ownership.
> Sync setup/cleanup remains immediate absent async cleanup. Diagnostic stages
> distinguish setup/commit/cleanup with component and trigger. Failed cleanup
> does not block siblings/next setup; owned scopes wait for cleanup. Late ignored
> I/O still returns one cleanup after disposal, but services may already be disposed.
>
> Verification: core **1115/65**, framework **1316/57**, task file **16 cases**,
> published paths/patch types, core/framework builds, root tsc and all **11**
> package configs pass. Generated production Node/browser **1 passed, 14 skipped
> /15** proves controlled old-after-new results, rapid changes, sibling navigation,
> retained service identity, layout exit and abort before service disposal. Settled
> and late setups each clean up once. Generated tsc/private ServerTask stripping
> pass. Rebuilt native staging/socket **2/2** retain existing transport/resource/
> schema/D1/counter cases. No full monorepo/tarball/native Deno/Electron gate claimed.
>
> **Next for GLM: RT-04**, then RT-06 and all remaining tasks. Start with existing
> state/store/computed docs and RT-01 serialization semantics; add executable
> mechanism-choice examples and component/field/path diagnostics for unsupported
> values/cycles. Verify nested object/array writes, computed dependencies and
> client-only exclusion across SSR/RPC/shared/native SSE state. Preserve production
> semantics and authoritative server snapshots; do not reuse stricter resource
> JSON validation for all state. The detailed next plan is in the RT-05 audit.
>
> Versions remain **0.8.3** until REL-04. Preserve reports.md/.zcodeignore. No
> push/publication/live deployment/cloud resource changes/external messages/new
> chats. All phase-owned checks finished; no test/build process remains running
> at commit time. Native Worker tests use local disposable fixtures only.

> **Previous checkpoint — Codex RT-03 completion (2026-10-03). Author: Codex.**
> Continued after `cab1560`. Read the
> [review/evidence](./release-0.9.0.md#codex-resource-lifecycle-2026-10-03),
> [RT-03 criterion audit](./release-0.9.0-plan.md#rt-03),
> [RT-05 continuation](./release-0.9.0-plan.md#rt-05) and
> [resource migration](./migration-0.9.0.md#typed-server-resources-and-dependency-aware-hydration).
>
> **18/58 checked, 40 unchecked; only RT-03 newly closes.** Keep all original
> task IDs. RT-02/RT-14/RT-18 are already complete; broader RT-01 and release
> gates remain open.
>
> Declare named public fields with `Cossack<Env, { Resources: 'users' | 'selected' }>`.
> Status values infer the ordinary field types, including null/undefined; no data
> wrapper or repeated value type is needed. Published fixtures without Vite reject
> bad names, missing/nondeclared fields, dynamic strings and invalid value uses.
> Untyped/inline names remain runtime-checked with unknown status values.
>
> The compiler emits a reserved per-class field registry. Core binds only those
> getters, including inherited declarations. Status starts a field before render;
> refresh binds current dependencies without loading, then starts exactly one
> invocation. Cold/hydrated refresh works. Unknown names cannot run unrelated
> getters. Invalidation drops data until the next read's initial value.
>
> Hydration carries `{ argsKey, value }` only for resolved entries. Keep dependency
> identity so old data cannot become current for changed arguments; matching SSR
> values hydrate without initial RPC. Only current entries publish data/errors.
> Superseded SSR failures no longer fail the active render; disposal discards
> completions and prevents another read. Existing initial/failure/retry/stale
> behavior is preserved. Rebuild both browser/server and update old state fixtures.
>
> Resource validation runs before toJSON, rejects custom hooks/class instances/
> Dates/non-finite numbers and undefined dependencies, and accepts repeated
> acyclic references. Generated server methods validate results before RPC JSON,
> so direct refreshes cannot turn invalid Dates/hooks into accepted JSON. Generator
> loaders fail clearly; use Server for streams. Use ISO dates and null dependencies. Dependency identities
> are public hydration data; never place secrets in deps. Browser-owned filters
> use ClientState in the recipe/example. Native SSE first reproduced shared State
> resetting a local filter through an authoritative snapshot. Preserve that
> server authority; do not weaken state merging to retain browser selections.
> ClientState dependency arguments still reach loaders and stay out of shared state.
>
> **RT-05 bug fixed, task still open:** settled sync/async setup deleted its
> controller, so subscriptions retained signals that never aborted. Two new
> failing regressions prove this. Controllers now remain owned until rerun or
> destroy; destroy aborts before component/descendant/service cleanup. Cleanup
> sees the aborted signal once. Keep this lifetime; do not restore finally-based
> deletion. TaskMethod includes the signal and promise-returned cleanup.
>
> Evidence: core **1107/64 files**, framework **1316/57**, scaffold **108/4**;
> generated Node production/browser **2 passed, 12 skipped /14**; native workerd
> staging/socket **2/2**, about 109 seconds. Node browser checks hydration reuse,
> delayed old responses, empty results, failure/retry and navigation while pending
> with one cleanup. Native HTTP/SSE resources prove SSR keys, actual D1/request
> user reads, private failure/recovery and four exact selected/refresh arguments.
> Client chunks exclude loader failure sentinels. Builds, root tsc and all 11
> package typechecks pass. No full CLI/monorepo/tarball/native Deno/Electron release
> gate is claimed. Intermediate fixture/type/quoting/assertion failures and their
> fixes are recorded in the review. Native resource checks now run before the
> larger policy/schema matrix for early feedback.
>
> **Next for GLM: finish RT-05.** Choose a typed dependency path/tuple declaration
> style and published negative tests. Add execution-owned synchronous commits
> that refuse stale/destroyed writes, retaining signals for cancellable I/O.
> Add component/trigger/stage context to cleanup errors and verify that rejected
> cleanup drains siblings. Test rapid changes and live navigation with component
> tasks using layout-scoped services. Avoid a separate service task engine without
> an architectural reason. Cooperative cancellation cannot undo arbitrary writes,
> roll back mutations or terminate ignored I/O. Follow the original done criteria
> before checking RT-05, then continue all remaining task IDs and release gates.
>
> Versions stay **0.8.3** until REL-04. Preserve reports.md and .zcodeignore.
> No push, publication, live deployment, resource/account changes, external
> messages or new chats. Phase-owned verification is complete at commit time;
> no test/build session remains running.

> **Previous checkpoint — Codex RT-02 completion (2026-10-03). Author: Codex.**
> Continued after `cd478f4`. Start with the
> [review and exact evidence](./release-0.9.0.md#codex-schema-migration-2026-10-03),
> [RT-02 criterion audit](./release-0.9.0-plan.md#rt-02),
> [validation guide](../docs/validation.md#validated-server-actions) and
> [migration guide](./migration-0.9.0.md#typed-server-input-contracts).
>
> **17/58 checked, 41 unchecked; only RT-02 newly closes.** All original IDs
> remain. RT-14 is already complete; wider RT-01/RT-11 and release gates remain.
>
> Action input metadata now accepts schemas only. Public types reject old maps;
> stale JS metadata fails before callbacks/mutation. Shared form rule maps remain
> supported. Direct/typed-channel Server decorators check public function fields,
> including arrows and generators, without changing native return types. Keep
> parsed InputOf parameters in authored browser/native methods; RawInputOf is a
> boundary description. Normalize client form values. JSON dates need explicit
> coercion. Native entrypoints explicitly parse/authorize and own error mapping;
> native API schema/error integration remains RT-07. Private/protected field
> inference is unsupported; keep RPC actions public.
>
> Review fixed a compiler false positive for type-only private-module siblings
> and an empty runtime import retained by separate inline types in verbatim mode.
> Stripping converts detached private-module imports to explicit import type,
> prints names/aliases from AST spans and preserves unrelated initializers.
> Four emitted-JS regressions include separate/mixed/commented type imports.
>
> Review also reproduced public callback exception leakage in eight transport
> tests. Refinements, structural authorizers and auth-owned rule/lookup callbacks
> now wrap unexpected failures with private errors and retain their original
> cause for logs. A callback throwing public validation/HTTP classes cannot leak
> fields/messages/stacks/response. Return false for expected validation/policy
> failure. Known kit denials retain fixed 401/403 behavior; public errors thrown
> from action bodies keep their normal semantics.
>
> Final evidence: core **1095/63**, framework **1314/57** (matrix **472**, existing
> compiler **167**), auth **145/8**; all pass. Final core/framework builds, root
> `pnpm tsc --noEmit` and all **11** package typecheck configs pass. Two affected
> generated Node production/browser cases pass (12 others skipped). Final rebuilt
> native workerd staging/socket cases **2/2** pass sequentially. D1 versions/audits
> prove rejection before mutation for scalar/nested/Date/enum/literal/optional/null/
> File/unknown-key/positional/refinement cases through HTTP/SSE page/service JSON/
> multipart fields. Browser forms fail/recover; native socket fields parse, reject
> private classes, observe signal abort, skip mutation and release successors.
> Client chunks exclude private contract/policy sentinels and record SQL.
>
> The review log preserves intermediate type/compiler/privacy failures and the
> initial incorrect socket-cancellation expectation. Native socket cancellation
> suppresses later terminal frames; the client settles locally. The expanded
> staging test outgrew its old 90-second total limit and passed with a 180-second
> total budget; its explicit abort signal remains 500 ms. Final native test work
> takes about 100 seconds. Temporary diagnostics are removed. This proves owned
> explicit cancellation, not incoming pre-header TCP disconnect delivery,
> termination of ignored I/O or rollback. No full CLI/monorepo/tarball/native
> Deno/Electron release audit is claimed.
>
> **Next for GLM: RT-03 with the relevant RT-05 lifecycle work.** Use the existing
> resource/task implementation; finish compile-time resource names/results and
> typed refresh/invalidation, plus SSR/hydration/unmount acceptance. Keep stale
> data during refresh failure, reject invalid targets/types, prevent older loads
> from replacing newer results and avoid duplicate initial hydration loads.
> For tasks, finish typed dependency paths, contextual errors and framework-gated
> result application through rapid dependency changes/navigation/service disposal.
> Follow each task's original criterion text before checking it. Do not rebuild
> RT-02/RT-14 or widen native action signatures as a shortcut. Continue all other
> unchecked IDs and separate final provider/runtime/release gates afterward.
>
> Versions remain **0.8.3** until REL-04. Preserve user-owned reports.md and
> .zcodeignore. No push, publication, live deployment, cloud resource changes,
> external messages or new chats. All phase-owned checks are complete; no
> test/build process remains running at this checkpoint.

> **Latest checkpoint — Codex resource-policy phase (2026-10-03). Author: Codex.**
> Continued after `49d3236`. Read the
> [review/evidence](./release-0.9.0.md#codex-resource-policies-2026-10-03),
> [RT-14 implementation and criterion audit](./release-0.9.0-plan.md#rt-14),
> [RT-02 remaining work](./release-0.9.0-plan.md#rt-02) and
> [public policy API](../docs/authorization.md#typed-resource-policies).
>
> **16/58 checked, 42 unchecked; only RT-14 newly closes.** The original
> criterion audit covers owned/other-tenant resources, relevant realtime paths,
> forged state, unknown action types and consistent UI/direct request behavior.
>
> Auth's `createResourcePolicy<Resource, User>()(rules)` now has typed named
> actions, app-owned lookup, imperative/API/middleware enforcement and frozen
> boolean UI projections. Core has an independent structural authorizer: no
> auth/ORM dependency. `@Server({ input, authorize })` runs policy after parsing
> and before mutation through router and socket gates, including services.
> Direct and typed-channel Server overloads infer parsed authorizer input.
>
> The trusted server request/socket actor supplies identity. Payload/state
> owner/user/canEdit grants nothing. Expected denials have fixed 401/403 messages,
> codes and request IDs. Malformed/nonboolean callbacks and backend exceptions
> remain internal; redaction does not evaluate exception getters. Signals release
> stuck policy/lookup ownership and skip later mutation, without stopping ignored
> I/O or rolling back callbacks. Native calls still require explicit authorize.
>
> Review fixed Hono private-field getter/method/response-setter receivers in the
> Cossack context proxy. Compiler stripping now includes private policy metadata,
> transitive declarations and dead server-read dependencies; shared client helpers
> remain. Static typed-decorator aliases receive consistent classification and
> stripping. Private contracts retained by exports/client code/foreign module
> imports fail rather than expose policy/lookup initializers.
>
> Core **1095/63**, framework **1294/57** (matrix **456**, policy compiler **11**
> plus existing compiler **163**) and auth **143/8** pass. Root TypeScript and
> all **11** package typecheck configurations pass. Two affected Node production
> browser cases pass separately (13 other cases skipped in each targeted run).
> Native workerd D1/browser acceptance passes in isolated complete staging runs;
> native socket acceptance passes. The release review records intermediate
> fixture/type failures and lost/empty native replies from a test API that ignored
> its POST body. Its JSON parser now consumes the request without trusting submitted
> permission fields; assertions also consume/check each reply before audit reads.
> The final sequential native run passes both files, and a second complete staging
> run passes after the body fixes. This does not close broader
> RT-01 native early-response/disconnect guarantees. No full CLI/monorepo/release
> audit is claimed.
>
> **Next for GLM: finish RT-02's documented migration/native schema work.**
> Do not reimplement RT-14 or widen native signatures to raw client inputs.
> Add the remaining native scalar/refinement/error/cancellation acceptance and
> resolve plain-map migration/raw browser typing deliberately. Use published
> exports, application-owned lookup/conditional writes and real audit evidence.
> Keep RT-01 action deadlines/disconnect delivery and RT-11 session freshness
> separate. Preserve every release ID and later release/provider/runtime gate.
>
> Package versions remain **0.8.3** until REL-04. Preserve user-owned
> reports.md/.zcodeignore. No push, publication, live deployment, cloud resource
> changes, external messages or newly created chats. Only close a checkbox from
> its original criterion audit, not test counts or a partial feature slice.

> **Latest checkpoint — Codex typed-input phase (2026-10-03). Author: Codex.**
> Continued after `fb927cb`. Read the
> [review and exact evidence](./release-0.9.0.md#codex-typed-input-2026-10-03),
> [RT-02 implementation/next steps](./release-0.9.0-plan.md#rt-02),
> [RT-14 next-phase context](./release-0.9.0-plan.md#rt-14) and
> [schema API/limits](../docs/validation.md).
>
> **15/58 checked, 43 unchecked; no new checkbox closes.** Typed schemas now
> infer parsed/raw values, reject unknown keys, define optional/null, array/File
> and strict coercion behavior, and expose nested field errors before mutation.
> Their owned request signal stops later validation/actions on cancellation.
> Refinement callbacks receive the signal; ignored I/O can still continue.
> Exceptions/nonboolean results stay private. ClientVisibleError preserves subclass
> prototypes; malformed metadata no longer disappears through truthiness.
>
> Core's new `input-schema.ts` and `action-input.ts` separate parsing from form
> validation without a framework/auth dependency. Both router gates and the
> core socket gate use the same boundary. Existing plain rule maps remain
> explicitly transitional (unknown fields/extra arguments retained). Native
> server calls keep their authored signature and do not run decorator guards.
> RawInputOf describes boundary values; it does not change proxy argument types.
>
> Client stripping follows private module input dependencies, removing dead
> declarations/imports/callbacks, including destructuring groups. Types and local
> shadowed bindings cannot keep them live. Exported/client-reachable contracts,
> shared foreign contract modules and unsupported private runtime TS declarations
> fail closed. Separate shared storeRules from the private schema. The mutation
> recipe now demonstrates this and passes real production/browser acceptance.
>
> Final core **1080/62**, framework **1243/55** (matrix **421**, compiler **163**),
> scaffold **108/4** pass. CLI generated/runtime plus native workerd staging:
> **15/2** pass. Typed native File/object/array guards reject unknown fields,
> forged File metadata and empty arrays without D1 audit writes; valid streams
> preserve request/ORM context. After the final compiler hardening/export rebuild,
> **2** affected Node production/browser cases pass again (12 skipped); the
> review log separates those runs. Final root TypeScript and all **11** package
> typecheck configurations pass. No full CLI/monorepo/release audit is claimed.
>
> **Next for GLM: RT-14 with RT-02.** Implement typed resource action policies
> in auth, application-owned lookup, safe booleans for UI, and structural core
> policy enforcement after parsed input/before mutation. Use server request
> identity, never payload owner/canEdit/state. Cover API/read loaders and all
> action gates, private policy dependencies, owned/cross-tenant/forged-state
> requests and zero writes on denial. Native scalar/refinement/policy acceptance,
> plain-map migration and raw client typing choices remain. Keep RT-01 action
> deadlines and RT-11 session freshness/revocation separate. Audit the original
> criteria before checking either task; schema tests alone do not close them.
>
> Preserve the entire 58-task plan, all later release/runtime/provider gates and
> user-owned reports.md/.zcodeignore. Package versions remain **0.8.3** until
> REL-04. No push, publication, live deployment, cloud resource changes or external
> messages. No test/build process remains running when this checkpoint commits.

> **Latest checkpoint — Codex RT-18 completion (2026-10-03): Author: Codex.**
> Continued after `157573d`. Start with the
> [provider review and exact evidence](./release-0.9.0.md#codex-storage-capabilities-2026-10-03)
> and [RT-18 criterion audit/implementation context](./release-0.9.0-plan.md#rt-18).
> Those sections supersede the unfinished RT-18 follow-ups in older notes below.
>
> **15/58 checked, 43 unchecked. Only RT-18 newly closed; every task ID retained.**
> Duration contracts, pure provider capabilities, runtime/CLI inspection,
> unsupported-guarantee rejection, server transport coverage and limiter policies
> now meet that task's original criteria. Unknown traits cannot satisfy required
> guarantees. Database deployment traits/Redis persistence remain unknown; DO
> cache get/set does not claim atomic increment. Custom declarations assert their
> author's guarantees; factory construction/disposal stays with the factory.
>
> `cache.require` and named store `requires` guard cache operations; limiter
> `requires` guards wrappers/API/component/service/socket actions before hit or
> mutation. `cache.inspect` and `inspectRateLimitStore(env)` consume no operation.
> `cossack inspect/check providers --json --env staging` uses compiler declarations
> and selected public Wrangler settings, without executing modules or contacting
> providers. Dynamic helpers/registration overrides remain unknown. Selected
> missing bindings fail; optional unselected missing bindings warn.
>
> Memory saturation rejects new keys without restoring live quotas. Keys,
> namespaces and framed backend keys are bounded UTF-8. Redis requires bounded
> HTTPS URL/ASCII token and rejects redirects without forwarding credentials.
> Null/malformed/misspelled options fail. New framework scope/caller and KV/Redis
> namespace/key framing causes a **one-time budget migration**; coordinate mixed
> versions. `window` retains its name and always means milliseconds. The earlier
> cache `ttlMs` migration remains required. See the migration and provider guides.
>
> Evidence: core **1039**, final framework **1187** (matrix **374**, AST **13**),
> CLI full run **585**, then **85** affected published-export/command/subprocess
> cases after the final namespace/optional-binding/name changes; database **87**,
> Node **16**, Deno **16**, scaffold **108**. Full CLI includes all **14** generated
> runtime cases, native cache/counter/socket acceptance and real-pnpm installation.
> Generated HTTP/SSE page/service denial writes no D1 row; native HTTP/socket DO
> budgets retain shared/atomic guarantees across actual limiter eviction/reload.
> Cancellation gate helpers and eviction IDs now use actual framed keys.
> Sequential builds, final export build, root TypeScript and all **11** package
> typecheck configs pass. These exact runs are distinguished in the review log.
>
> **Next work for GLM:** continue the full plan, with RT-02/RT-14 schema/type
> inference and resource authorization as the next cohesive phase. Keep RT-01
> arbitrary action deadlines and init/restoration concurrency separate from the
> completed counter deadline. Actual native pre-header TCP disconnect delivery
> remains unobserved on the installed workerd; explicit signal cancellation is
> verified and does not prove that delivery. Native Deno/Electron, live provider
> readiness/consistency, remote producer shutdown and REL-02..05 remain gates.
> Do not recheck/reimplement completed RT-18 criteria as prerequisites to every
> later phase; add targeted regressions when changing their contracts.
>
> Package versions remain **0.8.3** until REL-04. No push, publication, deployment,
> external messages or cloud resource changes. User-owned `reports.md` and
> `.zcodeignore` remain outside the commit. All 58 tasks stay in scope; the active
> goal is not complete. Other checked tasks were retained rather than re-audited
> as part of this provider review. Read each task's detailed goal/acceptance text
> before closing further checkboxes.


> **Latest checkpoint — Codex cache contracts (2026-10-03):** **Author: Codex.**
> Continued after `e6e5677`. Read [review/evidence](./release-0.9.0.md#codex-cache-contracts-2026-10-03),
> [detailed RT-18 plan](./release-0.9.0-plan.md#rt-18) and
> [cache migration/ownership guide](../docs/cache.md).
>
> Fixed same-name binding reuse/missing-binding fallback, ignored custom store
> options and memory-extension registration. Built-ins use actual binding identity
> and complete named declarations; custom factories belong to the current request.
> Same-request memoization tracks shallow env fields/identities, so nested env
> objects must remain stable. Resource disposal remains the factory/caller's job.
> `remember()` captures its provider before awaiting the computation.
>
> Public cache TTLs now use integer milliseconds (`ttlMs`), matching limiter windows.
> Facade `set()` defaults to 3_600_000 ms; direct stores/batches omit expiration
> unless supplied. Zero expires immediately; invalid durations/batch entries reject
> before any write. Multiply old TTL arguments by 1,000 and rename `ttlSeconds` in
> custom/batch contracts. The database adapter stays structurally independent;
> matching pure validators live in each package and must remain aligned.
>
> KV framing prevents namespace/key collisions. Versioned envelopes enforce logical
> expiry independently of native minimum-60-second retention. Old unframed records
> are intentionally not read; indefinite legacy keys need explicit cleanup. DB/DO
> epoch timestamp formats remain unchanged. Stale KV reads cannot delete newer
> writes; real SQLite interleaving proves conditional cleanup preserves replacements.
> DO query-key/found-record protocol preserves null and dot segments; deploy the
> client and class together. DO stubs are obtained inside each operation.
>
> Cache key/value/batch limits, full batch prevalidation, LRU count/serialized-byte
> bounds and bounded DO I/O are covered. DO client requests use five seconds/current
> request signals, strict UTF-8, EOF and at most 2 MiB JSON; unused/error/late bodies
> are disposed without awaiting a producer cancellation hook. A dispatched write
> can still commit; backend failures may leave partial batches. This does not apply
> an automatic I/O deadline to arbitrary custom cache/DB calls or promise rollback.
>
> Native workerd imports the compiled cache/config/core entries. Two Workers share
> native KV/DO storage, isolate alternate bindings and survive actual DO eviction
> and entrypoint reload. Short TTLs expire while KV retains the underlying envelope.
> This proves native compiled-library storage behavior, not live regional KV/write
> throttling, actual pre-header TCP abort delivery or remote producer shutdown.
> Guides, agent examples, runnable demo and generated acceptance use milliseconds.
>
> Verified: framework **1144**/53 files (cache **161**, transport matrix **354**),
> CLI **570**/42 including all **14** generated/runtime cases plus native
> storage/counter/socket fixtures and the real-pnpm release fixture; database
> **86**/15, scaffold **108**/4: **1908** passing cases. Final sequential
> framework/database builds, root `pnpm tsc --noEmit` and all **11** typecheck
> configs pass. Core/Node/Deno sources retain prior unchanged-source evidence;
> this is a reviewed checkpoint, not a complete release audit.
>
> **14/58 checked; all 44 unchecked retained. RT-18 remains open.** Next implement
> limiter URL/scheme/redirect/key/namespace/capacity policies, provider capability
> declarations and inspection (including units), and reject unsupported requested
> guarantees before I/O. Audit all RT-18 criteria before checking it. Keep the
> actual pre-header disconnect gap and arbitrary action/init/restoration deadlines
> under RT-01, plus Deno/Electron/live-provider release gates. Follow the full plan;
> package versions remain 0.8.3 until REL-04. Preserve `reports.md`/`.zcodeignore`.
> Build declarations before CLI/generated consumers; never invoke framework
> `pretest` concurrently with those tests. Use `pnpm exec vitest run` directly.

> **Previous checkpoint — Codex coordinator cancellation (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-sse-cancellation-2026-10-03),
> [RT-18 continuation](./release-0.9.0-plan.md#rt-18), and
> [SSE semantics](../docs/sse.md). **Author: Codex.** Continued after `87495f7`.
> Private operation IDs now own bounded coordinator entries; cancellation removes
> queued callbacks without starting them or releasing the active slot. Native
> cross-Worker RPC abort reaches a pending counter guard; late provider replies
> cannot invoke it. FIFO/capacity/duplicate/ID-reuse behavior is verified. Started
> methods may finish; no external rollback/replay is promised. Queue diagnostics
> contain counts only. Response ownership does not wait on producer cancellation.
>
> New Cloudflare recipes include `enable_request_signal`. Preflight checks the
> selected named environment, and artifact checks include compatibility date/flags.
> Wrangler files are deliberately excluded from template upgrades; regressions
> verify preservation, so existing apps must add the flag explicitly. Hono getter/setter
> receivers and a pre-header SSE cancellation response race are fixed.
>
> **Actual pre-header disconnect delivery remains unverified.** The installed
> workerd did not emit an abort for a TCP disconnect before headers, even in a
> minimal direct-socket Worker with the flag and waitUntil. Generated production
> acceptance uses explicit middleware request signals for JSON/multipart page and
> service calls, including a queued SSE caller that never hits the counter store.
> Counter deadlines release pending decisions before ignored providers respond.
> Neither that acceptance nor local body ownership proves native remote producer
> shutdown. No full server execution deadline/rollback is claimed for arbitrary
> application work that already started. Keep Deno/Electron/live-provider gates.
>
> Verified after final fixes: framework **1033**/50 files (matrix **354**),
> CLI **569**/41 including all **14** generated cases/native fixtures/real-pnpm
> release fixture, scaffold **108**/4. Native raw-body cancellation releases the
> queue despite a never-settling producer hook; remote shutdown/first-byte delivery
> are not asserted for that case. Sequential framework declarations, root
> `pnpm tsc --noEmit` and all **11** `pnpm typecheck` configs pass. Core/Node/Deno
> retain prior unchanged-source evidence; this is not a full release audit.
>
> **14/58 checked; no new checkbox closes. All 44 unchecked tasks persist.**
> Next finish provider URL/key/namespace/capacity/duration policies, cache units
> and configured-provider ownership, capability inspection and rejection of
> unsupported guarantees. `cache.ts` currently memoizes by driver/binding NAME/
> namespace before reading the request's actual binding; custom spec fields are
> omitted. Its memory-factory sentinel also skips other built-in registration
> when memory is extended first. Add regressions before correcting these paths.
> Cache seconds and limiter milliseconds still need the planned public convention. Follow the detailed plan, then audit component
> init/restoration concurrency and remaining RT-01/RT-02/RT-11/RT-14 criteria.
> Keep the entire release scope active; versions stay 0.8.3 until REL-04.
> Preserve `reports.md` and `.zcodeignore`. Run consumers after declaration builds;
> framework `pretest` rebuilds declarations, so use `pnpm exec vitest run` for
> parallel suites. Do not run declaration rebuilds during CLI/generated tests.

> **Previous checkpoint — Codex bounded rate decisions (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-rate-decision-io-2026-10-03),
> [RT-18 continuation](./release-0.9.0-plan.md#rt-18), and
> [rate-limit guide](../docs/rate-limiting.md). **Author: Codex.** Continued after
> `14365b3`. DO/Redis replies now have an 8192-byte strict UTF-8/EOF reader;
> KV text records are bounded before parsing. Error/late replies are cancelled,
> readers release locks and cleanup does not wait forever for producer callbacks.
> A five-second counter decision deadline applies to built-ins and framework
> enforcement of custom stores. Configure `backendTimeoutMs`; async direct
> built-in `hit` accepts `{ signal, timeoutMs }` as an optional third argument.
> Custom stores are raced even if they ignore the signal. No retry or rollback.
>
> HTTP request abort and correlated socket call cancellation/peer close/error
> abort pending decisions. Late replies cannot invoke the action; socket queues
> and pending hooks release. KV avoids dispatching a write after an aborted read,
> but a dispatched write can finish. Router guards recheck abort after validation.
> HTTP/multipart/service proxies now send UUID v4 IDs before response headers;
> the server retains valid UUIDs, replaces unsupported input and still applies
> origin/route guards. XHR progress sends the same header. Returned server IDs
> remain authoritative. Six matrix cases exposed missing pre-header IDs before
> fixing; test XHR doubles now implement `setRequestHeader`.
>
> Verified: core **955**/58 files (43 focused I/O cases and three peer close/error
> queue cases), framework **1032**/50 (matrix **354**), CLI **562**/41, Node
> **16**/4, Deno **16**/2. Total **2581**. Native workerd consumes real DO body
> streams: bounds/UTF-8/errors/deadline/explicit abort reject before mutation and
> local bodies unlock; a valid exact-bound reply succeeds. Worker-local custom
> fetch fixtures prove disposal of late DO-client/Redis-client replies. All 14
> generated cases and the real-pnpm release fixture pass. Root/all 11 package
> type checks and sequential core/framework builds pass. Run dependent suites
> only after declaration generation finishes. Framework's `pretest` rebuilds
> declarations; use `pnpm exec vitest run` when running consumers in parallel.
>
> **14/58 checked; no new checkbox closes. All 44 unchecked tasks persist.**
> Next finish native disconnect/coordinator acceptance: Cloudflare requires
> `enable_request_signal` for incoming client disconnect signals. Audit scaffold,
> upgrades and named environment flags; prove a real disconnect during a pending
> counter decision. This workerd abort uses an explicit request controller; the
> shared matrix's SSE backend is local. Inspect current queued coordinator
> cancellation rather than promising no late mutation there. Native DO producer
> cancel hooks were not observed after subrequest cancellation; local ownership
> does not prove remote producer shutdown. Custom fetch is not live Redis; KV
> mocks do not prove regional consistency. Deno execution remains a release gate.
>
> Then finish provider URL/key/namespace/capacity/duration policies, cache units
> and configured-provider ownership, provider capability inspection and rejected
> unsupported guarantees. Audit component init/restoration concurrency and full
> RT-01 criteria, RT-02/RT-14 policy and RT-11 session/secrets criteria. Preserve
> the full 58-task scope and separate Deno/Electron/tarball/live release gates.
> Versions stay 0.8.3 until REL-04. Preserve `reports.md`/`.zcodeignore`.

> **Previous checkpoint — Codex rate-store contracts (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-rate-store-contracts-2026-10-03),
> [RT-18 continuation](./release-0.9.0-plan.md#rt-18), and
> [rate-limit guide](../docs/rate-limiting.md). **Author: Codex.** Fixed invalid
> backend fallback and first-env global ownership. Automatic selection returns
> and captures the request's store, caching only unchanged env/binding/credential
> descriptors. Missing/invalid bindings, unsupported/blank/non-string/null modes
> and missing credentials reject before mutation. Repair and selection changes
> work. Unconfigured memory and intentional manual overrides remain process-wide.
> Shared component limits use the action context's environment, with bootstrap
> fallback only when the context supplies no env. Internal inspection now passes
> env to `getRateLimitStore` or reads `configureRateLimitFromEnv`'s return value.
>
> Windows/maxima/keys/messages have runtime validation before counter dispatch;
> all counter fields are snapshotted once and checked. Corrupt KV records and
> malformed Redis/custom replies reject. Redis uses millisecond PEXPIRE and
> checked PTTL, and explicit env helpers never borrow process credentials.
> KV storage TTL is at least 60 seconds while logical deadlines remain ms.
> KV has no strict cross-region under-count bound and only one write/key/second;
> failures reject. Guide examples now use fixed-backend setup for manual overrides,
> automatic config for per-request selection, and Worker secrets for Redis tokens.
>
> Verified: core **908**/57 files, framework **1014**/50, CLI **561**/41 with
> four native workerd fixtures/all **14** generated cases, Node **16**/4, Deno
> **16**/2, sequential core/framework builds, root/all **11** package checks.
> The initial contract suite exposed 91 failures; 44 new shared-matrix cases
> exposed 40 failures; a separate peer-env socket case also failed before fixing.
> Final suites include explicit null and changing custom getters. Matrix **342**
> proves correlated sanitized errors, pending/loading cleanup and no mutations.
> Native workerd proves two distinct DO bindings, shared spent counters across
> Workers and backend failure before handler mutation; socket reload into invalid
> config returns a correlated error with count unchanged. Redis tests cover REST/
> script/TTL contracts, not a live Redis service. KV mocks do not prove regional
> consistency. Deno event tests do not replace actual Deno execution.
>
> **14/58 checked; no new checkbox closes. All 44 unchecked tasks persist.**
> Next finish backend I/O ownership: DO/Redis still use unbounded `res.json()`
> and do not carry a request/action abort signal into store calls. Prove body byte
> bounds, UTF-8/EOF/errors, non-success cleanup, deadline/cancellation and no late
> mutation. A backend may already have charged a failed hit; do not retry or
> promise rollback. Then finish provider-specific URL/key/namespace/capacity and
> duration policies, cache units, capability inspection and unsupported-guarantee
> rejection. The detailed plan explains goals and acceptance evidence. Audit
> component init/restoration concurrency and full RT-01 criteria; continue
> RT-02/RT-14 policies and RT-11 secrets/session criteria. Keep separate Deno,
> Electron, tarball and live release gates. Versions stay 0.8.3 until REL-04.
> Preserve `reports.md`/`.zcodeignore`; keep export generation sequential and
> out of running tests/type checks.

> **Previous checkpoint — Codex durable rate windows (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-rate-window-persistence-2026-10-03),
> [RT-18 continuation](./release-0.9.0-plan.md#rt-18), and
> [rate-limit contract](../docs/rate-limiting.md). **Author: Codex.** Fixed the
> strict DO limiter restoring a caller's budget after eviction. Counter/deadline
> now commit together in a storage transaction. Expiry is evaluated after the
> transaction's read; active windows keep their deadline when duration changes.
> Expiry alarms clean records without deleting a newer window. Failed writes,
> corrupt records, invalid DO windows and malformed DO replies reject the hit.
>
> Verified: core **802**/55 files, framework **966**/50, CLI **561**/41 with
> four native workerd fixtures/all **14** generated cases, sequential core build
> and framework declarations, root/all **11** package type checks. All 17 initial
> regressions failed before the fix; the final focused suite has 23 cases. Native
> workerd also failed before the fix at actual DO eviction. It now proves unique
> concurrent counts through two Workers, preserved count/deadline after actual
> eviction and spent budgets after Worker reload. Handler mutation remains zero
> when denied after reload. Existing socket acceptance now evicts the real limiter
> DO before anonymous reconnect and member actions; spent budgets stay denied.
> The component itself still uses forced reconstruction, not timed hibernation.
> This is local workerd evidence, not a live edge or Redis/KV guarantee. The test
> uses the installed binary's newest supported date (`2026-07-29`).
>
> **14/58 checked; no new checkbox closes. All 44 unchecked tasks persist.**
> Next fix `configureRateLimitFromEnv` missing/unknown-mode fallback and its
> module-global first-environment ownership. Prove failure before mutation,
> configuration repair and concurrent environments with distinct stores while
> retaining intentional manual overrides. Validate Redis/KV/custom counters and
> runtime max/window/key policy. Finish provider capability/expiry/unit inspection
> and cache contracts before claiming RT-18. The detailed plan explains each
> goal and proof. Then audit DO component initialization/restoration concurrency
> and full RT-01 criteria, RT-02/RT-14 policies and RT-11 secrets/session criteria.
> Deno/Electron/tarball/live release gates remain separate. Versions remain 0.8.3
> until REL-04. Preserve `reports.md`/`.zcodeignore`. Build core then framework
> declarations before dependent checks; do not regenerate exports during tests.
>
> New namespace examples use SQLite. Existing migration histories remain intact;
> the implementation's transactional key-value API supports legacy DO storage.
> Existing memory-only windows cannot be recovered on the first upgrade. New
> unit fixtures must supply storage transactions and alarm methods.

> **Previous checkpoint — Codex socket peer context (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-socket-peer-context-2026-10-03),
> [RT-01 continuation](./release-0.9.0-plan.md#rt-01), and
> [WebSocket contract](../docs/websockets.md). **Author: Codex.** Fixed synthetic
> anonymous Cloudflare users and missing peer headers/params; shared Node/Deno
> components also now receive each connection's context. Core dispatch passes
> context into queued actions without overwriting shared bootstrap context.
>
> Native attachments retain user and filtered upgrade URL/headers/params. Each
> Cloudflare action creates a fresh Hono context. Cookie/Authorization, common
> credentials and internal assertions are excluded; custom headers/query values
> remain retained. This is a handshake snapshot, not an HTTP middleware scope
> or per-message session revalidation. Oversized attachments return structured
> 413 (workerd throws plain Error); old peers without snapshots reject before
> mutation and close 1012 for reconnect. Child targets receive the same context.
>
> Verified: core **779**/54 files, framework **966**/50, Node **16**/4, Deno
> **16**/2, CLI **560**/40 with three native workerd fixtures and all **14**
> generated runtime cases, sequential builds and root/all **11** package checks.
> The new two-Worker fixture proves verified users/IP/header keys, forged-input
> isolation, interleaved generators, cross-Worker/new-component/reconnect budgets
> with the configured DO store, HTTP/socket counter sharing, oversize refusal and
> component reconstruction using native storage and retained socket attachments.
> Reconstruction is forced, not timed platform eviction. Node uses real sockets;
> Deno adapter wiring is tested through events, not actual Deno execution. One
> existing inspect test hit its 5-second timeout during the first parallel CLI
> run; the complete CLI run alone passes without changing deadlines/assertions.
>
> **14/58 checked; no new checkbox closes. All 44 unchecked tasks persist.**
> Next audit RT-18's configured stores: missing bindings/unknown modes currently
> log and silently fall back to memory, Redis/DO replies lack strict validation,
> and the DO rate counter resets on eviction. Prove fail-closed decisions before
> mutation, fixed-window persistence, concurrent updates and environment/store
> ownership. Do not infer persistence from warm-counter acceptance. Then audit
> component initialization/restoration concurrency and all remaining RT-01
> criteria; continue RT-02/RT-14 schema/file/unknown-key/resource policies and
> RT-11 secrets/session recipes/rotation/concurrency/revocation. Keep separate
> Deno/Electron/tarball/live gates and versions 0.8.3 until REL-04. Preserve
> unrelated `reports.md`/`.zcodeignore`. Build core then framework declarations
> before adapters/dependent checks; keep export generation out of running tests.

> **Previous checkpoint — Codex ordinary JSON envelopes (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-rpc-json-envelopes-2026-10-03),
> [RT-01 continuation](./release-0.9.0-plan.md#rt-01), and
> [RPC contract](../docs/rpc.md). **Author: Codex.** Fixed false completion from
> malformed service-state/redirect metadata and untyped HTTP diagnostic fields.
> All 35 new real-handler regressions failed before the shared decoder; they now
> pass without replaying an action. Component and explicit service clients use
> `core/shared/rpc-json.ts` before state/result/navigation effects.
>
> Ordinary JSON/error bodies have a total 1 MiB byte cap, exported as
> `RPC_JSON_RESPONSE_MAX_BYTES`, strict UTF-8/object validation and EOF ownership.
> Overflow/abort/body errors cancel and release readers; deadlines remain active.
> Service state must be an object; component replies reject the service wrapper.
> Redirects are exclusive HTTP/HTTPS-or-relative URL metadata. HTTP error fields
> have structural checks; body IDs must match known headers. Ordinary app state
> named `requestId` is preserved. Native failure bodies stay opaque; non-JSON
> middleware failures retain generic status diagnostics. These are client checks:
> a rejected reply cannot undo a mutation that already ran. See the migration
> guide before writing custom response producers or larger RPC data returns.
>
> Verified: sequential core build/framework declarations; core **775**/53 files,
> framework **966**/50, CLI **559**/39 including both real-workerd fixtures, all
> **14** generated runtime cases and the real-pnpm release fixture, root TypeScript
> and all **11** package checks. The matrix has **294** cases; **31** new core
> cases cover byte/UTF-8/body/EOF/diagnostic and public proxy lifetime boundaries.
> Older proxy fixtures now use real Responses rather than bypassing body reads.
>
> **14/58 checked; no new checkbox closes. All 44 unchecked tasks remain in
> scope.** Next use the existing Cloudflare fixtures to prove WebSocket/DO peer
> identity/header context, reconnect and custom rate keys; the neutral socket
> matrix does not prove that runtime boundary. Audit configured counter-store
> failures, namespace ownership, persistence and consistency. Anonymous/IP parity
> remains unverified, and route namespaces do not make memory counters distributed.
> After that evidence, audit RT-01 against its full criteria; continue RT-02/RT-14
> schema/file/unknown-key/resource policies and RT-11 session recipes, sensitive
> old-input exclusion, rotation and concurrency. The detailed plan explains every
> task's purpose and acceptance evidence. Preserve Deno/Electron/tarball/live
> gates, versions 0.8.3 until REL-04, and unrelated `reports.md`/`.zcodeignore`.
> Rebuild core then framework declarations before dependent checks; avoid
> regenerating exports while tests/types consume them.

> **Previous checkpoint — Codex child targets and action limits (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-rpc-target-limits-2026-10-03),
> [RT-01 next audit](./release-0.9.0-plan.md#rt-01), and
> [rate-limit contract](../docs/rate-limiting.md). **Author: Codex.** Fixed
> WebSocket dispatch bypassing `@RateLimit`, generic HTTP limit/target errors,
> page and child actions charging one budget, process-local SSE child state
> overwriting same-named page keys, and malformed targets falling through socket
> root dispatch. The actual socket message handler now rejects a malformed known
> ID even when its frame type is missing; unrelated pending calls remain intact.
>
> The shared counter decision uses trusted socket peer identity. Server-assigned
> canonical route ownership prevents JSON/multipart/socket switching from
> restoring the same action/caller/store budget. Child classes remain separate
> from page classes; inherited and forwarded service limits work. Store failures
> reject before mutation with private details redacted and loading cleaned.
> Process-local SSE publishes the root snapshot for ordinary and generator child
> actions, matching distributed target/page separation. HTTP limit replies add
> `COSSACK_RPC_RATE_LIMITED`, the ID, 429 and Retry-After.
>
> Verified: sequential core build/framework declarations; matrix **259**,
> child-target suite **18**, core **744**/52 files, framework **931**/50,
> CLI **559**/39 including both real-workerd fixtures and all **14** generated
> runtime cases, root TypeScript/all **11** package checks. New production
> workerd checks prove JSON then multipart limiting, D1 writes only for allowed
> calls, and layout-service budget sharing across HTTP/SSE pages. Fixed the
> tarball fixture's warm-cache dependency by isolating pnpm metadata/content
> caches; replaced a short wall-clock expiry delay with an exact clock boundary.
>
> **14/58 tasks checked; all 44 unchecked tasks remain in scope.** No checkbox
> closes. Next audit ordinary/error JSON envelopes and actual Cloudflare socket/
> DO peer identity, custom rate keys and reconnect. Anonymous/header context
> parity and configured-store failure/consistency/persistence remain unverified;
> shared namespaces do not make memory counters distributed. Then complete
> RT-01's criterion audit and continue RT-02/RT-14 policies and RT-11 session
> criteria. Preserve the separate Deno/Electron/tarball/live-deployment gates,
> versions 0.8.3 until REL-04 and unrelated `reports.md`/`.zcodeignore`. Read the
> detailed plan for each next task's purpose and evidence requirements.

> **Previous checkpoint — Codex RPC protocol boundaries (2026-10-03):** read
> [review and verification](./release-0.9.0.md#codex-rpc-protocol-boundaries-2026-10-03),
> [RT-01 next steps](./release-0.9.0-plan.md#rt-01), and
> [RPC contract](../docs/rpc.md). **Author: Codex.** Regressions reproduced lost
> known request IDs, a first frame disagreeing with the response ID, and success
> being exposed before trailing data was checked. The shared reader now retains
> correlation and holds done/error until response EOF. Invalid trailing data or
> body failures reject before terminal state hydration; earlier yield state stays
> visible. Cancellation remains active while waiting for EOF. No mutation retries
> or rollback were added. Non-whitespace IDs/error codes and frame shapes are
> validated across HTTP and WebSocket boundaries.
>
> The matrix now has **242** cases: 52 shared cases across four paths (208), six
> response-local boundary cases, 13 raw multipart and 15 multipart client/router
> cases. WebSocket fault injection targets correlated frames, preserving socket
> initialization/broadcasts. Unknown IDs cannot hydrate another call; malformed
> known-ID frames reject only their pending call. Socket terminal frames complete
> the individual call without waiting for the persistent connection to close.
>
> Verified: core build and framework declarations; core **739**/52 files,
> framework **896**/49, CLI **559**/39 including both real-workerd fixtures and
> all **14** generated runtime cases; root TypeScript and all **11** package
> checks. Protocol docs, architecture and migration notes describe EOF timing.
>
> **14/58 tasks checked; all 44 unchecked items remain in scope.** No checkbox
> closes in this checkpoint. Continue RT-01 with child/action target isolation
> and rate-limit ownership using real public proxy/handler fixtures; the detailed
> plan explains the goal and acceptance evidence. Then finish schema/file/
> unknown-key/resource policy with RT-02/RT-14 and sensitive old-input/session
> rotation/concurrency with RT-11. Deno execution, Electron packaging, published
> tarball installation and live deployment retain their separate evidence gates.
> Keep versions 0.8.3 until REL-04; preserve unrelated `reports.md` and
> `.zcodeignore`. Rebuild declarations sequentially before dependent verification.

> **Previous checkpoint — Codex built Workers RPC acceptance (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-workers-rpc-acceptance-2026-10-03),
> [RT-01](./release-0.9.0-plan.md#rt-01), [RT-11](./release-0.9.0-plan.md#rt-11),
> and [SSE response contract](./sse.md). **Author: Codex.** Real workerd exposed
> a coordinator bug: a native Response using the RPC NDJSON MIME type lost its
> body. `SseDurableObject.execute()` now checks the reserved native marker before
> protocol parsing. Native data stays opaque while retaining response ownership
> and the serialization slot. The two-Worker regression proves bytes/headers,
> unchanged scope state and subsequent progress.
>
> The generated staging-app fixture now builds with `NODE_ENV=production`, then
> runs the exact artifact with real D1, auth and the distributed SSE binding.
> Direct multipart tests cover HTTP/SSE component and explicit service calls,
> nested Unicode Files, input/auth rejection, early cookies, late-cookie errors,
> generator/final results, cancellation and native NDJSON/JSON/binary/204 bodies.
> D1 audit writes during generator completion, page cleanup and service disposal
> prove request path/user/ORM ownership. A D1 release gate proves early yields
> without timing assumptions; cancellation explicitly releases finite fixture I/O.
>
> Chromium uses the production hashed scripts and public clients to verify early
> yields through XHR components and Fetch services, upload progress, native body
> completion, all four redirect cookies and one-time flash/old-input consumption
> on HTTP/SSE pages. Published package entries are exercised; this is not a
> tarball installation or live deployment test. Queued-callback cancellation,
> Deno execution and Electron packaging remain separate evidence requirements.
>
> Verified: framework declarations, focused two-workerd fixtures, framework
> **858**/49 files, CLI **559**/39 (including all **14** generated runtime cases),
> root TypeScript and all **11** package checks. Core is unchanged from the
> previous **726**-test checkpoint. Exact commands are in the linked log.
>
> **14/58 tasks checked; all 44 unchecked items remain in scope.** RT-01 stays
> open for systematic protocol/malformed-frame, child-target and rate-limit
> boundaries. Continue file/unknown-key/schema policies with RT-02/RT-14 and
> sensitive old-input, complete session recipes, rotation and concurrency with
> RT-11. Keep versions 0.8.3 until REL-04 and preserve unrelated `reports.md` and
> `.zcodeignore`. Rebuild declarations sequentially before dependent tests.

> **Previous checkpoint — Codex multipart RPC parity (2026-10-03):** read
> [review and verification](./release-0.9.0.md#codex-rpc-multipart-2026-10-03),
> [RT-01](./release-0.9.0-plan.md#rt-01), [RT-02](./release-0.9.0-plan.md#rt-02),
> and [RPC guide](../docs/rpc.md). **Author: Codex.** `/upload` now shares `/crpc`'s
> scoped action pipeline. Guards and dispatch use one cached decoder; nested
> File/FileList arguments work for HTTP/SSE components and explicit services.
> Action-input validation, layout service ownership, request/ORM context,
> streaming, native/helper/flash cookies and awaited cleanup use the same path.
> Malformed metadata, duplicate fields/parts and invalid file markers reject
> before construction with `COSSACK_RPC_REQUEST_INVALID` and a request ID.
>
> Fetch is the default multipart client. A numeric `<method>Progress` field
> selects XHR upload progress; complete UTF-8 generator frames arrive before
> load. XHR retains cumulative response text and cannot pause network downloads;
> its per-frame limit does not bound total browser buffering. Prefer Fetch for
> long streams. Native XHR bodies keep binary bytes/headers. Cancellation while
> an iterator is parked at a yield now retains its known request ID.
>
> Verified: core build and framework declarations; matrix **204** (176 shared,
> 13 raw multipart and 15 multipart client/router cases); paired JSON/multipart
> router lifetime suite **50**; full core **726**/52 files, framework **858**/49,
> CLI **559**/39 (all **14** generated runtime cases); root TypeScript and all
> **11** package checks. Production Chromium tests consume early Unicode yields
> from nested-file HTTP/SSE page and service calls and preserve native upload
> bytes/status/headers. Test fixture counters now belong to their original
> request fixture, so delayed cancellation cleanup cannot contaminate later tests.
>
> **14/58 tasks checked; no new task closes. All 44 unchecked tasks remain in
> scope.** Next extend existing built Workers fixtures for multipart/native body
> consumption, cookies/flash/auth guards, request ownership and distributed SSE.
> Then finish protocol/malformed-frame, child-target, rate-limit and file-policy
> boundaries with RT-02/RT-14. RT-02 still needs schema inference, unknown-key,
> array/file and resource-policy contracts. RT-01 and RT-11 remain open; Deno
> execution/Electron packaging and full release gates remain separate evidence.
> Versions stay 0.8.3 until REL-04. Build declarations sequentially before
> dependent tests. Preserve unrelated `reports.md` and `.zcodeignore` edits.

> **Previous checkpoint — Codex native RPC responses (2026-10-03):** read
> [review and evidence](./release-0.9.0.md#codex-rpc-native-response-2026-10-03),
> [RT-01](./release-0.9.0-plan.md#rt-01), [RPC guide](../docs/rpc.md), and
> [migration](./migration-0.9.0.md). **Author: Codex.** Successful ordinary native
> HTTP/SSE component/service actions now resolve to a local browser Response,
> with status/status text, bytes and browser-visible headers. A reserved header
> separates JSON/NDJSON bodies from framework state/protocol metadata. The body
> drains before completion with a 1 MiB limit, deadlines, cancellation and request
> cleanup, including unobserved calls. Native redirects navigate and return
> undefined; failure statuses keep correlated RPC errors. Native bodies never
> hydrate action state. `RpcResult<Response>` is now `Response | undefined`;
> generator Response values remain invalid and infer never. Repeated awaits share
> the one-use local body; clone before multiple reads. WebSocket rejection cancels
> the native body. Upload XHR preserves binary bytes and browser-visible headers.
>
> Passed: core build, framework declarations, matrix **178** (172 shared transport
> + six multipart cases), core **718**/51 files, framework **807**/49, CLI **559**/39
> (all **14** generated runtime cases), root TypeScript and all **11** package checks.
> Real Node production browsers verify HTTP/SSE page text, service binary bodies
> and a binary upload's bytes/status/headers; existing redirect/cookie tests pass.
> Own-file whitespace checks passed; exact commands are in the linked log.
>
> **14/58 tasks checked; RT-01 stays open.** Continue multipart parity next.
> The upload handler still has a separate bootstrap/dispatch path, top-level-only
> file reconstruction, no shared action-input validation, no full layout ownership
> chain/awaited disposal boundary and no generator response handling. Write real
> proxy/router regressions and share JSON RPC's validation/lifetime machinery.
> Preserve upload progress; streaming a generator is required, not collecting
> it into ordinary JSON. Cover nested files, bad input/markers, service scopes,
> validation before mutation, cancellation, context/ORM/disposal and native/helper/
> flash cookies/redirects. Ordinary/native upload tests prove only their slices.
> Finish protocol diagnostics and built Workers/realtime acceptance with RT-11,
> including native bodies. Secret exclusion, recipes, rotation and concurrency
> remain open there. Continue all unchecked tasks and Deno/Electron release gates;
> versions stay 0.8.3 until REL-04. Build declarations before dependent tests without
> simultaneous regeneration. Preserve unrelated `reports.md` and `.zcodeignore`.

> **Previous checkpoint — Codex JSON RPC values and types (2026-10-03):** read
> [review and verification](./release-0.9.0.md#codex-rpc-json-values-2026-10-03),
> [RT-01](./release-0.9.0-plan.md#rt-01), [RPC values](../docs/rpc.md), and
> [migration notes](./migration-0.9.0.md). **Author: Codex.** Core now snapshots
> and validates actual JSON data once before encoding across component/service
> HTTP/SSE, WebSocket frames and ordinary multipart results. Dates become strings,
> model fields lose native prototypes, custom hooks supply validated output,
> undefined object fields omit and array entries become null. Lossy/opaque/binary
> values, invalid dates, cycles, throwing hooks/getters and excess depth reject
> with sanitized paths. Root hook keys agree across envelopes. `RpcSerialized`,
> `RpcResult`, `RpcYield`, authored `rpc$` and compiler rewriting now agree on
> result/yield types. Parameters and hydrated state annotations still need JSON
> types; this does not add native revival. Fixed state hook comparison keys,
> own `__proto__` extraction, silent WebSocket binary-argument removal, and upload
> private-error/request-ID diagnostics.
>
> Passed after the final code change: core build, framework declarations,
> matrix **134** (128 shared transport cases + six multipart), core **710**,
> framework **763**, CLI **559** across 39 files (all **14** generated runtime
> cases, including production HTTP/SSE JSON-value browser acceptance), root
> TypeScript and all **11** package checks. Own-file whitespace checks passed.
> Exact commands and scope limits are in the linked verification entry.
>
> **14/58 tasks checked; RT-01 remains open.** Next audit native Response bodies
> through public proxy clients: the router forwards responses but clients still
> expect JSON/state and can reject arbitrary non-JSON bodies. Decide/document
> supported completion semantics, then test them. Extend multipart coverage to
> generators, nested files, scoped ownership/cleanup, cookies/redirects, input
> boundaries and errors. Ordinary-upload tests do not establish full parity.
> Finish protocol diagnostics and Workers/realtime cookie/header acceptance with
> RT-11. Its secret exclusion, recipes, rotation and concurrency criteria remain
> open. Continue all other unchecked tasks, including Deno/Electron release gates;
> versions stay 0.8.3 until REL-04. Build declarations sequentially before
> dependent tests. Preserve unrelated `reports.md` and `.zcodeignore` edits.

> **Previous checkpoint — Codex shared RPC conformance matrix (2026-10-03):** read
> [acceptance evidence](./release-0.9.0.md#codex-rpc-conformance-matrix-2026-10-03)
> and [the detailed RT-01 plan](./release-0.9.0-plan.md#rt-01). **Author: Codex.**
> One matrix runs 19 shared cases against HTTP, SSE, WebSocket, and explicit
> scoped service calls (76 tests). HTTP paths execute the real router with
> published core proxies; WebSocket executes the real in-memory runtime dispatcher.
> It covers completion, yields/state, error redaction/validation, deadlines,
> cancellation/iterator return, duplicate consumption, disconnect uncertainty,
> serialization paths, loading/pending-map cleanup, and ownership. Controlled
> transport faults do not replace application results. Fixed service RPC exposing
> private exceptions in development, WebSocket paths losing payload/state roots,
> and HTTP/SSE/service errors losing a known response ID on invalid JSON, deadlines,
> or disconnect. Before HTTP headers arrive the server ID may be unavailable.
>
> Passed: focused matrix 76, full core 685 and framework 705, core build, framework
> declarations, root TypeScript, all 11 package checks, and full CLI 559 across
> 39 files (all 14 generated runtime cases). Own-file diff checks passed; exact
> commands are in the linked checkpoint. Updated the RPC
> guide and draft migration guide. No release/deployment performed.
>
> **14/58 tasks checked; RT-01 remains open.** Next audit supported wire values
> against client types (Date/JSON, undefined/void, non-finite/binary values, custom/
> model serialization). Extend this matrix and existing semantic fixtures.
> Finish protocol diagnostics and Workers/realtime response timing with RT-11.
> Physical upgrades/distributed coordination and Deno/Electron release gates need
> separate evidence. RT-11 still needs secret exclusion, recipes, rotation, and
> concurrency semantics. Continue every other unchecked task after these; keep
> versions at 0.8.3 until REL-04. Build declarations before dependent tests without
> simultaneous rebuilds. Preserve unrelated `reports.md` and `.zcodeignore` edits.

> **Previous checkpoint — Codex RPC response timing (2026-10-03):** read
> [review and acceptance](./release-0.9.0.md#codex-rpc-response-timing-2026-10-03),
> [RT-01](./release-0.9.0-plan.md#rt-01), and
> [RT-11](./release-0.9.0-plan.md#rt-11). **Author: Codex.** Fixed native
> response cookies being overwritten, native redirects becoming HTML fetches,
> and early cookies disappearing when returning lazy generators. HTTP/SSE
> component/service RPC preserves native/helper/flash cookies together.
> Response middleware now seals the structural header phase after outgoing
> middleware; late cookie/header/flash writes reject explicitly. Late session
> rotation/destruction reject before storage changes. Background transports
> preserve valid incoming flash; HTTP errors discard partial outgoing flash.
> WebSocket actions reject native Responses; nested HTTP objects get precise
> serialization errors. Network errors explain uncertain completion and no retry.
>
> Regression coverage includes native router responses, four background endpoints,
> session storage preservation, and a real production Node browser for page/service
> redirects, HTTP-only cookies, old input, flash consumption/reload, and early/late
> streaming cookies. Generated source type checks before builds. Core build,
> framework declarations, full core 685 and framework 629 tests, root TypeScript,
> all 11 package type checks, and full CLI 559 tests across 39 files (all 14 generated
> cases) passed. Own-file diff checks passed. Exact commands are in the linked
> checkpoint. No release/deployment performed.
>
> **14/58 tasks checked; RT-01 and RT-11 remain open.** Next consolidate the
> conformance matrix across HTTP, SSE, WebSocket, and explicit services for values,
> yields, errors, deadlines, disconnect, cancellation, duplicate consumption, and
> cleanup. Audit supported serialization types and verify response timing through
> Workers/realtime integration. Preserve backpressure: never prime generators to
> enable header writes. Prepare headers in an ordinary async action before returning
> a generator. Raw Response.headers mutation bypasses the guard; stream errors
> cannot retract sent cookies. RT-11 still needs secrets excluded from old input,
> complete recipes, and rotation/concurrency contracts. Then continue RT-02/RT-14
> and every other unchecked task. Versions stay 0.8.3 until REL-04. Build declarations
> before dependent tests, without concurrent rebuilds. Leave unrelated `reports.md`
> and `.zcodeignore` edits untouched.

> **Previous checkpoint — Codex authored client RPC types (2026-10-03):** read
> [implementation and acceptance](./release-0.9.0.md#codex-authored-rpc-types-2026-10-03)
> and [the client guide](../docs/rpc.md). **Author: Codex.** Public
> `rpc$(this.method(...))` exposes inferred `RpcCall<Result, Yield>` types in
> authored client code without a Vite rewrite or user cast. It returns the same
> proxy call by identity. Published-declaration semantic checks cover methods,
> inferred/annotated generators, inheritance, generics, function fields, services,
> result/yield errors, and cancellation. Production browser acceptance executes
> HTTP/SSE methods plus page/service generator fields and verifies one dispatch
> per action and stripping. Existing WebSocket/service conformance uses the helper.
> Fixed ordinary HTTP/SSE JSON return values appearing as extra yields; they now
> complete without yields, matching other transports and their types. Record this
> break in final release docs; a [draft migration guide](./migration-0.9.0.md) now
> tracks it. Passed: core build; full core 682 tests, framework 617, and CLI 558
> (all 13 generated cases included). Final focused RPC/semantic checks: 57;
> root TypeScript and all 11 package type checks pass. No release/deploy performed.
>
> **14/58 tasks checked. RT-01 remains open.** Next audit/consolidate one transport
> conformance matrix for all four paths and finish native Response/cookie/flash
> coordination with RT-11, including committed streaming headers. Typed authored
> inference and function-field/browser coverage are complete; do not redo that
> work. Then continue RT-02 schema inference/unknown keys/arrays/files and shared
> policies (RT-14), plus every other unchecked task. Preserve the complete release
> scope. Versions stay 0.8.3 until REL-04. The migration guide is a draft, not a
> claim that all release breaks are already recorded or verified.

> **Previous checkpoint — Codex four recipes and capability planning (2026-10-03):** read
> [completion evidence](./release-0.9.0.md#codex-four-recipe-capabilities-2026-10-03).
> **Author: Codex.** CLI-05 and RT-25 are complete against their written criteria:
> **14/58 tasks checked; all 44 unchecked tasks remain in scope.** Scoped-service
> acceptance verifies explicit service RPC, nested/sibling injection, retained
> browser state, disposal on layout exit, and fresh state on return. Protected-route
> acceptance uses real migrations, registration/login, sessions, nested guards,
> forged state, and persisted expiry. Fixed auth-only User relations targeting
> unregistered RBAC entities; model ownership now follows selected features.
> The pure capability model lives in core's published `runtime-capabilities`
> entry, with framework re-exporting it. Scaffold planning imports core, never
> framework. Native D1/Hyperdrive plus Desktop fails before create/add writes.
> Older recorded combinations remain inspectable with target/source diagnostics.
> Updated isolated upgrade fixtures to supply the newly declared core dependency.
> Passed: scaffold 108, core 676, framework 617, and all 557 CLI tests across
> 39 files (including 12 generated acceptance and 10 upgrade tests). Core build,
> framework type generation, root TypeScript, all 11 package type checks, and the
> final diff whitespace check passed.
>
> **Next phases:** follow the detailed plan and remaining checklist, starting
> with RT-01 authored TypeScript/IDE RPC inference and RT-02 schema contracts,
> then the remaining resource, DI ownership, and policy contracts (RT-03/12/14).
> Existing recipes demonstrate current APIs; they do not close those broader
> requirements. Keep validation shared, public state untrusted, and ownership
> metadata aligned with the compiler. Deno execution and Electron packaging
> remain REL-03 gates. Versions stay 0.8.3 until final REL-04 verification.
> Build library declarations before dependent tests; avoid simultaneous builds
> and type checks. Preserve unrelated `reports.md` and `.zcodeignore` changes.

> **Previous checkpoint — Codex mutation and browser acceptance (2026-10-03):** read
> [mutation recipe and hydrated UI acceptance](./release-0.9.0.md#codex-mutation-browser-recipe-2026-10-03).
> **Author: Codex.** `cossack add mutation` creates a validated public HTTP form
> with explicit payload snapshots, client-only form state, field errors, pending
> controls, preserved failed input, reset, and retry. It saves/sends nothing;
> application authorization/persistence must be added server-side. Chromium
> acceptance now verifies both resource and mutation recipes in a built Node app.
> Fixed failed resource loaders not requesting a render; obsolete failures remain
> ignored. Fixtures build with NODE_ENV=production, and CI installs Chromium
> before CLI tests. Passed: 99 scaffold tests, 676 core tests, all 553 CLI tests
> (including generated browser acceptance), 2 bundled-route checks, root TypeScript,
> and all 11 package type checks. **12/58 tasks remain checked.** Next add the
> protected-route and scoped-service recipes through the same registry and shared
> capability model; complete their generated runtime/browser acceptance and repeat
> the RT-25 audit. Keep every other unchecked release task in scope.

> **Previous checkpoint — Codex resource recipe (2026-10-03):** read
> [resource acceptance and capability audit](./release-0.9.0.md#codex-resource-recipe-2026-10-03).
> **Author: Codex.** `cossack add resource` now creates a read-only HTTP resource
> with loading/error/empty/retry UI and no database dependency. Generated types,
> builds, SSR, stripping, and real RPC behavior are tested. Fixed Node attach's
> server type contract, exposed by generated TypeScript checking. Passed: 98
> scaffold tests, 36 CLI/acceptance tests, 15 adapter tests, and all types.
> **12/58 tasks remain checked.** Next implement CLI-05 validated mutation,
> protected route, and scoped service recipes, plus browser-state acceptance.
> The RT-25 plan now maps its exact criteria to evidence: remaining integration
> with those recipes is explicit; Deno/Electron execution is a broader release gate.

> **Previous checkpoint — Codex native database bindings (2026-10-03):** read
> [D1/Hyperdrive capability requirements](./release-0.9.0.md#codex-native-database-capabilities-2026-10-03).
> **Author: Codex.** Selected D1/Hyperdrive recipes now declare native Cloudflare
> bindings. Builds and CLI checks report missing DB/HYPERDRIVE configuration;
> Desktop rejects those native requirements before module compilation. Fixed
> Cloudflare Vite plugin activation in Desktop mode; a portable Cloudflare
> application now builds its Desktop target with Workers-free chunks.
> Passed: 97 scaffold tests, 30 capability tests, 21 CLI/build tests, all types.
> **12/58 tasks remain checked.** Continue the RT-25 acceptance audit against its
> written criteria and finish remaining release tasks; do not treat capability
> configuration checks as proof of remote resource readiness.

> **Previous checkpoint — Codex recipe requirements (2026-10-03):** read
> [selected recipe capability declarations](./release-0.9.0.md#codex-recipe-requirements-2026-10-03).
> **Author: Codex.** Scaffold exports `recipeCapabilityRequirements()` and emits
> target-specific requirements into generated Vite configs. SQLite filesystem
> needs apply only when the database feature is selected; Desktop filesystem
> needs apply only to Desktop builds. CLI inspection exposes and checks web
> requirements through the shared model. Verification: 94 scaffold tests, 31
> CLI/build acceptance tests, and all types passed. **12/58 tasks remain checked.**
> Continue RT-25 remaining provider/capability audits and runtime acceptance;
> extend declarations when adding runtime-dependent recipes. Deno execution and
> Electron launch/packaging remain unverified, so do not close the task yet.

> **Previous checkpoint — Codex bundled route exports (2026-10-03):** read
> [example route corrections](./release-0.9.0.md#codex-bundled-route-exports-2026-10-03).
> **Author: Codex.** Eighteen additional bundled demo pages now export their
> component as default. The cache-regression store moved outside the pages tree
> so it no longer registers as a route. A shared-parser contract test audits every
> TypeScript page/layout/loading module in framework and scaffold trees.
> Framework build, 614 tests, and all package type checks passed.
> **12/58 tasks remain checked.** Continue RT-25 selected recipe requirements
> and remaining runtime acceptance; the bundled default-export audit is complete.

> **Previous checkpoint — Codex durable page capability (2026-10-03):** read
> [build and inspection durability checks](./release-0.9.0.md#codex-durable-state-capability-2026-10-03).
> **Author: Codex.** Builds and CLI inspection now distinguish WebSocket support
> from durable page state. Static `stateful: true` requires `durableState`, which
> Node/Deno/Desktop cannot supply. Cloudflare requires `COSSACK_OBJECT`.
> Dynamic durability stays unknown. Framework: 612 tests; CLI: 546 tests; all
> package types passed. **12/58 tasks remain checked.**
> Continue RT-25 selected recipe requirements and remaining capability/runtime
> acceptance; inspect bundled examples for default-export compliance.

> **Previous checkpoint — Codex Node development runtime (2026-10-03):** read
> [dev WebSockets, HMR, and reload acceptance](./release-0.9.0.md#codex-node-development-runtime-2026-10-03).
> **Author: Codex.** Generated dev servers attach the exported runtime, dispose
> replaced instances, coalesce reload requests, and keep Vite HMR on the same
> HTTP server. SIGINT/SIGTERM drain runtime and server resources.
> Four generated runtime acceptance cases pass, including real HMR/Cossack
> sockets, page reload, rapid edits, HTTP, and graceful process exit.
> **12/58 tasks remain checked.** Next audit RT-25 selected feature requirements
> and advertised capabilities; Deno execution/Electron launch remain unverified.
> Also audit bundled page examples for the required default exports.

> **Previous checkpoint — Codex guarded Node runtime (2026-10-03):** read
> [Node integration and portable targets](./release-0.9.0.md#codex-node-guarded-runtime-2026-10-03).
> **Author: Codex.** New `createNodeAdapter()` sends upgrades through the full
> application before handshaking, preserving router guards and layout scopes.
> Generated production entries attach it. Real socket tests verify middleware,
> auth, shared initialization, disposal, and built-app origin/scope guards.
> Bootstrap now accepts router-resolved provider targets, avoiding Cloudflare
> binding access on Node/Deno. **12/58 tasks remain checked.**
> Next: attach the runtime in the generated Node dev server, dispose it on reload,
> preserve Vite HMR, and exercise development connections. Audit remaining bundled
> examples for default-export compliance; two SSG demos were corrected here.

> **Previous checkpoint — Codex Deno shutdown (2026-10-03):** read
> [shutdown and action lifetime verification](./release-0.9.0.md#codex-deno-shutdown-2026-10-03).
> **Author: Codex.** Deno exposes idempotent `dispose()`, integrates cleanup with
> native server shutdown/completion, and waits for active actions before component
> disposal. Shutdown also drains pending creation and retired entries.
> **12/58 tasks remain checked.** Fifteen adapter tests, build, and root/package
> types passed. Deno is absent on this host: live socket acceptance remains open.
> Next work: guarded Node WebSocket integration and generated-app acceptance.
> Deno cleanup waits for user actions to settle; no forced timeout is implemented.

> **Previous checkpoint — Codex Deno runtime eviction (2026-10-03):** read
> [concurrent creation and disposal](./release-0.9.0.md#codex-deno-runtime-eviction-2026-10-03).
> **Author: Codex.** Deno now shares pending component creation by scope, counts
> reservations against capacity, awaits eviction disposal, and ignores callbacks
> after connection close. Nine adapter tests and the package build pass.
> **12/58 tasks remain checked.** Next finish Deno shutdown and in-flight action
> cleanup, then Node guarded runtime wiring. Real Deno socket lifecycle acceptance
> remains required; these new tests mock Hono's socket event bridge.

> **Previous checkpoint — Codex runtime WebSocket scopes (2026-10-03):** read
> [scope creation and cleanup fixes](./release-0.9.0.md#codex-runtime-websocket-scopes-2026-10-03).
> **Author: Codex.** The guarded runtime WebSocket factory now constructs nested
> layout service scopes and bootstraps with original page parameters, user, and
> bindings. Page destruction disposes the whole tree; failed construction cleans
> up too. **12/58 tasks remain checked; RT-12 and RT-25 remain open.** Core: 673
> tests; framework: 608 tests; root and all package type checks passed.
> Next: route Node upgrades through the guarded framework hook, add adapter
> eviction/shutdown disposal and concurrent creation coverage, then verify real
> generated Node WebSocket connections. The legacy adapter is not wired in.

> **Previous checkpoint — Codex generated runtime builds (2026-10-03):** read
> [real configuration builds and Node startup correction](./release-0.9.0.md#codex-generated-runtime-builds-2026-10-03).
> **Author: Codex.** Generated Node/Deno and Desktop side-target builds now have
> acceptance coverage; Node's built HTTP app is exercised. Fixed imports crashing
> when process.argv[1] is absent. **12/58 tasks remain checked.** RT-25 still needs
> Node realtime wiring/capability parity and selected recipe feature requirements.
> Deno execution and Electron launch/packaging were not verified here.

> **Previous checkpoint — Codex handler/default parity (2026-10-03):** read
> [CLI classification and runtime selection corrections](./release-0.9.0.md#codex-handler-default-parity-2026-10-03).
> **Author: Codex.** CLI/build discovery recognize functional HTTP modules only
> inside the router's API boundary. Runtime component paths select default exports
> instead of whichever helper appears first. Runtime SSR/SSG/guard regressions
> verify the fixes. **CLI-04 complete; 12/58 tasks checked.** Full CLI: 539 passed;
> framework: 605 passed; all package types passed. Continue RT-25 generated-app/
> side-target acceptance and selected feature requirements.

> **Previous checkpoint — Codex recipe capability wiring (2026-10-03):** read
> [generated config and binding discovery](./release-0.9.0.md#codex-recipe-capability-wiring-2026-10-03).
> **Author: Codex.** Recipes now select runtime capability checks, including
> Desktop mode. Cloudflare binding discovery uses the project's Wrangler parser
> and selected environment, returning names only. **CLI-04 reopened; 11/58 checked.**
> Generated-app validation exposed named HTTP route handling and first-export
> versus default-export runtime selection that CLI inspection must reconcile.
> Build discovery now accepts named HTTP handlers. Continue those CLI/runtime
> fixes, then RT-25 complete generated-app acceptance and feature planning.

> **Previous checkpoint — Codex page capability discovery (2026-10-03):** read
> [shared parser and automatic build checks](./release-0.9.0.md#codex-page-capability-discovery-2026-10-03).
> **Author: Codex.** Framework now publishes `page-inspection`; CLI re-exports it.
> Selecting a build runtime automatically checks discovered page transports,
> without importing pages or repeating their requirements in config.
> **12/58 tasks remain checked.** Continue recipe/config integration,
> selected-environment binding discovery, and generated-app acceptance for RT-25.

> **Previous checkpoint — Codex schedule capability audit (2026-10-03):** read
> [adapter-dependent status and verification](./release-0.9.0.md#codex-schedule-capability-2026-10-03).
> **Author: Codex.** Node/Deno no longer advertise scheduled dispatch that their
> built-in adapters do not implement. Shared inspection reports `adapter-required`;
> selected schedule requirements fail builds with a dedicated diagnostic.
> **12/58 tasks remain checked.** Continue RT-25 automatic page requirements,
> recipe configuration, environment binding discovery, and generated-app builds.

> **Previous checkpoint — Codex build capabilities (2026-10-03):** read
> [selected requirement enforcement and next integration](./release-0.9.0.md#codex-capability-build-2026-10-03).
> **Author: Codex.** `cossackPages({ capabilities })` rejects unsupported or
> unconfigured selected features before bundle output, using the shared model
> and source-bearing diagnostics. **12/58 tasks remain checked.** RT-25 still
> needs recipe/generated-config integration, automatic page requirements,
> selected-environment bindings, and adapter capability verification.

> **Previous checkpoint — Codex CLI-04 completion (2026-10-03):** read
> [module validity fixes and requirement audit](./release-0.9.0.md#codex-module-inspection-2026-10-03).
> **Author: Codex.** Missing/unresolved default exports now fail route checks;
> unsupported inherited layout options and dynamic service references stay
> unknown. The compiler and executed SSG acceptance fixtures meet CLI-04's
> contract. **12/58 tasks are checked.** Verification: 534 CLI tests, executed
> service acceptance, and root types passed. Next continue **RT-25 build/recipe
> capability enforcement**; typed routes, config registry, and runtime release
> gates remain separate unfinished tasks.

> **Previous checkpoint — Codex service inspection (2026-10-03):** read
> [executed acceptance, fixes, and remaining audit](./release-0.9.0.md#codex-service-inspection-2026-10-03).
> **Author: Codex.** SSG now verifies inspected layout service ownership,
> shadowing, hydration, and disposal. Route checks reject ignored page service
> declarations. Inspection selects the actual indirect default export instead
> of a decorated helper. **11/58 tasks remain checked.** Next audit missing
> exports, inherited layout options, and imported service token identity.

> **Previous checkpoint — Codex combined inspection (2026-10-03):** read
> [acceptance coverage and remaining work](./release-0.9.0.md#codex-inspection-acceptance-2026-10-03).
> **Author: Codex.** Combined compiler/static inspection acceptance passes.
> Fixed missing layout middleware counts and exposed layout/page execution order;
> unresolved counts remain unknown. **11/58 tasks remain checked.** Next extend
> the fixture with executed service ownership/DI and check/explain diagnostics
> before closing CLI-04. Continue RT-25 build/recipe gating afterward.

> **Previous checkpoint — Codex inherited options (2026-10-03):** read
> [option resolution and real dispatch corrections](./release-0.9.0.md#codex-inherited-options-2026-10-03).
> Core now merges inherited server-method options with nearest declarations
> winning. Generated registration preserves inherited policies. Actual RPC dispatch
> also retains the receiver for inherited prototype actions. **11/58 tasks remain
> checked.** Continue CLI-04's complete grouped-route/layout/service acceptance
> and full lifecycle verification; the release goal remains active.

> **Previous checkpoint — Codex inherited RPC registration (2026-10-03):** read
> [compiled execution findings and next verification](./release-0.9.0.md#codex-inherited-rpc-2026-10-03).
> Fixed pre-super access to `this`, dropped constructor arguments, and missing
> inherited automatic RPC registration. Server/client compiled execution tests
> pass; full framework suite: 581 passed; all package types passed.
> **11/58 tasks remain checked.** Continue inherited option/real bootstrap parity
> and the complete CLI-04 acceptance fixture.

> **Previous checkpoint — Codex runtime inspection (2026-10-03):** read
> [shared capabilities, binding checks, and verification](./release-0.9.0.md#codex-runtime-inspection-2026-10-03).
> Route commands now use selected-environment bindings and the shared transport
> model. Missing bindings/unsupported transports fail checks. Node/Deno transport
> support remains explicitly process-local. **11/58 tasks remain checked.**
> Continue CLI-04's full framework acceptance fixture and inherited RPC behavior;
> RT-25 still needs build-time and recipe capability gating.

> **Previous checkpoint — Codex declaration dispatch (2026-10-03):** read
> [member precedence and verification scope](./release-0.9.0.md#codex-declaration-dispatch-2026-10-03).
> Route inspection resolves declared field/prototype/accessor precedence with
> owners and sources. Unknown precedence makes route checks fail. JavaScript
> fixtures verify the rules; runtime mutations and framework RPC installation
> remain outside this static result. **11/58 tasks remain checked.** Continue
> binding-aware capabilities and complete framework inspection acceptance.

> **Previous checkpoint — Codex member facts (2026-10-02):** read
> [member inventory and dispatch continuation](./release-0.9.0.md#codex-member-facts-2026-10-02).
> Compiler/route metadata now distinguishes fields, methods, accessors, static
> and private members, and unknown computed names, including imported bases.
> Resource fields reflect their generated getter form. **11/58 tasks remain
> checked.** Continue effective dispatch with runtime fixtures, then capabilities
> and full CLI-04 acceptance. The prior full workspace checkpoint remains below.

> **Previous checkpoint — Codex workspace verification (2026-10-02):** read
> [integration fixes and complete verification results](./release-0.9.0.md#codex-inspection-integration-2026-10-02).
> Workspace build, root types, all 11 package type checks, and all 2,492 unit tests
> across 13 packages passed. Fixed strict-null test assertions and an outdated
> route-explanation expectation found only by the broader checks.
> **11/58 tasks remain checked.** CLI-04 and release gates remain open; continue
> inherited dispatch, binding-aware capabilities, and full acceptance verification.

> **Previous checkpoint — Codex imported inheritance (2026-10-02):** read
> [relative source resolution and remaining limits](./release-0.9.0.md#codex-imported-inheritance-2026-10-02).
> Relative TypeScript bases and explicit re-exports now resolve without executing
> modules. Cycles, ambiguous paths, and unsupported imports remain unresolved.
> **11/58 tasks remain checked.** Continue inherited dispatch semantics,
> binding-aware capabilities, and CLI-04's full acceptance fixture.

> **Previous checkpoint — Codex local inheritance (2026-10-02):** read
> [base declarations and remaining resolution work](./release-0.9.0.md#codex-local-inheritance-2026-10-02).
> Local base methods now appear with declaring classes and source locations.
> Imported/dynamic bases produce explicit unresolved diagnostics in route checks.
> Own methods remain separate; effective inherited dispatch is still unverified.
> **11/58 tasks remain checked.** Continue imported-base resolution, dispatch
> semantics, binding-aware capabilities, and the full CLI-04 acceptance fixture.

> **Previous checkpoint — Codex scaffold inspection (2026-10-02):** read
> [shared recipe facts and remaining work](./release-0.9.0.md#codex-scaffold-inspection-2026-10-02).
> Inspection and composition now share manifest recipe reconstruction. Route JSON
> includes recorded features/dependencies; invalid metadata makes checks fail.
> Scaffold suite: 89 passed; CLI suites: 75 passed; final metadata suite: 4 passed.
> **11/58 tasks remain checked.** Continue inheritance, binding-aware capabilities,
> and CLI-04's complete acceptance fixture.

> **Previous checkpoint — Codex resource inspection (2026-10-02):** read
> [resource mapping and continuation requirements](./release-0.9.0.md#codex-resource-inspection-2026-10-02).
> Supported resource macros now expose compiler method identities and authored
> loader locations. Compiler tests: 147 passed; CLI suites: 72 passed; types passed.
> **11/58 tasks remain checked.** Continue CLI-04 inheritance resolution and
> scaffold/capability integration, followed by its full acceptance fixture.

> **Previous checkpoint — Codex parser availability (2026-10-02):** read
> [the removal of heuristic route facts](./release-0.9.0.md#codex-parser-unavailable-2026-10-02).
> Parser-unavailable page/layout options now remain unknown. Route suites:
> 37 passed; TypeScript passed. **11/58 tasks remain checked.** Continue CLI-04's
> unresolved project inheritance, macro mapping, and scaffold/capability work.

> **Previous checkpoint — Codex static options (2026-10-02):** read
> [the option-extraction corrections](./release-0.9.0.md#codex-static-options-2026-10-02).
> Nested SSG spreads/computed keys and invalid scalar options now remain unknown;
> duplicate enabled keys use the last value. Route tests: 36 passed; types passed.
> **11/58 tasks remain checked.** Continue CLI-04's project-level requirements.

> **Previous checkpoint — Codex namespace decorators (2026-10-02):** read
> [the compiler correction and verification](./release-0.9.0.md#codex-namespace-methods-2026-10-02).
> Namespace server methods/function fields now receive the same stripping and RPC
> classification as named imports. Namespace client methods remain in the browser.
> Compiler tests: 145 passed; route tests: 27 passed; type checks passed.
> **11/58 tasks remain checked.** Continue CLI-04's project model and source maps.

> **Previous checkpoint — Codex route checks (2026-10-02):** read
> [static route checks and remaining acceptance](./release-0.9.0.md#codex-route-checks-2026-10-02).
> `check routes` now fails for unknown metadata or invalid transports, with
> source-bearing diagnostics. Inheritance and runtime remain explicitly unchecked.
> **11/58 tasks remain checked; CLI-04 remains open.** Continue the project model,
> macro source mapping, and scaffold/capability integration.

> **Previous checkpoint — Codex compiler facts (2026-10-02):** read
> [the shared classifier and remaining project-model work](./release-0.9.0.md#codex-compiler-facts-2026-10-02).
> Route inspection now uses compiler own-method facts, including automatic RPC,
> retained helpers/fields, and stripped methods without RPC registration.
> **11/58 tasks remain checked; CLI-04 remains open.** Continue inheritance,
> macro source mapping, scaffold/capability metadata, and route checks.

> **Previous checkpoint — Codex compiler review (2026-10-02):** read
> [the preservation fix and CLI-04 continuation steps](./release-0.9.0.md#codex-compiler-preservation-2026-10-02).
> Deep client helper chains now survive compilation; cycles terminate and explicit
> server boundaries remain stripped. Security-plugin tests: 139 passed; root
> TypeScript check passed. **11/58 tasks remain checked; CLI-04 is still open.**
> Continue the shared compiler/scaffold inspection model described in that note.

> **Previous checkpoint — Codex structured upgrades (2026-10-02):** read
> [Codex's CLI-06 completion and continuation instructions](./release-0.9.0.md#codex-cli-upgrades-2026-10-02).
> **CLI-06 is complete; 11/58 tasks are checked.** Upgrade plans use the requested
> scaffold release and recorded dependency ownership. They preserve local edits,
> apply owned additions/removals, track file/manifest effects, and report partial
> failures. Subprocess fixtures and a real pnpm/local-registry tarball test pass.
> Continue CLI-04's compiler-backed inspection, then CLI-05/RT-25 recipes and
> capabilities. All 47 unchecked tasks remain in scope; versions remain 0.8.3.
> This supersedes CLI-06's partial status in the historical checkpoints below.

> **Previous checkpoint — Codex JSON contracts (2026-10-02):** read
> [Codex's CLI-03 completion and GLM instructions](./release-0.9.0.md#codex-cli-json-2026-10-02).
> **CLI-03 is complete; 10/58 tasks are checked.** All JSON commands run behind
> a CLI-owned process boundary. Finite commands emit one result; dev/start/Studio
> expose documented lifecycle events with bounded startup and shutdown. ORM
> errors hide connection values and identify the failing phase. Subprocess tests
> cover real effects, dry runs, project logs, malformed results, and cancellation.
> Continue CLI-06's dependency ownership/target-version templates, then CLI-04's
> compiler classification and CLI-05/RT-25 recipes/capabilities. Versions remain
> 0.8.3. The 48 unchecked tasks and final release gates remain in scope.
> This supersedes CLI-03's partial status in the historical checkpoints below.

> **Previous checkpoint — Codex CLI metadata (2026-10-02):** read
> [Codex's validation completion and GLM instructions](./release-0.9.0.md#codex-cli-metadata-2026-10-02).
> **CLI-02 is complete; 9/58 tasks are checked.** Parser, help, aliases,
> scoped options, arity, repetition, and target conflicts share command metadata.
> Invalid inputs fail before project imports/effects. Continue CLI-03's complete
> command-family machine contract matrix, then CLI-06, CLI-04, and recipe/runtime
> capabilities. Versions remain 0.8.3; the full release goal remains active.
> This supersedes the CLI-02 status in the historical checkpoints below.

> **Previous checkpoint — Codex continuation (2026-10-02):** read the
> [Codex implementation and continuation instructions](./release-0.9.0.md#codex-continuation-2026-10-02)
> before the next phase. The development WebSocket crash is fixed: Upgrade
> requests now bypass the HTTP asset bridge. Adapter, image, upgrade, and
> Studio have machine-output paths; Studio uses isolated lifecycle events.
> Upgrade plans precede effects and report partial failures; build/SSG JSON
> excludes raw project logs. **8/58 tasks are checked** and versions remain
> 0.8.3. CLI-02/03/06 still have acceptance work; the full release goal is active.
> Exact checks and limitations are in that new section. The prior
> [Group 3 review](./release-0.9.0.md#codex-review-group3-2026-10-02)
> records GLM's reviewed commits and earlier corrections. The distributed SSE
> prototype instructions below are historical and superseded by the completed
> GLM implementation and Codex fixes.

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
started. The original checkpoint paused the release implementation goal; the
user has since resumed the full unfinished release objective. The latest Codex
continuation records current implementation and verification above. No packages were published, no changes
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
