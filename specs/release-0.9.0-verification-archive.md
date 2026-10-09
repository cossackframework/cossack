# Cossack 0.9.0 verification archive

Archived by Codex on 2026-10-04. These are historical implementation and review
checkpoints, including partial work on tasks that remain open.
The [release checklist](./release-0.9.0.md) owns current task status.
The [handoff](./handoff-0.9.0.md) owns continuation instructions.
Historical next steps and counts below describe their recorded checkpoint only.

<a id="codex-rt11-sse-auth-2026-10-05"></a>
### Codex: SSE session freshness and tab rotation (2026-10-05)

Author: Codex. Continued after `fa2b2bd`. This completes the SSE delivery slice
of RT-11, not its WebSocket or broader concurrent-request criteria.

Auth exposes optional typed `AuthRealtimeProvider` capture/validate callbacks.
Normal middleware registers a server-only capture hook only after session/user
validation. A restored descriptor cannot fall back to a cookie, retain an earlier
user or call downstream middleware twice after failure. Validation errors use one
fixed warning. Framework owns a structural protocol without an auth/ORM dependency.
Descriptor copying is bounded, detached and rejects accessors, reserved keys,
sparse arrays, non-JSON values and invalid provider names. Configuration errors
return fixed HTTP 409 `COSSACK_REALTIME_AUTH_REQUIRED`; provider capture/storage
failures return fixed HTTP 503 `COSSACK_REALTIME_AUTH_UNAVAILABLE`.

The generated provider captures an independent public session reference and
SHA-256 fingerprint of its current random bearer token. Neither token nor
fingerprint enters public state, browser frames or coordinator snapshots. Lookup
by reference then uses the shared session manager for strict purpose, timestamp,
expiry and token validation; malformed dates and future-created records reject.
A rotation retains the reference but changes the fingerprint. Each refresh also
resolves current user data before inherited guards and scope run.

Framework creates fresh request/config/ORM scopes before every snapshot, replay
frame, event and heartbeat. It retains decoded page params, bindings and the
subscription locale, strips common credential/assertion headers and prohibits
late response-header writes. Global and inherited page/layout middleware must
finish, including cleanup, before delivery; denial or failure stops it. The
original owner and computed scope must still match. Node's former interval driver
now shares the coordinator's pull-driven stream, so cancellation/backpressure
retire its timers and connection count without queued writes.

Denial emits only the fixed `authorization-error` event with
`COSSACK_REALTIME_AUTH_CHANGED`, then closes. Core retires EventSource before
setting fixed closed feedback, ignores late callbacks and stops automatic retries.
Reload opens a subscription with the current cookie. Unit checks cover denial
before the first replay frame, denial between frames, idle heartbeat checks,
fresh/cleaned middleware scopes, config/locale facilities and browser ownership.

Generated production Node SQLite and Cloudflare D1 fixtures use the real auth
provider/session manager and actual SQL. They verify logout, expiry, purpose
changes, current user metadata for inherited denial/scope changes, and continued
peer delivery in a shared room. Chromium opens two tabs with one cookie, rotates
it from the second tab, observes both old subscriptions close without the new
state, waits through the normal retry interval, then reloads and receives fresh
updates with the replacement. Dropping the actual sessions table also closes an
idle stream before its next heartbeat without disclosing storage text. These
fixture APIs are setup/fault controls, not published application routes. A
separate fixture-reader regression requires complete SSE events when the network
splits event headers/data across chunks. Client JavaScript and emitted source
maps exclude private auth/storage helpers.

| Command | Verified result |
| --- | --- |
| `pnpm --filter @cossackframework/framework exec vitest run` | 1534 tests / 78 files pass, including strict capture diagnostics, replay/heartbeat authorization, middleware scopes and existing RPC/runtime coverage. |
| `pnpm --filter @cossackframework/auth exec vitest run` | 273 tests / 11 files pass, including restored identity, no bearer fallback, redacted failures and one downstream call. |
| `pnpm --filter @cossackframework/scaffold exec vitest run` | 148 tests / 8 files pass. Final shared-validator/date regressions also pass the focused 36-test auth-security file. |
| `pnpm --filter @cossackframework/core exec vitest run tests/realtime-recovery.test.ts tests/sse-snapshot-ordering.test.ts` | 27 tests / 2 files pass. |
| `pnpm --filter cossack exec vitest run tests/auth-sse-reader.test.js tests/generated-runtime-build.test.js -t 'revalidates generated authenticated SSE sessions\|waits for a complete SSE event'` | Two native Node/Cloudflare and Chromium cases plus one reader regression pass; 62 unrelated runtime cases skipped. Generated types/builds and source maps pass. |
| `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'operates actual generated auth forms'` | Two real Node/Cloudflare auth-form regressions pass; 62 unrelated cases skipped. |
| `pnpm --filter cossack exec vitest run tests/package-guidance.test.js` | 12 shared guidance-reader tests pass. Auth's existing guide now describes the SSE provider/migration contract. |
| `pnpm tsc --noEmit` and `pnpm typecheck` | Root and all 11 package checks pass. |

Logs: `/tmp/cossack-rt11-sse-{build,framework-all,auth-all,scaffold-all,core,native,forms-regression,guidance,root-types,package-types}.log`.
The final focused scaffold log is `/tmp/cossack-rt11-sse-scaffold.log`.
Builds that replace dependency dist ran separately from its readers.

Limits: validation and revocation are not an atomic barrier. A checked frame can
already be in flight, and an already-started action can retain its request actor.
Idle checks occur before 15-second heartbeats only with reader demand; network
buffering, slow storage and backpressure prevent a fixed elapsed-time guarantee.
Fresh guard callbacks must be read-only and fast; ignored application I/O has no
new deadline. Custom credential/query headers are application-owned and must not
carry retained secrets. Native permission checks here use fresh user metadata;
this is not a new claim about a deployed RBAC database or every provider.
WebSocket actions/outgoing state still trust the upgrade identity and require
separate native/hybrid hibernation acceptance. Deno production acceptance,
installed auth-SSE artifacts, live deployment and the final non-Desktop release
matrix are not established by these workspace fixtures. Signed flash cookies
remain replayable. Counts stay **28 complete / 30 open**. Desktop remains complete
by user decision; its platform checks are waived, not reported as passing.

<a id="codex-rt11-forms-2026-10-05"></a>
### Codex: Generated auth form privacy and session actions (2026-10-05)

Author: Codex. Continued after `a2d064e`. This completes the actual generated-form
slice of RT-11. All four auth pages use ClientStore drafts and client-only
validation. Forgot-password confirmation/error fields are also browser-owned.
App-owned `src/auth-input.ts` schemas accept one object, reject unknown fields
and enforce field/password limits. The email bound matches the generated
VARCHAR(191) column; the contract rejects values wider than that column. Each
method parses again before storage for native calls, which bypass decorator gates. Passwords are preserved without
normalization/truncation and limited to 1024 UTF-8 bytes. AUTH_PATHS owns the new
file for creation and incremental composition.

Login/register require successful session creation before applying cookie headers
and redirecting. Storage/transport catches use fixed feedback, with only the exact
known duplicate-account ClientVisibleError retained by registration. The reset
request throws a fixed ClientVisibleError after a storage/mail failure, so the
framework does not log the original exception. Failed browser submissions retain
the draft; a failed reset request does not show success. Credentials appear only
in explicit action arguments, not serialized public form state or validation RPCs.
Browser acceptance waits for hydration before interacting with these forms.

The dashboard layout catches failed logout and renders fixed `logoutError` state.
It retains the cookie when revocation fails. The sessions module adds
`rotateCurrent()`, applies its returned headers and redirects to a fresh request
before re-listing. Atomic storage keeps its independent public reference stable.
An expired/revoked incoming token fails the guarded layout action even with a
forged actor in public state.

The new fixture API performs setup, inspection and fault injection only. The
original generated page classes, form markup and RPC dispatcher remain unchanged
inside production Node SQLite/Cloudflare D1 artifacts. Real SQL triggers exercise
user creation, session creation, rotation and deletion failures. Checks cover
malformed/extra/oversized action input before writes, fixed failures/no cookies,
partial registration plus recovery by login, known/unknown reset confirmation,
invalid/expired/concurrent/replayed reset tokens, stable rotation references and
next-request identity, logout clearing/redirect and invalid old tokens. Chromium
uses actual login/register/forgot/reset forms and account-menu/session actions.
Requests prove drafts/tokens stay outside shared state and client validation
makes no server validation calls. Client JavaScript and emitted source-map scans exclude the server
schema/hasher/private fixture markers.

The `safe-old-input/public-form-fields` source now joins application guidance
acceptance verbatim. The harness types/builds it, posts native multipart data,
decodes the flash cookie, reads the following SSR state, and drives the browser
form to selected restoration/credential exclusion and clearing on reload.
The installed-guide runner calls this same harness, including emitted source-map
checks. This is an explicit acceptance test; CLI/MCP discovery never executes
examples. The auth guide and migration notes remove the public password example
and record object signatures, rotation, URL-token secrecy and partial outcomes.

| Command | Verified result |
| --- | --- |
| `pnpm --filter @cossackframework/scaffold exec vitest run` | 146 tests / 8 files pass, including generated native parsing, fixed errors and browser-handler failure state. |
| `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'operates actual generated auth forms'` | 2 production Node/Cloudflare and Chromium cases pass; 60 unrelated cases skipped. Both generated apps type-check/build with client source maps enabled. |
| `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'executes packaged application guidance\|serves generated authentication\|protects.*route'` | 4 guidance/auth/OAuth/dashboard cases pass; 58 unrelated cases skipped. The last pattern did not select the separately named protected-route test. |
| `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'runs the protected-route recipe'` | 1 actual protected-route session/browser case passes; 61 unrelated cases skipped. Registration call uses the new object signature. |
| `COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` | Fresh tarballs pass 10 standalone and 4 bundled auth examples, offline CLI/MCP/reporter parity, native Cloudflare HTTP/SSE/WebSocket traces, four actual application guides, emitted source maps and UI prop contracts. |
| `pnpm tsc --noEmit` | Root types pass. |
| `pnpm typecheck` | All 11 package checks pass. |

Logs: `/tmp/cossack-rt11-forms-{scaffold,native,regression,protected,root-types,package-types}.log`.
Installed log: `/tmp/cossack-rt11-forms-installed.log`. Retained tarballs/app:
`/tmp/cossack-local-pack-D6vyM3`. Its installed baseline is Wrangler 4.147.0,
Cloudflare Vite plugin 1.62.5, Vite 8.3.2 and TypeScript 7.0.2. Dist-replacing
installed-gate builds ran only after dependent tests completed.

Limits: Registration can create an account before session insertion fails; login
can recover. Reset consumes its token before hashing, updating the password and
revoking sessions; later failures can require a new link and leave partial writes.
Lost responses also do not imply rollback. Cookies are shared across tabs;
an already-started request can retain its resolved identity. Existing realtime
connections do not gain freshness merely through rotation/revocation. Signed
flash cookies remain readable and replayable until expiry. Broader concurrent
request/tab and realtime criteria remain for RT-11; CLI-08 retains broader
library/UI/runtime guidance coverage. Actual auth-form production acceptance uses workspace packages on Node/Cloudflare;
this installed guide gate covers Cloudflare guidance, not installed Node auth
forms or deployed readiness. No Deno Deploy or final
release-matrix claim is made. Counts remain **28 complete / 30 open**. Desktop
stays complete by user decision; no native Desktop gate was run here.

<a id="codex-rt11-input-2026-10-05"></a>
### Codex: Explicit public old-input selection (2026-10-05)

Author: Codex. Continued after `0b317d2`. RT-11's old-input requirement now has
explicit public-field selection before cookie serialization. `getFormData`
defaults to nonempty validation errors only, including `flash: true`. An
application opts into old input with `flash: { input: ['name', 'profile.city'] }`
or `flashInput(data, { fields })`. An older JavaScript call without the latter
policy retains no submitted values. `FlashOptions` and `FlashInputOptions` are
public core contracts. No-rules form options now return the parsed DTO rather
than claiming a validation-result shape; potentially optional rules return a
union. The migration guide records these alpha-stage API breaks.

Selection reads own data properties, copies finite JSON scalar values/arrays,
rebuilds nested containers and preserves selected array positions. Whole object
branches, files, accessors, unsupported values and inherited properties are
omitted. Source mutation after flashing cannot add a credential to the copy.
Known credential names and prototype paths are rejected even when selected.
Old reads reject those paths from older signed payloads too. Generic `flash()`
rejects the reserved old-input namespace before a partial object write, so it
cannot bypass the policy. Custom secrets are not classified automatically:
applications must keep them outside the server-authored public-field list.
Selection does not remove credentials from parsed/validated server data.

The authored `safe-old-input/public-form-fields` example runs verbatim in
generated production Node and Cloudflare apps. Real multipart POST rejects
invalid email, retains selected Unicode fields and fixed errors, redirects and
restores those fields through the following SSR/hydration response. Tests decode
the actual cookie payload and scan it and response text for root/nested/custom
credentials. Direct RPC repeats projection with scalar arrays/array leaves and
explicitly selected known credentials, verifies redirect metadata, and then
fails a write while preserving unrelated incoming flash. The next page clears
the cookie; a request without it has empty fields. Plain no-policy form parsing
issues only an explicitly written message. Client JavaScript excludes the
fixture's private server-error marker.

The first Workers attempt passed Node FormData directly through Miniflare's
separate Request realm, losing the multipart content type. Captured Workers logs
identified that setup error. The final fixture sends the headers and bytes
encoded by a real native Request; it leaves production form parsing unchanged.
Native fixture failures now retain Node output or structured Workers logs.
The existing larger D1/workerd/Chromium test passes with updated explicit title
selection in component/service redirects from HTTP/SSE pages, cookie preservation
and late-write rejection. Deployment commands in that test remain dry runs.

| Command | Verified result |
| --- | --- |
| `pnpm --filter @cossackframework/core exec vitest run` | 1,536 tests / 93 files pass, including selection/default/namespace/DTO regressions. |
| `pnpm --filter @cossackframework/framework exec vitest run tests/flash-middleware.test.ts tests/router-rpc-stream.test.ts tests/cookie-request-context.test.ts tests/response-lifetime.test.ts` | 76 tests / 4 files pass; background transports, errors and header timing preserved. |
| `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'excludes private old input\|preserves native RPC cookies'` | 3 native/browser cases pass; 57 unrelated cases skipped. Both new production apps type-check/build. Node browser native-cookie/flash redirects remain green. |
| `pnpm --filter cossack exec vitest run tests/package-guidance.test.js` | 12 tests pass, including fresh authored-guide discovery without executing modules/source. |
| `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js` | 1 broader native Workers/D1/browser/dry-run deployment case passes, about 147 seconds. |
| `pnpm tsc --noEmit` | Root types pass. |
| `pnpm typecheck` | All 11 package checks pass. |

Logs: `/tmp/cossack-rt11-input-{core,framework,native,guidance,worker,root-types,package-types}.log`.
Core was rebuilt before dependent tests; framework declarations were rebuilt
after the API change. No dist-replacing build overlapped these checks.

Limits: The new form guide has workspace-linked production acceptance, not a new
installed-tarball execution claim. No live deployment occurred. The signed flash
cookie is readable, not encrypted, and clearing it is not durable one-use replay
protection. Already-issued cookies can still contain old private bytes; changing
read helpers does not erase those bytes. Arbitrary flash/validation messages and
custom secret classification remain application-owned. Native Node/Workers
acceptance does not close Deno Deploy or the final release matrix. Generated auth
form state and actual login/logout/failure/rotation recipes, concurrent semantics
and realtime identity criteria remain open. Counts stay **28 complete / 30 open**.
Desktop remains complete by user decision, with its platform checks waived.

<a id="codex-rt11-dashboard-2026-10-05"></a>
### Codex: Safe session dashboard and scoped revocation (2026-10-05)

Author: Codex. This completes the reviewed dashboard slice of RT-11, not the
whole task. New auth rows have independent `public_id` UUIDs. The additive
`0008_add_session_public_id` migration leaves existing bearer tokens unchanged;
conditional assignment and re-read give legacy rows a stable reference across
concurrent listings. Rotation preserves that reference. `SessionInfo.reference`
and a whitelist of dates/current/origin fields replace bearer IDs and raw metadata
in public state.
The model declares the public column's unique flag as well as its named index,
matching database introspection. Both native fixtures run the actual local CLI
schema check after migration; the full installed gate also checks schema drift.

Management helpers receive the trusted Hono context instead of user/token IDs.
Single conditional deletion matches public reference, owner, auth purpose and
expiry; it excludes both the current token and stable reference. Keeping the
current session during bulk deletion also excludes its stable reference, so
rotation cannot make it eligible as an "other" session. Bulk management preserves
reset and OAuth-state rows. Password reset retains its separate account-wide
token invalidation. The dashboard layout now requires an authenticated user
before SSR or RPC; the global URL-prefix guard alone did not cover `/crpc`.
Page catches use fixed messages, and success clears earlier errors.

The real generated sessions page runs unchanged in production Node SQLite and
Cloudflare D1 fixtures. Acceptance verifies guest/forged-actor denial; no bearer
token or session data in SSR/RPC; references cannot authenticate; foreign,
current, reset, state, raw-token and malformed revoke targets do not mutate rows;
one concurrent revoke winner; rotation preserves references; concurrent current
rotation cannot make single/bulk revocation delete the caller's new token;
bulk logout clears the cookie and keeps other users/purposes. Fixture-only SQLite
triggers produce real private storage errors; responses retain fixed messages,
failed writes leave sessions valid and failed bulk logout issues no clear cookie.
Unit checks also execute generated page methods for init/write/list failures.
Fault acceptance now checks both stored validity and the middleware's request
identity after each failed write, and native Node failures retain server output.
An earlier fault sequence returned an unexpected 401 without that diagnostic;
the isolated Node and full SQLite/D1 reruns pass with these stronger assertions.
No cause was established for that earlier result. Retain this regression and
inspect its diagnostics if it recurs; do not treat reruns as a reliability proof.

Native generation exposed a separate sessions-only recipe error: its seeder
imported role models that were not selected. Such dashboards now use an empty
application seeder; selected user/role modules retain their admin seeder. Node,
Cloudflare and Deno composition checks retain the migration in the public barrel.

The full installed scaffold gate also needed a setup correction: its first
dashboard/example build ran before migrations. Auth/session middleware executes
during static rendering, so the missing sessions table correctly failed that
build. The gate now applies the generated migrations before its first full-stack
build, matching the starter instructions. This does not add automatic production
migration behavior.
Adapter-switch fixtures now explicitly replace their own local tarball pins and
reapply those pins after each switch. The CLI correctly treated these pins as
edited dependencies; its normal conflict checks remain unchanged. Both runtime
directions must consume the locally packed release under test.

The installed SSG flow exposed two further composition defects. Standalone
`renderSsgPage` now installs the bare translation/config helpers before lifecycle
hooks. A fresh-module regression executes translated init/render and scoped
config/env access. Auth starters no longer register an unused, separate anonymous
framework session middleware: auth already owns its persistent cookie. The
exported bag middleware remains opt-in for routes that need visitor state.
This avoids unnecessary rows/cookies and lets public SSG retain its existing
rejection of visitor-specific responses. The migration guide records this break.

| Command | Verified result |
| --- | --- |
| `pnpm --filter @cossackframework/scaffold exec vitest run` | 131 tests, 8 files pass. |
| `pnpm --filter @cossackframework/auth exec vitest run` | 261 tests, 11 files pass; RT-13 primitives/replay regressions preserved. |
| `pnpm --filter @cossackframework/framework exec vitest run tests/ssg-globals.test.ts tests/ssg-renderer.test.ts tests/ssg-services.test.ts tests/ssg-public.test.ts tests/vite-ssg-plugin.test.ts tests/ssg-config.test.ts` | 76 tests, 6 files pass, including standalone helpers and public-response rejection. |
| `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'serves generated authentication primitives\|runs the protected-route recipe'` | 3 native/browser cases pass; 55 unrelated cases skipped. Both generated apps type-check, migrate, check schema and build; real SQLite/D1 dashboard/credential/OAuth flows and the Node protected-route browser regression pass. |
| `COSSACK_KEEP_SMOKE=1 pnpm test:scaffold:local` | Exit 0. Twelve local tarballs, ten standalone/four auth examples, CLI/MCP/reporter/Cloudflare browser traces, three packaged application pages, minimal Cloudflare/Deno builds, public SSG and Node → Cloudflare → Node composition pass. The full app migrates, seeds, checks schema, exercises ORM/cache/session storage and Studio, and serves production Node assets. No native Desktop gate runs. |
| `pnpm tsc --noEmit` | Root types pass. |
| `pnpm typecheck` | All 11 package type checks pass. |

Logs: `/tmp/cossack-rt11-dashboard-{scaffold,auth,ssg,native,root-types,package-types}.log`.
The final full installed gate log is `/tmp/cossack-rt11-dashboard-installed.log`;
its retained fixture is `/tmp/cossack-local-pack-XIV9bx`. Earlier gate failures
identified the setup, standalone SSG, adapter pin and model-uniqueness issues
described above; the final run passed after those corrections.
The [migration guide](./migration-0.9.0.md#session-dashboard-references) describes
the application API break and required template/migration merge.

Limits: Local native fixtures do not prove deployment or open-connection identity
refresh. The installed Deno check covers builds, not Deno Deploy acceptance.
A committed delete is not rolled back when a later listing fails.
Canonical auth-purpose JSON is required by generated conditional writes; adapted
stores must preserve equivalent matching. RT-11 still needs sensitive old-input
filtering, complete failure/login/logout/rotation recipes and its remaining
concurrent/realtime criteria. No non-Desktop task is closed by this checkpoint.
Counts remain **28 complete / 30 open**; Desktop remains completed by user decision.

<a id="codex-rt13-complete-2026-10-05"></a>
### Codex: Atomic OAuth state and RT-13 acceptance audit (2026-10-05)

Author: Codex. Cookie-based OAuth now requires typed `OAuthStateStore` callbacks.
`create` inserts a frozen provider-scoped SHA-256 key and absolute timestamps.
Rows contain no authorization code, PKCE verifier or provider credential.
`consume` must atomically remove a matching unexpired provider record; only
boolean true grants token exchange. The generated adapter uses anonymous
`sessions` rows with canonical `oauth_state` metadata and one conditional SQL
delete. Auth/reset records cannot satisfy this purpose. The existing schema
requires no new columns. Expired abandoned state requires application cleanup.

State is consumed after signed-cookie and nonce validation, before provider I/O.
It stays consumed after failed exchange, profile processing or account mapping.
The handler also rechecks the signed absolute deadline after awaited storage.
Concurrent requests cannot repeat exchange or account/session creation. An old
cookie without a registered server state is rejected. Explicit stateless mode
retains application-owned CSRF/replay behavior and does not accept a state store.
The migration guide records the required callbacks and new-flow retry policy.

State-storage failures have fixed `state-create`/`state-consume` diagnostics.
Used, expired or missing records get `COSSACK_OAUTH_STATE_UNAVAILABLE` and 400.
Cookie names, paths, same-site policy and prefix constraints are checked before
storage effects. Cookie clearing preserves Secure/HttpOnly/same-site flags.
Raw and immutable custom Responses now retain state clearing, application cookies
and streaming bodies. Before this fix, a raw Response could discard the clear
that Hono had prepared. Signed-cookie parsing rejects oversized values,
noncanonical signatures and invalid absolute timestamps before expensive work.
JavaScript comparison documentation no longer claims a formal constant-time guarantee.

Native generated Node SQLite and Cloudflare D1 fixtures use a loopback provider.
That provider deliberately accepts repeated authorization codes, so its policy
cannot mask app replay failures. Two concurrent callbacks yield one success and
one state rejection; a later replay is rejected before provider I/O. There is
one exchange, one profile request, one linked account and one auth session.
The fixture independently checks the PKCE challenge and verifier. Failed exchange
and mapping remain consumed and expose safe stages. Wrong provider, expired
database state and reset-purpose rows cannot exchange. These are local fixture
checks, not live provider or remote deployment evidence.

Original RT-13 acceptance audit:

| Criterion | Authoritative evidence |
| --- | --- |
| Generated apps consume shared credential/session primitives | [Generated auth](../packages/scaffold/template/src/auth.ts), OAuth composition in [scaffold](../packages/scaffold/src/index.js), and real generated Node/Cloudflare login/session tests. |
| Expiry and rotation | [Primitive tests](../packages/auth/tests/auth-primitives.test.ts) and [native fixture](../packages/cossack/tests/fixtures/auth-primitives-acceptance.js): exact expiry, delayed completion, one rotation winner, old-token invalidation, revocation and reset-purpose separation. |
| Callback replay | [Replay tests](../packages/auth/tests/oauth-replay.test.ts) and [native fixture](../packages/cossack/tests/fixtures/oauth-replay-acceptance.js): one winner before provider I/O, later replay rejection and one account/session. |
| Failed exchange and account mapping | [Diagnostic tests](../packages/auth/tests/oauth-diagnostics.test.ts), replay tests and native loopback cases check stages, raw-error redaction and irreversible state consumption. |
| Useful diagnostics without sensitive values | Fixed OAuth/Auth error contracts; crypto/storage/provider/model failure tests omit causes, bodies, codes, tokens and credentials. Prefixed and custom-response cookies clear correctly. |
| Library independent of framework/database | Auth source imports Web APIs, Hono and local modules only; no framework/database imports or dependencies. User models, SQL and persistence stay in the generated application. |

Verification:

- `pnpm --filter @cossackframework/auth exec vitest run`: **261 tests / 11 files pass**.
  Log: `/tmp/cossack-rt13-replay-auth.log`.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: **116 tests / 8 files pass**.
  Log: `/tmp/cossack-rt13-replay-scaffold.log`.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'serves generated authentication primitives|runs the protected-route recipe'`:
  **3 pass, 55 unrelated cases skipped**. Includes generated app type checks,
  local migrations, production builds, loopback OAuth and protected-route browser
  behavior. Log: `/tmp/cossack-rt13-replay-native.log`.
- Root `pnpm tsc --noEmit` and `pnpm typecheck` pass for all **11 packages**.
  Logs: `/tmp/cossack-rt13-replay-root-types.log`, `/tmp/cossack-rt13-replay-package-types.log`.
- `pnpm test:agent-docs:local`: passes sequential builds, **12 tarballs**,
  **10 standalone and 4 bundled auth examples**, reporter types, offline CLI/MCP
  parity, Cloudflare HTTP/SSE/WebSocket browser traces, production exclusion,
  three packaged application pages with source maps and UI catalogs. Installed
  tools: Wrangler **4.147.0**, Cloudflare Vite plugin **1.62.5**, Vite **8.3.2**
  and TypeScript **7.0.2**. The final gate includes upfront cookie validation.
  Log: `/tmp/cossack-rt13-replay-installed.log`.

Limits to retain: Storage callbacks own atomicity and durable consistency. The
offline memory guide does not establish cross-Worker atomicity. Local fixtures do
not prove provider registration, production hashing budgets or remote readiness.
State consumption does not roll back later account/session writes. Persistent
HTTP validation does not refresh existing sockets; that remains RT-11 transport
policy. CLI-08 and REL-02/REL-03 retain their broader acceptance gates. Desktop
stays closed by user decision. No deployment, provisioning, publication or push occurred.

**RT-13 is complete against its original criteria. The release has 28 complete
tasks and 30 open tasks out of 58.** The full goal remains active.

<a id="codex-rt13-primitives-2026-10-05"></a>
### Codex: Shared credentials and persistent sessions (2026-10-05)

Author: Codex. RT-13 now moves password hashing, credential verification and
persistent session operations out of generated application implementations and
into the auth library. Typed contracts retain application account lookup, safe
user mapping, database selection and storage. Auth has no framework/database
dependency and uses Web Crypto and Hono.

`createPasswordHasher`, `hashPassword` and `verifyPassword` use a random salt and
an explicit `pbkdf2-sha256$iterations$salt$digest` encoding. Parsing is strict and
rejects malformed records and excessive work factors before derivation. Passwords
are nonempty, bounded in UTF-8 bytes and never normalized or truncated. The old
encoding requires an explicit app migration or reset. Default 100,000 iterations
preserves the existing Workers setting; it is below OWASP's current 600,000
guidance. The [primitive guide](../docs/auth-primitives.md#password-hashes) links
the workerd limit and records the production budget limitation.

`createCredentialVerifier` infers the account and safe-user types. Only boolean
true verifies credentials. Conditional hash upgrades compare the expected hash
before replacing it and reject stale writes before mapping the user. Higher
accepted work factors are not downgraded. `AuthError` gives fixed operation codes,
stages and messages without raw crypto, account or storage exceptions.

`createSessionManager` creates frozen auth-purpose records, opaque 32-byte tokens,
numeric timestamps and matching cookie headers. Validation rejects exact expiry
and does not refresh it. Rotation requires one atomic storage replacement of the
complete active record. Generated SQL matches token, user, original creation and
expiry, current expiry and canonical auth metadata; one affected row wins.
Revocation preserves password-reset rows. Default cookies are Secure, HttpOnly,
SameSite=Lax and Path=/. Cookie headers are returned after storage succeeds.
Already-expired completions issue no cookie; later failures do not undo writes.

Generated native fixtures run real Node SQLite and Cloudflare D1 credentials,
session creation, concurrent rotation, expiry and logout. Reset rows cannot
validate or rotate, and logout preserves them. The existing protected-route
browser test still checks registration, nested guards, forged state, revoked
identity after expiry and denied native RPC. Its status locator now targets the
auth message rather than the separate toast live region. Production client code
excludes the new password encoding. An eager root hasher initializer initially
retained hashing code in the client; lazy helper functions remove that effect.

Auth's fourth packaged guide contains an exact typed credential/session example.
The catalog retains neutral runtime/execution claims; the separate harness owns
compilation and execution. Library source discovery indexes the new public APIs.
The README, architecture and migration notes describe the same contracts.

Verification:

- `pnpm --filter @cossackframework/auth exec vitest run`: **230 tests / 10 files pass**.
  Log: `/tmp/cossack-rt13-primitives-auth.log`.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: **116 tests / 8 files pass**.
  Log: `/tmp/cossack-rt13-primitives-scaffold.log`.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'serves generated authentication primitives|runs the protected-route recipe'`:
  **3 pass, 55 unrelated cases skipped**. Includes generated app type checks,
  local migration, production builds and native/browser behavior.
  Log: `/tmp/cossack-rt13-primitives-native.log`.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: pass for all **11 packages**.
  Logs: `/tmp/cossack-rt13-primitives-root-types.log`, `/tmp/cossack-rt13-primitives-package-types.log`.
- `pnpm test:agent-docs:local`: passes sequential builds, **12 tarballs**,
  **10 standalone and 4 bundled auth examples**, installed reporter types,
  offline CLI/MCP parity, Cloudflare HTTP/SSE/WebSocket browser traces,
  production exclusion, three packaged application pages with source maps and
  UI catalogs. Installed tools: Wrangler **4.147.0**, Cloudflare Vite plugin
  **1.62.5**, Vite **8.3.2** and TypeScript **7.0.2**. Auth examples pass strict
  Bundler checks and execute with the full Node network guard.
  Log: `/tmp/cossack-rt13-primitives-installed.log`.

Limits: The guide's memory store does not establish durable atomicity. Native
tests use local SQLite/D1 fixtures and do not establish deployed resource budgets.
Persistent HTTP validation does not refresh an already-open connection. Storage
side effects are not rolled back. Atomic OAuth callback replay prevention remains
RT-13 work. CLI-08 retains broader coverage; REL-02/REL-03 retain final gates.
No task is newly closed: **27 complete / 31 open**. Desktop remains completed by
user decision. No remote deployment, provisioning, publication or push occurred.

<a id="codex-rt13-diagnostics-2026-10-05"></a>
### Codex: OAuth diagnostics and local D1 JSON tooling (2026-10-05)

Author: Codex. RT-13 now has a public `OAuthError` contract with fixed codes,
stages, HTTP statuses and messages. Diagnostics omit raw exception causes,
provider bodies/status text, callback descriptions and credential values.
Provider HTTP failures retain only a validated numeric status and cancel the
response body. Token/profile shape and network/normalization failures are
classified before application `onError`. Account/session mapping and failing
error handlers have separate stages. Configured callback handlers clear their
state cookie on early rejection as well as after reading it.

Session middleware warnings now use fixed stage messages. Extraction failures
also continue as a guest. Generated auth no longer logs raw database exceptions
and uses the library's configuration diagnostics. User models, account writes
and database selection remain application-owned. Auth has no framework/database
dependency. The migration guide records changed statuses and the typed callback.

The generated Cloudflare fixture exposed two existing issues. ORM request
factories now declare Hono `Context`, preserving `.env` when the database
library's structural context type cannot infer it. The isolated JSON ORM process
no longer starts with `--input-type=module`. Miniflare inherits that flag in a
CommonJS eval Worker. The Worker fails before notifying its waiting parent,
so local migration commands stall. A minimal D1 configuration also reproduced
the stall; disabling metadata fetch did not fix it. Default CommonJS eval mode
preserves dynamic imports, IPC and output isolation. The new Worker regression
and actual generated local CLI migration now pass.

Cloudflare's test harness deliberately starts fresh in-memory bindings. Its
fixture applies the complete, parameter-free generated CLI migration plan to
that fresh D1 database. It also checks the CLI's separate persistent migration.
Fixture secrets use the harness's secret overrides, preserving required secret
declarations. Node uses its generated migrated SQLite database. Both production
builds verify PKCE redirects, callback parameter rejection, denied consent,
state mismatch, cookie cleanup and missing configuration without provider I/O.

Auth now ships a third guide and example for typed callback diagnostics. The
example checks denied/malformed callbacks locally. Discovery still reports
runtime support as unverified and example execution as not performed. A separate
tarball harness compiles, bundles and executes the exact example source offline.

Verification:

- `pnpm --filter @cossackframework/auth exec vitest run`: **168 tests / 9 files pass**.
  Log: `/tmp/cossack-rt13-auth-suite.log`.
- `pnpm --filter @cossackframework/scaffold exec vitest run tests/auth-security.test.js tests/scaffold.test.js`:
  **85 tests / 2 files pass**. Log: `/tmp/cossack-rt13-auth-scaffold.log`.
- `pnpm --filter @cossackframework/database exec vitest run test/tooling.test.ts test/cloudflare-tooling.test.ts`:
  **32 tests / 2 files pass**, including real local D1 and JSON output isolation.
  Log: `/tmp/cossack-rt13-database-regression.log`.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'serves generated OAuth diagnostics'`:
  **2 pass, 56 unrelated cases skipped**. Log: `/tmp/cossack-rt13-oauth-native.log`.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: pass for all **11 packages**.
  Logs: `/tmp/cossack-rt13-root-types.log`, `/tmp/cossack-rt13-package-types.log`.
- `pnpm test:agent-docs:local`: passes sequential package builds, **12 tarballs**,
  **10 standalone and 3 bundled auth examples**, the three packaged application
  pages, reporter types, offline CLI/MCP parity, Cloudflare HTTP/SSE/WebSocket
  traces, production stripping and UI catalogs. Installed tools: Wrangler
  **4.147.0**, Cloudflare Vite plugin **1.62.5**, Vite **8.3.2** and TypeScript
  **7.0.2**. The auth examples retain strict Bundler checks and the full network guard.
  Log: `/tmp/cossack-rt13-installed-guidance.log`.

Limits: Cookie cleanup is not an atomic replay store. Errors do not undo account
writes or sessions already created. Persistent session expiry/rotation, callback
replay prevention and reusable credential/session operations remain RT-13 work.
Native checks use workspace links; bundled installed examples do not prove plain
Node imports, persistent authentication or provider exchange on Cloudflare.
No live provider request, deployment, provisioning or publication occurred.
RT-13, CLI-08, REL-02 and REL-03 remain open. Counts stay **27 complete, 31 open**.
Desktop remains completed by user decision; its waived platform checks stay waived.

<a id="codex-cli08-auth-guidance-2026-10-04"></a>
### Codex: Auth guidance and published TypeScript discovery (2026-10-04)

Auth now publishes `agent-docs.json` with session/role and record-policy guides.
The examples check trusted session resolution before role guards, anonymous and
forbidden responses, OR/AND roles, immutable permission presentation and typed
record lookup. They use fixed local Hono fixtures. Session persistence, expiry,
revocation, login/cookie issuance and native RPC enforcement remain separate work.
The auth library retains its TypeScript `main` and gains no framework dependency.

The shared reader reports a separate `implicitEntry` for manifests without an
exports map. It keeps the explicit `exports` array empty. Blocked exports never
fall back to main. Missing entry files omit their dependent guides. File presence
does not implement full Node legacy resolution or prove import compatibility.
Static indexing now reads published TypeScript and follows its source graph without
executing entrypoints or configuration plugins. Source kind and coverage identify
this analysis explicitly. Public aliases, signatures and comments remain visible;
private members stay excluded. Source edits change the declaration hash.
Runtime support remains `not-verified`; example execution remains `not-performed`
in discovery output.

The separate acceptance harness checks the exact two auth example sources with
strict Bundler resolution. It then uses the installed esbuild dependency to create
neutral ESM bundles and executes those bundles under the unchanged Node network
guard. Bundling also runs under the guard. An initial tsx-loader implementation
triggered its local IPC connection and failed the final zero-attempt assertion.
The bundled implementation removes that attempt without making exceptions in the
guard. This proves bundled Node execution, not plain Node source imports or native
Cloudflare authentication.

- `pnpm --filter cossack exec vitest run tests/declaration-index.test.js tests/documentation.test.js tests/package-guidance.test.js tests/mcp.test.js`:
  **58 tests pass**. Log: `/tmp/cossack-cli08-auth-readers.log`.
- `pnpm --filter cossack exec vitest run tests/documentation.test.js`:
  **8 tests pass**, including the added legacy/source-kind CLI text regression.
  Log: `/tmp/cossack-cli08-auth-cli-text.log`. An earlier retry overlapped a package
  rebuild and returned incomplete subprocess output. The isolated retry passes.
- `pnpm tsc --noEmit` and `pnpm typecheck`: pass for the root and all eleven packages.
  Logs: `/tmp/cossack-cli08-auth-root-types.log` and `/tmp/cossack-cli08-auth-package-types.log`.
- `pnpm test:agent-docs:local`: passes twelve installed tarballs, ten standalone
  examples, two strictly checked/bundled auth examples, three application pages,
  offline CLI/MCP parity, reporter types, Cloudflare HTTP/SSE/WebSocket traces,
  client JavaScript/source-map stripping and UI catalogs. The final attempt log
  is absent. Log: `/tmp/cossack-cli08-auth-installed-cloudflare.log`.
  Installed versions include Hono 4.13.12, esbuild through tsx 4.23.15, TypeScript
  7.0.2, Vite 8.3.2, Cloudflare plugin 1.62.5 and Wrangler 4.147.0.
  This turn did not repeat the separate Node/Deno application or Desktop gates.

CLI-08, RT-13, REL-02 and REL-03 retain their remaining acceptance criteria.
Desktop stays complete by user decision. Release status stays **27 complete / 31 open**.
No deployment, provisioning, publishing or push occurred. Versions remain 0.8.3.

<a id="codex-desktop-native-2026-10-04"></a>
### Codex: Native Desktop requests and Linux packaging (2026-10-04)

Native Electron acceptance exposed two release defects. Chromium omitted `Origin`
on private-protocol actions, causing legitimate RPC to return 403. Window scope
also depended on a renderer-controlled query/referrer. The runtime now verifies
Electron's native initiator and managed webContents identity in a dedicated
persistent session, passes private proof to the protocol handler, then removes
that proof before application dispatch. External requests cannot retain proof.
Foreign and opaque frames cannot execute native mutations. This requires Electron
43.7+ in the 43.x series, or 44.4+; see the [migration notes](./migration-0.9.0.md#desktop-native-request-ownership).

The actual generated ASAR also contained the `.env.production` test sentinel.
Generated and example Forge configs now include only the manifest, Desktop and
client bundles, and native assets. The installed-tarball helper preserves existing
pnpm overrides while adding local package resolutions.

Verification:

- `pnpm test:desktop` **passes** (`/tmp/cossack-desktop-gate.log`): sequential
  dependency builds, 12 tarballs, fresh generated TypeScript, native Electron RPC,
  streamed/binary responses, two-window ownership, foreign/opaque-frame rejection,
  renderer isolation and persistence across restart. ASAR excludes private
  sentinels/source/dependencies and server-only renderer code. A relocated package
  passes the same native checks; Forge constructs a DEB containing the app, icon
  and launcher. Installed Electron 43.7.7 / Vite 8.3.2 pass, followed by the
  workspace Electron 43.7.6 / Vite 8.1.4 case (**1 pass / 51 unrelated skipped**).
- Desktop unit suite: **28 tests / 5 files pass**
  (`/tmp/cossack-desktop-unit.log`), including forged/missing proof, old Electron
  versions, closed windows and private-header stripping.
- Scaffold suite: **78 tests pass** (`/tmp/cossack-desktop-scaffold.log`).
- Root `pnpm tsc --noEmit` and all **11 package type checks pass**
  (`/tmp/cossack-desktop-root-types.log`, `/tmp/cossack-desktop-package-types.log`).

The native gate uses Xvfb and the existing uninstalled Linux sandbox fallback;
secure renderer preferences are asserted, but installed OS sandbox behavior is
not claimed. Installed menus/tray/notifications/icons, Windows/macOS packaging,
conditional signing, Desktop development traces and the final release matrix
remain open. `desktop:dev` still uses production build watchers. **26 complete,
32 open**; versions remain 0.8.3. No deployment, publication or push occurred.

<a id="codex-deno-traces-2026-10-04"></a>
### Codex: Deno CLI development traces and HTTPS (2026-10-04)

Deno development now supports Vite custom events through an authenticated private
WebSocket. Native-response outcome/cleanup records reach the existing framework
bridge and browser capture, with the existing bounded acknowledgement. The event
channel rejects invalid credentials, paths, malformed/oversized messages and
releases runner listeners on disconnect. Ping frames are accepted; update/reload
frames are filtered because source edits replace the Deno process.

HTTPS acceptance found valid actions being rejected with 403. The adapter now
reads TLS state through the socket accessor and falls back to HTTP/2 `:authority`
when Host is absent. A generated API checks the forwarded public URL and query;
browser HTTP/SSE/WebSocket actions retain origin validation over HTTPS/WSS.

The shared trace fixture can launch the public CLI. Deno cases cover normal
and JSON output, SIGTERM/SIGINT shutdown, native bodies, streams, socket terminals,
redaction, browser/disk/CLI/MCP equality and production exclusion. HTTPS tests
create temporary one-day certificates with OpenSSL and scope certificate bypass
to their browser context. Recovery tests now restore modified entry/page/env files,
so the deliberately stuck cleanup hook cannot contaminate subsequent acceptance.

Verification:

- Deno adapter: **27 tests / 4 files pass**, including six private-event channel
  regressions (`/tmp/cossack-deno-trace-unit.log`).
- Generated public CLI trace matrix: **6 pass / 45 unrelated cases skipped**
  (`/tmp/cossack-deno-traces-cli.log`), covering three transports over HTTP/HTTPS.
- `COSSACK_DENO_BINARY=<Deno 2.9.6 executable> pnpm test:deno`: **passes**.
  Sequential package builds, 12 installed tarballs, generated TypeScript,
  production/browser and normal/JSON startup, development reload/recovery/crash,
  installed HTTPS/WSS traces, offline CLI/MCP parity, packaged documentation
  examples/catalogs and production exclusion all pass with installed Vite 8.3.2.
  Then **2 typed native smoke tests** and **9 workspace cases / 42 unrelated cases
  skipped** pass with Vite 8.1.4. Log: `/tmp/cossack-deno-trace-gate.log`.
- Root `pnpm tsc --noEmit` and all **11 package type checks** pass
  (`/tmp/cossack-deno-trace-root-types.log`, `/tmp/cossack-deno-trace-package-types.log`).
- Shared Node/Cloudflare trace-fixture regressions: **6 pass / 45 unrelated cases
  skipped** (`/tmp/cossack-deno-trace-other-runtimes.log`).

The transport uses Vite's [runtime event API](https://vite.dev/guide/api-environment-runtimes).
Native evidence describes server cleanup, not client consumption. Private transport
is trusted local development, not a sandbox. Desktop traces, Electron launch/packaging,
Deno Deploy, graceful generated-server draining and the final release matrix remain
open. **26 complete, 32 open**; versions remain 0.8.3. No deployment or publication.

<a id="codex-deno-development-2026-10-04"></a>
### Codex: Native Deno development through Vite (2026-10-04)

The Deno adapter now has a separate Node-only `/vite` entry. Generated web
configurations use `cossackDeno()`; Desktop configurations exclude it. Vite
transforms modules and serves browser assets while its module runner evaluates
server code in a Deno child. The generated source entry exports `app`, `env`
and `runtime`; production fetch/serve behavior is retained.

Module requests and application traffic use authenticated loopback connections.
The child removes private bridge headers/configuration before calling the app.
Forwarding preserves the native request needed by Deno's WebSocket upgrade;
cloning it accepted a client handshake but lost server callbacks in the initial
prototype. Source reload replaces the child, preserving Vite's browser HMR
connection. Late proxy resets are handled without crashing Vite. Parent and
child both bound shutdown; an ownership pipe triggers child cleanup after a
parent crash, with a child-owned deadline for stuck application work.

Verification:

- Generated native runtime/browser acceptance: cold WebSockets, HTTP/SSE/socket
  actions, repeated cookies, public URL, environment-file/process precedence,
  private-header/config exclusion, server edits, process replacement, startup
  failure/repair, normal shutdown and parent crash with ignored cleanup.
  Both recovery cases pass (`/tmp/cossack-deno-dev-recovery.log`).
- Deno adapter: **21 tests / 3 files**; scaffold: **113 / 8**
  (`/tmp/cossack-deno-dev-unit.log`). Root `pnpm tsc --noEmit` and all **11 package
  type checks** pass (`/tmp/cossack-deno-dev-root-types.log`,
  `/tmp/cossack-deno-dev-package-types.log`).
- The expanded `pnpm test:deno` gate includes installed development/recovery,
  production and CLI startup, typed native smoke tests, and workspace cases.
  **The full gate passes** with Deno 2.9.6: installed Vite 8.3.2, production and
  normal/JSON startup, both development recovery cases, **2 typed native smoke
  tests**, then **3 workspace cases / 42 unrelated cases skipped** with Vite 8.1.4.
  Log: `/tmp/cossack-deno-dev-gate.log`.

The implementation follows Vite's [runtime module-runner API](https://vite.dev/guide/api-environment-runtimes).
This is trusted local development, not a sandbox. Middleware mode is explicitly
rejected. Reload resets process-local state; bounded termination does not undo
external effects or prove application cleanup. On Linux containers, the crash
check accepts a terminated zombie retained by PID 1 as no longer executing.
Public CLI development trace parity, HTTPS acceptance, Electron launch/packaging
and the full release matrix remain open. **26 complete, 32 open**; versions stay
at 0.8.3. No deployment or publication occurred.

<a id="codex-deno-cli-start-2026-10-04"></a>
### Codex: Deno CLI production startup (2026-10-04)

`cossack start` now selects the Deno executable for Deno projects instead of
running the built entry in Node. It uses the generated baseline environment,
network and read permissions; application arguments retain their ordering and
literal values. `COSSACK_DENO_BINARY` selects an executable, otherwise the CLI
uses `deno` on PATH. Missing builds direct the user to `pnpm run build`, which
includes the generated SSR build.

Normal and JSON startup for Node/Deno now share bounded process supervision.
JSON output retains its existing event contract and excludes child output and
arguments. No `started` event is emitted when the executable cannot spawn.
Cloudflare dispatch is unchanged. Custom Deno permission sets remain available
through the generated `deno.json` task.

Verification:

- Generated Deno app: **1 pass / 42 unrelated cases skipped**. In addition to
  browser/runtime acceptance, both CLI output modes start a real Deno server
  from a project subdirectory, preserve arguments containing spaces and `--`,
  serve native HTTP, and reclaim the server after SIGTERM/SIGINT. JSON metadata
  identifies Deno; its child PID and listening port no longer exist after exit.
  Log: `/tmp/cossack-deno-cli-generated.log`.
- CLI lifecycle: **13 pass / 38 unrelated cases skipped**, including normal Node
  cleanup and Deno missing-build/executable diagnostics. Broader CLI subprocess
  and adapter regressions: **43 tests / 2 files pass**. Logs:
  `/tmp/cossack-deno-cli-lifecycle.log`, `/tmp/cossack-deno-cli-contracts.log`.
- Root `pnpm tsc --noEmit` and all **11 package type checks** pass. Logs:
  `/tmp/cossack-deno-cli-root-types.log`, `/tmp/cossack-deno-cli-package-types.log`.
- `COSSACK_DENO_BINARY=<Deno executable> pnpm test:deno` passes the full local
  package build/pack/install gate, generated-app TypeScript, Deno/Chromium
  HTTP/SSE/WebSocket and normal/JSON CLI startup, **2 typed native smoke tests**,
  and the workspace generated-app case. The installed check invokes the tarball
  CLI's own executable. Log: `/tmp/cossack-deno-cli-installed.log`.

A `started` event still means process creation, not HTTP readiness. Termination
and a bounded wait do not prove graceful draining of arbitrary application work.
Actual Deno development integration, RT-28 development traces, Electron
launch/packaging and the final release matrix remain open. **26 complete,
32 open**; versions stay at 0.8.3.

<a id="codex-deno-production-2026-10-04"></a>
### Codex: Real Deno production acceptance (2026-10-04)

Generated Deno apps now keep pnpm-installed dependencies with
`nodeModulesDir: "manual"` and honor `PORT`/`HOST` (defaults: 8000/0.0.0.0).
The first actual run exposed automatic installation replacing linked packages
and failing to resolve a server import. Generated-app TypeScript checks also
cover conversion of the environment's `HOST` value to the adapter's string type.

Shared adapter contracts now live in core, with framework re-exports. Deno and
Desktop no longer depend on framework-owned types. Core publishes the empty
JavaScript companion required for Deno to resolve the type-only contract;
Desktop builds consume published declarations instead of pulling core source
outside their project. The typed Deno smoke test caught the missing companion
before correction.

Verification:

- `COSSACK_DENO_BINARY=<Deno executable> pnpm test:deno`: builds and packs local
  packages, installs a generated Deno application, checks its TypeScript and
  runs it in Deno/Chromium; then runs **2 typed native smoke tests** and the
  workspace generated-app case (**1 pass / 42 unrelated cases skipped**).
  HTTP requests, repeated cookies, bindings, HTTP/SSE/WebSocket actions,
  hydration, origin/scope rejection and process termination pass. Client chunks
  exclude server method code; both graphs exclude `cloudflare:workers` imports.
  Log: `/tmp/cossack-deno-gate-complete.log`.
- Deno adapter: **16 tests / 2 files**; Desktop: **16 / 4**;
  framework adapter contract: **5 / 1**. Logs:
  `/tmp/cossack-deno-regressions.log`, `/tmp/cossack-deno-framework-contract.log`.
- Scaffold: **113 tests / 8 files** (`/tmp/cossack-deno-scaffold-final.log`).
  Root `pnpm tsc --noEmit` and all **11 package type checks** pass
  (`/tmp/cossack-deno-root-types-final.log`, `/tmp/cossack-deno-package-types-final.log`).
- Missing Deno fails immediately with setup guidance; the gate never treats the
  ordinary suite's optional Deno case as runtime evidence. The CLI test package
  declares Deno ambient types for its generated TypeScript fixture.

Baseline: Deno 2.9.6 on Linux; installed Vite 8.3.2, Hono 4.13.12 and TypeScript
7.0.2. Deno's native checker uses its bundled TypeScript 6.0.3. No deployment or
publication occurred. Process termination does not prove graceful draining of
arbitrary generated-app work. Deno CLI startup/development, RT-28 development
traces, Electron launch/packaging and the full release matrix remain open.
**26 tasks complete, 32 open**; versions stay at 0.8.3.

<a id="codex-node-websocket-development-2026-10-04"></a>
### Codex: Unified Node development sockets and bindings (2026-10-04)

Author: Codex. A dedicated `/ws/` listener now loads the application before its
first WebSocket handshake, without requiring a prior HTTP request. Runtime upgrade
handlers attach to a private event host, keeping Vite's HMR listener independent.
Server-source hot updates replace the SSR graph, detach and dispose the previous
runtime, and close its sockets. A revision check discards an entry superseded
while its binding factory is awaiting work. Failed factories retry with a fresh
entry rather than a disposed runtime. The implementation uses Vite's
[per-environment hot-update hook](https://vite.dev/guide/api-environment-plugins#the-hotupdate-hook).

Generated Node entries expose one typed `createEnv` factory. Development uses
Vite environment files with process overrides; production uses process variables.
The factory preserves arbitrary bindings, the database path default and SMTP
email setup. Configured SMTP requires both credentials. No mail is sent by the
acceptance tests. The generated script is now a thin Vite launcher that retains
its optional local overlay and port default. Both normal and JSON `cossack dev`
use the same bounded child-process supervisor.

Verification:

- Node adapter: **22 tests / 5 files pass**, including stale asynchronous
  initialization and binding-factory retry regressions
  (`/tmp/cossack-node-sockets-final-adapter.log`). The tooling bundle keeps all Node
  built-ins external; the actual generated app caught the initial EventEmitter
  browser-stub packaging mistake before correction.
- Generated Node cold socket startup, HMR, repeated reload and binding precedence
  through both launchers, plus all three Node trace transports and production
  exclusion: **5 pass / 36 unrelated cases skipped**
  (`/tmp/cossack-node-sockets-traces.log`). SMTP coverage constructs a sender and
  checks its interface; it does not establish delivery or contact an SMTP host.
- Generated normal/JSON CLI HTTP and shutdown checks, state development/production
  examples and Cloudflare HTTP/SSE/WebSocket traces: **7 pass / 35 unrelated cases
  skipped** (`/tmp/cossack-node-sockets-runtime.log`).
- CLI lifecycle contract: **9 pass / 38 unrelated cases skipped**, using
  `--testTimeout 30000` (`/tmp/cossack-node-sockets-cli.log`). Requested SIGINT and
  SIGTERM code forms are accepted; unsolicited exits and forced timeouts fail.
- Scaffold: **113 tests / 8 files pass** (`/tmp/cossack-node-sockets-scaffold.log`).
- Root `pnpm tsc --noEmit` and all 11 package type checks pass
  (`/tmp/cossack-node-sockets-final-types.log`).

Installed acceptance uses `node scripts/test-local-scaffold.mjs --node-dev-only`
and now includes both Vite and script launch paths plus Node WebSocket traces.
The first installed run found that Vite externalized the packaged Node adapter
and core, disabling server socket trace guards. The plugin now keeps those two
packages in its development SSR graph; the production build stays unchanged.
**The corrected gate passes**: all three Node trace transports, exact offline
CLI/MCP parity, native evidence, production exclusion, cold sockets and reloads
through both launchers, six packaged examples, reporter types and UI contracts.
Installed versions include Vite 8.3.2, Hono Node server 2.1.3, Hono 4.13.12,
TypeScript 7.0.2 and Vitest 4.1.11. Log:
`/tmp/cossack-node-sockets-installed-final.log`. Temporary installs were removed.

The shutdown deadline bounds waiting, not arbitrary application I/O. Server edits
reset process-local socket instances. Other runtime development acceptance and the
final release matrix remain open. **26 complete, 32 open**; versions stay 0.8.3.

<a id="codex-node-development-2026-10-04"></a>
### Codex: Node Vite development HTTP and trace acceptance (2026-10-04)

Author: Codex. The Node adapter now exports a separate `/vite` plugin. Generated
Node web configurations use it to serve the public `app.fetch` entry after Vite's
assets and transformed modules. The library imports no framework code, and its
main runtime entry does not import Vite. The plugin uses Vite's
[module runner](https://vite.dev/guide/api-environment-frameworks#runnabledevenvironment)
and the Hono Node bridge for request bodies and repeated response cookies.

Each request observes the current server module. Replacement detaches the old
runtime and starts cleanup. Closing Vite bounds cleanup waits; it cannot stop
ignored application I/O. Embedded Vite hosts retain their own lifecycle, preserving
the generated script's existing workflow. The private state-fixture bridge is removed.

The actual `cossack dev --json` check found Vite's handled SIGTERM exit code 143
was classified as failure. The CLI now accepts that code only after its own stop
request. Unsolicited exits and forced timeout termination still fail.

Verification:

- Node adapter: **20 tests / 5 files pass**, including actual Vite HTTP requests,
  repeated cookies, module/public assets, source replacement, entry-error recovery
  and a nonsettling cleanup deadline. Log: `/tmp/cossack-node-dev-adapter.log`.
- Scaffold: **113 tests / 8 files pass** (`/tmp/cossack-node-dev-scaffold.log`).
- CLI machine contract: **45 tests pass**, using `--testTimeout 30000` for tests
  that run multiple subprocesses. The initial default five-second run timed out
  in four unrelated finite-command cases; its lifecycle assertions passed.
  Final log: `/tmp/cossack-node-dev-lifecycle-final.log`.
- Generated state development/production and existing script WebSocket/HMR checks:
  **3 pass / 33 unrelated cases skipped** (`/tmp/cossack-node-dev-generated.log`).
- Generated Node HTTP/SSE browser traces, native evidence, CLI/MCP parity and
  production exclusion: **2 pass / 36 unrelated cases skipped**
  (`/tmp/cossack-node-dev-traces.log`).
- Actual generated `cossack dev --json`: **1 pass / 38 unrelated cases skipped**,
  proving SSR, native POST bodies, repeated cookies, source reload and requested
  shutdown reporting (`/tmp/cossack-node-dev-cli.log`).
- Root `pnpm tsc --noEmit` and all 11 package type checks pass
  (`/tmp/cossack-node-dev-types.log`).
- Cloudflare HTTP/SSE/WebSocket trace regression after the shared fixture change:
  **3 pass / 36 unrelated cases skipped**, including production exclusion
  (`/tmp/cossack-node-dev-cloudflare.log`).

The reproducible installed Node gate is
`node scripts/test-local-scaffold.mjs --node-dev-only`. It builds and packs the
local packages, installs an isolated Node application, and runs installed
documentation plus HTTP/SSE trace browser/CLI/MCP acceptance. **The gate passes**,
including six packaged examples, public reporter types, offline evidence readers,
UI contracts and production exclusion. Installed versions include Vite 8.3.2,
Hono Node server 2.1.3, Hono 4.13.12, TypeScript 7.0.2 and Vitest 4.1.11.
Log: `/tmp/cossack-node-dev-installed.log`. The temporary installation was removed.

Remaining: direct WebSocket startup before an HTTP request, proactive socket
runtime replacement on source edits, and binding/environment parity with the
script. Standalone attachment currently starts with the first application HTTP
request. Deno and Desktop acceptance and the final release matrix remain open.
No task closes: **26 complete, 32 open**. Versions remain 0.8.3.

<a id="codex-native-trace-evidence-2026-10-04"></a>
### Codex: Native body server trace evidence (2026-10-04)

Author: Codex. RT-28 native component and service responses now report fixed-field
`server-native` evidence after producer cancellation and request disposal settle.
The Vite server environment channel carries it separately from application bytes
and headers. Receipt acknowledgements keep background Worker reporting I/O alive through
execution-context `waitUntil`, with a one-second bound and no replay. Native headers
and EOF do not wait for reporting.
Observer errors never replace the application outcome. Production strips reporting.

Browser capture joins call/request/dispatch IDs to native response headers, accepts
one terminal before headers or after local finish, and retains at most 256 recent
HTTP correlations. Stop/replacement clears them. Local success and server cleanup
failure remain separate facts. A stalled cleanup emits no terminal. See the
[contract and limits](../docs/development-traces.md#native-body-terminals).

Real browser acceptance also exposed empty readable streams for bodyless HTTP
statuses. The native client reader now reconstructs those responses with a null
body instead of throwing. Binary bytes, status, Content-Length and custom headers
retain their existing semantics.

Verification:

- Core suite: **1,524 tests / 93 files pass**; final correlation/race checks:
  **34 tests / 3 files pass**. Includes a server-assigned request ID arriving after
  an early bodyless terminal. Core builds pass. Logs: `/tmp/cossack-native-trace-core.log`,
  `/tmp/cossack-native-trace-final-core.log` and `/tmp/cossack-native-trace-final-build.log`.
- Framework lifecycle, background acknowledgement, persistence, router, stream
  and production checks: **109 tests / 7 files pass**. Headers and EOF finish even
  when no acknowledgement arrives. Log: `/tmp/cossack-native-trace-background-framework.log`.
- Generated Cloudflare browser/CLI/MCP acceptance: **3 pass / 33 unrelated cases
  skipped**, covering HTTP, SSE and WebSocket pages, component/service binary
  bodies, service 204s and production exclusion. Log: `/tmp/cossack-native-trace-background-generated-final.log`.
- The local scaffold gate builds packages and packs 12 tarballs. The final core
  and framework tarballs replace the earlier ones in the isolated installation;
  its expanded `verifyAgentDocumentation` fixture checks all three transports,
  exact offline CLI/MCP parity, packaged examples and production client/Worker
  exclusion. Each fixture run owns a unique scope so repeated checks do not reuse
  persisted SSE state. Logs: `/tmp/cossack-native-trace-installed.log` and
  `/tmp/cossack-native-trace-background-installed-final.log`. The temporary
  installation and tarballs were removed after verification.
- MCP lifecycle suite: **18 tests pass** (`/tmp/cossack-native-trace-mcp.log`).
  Root `pnpm tsc --noEmit` and all 11 package type checks pass
  (`/tmp/cossack-native-trace-types.log`). The final native lifecycle test rerun
  passes all 10 cases after correcting the mock `waitUntil` promise type
  (`/tmp/cossack-native-trace-final-test-types.log`).

RT-28 remains open for other runtime development acceptance. Native server cleanup
evidence does not prove browser consumption, downstream cleanup or ignored I/O
termination. No task closes: **26 complete, 32 open**; versions remain 0.8.3.

<a id="codex-native-cancel-settlement-2026-10-04"></a>
## Codex: Native response failure settlement (2026-10-04)

Native body cancellation no longer waits for an application producer's cleanup
promise before rejecting or releasing the local reader. Regressions reproduced
indefinite waits for already-aborted and oversized responses before the fix.
Component and explicit-service proxies now retain the size failure before their
deadline, clear loading/optimistic state and record one failed trace terminal.
Late cleanup rejection stays observed; response bytes and headers are unchanged.

Verification: core build passes; **1,515 tests / 92 files pass**, including six
new reader/proxy regressions. Root `pnpm tsc --noEmit` and `pnpm typecheck` pass
for all 11 packages. Logs: `/tmp/cossack-native-cancel-before.log` (reproduction),
`/tmp/cossack-native-cancel-core.log`, `/tmp/cossack-native-cancel-build.log` and
`/tmp/cossack-native-cancel-types.log`.

This proves local failure settlement, not server cleanup or ignored I/O termination.
RT-28 native-body server terminal evidence and other runtime acceptance remain
open. RT-01's other criteria also remain open. **26 tasks complete, 32 open**;
versions stay at 0.8.3. Preserve the [HTTP/WebSocket evidence](./release-0.9.0-verification-archive.md#codex-socket-trace-evidence-2026-10-04).

<a id="codex-socket-trace-evidence-2026-10-04"></a>
## Codex: WebSocket server trace evidence (2026-10-04)

Author: Codex. RT-28 now correlates WebSocket server dispatch with browser RPC
observations and shared CLI/MCP records. Each opted-in action owns its recorder
while queued or executing. The first yield and terminal can carry fixed-field
`server-socket` evidence with call/request/dispatch IDs, server stage timestamps,
result kind and frame type. Rejected methods/input have no invocation marker;
invoked failures have no return marker. Records contain no application payloads,
names or raw errors. Production removes the marker, encoder and collector.

The client accepts at most two records per call, rejects mismatched dispatch/frame
identities and keeps the original capture owner. Optional metadata cannot turn a
valid frame into an oversized failure or evaluate application serialization twice.
Cancellation never invents a server terminal. Socket terminal delivery does not
prove iterator cleanup: the existing dispatcher cleans up after sending it.
Browser collection time may follow a paused queue and uses a separate clock from
the server markers. See [semantics](../docs/development-traces.md#websocket-dispatch-evidence).

The shared runtime dispatcher supplies the evidence for process and Durable Object
adapters. The browser acceptance fixture now covers HTTP and real Cloudflare
WebSocket actions, plus an explicit layout-service HTTP call, from both workspace
links and installed tarballs. Both variants compare browser/stored/CLI/MCP records,
check generated types and production client/Worker exclusion, then close the server.
The tarball reader checks retain Node networking guards. Source and configuration
changes in the acceptance app are restored after each variant.

Verification:

- `pnpm --filter @cossackframework/core exec vitest run`: **1,509 tests / 92 files pass**.
  Includes dispatch/denial/failure/queue/cancellation correlation, malformed evidence,
  frame limits, one-time serialization and four production bundle entrypoints.
  Log: `/tmp/cossack-socket-trace-core-full.log`.
- `pnpm --filter @cossackframework/framework exec vitest run tests/development-traces.test.ts tests/development-trace-bridge.test.ts tests/navigation-trace-build.test.ts`:
  **18 tests / 3 files pass**. Log: `/tmp/cossack-socket-trace-framework.log`.
- `pnpm --filter cossack exec vitest run tests/mcp.test.js`: **18 tests pass**.
  Log: `/tmp/cossack-socket-trace-mcp.log`.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'shares a generated development browser RPC trace'`:
  **2 pass, 33 unrelated tests skipped**. Log: `/tmp/cossack-socket-trace-generated.log`.
- `COSSACK_KEEP_SMOKE=1 node scripts/test-local-scaffold.mjs --agent-docs-only`:
  sequential package builds, 12 tarballs and complete installed documentation,
  reporter, HTTP/WebSocket trace and production exclusion acceptance pass.
  Log: `/tmp/cossack-socket-trace-installed.log`. Installed Vite **8.3.2**,
  Cloudflare Vite plugin **1.62.5**, Wrangler **4.147.0**, TypeScript **7.0.2**,
  Vitest **4.1.11**. The temporary installation was removed after verification.
- Root `pnpm tsc --noEmit` and `pnpm typecheck` pass for all **11 packages**.
  Log: `/tmp/cossack-socket-trace-types.log`.

Limits: native-body terminal evidence and other runtime development acceptance
remain open under RT-28. Socket evidence does not cover post-send cleanup or prove
that ignored application I/O stopped. Local editable records are not authenticated
server logs or remote readiness checks. No task closes: **26 complete, 32 open**.
Versions remain 0.8.3; no deployment or publication occurred.

<a id="codex-stream-terminal-evidence-2026-10-04"></a>
## Codex delivered RPC stream terminal evidence (2026-10-04)

Author: Codex. Opted-in HTTP/SSE component and service generators now attach a
bounded record to their terminal frame after request cleanup is attempted. It
reports outcome and cleanup separately, and joins the call/request/dispatch IDs
from the earlier response header. Core records one `server-stream` event only
after normal stream and EOF validation. Untrusted metadata is strictly parsed;
missing, malformed or mismatched metadata does not change application behavior.
The shared stored-record reader exposes the same event to CLI and MCP.

Serialization snapshots application values once. Optional evidence is omitted at
the byte limit, with room reserved for an SSE coordinator cursor. Cancellation
never invents server completion. Production excludes both collection and encoding.

Verification:

- `pnpm --filter @cossackframework/core exec vitest run`:
  **1,497 tests / 92 files pass**, including correlated terminals, stopped captures,
  malformed/mismatched records, valid error delivery and trailing-data rejection.
  Log: `/tmp/cossack-stream-evidence-core.log`.
- `pnpm --filter @cossackframework/framework exec vitest run tests/rpc-stream.test.ts tests/router-rpc-stream.test.ts tests/sse-coordinator-transport.test.ts tests/rpc-conformance-matrix.test.ts tests/development-traces.test.ts tests/navigation-trace-build.test.ts`:
  **572 tests / 6 files pass**. Real JSON/multipart router dispatch, success/action
  failure/cleanup failure, cancellation, byte-limit omission, one-time application
  serialization, service-proxy storage and production exclusion pass.
  Log: `/tmp/cossack-stream-evidence-framework.log`.
- `pnpm --filter cossack exec vitest run tests/mcp.test.js`:
  **15 tests pass**, including CLI/MCP parity for stored dispatch and stream terminals.
  Log: `/tmp/cossack-stream-evidence-mcp.log`.
- Core build, framework declarations, root `pnpm tsc --noEmit` and
  `pnpm typecheck` pass (all 11 packages).
  Logs: `/tmp/cossack-stream-evidence-build-final.log`, `/tmp/cossack-stream-evidence-types.log`.

Limits: this reports the producing action's request cleanup, not all downstream
coordinator/network work. Lost or invalidated delivery has no accepted server
terminal. WebSocket and native-body server lifecycle evidence, full generated
application acceptance and installed tarballs remain open under RT-28/CLI-07.
No task closes: **25 complete, 33 open**.

<a id="codex-server-dispatch-evidence-2026-10-04"></a>
## Codex HTTP server dispatch evidence (2026-10-04)

Author: Codex. Active captures now request bounded server evidence for HTTP/SSE
component actions and explicit services, including multipart/progress uploads.
Request-local router instrumentation records receipt, invocation, method return
and response creation. The client accepts one fixed-field record only when call
ID, request ID and HTTP status match. A separate dispatch ID identifies the server
request. The shared Vite/CLI/MCP reader accepts the same `server-rpc` event.
Arguments, names, state values and raw errors are excluded; production removes
client capture and server instrumentation.

The broader RPC matrix also exposed a regression in the prior paused-deadline fix:
an immediate application error could discard its preceding WebSocket yield.
Local transport interruptions now carry an internal flag; server application
errors retain ordered delivery after yields, regardless of their error code.
Disconnects, invalid frames, overflow and deadlines still interrupt paused calls.

Verification:

- Core: **1,491 tests / 92 files pass**, including actual proxy/header correlation,
  malformed and mismatched evidence, capture replacement, ordered WebSocket errors,
  paused transport interruptions and production capture exclusion.
  Command: `pnpm --filter @cossackframework/core exec vitest run`.
  Log: `/tmp/cossack-server-evidence-core-verified.log`.
- Framework: **559 tests / 6 files pass**, including the expanded shared RPC
  matrix, JSON/multipart component and service dispatch, denied/failed/native and
  generator results, stored-record exclusion, and production bundle checks.
  Command: `pnpm --filter @cossackframework/framework exec vitest run tests/router-rpc-stream.test.ts tests/rpc-conformance-matrix.test.ts tests/rpc-child-targets.test.ts tests/rpc-resource-reconstruction.test.ts tests/development-traces.test.ts tests/navigation-trace-build.test.ts`.
  Log: `/tmp/cossack-server-evidence-framework-final.log`.
- MCP: **15 tests pass**, including SDK/CLI parity for stored server evidence.
  Command: `pnpm --filter cossack exec vitest run tests/mcp.test.js`.
  Log: `/tmp/cossack-server-evidence-mcp.log`.
- Core build, framework declaration build, root `pnpm tsc --noEmit` and
  `pnpm typecheck` pass (all 11 packages).
  Logs: `/tmp/cossack-server-evidence-rebuild.log`, `/tmp/cossack-server-evidence-types-final.log`.

Limits: response creation does not prove generator/native-body completion or
remote cleanup. Server stream terminals and WebSocket dispatch evidence remain
open, along with full generated development-trace and installed-tarball acceptance.
Browser and server clocks are distinct; records are editable local observations,
not authenticated logs. No task closes: **25 complete, 33 open**.

<a id="codex-paused-rpc-deadlines-2026-10-04"></a>
## Codex paused RPC deadlines (2026-10-04)

Author: Codex. HTTP/SSE component, explicit service and WebSocket deadlines now
settle calls while consumers are paused at a yield. Shared cancellation latches
completion before transport cleanup and closes the generator without another pull.
Repeated cancellation keeps the first outcome. WebSocket disconnects and queue
failures also release pending ownership; confirmed state remains and mutations
are never replayed. Stream reader cleanup does not await producer cancellation.

Verification:

- Core suite: **1,484 tests / 91 files pass**, including paused deadlines,
  disconnect/overflow, reader release, stable success and reentrant cancellation.
  Command: `pnpm --filter @cossackframework/core exec vitest run`.
  Log: `/tmp/cossack-paused-deadline-core-suite.log`.
- Core build and framework declarations pass. After the final fixture changes,
  `pnpm tsc --noEmit` and `pnpm typecheck` pass (all 11 packages).
  Logs: `/tmp/cossack-paused-deadline-build.log`, `/tmp/cossack-paused-deadline-final-types.log`.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js`:
  **1 test passes** through a generated production Worker, workerd, D1 and Chromium,
  including six paused component/service cases across HTTP/SSE/WebSocket pages.
  The socket fixture uses explicit D1 bindings, preserving the audit table and
  proving one mutation per call. No upload occurs.
  Log: `/tmp/cossack-paused-deadline-workerd-fixed.log`.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'retains confirmed optimistic component and service yields through failures and cancellation'`:
  **1 passes, 32 unrelated tests skipped**. Generated TypeScript, client/server
  builds and the same browser cases pass with the Node adapter and test backend.
  Log: `/tmp/cossack-paused-deadline-node-fixed.log`.

Limits: local settlement cannot stop ignored application I/O or undo external
writes. Server correlation and full generated development-trace/tarball acceptance
remain open under RT-28/CLI-07. No task closes: **25 complete, 33 open**.

<a id="codex-service-traces-2026-10-04"></a>
## Codex explicit service RPC traces (2026-10-04)

Author: Codex. Explicit layout-service HTTP calls now emit `service-rpc` events
through the same bounded capture sequence as component RPC and navigation. Calls
have opaque weak service identities, local call IDs and filtered wire IDs. They
record response/state-reconciliation and one cleanup outcome without exposing
service names, arguments, values or owner paths. Services do not enter the
component snapshot registry. Shared stored-record validation and CLI/MCP reads
accept this event variant without weakening field/value exclusion.

Component and service stream clients also adopt a validated frame's request ID
when its HTTP response omitted the correlation header. Subsequent reconciliation,
completion and cancellation retain that ID. A changed observed ID produces another
response event under the original local call ID; non-UUID values stay omitted.

Verification:

- `pnpm --filter @cossackframework/core exec vitest run`: **1,471 tests / 89 files pass**.
  New real service-scope tests cover response/state/completion, stable versus
  distinct service identities, pre-dispatch serialization failure, private ID
  exclusion, cancellation, response-wait deadlines, capture replacement and
  streamed completion/cancellation with frame-only correlation. Component stream
  correlation and production service-proxy exclusion have regression coverage.
  Log: `/tmp/cossack-service-trace-core-suite.log`.
- `pnpm --filter @cossackframework/framework exec vitest run tests/development-traces.test.ts tests/development-trace-bridge.test.ts tests/devtools-browser.test.ts tests/navigation-trace-build.test.ts`:
  **14 tests / 4 files pass**. A real service call round-trips through the built
  core public entry and shared store; service/component identity mixing and
  unsupported service transports are rejected. Existing browser/bridge gates pass.
  Log: `/tmp/cossack-service-trace-framework-tests.log`.
- `pnpm --filter cossack exec vitest run tests/mcp.test.js`: **15 tests pass**,
  including stdio SDK/CLI parity for a stored service event.
  Log: `/tmp/cossack-service-trace-mcp-tests.log`.
- Core build, framework declaration build, root `pnpm tsc --noEmit` and
  `pnpm typecheck` pass (all 11 packages).
  Logs: `/tmp/cossack-service-trace-build.log`, `/tmp/cossack-service-trace-types.log`.

Limits: client observations do not prove server execution, and service IDs do not
identify the consuming component or a historical service-state snapshot. Source
review found that a timeout while an iterator is paused at a yield aborts transport
but can delay cleanup/completion until consumer resumption; the deadline tests
above cover response waiting, not that paused-iterator case. Reproduce and fix it
next for both component and service clients. Server correlation and full generated
application/tarball acceptance remain open. Status stays 25 complete and 33 open.

<a id="codex-trace-bridge-2026-10-04"></a>
## Codex project-bound trace bridge (2026-10-04)

Author: Codex. `cossackPages({ developmentTraces: true })` now installs a development
publisher through Vite HTML transformation. Explicit browser capture offers its
default snapshot once per second with one outstanding acknowledgement; stopped
snapshots are acknowledged before suppressing further sends. Disconnect/reconnect,
page exit and HMR remove or suspend publishing without replaying application work.
The injected module honors the development base path and is empty in production.

The framework's Node-only `/development-traces` service owns strict parsed-JSON
validation, bounded project-local storage and reads. Selected state values and
extra payload fields are rejected. Records carry project/server identity and
receipt time, use atomic replacement and retain up to 16 capture sessions.
`cossack traces --json` and MCP `read_development_traces` share that reader, expose
record age with `live: false`, and accept an optional capture session UUID.

Verification:

- `pnpm --filter @cossackframework/framework exec vitest run tests/development-traces.test.ts tests/development-trace-bridge.test.ts tests/devtools-browser.test.ts tests/devtools.test.ts tests/navigation-trace-build.test.ts`:
  **20 tests / 5 files pass**. Real core snapshots round-trip through storage.
  Chromium exercises the actual opt-in page plugin under `/debug/`, receives
  default component snapshots on disk and records the stopped capture. Tests also
  cover schema limits, selected-value exclusion, links/corrupt/copied records,
  retention, acknowledgement races, overload, cleanup, default-off installation
  and production publisher/virtual-module exclusion.
  Log: `/tmp/cossack-trace-bridge-final-tests.log`.
- `pnpm --filter cossack exec vitest run tests/mcp.test.js tests/dispatch.test.js tests/flags.test.js tests/documentation.test.js`:
  **64 tests / 4 files pass**, including real stdio SDK/CLI trace parity, project
  binding, unknown-field/path rejection and existing tool/command regressions.
  Log: `/tmp/cossack-trace-cli-tests.log`.
- `pnpm tsc --noEmit`, `pnpm typecheck` and
  `pnpm --filter @cossackframework/framework build:types`: root, all 11 package
  checks and public declaration build pass.
  Logs: `/tmp/cossack-trace-bridge-types.log`, `/tmp/cossack-trace-bridge-build.log`.

Limits: these are sampled local browser observations, not authenticated server
execution or a live query. A collecting flag can outlive the browser/server.
Source/environment freshness is not verified. One recording Vite server owns a
project directory; custom HTML servers must run Vite's HTML transform. Page exit
can precede the final write; captures replaced within one sampling interval can
remain unpublished. This uses workspace builds and an isolated Vite/Chromium
fixture, not fresh tarball/generated-application acceptance. RT-28 still needs
server correlation, service RPC capture and full generated runtime acceptance.
CLI-07 and release gates stay open. Status remains 25 complete and 33 open.

<a id="codex-browser-inspector-2026-10-04"></a>
## Codex browser inspector integration (2026-10-04)

Author: Codex. The browser inspector now uses the core passive snapshot reader.
It no longer logs live instances or raw public state. Capture starts explicitly
through Record trace or Ctrl-Shift-click; Ctrl-click retains source opening.
The controller owns stop/read/dispose operations. Source registrations are weak,
limited to 128 files and unregister by identity. Highlighting uses viewport
coordinates and the Control key. Disposal removes controls/listeners, restores
its cursor and stops only its own capture; bfcache suspension retains capture.

Verification:

- `pnpm --filter @cossackframework/framework exec vitest run tests/devtools.test.ts tests/devtools-browser.test.ts tests/navigation-outcomes.test.ts tests/navigation-trace-build.test.ts`:
  **59 tests / 4 files pass**. DOM tests cover controls, identity, bounds, page exit,
  external capture ownership and cursor restoration. Chromium runs a real Vite
  fixture with a Cossack instance: inspection redacts selected sensitive state,
  suppresses the application action, avoids editor requests and disposes cleanly.
  Production bundling excludes inspector controls, source endpoint and collector.
  Log: `/tmp/cossack-browser-inspector-final-tests.log`.
- `pnpm tsc --noEmit` and `pnpm typecheck`: root and all 11 packages pass.
  Log: `/tmp/cossack-browser-inspector-types.log`.
- `pnpm --filter @cossackframework/framework build:types`: passes; built public
  declarations expose `BrowserDevTools` and the identity-safe unregister callback.
  Log: `/tmp/cossack-browser-inspector-build.log`.

Limits: the Chromium fixture is isolated, not a generated application. Automatic
source registration currently covers rendered pages; repeated instances sharing
one source file cannot be distinguished. Generated custom client entries require
explicit inspector installation. The existing editor service is separate and
was not launched by these tests. Server correlation, Vite/shared CLI/MCP trace
reads, service RPC capture and generated-browser acceptance remain open. No
release task is closed: status remains 25 complete and 33 open.

<a id="codex-component-snapshots-2026-10-04"></a>
## Codex passive component snapshots (2026-10-04)

Author: Codex. Development capture now tracks at most 64 weak component references
and exposes current snapshots with capture timestamps. Framework-owned readers
inspect initialized public/client field inventory, resource status (including
unbound declarations), scope ownership/counts and recorded transport status.
Defaults omit values. Explicit state selections return detached tagged values
with depth/node/entry/string limits, known-secret redaction and markers for
accessors, cycles, unsupported values and sparse holes. Selected values are not
retained by the event buffer. Stops prevent subsequent passive component reads.

Verification:

- `pnpm --filter @cossackframework/core exec vitest run`: **1,462 tests / 88 files pass**.
  New fixtures use real Cossack lifecycle/resource records and service scopes.
  They verify passive unbound/pending/ready/error resource reads, no getter or
  serialization-hook calls, no service construction during reads, private-state
  exclusion, redaction, sparse/value limits, detached results and registry bounds.
  Log: `/tmp/cossack-component-snapshots-core-suite.log`.
- `pnpm --filter @cossackframework/framework exec vitest run tests/navigation-outcomes.test.ts tests/navigation-owner.test.ts tests/navigation-focus.test.ts tests/navigation-trace-build.test.ts`:
  **62 tests / 4 files pass**. Log: `/tmp/cossack-component-snapshots-framework.log`.
- Production proxy bundling also checks removal of inspector registration,
  selected-value readers and validation text, alongside trace collection.
- `pnpm --filter @cossackframework/core build`, `pnpm tsc --noEmit` and
  `pnpm typecheck`: build, root and all 11 package checks pass.
  Logs: `/tmp/cossack-component-snapshots-build.log`, `/tmp/cossack-component-snapshots-types.log`.
- The workspace CLI exact-symbol catalog exposes the built `DevelopmentTraceSession`
  with `inspect`, `snapshot` and `stop`, plus the updated packaged guide.
  This is workspace package evidence, not a fresh installed-tarball gate.

Limits: selected values must be appropriate to inspect/share; pattern redaction
cannot recognize every secret. Reflective JavaScript proxy traps are not sandboxed.
Snapshots show current reads, not historical reconstruction or server verification.
Unknown/private/uninitialized selections expose no values. The registry and every
inventory/value tree have explicit limits. See [usage](../docs/development-traces.md).
RT-28 still needs browser inspector/Vite integration, server correlation, shared
CLI/MCP trace reads and generated-browser acceptance. CLI-07 and the full release
gates remain open. Status stays 25 complete and 33 open.

<a id="codex-navigation-trace-2026-10-04"></a>
## Codex shared navigation trace capture (2026-10-04)

Author: Codex. Navigation and RPC now share a discriminated event union, bounded
buffer and sequence. Navigation callbacks retain the capture owner across awaits
and stop after their terminal event. Prepared app/layout/page/loading instances
use the same opaque component IDs as RPC calls. This relationship identifies
candidate instances, not proof of a commit or the cause of later calls. Existing
DOM navigation diagnostics remain available. Global invalidation/prefetch events
retain null navigation IDs. Only allowed primitive navigation fields are copied.

Verification:

- `pnpm --filter @cossackframework/core exec vitest run`: **1,457 tests / 87 files pass**.
  Includes shared ordering, component identity joins, session replacement,
  metadata validation and the existing RPC ownership regressions.
  Log: `/tmp/cossack-navigation-trace-core-suite.log`.
- `pnpm --filter @cossackframework/framework exec vitest run tests/navigation-outcomes.test.ts tests/navigation-owner.test.ts tests/navigation-focus.test.ts tests/navigation-trace-build.test.ts`:
  **62 tests / 4 files pass**. Actual navigation orchestration records shared
  phases and prepared components; overlapping navigations retain distinct terminal
  outcomes. The production navigation bundle removes capture and DOM diagnostics.
  Log: `/tmp/cossack-navigation-trace-framework.log`.
- `pnpm --filter @cossackframework/core build`: passes.
  Log: `/tmp/cossack-navigation-trace-build.log`.
- `pnpm --filter @cossackframework/framework build:types`: passes with installed
  Wrangler 4.114.0 type generation and the new public trace declarations.
  Log: `/tmp/cossack-navigation-trace-framework-build.log`.
- `pnpm tsc --noEmit` and `pnpm typecheck`: root and all 11 package checks pass.
  Log: `/tmp/cossack-navigation-trace-types.log` (package checks).

Limits: navigation orchestration tests use controlled component lifecycle fixtures;
they do not replace generated-browser/server acceptance. State/resource/service/
transport snapshots, server correlation, browser inspector and shared CLI/MCP
trace access remain open. RT-28 and CLI-07 stay unchecked; status remains 25/58.
See [capture semantics](../docs/development-traces.md).

<a id="codex-rpc-trace-foundation-2026-10-04"></a>
## Codex development RPC trace foundation (2026-10-04)

Author: Codex. Core exposes `@cossackframework/core/devtools` with opt-in, bounded
capture for component HTTP/SSE and WebSocket proxy lifecycles. Snapshots retain
fixed phases, opaque component/call identities and UUID wire request IDs, without
arguments, values, source paths or raw errors. Replacement sessions do not adopt
in-flight calls. Terminal events cover success, failure, cancellation, deadlines
and disconnects. The cancellation regression caught delayed WebSocket cleanup;
local ownership now releases in the cancellation callback.

Verification:

- `pnpm --filter @cossackframework/core exec vitest run`: **1,454 tests / 87 files pass**.
  Includes correlation through real proxies/frame dispatch, privacy omissions,
  bounded/detached snapshots, session replacement and cancellation/disconnects.
  Log: `/tmp/cossack-trace-core-suite.log`.
- The production bundle fixture verifies collection symbols and event strings
  are removed from a production proxy bundle. This does not prove endpoint
  exclusion for the future Vite development integration.
- `pnpm --filter @cossackframework/core build`: passes; emitted public export resolves
  through the package map and refuses non-development capture in plain Node.
  Log: `/tmp/cossack-trace-core-build.log`.
- `pnpm tsc --noEmit` and `pnpm typecheck`: root and all 11 package checks pass.
  Log: `/tmp/cossack-trace-types.log` (package checks).
- The CLI exact-symbol catalog from the framework workspace resolves the built
  `startDevelopmentTrace` declaration and packaged `development-rpc-traces` guide.
  This uses workspace packages, not a fresh tarball installation.

RT-28 and CLI-07 remain open. This is client component RPC evidence, not server
execution or service RPC capture. Navigation correlation, state/resource/service/
transport snapshots, browser inspector, shared CLI/MCP access, generated-browser
acceptance and final production endpoint/source-metadata checks remain required.
See [usage and limits](../docs/development-traces.md). Status stays 25/58 complete.

<a id="codex-test-evidence-2026-10-04"></a>
## Codex stored test evidence (2026-10-04)

Author: Codex. CLI `test-results` and MCP `read_test_results` use one bounded
reader. The public `cossack/vitest-reporter` records actual Vitest 4 outcomes,
including collection failures, with versioned local provenance and endpoint file
snapshots. Latest-started selection includes unfinished runs. Explicit UUIDs cannot
select arbitrary files; invalid/linked/corrupt/oversized records fail explicitly.
Raw errors, assertions and logs are omitted; metadata redaction is bounded.
Existing CLI deep imports remain available alongside the new reporter export.

Verification:

- `pnpm --filter cossack exec vitest run tests/test-results.test.js tests/vitest-reporter.test.js tests/mcp.test.js tests/command-spec.test.js`:
  43 tests across 4 files pass. Includes real Vitest pass/fail/skip and collection
  failure, executable CLI reads, SDK parity, source changes, UTF-8 validation,
  redaction, copied/linked reports, interrupted records and the 128-run limit.
  Log: `/tmp/cossack-test-evidence-final.log`.
- `pnpm tsc --noEmit` and `pnpm typecheck`: root and all 11 package checks pass.
  Log: `/tmp/cossack-test-evidence-types-final.log` (package checks).
- `pnpm --filter @cossackframework/framework exec vitest run tests/inspection-service-acceptance.test.ts`:
  1 passes, including existing CLI deep imports.
  Log: `/tmp/cossack-test-evidence-framework.log`.
- `node scripts/test-local-scaffold.mjs --agent-docs-only`: passes after sequential
  package builds and fresh tarball installation. The installed public reporter
  declaration compiles without skipping library checks; an actual Vitest run
  produces evidence read identically by installed CLI/MCP. Editing source changes
  freshness. Reader networking is disabled. Six packaged examples still compile
  and execute, and installed UI/catalog parity passes.
  Log: `/tmp/cossack-test-evidence-installed.log`.

Limits: a successful read is not a passing test result. All records cover selected
tests, not a complete suite. A matching snapshot excludes dependencies, generated
artifacts, secrets, environment and external services. Start-only records do not
prove a live runner. Local records are unauthenticated and tied to a project path.
Metadata redaction cannot recognize every possible secret. Storage has explicit
limits and manual cleanup; see [usage](../docs/test-results.md).
CLI-07 remains open for RT-28 snapshots/traces. CLI-08, REL-02 and REL-03 remain
open for their broader coverage. Checklist status stays 25 complete and 33 open.

<a id="codex-rt23-complete-2026-10-04"></a>
## Codex RT-23 completion audit (2026-10-04)

Author: Codex. RT-23 is complete against its original acceptance criteria. This
closes the DataTable/UI contract task, not CLI-08, REL-02 or REL-03. Release status
is now 25/58 complete, with 33 tasks open. Versions remain 0.8.3.

| Original requirement | Inspected evidence and result |
| --- | --- |
| Generated app filters/pages server data without incorrect selection loss | The generated fixture uses a real HTTP data backend, `server$`, URL state and client selection. Node and local workerd both pass copied-page SSR, hydration without duplicate reads, selection across pages/history/filtering, sorting, page sizes, empty data and refresh failure/retry. |
| Invalid column accessors fail type checks | Published-declaration fixtures reject nonexistent keys, invalid accessor properties and competing key/accessor declarations. Valid generic columns compile. The compiler fixture passes with checked `@ts-expect-error` cases. |
| Browser keyboard and focus behavior | Generated apps verify Space selection, paging/filter/retry focus and browser history. The standalone browser test adds keyboard sorting/paging, mixed/visible selection, off-page preservation and disabled boundary navigation. |
| Catalog states attributes, events and accessibility requirements | Shared CLI/MCP documentation reads installed declarations plus 39 authored UI guides. The current installed acceptance verifies DataTable, native targets/events, union branches and reviewed guide availability; SettingsPanel exact-symbol CLI/MCP parity passed before this audit. Native semantics and restrictions are authored, not inferred from export presence. |
| UI contract audit across the catalog | Inventory paths match all 65 component source files exactly. All 70 component/icon/block rows have reviewed contracts and linked evidence. Current public type fixtures and the latest 636-test UI suite retain their regressions. |

Fresh verification against the current source/build:

- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'integrates the DataTable' --maxWorkers=1`:
  2 pass (Node/workerd), 31 unrelated cases skipped; 28.34 seconds.
  Log: `/tmp/cossack-rt23-generated-final.log`.
- `pnpm --filter cossack exec vitest run tests/data-table-browser.test.js`:
  1 passes; 4.48 seconds. Log: `/tmp/cossack-rt23-browser-final.log`.
- `pnpm --filter @cossackframework/ui exec vitest run tests/data-table.test.ts tests/data-table-types.test.ts`:
  7 pass across 2 files. Log: `/tmp/cossack-rt23-types-final.log`.
- The immediately preceding [SettingsPanel checkpoint](#codex-settings-panel-2026-10-04)
  verifies the final UI build, 636 UI tests, root/all-package types and installed
  tarballs. No source or package guidance changed during this audit.
- Inventory/checklist paths and anchors were checked. Only RT-23 changes status.

Limits retained: generated runtime fixtures link workspace packages; installed
catalog/type/example acceptance is separate. Chromium evidence does not prove
other browser engines or assistive technologies. No live deployment or remote
readiness is claimed. These limits remain in the broader release gates rather
than being substituted for RT-23's original completion criteria.

<a id="codex-settings-panel-2026-10-04"></a>
## Codex SettingsPanel (2026-10-04)

Author: Codex. SettingsPanel now has closed native root props, readonly section
and row contracts, stable section IDs and panel-wide row keys, and explicit
controlled/default ownership. Text and switch values validate against their row
type. Local defaults are captured once; callback snapshots do not alias local
state. Controlled rejection restores native values even when props are unchanged.
The private state no longer collides with mirrored values props.

Native labels, names and hint descriptions are connected. Actions require labels
and callbacks, are always non-submit buttons, and use explicit destructive intent.
The root is a div with a focus fallback. Keyed controls retain identity; focus
repair waits for nested updates and respects focus outside the panel. The browser
regression caught focus loss when existing nodes moved.

Native form reset proposes the initial snapshot after the browser default action.
Prevented events do not reset state. Each event owns its pending callback, and
cleanup clears listeners/timers. Fresh-client acceptance exposed a missed listener
when the root arrived after onMount; root connection now also schedules setup.
Reset veto, repeated resets, controlled rejection and unmount cancellation pass.
The framework demo now uses the reviewed API and exposes harmless action feedback.
CLI source ejection imports the same public primitives/types.

Verification:

- UI build passes. `pnpm --filter @cossackframework/ui exec vitest run`: 636 tests
  across 46 files pass, including SSR defaults, invalid contracts, prototype-like
  keys, immutable public types and callback behavior.
- `pnpm --filter cossack exec vitest run tests/settings-panel-browser.test.js tests/ui-ejection.test.js`:
  45 tests pass (43 ejection checks plus published/ejected HTTP Chromium fixtures).
  Actual Tailwind, no-JavaScript SSR, retained hydration, fresh rendering, labels,
  descriptions, keyboard/label activation, native FormData, disabled controls,
  controlled acceptance/rejection, callback mutation/failure, reset/veto,
  reorder/removal focus, responsive sizing and cleanup/remounts are covered.
- `pnpm --filter @cossackframework/framework exec playwright test e2e/pages/settings-panel-block.spec.ts --workers=1 --reporter=line`:
  the actual controlled settings demo passes (5.0 seconds). The mobile layout
  assertion waits for the shell sidebar transition; inspection confirmed the
  settled layout fits. The owned Vite server was stopped afterward.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed controlled/default prop branches,
  readonly sections, native div targets and public row/value types are verified.
  The authored guide is discoverable; exact SettingsPanel CLI/MCP output matches.
  Six existing packaged examples compile and execute. Discovery disables Node
  networking; installation can use the registry. This guide adds no executable example.

Logs: `/tmp/cossack-settings-panel-{build,ui-full,browser-final,types-final,demo-final,dev,agent-docs}.log`.
All 65 component-source rows plus Icon and all four blocks now have reviewed
foundations. Next audit the original RT-23 acceptance against generated DataTable
and installed catalog evidence. Other-engine, assistive-technology and full runtime
release gates remain separate. RT-23 and CLI-07/CLI-08 remain open for that audit;
release status stays 24/58 complete and versions stay 0.8.3.

<a id="codex-dashboard-stat-2026-10-04"></a>
## Codex DashboardStat (2026-10-04)

Author: Codex. DashboardStat now renders a native list with definition pairs,
forwards typed root attributes/events, and keys readonly metrics by required
stable IDs. Empty/non-finite values and duplicate identities reject; zero remains
visible. Responsive columns and wrapping replace clipped text. The stray literal
template text is removed. Direction and favorable/unfavorable meaning are separate;
tone defaults to neutral, and explicit meaning has visible localized text.
The framework dashboard now uses this public block. CLI source ejection imports
public components and types.

The review also reproduced and fixed optional spread-class handling in renderer:
SSR merges `ifDefined` class text into template classes, and browser updates retain
component classes. The new regression failed before the fix. The browser fixture
now declares UTF-8, preventing corrupted non-ASCII text in its served HTML.

Verification:

- Renderer/UI builds pass. `pnpm --filter @cossackframework/renderer exec vitest run`:
  331 tests pass. `pnpm --filter @cossackframework/ui exec vitest run`: 618 tests
  across 45 files pass, including public type failures and metric validation.
- `pnpm --filter cossack exec vitest run tests/dashboard-stat-browser.test.js tests/ui-ejection.test.js`:
  44 tests pass (42 ejection checks and both published/ejected browser fixtures).
  SSR without JavaScript, retained hydration, native events/SVG, visible tone,
  light/dark colors, narrow layouts, optional class updates, keyed identity,
  reordering, empty lists and cleanup are covered.
- `pnpm --filter @cossackframework/framework exec playwright test e2e/pages/dashboard-stat-block.spec.ts --workers=1 --reporter=line`:
  the actual dashboard demo passes (7.1 seconds), including mobile/desktop columns
  and explicit meaning. The owned Vite server was stopped afterward.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes: installed readonly metrics, public trend/tone
  types, native list event targets and the authored guide are verified; exact
  DashboardStat CLI/MCP output matches. Six existing packaged examples compile
  and execute. Discovery disables Node networking; installation can use the
  registry. The new guide adds no executable example.

Logs: `/tmp/cossack-dashboard-stat-{renderer,ui-full,browser-final,types-final,rebuild,demo,dev,agent-docs}.log`.
All 65 component foundations plus Icon, AuthForm, CommandPalette and DashboardStat
are reviewed. SettingsPanel remains pending. Broader runtime, other-engine and
assistive-technology gates remain open. RT-23 and CLI-07/CLI-08 remain open;
release status stays 24/58 complete and versions stay 0.8.3.

<a id="codex-command-palette-2026-10-04"></a>
## Codex CommandPalette (2026-10-04)

Author: Codex. CommandPalette now composes the public Command primitive instead
of maintaining a second Modal, query loop and window shortcut handler. Required
identity/name/callbacks, readonly commands and separate controlled/default state
have closed types. Native attributes/events target the actual dialog. setOpen()
and toggle() propose changes; controlled callers must accept them through props.
Icons and hint text remain available. Hints are descriptions, not registered actions.

Command now supports grouped results and presentational item rendering with stable
option names/descriptions. Visual grouping and enabled keyboard order share one
filtered sequence. Blank group labels stay ungrouped. Search trims whitespace.
Stable IDs preserve highlight through updates; empty/disabled results stay safe.
Ctrl/Meta+K is opt-in. Closed palettes ignore editable controls unless opted in;
arbitration can choose a later eligible owner. Active modals retain precedence.
Existing native close/focus, callback and cleanup semantics remain shared.

Framework and Studio consumers supply explicit identity and names. The block demo
uses a named trigger so it does not compete with the shell's app-level shortcut.
Studio's trigger advertises the dialog and expanded state. A new CLI source-ejection
entry imports the same public primitive/types as the compiled block.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 597 tests
  across 44 files pass. SSR, grouping/filter order, immutable public types,
  descriptions and controlled/default contract failures are covered.
- `pnpm --filter cossack exec vitest run tests/command-palette-browser.test.js tests/command-browser.test.js tests/ui-ejection.test.js`:
  44 tests pass. Both published and ejected palettes run with actual Tailwind,
  HTTP Chromium and SVG artwork. Checks cover retained hydration, named groups,
  visible keyboard order, disabled items, filtering/reordering, pointer selection,
  controlled rejection, Escape veto, backdrop close, editor shortcuts, multiple
  owners, foreign modals, focus return, imperative methods and listener cleanup.
  The original Command browser suite also passes. Forty-one ejection checks include
  strict NodeNext imports. Browser bundles exclude the SSR parser.
- `pnpm --filter @cossackframework/framework exec playwright test e2e/pages/command-palette-block.spec.ts e2e/pages/home.spec.ts --grep 'composed command palette|opens the command palette' --workers=1 --reporter=line`:
  both real application tests pass (11.1 seconds). The block selects a grouped
  command and restores trigger focus; the shell still navigates to a demo. The
  owned Vite server was stopped afterward. Studio is type-checked; no new Studio
  backend/browser acceptance is claimed.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed declarations expose the two
  controlled/default branches, required identity/callbacks, readonly commands and
  native dialog targets. The authored block guide is discoverable; exact
  CommandPalette CLI/MCP output matches. Six existing packaged examples compile
  and execute. Discovery disables Node networking; installation can use the
  registry. This guide adds no executable example.

Logs: `/tmp/cossack-command-palette-{build,ui-final,browser-final,types-final,demo,dev,agent-docs}.log`.
All 65 component foundations plus Icon, AuthForm and CommandPalette are reviewed.
DashboardStat and SettingsPanel remain pending. Broader generated-app/runtime,
other-engine and assistive-technology gates remain open. RT-23 and CLI-07/CLI-08
remain open; release status stays 24/58 complete and versions stay 0.8.3.

<a id="codex-auth-form-2026-10-04"></a>
## Codex AuthForm (2026-10-04)

Author: Codex. AuthForm now has a stable required identity, closed native root/form
props, separate controlled/default modes, explicit credential/provider callbacks
and localized labels/errors. Both modes render on the server. Native field labels,
IDs, names and autocomplete are connected. Credentials stay in browser fields;
submission snapshots FormData, including pre-hydration typing and autofill without
input events. No credential values are copied into block reactive state.

The previous handoff incorrectly said PasswordInput's value/onChange props had
been removed; they still exist. AuthForm actually omitted its label ID. Review
also found PasswordInput wrote an empty value when value was omitted. It now
leaves native ownership intact, while parent-controlled values retain their
existing behavior. One composed spread preserves native attributes during fresh
client rendering. Dynamic noscript markup caused a hydration mismatch; a normal
pre-hydration notice now avoids it.

Actions stay disabled until hydration, while fields remain editable. Native POST
and unconditional submit-event prevention avoid accidental credential navigation.
Applications still own no-JavaScript endpoints, authentication, authorization,
sessions and server validation. Signup checks its configured minimum against the
snapshot as well as native attributes: adding minlength after a mode change does
not always invalidate existing values. Login imposes no new minimum policy.

Provider actions are explicit keyed non-submit controls and never send empty
credentials. One pending request disables actions and rejects duplicate submits.
Mode changes and onCleanup abort the owned signal and invalidate late results.
Callback errors remain observed; thrown messages are replaced with safe localized
text. Field errors have descriptions and focus recovery that respects outside
focus. Abort cannot stop ignored I/O or reverse backend effects.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 584 tests
  across 43 files pass. SSR, contract validation and published type failures cover
  identities, mode ownership, callbacks, providers, native targets and labels.
- `pnpm --filter cossack exec vitest run tests/auth-form-browser.test.js tests/ui-ejection.test.js tests/native-controls-browser.test.js tests/native-form-ssr-browser.test.js`:
  44 tests pass. AuthForm runs through published and ejected implementations with
  real Tailwind/HTTP Chromium. Checks include no-JavaScript action disabling,
  pre-hydration edits, native Enter/Space, password reveal, validation, FormData,
  repeated submits, safe errors, focus, external mode changes, provider identity,
  fieldset disabling, unmount/remount, stale results and eventless autofill.
  Existing parent-controlled PasswordInput and native SSR form checks also pass.
  Forty source-ejection checks include strict NodeNext compilation and AuthForm's
  new CLI entry. Ejected blocks use public primitive/type imports.
- Command-spec and command-contract suites passed in the earlier 114-case run;
  its one failing native-controls case was fixed and rerun in the final browser
  command above. No CLI contract failure was suppressed.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed declarations expose both mode
  branches, required callbacks, native targets and public helper types. The
  authored block guide is discoverable; exact AuthForm CLI/MCP output matches.
  Six existing packaged examples compile and execute. Discovery disables Node
  networking; installation can use the registry. No new executable guide example
  or backend authentication acceptance is claimed.

Logs: `/tmp/cossack-auth-form-{build,ui-final,browser-final,types-final,regressions,agent-docs}.log`.
All 65 component foundations plus Icon and AuthForm are reviewed. CommandPalette,
DashboardStat and SettingsPanel remain pending, along with wider generated-app,
backend/session, browser/assistive-technology and runtime gates. RT-23 and
CLI-07/CLI-08 remain open. Status stays 24/58 complete; versions remain 0.8.3.

<a id="codex-icon-2026-10-04"></a>
## Codex Icon (2026-10-04)

Author: Codex. Icon now binds closed native SVG props/events rather than building
attribute strings. `variant` selects artwork; `style` is native CSS. Required
trusted entries, positive finite size and informative/decorative names have
explicit contracts. Unknown variants and missing/empty artwork reject. A missing
variant may use own line artwork. Named icons use an SVG title, role and label;
interactive behavior remains on native parent controls. Framework/Studio callers
and repository skill examples now use direct entries and canonical variants.
Studio's unsupported bold-duotone selection becomes bold.

The renderer now parses raw children in SVG context, keeping HTML integration
points and inert script insertion. Fresh and updated artwork renders as actual
SVG paths. This does not sanitize trusted raw artwork. Review also found SSR class
merging failed to escape caller text and interpreted replacement dollar patterns.
It now escapes incoming class text once and preserves literal replacement text.
Icon's default fill also has one binding so caller fill survives SSR.

Verification:

- Renderer build and `pnpm --filter @cossackframework/renderer exec vitest run`:
  330 tests across 24 files pass. New regressions cover creation, hydration update,
  SVG/HTML namespaces and literal class quotes/entities/dollar patterns.
- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 568 tests
  across 42 files pass. Public declaration fixtures reject missing entries,
  invalid variants, competing geometry/naming and incorrect event targets.
- `pnpm --filter cossack exec vitest run tests/icon-browser.test.js tests/ui-ejection.test.js`:
  40 tests pass. The HTTP Chromium fixture covers no-JavaScript SSR escaping and
  naming, retained hydration, fresh and updated SVG path geometry, title namespaces,
  foreignObject HTML, inert scripts, native event targets, CSS updates and literal
  attribute payloads. Browser bundles exclude the SSR parser. The other 39 checks
  verify supported component source ejection and NodeNext imports. Icon remains a
  published import used by ejected consumers; no new standalone CLI icon recipe is claimed.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes: installed native SVG declarations and the
  authored guide are discoverable; exact-symbol Icon output matches CLI/MCP. Six
  existing packaged examples compile and execute. Discovery disables Node networking;
  installation can use the registry. The new guide adds no executable example.

Logs: `/tmp/cossack-icon-{renderer,renderer-build,ui,ui-build,browser,types,agent-docs,agent-docs-final}.log`.
Final UI/browser/type checks include the fill correction and no-JavaScript fixture.
All 65 component-source foundations plus Icon are reviewed. Four composed blocks,
other engines/assistive technologies and full generated-app/runtime acceptance
remain open. RT-23 and CLI-07/CLI-08 remain open; status stays 24/58 complete.

<a id="codex-message-scroller-2026-10-04"></a>
## Codex MessageScroller (2026-10-04)

Author: Codex. MessageScroller now requires stable identity and a named native
keyboard viewport. Root, viewport and jump-button props have public native types.
Caller handlers compose before internal updates. Initial following respects
existing browser focus/scrolling. Focusing message controls or reading history
pauses following; native scrolling near the bottom and explicit jumps resume it.

Visible direct child elements provide reading anchors across prepends, resizing,
streaming and late image sizes. A surviving visible sibling replaces a removed
anchor; complete replacement clamps the old offset. Geometry-driven scroll clamping
cannot silently resume following. Browser anchoring is disabled to avoid competing
adjustments. Keyed DOM identity matters; no word-level anchoring is claimed.

The correctly named latest-message button retains native disabled/veto/form behavior
and returns its focus to the viewport before disappearing. Removed/disabled message
controls recover focus, while keyed updates retain edits and focus. Explicit jumps
recover focus when they leave a child outside the visible area. Setup is deferred
until refs connect; cleanup cancels queued frames and disconnects observers.

Framework and generated Chat consumers now supply identity/names. The generated
Chat exposes streaming busy state and a short separate status region instead of a
live region around every token. Application authorization and announcement policy
remain caller-owned. Migration notes replace scrollRef/newMessageLabel with typed
viewport events, scrollToBottom() and jumpLabel.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 551 tests
  across 42 files pass. SSR and public types cover ownership, identity/naming,
  native targets, threshold validation, initial position and server safety.
- `pnpm --filter cossack exec vitest run tests/message-scroller-browser.test.js tests/ui-ejection.test.js`:
  40 tests pass, including 39 source-ejection checks and strict NodeNext compilation.
  The HTTP/Tailwind Chromium fixture covers no-JavaScript keyboard scrolling,
  pre-hydration editing/focus, retained hydration, appending/streaming, keyed
  prepends, delayed image sizing, resize/RTL, removed anchors, complete replacement,
  shrink/repopulate, native wheel/keyboard, caller veto/disabled actions, focused
  row removal, edits, explicit focus recovery, empty state and cleanup/remounts.
  Queued setup and scheduled-frame cleanup are exercised separately. Native
  observers are instrumented without replacing their behavior; only observers
  targeting the component count toward its resource lifetime.
- `pnpm --filter @cossackframework/framework exec playwright test e2e/pages/components-demo.spec.ts --grep 'chat components render' --workers=1 --reporter=line`:
  the real application test passes, including the final-source rerun. It exercises
  the named viewport, native Home scrolling and latest-message focus recovery.
  The first run waited on a local server probe; the final ready-server run took
  11.3 seconds. Both owned manual development servers were stopped afterward.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 113 tests across
  eight files pass, including actual generated Chat rendering with its named
  viewport, busy state and separate streaming status. This is not transport proof.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed catalogs expose required
  identity/name, root and target prop types, scroll options and the authored guide.
  Exact-symbol MessageScroller output matches across CLI/MCP. Six existing packaged
  examples compile and execute. Discovery disables Node networking; installation
  can use the registry. The new guide adds no executable example.

The first teardown assertion counted Playwright's document MutationObserver as a
component leak. Target inspection identified that observer; the corrected fixture
requires both component observers to disconnect and verifies fresh remount ownership.
Review also found browser scroll clamping could be mistaken for user intent; the
geometry guard and shrink/repopulate regression now preserve the paused state.

Logs: `/tmp/cossack-message-scroller-{build,ui,browser-ejection,scaffold,root-types,types,demo,demo-final,dev,agent-docs}.log`.
Other engines, assistive technologies, blocks/icons and the full generated-app/runtime
matrix remain open. All 65 component-source rows have reviewed foundations; Icon
and four composed blocks are still pending. RT-23 and CLI-07/CLI-08 are not complete;
the release retains all 58 tasks and 24 completed tasks.

<a id="codex-chat-display-2026-10-04"></a>
## Codex Bubble, Marker and Message (2026-10-04)

Author: Codex. These three display components now forward typed native div
attributes/events. Bubble reactions require localized text equivalents, accept
readonly records and validate nonnegative safe counts, including visible zero.
They render as a named native list with decorative emoji and readable text.
Wrapping reactions now take up normal layout space instead of overlapping the
next timestamp/message. Native child actions remain independent.

Bubble constrains its actual content box to 75% by default. Message owns an 80%
body and sets the bubble limit to 100% inside it, avoiding nested percentage
limits. Long words and metadata wrap; logical corners/alignment follow RTL.
Message preserves supplied name, time and avatar for both variants. Explicit
datetime plus display time produces a native time element; arbitrary time text
alone remains a span. Marker exposes its label and hides only decorative lines.
None adds automatic live-region semantics, keyboard actions or global resources.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 539 tests
  across 41 files pass. SSR and public declarations cover native targets,
  timestamp contracts, sent metadata, readonly labeled reactions, zero/invalid
  counts, variants, decorative content and retained native children.
- `pnpm --filter cossack exec vitest run tests/chat-display-browser.test.js tests/ui-ejection.test.js`:
  39 tests pass, including 38 source-ejection checks and strict NodeNext compilation.
  The real HTTP/Tailwind Chromium fixture checks no-JavaScript readable output,
  retained hydration, native event targets, Tab/Enter/Space/link behavior, no form
  submission, draft focus/value retention, reaction accessibility-tree text,
  timestamps, 12 wrapped reactions, RTL corners/avatar order, narrow layouts and
  standalone/composed width measurements with nested Attachment content.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 113 tests in eight
  files pass. The generated Chat render fixture executes its actual method with
  real UI/renderer components for sent, received, streaming and empty content.
  Translation, records and callbacks are fixture inputs; no transport/server
  acceptance is inferred from that render test.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed catalogs expose native div
  targets for all three components, readonly reactions, timestamp metadata,
  public reaction types and the authored guide. Exact-symbol Bubble results match
  across CLI/MCP. Six existing packaged examples compile and execute. Discovery
  disables Node networking; installation can use the registry. The new guide
  adds no executable example.

The first browser run exposed a failed nested width override: Tailwind arbitrary
selectors interpret unescaped underscores in the class name. Replacing that
selector with the inherited --cs-bubble-max-width contract fixes the measured
geometry. Package type checking also caught an incompatible constructor union in
a test; the test now uses individually typed factories without widening props.

Logs: `/tmp/cossack-chat-display-{build,ui,browser-ejection,scaffold,root-types,types,agent-docs}.log`.
Cross-browser/assistive-technology and full generated-app/runtime acceptance remain
open. Sixty-four of 65 UI source rows are reviewed. Continue MessageScroller,
then blocks/icons and the full matrix. RT-23 and CLI-07/CLI-08 remain open; the
release stays 24 of 58 complete, with all unchecked tasks still in scope.

<a id="codex-attachment-2026-10-04"></a>
## Codex Attachment (2026-10-04)

Author: Codex. Attachment now requires a filename and forwards separate typed
native root, removal-button and thumbnail props. Its public types replace the
ignored arbitrary signature. Positional children reject instead of disappearing.
Status colors use an explicit neutral/success/error variant; English status words
no longer select conflicting colors. Final-extension inference is case-insensitive
and guards inherited object properties; bare and hidden dot-only names use file.

Removal has a filename-specific default name and a localized override. The native
non-submit button supports keyboard activation, disabled props and fieldsets.
Native button callbacks run before onRemove and can veto it; callback-time disabling
also suppresses removal. The owning list removes records and restores focus. Root
bubbling handlers run after the button action. Decorative previews retain native
load/error behavior without inventing fallback/retry or upload operations.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 505 tests
  across 40 files pass. SSR and public declarations cover required filenames,
  native targets, explicit statuses, icon inference, validation, decoration,
  localized names, option consumption and unsupported children.
- `pnpm --filter cossack exec vitest run tests/attachment-browser.test.js tests/ui-ejection.test.js`:
  36 tests pass, including 35 source-ejection checks and strict NodeNext compilation.
  The HTTP/Tailwind Chromium fixture checks readable no-JavaScript output,
  retained hydration, actual root/button/image targets, Tab/Enter/Space, no form
  submission, native cancellation/directive behavior, disabled fields/buttons,
  localized names/status, actual image load/error, narrow/RTL layout, reduced
  motion, retained focus and parent-owned removal/focus recovery. Disabled
  synthetic dispatch separately verifies the handler guard; native keyboard
  checks prove disabled Tab exclusion. No global timers/listeners are introduced.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed catalogs expose the required
  filename, native div/button targets, public helper types, status variants and
  authored guide. Exact-symbol Attachment output matches across CLI/MCP. Six
  existing packaged examples compile and execute. Discovery disables Node
  networking; installation can use the registry. The new guide has no executable
  example.

The first checks caught fixture syntax and a structurally compatible DOM type in
an intended negative test. Both fixtures are corrected. The browser motion check
now accepts the shared theme's near-zero reduced-motion duration instead of
requiring literal zero. No failing behavior was hidden by changing the contract.

Logs: `/tmp/cossack-attachment-{build,ui,browser-ejection,root-types,types,agent-docs}.log`.
Other engines, assistive technology and the full generated-app/runtime matrix
remain open. Sixty-one of 65 UI source rows are reviewed. Continue Bubble,
Marker, Message and MessageScroller, then blocks/icons and the full matrix.
RT-23 and CLI-07/CLI-08 remain open; release status stays 24 of 58 complete.

<a id="codex-carousel-2026-10-04"></a>
## Codex Carousel (2026-10-04)

Author: Codex. Carousel now requires id, label and explicit named slides with
stable values. Public root, viewport and slide prop types replace the ignored
open signature. slideSize defaults to 100%; global and per-slide CSS sizes retain
compact layouts. The demo uses 12rem cards. Controls navigate real slide geometry
and use measured scroll boundaries, including when all content fits.

Native scrolling and tab order remain available without JavaScript. Hydration
adds named button controls, viewport-only keyboard navigation, RTL, settled change
notifications and announcements. Nested controls retain their own keys. Native
caller handlers run before internal updates, so a rerender cannot remove a
listener before its event is delivered. The browser test exposed this ordering
issue and now verifies actual targets and keyboard vetoes.

Focus navigation records its identity before deferred scroll events, preserving
selection across an immediate reorder. Keyed inputs retain identity and focus;
removed or disabled focused content recovers to the viewport. Geometry and
inherited direction changes retain the active anchor. Reduced motion uses instant
movement, rapid commands use the pending destination, and pointer/wheel input
interrupts pending animation. Cleanup releases observers/listeners and cancels
settlement timers and animation frames.

The [WAI carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/)
informs naming, group roles and retained control focus. This implementation keeps
native overflow content in reading/tab order and does not automatically rotate or
hide offscreen slides from assistive technology. The checkpoint does not establish
full pattern, assistive-technology or cross-browser acceptance.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 479 tests
  across 39 files pass. SSR and declarations cover native ownership, required
  identity/content/names, empty lists, compact/individual sizes, validation and
  browser-method safety during server rendering.
- `pnpm --filter cossack exec vitest run tests/carousel-browser.test.js tests/ui-ejection.test.js`:
  35 tests pass, including 34 source-ejection checks and strict NodeNext compilation.
  The HTTP/Tailwind Chromium fixture verifies no-JavaScript native tab/scroll
  behavior, retained hydration, real native event targets, no form submission,
  unavailable controls, viewport keys, nested controls, caller veto, direct and
  inherited RTL, resize, keyed reorder, removed/disabled focus, empty/repopulated
  lists, translated slide/empty labels without spurious value changes, native
  scrolling, full/compact/per-slide sizes, actual overflow boundaries,
  smooth/reduced-motion navigation, rapid requests and unmount/remount cleanup.
  Pointer/wheel cancellation uses synthetic browser events to interrupt pending
  movement; it is not a hardware gesture acceptance claim.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes against the final Carousel metadata fix.
  Installed catalogs expose required identity/slides, native targets, public slide
  and viewport types, sizing and authored guidance. Exact-symbol Carousel results
  match across CLI/MCP. Six existing packaged examples compile and execute.
  Discovery disables Node networking; installation can use the registry. The
  Carousel guide adds no executable example.

Logs: `/tmp/cossack-carousel-{build,ui,browser-ejection,root-types,types,agent-docs}.log`.
Sixty of 65 UI source rows are reviewed. Continue Attachment and the four remaining
chat rows, then blocks/icons and the full generated-app/runtime matrix. RT-23 and
CLI-07/CLI-08 remain open. Release status stays 24 of 58 complete; versions remain
0.8.3 until REL-04.

<a id="codex-toast-2026-10-04"></a>
## Codex Toast (2026-10-04)

Author: Codex. Toast writes and subscriptions now reject on the server before
changing module state or retaining listeners. The browser convenience API and
root-exported toastStore share one store. createToastStore supplies isolated,
bounded queues with frozen readonly snapshots, validated options, generated IDs,
explicit clear/dismiss/dispose operations and one presenter per store. Full queues
reject instead of evicting focused messages. A throwing subscriber does not
prevent other subscribers from receiving the committed update.

Timers start when a presenter connects. Hover, focus, window blur and hidden
state pause them with elapsed time preserved. Unmount cancels timers and clears
the queue; disposal also releases store subscriptions. Deferred setup waits for
refs to reach the live document, and cleanup cancels setup that has not run.
This fixes a hydration failure exposed by the first browser acceptance run.

Toaster now forwards typed native div props into a named region. Dismissal uses
native non-submit buttons and Escape, with focus recovery that skips disabled or
hidden candidates. New messages do not steal focus. A permanent polite announcer
replaces nested live regions; only added messages request announcements. Responsive
layout fits narrow viewports, and the theme disables animation for reduced motion.

The [W3C status-message technique](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22)
informs the permanent announcement container. Timer pause alone does not establish
accessibility compliance: use persistent messages, user timing preferences or
another persistent source of the information, as described in
[W3C timing guidance](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html).
Actual assistive-technology and cross-browser acceptance remain open.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 461 tests
  across 38 files pass. Coverage includes server-write/subscription rejection,
  isolated immutable snapshots, capacity and option validation, disposal,
  subscribers, IDs without cryptographic browser APIs, SSR, native props and public
  declaration failures.
- `pnpm --filter cossack exec vitest run tests/toast-browser.test.js tests/ui-ejection.test.js`:
  34 tests pass. Source ejection now compiles Toaster together with other reviewed
  controls under strict NodeNext. The HTTP/Tailwind Chromium fixture covers
  retained SSR hydration, one live announcer, responsive/reduced-motion layout,
  native button events, no form submission, keyboard/fallback focus, elapsed timer
  pause/resume, isolated queues, duplicate presenters, disposal, early cleanup,
  cleared timers after unmount and queued messages on remount. Focus and hover use
  real DOM actions; hidden-document/window events are synthetic timing checks.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed catalogs expose Toaster's native
  props, isolated-store types, public helpers and authored guide. Exact-symbol
  Toaster output matches across CLI/MCP. Six existing packaged examples compile
  and execute. Discovery disables Node networking; installation can use the
  registry. The new guide adds no executable example. The first run caught a
  missing guide summary; the corrected guide passes the schema, and acceptance
  now asserts guidance availability before inspecting individual guide entries.

Logs: `/tmp/cossack-toast-{build,ui,browser-ejection,root-types,types,agent-docs}.log`.
Fifty-nine of 65 UI source rows are reviewed. Continue Carousel, all remaining rows,
then blocks/icons and the full generated-app/runtime matrix. RT-23 and CLI-07/CLI-08
remain open. Release status stays 24 of 58 complete; versions remain 0.8.3 until REL-04.

<a id="codex-sidebar-2026-10-04"></a>
## Codex Sidebar (2026-10-04)

Author: Codex. Sidebar now requires a stable id and navigation label. Item values
provide globally unique identity across keyed groups and links. Public item,
link and nav prop types define native event targets. Root props reach the aside;
navProps reach the named nav. Native details/summary groups retain their own
optional destination and nested links. Active descendants open groups until the
user makes an explicit choice, including closing an active group.

The icon rail keeps nested navigation and accessible link names. Controlled
toggle callbacks propose the next boolean state. Native link handlers run first;
framework navigation handles only ordinary same-origin HTTP(S) clicks. Modifier,
new-tab, download, external and inherited base-target behavior stays native.
Offcanvas mode requires an external restoreFocusTo ID, returns contained focus
before hiding and makes closed content hidden/inert. It supplies no modal focus
trap. Keyed updates preserve focus or repair it to a reachable control.

Demo pages, the shared shell and generated dashboard use the new contract.
Migration notes cover required identity, prop ownership, group markup and callback
behavior. Sidebar item classes now use cs-sidebar__link at every nesting level.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 435 tests
  across 37 files pass. SSR and declaration tests cover identity, named native
  targets, group state, hidden content, invalid inputs and public prop branches.
- `pnpm --filter cossack exec vitest run tests/sidebar-browser.test.js tests/ui-ejection.test.js`:
  34 tests pass, including 33 source-ejection checks and strict NodeNext compilation.
  The final browser-only rerun also passes with a native accessibility-tree check.
  The HTTP/Tailwind fixture covers no-JavaScript disclosures and links, retained
  hydration, keyboard group controls, manual collapse, nested/reordered items,
  icon rail, RTL, native events, callback vetoes, modifier/new-tab/download/base
  target behavior, focus repair, offcanvas return/Tab exclusion and cleanup.
  Chromium exposes the named summary as DisclosureTriangle with expanded state.
- `pnpm --filter @cossackframework/framework exec playwright test e2e/pages/home.spec.ts --workers=1 --reporter=line`:
  all seven tests pass. These cover filtering, SPA links, command palette, desktop
  collapse, mobile dismissal and retained App-shell hydration on two routes.
  Old button selectors failed for native summaries; the tests now target summary
  elements and assert accessible naming instead of requiring a synthetic button role.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 112 tests across
  seven files pass. The dashboard test renders the real template with actual UI
  and renderer code. Stubbed module/account inputs do not prove full generated-app
  authentication or runtime integration.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed catalogs expose both Sidebar
  collapse-mode branches, required naming/identity, native targets, public item
  types and authored guidance. Exact-symbol Sidebar results match across CLI/MCP.
  Six existing packaged examples compile and execute. Discovery runs with Node
  networking disabled; installation can use the registry. The Sidebar guide adds
  no executable example.

Logs: `/tmp/cossack-sidebar-{build,ui,browser-ejection,browser-final,shell,scaffold,root-types,types,agent-docs}.log`.
Fifty-eight of 65 UI source rows are reviewed. Continue Toast, every pending row,
then blocks/icons and the full generated-app/runtime matrix. RT-23 and CLI-07/CLI-08
remain open. Release status stays 24 of 58 complete. Versions stay 0.8.3 until REL-04.

<a id="codex-resizable-2026-10-04"></a>
## Codex Resizable (2026-10-04)

Author: Codex. Resizable now requires a stable id, a primary-panel label and
explicit primary/secondary content. Typed root, panel and handle props replace
the ignored arbitrary attributes and ambiguous positional children. Public
ResizablePanelProps and ResizableHandleProps define native div targets while the
component owns IDs, separator values and its interaction handlers. The demo uses
two real panels and defaultSize instead of the ineffective defaultWidth prop.

Grid tracks divide available space after the handle. Defaults are captured once;
returning to 50 no longer resets the user's size. Controlled size changes require
caller acknowledgement of onSizeChange proposals. Finite numeric validation and
symmetric minSize bounds apply to both panels; minSize=50 disables resizing.

The separator exposes its primary-panel relationship, name, bounds, value and
perpendicular orientation. Keyboard controls cover axis arrows, RTL, Shift steps,
Home/End and Enter minimize/restore. An initially minimized panel restores to 50
when it has no larger previous value. At zero size, panel content is inert and
hidden from assistive technology; focus inside either collapsed panel moves to
the handle. The [WAI window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
informs these roles and relationships; this checkpoint does not claim full
assistive-technology or cross-browser acceptance.

Mouse/touch dragging uses primary-pointer capture. Pointer completion/cancellation,
lost capture, window blur, unmount, disabling, orientation/limit/ID changes and
synchronous callback failures release capture and the owned blur listener. Computed
text-direction changes cancel on the next pointer movement. Document cursor and
selection styles are untouched. Geometry is measured at drag start; applications
must not alter panel layout dimensions mid-drag. App callbacks own asynchronous
failures and external effects.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 413 tests
  in 36 files pass. Public declarations reject missing panels/names/IDs, wrong
  callback types, unsupported options and conflicting owned attributes. SSR covers
  panel relationships, bounds, defaults, styles, disabled/collapsed states and
  invalid numeric/semantic options.
- `pnpm --filter cossack exec vitest run tests/resizable-browser.test.js tests/ui-ejection.test.js`:
  33 tests pass, including 32 source-ejection checks and strict NodeNext compilation.
- A final browser-only rerun also passes after strengthening panel event-target,
  collapsed-focus and expected-error checks. The real Tailwind/UI HTTP fixture
  checks no-JavaScript layout, retained hydration, native events/child actions,
  percentages and handle geometry, controlled rejection/acceptance, stable defaults,
  keyboard/RTL/vertical movement, out-of-bounds drags, unrelated pointers, actual
  touch cancellation, disabled/fixed states, both collapsed endpoints, prop-change
  interruption, blur, synchronous callback failure, unmount/remount, preserved
  document styles and reduced motion. The browser graph excludes server parsers.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes: installed catalogs expose required panel
  props, native targets, the numeric callback, public prop types and the guide.
  Exact-symbol Resizable output matches across CLI/MCP. Six existing packaged
  examples compile and execute. Discovery uses a Node network guard; installation
  may use the registry. The new guide adds no executable example.

Logs: `/tmp/cossack-resizable-{build,ui,browser-ejection,browser-final,root-types,types,agent-docs}.log`.
Fifty-seven of 65 UI source rows are reviewed. Continue Sidebar and every pending
row, then blocks/icons and the full generated-app/runtime matrix. RT-23 and
CLI-07/CLI-08 remain open. Release status stays 24 of 58 complete and versions
stay 0.8.3 until REL-04.

<a id="codex-table-scroll-area-2026-10-04"></a>
## Codex Table and ScrollArea (2026-10-04)

Author: Codex. All six Table exports now declare native prop/event targets.
Top-level Table props reach HTMLTableElement; wrapperProps owns the overflow div.
The two section helpers target HTMLTableSectionElement, rows target
HTMLTableRowElement, and header/data cells target HTMLTableCellElement. Public
TableCellAttributes and TableHeadAttributes cover colspan, rowspan, headers and
header-only scope/abbr. Native captions and explicit sections compose through SSR,
hydration and fresh client rendering. Rows keep native child actions. The striped
flag now applies even-row colors, and row transitions respect reduced motion.

ScrollArea now renders one named region with a required label. Native attributes,
styles and scroll events target the actual viewport. Keyboard focus defaults to
zero; callers can opt out when they provide another keyboard path. Height accepts
nonnegative finite pixels or nonempty CSS strings. Authored styles follow generated
height/overflow styles. The demo, migration guide and packaged agent guidance match
the new contracts. The optional Table overflow wrapper example uses a named region
with tabindex=0, following [MDN overflow accessibility guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow#accessibility).

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 391 tests
  in 35 files pass. Public declarations cover all seven native component targets,
  wrapper events, closed cell attributes and required ScrollArea naming. SSR tests
  cover composition, sizing/style ownership and invalid semantic props.
- `pnpm --filter cossack exec vitest run tests/table-scroll-area-browser.test.js tests/ui-ejection.test.js`:
  32 tests pass, including 31 source-ejection checks with strict NodeNext compilation.
- The final browser-only rerun passes after strengthening named-wrapper and retained
  node checks. It uses real Tailwind/UI styling and HTTP-served SSR. No-JavaScript
  markup, captions/sections/cells, all event targets, stripes, dynamic updates,
  native child actions, keyboard scrolling in both axes, reduced motion and fresh
  rendering after unmount pass. Table, section, row, cell and viewport nodes survive
  hydration; no server parser module enters the browser graph.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes: installed declarations expose the seven
  controls, wrapper and cell contracts, and the guide; exact-symbol Table output
  matches across CLI/MCP. Six existing packaged examples compile and execute.
  Discovery runs with Node networking disabled; installation may use the registry.
  A final UI tarball content check also verifies the guide's clarified region-role
  wording, added after the installed acceptance run had packed its UI dependency.

Logs: `/tmp/cossack-table-{build,ui,browser-ejection,browser-final,root-types,types,agent-docs,guide-pack}.log`.
The new guide adds no executable example. Authors still own valid table content,
header relationships and CSS string validity. Other browser engines, assistive
technologies and the full generated-app/runtime matrix remain open.

Fifty-six of 65 UI source rows are reviewed. Continue Resizable, then Sidebar and
every pending row, followed by blocks/icons. RT-23 and CLI-07/CLI-08 remain open;
release status stays 24 of 58 complete. Versions stay 0.8.3 until REL-04.

<a id="codex-typography-item-2026-10-04"></a>
## Codex Typography and Item (2026-10-04)

Author: Codex. Typography now declares six native prop branches covering all
thirteen variants: paragraph, heading, quotation, ordered list, unordered list
and inline text. Quote/list-only attributes are explicitly excluded from the
other branches, including the optional default paragraph variant. Unsupported
variants reject at runtime. Native events target the actual rendered element.
QuoteAttributes and OrderedListAttributes are public.

Ordered-list marker styles now follow native type=1/a/A/i/I, including optional
ifDefined attributes. The themed browser fixture exposed that a CSS revert rule
restored decimal markers rather than the requested alphabetic markers, so explicit
marker classes map the five native types. Start and reversed remain native.

Item renames interactive to hoverable and makes the visual-only behavior explicit.
Typed native div props/events and renderer slots retain child links/actions. It
adds no pointer cursor, focus stop or button behavior. Reduced motion removes its
color transition. Boolean layout flags are validated and the demo is migrated.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 378 tests in
  34 files pass. Public declarations cover six native targets and reject attributes
  on incompatible variants; SSR covers all thirteen tags, consumed props, list/quote
  attributes, marker directives and invalid variants/flags.
- Source ejection: 29 tests pass, including strict NodeNext compilation of both
  controls with the previously reviewed components.
- `pnpm --filter cossack exec vitest run tests/typography-item-browser.test.js`
  passes. The real Tailwind/UI theme fixture checks no-JavaScript headings and
  links, retained hydration, all thirteen tags/event targets, all five ordered-list
  marker types, quote metadata, native Tab/Enter/link and child-action behavior,
  no accidental submission, variant updates, padding/borders, reduced motion and
  unmount/remount cleanup.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose the guide,
  all six Typography prop branches, the new public native attribute types and
  identical exact-symbol Typography output. Six existing packaged examples
  compile and execute; discovery runs with Node networking disabled.

The [HTML ordered-list definition](https://html.spec.whatwg.org/multipage/grouping-content.html#the-ol-element)
and [CSS revert behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/revert)
inform marker ownership. Callers retain native content-model and document-outline
responsibilities. The new guide adds no executable example; other engines,
screen readers and the full generated-app/runtime matrix remain open.

Logs: `/tmp/cossack-typography-{build,ui,browser-ejection,browser-final,root-types,types,agent-docs}.log`.
The combined browser/ejection log retains a corrected fixture-reference failure;
the final browser log records its passing rerun. Fifty-four of 65 component-source
foundations are reviewed. Continue Table, ScrollArea and every pending row.
RT-23 and CLI-07/CLI-08 remain open. Release status stays 24 of 58 complete and
versions stay 0.8.3 until REL-04.

<a id="codex-avatar-2026-10-04"></a>
## Codex Avatar and AvatarGroup (2026-10-04)

Author: Codex. Avatar requires explicit alternative text and keeps a meaningful
name on its span through image/fallback states. Empty alternative text hides
decorative content. Native span events and image load/error callbacks have separate
typed targets. Generated sizing composes with native styles. Size and shape are
validated; initials handle Unicode code points and whitespace-separated names.

Source changes create a new request identity and image node. Failure no longer
sticks to later URLs, including returning to a previously failed URL. Old node
events cannot change the current image. A queued complete/naturalWidth check covers
failures before hydration; it does not synthesize missed native callbacks. Cleanup
invalidates queued checks. Without JavaScript, network-error initials remain
unavailable, while the server-rendered accessible name remains present.

AvatarGroup requires a name, readonly items and stable unique item values. Native
root props now forward. Keyed reordering retains avatar DOM/state. Validated
nonnegative overlap uses logical margins for RTL and row-reverse. Nonnegative max
includes zero; overflow has localizable count text and no implicit interaction.
The demo and Avatar examples use the new naming/identity contracts.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 358 tests in
  33 files pass. Public declarations check required names/keys, readonly arrays,
  span/group/image event targets and owned accessibility attributes. SSR checks
  names, decorative content, native styles, request recovery and invalid values.
- `pnpm --filter cossack exec vitest run tests/avatar-browser.test.js tests/ui-ejection.test.js`:
  28 tests pass (27 source-ejection cases and one themed production Chromium case).
  Browser checks include no-JavaScript names, retained hydration, verified cached
  failure before hydration, actual bad/good image responses, repeated URL recovery,
  stale-node errors, native image callbacks, fallback names, native Tab and events,
  keyed reorder, all four RTL/reverse combinations, zero/empty groups and cleanup.
  Source ejection compiles both controls with strict NodeNext settings.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose the guide,
  required alt text, separate span/image callback targets and identical exact-symbol
  Avatar output. Six existing packaged examples compile and execute; discovery
  runs with Node networking disabled.
- The final avatar browser rerun also asserts stale errors do not invoke callbacks
  and immediate unmount after a source change invalidates pending checks.

The WAI guidance on [informative images](https://www.w3.org/WAI/tutorials/images/informative/)
and [decorative images](https://www.w3.org/WAI/tutorials/images/decorative/) informs
the naming contract. The new guide adds no executable example. Other browsers,
screen readers, full generated-app integration and the runtime matrix remain open.

Logs: `/tmp/cossack-avatar-{build,ui,browser-ejection,browser-final,root-types,types,agent-docs}.log`.
Fifty-two of 65 component-source foundations are reviewed. Continue Item, Typography
and every pending row. RT-23 and CLI-07/CLI-08 remain open. Release status stays 24 of 58 complete and
versions stay 0.8.3 until REL-04.

<a id="codex-field-empty-2026-10-04"></a>
## Codex Field and Empty (2026-10-04)

Author: Codex. Field now requires a label, unique control target and typed control
callback. The callback receives the native control ID, required flag, linked hint
and error descriptions, and invalid state. Both nonempty hint and error text remain
visible, with stable IDs. The callback spreads those attributes onto the actual
control; the wrapper does not inspect or mutate child DOM. Native value/events,
validation and form behavior remain with the caller. Separate control children are
rejected with a migration diagnostic. The required marker is decorative.

All 22 framework/scaffold consumers use the callback. This also fixes missing
native input IDs on scaffolded password fields. Empty now forwards typed div
attributes/events instead of discarding them. Its title/description remain visible
text and native child buttons/links retain their behavior. Migration and installed
guidance describe ownership, description merging and limits.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 340 tests in
  32 files pass, including public callback inference, native targets, SSR links,
  rejected contracts and a composed password input.
- Source ejection: 25 tests pass, including strict NodeNext compilation of Field
  and Empty with previously reviewed controls.
- `pnpm --filter cossack exec vitest run tests/field-empty-browser.test.js` passes.
  The themed production Chromium fixture covers SSR without JavaScript, retained
  hydration, labels/descriptions, native Tab/Enter, password reveal, native
  validation and FormData, focus-preserving error updates, removal of stale
  attributes/description nodes, disabled fieldsets, native child links/actions,
  changed IDs and unmount/remount cleanup. The initial test selected label text
  without accounting for its visual required marker; the final check clicks the
  actual label and separately verifies its accessible name.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 111 tests pass.
  A new case renders the generated login method with the real renderer/UI and
  checks both email and password label/error links, then error clearing. Its auth
  submission boundary is not exercised by this focused composition test.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose the new guide,
  Field's required label/target/control callback, both native div event targets
  and identical exact-symbol Field output. Six existing packaged examples compile
  and execute. Discovery runs with Node networking disabled.

The WAI guidance on [control labels](https://www.w3.org/WAI/tutorials/forms/labels/)
and [inline feedback](https://www.w3.org/WAI/tutorials/forms/notifications/) informs
the relationships. Neither component adds focus management or automatic error
announcements. The new guide adds no executable example; other browser engines,
screen readers and the full generated-app/runtime matrix remain separate gates.

Logs: `/tmp/cossack-field-{build,ui,browser-ejection,browser-final,root-types,types,scaffold,agent-docs}.log`.
The combined browser/ejection log retains the earlier label-selector failure;
the final browser log records its passing rerun. Fifty of 65 component-source
foundations are reviewed. Continue Avatar, AvatarGroup and every pending row.
RT-23 and CLI-07/CLI-08 remain open. Release status stays 24 of 58 complete;
versions stay 0.8.3 until REL-04.

<a id="codex-status-controls-2026-10-04"></a>
## Codex Alert, Progress and Spinner (2026-10-04)

Author: Codex. Alert has typed native div props and explicit assertive, polite and
static announcement modes. Its existing default remains assertive; static demo
callouts select off. Icons remain decorative and the example no longer passes an
unsupported string icon name. Announcement changes preserve focus.

Progress requires a name and distinguishes unknown progress (omitted/null value)
from determinate zero. Unknown progress omits aria-valuenow. Finite values clamp to
the range; invalid values/maxima now reject instead of silently falling back.
valueText supplies an optional human-readable value. Only unknown progress shimmers;
reduced motion removes shimmer and width transitions. Dashboard/demo consumers now
supply names. The component owns range attributes and adds no keyboard interaction.

Spinner retains its SVG root with typed SVGSVGElement callbacks. Public SvgAttributes
exclude HTML-only props; Spinner owns geometry, focusability and status semantics.
It validates positive size/stroke, ordering and representable geometry. Decorative
and labelled states switch without stale attributes. The SVG title stays inside the
root template: a separately parsed HTML title template left interpolation markers
as text, which the browser regression caught. Reduced motion stops rotation.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 330 tests in
  31 files pass, including public declarations, SSR, rejected contracts and ranges.
- `pnpm --filter cossack exec vitest run tests/status-controls-browser.test.js tests/ui-ejection.test.js`:
  24 tests pass (23 source-ejection cases and one themed production Chromium case).
  Browser coverage includes no-JavaScript semantics, retained hydration, native Tab
  and Enter, focus-preserving updates, unknown/determinate progress, clamping,
  SVG namespace/title/currentTarget, stale-attribute removal, reduced motion and
  unmount/remount cleanup. Geometry checks use layout width, not a rotating bounding
  box. Ejected sources compile with strict NodeNext settings.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` configurations pass.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose native-status,
  the required Progress label, all three native event targets and identical
  exact-symbol Spinner output. The six existing packaged examples compile and
  execute. Discovery runs with Node networking disabled.

The [ARIA role definitions](https://www.w3.org/TR/wai-aria-1.2/#progressbar) and
[alert guidance](https://www.w3.org/WAI/ARIA/apg/patterns/alert/) inform these contracts.
Browser semantics do not prove screen-reader speech delivery; other engines,
assistive technologies, generated-app integration and the full release matrix
remain open. The new native-status guide adds no executable example.

Logs: `/tmp/cossack-status-{build,ui,browser-ejection,root-types,types,agent-docs}.log`.
Forty-eight of 65 component-source foundations are reviewed. Continue Field, Empty
and every pending row. RT-23 and CLI-07/CLI-08 remain open. The release stays 24 of
58 complete and package versions remain 0.8.3 until REL-04.

<a id="codex-display-controls-2026-10-04"></a>
## Codex Skeleton, Card, Badge and Kbd (2026-10-04)

Author: Codex. Skeleton now has a visible default line height, pixel/CSS dimensions,
and separate rectangle and circle contracts. Circle size controls both dimensions.
Native styles, including `ifDefined`, compose with generated sizing. Skeleton stays
decorative, excludes focus attributes from its public contract and disables pulse
animation for reduced motion. Loading announcements belong to the containing region.

Card renames `interactive` to `hoverable`: the option provides a visual effect,
while native child controls own actions and keyboard behavior. All four Card exports
have typed div attributes/events. Root padding and slot padding are documented
separately; the composite demo uses no root padding. Removing the legacy unlayered
Card transition rule lets its hover and reduced-motion classes take effect.
Badge validates variants and forwards native span props. Kbd describes keys using
native kbd markup and does not install shortcuts. Migration and packaged guidance
cover all seven exports.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 313 tests in
  30 files pass. Public types cover all seven native event targets and reject
  competing Skeleton dimensions, focus/hidden overrides and obsolete Card props.
- Source ejection: 20 tests pass, including strict NodeNext compilation of the
  four sources with previously reviewed controls.
- `pnpm --filter cossack exec vitest run tests/display-controls-browser.test.js`
  passes after correcting native style composition and the legacy transition
  override found by the browser fixture. It covers SSR without JavaScript,
  retained hydration, dimensions, slot padding, native Tab/Enter/link behavior,
  event targets, updates, reduced motion and unmount/remount cleanup. The fixture
  builds the actual Tailwind/UI theme and checks browser bundles exclude parse5.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` package configurations pass.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose the native-display
  guide and identical exact-symbol Skeleton output, including both shape variants.
  All seven native event targets and the new public types are checked. Discovery
  runs with Node networking disabled; six existing packaged examples compile and
  execute. The display guide adds no executable example.

Logs: `/tmp/cossack-display-{build,ui,browser-ejection,browser-final,root-types,types,agent-docs}.log`.
The combined browser/ejection log retains the earlier browser failure; the final
browser log records its passing rerun. Other browser engines, assistive technologies,
generated-app integration and the full release matrix remain separate gates.
Forty-five of 65 component-source foundations are reviewed. Continue Alert, Progress,
Spinner and every pending audit row. RT-23 and CLI-07/CLI-08 remain open; release
status stays 24 of 58 complete. Versions remain 0.8.3 until REL-04.

<a id="codex-layout-controls-2026-10-04"></a>
## Codex ButtonGroup, Separator and AspectRatio (2026-10-04)

Author: Codex. ButtonGroup now requires a name and forwards typed native div
attributes/events without leaking component props. New base CSS implements its
previously claimed joined borders for direct native buttons/anchors. Logical
corners/margins support horizontal, vertical and RTL layout. Focused controls
are raised above neighboring borders. The group adds no keyboard or selection
behavior and preserves child types, disabled state, actions and form semantics.
The components, localization and HTTP counter demos provide group names.

Separator distinguishes horizontal HTMLHRElement and vertical HTMLDivElement
attribute/event contracts. Decorative dividers use textual aria-hidden=true;
false omits it. Decorative vertical dividers omit semantic role/orientation.
Static separator ownership excludes focusable splitter attributes. Horizontal
lines no longer combine a native border with the requested one-pixel height.

AspectRatio forwards native props to an outer div and rejects nonpositive or
nonfinite ratios. An inner CSS aspect-ratio box sizes against its actual available
width, replacing percentage padding based on the containing block. Native wrapper
styles remain separate from ratio sizing. An absolute content layer fills the box.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 301 tests in 29 files pass.
  Public declarations verify group naming, owned attributes, orientation-specific
  separator event targets and native wrappers. SSR checks semantic/decorative
  attributes, consumed props, ratio styles and invalid contracts.
- Source ejection: 16 tests pass, including strict NodeNext compilation of all
  three controls with the previously reviewed navigation/menu components.
- `pnpm --filter cossack exec vitest run tests/layout-controls-browser.test.js`:
  the final themed production Chromium fixture passes. It covers retained
  hydration, no-JavaScript layout, joined borders, RTL/vertical changes, focus-ring
  stacking, native Tab/Enter/Space, disabled fieldsets, native child links, semantic
  versus decorative separator exposure, event targets, ratio resizing, no unwanted
  form submission and unmount/remount behavior. One-pixel separator event forwarding
  uses native element.click(); geometry is checked separately rather than relying
  on a fractional-pixel pointer target.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` package configurations pass.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose the native-layout
  guide and identical exact-symbol Separator output with both native orientation
  variants. Discovery runs with Node networking disabled. All six existing
  packaged examples compile and execute.

The [ARIA separator definition](https://www.w3.org/TR/wai-aria-1.2/#separator)
and [CSS aspect-ratio specification](https://www.w3.org/TR/css-sizing-4/#aspect-ratio)
inform these contracts. The guide adds no executable example. Other browser engines,
assistive technologies and the full release matrix remain open.

Logs: `/tmp/cossack-layout-{build,ui,browser-ejection,browser-final,root-types,types,agent-docs}.log`.
Forty-one of 65 component-source foundations are reviewed. Continue Skeleton,
Card (including all its slot exports), Badge, Kbd and every pending audit row.
RT-23 and CLI-07/CLI-08 remain open; the release remains 24 of 58 complete and
versions stay at 0.8.3 until REL-04.

<a id="codex-breadcrumb-2026-10-04"></a>
## Codex Breadcrumb (2026-10-04)

Author: Codex. Breadcrumb now forwards typed attributes/events to its native
navigation, ordered list, links and text items. Readonly items require stable
values and accessible names. Rich labels require ariaLabel; nonlinked rich labels
use hidden visual content plus screen-reader text rather than naming a generic
span. Decorative separators are hidden from the accessibility tree.

The final item has aria-current=page and preserves a supplied native href.
Unlinked items remain text. Links retain Tab/Shift+Tab, Enter, native callback
veto, modifiers and new tabs. Keyed reordering preserves focus. Removing a focused
link or converting it to text falls back to a remaining visible link or root;
updates preserve outside focus. Cleanup invalidates queued focus repair.
The demo and scaffold blog layout now provide stable values. The blog imports
BreadcrumbItem and keeps translated names separate from path-based identity.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 289 tests in 28 files pass.
  Public types cover each native event target and reject missing identities/names,
  competing current-page attributes and mixed link/text targets. SSR covers
  readonly items, linked/plain current pages, rich names, empty trails, separators
  and invalid values, including explicitly null accessible names.
- `pnpm --filter cossack exec vitest run tests/breadcrumb-browser.test.js tests/ui-ejection.test.js`:
  14 tests in two files pass. The themed production browser covers retained
  hydration, JavaScript-disabled links, native Tab/Enter, modified navigation,
  callback targets/vetoes, RTL reordering, link removal/conversion, outside focus,
  empty updates, accessibility snapshots and cleanup/remounting. Ejected source
  passes strict NodeNext compilation with the other reviewed menu/navigation controls.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` package configurations pass.
- Scaffold recipe suite: 110 tests in five files pass after the blog-layout update.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose the same exact-symbol
  Breadcrumb contract and native-breadcrumb guide with Node networking disabled
  during discovery. All six existing packaged examples compile and execute.

The [W3C breadcrumb pattern](https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/)
informs the landmark and current-page semantics. The guide adds no executable
example. Other browser engines, assistive technologies, generated-app navigation
and the full release matrix remain open.

Logs: `/tmp/cossack-breadcrumb-{build,ui,browser-ejection,root-types,types,scaffold,agent-docs}.log`.
Thirty-eight of 65 component-source foundations are reviewed. Continue ButtonGroup,
then Separator, AspectRatio and every pending audit row. RT-23 and CLI-07/CLI-08
remain open. The release stays at 24 of 58 complete, with versions at 0.8.3 until REL-04.

<a id="codex-pagination-2026-10-04"></a>
## Codex Pagination and union prop catalogs (2026-10-04)

Author: Codex. Pagination now has distinct controlled-button and native-link
contracts. Button mode requires onPageChange; link mode requires href(page).
Closed types separate root HTMLElement, button and anchor attributes/events.
Labels are localizable, native callbacks can veto activation, button controls do
not submit forms, and URL links preserve modifiers and new tabs. The demo updates
controlled state; scaffold users/roles lists now render native URLs.

Page/count inputs require safe integers. Empty counts disable the edge controls,
stale pages display the last available page without emitting changes, and a bounded
sliding window avoids allocation proportional to the count. Keyed controls retain
focus as that window changes. Removed/disabled focused controls fall back to the
current page, an enabled control or the root; outside focus is preserved. Native
fieldsets disable buttons. Link mode requires the explicit disabled prop because
fieldsets do not disable anchors. Disabled links omit URLs and leave Tab order.

Installed verification exposed a documentation limitation: union prop contracts
listed only common fields. That makes Pagination's href and onPageChange both
appear optional while hiding that one is required and the other forbidden.
The declaration index now adds variants with each branch's members, requiredness,
callback signatures and index contracts. Union status remains partial; unknown
branches remain explicit. Tests also cover discriminated props and template-key
index signatures. CLI/MCP and packaged guidance explain the distinction.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 276 tests in 27 files pass.
  Public declarations reject mixed navigation modes, missing callbacks/URLs and
  competing owned attributes. SSR covers labels, native targets, gaps, empty/stale
  counts, invalid inputs and bounded rendering at Number.MAX_SAFE_INTEGER.
- `pnpm --filter cossack exec vitest run tests/pagination-browser.test.js tests/ui-ejection.test.js`:
  13 tests in two files pass, including strict NodeNext ejected-source compilation.
  The themed production browser verifies retained hydration, native Tab, controlled
  acceptance/rejection, callback veto, no duplicate current-page proposals, shifting
  windows, focus recovery, disabled fields/links, native and modified URL navigation,
  no form submission and cleanup/remounting. A final browser run adds SSR link
  navigation with JavaScript disabled and passes.
- `pnpm --filter cossack exec vitest run tests/declaration-index.test.js tests/documentation.test.js`:
  26 tests in two files pass for the catalog change.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` package configurations pass.
- Scaffold recipe suite: 110 tests in five files pass after the users/roles changes.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose identical Pagination
  contracts, both required/forbidden prop variants and the native-pagination guide.
  Discovery runs with Node networking disabled; all six existing packaged examples
  compile and execute. The initial union-status failure remains recorded locally.

Logs: `/tmp/cossack-pagination-{build,ui,browser-ejection,browser-final,catalog,root-types,types,scaffold,agent-docs}.log`.
Initial installed failure: `/tmp/cossack-pagination-agent-docs-union-regression.log`.
The guide adds no executable example. Other browser engines, assistive technologies,
generated-app integration and the full release matrix remain open. Thirty-seven
of 65 component-source foundations are reviewed. Continue Breadcrumb and every
pending audit row. RT-23 and CLI-07/CLI-08 remain open. The release is still 24 of
58 complete, with versions at 0.8.3 until REL-04.

<a id="codex-navigation-menu-2026-10-04"></a>
## Codex NavigationMenu (2026-10-04)

Author: Codex. NavigationMenu now requires an instance ID, landmark name and
stable section/link values. Readonly sections and links have closed native
root/button/panel/anchor attribute contracts. AnchorAttributes preserves native
link options. The demo and scaffold public layout use stable identities across
translated labels. Open state belongs to native popovers; global index IDs,
document-wide lookups and the public activeSection index are removed.

Hover preserves keyboard focus and cannot dismiss another focused popup.
Both modes support click, Enter/Space and disclosure arrow navigation. Native
Tab follows buttons and visible links. Pointer travel, delayed opening/closing,
Escape cancellation, touch, outside focus and disabled fieldsets have explicit
behavior. Keyed updates recover focus after link/section removal. Panels flip,
clamp and scroll within the viewport. Cleanup cancels timers and deferred setup.

The Chromium fixture found and now covers three regressions: authored autofocus
triggered blur dismissal while opening; a focusout microtask hid the next native
Tab target before focusin; and a second touch activation dismissed then reopened
the panel. Internal focus restoration is guarded, focusout respects relatedTarget,
and native popovertarget relationships prevent trigger taps from light-dismissal
before the owned click handler. Modified links retain browser new-tab behavior.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 252 tests in 26 files pass.
- `pnpm --filter cossack exec vitest run tests/navigation-menu-browser.test.js tests/ui-ejection.test.js`:
  12 tests in two files pass, including themed production Chromium and strict
  NodeNext compilation of ejected NavigationMenu with existing menu/disclosure sources.
  Browser coverage includes SSR relationships, retained hydration, focus-preserving
  hover/autofocus, native Tab, event vetoes, link navigation, touch toggling, RTL,
  dynamic links/sections, empty fallbacks, disabled fieldsets, viewport bounds,
  unmount during pending timers and remount before deferred connection.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` package configurations pass.
- Scaffold recipe suite: 110 tests in five files pass after the public-layout update.
- `pnpm test:agent-docs:local` passes. Installed CLI/MCP expose the same exact-symbol
  NavigationMenu contract and native-navigation guide with Node networking disabled
  during discovery. All six existing packaged examples compile and execute.

The [W3C disclosure-navigation pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/)
and [HTML popover behavior](https://html.spec.whatwg.org/multipage/popover.html)
inform the contract. This is site navigation with native links, not an application
menu. The new guide adds no executable example. Other browser engines, assistive
technologies, generated-app integration and the full release matrix remain open.

Logs: `/tmp/cossack-navigation-{build,ui,browser-ejection,root-types,types,scaffold,agent-docs}.log`.
Thirty-six of 65 component-source foundations are reviewed. Continue Pagination,
then every pending UI row. RT-23 and CLI-07/CLI-08 remain open; the release remains
24 of 58 complete, with versions at 0.8.3 until REL-04.

<a id="codex-menubar-2026-10-04"></a>
## Codex Menubar (2026-10-04)

Author: Codex. Menubar now has a required instance ID and name, readonly typed
menus/actions and separate native root, trigger and panel attribute contracts.
Stable menu values identify keyed sections and encoded relationships. Local refs
replace global index-based IDs and document lookups. The demo uses the new API.

The shared MenuController supplies action navigation, typeahead, disabled-action
guards, dismissal, viewport bounds and cleanup. Menubar adds roving trigger focus,
RTL navigation, adjacent-menu movement and switching by pointer while open.
Disabled menus/actions remain focusable but cannot activate. Native fieldsets apply.
Trigger, panel and root handlers retain their declared native event targets.
Native click/key callbacks can veto the corresponding internal behavior.

Keyed reordering preserves open-menu focus. Removing a menu repairs focus to a
remaining trigger or the root. A new browser regression exposed focus moving to
the trigger when a focused action disappeared from an open menu. Recovery now stays
inside that menu on its first remaining action or empty-panel fallback. Actions
that move focus outside retain that focus. Cleanup cancels deferred setup and
releases the shared controller's listeners and observers.

Source ejection now includes the private menu helper. A compiler-backed import
merge removes duplicate named bindings after helpers are included. Ejected Menubar,
DropdownMenu, ContextMenu, Accordion and Collapsible sources pass strict NodeNext
compilation against public package declarations. The pinned compiler API remains
inside the Node-only CLI package.

Verification:

- UI build and `pnpm --filter @cossackframework/ui exec vitest run`: 242 tests in 25 files pass.
- `pnpm --filter cossack exec vitest run tests/menubar-browser.test.js tests/menu-controls-browser.test.js tests/ui-ejection.test.js`:
  12 tests pass across three files. The themed browser coverage includes SSR and
  retained hydration, instance isolation, first/last opening, key and action veto,
  disabled focus/activation, typeahead, RTL, adjacent menus, Escape/Tab exit,
  outside focus, menu/action removal, open-menu reordering, inherited fieldsets,
  all-disabled/empty updates, viewport bounds and cleanup/remounting.
- Root `pnpm tsc --noEmit` and all 11 `pnpm typecheck` package configurations pass.
- `pnpm test:agent-docs:local` passes installed native prop contracts, packaged
  guidance and exact Menubar CLI/MCP parity with Node networking disabled during
  discovery. All six existing packaged examples compile and execute. This UI guide
  adds no executable example; installation can use the registry.
- The final `tests/menubar-browser.test.js` run also passes empty-panel focus,
  trigger/panel vetoes with native targets and closed/open hover behavior.

Logs: `/tmp/cossack-menubar-{build,ui,browser-ejection,browser-final,root-types,types,agent-docs}.log`.
The failed-before removed-action case is recorded in
`/tmp/cossack-menubar-focus-regression.log`.

The keyboard model follows the [W3C menubar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/).
The packaged guide and migration notes explain names, identities, callbacks,
focus and native attribute ownership. Nested submenus, menu checkboxes/radios,
other browser engines and assistive-technology acceptance are not claimed here.
Thirty-five UI foundations are reviewed. RT-23 and CLI-08 remain open. Continue
NavigationMenu and all pending audit rows. The release retains 24 completed tasks
and 34 open tasks. Versions remain 0.8.3 until REL-04.

<a id="codex-toggles-2026-10-04"></a>
## Codex Toggle and ToggleGroup (2026-10-04)

Author: Codex. Toggle now consumes its state props, forwards typed native button
attributes/events and owns pressed semantics. Controlled values require parent
acceptance. Defaults are captured once; native click handlers can veto activation.

ToggleGroup now has a named root and readonly typed items. Single and multiple
modes have distinct value and callback contracts. Single selection can clear to an
empty string. Multiple callbacks receive independent arrays and preserve disabled
and unknown selected values. SSR uses actual selection. Defaults are captured on
the first render, even when items arrive later. The empty-list regression failed
before the fix and passes afterward.

Native buttons use pressed semantics and never submit forms. Roving focus supports
RTL, vertical navigation, Home/End and disabled skipping without selecting on focus.
Keyed updates retain focus; removal/disabling repairs it without stealing outside
focus. ResizeObserver tracks the indicator, and cleanup cancels deferred setup.

The public type fixture exposed lost callback inference when a default union mode
was passed through the optional `component()` props parameter. A supplied-props
overload restores inference while retaining omitted/undefined props support.
Type fixtures reject scalar/array confusion, missing names and owned button props.

Verification:

- `pnpm --filter @cossackframework/ui exec vitest run`: 236 tests in 24 files pass.
- `pnpm --filter @cossackframework/renderer exec vitest run`: 326 tests in 23 files pass.
- `pnpm --filter cossack exec vitest run tests/toggles-browser.test.js tests/ui-ejection.test.js`:
  themed Chromium plus six source-ejection cases pass. Browser cases cover retained
  SSR/hydration, controlled rejection/acceptance, native callback veto, Enter/Space,
  RTL/vertical/Home/End navigation, readonly inputs, callback mutation isolation,
  fieldsets, keyed removal/reorder focus, indicator resize, reduced motion and
  cleanup/remounting. The final run also covers items arriving after the first render.
- Root `pnpm tsc --noEmit` and `pnpm typecheck` across all 11 package configurations pass.
- `pnpm test:agent-docs:local` passes on the final source. Installed CLI/MCP
  catalogs agree on exact ToggleGroup discovery, typed native prop contracts and
  the new guide. All six existing packaged examples compile and execute.
  Discovery disables Node networking; package installation can use the registry.

Logs: `/tmp/cossack-toggles-{ui,renderer,browser-ejection,root-types,types,agent-docs-final}.log`.
The failed-before/fixed-after default regression has separate
`/tmp/cossack-toggles-empty-default-{regression,fixed}.log` records.

The package guide and migration notes describe attribute ownership, stable names,
controlled/default values, readonly items, fresh callback arrays and keyboard/focus
behavior. The guide adds no executable example. Other browser engines, assistive
technologies and the full UI/runtime/release matrix remain open. Versions remain
0.8.3 until REL-04. RT-23 and CLI-08 stay open against their original criteria.
Thirty-four UI foundations are reviewed. Continue Menubar and NavigationMenu, then
every pending audit row. The release remains at 24 completed tasks and 34 open.

<a id="codex-tabs-2026-10-04"></a>
## Codex Tabs (2026-10-04)

Author: Codex. Tabs now has closed root/list props, required instance identity and
a named list. Readonly TabsItem values support disabled items, icons and rich labels
with explicit accessible names. Derived IDs encode values rather than interpolating
them into selectors. Keyed panels remain mounted and preserve edits.

Controlled values now retain ownership after local interaction. defaultValue is
captured once; invalid/disabled values fall back to an enabled item without callbacks.
Roving focus is separate from selected state, including rejected controlled changes
and manual activation. Native buttons supply Enter/Space and form safety. Horizontal
arrows respect RTL; vertical arrows, Home/End and disabled skipping are explicit.
Native list callbacks can veto handling. Pointer focus and click produce one proposal.

The production browser fixture exposed focus loss when keyed DOM nodes move during
reordering. Focus now returns to a retained tab or panel input after a move. Removed,
disabled or hidden focused content returns to an enabled selected tab or the list.
Focus moved elsewhere is preserved. ResizeObserver tracks indicator geometry without
animation frames. Both variants/orientations remain supported, with reduced-motion
handling and cleanup of observation and queued connection/focus work.

Verification:

- UI build and 226 tests across 23 files pass, including public declaration fixtures,
  SSR identities, rich labels, disabled fallback and controlled/default ownership.
- Production themed Chromium passes retained hydration, two-instance identity,
  controlled rejection/updates, one pointer proposal, keyboard veto, RTL/vertical
  navigation, manual activation, retained edits, tab/panel reordering focus,
  removal/disabled fallbacks, measured indicator width/position/height after resize,
  vertical underlines, reduced motion and cleanup/remounting. The old mocked
  geometry test is replaced by these real DOM checks and state-ownership tests.
- `pnpm test:agent-docs:local` passes installed CLI/MCP native prop contracts,
  exact Tabs discovery and packaged guidance with Node networking disabled.
  Six existing usage examples compile and execute. The new UI guide has no
  executable examples; broader UI examples/platform declarations remain open.
- Root `pnpm tsc --noEmit` and all 11 package configurations pass.
- Four CLI source-ejection regression tests pass, including Tabs.

Logs: `/tmp/cossack-tabs-{build,ui,browser,root-types,types,ejection,agent-docs}.log`.
Thirty-two foundations are reviewed. RT-23, CLI-08, other browser engines,
assistive technologies and the full runtime/release matrix remain open. Continue
Toggle and ToggleGroup, then all remaining pending rows. Versions remain 0.8.3
until REL-04.

<a id="codex-disclosures-2026-10-04"></a>
## Codex Accordion and Collapsible (2026-10-04)

Author: Codex. Accordion/AccordionItem and Collapsible now require stable IDs and
nonempty trigger text. They own native button activation and trigger/panel ARIA
relationships. Accordion places the button in a configurable heading and hides its
decorative chevron from accessibility. Collapsible replaces the clickable div and
caller-supplied interactive trigger with an owned native button.

Typed root attributes/events target HTMLDivElement; triggerProps targets the button
and panelProps targets the content wrapper. Native trigger callbacks can veto
toggling with preventDefault. Event bubbling remains native. Disabled controls and
fieldset inheritance block activation. defaultOpen is captured once; controlled
state remains parent-owned. Closing a panel with focus inside restores the enabled
trigger before applying inert state. Existing height animation, reversal, unclamped
open content and reduced-motion behavior remain. Cleanup releases refs/animations.

The demo and declaration fixtures use the new IDs and text triggers. Ejected source
retains the disclosure helpers inline and resolves native attribute types through
the public UI package.

Verification:

- UI build and 218 tests across 22 files pass, including state ownership, SSR
  contracts, public declarations and existing animation/reversal/cleanup tests.
- Production themed Chromium checks retained hydration, SSR state, heading and
  controls relationships, Enter/Space, inert tab exclusion, controlled rejection,
  callback veto/bubbling, collapse focus, disabled controls/fieldsets, form safety,
  growing open content, reduced motion and remounting.
- Root `pnpm tsc --noEmit` and all 11 package type configurations pass.
- CLI UI-ejection regression suite: all three tests pass.
- `pnpm test:agent-docs:local` passes installed CLI/MCP prop contracts for Accordion,
  AccordionItem and Collapsible, exact Collapsible discovery, and packaged guidance
  with Node networking disabled. Six existing usage examples compile and execute.
  The new UI guide has no executable examples; broader UI examples and platform
  declarations remain CLI-08/release work.

Logs: `/tmp/cossack-disclosures-{build,ui,browser,root-types,types,ejection,agent-docs}.log`.
Thirty-one component foundations are reviewed. Tabs remains pending, including
controlled selection, collision-free IDs and indicator/focus lifecycle. RT-23,
CLI-08, other browser engines, assistive technologies and full runtime/release
acceptance remain open. Versions stay at 0.8.3 until REL-04.

<a id="codex-command-2026-10-04"></a>
## Codex Command (2026-10-04)

Author: Codex. Command now renders a named native modal dialog with typed native
attributes/events and explicit controlled/default state. It requires a stable ID
and accessible label. The public CommandItem contract accepts readonly arrays,
unique IDs, labels, optional group text and disabled items. A named combobox owns
focus, with stable active-descendant/list relationships and keyed result identity.
Arrow keys skip disabled results; Enter selects the active match, except during
composition. Empty/all-disabled results have no active descendant. Reordering
preserves the highlighted ID; removal falls back to an enabled result. Search
retains case-insensitive substring matching and resets on accepted state changes.

Shortcut registration is now opt-in. A browser regression exposed hydration-order
differences between listener attachment and DOM order. Document-scoped registration
now picks the first eligible owner in document order. Only the active modal can
handle a shortcut while one is open. Cleanup removes listeners/registration and
cancels deferred connection. The App's duplicate document handler is removed;
it owns the global palette shortcut, while the local demo uses an explicit button.
Confirmation remains application-owned and proposes closing after onSelect.

Verification:

- UI build and 213 tests across 21 files pass, including SSR contracts, invalid
  identities/labels and installed-export declaration fixtures.
- Production themed Chromium checks retained hydration, native focus/inertness,
  enabled-result navigation, reordering/removal, empty matches, composition,
  disabled pointer activation, controlled proposals and rejection, Escape vetoes,
  multiple shortcut owners, foreign modal exclusion and cleanup.
- `pnpm test:agent-docs:local` passes installed CLI/MCP parity, exact Command
  discovery and native prop contracts with Node networking disabled. Six existing
  packaged examples compile and execute. The new UI guide has no executable
  examples; wider UI example/platform acceptance remains release work.
- Root `pnpm tsc --noEmit` and all 11 package type configurations pass.
- The real framework Playwright navigation test passes: Ctrl+K, route search,
  Enter selection, SPA navigation and dismissal. The assertion now checks hidden
  retained markup instead of removal. Startup emitted missing required demo-secret
  warnings; this test does not prove auth, storage or remote deployment readiness.

Logs: `/tmp/cossack-command-{build,ui,browser,root-types,types,e2e,agent-docs}.log`.
Twenty-nine component foundations are reviewed. RT-23, CLI-08 and the full release
matrix remain open, including other browser engines and assistive technologies.
Continue Tabs, Accordion and Collapsible, then all remaining pending audit rows.
Versions stay at 0.8.3 until REL-04.

<a id="codex-alert-dialog-2026-10-04"></a>
## Codex AlertDialog (2026-10-04)

Author: Codex. AlertDialog now shares the native dialog controller instead of a
separate ClientTask and direct callback-only Cancel button. Stable required IDs
connect the visible text title and optional description to `role=alertdialog`.
Native attributes/events target HTMLDialogElement. Closed public props reject
arbitrary options and caller overrides of owned semantics. Cancel receives initial
focus; backdrop clicks never dismiss. Escape can be vetoed through `@cancel` or
`closeOnEscape=false`. Controlled callers accept `onClose` by changing `open`.
Uncontrolled default state and explicit `close()` share native dismissal and cleanup.

Confirmation remains caller-owned. `onAction` receives the native button event,
without automatic dismissal or promise handling. `actionDisabled` prevents repeated
confirmation while the caller owns pending work. Studio, scaffold and demo consumers
have stable IDs. Studio converts its numeric loading counter to the new boolean
prop. Cancellation does not abort or undo application operations.

Verification:

- UI build and 207 UI tests across 20 files pass, including SSR relationships,
  invalid identity/labels, native attributes and published declaration contracts.
- Production themed Chromium checks retained hydration, closed SSR, accessible
  name/description, Cancel-first focus, background inertness, Tab navigation,
  backdrop persistence, disabled confirmation, caller-owned actions, Escape vetoes,
  rejected/accepted controlled dismissal, prop-driven closing, focus restoration,
  explicit uncontrolled close and queued-attachment cleanup.
- Root `pnpm tsc --noEmit` and all 11 package configurations in `pnpm typecheck` pass.
- All 78 scaffold regression tests pass after consumer ID migration.
- `pnpm test:agent-docs:local` passes installed CLI/MCP native-prop and exact
  AlertDialog symbol parity with Node networking disabled. Six existing packaged
  examples compile and execute. The new alert guide has no executable examples;
  broader UI examples and platform declarations remain CLI-08/release work.

Logs: `/tmp/cossack-alert-{build,ui,browser,root-types,types,agent-docs,scaffold}.log`.
Twenty-eight component foundations are reviewed. RT-23 and CLI-08 remain open,
as do other browser engines, assistive technologies and full release gates.
Next: Command shortcut ownership, controlled state, modal focus and list semantics.
Versions stay at 0.8.3 until REL-04.

<a id="codex-hover-controls-2026-10-04"></a>
## Codex hover controls (2026-10-04)

Author: Codex. Tooltip and HoverCard now share a DOM controller for pointer/focus
ownership, opening/closing delays, Escape cancellation and cleanup. Manual native
popovers escape ancestor clipping and flip/clamp within the visual viewport.
Focus persists inside interactive card content; passive opening does not steal
focus through autofocus descendants. Dismissal restores the actual trigger when
card content owns focus. Deferred attachment waits for connected nodes and is
canceled on cleanup. Disabled controls suppress opening.

Both components require stable IDs and nonempty labels. Tooltip exposes a plain
text description; callers put `aria-describedby` on the actual trigger. HoverCard
names its nonmodal dialog and separates typed wrapper attributes from `contentProps`.
The extra HoverCard wrapper tab stop is removed. Studio actions now have distinct
IDs for repeated rows and stable IDs across loading labels. Primary-key details
are keyboard-focusable. The sessions template now uses `label` instead of its
previously ignored `content` prop. The demo, migration guide and packaged agent
guide follow these contracts.

Verification:

- UI build passes. UI Vitest: 201 tests across 19 files, including SSR contracts,
  invalid inputs and public declaration fixtures.
- Production themed Chromium hover fixture: retained hydration, no-JavaScript
  accessible description, Escape and pending timer cancellation, hover persistence,
  autofocus suppression, Tab navigation, pointer-only focus restoration, explicit
  show/hide, disabled state, viewport bounds and cleanup pass.
- Studio tooltip regression fixture: three tests pass for unique row IDs, stable
  loading labels and encoded/focusable primary-key descriptions.
- Scaffold regression suite: all 78 tests pass after the session-tooltip migration.
- `pnpm tsc --noEmit` and `pnpm typecheck` pass across all 11 package configurations.
  Type checking found a missing `declaredKind` in the new Studio fixture; it is fixed.
- `pnpm test:agent-docs:local` passes installed-tarball CLI/MCP parity, exact Tooltip
  discovery and declared native prop contracts with Node networking disabled.
  The six existing packaged usage examples compile and execute. The new UI guide
  has no executable examples; broader UI example/platform acceptance remains open.

Logs: `/tmp/cossack-hover-{build,ui,browser,studio,root-types,types,agent-docs,scaffold}.log`.
Twenty-seven component foundations are reviewed. This checkpoint does not close
RT-23, CLI-08 or the full runtime/release matrix. Other browser engines and
assistive technologies remain unverified. Continue AlertDialog and Command, then
all remaining pending component rows. Versions stay at 0.8.3 until REL-04.

<a id="codex-websocket-ownership-2026-10-04"></a>
## Codex WebSocket ownership (2026-10-04)

Author: **Codex**. Continued after `3584180`. WebSocket callbacks previously lacked
source ownership checks. A retired socket could publish state or invoke an event,
and an obsolete close could overwrite status or schedule a reconnect. Destruction
also depended on a future close callback to clear heartbeat/pending-call state.

Core now retires provider ownership before closure, sets closed status, clears
heartbeat/reconnect timers and settles pending calls with the uncertain-outcome
error. Callback identity and terminal-phase checks reject stale delivery. Duplicate
close events cannot schedule extra reconnects. Provider replacement closes the old
connections, and destroyed components cannot open new ones.

Three new unit cases cover retired/replaced callbacks, pending-call settlement,
zero remaining timers, duplicate close and pending reconnect cancellation. The
existing malformed-known-ID test used a Destroyed component to avoid reconnects;
it now uses a live owner and explicit cleanup while preserving protocol assertions.

Production Node/native workerd fixtures open real sockets, change path-derived
provider targets, replace a page at the same target and return to HTTP. Changed
ownership resets drafts/services; matching ownership preserves them. Old sockets
close and retired services dispose once. Cloudflare uses a test-only binding and
SQLite migration for the existing AppDurableObject export, following the installed
Wrangler schema and [Cloudflare class-export guidance](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

Verification:

- `pnpm --filter @cossackframework/core exec vitest run tests/realtime-recovery.test.ts`:
  13 passed.
- Core and framework builds passed, including framework SSG.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,442 passed, 85 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,453 passed, 68 files.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|moves between production Node and workerd|parses and navigates typed URL state'`:
  5 passed, 26 skipped (62 seconds), including the final same-target replacement.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

**No task closes: 22/58 checked, 36 unchecked.** The planned navigation ownership
scenarios now have native evidence. Next audit the original RT-08/RT-09 requirements
and run relevant browser suites plus the full generated-runtime file before closure.
Versions remain 0.8.3. No deployment, publication or full CLI rerun occurred.

<a id="codex-runtime-ownership-2026-10-03"></a>
## Codex runtime and SSE ownership (2026-10-03)

Author: **Codex**. Continued after `c5e01d2`. Production Node/native workerd
acceptance now opens an SSE child page and returns to HTTP. Shared root/layout
drafts and services remain stable. Page drafts reset and the retired source closes.
This test reproduced realtime.sse.state remaining open after navigation on both
runtimes: EventSource.close() does not send a close event.

Core now clears SSE ownership and sets closed before closing the source. Saved
open/error handlers and named event listeners check source identity and destruction.
Late state, cursor/resync, action completion, event and client-action callbacks
cannot mutate retired owners. Replacement closes the old source. Destruction
prevents reconnection. Two unit cases simulate both destroyed and replaced owners.

A separate local HTTP proxy routes one browser from real built Node to native
workerd and back. It does not rewrite SSR metadata. With the same user, scope and
page path, runtime changes reset root/layout/page drafts and create fresh services.
Old services dispose exactly once. This is HTTP runtime acceptance, not a claim
about cross-runtime WebSocket provider targets or production load balancing.

Verification:

- `pnpm --filter @cossackframework/core exec vitest run tests/realtime-recovery.test.ts`:
  10 passed, including both late-callback regressions.
- Core and framework package builds passed, including framework SSG.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,439 passed, 85 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,453 passed, 68 files.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|moves between production Node and workerd|parses and navigates typed URL state'`:
  5 passed, 26 skipped (66 seconds), including the existing read-count and same-URL cases.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

**No task closes: 22/58 checked, 36 unchecked.** Finish provider-target/WebSocket
ownership acceptance and audit every RT-08/RT-09 criterion before closure.
Versions remain 0.8.3. No live deployment, publication or full CLI rerun occurred.

<a id="codex-same-url-history-2026-10-03"></a>
## Codex same-URL history (2026-10-03)

Author: **Codex**. Continued after `2f9b7c3`. The generated production fixture now
uses separate history entries with identical URLs to test two interruption cases
on Node and native workerd:

- Delay the forward restoration after a guarded native back traversal. A new
  intent remains pending until restoration reaches the second entry, then pushes
  from that entry. Restoration performs no resource reads.
- Confirm the original back traversal and hold its actual SSR response after
  backend reads complete. A new navigation supersedes it and commits from the
  first entry. Releasing the old response changes neither history nor live state.

Assertions compare history group/position, application entry markers, history
length, page/service/File drafts, page/layout resource values and exact backend
reads. The two identical URLs are distinguished by entry identity throughout.
The test temporarily wraps history.go to delay restoration, then invokes the
real method. Confirmation uses an actual intercepted production SSR response.
Cleanup restores history methods, releases held responses and closes each page.

Verification:

- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state|isolates navigation ownership'`:
  4 passed, 26 skipped (49 seconds). Both interruption cases ran on each runtime.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

No runtime fix was required. These are test/documentation changes, so library
builds and full unit/CLI suites retain their prior evidence.
**No task closes: 22/58 checked, 36 unchecked.** Continue native provider/runtime/
transport ownership acceptance and the full RT-08/RT-09 criteria audit. The tested
same-URL scenarios are complete and removed from the active handoff's pending list.
Versions remain 0.8.3. No live deployment or publication occurred.

<a id="codex-url-backend-reads-2026-10-03"></a>
## Codex URL-state backend reads (2026-10-03)

Author: **Codex**. Continued after `4f6d633`. The generated URL-state fixture now
runs a real HTTP backend with independent request records. Page and layout
server resources fetch their values from that backend. The test server starts
before building and closes after browser/runtime cleanup, including failure paths.

Both production Node and native workerd pass exact read assertions:

- Initial SSR and each fresh query document read page/layout once each. Browser
  hydration and retained-layout dependency hydration add no reads or RPCs.
- Cached back/forward, guarded navigation and confirmation use existing data.
- Failed root rendering counts the destination's SSR reads. Rollback adds none.
  Post-render layout teardown/recovery also adds no backend reads.
- Replacement, copied URLs, invalid defaults and coalesced rapid updates return
  expected values with one read per resource for each fresh document.
- A held SSR response has already made its two reads. Superseding it through
  back/replace/forward and a newer query has exact per-destination read counts.
  Releasing the obsolete response adds no reads and cannot overwrite live data.
- Leaving and returning creates a fresh document. Subsequent scope cleanup adds
  no backend reads.

Verification:

- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state|isolates navigation ownership'`:
  4 passed, 26 skipped (42 seconds), including both production runtimes.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

These are test-only changes. No library rebuild or full unit/CLI rerun is claimed.
The backend is HTTP, not a database adapter. Delaying an already-produced SSR
response does not prove cancellation of backend work.

**No task closes: 22/58 checked, 36 unchecked.** Keep native provider/runtime/
transport ownership, interrupted same-URL history and full acceptance audits open.
Extend these read assertions with those scenarios. Versions remain 0.8.3.

<a id="codex-navigation-diagnostics-2026-10-03"></a>
## Codex navigation diagnostics (2026-10-03)

Author: **Codex**. Continued after `75609d2`. Development now emits versioned,
frozen navigation diagnostic records with per-document IDs and monotonic timestamps.
Phases report cache hit/miss/shared reads, invalidation count, attempted layout
retention/replacement, actual scroll decisions, transition fallback and final
outcome/commit status. Prefetch and invalidation use a null navigation ID.

Core scroll application returns its actual decision, including a missing fragment
that falls back to the top. Framework does not duplicate that selection logic.
Transition animation rejection is reported separately and can arrive after finish.
Records omit URLs, state, application identifiers, transition names and raw errors.
Production builds emit no diagnostic events. See the
[event contract](../docs/prevent-navigation.md#development-diagnostics).

Verification:

- `pnpm --filter @cossackframework/core build`: passed.
- `pnpm --filter @cossackframework/framework build`: passed, including SSG.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,437 passed, 85 files.
  Scroll assertions cover top, preserve, saved history, found/missing fragments
  and the absence of a browser.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,453 passed, 68 files.
  The 47-case navigation file includes ordered/frozen records, correlation,
  cache reuse/invalidation, layout counts, shared prefetch, cancellation,
  supersession, failure, transition fallbacks and production suppression.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|parses and navigates typed URL state'`:
  4 passed, 26 skipped. Production Node/native workerd ownership scenarios also
  assert that no diagnostic event is emitted.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.
- `git diff --check -- . ':!reports.md'`: passed.

**No task closes: 22/58 checked, 36 unchecked.** Extend diagnostic acceptance with
remaining native provider/runtime/transport and interrupted same-URL history
scenarios. Actual backend read counts still require independent assertions.
Controlled diagnostic tests do not close those requirements or the release gates.
Versions remain 0.8.3. No full CLI rerun or live deployment is claimed here.

<a id="codex-route-inheritance-2026-10-03"></a>
## Codex route inheritance (2026-10-03)

Author: **Codex**. Continued after `8f084e0` and handoff compaction `d53eab4`.
The parent-layout fixture reproduced 405 responses on both Node and native workerd.
Router classification considered only an own render() declaration. API dispatch
also ignored authored inherited handlers. A decorated subclass therefore built
successfully but could not render or invoke its inherited API methods.

A shared descriptor lookup now searches authored ancestors and stops before the
Cossack prototype. Inherited render() selects SSR. API lookup honors get()/init()
precedence and derived overrides without invoking accessors or falling through a
shadowing declaration. The framework's default methods remain excluded.

The production fixture uses decorated inherited pages/layouts and the same child
classes under changed parents. Root drafts/services survive navigation away and
back. Replaced nested drafts reset, nested services are fresh, and retired services
dispose exactly once. Inherited GET/POST handlers return their expected JSON on
both runtimes. Bare default re-export transport discovery is not claimed.

Verification:

- `pnpm --filter @cossackframework/framework exec vitest run tests/api-routes-class.test.ts`:
  14 passed, including 5 new inheritance/override/accessor cases.
- `pnpm --filter @cossackframework/framework build`: passed, including SSG.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,444 passed, 68 files.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|parses and navigates typed URL state'`:
  4 passed, 26 skipped, covering production Node and native workerd.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  all 30 generated-runtime cases passed (216 seconds).
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 packages passed.
- `git diff --check -- . ':!reports.md'`: passed.

**No new task closes: 22/58 checked, 36 unchecked.** Parent-layout acceptance is
now verified. Native provider/runtime/transport ownership, interrupted same-URL
history, actual backend read counts and navigation diagnostics remain open.
Versions remain 0.8.3. The compact handoff retains current next steps.

<a id="codex-root-ownership-2026-10-03"></a>
## Codex root ownership (2026-10-03)

Author: **Codex**. Reviewed after `ee5734a`. Generated production Node and native
workerd tests reproduced private root App drafts surviving a changed user or
navigation scope. Page/layout replacement alone did not reset the root tree.

The framework now prepares and publishes a fresh App with a fresh root service
scope when root ownership changes. Root listeners check the active App identity.
Rollback restores the prior App, contexts and drafts. Successful retirement
removes its listener and waits for component cleanup before root scope disposal.
The renderer clears old DOM when the current root renders null. The App's own
transport remains independent of its child page's transport.

The new fixture covers retained drafts and service identity for matching owners,
user/scope changes, failed replacement, stale failed-root updates and empty output.
A held asynchronous layout cleanup reads its original user, URL and live service.
Retired declared services dispose exactly once. Legacy global injection is unchanged.
The fixture uses a query-based identity only for testing, not as authentication.

Verification on the final source:

- `pnpm --filter @cossackframework/renderer exec vitest run`: 284 tests, 22 files.
- `pnpm --filter @cossackframework/renderer build`: passed.
- `pnpm --filter @cossackframework/framework build`: passed, including SSG.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,434 tests, 85 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,439 tests, 68 files.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership|parses and navigates typed URL state'`:
  4 passed, 26 skipped. Both fixtures ran in production Node and native workerd.
- `pnpm --filter cossack exec vitest run --maxWorkers=2`: 610 tests, 44 files,
  328 seconds. Ran without competing heavy test jobs.
- `git diff --check -- . ':!reports.md'`: passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all 11 package checks passed.

The attempted parent-layout fixture used bare default re-exports. Compiler
validation rejected unknown transport metadata before runtime. It was removed
from this fixture and is not passing evidence. Continue that case with supported
route declarations. Native provider/runtime/transport changes, interrupted
same-URL history, backend read counts and diagnostics remain open.

**No task closes: 22/58 checked, 36 unchecked.** Versions remain 0.8.3. This review
does not close RT-08/RT-09 or the final release gates. See their detailed plans.

<a id="codex-inactive-cache-2026-10-03"></a>
## Codex inactive cache (2026-10-03)

Author: **Codex**. Continued after `34592fd`. Inactive cache branches were absent
from rendered-tree checkpoints. A branch hidden across navigation lost its draft;
reusing one pending token for destination and rollback would also consume the
rollback's values.

Core now forks unconsumed local capabilities without reading their former owner.
Forks keep class binding and copy plain draft graphs independently; File/native
values retain identity. Unknown, consumed and wrong-class capabilities reject.
Renderer checkpoints capture hidden stashes and can fork remaining pending trees
on another navigation, rebasing parent identities to the current owners.

Navigation retires hidden instances and keeps their declared draft capabilities
until matching branches become visible. Restoration precedes mount. Ordinary
cache toggles retain live DOM. Both template placeholders and cache(null) work.
Cache exit, changed key/class/parent/scope, explicit discard and publication
revocation reject pending restoration. Destroyed owners stay terminal. The renderer
still imports no core or framework implementation.

Unit tests prove two owner replacements, independent rollback copies, rejection
boundaries, class-bound one-use tokens, saved-proxy isolation and File identity.
The renderer fixture throws if a disposed owner is read. Generated production
Node/native workerd browsers hide two page branches, navigate repeatedly and roll
back, write through an old proxy, then reveal both drafts and a cached File.
Leaving and returning resets the cached fields.

Verification on 2026-10-03:

- Final renderer: `pnpm --filter @cossackframework/renderer exec vitest run`:
  **282 / 21 files**, including 21 navigation-draft cases.
- Full core: `pnpm --filter @cossackframework/core exec vitest run`:
  **1,434 / 85 files**. After the constructor comparison was adjusted for
  declaration emission, the final `tests/url-state-navigation.test.ts` run passed
  all **10 tests**, including fork rejection and graph/File behavior.
- Renderer, core and framework builds passed, including framework SSG.
- Framework: `pnpm --filter @cossackframework/framework exec vitest run`:
  **1,439 / 68 files**.
- Generated production Node/native workerd browser matrix:
  `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state'`:
  **2 passed / 26 skipped**. The full CLI run below also includes the final
  additional cached-field reset assertions.
- Final full CLI: `pnpm --filter cossack exec vitest run --maxWorkers=2`:
  **608 / 44 files**, 297 seconds. No concurrent heavy test/build job ran during
  this suite. The creation case that timed out at the previous checkpoint passes.
- Final `pnpm tsc --noEmit` and `pnpm typecheck`: passed, all **11 packages**.
- `git diff --check -- . ':!reports.md'`: passed. All 58 task IDs and checkbox
  states match the previous commit. No owned test/build process remains.

No live deployment, publication, push or external message was performed.

**No release checkbox closes: 22/58 checked, 36 unchecked.** Native ownership
changes, interrupted same-URL history, actual backend resource-read counts and
navigation diagnostics remain open. The
[detailed RT-09 plan](./release-0.9.0-plan.md#rt-09) lists the next actions.
Versions stay 0.8.3 until REL-04.

<a id="codex-nested-drafts-2026-10-03"></a>
## Codex nested drafts (2026-10-03)

Author: **Codex**. Continued after `3af248d`. Page-level draft transfer did not
preserve renderer-created children destroyed during destination rendering or
rollback. The renderer now captures a local part-tree checkpoint. Matching uses
template identity, part position or repeat key, component class, parent and service
scope. The framework maps an old page to its prepared replacement only when its
class and ownership match. Separate checkpoints protect rollback values from
consumption during destination rendering.

Fresh children consume core draft capabilities before state initialization and
mount. Core drops the consumed initialization map afterward. Live retained
components keep their latest state; destroyed instances are not reconnected.
Publication checks reject delayed descendant restoration after supersession.
No renderer-to-core dependency or serialized draft payload is added.

Renderer tests cover nested restoration, explicit page-owner replacement, arrays,
keyed reordering, changed class/parent/scope/key, revocation, retained live values,
and the active cache template. A failing repeated item exposed a separate cleanup
leak: earlier new siblings were not yet recorded in the owned part list. The
renderer now records and disposes all partial siblings before propagating failure.
A synchronous render from a mismatched wrapper also exposed fallback propagation
into slotted children. The renderer now passes an explicit no-recovery boundary;
a failing-before/fixed-after regression verifies that no draft crosses it.

Generated production Node/native workerd apps retain page/layout child drafts and
grandchild File values during query replacement and post-render failure recovery.
Replacement mount hooks see restored values. Leaving the page resets unrelated
child drafts. The previous service cleanup and navigation matrix stays enabled.

Verification on 2026-10-03:

- Final renderer: `pnpm --filter @cossackframework/renderer exec vitest run`:
  **273 / 21 files**, including 12 draft/reconciliation cases.
- Full core: **1,432 / 85 files** before the final consumed-map release. After
  that one-line change, `pnpm --filter @cossackframework/core exec vitest run tests/url-state-navigation.test.ts`:
  **9 passed**, including restored values visible during child mount and the
  released initialization map.
- Final renderer, core and framework builds passed, including framework SSG.
- Final framework: `pnpm --filter @cossackframework/framework exec vitest run`:
  **1,439 / 68 files**.
- Final production browser checks:
  `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state'`:
  **2 passed / 26 skipped** (Node and native workerd), after the final rebuild.
- Full CLI `pnpm --filter cossack exec vitest run --maxWorkers=2` completed in
  356 seconds: **607 passed / 1 failed**, 43 green files and one failed file.
  The existing creation/JSON matrix case hit Vitest's five-second timeout.
  `pnpm --filter cossack exec vitest run tests/cli-json-matrix.test.js -t 'create plans without writes'`
  then passed (**1 passed / 42 skipped**, test body 1.9 seconds). No timeout or
  assertion was weakened. The broad run preceded the final synchronous-wrapper
  guard and core map-release refinement; it is not claimed as a clean final run.
- Final `pnpm tsc --noEmit` and `pnpm typecheck`: passed, all **11 packages**.
- `git diff --check -- . ':!reports.md'`: passed. All 58 task IDs/check states
  match the previous commit. No owned test/build process remains.

No live deployment, publication, push or external message was performed.

**No checkbox closes: 22/58 checked, 36 unchecked.** Inactive cache() stashes,
broader native ownership changes, interrupted same-URL history, actual backend
read counts and navigation diagnostics remain open. Read the concrete next steps
in [RT-09](./release-0.9.0-plan.md#rt-09). Versions remain 0.8.3.

<a id="codex-scope-retirement-2026-10-03"></a>
## Codex scope retirement (2026-10-03)

Author: **Codex**. Reviewed and continued after `773c9c3`. Rollback destroyed
transient layout service scopes before renderer-created children finished cleanup.
Successful retirement could also close a service after DOM removal but before
an asynchronous child cleanup finished.

Core now tracks renderer consumer lifetimes for a scope and its ancestors.
Navigation retirement snapshots those consumers before destruction. Components
become Destroyed and cancel tasks immediately; service disposal waits for consumer
removal and async cleanup. New attachments to a retiring scope fail. Owned-scope
holds release before the owner's own disposal completion to prevent a self-wait.
Ordinary explicit destruction keeps its existing contract. A permanently pending
application cleanup can retain its services; this hold does not extend navigation's
completion deadline or forcibly cancel user I/O.

Renderer structural hooks keep the renderer independent of core. Failed connection
or hydration cleans partially created siblings; invalidated root caches cannot
reuse disposed parts. A throwing disconnection hook is logged, and sibling
cleanup and scope release continue. Core tests cover scope ancestry, immediate
task cancellation, self-wait prevention, late attachment rejection, ordinary
destruction and successful retirement during pending child cleanup. Renderer
tests cover attachment/removal, partial render/hydration failure and hook errors.

Generated Node/native workerd apps throw after actual DOM reconciliation, then
check rollback state and an async child's use of its still-open service before
exactly one disposal. Explicit @Client hooks keep browser-only assertions in the
client bundle. Nested child draft restoration remains separate follow-up work.

Verification on 2026-10-03:

- `pnpm --filter @cossackframework/renderer exec vitest run`: **261 / 20 files**.
- Full core: **1,431 / 85 files**. After adding the successful-retirement case,
  `pnpm --filter @cossackframework/core exec vitest run tests/navigation-scope-retirement.test.ts`:
  **5 passed**. Core implementation did not change after the full run.
- Renderer, core and framework builds passed, including framework SSG.
- Full CLI: `pnpm --filter cossack exec vitest run --maxWorkers=2`:
  **608 / 44 files**, 338 seconds. This ran before the final successful-retirement
  framework change and explicit browser cleanup gates.
- After that change, framework was rebuilt. Final full framework:
  `pnpm --filter @cossackframework/framework exec vitest run`: **1,439 / 68 files**.
- Final generated production Node/native workerd browser matrix:
  `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state'`:
  **2 passed / 26 skipped**. Both rollback and successful retirement hold async
  cleanup behind an explicit gate, prove no early disposal, then release it and
  observe cleanup with an open service followed by exactly one disposal.
- Final `pnpm tsc --noEmit` and `pnpm typecheck`: passed, all **11 packages**.
- `git diff --check -- . ':!reports.md'`: passed. No owned test/build process remains.

No live Cloudflare deployment or release publication was performed.

**No release task closes.** All 58 original IDs remain in order, with 22 checked
and 36 unchecked. RT-08 and RT-09 still need their full acceptance audit. Follow
the [detailed next steps](./release-0.9.0-plan.md#rt-09) and
[Codex handoff](./handoff-0.9.0.md). Versions remain 0.8.3.

<a id="codex-render-recovery-2026-10-03"></a>
## Codex render recovery (2026-10-03)

Author: **Codex**. Continued after `457646e`. App rendering could swallow an
exception and report navigation success. Waiting on an unrelated App update
promise also blocked later rendering. The outgoing page was already destroyed,
so failure after publication had no live page owner to restore.

Core now owns a guarded navigation render pass, independent of cached application
update promises. It preserves the render/controller lifecycle, propagates errors,
and checks ownership before template publication and later lifecycle hooks.
A shouldUpdate veto reports COSSACK_NAVIGATION_RENDER_SKIPPED. Ordinary background
updates keep their existing logged-error behavior. Navigation customization uses
render/lifecycle hooks, not requestUpdate/performUpdate synchronization overrides.

The framework keeps the outgoing page alive through rendering. Before history
commit, cancellation or failure restores the prior page/layout map, request URL,
parameters, user, resource entries, service request binding and global SSR state.
Restored unresolved reads can reload rather than join discarded results. An
identity guard prevents late recovery work from overwriting a newer publication.
After rendering and history commit, old owners retire. Cleanup/completion errors
after that boundary leave the committed destination current. Sibling outgoing
owners still receive cleanup when one cleanup throws.

Core tests cover stuck update promises, render errors, revocation during render,
controllers, willUpdate and listeners, plus retained context/resource restoration.
Framework tests cover error/veto/deadline recovery and a newer navigation completing
before an obsolete render is released. Real generated Node/native workerd apps
throw from App.render, verify restored page/layout/service/File state, and then
navigate with an actual App update promise that never settles.

Verification checkpoints: full core **1,427 / 84 files** and full framework
**1,439 / 68 files** pass. Both builds and all type checks pass. Full CLI
**608 / 44 files** passed in 337 seconds before the final callback guard tightening.
After that tightening, both packages were rebuilt. Final full framework
**1,439/68**, both generated production URL browser cases (**2 passed / 26 skipped**),
root TypeScript and all **11** package checks passed again. No owned test/build
process remains. The full CLI suite was not repeated after those final guards.
Initial focused failures came from a renderer mock classifying null as a template;
the tests now return its supported empty template. Type checking caught an omitted
resource loader argument and required serialized-state fields in a new fixture.
Those fixture declarations are corrected. No production type error was suppressed.

Limits: framework context recovery cannot undo arbitrary application effects.
Nested components already removed by DOM teardown are not revived. Next add
partial-DOM recovery acceptance, preserving nested drafts through new owners and
keeping transient layout scopes alive until renderer descendants retire. Then
finish changed/nested ownership, interrupted same-URL history, backend read counts,
scroll/fragment/transition diagnostics and the original acceptance audit.
All **58 original IDs** remain: **22 checked / 36 unchecked**. No checkbox closes.
Versions stay 0.8.3 until REL-04. No live cloud or release-wide gate was run.

<a id="codex-draft-isolation-2026-10-03"></a>
## Codex draft target isolation (2026-10-03)

Author: **Codex**. Continued after `c80fef6`. New page proxies still wrapped
outgoing raw draft targets. A saved proxy or cleanup hook from the disposed page
could mutate the new draft, even though it no longer owned reactive updates.

Local draft capabilities now snapshot plain records, null-prototype records and
arrays as one graph. Cycles and aliases across fields survive. Sparse arrays,
symbol/non-enumerable data properties, descriptors and non-extensibility survive.
Native objects, authored class instances and functions retain identity as opaque
references. Their own mutable contents and external effects are not isolated.
File identity still survives real navigation. No JSON serialization is involved.

Accessors inside draft records fail with COSSACK_NAVIGATION_DRAFT_ACCESSOR before
publication and without executing the getter. The error identifies the field and
suggests moving computed getters onto the component. The existing navigation
failure path preserves the old page, URL and global SSR state in this case.
Public URL-state documentation and migration guidance explain the shape contract.

Four snapshot tests cover graph ownership, data attributes, native identity and
accessor rejection. Component tests cover both transfer paths, old saved proxies,
and cleanup-time mutation. A framework test checks snapshot failure before live
publication. Both actual production browser fixtures now retain an old proxy,
navigate, write through it, force a new-owner render and verify the draft stays
unchanged. This forces rendering so stale DOM cannot hide shared-target corruption.
The existing File, query, resource, draft and history matrix still passes.

Final verification:

- Full core: **1,420 tests / 84 files**. The first focused run exposed the existing
  proxy predicate excluding null-prototype records. Snapshot handling now includes
  those records explicitly; final graph and full-suite tests pass.
- Full framework: **1,435 / 68 files**, including failure-before-publication.
- Generated production Node/native workerd URL tests: **2 passed / 26 skipped**.
  Command: `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js
  -t 'parses and navigates typed URL state'`.
- Core/framework ESM and declaration builds, framework SSG, root `pnpm tsc --noEmit`
  and `pnpm typecheck` for all **11 packages** pass. Consumer checks ran after builds.
- JS syntax, owned whitespace and exact release ID/order/state checks pass.
  Full CLI was not rerun; the previous full CLI result belongs to its checkpoint.

All **58 original IDs** remain: **22 checked / 36 unchecked**. No checkbox closes.
RT-08/RT-09 still require shared-render and post-publication recovery, interrupted
history, changed/nested owners, backend read counts and diagnostics acceptance.
Versions stay 0.8.3 until REL-04. No owned test/build process remains.

<a id="codex-staged-navigation-2026-10-03"></a>
## Codex staged navigation review (2026-10-03)

Author: **Codex**. Continued after `2aa46fb`. Page bootstrap previously ran
inside the serialized commit queue after destroying the old page. A stalled
bootstrap blocked newer navigation, and failure left the live tree partially
replaced before the destination was ready.

Preparation now resolves modules and bootstraps new page/layout instances before
joining the commit queue. Core's internal stageNavigation option defers task
execution, transport connections, shared service request binding and mount hooks.
The committed page/layout map and global SSR state remain active during this
phase. Failed or canceled preparation disposes its new owners. New scopes are
also disposed if component construction fails. Reactive updates from unpublished
components cannot render the active tree.

Publication adopts the latest same-owner ClientState/ClientStore capability,
including edits made while preparation waited, before running tasks and mount
hooks. Preparation does not share the outgoing draft through an early restore.
Declared native File identity stays intact. Retained layouts keep their services
and adopt destination resources at publication. Outgoing layout scopes retire
after DOM reconciliation. Loading content no longer destroys the committed page.

NavigationOwner races asynchronous guards, fetch, module/bootstrap preparation,
commit queue and transition completion against supersession and a 30-second
budget. Timeout reports COSSACK_NAVIGATION_TIMEOUT and revokes publication.
Independent fetch readers retain their separate response deadline and shared
request ownership. History recovery retains its separate two-second limit.
Ignored application promises have rejection handlers even after ownership ends.

New core tests cover delayed activation, abandoned stages, exactly-once activation,
service binding and edits made during preparation. The existing race test now
requires the newer navigation to complete before releasing the old bootstrap.
New navigation tests cover preparation failure, stalled guard/bootstrap/module/
transition deadlines, retry and a late transition callback rejected before
publication. The old response-timeout assertion changed to the earlier navigation
budget's code; its first run was the only focused navigation failure.

Final verification: full core **1,415 tests / 83 files**; final full framework
**1,434 / 68 files**; full CLI **608 / 44 files** (339 seconds, maxWorkers=2).
Total: **3,457 tests**. Core and framework ESM/declaration builds, framework SSG,
root TypeScript and all **11** package checks pass. Consumer checks use completed
builds. The full CLI run includes generated production Node/native workerd query,
history, scoped-service, stream, database and build acceptance. No live cloud
operation or complete 0.9.0 release gate was run. No owned test/build process remains.

Limits: this stages preparation and bounds framework waits. It cannot undo
arbitrary user effects once publication, mount or render has started. Shared App
render state and interrupted publication still need explicit recovery acceptance.
Transferred raw store targets also need a late-write audit for disposed owners.
Changed/nested ownership, interrupted history, actual backend read counts,
scroll/fragment/transition diagnostics and the full criterion audit remain open.
All **58 original IDs** remain in scope: **22 checked / 36 unchecked**. RT-08 and
RT-09 remain open. Versions stay 0.8.3 until REL-04.

<a id="codex-fetch-ownership-2026-10-03"></a>
## Codex navigation fetch ownership (2026-10-03)

Author: **Codex**. Continued after `b0da7d0`. A superseded navigation previously
waited for its old response/body indefinitely. The deduplication map could not
abort one reader without also affecting another reader of the shared request.

SharedPageRequests now tracks independent readers and one network controller.
A newer navigation releases its old reader immediately. The last reader leaving
aborts the fetch/body. Each reader gets a 30-second deadline. The existing error
flow reports COSSACK_NAVIGATION_FETCH_TIMEOUT and permits handled failures to
retry. Cache invalidation detaches old entries without canceling their current
readers. Identity checks keep old completion from removing a replacement entry.
Cache epoch checks remain intact. Aborted work checks ownership after fetch and
body completion, before parsing, module preloading or cache publication.

Six request-owner tests cover shared prefetch survival, ignored abort and late
rejection, independent deadlines, detached invalidation, already aborted callers,
and synchronous failures/retry/timer cleanup. Two real navigation tests cover a
stalled body that settles as superseded before release, rejected stale cache
publication, and body timeout with failure reporting and retry. These are
controlled tests, not evidence that arbitrary application I/O stops on abort.

Final verification:

- Full framework: `pnpm --filter @cossackframework/framework exec vitest run`,
  **1,426 tests / 67 files**, including all eight new tests.
- `pnpm --filter @cossackframework/framework build`: ESM, declarations and SSG pass.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11 packages** pass.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js
  -t 'parses and navigates typed URL state'`: **2 passed / 26 skipped**. Actual
  generated production Node and native workerd browsers retain their query,
  draft, guarded history, failed traversal and held-response behavior.

Consumer tests ran after the build. No full core/CLI suite or release-wide gate
was rerun. Public documentation describes the response deadline and its limits.
All **58 original IDs**, order and states remain unchanged: **22 checked / 36 open**.
RT-08/RT-09 remain open. Next implement a whole-navigation owner and stage new
components before publication. Guards, imports, bootstrap, render and transitions
still lack a shared bound. Versions stay 0.8.3 until REL-04.

<a id="codex-terminal-disposal-2026-10-03"></a>
## Codex terminal disposal review (2026-10-03)

Author: **Codex**. Reviewed the lifecycle prerequisites for navigation staging
from `7b40e71`. Bootstrap could resume after destroy(), open a transport, mount,
and restore a live phase from the lifecycle stack. A later destroy then repeated
cleanup. Server get/init had the same phase restoration problem across awaits.

Phase restoration now preserves terminal disposal and discards saved phases.
Bootstrap and connectedCallback return immediately for destroyed components.
Bootstrap checks disposal after task scheduling, server get/init, DOM mount and
onMount. Its finally block clears the bootstrapping flag on every exit.

Eight new cases cover an already destroyed instance, disposal at the bootstrap
microtask boundary for HTTP/SSE/WebSocket pages, synchronous task disposal,
onMount disposal before clientInit, and disposal while server get/init awaits.
They verify no late activation, no render or rebootstrap after disposal, and
exactly one cleanup. An initial test run had four failures from fixture assumptions: the mock
renderer does not bind inherited task methods, and a socket legitimately starts
before onMount. Direct fixture declarations and boundary-specific assertions
corrected those assumptions. All final checks pass:

- `pnpm --filter @cossackframework/core exec vitest run`: **1,412 tests / 83 files**.
- `pnpm --filter @cossackframework/core build`: ESM and declarations pass.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1,418 / 66 files**.
- `pnpm tsc --noEmit` and `pnpm typecheck`: root and all **11 packages** pass.

Consumer checks ran after the core build. CLI/native browser suites were not
rerun. No release-wide acceptance or navigation deadline claim follows from
these lifecycle tests. Standard async Tasks run in the background already.
Staging tests must explicitly hold a bootstrap override to prove commit queue
independence. Arbitrary application I/O can continue after disposal.

All **58 original IDs** and their order remain unchanged: **22 checked / 36 open**.
RT-08 and RT-09 stay open. Continue the detailed plan for owned cancellation,
staged publication, retained service contexts, draft edits during staging,
interrupted history and the remaining acceptance matrix. Versions stay 0.8.3.

<a id="codex-pending-history-2026-10-03"></a>
### Codex checkpoint: pending history and module preflight (2026-10-03)

Author: Codex. Continued after `f53961e`. No checkbox closes. The original 58 IDs
remain: 22 checked, 36 unchecked. RT-08/RT-09 are still open. Read the
[criterion audit and next steps](./release-0.9.0-plan.md#rt-08),
[navigation completion work](./release-0.9.0-plan.md#rt-09),
[guard contract](../docs/prevent-navigation.md#guards-during-back-and-forward)
and [Codex handoff](./handoff-0.9.0.md).

Fixed canceled browser traversal leaving the address and visible page at different
queries. Framework history entries now carry an app group/position while retaining
scroll and application state. A guard restores the entry it left. The restoration
popstate does not run guards or fetch again. Confirmation resumes the original
entry without pushing history. Failed fetches or module imports restore the prior
owned entry before error reporting. Unknown positions are not invented. A missing
restoration event fails after two seconds with
COSSACK_NAVIGATION_HISTORY_RESTORE_FAILED; this is only a history-movement bound.
Ownership tokens use getRandomValues so ordinary HTTP browser hydration does not
require secure-context-only crypto.randomUUID.

All requested page/layout imports now resolve before live context/resource/tree
changes and window.__INITIAL_STATE__ publication. A superseded module fails a
sequence check before creating a stale owner. Superseded bootstrap skips the
final framework render. This does not make arbitrary bootstrap or rendering
side effects atomic, cancel application I/O or release a stalled commit queue.

Both generated production Node and native workerd browser fixtures now verify
blocked back, restoration and confirmation of the original entry, preserved
application history state, failed back fetch, and back/replace/forward while an
old actual SSR query response remains held. Declared page/File/layout/service
drafts survive; a later query patch uses the restored query and excludes the
abandoned pending field. Matching resources make zero extra hydration RPCs.
Controlled cases delay page/layout imports, check unpublished SSR state, exercise
history restoration/confirmation and bound a missing restoration event.

Final verification:

- Core build and framework declaration/runtime output builds passed before the
  consumer checks. Generated browser cases build actual client/server artifacts.
- `pnpm tsc --noEmit` and `pnpm typecheck` passed; all 11 package checks passed
  again after the final HTTP-compatible history-token change.
- Full core suite: 1,404 tests in 83 files.
- Final full framework suite: 1,418 tests in 66 files. New cases include guarded
  restoration/confirmation, failed traversal, missing-event timeout, delayed
  page/layout imports and hydration without crypto.randomUUID.
- Full CLI suite: 608 tests in 44 files. Command:
  `pnpm --filter cossack exec vitest run --maxWorkers=2`.
  This includes the wider generated Node/native workerd runtime and retained
  service acceptance that failed at the preceding checkpoint before correction.
- After rebuilding the final HTTP-compatible token change, both production URL
  browser cases passed again using `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'parses and navigates typed URL state' --maxWorkers=1`.
  The three full suites total 3,430 tests; the focused rerun is already included
  in that count, not counted again.
- All four TypeScript examples from the URL-state/navigation guides compiled
  through published exports. Fixture syntax and owned whitespace checks passed.
- All original checklist IDs/order/states remain unchanged: 58 IDs, 22 checked,
  36 unchecked. The seven touched guides/specs have 400 valid local links/anchors.
- No owned build/test process remains. User-owned reports.md/.zcodeignore stay
  excluded from this checkpoint.

Continue RT-08 with changed/nested ownership, actual backend read counts, staged
bootstrap/render/transition acceptance and a criterion audit. RT-09 still needs
owned cancellation/deadlines and a staged tree that lets newer navigation proceed
past a stalled old bootstrap, plus its larger cache/scroll/diagnostic matrix.
Versions remain 0.8.3 until REL-04. No live deployment or publication occurred.

<a id="codex-query-ownership-2026-10-03"></a>
### Codex checkpoint: query ownership review (2026-10-03)

Author: Codex. Continued after `c133495`. No checklist item closes: all 58 IDs
remain, with 22 checked and 36 unchecked. RT-08 is still open. Read the
[updated criterion audit and four next steps](./release-0.9.0-plan.md#rt-08),
[Codex handoff](./handoff-0.9.0.md), [public guide](../docs/url-state.md),
and [migration notes](./migration-0.9.0.md#browser-query-context-and-history).

Fixed the next query integration gaps:

- Typed updateUrlState merges patches against live pending intent in the existing
  navigation owner. Committed readers and address remain unchanged during fetch.
  Guards, failures, disposal and ordinary navigation clear ownership. Later
  patches cannot inherit a disposed owner's abandoned fields.
- Same-page replacement preserves inherited declared ClientState/ClientStore
  values through a local, single-use, class-bound capability. Raw store targets
  receive new owner proxies; File identity survives. SSR internal JSON cannot
  supply drafts. Public state still comes from SSR. Unrelated pages reset drafts.
- Query changes skip the destructive loading component swap. Drafts edited while
  fetching transfer at commit. Browser file-input DOM values do not restore.
- Retained App/layout resources adopt matching SSR entries before query changes.
  Map identity prevents old pending loads from publishing values/errors. Layout
  drafts/services remain. Parent scope, user, runtime, scope/provider and layout
  transport changes invalidate retention. A child page's transport change does
  not invalidate its shared layout's services or pending calls.

Both generated Node and native workerd browsers verify copied query URLs,
Unicode, defaults, ordinary history and replace, native File/page/layout/service
local state, copied-tab isolation and unrelated-page reset. Rapid patches merge.
Guard prevention and a failed fetch leave the committed query intact. A held
actual SSR response lets the user edit a draft while fetching; a newer query
commits first and the late old response cannot overwrite it. Matching page and
retained-layout resources make zero extra hydration /crpc requests. Controlled
core cases also settle old resource values and exceptions after handoff.

The first production URL run used stale framework output and failed before
navigation. Rebuilding the public framework output resolved it. The broader CLI
run then exposed an ownership regression between SSE and HTTP child pages.
The layout identity initially used the page transport. It now uses the layout's
own transport, with a focused regression case and production re-verification.

Final verification:

- Core build and final framework declaration/runtime output build passed before
  the affected production checks. Native cases perform real application builds.
- `pnpm tsc --noEmit` passed. `pnpm typecheck` passed all 11 packages after
  the final ownership fix.
- Full core suite: 1,396 tests in 83 files. The final URL-state hydration and
  published-type fixtures were rerun: six tests passed, including all negative
  updater type cases.
- Final full framework suite: 1,412 tests in 66 files. This includes the new
  layout-transport regression and pending query ownership cases.
- Full CLI suite initially passed 606 of 608 tests in 44 files. Its two failures
  reproduced the same retained-layout service regression in production Node and
  native workerd acceptance. After the fix, both failing cases and both new URL
  production cases passed together: four tests in two files, 25 unrelated tests
  skipped. Command: `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js tests/generated-runtime-build.test.js -t 'builds a generated staging app|reconciles component and service mutations|parses and navigates typed URL state' --maxWorkers=2`.
  The entire CLI suite was not rerun after that focused correction.
- Both TypeScript examples in the revised URL-state guide compile through the
  published package exports. Fixture syntax and owned whitespace checks pass.
- All 58 original checklist IDs/order/states remain intact. The six touched
  guides/specs have 387 valid local documentation links and anchors.
- No owned build/test process remains. User-owned reports.md/.zcodeignore are
  excluded from the commit. No publication or live deployment was performed.

These fixtures do not prove pending back/forward/replace behavior, nested draft
ownership, every scope/transport change, one actual backend read or termination
of application I/O. Arbitrary module/bootstrap/transition failures are not yet
atomic or bounded. Those remain RT-08/RT-09 acceptance work. Continue all other
unchecked tasks and release gates. Versions remain 0.8.3 until REL-04.

<a id="codex-url-state-contracts-2026-10-03"></a>
### Codex checkpoint: typed query contracts and destination contexts (2026-10-03)

Author: Codex. Continued after `25eab9c`. No checkbox closes. The original
58 task IDs remain: 22 checked and 36 unchecked. RT-08 remains open. Read its
[criterion audit and next steps](./release-0.9.0-plan.md#rt-08),
[URL-state guide](../docs/url-state.md),
[migration notes](./migration-0.9.0.md#browser-query-context-and-history), and
[Codex handoff](./handoff-0.9.0.md).

Core now owns defineUrlState, inferred readonly values, UrlStateError and string,
number, integer, boolean, enum, array, optional and synchronous custom codecs.
The portable `/url-state` export has no framework or browser dependency.
Declarations and defaults are snapshots. Parsing uses strict percent/UTF-8
validation, rejects repeated scalars, resets invalid arrays as a whole and reports
field/code issues without query values. Total query bounds throw; field bounds
use declared defaults. Unsupported asynchronous callback results remain observed.
URL patches reject unknown keys, getters, sparse arrays and unsupported values.
Serialization sorts declared keys, omits defaults and retains unrelated encoded
pairs and fragments. Bare array keys distinguish an empty list from one empty
string. Published types reject variable/union extras and invalid custom codecs.

Cossack.urlState caches against the request or browser destination URL. SSR
metadata exposes the public path/query without its internal origin. Browser
bootstrap previously read the old window address before history committed.
Page, App and retained layouts now own the resolved destination. Initial
hydration retains the visible fragment. The production browser fixture first
caught its loss from fragment-free SSR metadata; the fix and both runtimes pass.
Navigation accepts explicit push/replace history. Replacement preserves other
history state, and existing guards and navigation outcomes still apply.

Actual generated Node and native workerd apps execute one shared filtered-page
fixture. Browsers verify copied Unicode/array URLs, invalid page defaults,
back/forward, replacement, preserved fragments and matching query-derived SSR
resources without extra hydration RPCs. Those cases do not prove local draft
preservation, overlapping query patches, retained-layout resource handoff or
stalled query transitions. Normal query navigation still recreates the page.
RT-08 remains open for those original criteria, and RT-09 retains bounded
navigation completion and its larger cache/scroll/transition/diagnostic matrix.

Final verification:

- Core build and framework declaration build passed before consumer checks.
  Generated applications passed actual client and server builds for both runtimes.
- `pnpm tsc --noEmit` passed. `pnpm typecheck` passed all 11 packages.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,391 tests in 82 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,406 tests in 66 files.
- `pnpm --filter cossack exec vitest run --maxWorkers=2`: 608 tests in 44 files.
  This includes both new production Node/native workerd browser cases and all
  existing generated runtime acceptance. The three suites total 3,405 tests.
- New core coverage includes 38 codec cases, three real browser-context cases,
  one real request-context case and one package-export fixture with 17 negative
  type cases. Framework adds two destination/history cases.
- Both TypeScript examples in the URL-state guide compiled separately through
  published exports. The portable entry imported and round-tripped Unicode.
- Review resolved the initial incomplete browser mock locations, the custom
  serializer's inference widening, the narrower navigation test type and the
  fixture's required server$ initial value. Final full suites above passed.
- Syntax, owned whitespace, original task ID/state audit and documentation links
  passed. No owned build or test process remains.

Continue the five concrete RT-08 steps in the plan and all other unchecked
CLI/runtime/service/Cloudflare/release tasks. RT-01/RT-11, plain Node Vite dev,
native Deno/Electron and final release gates remain open. Versions stay 0.8.3
until REL-04. User-owned reports.md/.zcodeignore are preserved. No push,
publication, live cloud changes, external messages or new chat occurred.

<a id="codex-route-boundaries-2026-10-03"></a>
### Codex completion: typed routes and source boundaries (2026-10-03)

Author: Codex. Continued after `b82ba4b` against the original RT-07 criteria.
RT-07 is newly checked. The ledger retains all 58 original task IDs:
22 checked and 36 unchecked. Read the
[criterion audit and implementation context](./release-0.9.0-plan.md#rt-07),
[boundary guide](../docs/routing.md#unknown-urls-and-boundary-identity), and
[migration notes](./migration-0.9.0.md#file-routes-and-boundary-identities).

The new real Node fixture first reproduced the defect: a grouped/dynamic
unknown URL selected the root 404 and omitted its source middleware. Selection
now compiles effective source branches once, retains decoded parameters and
falls back to common ancestry for equally ranked disjoint groups. Boundaries
retain distinct source IDs and stay out of public URL maps. SSR and browser
hydration select the same component. Valid 404/500 documents render during
navigation without entering the successful-page cache. Plain or mismatched
error documents still fail navigation.

Boundary rendering now applies actual layout/page policies and PageOptions.
A request-owned source/index token prevents repeated policies during fallthrough
or error rendering. Short-circuit guards and after-next headers remain intact.
Real HTTP traces prove one global scope and exact layout/page order. CLI source
IDs, middleware counts and source stacks match executed boundary state.
Boundary explanations accept exact source files and reject public aliases.

PageOptions.route never registered a URL and had no in-repository callers.
Its removal has two published negative type cases, three decorator runtime cases
and two compiler inspection cases. The getter case proves no value execution.
File placement remains the URL contract. Import/default aliases remain supported.

Final verification:

- Core full build and framework full build, including SSG, passed after the
  runtime changes. Builds finished before consumer test suites started.
- `pnpm tsc --noEmit` passed. `pnpm typecheck` passed all 11 packages.
- `pnpm --filter @cossackframework/core exec vitest run`: 1,348 tests in 78 files.
- `pnpm --filter @cossackframework/framework exec vitest run`: 1,404 tests in 66 files.
- `pnpm --filter cossack exec vitest run --maxWorkers=2`: 606 tests in 44 files.
  This includes both new generated Node/native workerd fixtures, the final
  middleware inspection comparisons, API contracts and existing production gates.
- The focused production boundary run passed both runtimes before the final
  inspection assertions. Each runtime covers nine unknown URLs, unsupported
  POST fallthrough, 500 error selection, guard denial/allowance, and real browser
  initial hydration, SPA navigation, history and interactive component identity.
- Seventeen pure resolver cases cover ancestry, ambiguity, namespace ownership,
  encoded parameters, malformed escapes and unique nonaddressable source IDs.
  Six navigation cases cover valid documents, identity mismatches and cache rules.
- One CLI inspection case exceeded its five-second deadline when it ran beside
  both full unit suites. The final complete CLI run above passed it unchanged.
- Syntax, whitespace, original task ID/state audit and local documentation links
  passed. The new boundary inspection command runs in direct CLI tests.

This closes the RT-07 criteria only. It does not certify live deployment,
REL-03, native Deno/Electron, incoming disconnect handling or session guarantees.
Versions remain 0.8.3 until REL-04. User-owned reports.md/.zcodeignore are preserved.
No push, publication, live cloud changes, external messages or new chat occurred.
Continue RT-08 and all other 36 unchecked tasks from the detailed plan.

<a id="codex-api-contracts-2026-10-03"></a>
### Codex checkpoint: native API contracts and generated declarations (2026-10-03)

**Author: Codex.** Continued after `7f4ce93` against RT-07.
**21/58 checked, 37 unchecked. RT-07 remains open. No new checkbox closes.**
The [detailed checkpoint](./release-0.9.0-plan.md#rt-07) gives the implementation,
criterion status and the next steps for GLM.

`defineApi` at framework `/api` adds explicit params/query/body schemas and
inferred parsed authorization/handler inputs. Parsing precedes authorization
and mutation. JSON output validates and serializes to wire types; native mode
requires Response and preserves cookies, redirects, status and streams.
Review reproduced discarded context cookies and duplicate native cookie values.
The wrapper now merges those cookies through Hono's finalization exactly once.
The final review also prevents a single explicit generic from erasing output
types, rejects null contract configuration, reports mutable exports unknown,
and checks elapsed time before accepting a late native body.

JSON input reads actual bounded bytes with fatal UTF-8, independent of a claimed
Content-Length. Readers release on errors and deadlines even when source cancel
never resolves. Query arrays are explicit and repeated scalar keys reject.
Abort/deadline owns every asynchronous pipeline phase until headers. Ignored
callbacks remain observed and late native bodies cancelled. Native stream
lifetime, application I/O termination and rollback remain application concerns.
Unexpected callback/output failures retain private diagnostics. Expected public
failures have stable codes, nested location fields and correlated IDs.

The shared compiler inspects canonical factory imports, namespace/const aliases
and default export aliases. Security stubs private API modules before imports
load. CLI apiContracts facts have effective methods/source lines and explicit
unknown dynamic contracts. Generated ApiRequest/ApiResponse use type-only actual
exports from the shared structural route model; no private modules enter runtime
client output. Native default functions use method '*'. Unvalidated handlers and
class modules do not invent validated input/output guarantees.

New acceptance includes 29 controlled runtime cases, 16 AST/security cases, a
published declaration fixture with 16 negative examples, and actual generated
Node/native workerd apps. Both generated imports type-check with six negative
examples. The shared request matrix covers coercion/Unicode, validation, malformed
JSON, wrong media, authorization, cookies/redirects, output privacy and deadlines.
Actual workerd/D1 proves zero mutations after malformed or unauthorized requests
and exactly one after valid input. Client assets lack private sentinels and SQL.

Final verification:

- Framework full build (including SSG) passed before the final API adjustments;
  the final `build:types` passed afterward. Published entries resolve in both
  real generated production builds.
- `pnpm tsc --noEmit` passed. Final `pnpm typecheck` passed all 11 packages.
- Full framework Vitest: **1,379/64 files**, including all new API suites.
- Focused real Node/workerd API suite: **2/2**, 22 existing cases skipped.
- Full CLI regression: **603/44 files** passed before the final elapsed-time
  and mutable-export checks. After those changes, both actual production API
  cases and all three functional module CLI cases passed again (**5/5**, 39
  unrelated cases skipped). The final declaration default/config-null correction
  has focused published/runtime acceptance below.
- After the final generic-default and null-configuration corrections, all four
  targeted framework suites passed (**52/4 files**) and both real generated
  Node/native Worker API cases passed again (**2/2**, 22 unrelated cases skipped).
  The final root/all-package type checks and declaration build also passed.
- JavaScript syntax, original task ledger, local links and owned whitespace
  checks passed. Both new API guide examples also type-check through published
  exports. There is no live deployment or final REL-03 certification claim.

These are local production/native tests, not a live deployment or full release
certification. No original RT-07 boundary criterion is dropped: grouped/dynamic
unknown-URL 404 selection and PageOptions.route remain open. RT-01/RT-11, plain
Node Vite development, native Deno/Electron and every other REL gate are separate.
Versions remain 0.8.3. User-owned reports.md/.zcodeignore remain untouched.
No push, publication, live cloud changes or external messages.

<a id="codex-typed-routes-2026-10-03"></a>
### Codex checkpoint: generated typed URLs and shared route discovery (2026-10-03)

**Author: Codex.** Continued after `d3b8c5b` against the original RT-07 plan.
**21/58 checked, 37 unchecked. No new checkbox closes. RT-07 stays open.**
The remaining API and boundary work appears in the
[detailed checkpoint](./release-0.9.0-plan.md#rt-07).

Review found duplicated CLI URL conversion and a discovery walk that included
co-located tests/declarations and differed on Markdown. Framework `route-codegen`
now owns that Node-only walk. Vite and CLI use the same structural manifest,
component IDs, source layout ancestry and nearest source boundary helper.
Layout/loading globs use the same exclusions. Vite uses its resolved root for
generation, warnings and output, independent of shell working directory.

Core's `/routes` entry owns portable construction and parameter types. Generated
`.cossack/routes.ts` contains public patterns and the core helper. It imports no
application modules. `virtual:cossack-routes` resolves to that actual TypeScript
file. New recipes provide its path mapping, ignore it and generate before checks.
`cossack routes --generate` supports machine output and read-only dry runs.
Ordinary inspection writes nothing. Authored files at the compiler path reject
replacement. Unchanged contracts keep their modification time. Watcher listeners
update additions/deletions and release at server shutdown.

The 35-case core suite includes actual Hono requests and published package
resolution with **16 negative type cases**. Missing, extra, incorrect and erased
contracts reject. Arguments retain union keys before checks. The runtime rejects
sparse/accessor-backed arrays, getters, invalid Unicode and dot segments. It
encodes Unicode, slashes and reserved characters without replacement expansion.
Six compiler cases cover discovery, ancestry, precedence, conflicts, writes,
resolved root and watcher ownership. CLI cases prove validation and output.

Production Node/browser acceptance compares Vite and CLI manifests, deletes the
generated file, regenerates through the actual CLI and type-checks its virtual
import. Aliased default/decorator components execute grouped dynamic pages and
catch-alls. Root/group/page middleware execution matches the inspected source
order. Functional grouped APIs have no component layout stack. Class APIs invoke
the actual `init` alias. The nearest grouped error and root 404 render, and client
assets contain neither private error text nor the Node generator dependency.

Two concrete routing defects were fixed. Node's outer Hono mounting discarded
custom not-found handling. The generated entry now delegates after static assets.
Functional API registration used raw source directories, so API files inside
route groups were omitted. Registration, capability checks and CLI classification
now use the public pattern. Ordinary `/api-products` stays a page.

Final verification:

- `pnpm --filter @cossackframework/core run build` passed.
- `pnpm --filter @cossackframework/framework run build` passed, including SSG.
- `pnpm tsc --noEmit` and `pnpm typecheck` passed all 11 package checks.
- Core Vitest: **1,345/77 files**. Framework Vitest: **1,333/61 files**.
- Scaffold Vitest: **108/4 files**.
- `pnpm --filter cossack exec vitest run --maxWorkers=2`: **599/601 passed**
  before the test-bound fix. All 22 generated production cases and the native
  Worker/peer regressions passed. Two CLI inspection tests exceeded five seconds.
- The unchanged isolated CLI machine matrix passed **43/43** before the bound fix.
- After the fix, `pnpm --filter cossack exec vitest run
  tests/cli-json-matrix.test.js tests/generated-runtime-build.test.js -t
  'cloudflare hides vars|generates typed URLs' --maxWorkers=2` passed **3/3**.
  This reruns both affected inspection cases beside the actual new production app.
- JavaScript syntax, local document links, original task ledger and
  `git diff --check -- . ':!reports.md'` passed.

The initial unrestricted CLI run also passed 598/600 before the final API-prefix
case was added. Reducing workers still left the same two test timeouts. Each
case starts two CLI subprocesses with individual twenty-second deadlines. Their
explicit test bound is now forty-five seconds. Assertions and command deadlines
are unchanged. The focused rerun passed both cases under an actual Vite build.
The entire CLI command was not repeated after this test-only bound change.
No unresolved failure remains from those runs, but this is not a final REL-03 audit.

This checkpoint does not declare native API input/output schemas. The grouped
unknown-URL 404 case and unused `PageOptions.route` declaration still need their
explicit acceptance/decision. Source ancestry alone does not prove unknown-URL
selection. Existing native Worker/D1 suites are regressions, not new native typed
API coverage. Node Vite development, RT-01/RT-11, native Deno/Electron and the
full release gates remain separate. Versions stay 0.8.3. Preserve user-owned
reports.md/.zcodeignore. No push/publication/live-cloud changes or external messages.

<a id="codex-schema-migration-2026-10-03"></a>
### Codex checkpoint: schema-only actions, function fields and private callbacks (2026-10-03)

**Author: Codex.** Continued after `cd478f4` against the original RT-02 criteria.
Only RT-02 newly closes: **17/58 checked, 41 unchecked**. The complete 58-task
plan remains in scope; see its [criterion audit](./release-0.9.0-plan.md#rt-02).

Action input metadata now accepts schemas only. Plain maps reject in public
types and stale JavaScript metadata fails before callbacks or mutation. Form
rule maps retain their existing API. Direct and typed-channel Server decorators
check public function fields, including arrow and generator functions, while
preserving their native return type. Parsed `InputOf` parameters remain the
authored browser/native signature; `RawInputOf` describes boundary values.
Forms normalize values before calls; native APIs explicitly parse/authorize.
JSON date fields need explicit date coercion. The migration and validation
guides now reflect those decisions and the completed resource kit.

Review found two compiler cases: type-only siblings incorrectly kept a private
contract module live, and separate inline type-only imports could preserve an
empty runtime import with verbatim module syntax. Only imports from detached
private modules are normalized; unrelated initializer imports retain their
behavior. Names/aliases come from AST spans, including commented inline types.
Four regressions check actual emitted JS with `verbatimModuleSyntax: true`;
native chunks exclude both private schema/policy sentinels and record SQL.

Review also reproduced exception leakage in **eight failing transport tests**:
a callback's `ClientVisibleError` reached the caller as a public message.
Refinements, structural authorizers and auth-owned lookups/rules now wrap
unexpected exceptions in private errors, retaining `cause` for server logs.
Public validation/HTTP error classes cannot leak their fields, messages, stack
or response through these callbacks. Expected `false` validation/policy decisions
and normalized kit denials retain their error paths. Deliberate public errors
in an action body remain public.

Verified evidence:

- Core: **1,095 tests / 63 files**. Parsed/raw schema and authorizer inference,
  public field negatives, plain-map rejection, cancellation and internal causes.
- Framework: **1,314 tests / 57 files**. Matrix **472**, existing compiler suite
  **167**, plus the policy compiler suite. Method/function-field validation,
  stale metadata refusal and public exception classes are covered across all
  matrix transport/service paths; multipart guards remain covered separately.
- Auth: **145 tests / 8 files**. Policy/lookup exception causes and HTTP middleware
  rejection prevent writes without forwarding a thrown HTTP exception.
- Final generated Node production/browser tests: **2 selected cases pass**, with
  **12 skipped**. Authored/public-export types, HTTP/SSE page/service generator
  fields, multipart schemas and the mutation form's failure/retry flow pass.
- Final native workerd acceptance: **2 tests / 2 files pass** sequentially after
  rebuilding the final compiler exports. Generated staging exercises scalar and
  nested/refinement/enum/literal/optional/null/Date/File guards on HTTP/SSE page
  and service JSON/multipart fields, actual D1 record/audit stability on rejection,
  private public-class exceptions, stream values and browser failure/recovery.
  Native socket cases check parsed fields, nested errors, private exceptions,
  explicit signal abort, no later mutation/terminal reply and successor progress.
  The complete final native run takes about **100 seconds** of test execution.
- Final sequential core/framework builds, root `pnpm tsc --noEmit`, all **11**
  `pnpm typecheck` package configurations and owned-file whitespace checks pass.

Intermediate failures are not final acceptance: the compiler privacy regression
first rejected a type-only sibling module, the initial socket cancellation test
incorrectly awaited a server terminal reply, one fixture cast and a top-level
Oxc option failed TypeScript, and public callback error tests exposed the leak.
The socket fixture now checks native signal abort, suppressed later terminal
frames, unchanged count and successor progress; client cancellation settles
locally. The expanded staging suite reached browser checks but exceeded its old
90-second limit twice, then completed successfully in **91 seconds** with the
larger overall budget. The complete test now permits **180 seconds**, while its
explicit cancellation signal remains **500 ms**. Temporary diagnostic logging
has been removed. This proves explicit cancellation, not native incoming
pre-header disconnect delivery or rollback of ignored application I/O.

Next: finish the remaining RT-03 typed resource/lifecycle criteria with RT-05
task ownership, then continue all unchecked tasks. RT-01's arbitrary action
deadlines/init/restoration/disconnect work, RT-11 session freshness and all final
release gates remain open. RT-07 still owns native API schema declarations and
error response integration; explicit native parsing owns its error mapping.
No full CLI/monorepo/tarball/Deno/Electron release
audit is claimed. Versions remain **0.8.3** until REL-04; no publication or live
deployment occurred.

<a id="codex-resource-policies-2026-10-03"></a>
### Codex checkpoint: typed resource policies and trusted action identity (2026-10-03)

**Author: Codex.** Continued after `49d3236`. Only RT-14 closes on its original
[criterion audit](./release-0.9.0-plan.md#rt-14): **16/58 checked, 42 unchecked**;
all 58 IDs remain. RT-02 migration/native schema work, RT-01 transport deadlines
and disconnect delivery, RT-11 session freshness and later release gates stay open.

Auth now exports `createResourcePolicy<Resource, User>()(rules)` with named action
inference, application-owned record lookup, imperative/API/middleware enforcement
and frozen boolean permissions for UI. Core has an independent structural
`@Server({ authorize })` callback over parsed input, trusted request context and
owned signal. The two router gates and socket dispatch run it before invocation;
forwarded services use their declaring metadata. Direct and typed-channel Server
decorators retain parsed input/authorizer/channel inference. Native internal/API
method calls still require explicit checks; metadata does not wrap them.

Expected denials have fixed 401/403 codes/messages and request IDs. Input owner,
user, tenant and permission state cannot replace lookup or the authenticated
request/socket actor. Nonboolean/malformed metadata and backend exceptions remain
private internal failures. Redaction does not execute arbitrary exception getters.
Cancellation releases stuck lookup/policy ownership, observes late failures and
skips later mutation, without terminating ignored I/O or rolling back callbacks.

Review found Hono private-field getter/method/response-setter calls were using a
proxy receiver. Core's context proxy now preserves the original receiver through
nested socket proxies, verified by real-Hono and native socket tests. Compiler
stripping removes authorization metadata, private transitive callbacks/imports
and dead dependencies used only by server read loaders. Shared client helpers
survive. Static typed-decorator factory, namespace, result and destructured aliases
receive the same classification/stripping. Private contracts retained by exports,
client code or foreign module initializers fail closed.

Verified evidence:

- Core: **1,095 tests / 63 files**. Typed authorizer/channel inference, exact
  service metadata, trusted socket actor over a stale context user, strict
  decision/cancellation/error redaction and native Hono response receivers.
- Framework: **1,294 tests / 57 files**. Matrix **456** covers policy with parsed
  input through HTTP/SSE/component/service/socket/multipart. Separate API/SSR
  tests exercise one kit, request IDs, record reads and permission visibility.
  Policy compiler **11** plus the existing compiler **163** pass.
- Auth: **143 tests / 8 files**, including standalone action/resource/permission
  type negatives, boolean projections, middleware, cancellation and private
  lookup/policy errors. Auth's published main remains its source entry.
- Two affected generated Node production/browser tests pass in separate targeted
  runs: inferred client RPC/upload views and mutation/resource failure recovery.
  Each skipped the other 13 generated cases. No full CLI run is claimed.
- Native workerd staging and socket acceptance: **2 tests / 2 files** pass
  sequentially after final fixture corrections. Published auth/core exports and
  actual D1 records prove owned writes, cross-owner/cross-tenant/anonymous/missing
  denials, forged payload/state rejection and unchanged record versions/audit
  rows on denial through JSON/multipart page/services. Browser HTTP/SSE edits and
  server-derived permission controls pass; API/SSR reads share the kit. Native
  socket peer/reconstruction cases deny forged identity/state without mutation.
  Client chunks contain neither private policy sentinel nor record SQL.
  A second complete staging run passes after the final request/reply body fixes.
- Sequential core/framework declaration builds, root `pnpm tsc --noEmit`, all
  **11** package typecheck configurations and owned-file whitespace checks pass.

Intermediate failures are retained as evidence, not counted as final passes.
The first matrix run failed on a fixture's absent environment and Hono's receiver
defect; both are fixed. Type runs caught factory overload, UUID, fixture dependency,
test environment and optional-param mistakes; final inference/config checks pass.
The first D1 fixture used the wrong write-result member; the correct field is
`result.meta.rowsAffected`. Earlier native runs reached policy checks but had
intermittent lost/empty responses around a test API that ignored its POST body;
merely reading response bodies did not resolve it. The API now owns JSON request
parsing, ignores submitted permission flags, and tests consume/assert every new
reply before audit reads. An empty success request was corrected to `{}`. Final
native verification includes full denial envelopes, not status-only assertions.
This does not claim the broader RT-01 native early-response/disconnect guarantees.

Next: [RT-02 migration/native acceptance](./release-0.9.0-plan.md#rt-02), then the
remaining original plan. Do not reimplement completed RT-14, discard unchecked
tasks or treat these tests as full release acceptance. Versions remain **0.8.3**
until REL-04; no publication, live deployment or cloud resource changes occurred.

<a id="codex-typed-input-2026-10-03"></a>
### Codex checkpoint: typed input and private validator dependencies (2026-10-03)

**Author: Codex.** Continued after `fb927cb` against the original RT-02/RT-14
criteria. **No checkbox closes: 15/58 checked, 43 unchecked; all 58 IDs retained.**
RT-02 now has a concrete typed-input implementation, but shared resource-policy
enforcement remains unfinished. RT-14 stays open.

The prior plain-map contract supplied no schema inference and preserved unknown
keys/extra arguments. New `input` builders infer parsed/raw types, normalize
strict primitive coercions, clone objects/arrays, define optional/null behavior,
and validate nested arrays, enum/literal choices, canonical UTC dates and actual
uploaded Files. Unknown keys reject unless stripping is explicit. Typed contracts
accept one argument. Parsing bounds visits/depth/fields/items/errors and rejects
prototype/accessor/cyclic inputs. Plain maps remain transitional with their old
semantics, explicitly tested and documented; they do not gain these guarantees.

Review found ClientVisibleError rewrote subclasses' prototypes, so validation
errors failed their own instanceof checks. Its constructor now preserves
new.target.prototype. Explicit malformed input metadata previously disappeared
through a truthiness check; it now fails privately before the method runs.

The shared gate passes owned request signals into parsing for component,
forwarded-service, explicit-service and socket actions. Aborted async refinements
release framework ownership before uncooperative callbacks finish, skip later
checks/mutation, and keep late failures observed. Callbacks can use the signal
for cooperative I/O. False creates a field error; exceptions and nonboolean
results stay internal. HTTP cancellation returns 499 with its request ID;
WebSocket calls retain their correlated cancellation protocol. This does not
add arbitrary application deadlines or roll back callback side effects.

Client stripping now follows private module declarations after removing input
metadata, including callback/constants/imports and destructured declarations.
Type-only uses and unrelated local bindings do not retain private code. A
contract exported or still runtime reachable fails the build. Destructured
siblings share removal/liveness. A foreign contract module retained by another
client import also fails, because its initializers cannot be stripped here.
Unsupported private runtime TS enum/namespace/import-equals dependencies fail
rather than emit unstripped initializers. Shared storeRules maps remain suitable
for client forms; the generated mutation recipe uses a separate private schema.

Verified evidence:

- Final core suite: **1,080 tests / 62 files**, including published-declaration
  inference/native-signature negatives, typed parser and forwarded socket guards.
- Final framework suite: **1,243 tests / 55 files**. Shared transport matrix:
  **421** cases; final compiler suite: **163**. Component/explicit-service
  HTTP/SSE/socket and multipart cases cover normalized types, nested errors,
  unknown keys, array/file forgery, excess arguments, internal exceptions,
  cancellation, correlation and no mutation. Router forwarded-service tests use
  typed schemas as well.
- Scaffold: **108 tests / 4 files**, including the updated mutation composition.
- CLI generated/runtime plus deployment acceptance: **15 tests / 2 files**
  (all 14 generated cases and the native workerd staging fixture) after converting
  file actions to schemas. Native HTTP/SSE page/service uploads reject unknown
  fields, forged File metadata and empty arrays with no D1 audit writes. Valid
  Files retain request/ORM context and streaming/disposal behavior.
- After final compiler scope/destructuring hardening and declaration rebuild,
  **2 generated Node production/browser cases** pass again (12 others deliberately
  skipped in that final targeted run). They verify typed RPC/upload UI, private
  validator sentinel absence, direct forged requests, form errors/pending/retry,
  client hydration and real production serving. This is distinguished from the
  earlier complete 15-case run; no full CLI suite is claimed for this phase.
- Sequential core/framework declaration builds, root `pnpm tsc --noEmit`, all
  **11** package typecheck configurations and the owned-file whitespace check pass.

Next: follow the detailed [RT-02](./release-0.9.0-plan.md#rt-02) and
[RT-14](./release-0.9.0-plan.md#rt-14) context. Implement typed resource actions,
app-owned lookup, trusted request identity and consistent pre-mutation enforcement
across API/read/RPC/realtime paths. Add private policy stripping, owned/cross-tenant
and forged-permission acceptance. Decide the plain-map migration and raw proxy
argument typing honestly; native method calls still execute authored code without
metadata validation. Native scalar/refinement/policy acceptance is still open.
RT-01 arbitrary deadlines and RT-11 session revalidation remain separate gates.
Versions stay **0.8.3** until REL-04; no publication or live deployment occurred.

<a id="codex-storage-capabilities-2026-10-03"></a>
### Codex completion: storage guarantees, limiter policies and provider inspection (2026-10-03)

**Author: Codex.** Continued RT-18 after `157573d`. The initial limiter policy
regressions produced **47 failures / 8 passes** in 55 cases. Memory accepted
invalid capacities and grew beyond its cap, concatenated namespace/caller keys
collided, and Redis accepted unsafe URL/token inputs and automatic redirects.
Malformed decorator metadata could also be interpreted as absent limits.

Memory now prunes expiry and rejects new keys at capacity, retaining every live
spent budget and continuing existing increments. Capacities are bounded, keys
and namespaces require bounded valid UTF-8, and KV/Redis validate the final JSON
tuple key before I/O. Evaluated scope/caller keys are framed too. Redis validates
HTTPS, normalized URL size, credentials/query/fragment/control exclusions and
bounded ASCII bearer tokens. Authenticated requests use manual redirects; every
redirect rejects. Null, malformed and unknown/misspelled limiter options reject
before a counter or handler. See the migration guide for the one-time budget
reset and mixed-version rollout implications.

One pure core model declares operation support, millisecond units, locality,
persistence, consistency, logical expiry and atomic increments. Framework
re-exports it; the database adapter declares structural metadata independently.
DO cache get/set never claims atomic increment. KV remains eventual/non-atomic;
database deployment traits and Redis persistence remain unknown. Unknown custom
providers cannot satisfy positive requirements unless their implementer explicitly
declares validated traits. These are declarations, not remote attestation.

Cache configuration/facades and limiter enforcement reject unsupported required
traits before operations, compute callbacks and counter dispatch. Requirements
are snapshotted and cannot be weakened by chained facades or later mutation.
Custom factory construction remains the factory author's resource responsibility.
Runtime inspection consumes no cache operation/quota. The CLI now offers
`inspect providers`/`check providers`, including human and single-envelope JSON
output through the shared command specification. Compiler AST parsing resolves
bounded static cache declarations and public selected Wrangler settings without
executing project code. Dynamic helpers, mutation, escaped/computed registration
namespaces and manual defaults remain conservative unknowns. Credentials and raw
invalid backend values are omitted. Missing selected cache bindings fail checks;
missing optional unselected bindings warn and expose their unavailable status.

Native compiled-library acceptance: two Workers share real KV/DO caches;
inspection units and failed requirements preserve absent values, while supported
DO requirements allow writes visible to the second Worker. Counter/API/socket
fixtures require shared/durable/atomic DO traits and retain spent budgets across
concurrent Workers, actual limiter eviction and reload. The socket eviction names
were migrated to the real framed bucket IDs. Compiled generated HTTP/SSE page and
scoped service calls deny unsupported requirements without D1 writes. The test
counter gate now reads the caller from the tuple instead of matching the obsolete
suffix, preserving actual cancellation/deadline acceptance. Its gated custom
store remains an undeclared test provider, not a distributed/atomic claim.

Final verification:

- Core full suite: **1039** tests / **60** files.
- Framework full suite after the final AST namespace fix: **1187** / **55**;
  RPC matrix **374**, storage AST **13**, cache capability tests **10**.
- CLI full suite: **585** / **43**, including all **14** generated/runtime
  acceptance cases, native storage/counter/socket fixtures and real pnpm release
  installation. After the final conservative namespace/optional-binding/name refinements,
  the affected published-export inspection/command/subprocess suites pass again:
  **85** / **4**, including **18** provider cases, the added optional-store case,
  valid store labels and sanitized invalid literal drivers.
  This split is deliberate; do not merge the added follow-up cases into an
  invented full-suite run.
- Database **87** / **15**, Node adapter **16** / **4**, Deno adapter **16** / **2**,
  scaffold **108** / **4**. Deno tests do not prove execution in a native Deno binary.
- Sequential core/framework/database builds pass. Framework's explicit declaration
  list includes the new storage export; a published-export failure caught that
  omission before it was fixed. Final framework export build, root
  `pnpm tsc --noEmit`, all **11** `pnpm typecheck` configs and owned-file
  `git diff --check` pass. No user-owned report/ignore changes are staged.

Logs: `/tmp/cossack-provider-core-final.log`,
`/tmp/cossack-provider-framework-verified.log`,
`/tmp/cossack-provider-cli-final.log`,
`/tmp/cossack-provider-cli-reviewed.log`,
`/tmp/cossack-provider-{db,node,deno,scaffold}-final.log`,
`/tmp/cossack-provider-{core,framework,database}-build-complete.log`,
`/tmp/cossack-provider-framework-export-final.log`, and
`/tmp/cossack-provider-{root-types,types}-verified.log`.

**RT-18 is complete**, with its original criterion audit in the detailed plan.
The ledger retains every original ID: **15/58 checked, 43 unchecked**. RT-01,
RT-02/RT-14, and REL-02..05 remain open. Actual native incoming pre-header TCP
abort delivery, arbitrary action deadlines/initialization concurrency, live KV
regional/throttling behavior, live Redis readiness/persistence, remote producer
shutdown and native Deno/Electron release gates are not established by this
checkpoint. Package versions remain 0.8.3 until REL-04. No publication/deployment
or push was performed. The next authorization/schema/resource work must retain
these boundaries and the full 58-task scope.

<a id="codex-sse-cancellation-2026-10-03"></a>
### Codex continuation: native coordinator cancellation (2026-10-03)

**Author: Codex.** Continued RT-18/RT-01 after `87495f7`. The coordinator's
promise tail admitted cancelled queued callbacks, retained their queue position,
and had no private cancel protocol for active counter decisions. New Cloudflare
recipes also omitted the incoming request-signal flag.

The coordinator now reserves private operation IDs, rejects duplicates, bounds
all pending entries to 32, and removes cancelled queued entries without invoking
them or releasing another action's slot. FIFO order survives cancellation and
capacity reuse. An RPC abort callback reaches the originating Worker while its
counter guard is pending; an ignoring provider's late reply cannot invoke the
action. Response-body cancellation releases local ownership without awaiting
producer cleanup. Started application methods may finish; no retry or rollback.
`queueStatus()` reports counts and active status without exposing operation IDs.

The router preserves the request/ALS/service context while replacing only the
action signal. Hono proxies now read branded getters on their actual receiver:
the shared matrix exposed three erroneous 500 responses from rate-limit guards.
A real Hono response-assignment regression also reproduced a 500 from the
setter; both context proxies now preserve its receiver. Generated page/service
actions assign a response and verify retained headers. A separate generated-app
test exposed an empty 500 cancellation race. The router
now emits a correlated cancellation response when its signal aborts before the
coordinator response is returned, regardless of which guard/RPC message wins.

Generated Cloudflare configs include `enable_request_signal` alongside their
existing Node compatibility flag. Named environments inherit flags unless they
override them. Preflight rejects a selected coordinator without the flag or with
`disable_request_signal`; artifact checks compare compatibility dates and flags.
Wrangler files remain excluded from template upgrades, including unchanged ones.
Two upgrade regressions prove preservation; existing apps must add the flag
explicitly. Docs explain that migration and the required flag.

Native evidence: two Workers share a real SQLite coordinator. Tests exercise
32-entry saturation, duplicate refusal, removal of 31 queued callers without any
callback invocation, active-counter abort, FIFO progress before provider release,
late replies, and capacity/ID reuse. The compiled generated staging app exercises
explicit middleware request signals through HTTP/SSE JSON/multipart page/service
calls, a cancelled queued SSE caller that never hits its store, and pending
counter deadlines before late success. The no-op cancellation test fake remains
limited to snapshots/publication; these contracts use native workerd fixtures.

**Native disconnect limitation:** actual pre-header TCP disconnect notifications
were not observed on the installed workerd (Miniflare 4.20260722.0), including a
minimal Worker on a direct socket with `enable_request_signal`, with and without
`waitUntil`. Production-router acceptance uses an explicitly aborted request
signal; it does not prove incoming disconnect delivery. Keep that acceptance gap,
remote producer shutdown, arbitrary method deadlines, initialization/restoration,
provider policy/capabilities, and native Deno/Electron gates open. Cloudflare
[documents the required incoming flag](https://developers.cloudflare.com/workers/runtime-apis/request/);
that documentation does not replace this runtime evidence.

Verification after the final response-setter fix:

- `pnpm --filter @cossackframework/framework run build:types` passes before
  dependent consumers run; core exports are unchanged from the prior checkpoint.
- `pnpm --filter @cossackframework/framework exec vitest run` — **1033** tests,
  **50** files; shared matrix **354**. The new real-Hono setter regression failed
  before fixing the proxy receiver.
- `pnpm --filter cossack exec vitest run` — **569** tests, **41** files;
  all **14** generated cases, real-pnpm release fixture, native coordinator/rate
  fixtures and compiled staging JSON/multipart page/service cancellation,
  deadlines, FIFO and response headers pass. Native queue cancellation also
  releases a raw response slot with a never-resolving producer cancel hook;
  remote producer shutdown/first-byte delivery are not claimed for that case.
- `pnpm --filter @cossackframework/scaffold exec vitest run` — **108** tests,
  **4** files, with recipe/provider compatibility-flag assertions.
- `pnpm tsc --noEmit` and `pnpm typecheck` — root and all **11** package configs
  pass. `git diff --check -- docs packages specs` passes; user-owned files are
  excluded. Unchanged core/Node/Deno suites retain their previous checkpoint
  evidence; this slice does not claim a new complete monorepo/release audit.

**Checklist audit:** **14/58 checked; no new checkbox closes.** All 44 unchecked
tasks remain in scope. Next complete provider URL/key/namespace/capacity/duration
policies, cache provider ownership/units, and capability inspection/rejection;
then audit the remaining RT-01/RT-02/RT-11/RT-14 criteria. Versions stay 0.8.3
until REL-04. Preserve user-owned `reports.md` and `.zcodeignore`.

<a id="codex-rate-decision-io-2026-10-03"></a>
### Codex continuation: bounded counter decisions and cancellation (2026-10-03)

**Author: Codex.** Continued RT-18/RT-01 after `14365b3`. Counter clients used
unbounded `res.json()`, did not own a deadline or carry action/request abort,
and could hold the shared component queue while a backend ignored cancellation.
HTTP/service errors before response headers also lost their correlation ID;
six new matrix cases reproduced that gap before the proxy/guard fix.

DO/Redis readers now limit actual bytes to 8192, require strict UTF-8 and EOF,
and reject producer errors after a valid JSON prefix. KV text records have the
same encoded bound before parsing; its structural API still materializes text.
Error and late reply bodies are cancelled, and readers release locks without
waiting indefinitely for a faulty producer's cancel callback. Every framework
counter decision has a five-second default deadline, configurable with
`backendTimeoutMs`; async built-in direct calls support `{ signal, timeoutMs }`
as an optional third `hit` argument. Framework custom stores are raced even if
they ignore the signal. There is no retry or rollback of a charged attempt.

HTTP decisions observe request abort. Correlated socket calls have a dedicated
controller; cancel and peer close/error abort it. Cancelled calls suppress late
frames and release the shared queue. A late KV read cannot dispatch a write;
an already dispatched write can still finish. Router guards recheck request
abort after input validation, before invocation. HTTP/multipart/service proxies
send UUID v4 IDs at dispatch. The server accepts valid UUID v4 IDs and replaces
unsupported input; origin checks and route guards still apply. XHR progress
requests carry the ID too. Server-returned IDs remain authoritative.

Verified:

- Sequential `pnpm --filter @cossackframework/core run build` and framework
  `run build:types` passed. Framework's `pretest` rebuilds declarations; never
  run it while another consumer loads those exports. An accidental parallel
  pretest caused missing-export CLI/type failures; reruns after it finished pass.
- `pnpm --filter @cossackframework/core exec vitest run`: **955** / **58** files.
  **43** new focused I/O cases cover exact/excess bytes, multibyte/invalid UTF-8,
  EOF/errors, headers/body deadlines, early/late abort, uncooperative fetch,
  hanging cancel callbacks, KV read/write ownership and the default deadline.
  Three additional real core dispatch cases cover process close and native
  DO close/error callbacks, queue progress and suppressed late mutation/frames.
- Framework suite: **1032** / **50** files. Shared matrix **354** cases; 12
  additions cover backend and client deadlines/cancellation through HTTP/SSE/
  socket/services, cleanup and following actions before the provider is released.
  Six security cases cover UUID acceptance, replacement and preserved guards.
- CLI suite: **562** / **41** files, including all 14 generated runtime cases,
  native workerd fixtures and the real-pnpm release fixture. A new workerd
  counter-body case consumes real DO streams: oversized, invalid UTF-8, HTTP
  error, stalled and explicitly aborted replies reject with no handler mutation
  and unlocked local bodies. An exact 8192-byte valid reply succeeds. Custom
  fetch cases inside workerd prove late-body disposal for both counter clients.
- Node: **16** / **4** files; Deno: **16** / **2**. Total **2581** across these
  suites. Root `pnpm tsc --noEmit` and all **11** package checks pass. After the
  last type-only test correction, the focused 43-case suite passed again.
- `git diff --check -- . ':!reports.md'` passes. Unrelated `reports.md` and
  `.zcodeignore` remain outside this work.

Limits of evidence: native abort is triggered by an explicit request controller,
not a disconnected external client. Cloudflare incoming disconnect signals need
[`enable_request_signal`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).
The shared matrix's SSE path uses the local backend. Native coordinator queued
cancellation remains open. Cancelling a native subrequest did not invoke the
remote DO producer's JS cancel hook in this fixture; the consumer cancels and
releases its local reader, but does not promise remote producer shutdown.
Custom fetch fixtures are not a live Redis service. KV mocks do not prove
regional consistency, and Deno event tests do not prove native Deno execution.

**14/58 checked; no new checkbox closes.** RT-18 still needs native disconnect/
coordinator acceptance, provider URL/key/namespace/capacity/duration policy,
cache unit/ownership contracts and capability inspection/rejection. RT-01 has
additional lifecycle/serialization criteria. All 44 unchecked tasks remain in
scope; versions stay 0.8.3 until REL-04. Continue from the detailed plan and
[Codex handoff](./handoff-0.9.0.md), without treating this checkpoint as release
completion.

<a id="codex-rate-store-contracts-2026-10-03"></a>
### Codex continuation: request-owned rate stores and validated counters (2026-10-03)

**Author: Codex.** Continued RT-18/RT-01 after `78c208c`. Automatic configuration
silently fell back to memory after errors and stuck to the first environment.
Redis missing results defaulted to count zero; KV corruption restored budgets;
invalid options and custom-store replies could allow or misclassify calls.
The initial 103-case contract suite exposed **91** baseline failures. The initial
44 shared-matrix additions exposed **40** failures across HTTP/SSE/socket/service
RPC. A separate shared-component peer-env test also failed before its fix.

Automatic selection now returns the request environment's store and caches
unchanged binding/credential descriptors in a WeakMap. Each evaluation captures
its selection; another environment cannot replace it. Missing/invalid binding
shapes, unknown/blank/non-string modes (including explicit null), and missing
credentials reject instead of falling back. Repair and binding/mode changes
work. Unconfigured requests use the process memory default. Intentional manual
registration remains a process-wide override, documented as fixed-backend setup.
`configureRateLimitFromEnv(env)` returns a store without global mutation;
`getRateLimitStore(env)` inspects that selection. Without env it returns the
manual/default store. Shared component limits prefer the action context's env
instead of charging the first peer's bootstrap binding.

Runtime windows require positive safe-integer milliseconds; maxima require
non-negative safe integers (zero denies all). Key functions return non-empty
strings and messages are strings. Checks run before counter dispatch. Every
returned counter is validated and snapshotted once before the decision, including
custom getter-backed records. Corrupt KV records reject without overwriting;
malformed Redis results and negative/missing TTL reject without guessed expiry.
Redis uses atomic PEXPIRE with millisecond durations. KV retains records at least
60 seconds while the stored logical deadline controls shorter windows. Redis
explicit-env helpers require that env's credentials, without process fallback.

Final focused evidence: **105** contract cases and one real core socket-dispatch
peer-env case; the shared matrix is now **342** cases with null-mode refusal,
configuration repair, invalid options and malformed replies. It proves sanitized
correlated failures, loading/pending-call release and zero rejected mutations.
Native workerd adds two distinct DO namespace classes to prove binding ownership,
spent counters across two Workers, invalid/missing/null/absent modes and unchanged
mutation counts on denial. Socket workerd reloads into an invalid backend and
returns correlated internal failure with state unchanged. These are local native
runtime proofs; they do not establish live Redis or KV regional guarantees.
No local Redis binary was available; Redis coverage checks the REST contract,
script command shape and checked TTL semantics against primary documentation.

Verified after the final changes: core **908**/57 files; framework **1014**/50;
CLI **561**/41 with four native fixtures, all **14** generated runtime cases and
real-pnpm release validation; Node **16**/4 and Deno **16**/2; sequential core build
and framework declarations; root TypeScript and all **11** package checks.
Deno coverage is through adapter events, not native Deno execution. The earlier
full suites were rerun after the final null/getter audit; no assertions or
runtime deadlines were relaxed. Updated rate guide, architecture, migration,
detailed task plan and Codex handoff.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run tests/rate-limit-contract.test.ts tests/rate-limit-peer-store.test.ts tests/rate-limit.test.ts
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts
pnpm --filter cossack exec vitest run tests/rate-limit-persistence-integration.test.js tests/websocket-peer-integration.test.js
pnpm tsc --noEmit
pnpm typecheck
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm --filter @cossackframework/node-adapter exec vitest run
pnpm --filter @cossackframework/deno-adapter exec vitest run
```

**14/58 checked; no new checkbox closes. All 44 unchecked tasks remain.**
Next own and bound backend response bodies, propagate abort/deadline ownership
and prove no late mutation. Finish provider resource/key/namespace policies,
cache duration conventions and public capability inspection/rejection with RT-18.
Then audit component initialization/restoration concurrency and all RT-01
criteria; continue RT-02/RT-14 policies and RT-11 secrets/session criteria.
Separate Deno/Electron/tarball/live release gates remain. Versions stay 0.8.3
until REL-04; preserve unrelated `reports.md`/`.zcodeignore`. Keep export
generation sequential and out of running tests or type checks.

<a id="codex-rate-window-persistence-2026-10-03"></a>
### Codex continuation: persistent Durable Object rate windows (2026-10-03)

**Author: Codex.** Continued RT-18/RT-01 after `97316b6`. The recommended
strict rate store kept its counter only in memory, so reconstructing the DO
restored a spent budget. All 17 initial unit regressions failed on the original
implementation. The native fixture also failed after actual object eviction:
count 21 became count 1, with a new deadline.

`RateLimitDurableObject` now commits counter/deadline together using its storage
transaction API. Every hit reads durable state; no separate memory cache can
acknowledge a write that failed. Expiry is evaluated inside the transaction,
after a queued storage read. Changing duration during an active window retains
its deadline. A fresh window schedules an alarm; delayed or duplicate alarms
cannot erase a newer window. Storage/alarm-write errors reject the hit.
Corrupt persisted data rejects instead of restoring a fresh budget.

DO windows require positive safe-integer milliseconds within the platform alarm
timestamp range. Direct DO requests reject invalid values with structured 400;
`DurableObjectRateLimitStore` rejects them before binding dispatch and validates
positive integer counter/deadline replies. Other provider/runtime option policies
remain open. New namespace examples use SQLite; the transactional key-value
API also works with legacy DO storage. The first upgrade cannot recover old
memory-only counters. The migration guide states this limit explicitly.

Evidence: **23** focused core cases cover reconstruction, exact expiry, queued
transaction timing, failed counter/alarm commits, corrupt state, invalid windows
and malformed replies. The storage double is not a platform concurrency model.
The published core entry runs in a native workerd fixture with two Workers and
one SQLite DO namespace. A concurrent 20-hit burst yields unique counts 2–21
and one original deadline. Actual DO eviction preserves count/deadline twice;
a forced configuration reload proves Worker memory reset while the durable
window stays spent. Blocked HTTP handlers do not mutate, including after reload.
The existing native socket fixture evicts limiter DOs before anonymous reconnect
and existing member actions; spent budgets remain denied. Its component reset
still uses the earlier forced reconstruction path, not timed hibernation.

Verified after the changes: core **802**/55 files; framework **966**/50; CLI
**561**/41 with four native workerd fixtures, all **14** generated runtime cases
and the real-pnpm release test; root TypeScript and all **11** package checks.
The fixture uses compatibility date `2026-07-29`, the newest supported by the
installed workerd binary. A startup attempt using today's date was rejected;
no platform behavior assertion or test deadline was relaxed.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run tests/rate-limit-persistence.test.ts tests/rate-limit.test.ts
pnpm --filter cossack exec vitest run tests/rate-limit-persistence-integration.test.js tests/websocket-peer-integration.test.js
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 checked; no new checkbox closes. All 44 unchecked tasks remain.**
Next fix explicit missing/unknown backend configuration, environment/store
ownership and Redis/KV/custom-store response and option validation. Then audit
cache/limiter duration conventions, provider capabilities and inspection; do not
claim those guarantees from the native DO fixture. Audit component initialization
and restoration concurrency with RT-01, and continue RT-02/RT-14 policy and
RT-11 secrets/session criteria. Separate Deno/Electron/tarball/live release gates
remain open. Versions stay 0.8.3 until REL-04. Preserve unrelated `reports.md`
and `.zcodeignore`; keep export generation out of running tests and type checks.

<a id="codex-socket-peer-context-2026-10-03"></a>
### Codex review: WebSocket peer context and native Cloudflare acceptance (2026-10-03)

**Author: Codex.** Continued RT-01 after `44bd46f`. Inspection found that
Cloudflare labeled all anonymous sockets as one user, while rebuilt DO contexts
contained only params. Shared process components also reused their first peer's
headers. Custom rate keys and anonymous identity therefore differed from HTTP.

Cloudflare attachments now retain verified peer identity and a filtered upgrade
request snapshot. Anonymous peers have no user, so the default key uses captured
IP headers. A fresh Hono action context exposes that socket's URL, headers,
query, params, user and DO environment through ordinary/generator completion.
Identity in message payloads is ignored. Old sockets without a snapshot reject
before mutation and close 1012 to reconnect. Cookie/Authorization, common
credential headers, handshake noise and internal auth assertions are excluded;
custom headers/query values remain retained. Arbitrary middleware variables,
HTTP request bodies and session revalidation are outside the snapshot contract.

Native workerd exposed the attachment overflow exception as a plain Error,
rather than RangeError. The upgrade now returns `COSSACK_WS_CONTEXT_TOO_LARGE`
with 413 instead of 500 or discarding header key inputs. Identity assertions
are checked for shape/ID consistency before acceptance (`COSSACK_WS_CONTEXT_INVALID`).
Child dispatch receives the peer context; unrelated frames do not deserialize
attachments. Component base context is restored after each queued action.

The process runtime accepts per-client context, either through
`addClient(client, user, context)` or `getContext`. Framework upgrade metadata
includes original page params. Node, its legacy adapter, and Deno pass the
connecting context through shared-component action execution. Libraries retain
structural runtime contracts and do not import the application package.

The new native two-Worker fixture uses published core entries, the real framework
proxy and CossackDurableObject, native WebSocketPair/attachments/storage and a
configured RateLimitDurableObject binding. It proves user/IP isolation,
forged-identity isolation, custom header/param keys, denied calls without
state mutation, cross-Worker/new-component/reconnect budgets, interleaved
peer-aware generators and HTTP limiter/socket counter sharing. Forced component
reconstruction retains native attachments and reloads durable component state;
it does not claim timed eviction or counter persistence across process restarts.
The test-only Worker supplies auth/IP assertions; this is local workerd acceptance,
not live edge deployment or full auth-provider/session-revocation acceptance.

Real Node sockets sharing one Cossack instance verify user/context/header
isolation and custom budgets. Deno event-level tests verify adapter wiring;
Deno execution remains a separate release gate. Framework scope tests prove the
upgrade's context carries decoded params/user/bindings. Core tests cover filtered
snapshots, variable isolation, child forwarding and old-peer refusal.

Verification: sequential core/framework declarations and Node/Deno builds;
core **779**/54 files, framework **966**/50, Node **16**/4, Deno **16**/2,
CLI **560**/40 including the new native peer fixture, both existing workerd
fixtures and all **14** generated runtime cases; root/all **11** package checks.
The first concurrent CLI run hit an existing 5-second inspect test timeout.
Running the full CLI suite alone passed; no production deadline or assertion
was relaxed. Architecture, RPC/WebSocket/rate documentation, migration, detailed
plan and Codex handoff describe the contract and remaining evidence.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/node-adapter --filter @cossackframework/deno-adapter run build
pnpm --filter cossack exec vitest run tests/websocket-peer-integration.test.js
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter @cossackframework/node-adapter exec vitest run
pnpm --filter @cossackframework/deno-adapter exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
git diff --check -- . ':!reports.md'
```

**14/58 checked; no new task closes. All 44 unchecked tasks remain in scope.**
Next audit RT-18 store configuration fallback, backend response validation,
fixed-window persistence under DO eviction, concurrency and per-environment
ownership. The current DO rate counter remains in memory; shared namespaces
are not persistence. Audit component bootstrap/restoration concurrency and all
RT-01 criteria, then continue RT-02/RT-14 policies and RT-11 sensitive old input,
session recipes, rotation/concurrency and revocation semantics. Preserve separate
Deno/Electron/tarball/live gates, versions 0.8.3 until REL-04 and unrelated
`reports.md`/`.zcodeignore`. No push, deployment or publication occurred.

<a id="codex-rpc-json-envelopes-2026-10-03"></a>
### Codex review: ordinary JSON and HTTP failure envelopes (2026-10-03)

**Author: Codex.** Continued RT-01 after `933f12c`. All **35** new real-handler
matrix regressions failed before the fix: malformed service state and redirects
were accepted, diagnostic codes/field errors were copied without structural
checks, and foreign error body IDs were ignored. The server still executed each
call once; this checkpoint fixes client interpretation, without mutation replay
or rollback.

Core `shared/rpc-json.ts` now supplies one decoder for component, SSE and explicit
service ordinary JSON/error replies. Full bodies have a **1 MiB total byte cap**
(`RPC_JSON_RESPONSE_MAX_BYTES`), strict UTF-8 decoding and object-root validation.
Consumption retains cancellation/deadline ownership until EOF and releases its
reader on completion, failure or overflow. State/result/navigation effects follow
validation. Overflow reports `COSSACK_RPC_RESPONSE_TOO_LARGE`; malformed JSON or
metadata reports `COSSACK_RPC_RESPONSE_INVALID`, retaining a known header ID.

Ordinary service replies require an object `_cossack_service_state`; component
replies reject that service wrapper. Redirects contain only a nonempty
`_cossack_redirect` using HTTP/HTTPS or a relative URL. Error code/ID values must
be nonempty strings, messages strings, and field errors objects. Nested field
errors remain JSON rather than imposing unimplemented RT-02 schema semantics.
The error body ID must agree with a known header, or supplies correlation if no
header exists. Ordinary app state named `requestId` remains application data.

Native failures stay opaque even if their body resembles RPC JSON; middleware
non-JSON/empty failures retain generic status/known-ID diagnostics. A malformed
declared JSON failure rejects as invalid. Network body errors report uncertain
outcome without leaking their producer message or retrying. The byte cap does
not stop a server mutation from having already completed; move large bodies to
an HTTP endpoint. RPC documentation, architecture and the draft migration guide
record these behavior changes.

Verification: sequential core build/framework declarations; **775 core tests**
in 53 files, **966 framework tests** in 50 files, **559 CLI tests** in 39 files,
root TypeScript and all **11** package configs. CLI includes both real-workerd
fixtures, all **14** generated runtime cases and the isolated real-pnpm release
fixture. No live deployment or package publication ran. The matrix now has
**294** cases (259 previous + 35 ordinary response regressions). **31** new core
cases cover split Unicode, invalid UTF-8, exact byte boundaries, overflow
cancellation, typed/opaque errors, EOF gating, body failures and public proxy
parked-body cancellation/deadlines. Older proxy tests now use actual Web Standard
Responses instead of object stubs that bypass response-body ownership.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
git diff --check -- . ':!reports.md'
```

**14/58 tasks checked; no additional task closes. All 44 unchecked tasks remain
in scope.** Continue actual Cloudflare WebSocket/DO peer context, anonymous/header
identity, reconnect and custom rate-key acceptance. Audit configured counter
store failure, ownership, persistence and consistency before making stronger
claims. Then audit all RT-01 criteria and continue RT-02/RT-14 policies and
RT-11 secrets/session recipes/rotation/concurrency. Deno execution, Electron
packaging, full tarball/runtime gates and live deployment keep their separate
evidence requirements. Keep versions 0.8.3 until REL-04 and preserve unrelated
`reports.md`/`.zcodeignore`. The detailed plan and latest Codex handoff identify
this stopping point and retain every task's original intent.

<a id="codex-rpc-target-limits-2026-10-03"></a>
### Codex review: child targets and RPC action limit ownership (2026-10-03)

**Author: Codex.** Continued RT-01 after `5fb8af7`. New rate regressions failed
on all four paths: HTTP/service 429 replies lacked a stable code, and socket
calls executed repeated mutations because they never checked `@RateLimit`.
Child tests exposed process-local SSE publishing child state over same-named
page keys, shared page/child method budgets and missing correlated target errors.

Core now shares the counter decision between HTTP and WebSocket execution.
Socket limits use inherited/forwarded action metadata and trusted peer identity
before validation/mutation. Store failures reject with private details redacted.
Server-assigned canonical route ownership supplies one action/class/caller/store
namespace across JSON, multipart and socket dispatch; changing IDs or opening
another socket does not restore the same budget. Renderer parents need not be
Cossack components: owner lookup traverses wrappers without calling missing
framework methods. Page and child classes have separate budgets, while sibling
instances of one child class share theirs. Explicit layout-service budgets belong
to the layout/slot and span its pages. HTTP 429 adds `COSSACK_RPC_RATE_LIMITED`,
request ID and Retry-After; socket errors retain the ID and clean pending/loading.

HTTP/SSE child actions now publish the page root's state to the process-local
SSE store, matching distributed page/target separation. Caller replies retain
child state. Numeric/blank target metadata rejects before dispatch rather than
falling back to root socket execution. Missing children and denied component/
service actions return `COSSACK_RPC_NOT_FOUND`/`COSSACK_RPC_FORBIDDEN` with IDs.
The browser's actual socket message handler routes known-ID malformed frames
before its broadcast type filter; a missing type rejects only its pending call.

Evidence: **259 matrix cases** (56 shared x four = 224, six response-local,
13 raw multipart, 15 multipart client/router, one cross-HTTP/socket budget);
**18 child cases** cover JSON/multipart ordinary/stream snapshots with colliding
keys, bad targets, action allowlists, descendant cleanup, same-named page/child
limits and shared JSON/multipart limits. Separate real socket/core tests prove
caller isolation across connections, forwarded service limits, valid child
dispatch, invalid targets and route ownership through renderer wrappers.

Generated production workerd now accepts one JSON limited call, rejects a
multipart repeat with 429/ID/Retry-After, and proves via D1 that only permitted
actions mutate. A layout service's spent budget persists across HTTP/SSE pages.
The fixture still runs real auth/ORM, distributed SSE, native bodies, multipart
generators, cancellation and Chromium acceptance through published entries.

Verification: sequential core build/framework declarations; full core **744**
tests/52 files, framework **931**/50, CLI **559**/39 (both workerd fixtures and
all **14** generated runtime cases), root TypeScript/all **11** package checks.
The first CLI run exposed a warm-cache dependency in the existing real-pnpm
registry test: a cached release bypassed its local server. Its metadata/content
caches are now test-local; focused and full runs pass. A short wall-clock DO
expiry test also failed once; it now checks exact expiry with a controlled clock,
preserving production behavior. Updated docs, architecture, migration, plan and
Codex handoff describe the verified contract and remaining audit.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
pnpm --filter cossack exec vitest run tests/upgrade-release.test.js
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
git diff --check -- . ':!reports.md'
```

**14/58 tasks checked; no new task closes. All 44 unchecked tasks remain in
scope.** Continue ordinary/error JSON-envelope validation and actual Cloudflare
socket/DO peer context/reconnect/custom-key acceptance, then audit RT-01 against
all criteria. Anonymous/header identity parity and configured rate-backend
failure/persistence/consistency remain unverified; route namespaces do not make
memory counters distributed. Continue RT-02/RT-14 policies and RT-11 session
criteria. Deno execution, Electron packaging, full tarball/runtime gates and
live deployment retain separate evidence requirements. Versions stay 0.8.3
until REL-04; preserve `reports.md` and `.zcodeignore`.

<a id="codex-rpc-protocol-boundaries-2026-10-03"></a>
### Codex review: RPC correlation and terminal response validation (2026-10-03)

**Author: Codex.** Continued RT-01 after `a7da267`. Ten new regressions failed
before the reader fix. Malformed later JSON/UTF-8/frame shapes lost the already
known ID, first frames could disagree with the HTTP response header, and public
clients returned on done before the reader checked trailing frames. This allowed
false success and terminal state hydration despite a malformed response ending.

`readRpcStream()` now seeds correlation from `X-Cossack-Request-Id`, retains the
header/learned ID on parse and reader failures, and holds done/error until EOF.
Trailing bytes/frames reject with `COSSACK_RPC_STREAM_INVALID`; a body failure
reports sanitized `COSSACK_RPC_NETWORK_FAILED` and the unknown server outcome.
Clients keep earlier accepted progress and withhold terminal state. Yields stay
incremental. Regressions also prove cancellation during the EOF wait and body
failures after both done and error. Frame validation requires an object envelope
and non-whitespace request IDs/error codes.

Expanded the real proxy/router/runtime matrix to **242** cases: **52 shared x
four paths = 208**, six HTTP/SSE/service response-local cases, 13 raw multipart
and 15 multipart client/router cases. Fault injection rewrites only correlated
WebSocket action frames; initialization/broadcasts are untouched. Malformed
known-ID frames reject their pending call and release loading; unknown IDs are
ignored without hydrating foreign state. A valid socket terminal frame closes
its own call without waiting for the multiplexed connection to close. HTTP
faults prove rejection before false state, retained earlier progress, one
dispatch and eventual request cleanup. Cancellation is not mutation rollback.

Verified: sequential core build/framework declarations; full core **739** tests
across **52** files, framework **896**/49, CLI **559**/39 including both workerd
fixtures and all **14** generated runtime cases; root TypeScript and all **11**
package checks. Updated RPC guide, architecture, draft migration, RT-01 plan,
checklist status and latest Codex handoff.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts tests/sse-coordinator-transport.test.ts
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
git diff --check -- . ':!reports.md'
```

**14/58 tasks checked; no new task closes. All 44 unchecked tasks remain in
scope.** GLM should continue RT-01 with child/action target isolation and rate
limits through actual proxy/handler fixtures, then RT-02/RT-14 input/file/resource
policies and RT-11 secret exclusion/session recipes/rotation/concurrency.
Published-entry workspace fixtures are not tarball installation or live
deployment evidence. Deno execution and Electron packaging remain REL-03 gates.
Keep versions 0.8.3 until REL-04; preserve `reports.md`/`.zcodeignore` and build
declarations before dependent checks without simultaneous regeneration.

<a id="codex-workers-rpc-acceptance-2026-10-03"></a>
### Codex review: built Workers multipart and native RPC acceptance (2026-10-03)

**Author: Codex.** Continued RT-01/RT-11 acceptance after `b2b566f`. The real
coordinator regression failed: a native Response with the RPC NDJSON MIME type
lost its body. `SseDurableObject.execute()` now checks the reserved
`X-Cossack-Rpc-Response: native` marker before selecting protocol parsing.
Native bodies retain bytes/headers, request ownership and serialization-slot
lifetime. The two-Worker test verifies the body and unchanged authoritative
state, then runs subsequent coordinated actions. The transport unit fixture
uses the same marker distinction.

The generated staging-app fixture now extends actual Vite/Wrangler output with
protected HTTP/SSE pages, a nested service and test-only D1 gate/audit endpoints.
It explicitly sets `NODE_ENV=production`: inheriting Vitest's test environment
previously emitted development client paths, so successful SSR assertions alone
had not proved production browser hydration. It still runs the selected artifact,
real D1/auth, provider handlers and distributed SSE binding without deployment.

Direct multipart calls verify nested Unicode Files, component/service auth and
input rejection, correlated field errors, early cookies, lazy yields/final
results, late-cookie diagnostics and eventual cancellation cleanup. Native
NDJSON, JSON with reserved-looking data, binary bytes and bodyless 204 preserve
their intended body/status/headers. D1 audit writes during generator completion,
page cleanup and service disposal retain the original request path and user,
proving the ORM context survives response ownership. SSR observes authoritative
SSE state after multipart mutations. Gates release finite fixture I/O explicitly;
this does not establish queued callback abort support or mutation rollback.

Chromium hydrates the production hashed scripts and calls public clients.
Component XHR and explicit-service Fetch uploads display the first Unicode yield
before the D1 gate releases, then report final data and upload progress. Native
body calls retain status/headers/bytes. Component and service redirects from
HTTP/SSE pages preserve all four native/helper/flash cookies, render the old
input/message once and consume them before reload. Header tests use the observed
response and final navigation; they never replay an action to collect diagnostics.
Fixture compiler and browser errors are surfaced on failure.

Verified: framework declarations; focused real-workerd fixtures **2/2**;
framework **858** tests/49 files; CLI **559**/39, including both workerd fixtures
and all **14** generated runtime cases; root TypeScript and all **11** package
checks. Core source remains unchanged from the previous 726-test checkpoint.
Updated SSE guide/spec, detailed RT-01/RT-11/CF-06 plans and Codex handoff.

```sh
pnpm --filter @cossackframework/framework run build:types
pnpm --filter cossack exec vitest run tests/deploy-integration.test.js tests/sse-coordinator-integration.test.js
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks checked; no new task closes. All 44 unchecked items remain in
scope.** These tests exercise published entries from the workspace, not installed
tarballs or a live deployment. Deno execution/Electron packaging remain REL-03.
RT-01 stays open for systematic protocol/malformed-frame, rate-limit and
child-target boundaries; continue file/unknown-key/schema policies with RT-02/
RT-14. RT-11 still needs sensitive old-input exclusion, complete session flows,
rotation and concurrency semantics. Keep versions 0.8.3 until REL-04, rebuild
declarations sequentially before dependent tests and preserve unrelated
`reports.md`/`.zcodeignore` edits.

<a id="codex-rpc-multipart-2026-10-03"></a>
### Codex review: shared multipart RPC ownership and streaming (2026-10-03)

**Author: Codex.** Continued RT-01 after `5029287`. The upload path bootstrapped
and dispatched separately, restored only top-level files, omitted the shared
input-validation gate and full layout service ownership, and did not handle
generator replies or await all request cleanup. Ordinary file/native response
tests had not established those contracts.

`/upload` and `/crpc` now share one dispatcher. Transport guards and dispatch
reuse a cached decoder, so authorization still runs before constructors/actions.
Multipart restores nested markers and preserves own `__proto__` data. Invalid
JSON, null/non-array payloads, missing/invalid file markers, extra marker keys,
duplicate metadata and duplicate referenced file parts fail before construction
with `COSSACK_RPC_REQUEST_INVALID` and correlated IDs. Unreferenced file parts
and broad file/unknown-key policies are not settled by this slice.

Component uploads retain scope and page-parameter metadata. Explicit-service
calls now accept nested File/FileList arguments and preserve owner/slot/state.
FileList becomes a File array; raw Blob still rejects. The shared action path
applies `enforceActionInput` before mutation and keeps layout service injection,
request/config/ORM ownership, awaited disposal, native/helper/flash cookies,
redirects and streaming response lifetime.

Fetch is the default multipart transport. Declaring numeric `<method>Progress`
state selects XHR for upload progress. XHR switches to progressive UTF-8 text
at headers for RPC streams, forwards complete NDJSON lines before load and
preserves native binary bodies/headers. Per-frame byte limits still apply,
but XHR retains cumulative browser text and cannot pause network downloads;
it does not have bounded total response memory or Fetch's network backpressure.
The RPC guide explains that tradeoff. Cancellation while the iterator is parked
at a yield now retains its known request ID across all four client paths.

The matrix has **44 shared cases x four paths = 176**, **13 raw multipart**
cases and **15 multipart client/router** cases: **204** total. It tests nested
files, progress, default Fetch, input failures before mutation, early generator
yields, state/final results, cancellation correlation and eventual remote
cleanup. The existing **25** router lifetime cases now run for JSON and
multipart (**50**), covering forwarded/explicit services, validation, request
and ORM context, cancellation/disposal, cookies, redirects, flash and header
writes. Fixture counters now belong to their original requests so delayed
cancellation cleanup cannot contaminate later tests. An explicit completion
gate proves early yields without depending on a timer.

Generated production Node apps compile and run in Chromium. HTTP/SSE component
and scoped-service calls send nested Unicode Files, display the first yield
before final completion, then verify the final result and upload progress.
Existing native-upload acceptance explicitly selects XHR and verifies binary
bytes/status/headers. This establishes Node/browser evidence, not new Workers,
Deno execution or Electron packaging acceptance.

Verified: core build; framework declarations; focused matrix/router **254**;
full core **726** tests/52 files; framework **858**/49; CLI **559**/39, including
all **14** generated runtime cases; root TypeScript and all **11** package checks.
RPC guide, architecture, migration draft, detailed plan and Codex handoff updated.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run tests/rpc-upload.test.ts
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts tests/router-rpc-stream.test.ts
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks checked; no new task closes. All 44 unchecked tasks remain in
scope. RT-01, RT-02 and RT-11 stay open.** GLM should next extend existing built
Workers fixtures for multipart generators/native body consumption, native/helper/
flash cookies, auth guards, D1/request lifetime and distributed SSE. Then audit
systematic malformed data/frames, rate-limit and child-target boundaries and
finish file count/size/type/unknown-key policies with RT-02/RT-14. RT-02 still
needs inferred schema inputs, arrays/files and resource-policy acceptance;
RT-11 still needs secret exclusion, full recipes, rotation and concurrency.
The full release gates and Deno execution/Electron packaging remain required.
Keep versions 0.8.3 until REL-04; regenerate declarations sequentially before
dependent tests. Preserve unrelated `reports.md` and `.zcodeignore` edits.

<a id="codex-rpc-native-response-2026-10-03"></a>
### Codex review: native HTTP RPC response completion (2026-10-03)

**Author: Codex.** Continued the RT-01 audit after `26ec624`. The router forwarded
native Response bodies correctly, but public clients parsed them as state:
JSON could hydrate unintended fields, while text/binary/bodyless responses
failed JSON decoding. The authored client completion type was unknown.

Successful ordinary native HTTP responses now resolve to a local browser
Response. The reserved `X-Cossack-Rpc-Response: native` header distinguishes user
bodies from state envelopes and generator frames before checking MIME types.
Text, JSON (even objects with reserved metadata-looking keys), binary, raw NDJSON
and bodyless 204 responses work. Status/status text and browser-visible headers
are retained. Redirects keep navigating with undefined completion; HTTP error
statuses still reject with their status and known request ID.

Core drains the native body before call completion using a growing byte buffer
capped at 1 MiB. This keeps deadlines, cancellation and server response-lifetime
cleanup active through consumption; unobserved calls drain too. Oversized bodies
reject with `COSSACK_RPC_RESPONSE_TOO_LARGE` and cancel the producer. Larger or
continuous downloads belong to HTTP endpoints. Repeated awaits share the same
local one-use body; clone before multiple reads. Fetch URL/redirect flags are
not preserved. Native bodies never hydrate action state; typed data returns
remain the state synchronization contract.

`RpcResult<Response>` now resolves to `Response | undefined`; generator Response
terminal values remain invalid and infer never. The existing semantic fixture
checks ordinary, mixed, viewed-again and generator cases. WebSocket rejection
now cancels a native body rather than leaving its producer open. Upload XHR uses
arraybuffer and copies all browser-visible headers instead of decoding every
response as JSON text. Its real Chromium binary round-trip preserves bytes,
status, content type and a custom response header. This fixes the native upload
body boundary, not upload request ownership or generator dispatch.

The existing matrix adds 11 cases per transport: five native representations,
unobserved draining, size errors, HTTP failure status, body disconnect, deadlines
and cancellation/body closure. It now has **43 shared cases x four paths = 172**,
plus six multipart cases: **178 tests**. Core reader tests cover exact byte limits,
fragmented one-byte chunks, pre-abort and pending-read cancellation, network
failure and reader release. Existing native-router tests retain request/ORM
context and disposal evidence. Generated Node sources compile before production
HTTP/SSE browsers consume page text and service binary responses, plus a separate
binary upload page. Existing cookie/redirect browser acceptance still passes.

Verified after the final code change: core build; framework declarations;
focused matrix **178**; full core **718** tests/51 files; framework **807**/49;
CLI **559**/39, including all **14** generated runtime cases; root TypeScript and
all **11** package checks. Own-file whitespace checks passed. Updated RPC guide,
architecture, migration draft, detailed plan and Codex handoff.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts tests/router-rpc-stream.test.ts
pnpm --filter @cossackframework/core exec vitest run tests/rpc-native-response.test.ts tests/rpc-client-types.test.ts tests/method-proxy-route-id.test.ts
pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks checked; no new task closes. RT-01 remains open.** GLM should next
address multipart parity in `packages/framework/src/transports/http.ts`. Source
inspection shows a separate bootstrap/dispatch path with no full layout ownership
chain or awaited component-disposal boundary, top-level-only file reconstruction,
no shared `enforceActionInput` gate, and no generator response handling. Add real
client/router tests that fail on these gaps, then share the existing action
ownership/validation/response machinery with JSON RPC. Do not consume generators
into an ordinary JSON result as a substitute for streamed parity. Preserve upload
progress and decide explicitly how its client consumes generator replies.

Verify nested files, malformed input/markers, forwarded and explicit services,
validation before mutation, cancellation/disconnect, lazy generator completion,
request/config/auth/ORM ownership, cleanup on all exits and native/helper/flash
cookies/redirects. Ordinary multipart/native-body tests do not prove these.
Finish remaining protocol diagnostics and Workers/realtime acceptance with RT-11,
including native body consumption through built Workers artifacts. Its secret
exclusion, recipes, rotation and concurrency criteria remain open. Every other
unchecked release task and Deno/Electron release gate stays in scope. Keep
versions 0.8.3 until REL-04; rebuild declarations sequentially before dependent
tests. Preserve unrelated `reports.md` and `.zcodeignore` edits.

<a id="codex-rpc-json-values-2026-10-03"></a>
### Codex review: JSON RPC values and client types (2026-10-03)

**Author: Codex.** Continued the RT-01 wire/type audit after `6433534`.
The old validation/stringify path inspected native values before their JSON
conversion. Dates and custom objects could change shape, hooks could execute
again during encoding, and client types still promised native methods.

Core now owns `snapshotRpcValue` and `snapshotRpcFrame`. HTTP/SSE, service,
WebSocket and ordinary multipart result encoders consume the validated snapshot.
Valid dates become ISO strings; undefined object fields omit, array entries/holes
become null, and top-level void remains undefined. Data/model instances use own
enumerable fields. Custom hooks run once per value location, with the same empty
root result key across envelopes and the nested property/index key elsewhere.
Self-returning hooks work; actual cycles reject. Shared references copy normally.
Lossy non-finite numbers, invalid Dates, opaque/native/binary objects, throwing
hooks/getters and nesting beyond 256 levels reject with sanitized value paths.

Public `RpcSerialized<T>` applies that contract to `RpcResult`/`RpcYield` and
therefore authored `rpc$` inference. Compiler return rewriting uses those same
public helpers. Published semantic type checks cover models without prototype
methods, nested dates, custom and optional hooks, tuples/undefined/null, unknown,
any, self-returning hooks, and generator yields/completion. TypeScript cannot
infer own enumerability: class contracts need an explicit data object or typed
hook. Parameters and hydrated state properties still need JSON representation
annotations; no native Date/model revival is added.

Also fixed state comparisons passing the wrong JSON hook key, own `__proto__`
payload data being lost during file extraction, and WebSocket File/Blob arguments
silently disappearing before dispatch. Ordinary upload serialization failures
now have stable code/path/request ID. Private upload errors are redacted in
development, with original errors retained in correlated server logs. Upload
XHR clients retain the response request ID.

The existing real-handler matrix now runs 32 shared cases across four paths:
128 tests, plus six multipart-router cases (134 total). Production generated
Node browser acceptance executes Date/custom JSON/undefined-array generators
through HTTP and SSE after checking authored TypeScript. No parallel transport
suite replaces the existing matrix.

Verified after the final code change: core build; framework declarations;
focused matrix **134**; full core **710** tests/50 files; full framework **763**
tests/49 files; full CLI **559** tests/39 files, including all **14** generated
runtime cases; root TypeScript and all **11** package checks. Own-file whitespace
checks passed. Updated architecture, RPC guide, migration draft, detailed plan,
and the Codex handoff. Unrelated user files remain outside this change.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts
```

**14/58 tasks checked; no new task is closed. RT-01 stays open.** GLM should
continue with native-response client body consumption and multipart parity.
The router forwarding a native Response does not prove arbitrary bodies work
through a proxy: clients still expect JSON/state and non-JSON bodies can reject
with `COSSACK_RPC_RESPONSE_INVALID`. Decide/document the supported completion
contract and verify it through public clients. Extend multipart coverage to
generators, nested files, scoped ownership/cleanup, cookies/redirects, input
boundaries and errors; the six ordinary-upload cases prove only this slice.
Finish remaining protocol diagnostics and Workers/realtime cookie/header
acceptance with RT-11. RT-11's secret exclusion, recipes, rotation and concurrency
requirements remain open. Continue all other unchecked tasks and REL-02/REL-03
runtime gates; Deno execution and Electron launch/packaging still need evidence.
Versions remain 0.8.3 until REL-04. Rebuild declarations sequentially before
starting dependent tests; do not regenerate them concurrently with those checks.

<a id="codex-rpc-conformance-matrix-2026-10-03"></a>
### Codex continuation: shared RPC conformance matrix (2026-10-03)

**Author: Codex.** Added one conformance suite with 19 identical cases against
HTTP/SSE components, WebSocket dispatch, and explicit scoped services: 76 tests.
Component/service proxies from built core execute the real Hono router; the
loopback WebSocket pair executes the real in-memory runtime/action dispatcher.
Fault injection affects the transport while application methods still run.

Coverage: ordinary results with no yields, yielded/final values and state,
repeated awaits, unobserved draining, catch/finally sharing, validation before
mutation, visible/internal errors, failure after progress, deadlines before and
after headers, cancellation, early iterator return, duplicate consumers, invalid
payload/state/results, uncertain disconnects, loading and pending-call cleanup,
and request versus runtime ownership. Finite delayed application I/O lets
teardown wait for remote cleanup without treating cancellation as rollback.

The common assertions found and fixed service RPC leaking internal stacks in
development and WebSocket serialization errors losing their payload/state path
prefix. Server logs retain the original exception with its request ID; callers
receive the same redacted internal error as component/WebSocket paths. Also fixed
HTTP/SSE/service errors losing the known response ID on invalid JSON, mid-stream
timeout, or disconnect. HTTP IDs can be unknown before headers arrive; local
failures need not have server IDs, and status is HTTP-specific.

Focused matrix: 76 passed. Core build and framework declarations passed. Full
core: 685 tests; framework: 705 tests; CLI: 559 tests across 39 files (all 14
generated runtime cases). Root `pnpm tsc --noEmit` and all 11 package checks
passed. Own-file diff whitespace checks passed; unrelated user files were excluded.
Updated the RPC guide, migration draft, detailed plan, and Codex handoff.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks remain checked. RT-01 stays open.** Its shared matrix acceptance
slice is complete; do not replace it with another parallel suite. Next audit
supported serialization values and corresponding client result/yield types,
including Date/JSON, undefined/void, non-finite and binary values, and custom/model
serialization. Finish protocol diagnostics and Workers/realtime response timing
with RT-11. This suite does not prove physical upgrades or distributed coordination;
production browser, workerd, and release runtime gates remain separate evidence.
Every remaining release task stays in scope; versions remain 0.8.3 until REL-04.

<a id="codex-rpc-response-timing-2026-10-03"></a>
### Codex review: RPC response cookies and header timing (2026-10-03)

**Author: Codex.** Continued the RT-01/RT-11 acceptance audit and fixed these
observable failures:

- Native component/service response cookies were overwritten by Hono's existing
  Context response. Merge their separate `Set-Cookie` values before materialization;
  preserve cookies with `Expires` commas and avoid duplicate identical values.
- Native redirects were followed by Fetch into HTML. Return RPC navigation
  metadata while preserving native, helper, and outgoing flash cookies together.
- Cookies written before returning a lazy generator could also disappear:
  prepared Hono headers were dropped when assigning a raw streaming response.
  Materialize the Context response at RPC entry so the response merge retains them.
- Late cookie/header/flash writes appeared to succeed after headers finalized.
  Core exposes a structural response header state; outer request middleware seals
  it after downstream outgoing middleware finishes and guards `c.header`.
  Cookie/flash helpers reject late writes with `COSSACK_RESPONSE_HEADERS_COMMITTED`.
  Session rotation/destruction check the same guard before storage mutation.
- Background RPC/realtime requests consumed flash meant for a destination page.
  Preserve valid incoming flash for page consumption; clear invalid tokens and
  discard partial outgoing flash on transport HTTP errors (status >= 400).
- WebSocket actions silently serialized native Responses as `{}`. They now fail
  with `COSSACK_RPC_HTTP_RESPONSE_REQUIRED`. Nested Response/Request/Headers
  values produce path-specific serialization errors across the shared walker.
- Component HTTP/SSE, service, and upload network errors now explain that server
  completion is unknown and the framework never retries the operation.

Native router tests cover component/service responses, redirects, multiple
cookies, failed RPC preservation, old input, and early/late streamed writes.
Middleware tests cover all four background endpoints. Session tests verify that
late rotation/destruction leave the original stored row unchanged. Production
Node browser acceptance uses published entries and real generated Vite builds:
both page/service redirects retain HTTP-only cookies, the destination reads
flash/old input once, reload has no flash, early streamed cookies arrive, and late
streamed writes reject. Generated source passes TypeScript checking first.

Verification: core build and framework declaration generation passed. Full core:
685 tests; framework: 629 tests; CLI: 559 tests across 39 files, including all 14
generated runtime cases. Root `pnpm tsc --noEmit` and `pnpm typecheck` passed for
all 11 package configurations. Own-file diff whitespace checks passed; unrelated
user edits were excluded. Documentation covers header timing and adds verified
breaks to the draft migration guide.

```sh
pnpm --filter @cossackframework/core run build
pnpm --filter @cossackframework/framework run build:types
pnpm --filter @cossackframework/core exec vitest run
pnpm --filter @cossackframework/framework exec vitest run
pnpm --filter cossack exec vitest run
pnpm tsc --noEmit
pnpm typecheck
```

**14/58 tasks remain checked. RT-01 and RT-11 remain open.** Next consolidate
the complete transport conformance matrix and supported-value audit. Verify
response timing through Workers/realtime paths; the new browser flow proves
Node HTTP/SSE-backed RPC behavior, not complete runtime parity. RT-11 still needs
password/token exclusion from old input, complete generated flows, and documented
rotation/concurrency behavior. Streaming failures cannot retract sent headers;
raw `Response.headers` mutation bypasses the helper guard. Do not prime generators
to permit late headers or claim cancellation rolls back completed mutations.
Continue every remaining release item; package versions stay 0.8.3 until REL-04.

<a id="codex-authored-rpc-types-2026-10-03"></a>
### Codex continuation: authored client RPC types (2026-10-03)

**Author: Codex.** Added `rpc$`, `RpcResult`, and `RpcYield` through core's public
entry. A client handler can use `rpc$(this.generate(...))` to infer generator
yields and final results from authored TypeScript. It also supports native sync
and async signatures, inherited/generic methods, function fields, and scoped
service calls. The helper returns the same framework operation; duplicate awaits,
cancellation, and failures keep their existing behavior. Native return values and
lookalike calls fail with `COSSACK_RPC_CALL_REQUIRED`. Native Response completions
and broad iterable final results are unknown rather than fabricated client types.

The isolated semantic TypeScript test uses the published entry with no Vite
rewrite. Exact types and expected errors cover arguments, yielded fields,
terminal values, inheritance, generics, function fields, scoped services, catch,
finally, and cancellation. The production Node browser fixture executes inferred
HTTP and SSE generators, decorated page/service function fields, ordinary results,
and repeated awaits; all four actions dispatch once per run. Client chunks omit
both server generator marker strings. Existing WebSocket and service conformance
also consume streaming calls through the helper.

Fixed an actual transport mismatch: ordinary HTTP/SSE JSON calls yielded their
final value, unlike WebSocket and explicit service calls. They now return it only
at completion, matching `RpcCall<Result, never>`. Generator yields remain separate.
See [the client guide](../docs/rpc.md) and [draft migration record](./migration-0.9.0.md).

**14/58 tasks remain checked.** RT-01 stays open for the complete conformance
audit/matrix and native Response/cookie/flash behavior coordinated with RT-11.
Every other unchecked task retains its full scope.

Verification: core build passed; full core 682 tests, framework 617, and CLI 558
passed. CLI includes all 13 generated runtime/browser cases. After strengthening
native Response type safety, the 57 focused RPC/semantic checks and root/all 11
package type checks passed again. `git diff --check` passed. No deployment or
package publishing was performed.

<a id="codex-four-recipe-capabilities-2026-10-03"></a>
### Codex completion: four recipes and shared capability planning (2026-10-03)

**Author: Codex.** Completed the remaining CLI-05 recipes through the existing
registry/composition path. The scoped-service layout owns one service; sibling
pages and a nested component inject it. Real RPC and browser acceptance cover
pending/failure/retry, retained sibling state, disposal on exit, and fresh state
on return. HTTP public state is client-supplied; the example is not durable storage.

Protected-route uses existing auth/database/UI recipes and a layout session guard.
Generated acceptance applies actual migrations, registers and signs in through
real sessions, checks anonymous/nested redirects and coded RPC failures, rejects
forged component identity, and expires the persisted session under a hydrated
page. Fixed the auth-only scaffold's dangling UserRole relation: auth and RBAC
model files, registration, and User relations now follow selected features.

Moved the dependency-free capability model to core's published
`runtime-capabilities` entry; framework re-exports it. Scaffold can now use the
same checker without importing framework. Rendering validates all selected
targets before planning writes. D1 and both Hyperdrive providers plus Desktop
fail with feature/source diagnostics during creation and composition. CLI JSON
preserves the diagnostic code. Recorded older unsupported recipes remain
inspectable with target diagnostics rather than losing their recipe facts.
Build checks retain their defense for manually configured combinations.

All four recipes preserve edited files and behave predictably when reapplied.
The expanded generated fixture passed all 12 production build/runtime/browser
cases. Root TypeScript and all 11 package checks passed. Full scaffold: 108 tests;
core: 676; framework: 617. Upgrade acceptance: 10 tests after adding the new core
dependency to isolated release fixtures. The final full CLI suite passed all
557 tests across 39 files, including the generated browser and upgrade fixtures.
`pnpm tsc --noEmit`, `pnpm typecheck`, and the final diff whitespace check passed.
Core build and framework type generation passed before dependent verification.

**14/58 tasks are now checked.** CLI-05 and RT-25 meet their written criteria.
The broader RT-01/02/03/12/14/29 contracts and every other unchecked item remain
in scope. Deno process execution, Electron launch/packaging, and full release
acceptance remain open. Package versions stay 0.8.3 until REL-04 gates pass.

<a id="codex-mutation-browser-recipe-2026-10-03"></a>
### Codex continuation: validated mutation and browser acceptance (2026-10-03)

**Author: Codex.** Added `cossack add mutation` / `--features=mutation` with a
complete public HTTP submission example. It shares typed built-in form rules
with server input validation, sends an explicit argument snapshot, and excludes
client form/error/pending state from synchronized state. It shows field errors,
disables controls while submitting, preserves failed input, resets after success,
and reports safe generic failures. It returns an acknowledgment without saving
or sending data. Application writes belong inside the server method after
authorization. No database/UI dependency is added; the registry declares HTTP
capability, and composition preserves repeated applications and edited files.

Acceptance runs the actual generated app through published package exports,
TypeScript, production client/server builds, stripped server bodies, SSR, and
real RPC input validation (missing/nonobject/invalid/array/oversized input plus
valid normalized output). Chromium covers both mutation and resource hydration,
client validation without RPC, pending/disabled controls, argument/state
separation, server field errors, failure, preserved input, reset, and retry.
Resource checks also cover filtered/empty results and retained stale data.

The browser fixture found two problems absent from server-only checks. Vite
fixtures inherited NODE_ENV=test and emitted development asset paths; builds
now explicitly set NODE_ENV=production and assert hashed module paths. Core
failed resource loaders updated status without requesting a render, leaving
loading UI visible. Failure now requests an update while the existing ownership
guard prevents obsolete/destroyed loads from changing the current view. A core
regression verifies that only the active failure requests a render. CI browser
installation now precedes CLI tests in both E2E and publishing workflows.

Verification: `pnpm --filter @cossackframework/scaffold test` passed 99 tests;
core build and `pnpm --filter @cossackframework/core test --run` passed 676 tests.
The combined generated-app/inspection/command-spec suite passed 37 tests,
including real Chromium interaction. Bundled route contract checks passed 2
tests. Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck`
passed. Full `pnpm --filter cossack test` passed all 553 tests, including the
generated production browser case. Whitespace checks passed for authored files;
the user's unrelated `reports.md` and `.zcodeignore` remain untouched/uncommitted.
**12/58 tasks remain checked:** CLI-05 still needs two recipes, RT-03 still needs
typed targeting and broader lifecycle coverage, and RT-25 remains open for the
remaining recipe integration audit. Continue all unchecked release tasks.

<a id="codex-resource-recipe-2026-10-03"></a>
### Codex continuation: resource recipe and RT-25 audit (2026-10-03)

**Author: Codex.** Audited RT-25 against its written criteria. Build diagnostics,
published-export fixtures, Desktop's transport boundary, and Workers-free output
are verified. The remaining explicit link is integration with all four CLI-05
recipes; Deno/Electron execution belongs to broader runtime release verification.
The detailed plan now records evidence per criterion rather than stale next steps.

Added `cossack add resource` / `--features=resource`. It creates a database-free
public catalog page using `server$`, explicit dependency tracking, lifecycle
status, loading/stale/error/empty output, and refresh/retry. The registry declares
HTTP capability; composition preserves edited pages and repeat application. CLI
add help now derives feature names from the registry. Existing presets do not
silently gain the new recipe.

Generated-app acceptance checks TypeScript, client and server builds, SSR data,
client stripping of loader data, filtered and empty RPC results, safe failures,
and successful reads after failure. Running generated TypeScript found Hono's
server union incompatible with the Node adapter's concrete Server parameter.
`attach()` now accepts the exact event contract it uses, with no generated casts
and no claim of HTTP/2 WebSocket support.

Verification: 98 scaffold tests and the resource generated-app acceptance pass;
Node adapter build and all 15 adapter tests pass. Combined CLI/generated-app
acceptance passed 36 tests. Root `pnpm tsc --noEmit` and all 11 package checks via
`pnpm typecheck` passed. Browser interactions/hydration are not yet covered
by this recipe's fixture. **12/58 tasks remain checked:** CLI-05 and RT-25 stay open
until the remaining recipe acceptance/integration requirements are fulfilled.

<a id="codex-native-database-capabilities-2026-10-03"></a>
### Codex continuation: native database bindings (2026-10-03)

**Author: Codex.** Added `cloudflareBindings` to the shared capability requirement
model. A selected feature supplies native binding names; Cloudflare checks their
presence and other runtimes report unsupported. No values or resource IDs enter
results. Capability summaries distinguish host support from selected named needs.

Selected D1 recipes declare DB, and Hyperdrive PostgreSQL/MySQL declare HYPERDRIVE.
Both web and Desktop configurations receive those requirements because the ORM
factory is shared. Desktop therefore rejects a retained native provider before
compiling application modules instead of generating an app that cannot supply
its database binding. Inactive database defaults add no requirements. Custom
platform emulation is not advertised as native binding support.

Verification: 97 scaffold tests and 30 framework capability/build tests passed.
The generated-app acceptance suite includes a Cloudflare/D1 application's Desktop
build failing with the manifest source and database/d1 feature in its diagnostic.
CLI metadata tests verify missing native bindings and successful name-only checks.
The generated Desktop test also exposed Cloudflare's Vite plugin running in
Desktop mode and rejecting Electron's external module configuration. The template
now omits that plugin in Desktop mode. A portable Cloudflare application's
Desktop build verifies the correction and checks emitted chunks for Workers-only
imports; the D1 Desktop case reaches the intended capability diagnostic.
Final CLI/generated-app acceptance passed (21 tests). Published framework
declaration/ESM generation, root `pnpm tsc --noEmit`, and all 11 package checks via
`pnpm typecheck` passed.

**12/58 tasks remain checked.** Continue the RT-25 audit against its documented
acceptance criteria and the remaining release tasks. These are configuration
checks; remote resources and Deno/Electron runtime execution are not verified here.

<a id="codex-recipe-requirements-2026-10-03"></a>
### Codex continuation: selected recipe requirements (2026-10-03)

**Author: Codex.** Added the pure scaffold API `recipeCapabilityRequirements()`
and its published declarations. Generated Vite configs now include recipe-selected
requirements for their web or Desktop target. SQLite requires filesystem access
only when database support is selected; a default but inactive SQLite choice adds
nothing. Desktop's native filesystem requirement is restricted to its side target,
so selecting Desktop does not make an otherwise portable Cloudflare web app fail.
Requirement sources point to the recorded `.cossack/scaffold.json` selection.

CLI project inspection exposes these requirements, and route checking evaluates
web requirements using the shared framework capability model. Scaffold declares
feature needs without importing framework runtime code or duplicating runtime
profiles. Existing database provider/runtime validation remains in the registry;
page transports and durable-state needs still come from the shared page parser.

Verification: all 94 scaffold tests passed; package checks via `pnpm typecheck`
passed. Generated-app acceptance includes selecting Cloudflare for a SQLite
recipe and verifying a source-bearing filesystem diagnostic before application
module compilation. The fixture supplies an explicit empty binding list because
its original Node recipe has no Wrangler config; the first attempt correctly
failed earlier on missing configuration. The final inspection/metadata and generated
build acceptance run passed all 31 tests (5 files); root `pnpm tsc --noEmit` also
passed.

**12/58 tasks remain checked.** These are the current filesystem declarations,
not a claim that every future service or provider integration is covered. RT-25
still needs remaining capability/provider audits and runtime acceptance. Deno
execution and Electron launch/packaging remain unverified on this host.

<a id="codex-bundled-route-exports-2026-10-03"></a>
### Codex continuation: bundled route export audit (2026-10-03)

**Author: Codex.** Audited the framework and scaffold TypeScript route trees
against the explicit default-export contract. Eighteen framework demo pages had
only named class exports; they now also default-export their component. Existing
named imports remain valid. Moved `pages/cache-regression/store.ts` to
`stores/cache-regression.ts` and updated its two consumers: the old location
incorrectly registered a helper module as a page.

A regression test uses Vite route discovery and the shared AST inspector to check
all TypeScript pages, layouts, and loading modules in both trees. Functional API
handlers retain their separate contract; Markdown retains generated exports.
The check rejects missing or unresolved default classes without executing page
code or accessing external services. It also catches future helpers accidentally
placed in the route tree.

The full framework build and SSG output passed. Targeted contract checks passed
(2 tests), followed by all 614 framework tests. Root `pnpm tsc --noEmit` and all
11 package checks via `pnpm typecheck` passed after the build.
An initial package type-check overlapped declaration regeneration and saw missing
framework modules; the final verification runs after the build to avoid that race.

**12/58 tasks remain checked.** This fixes shipped examples and strengthens route
contract verification; it does not complete RT-25 or prove every demo's external
integration. Continue selected recipe requirements and runtime acceptance.

<a id="codex-durable-state-capability-2026-10-03"></a>
### Codex continuation: durable page capability (2026-10-03)

**Author: Codex.** The capability audit found that Node/Deno WebSocket support
allowed `stateful: true` pages through builds even though the runtime rejects
that option. Added the shared `durableState` capability: available on Cloudflare
with `COSSACK_OBJECT`, unsupported on Node, Deno, and Desktop.

The shared static page parser now reads boolean `stateful` declarations and marks
dynamic values unknown. Build discovery adds the durability requirement for
stateful WebSocket pages. CLI route metadata exposes `stateful`, inspection adds
source-bearing capability diagnostics, and explain distinguishes durable state
from transport availability. Stateless/process-local pages remain valid. These
checks inspect configuration only; they do not prove remote resource readiness.

Targeted validation passed: 28 framework capability/build tests and 65 CLI
metadata/route/inspection tests. Published declaration/ESM generation, root
`pnpm tsc --noEmit`, and all package checks via `pnpm typecheck` passed.
The full framework suite passed (612 tests). The first full CLI run passed 545
of 546 tests; its multi-subprocess add/remove test exceeded the default five-second
limit. It passed alone in 4.92 seconds. That test now has a bounded 30-second
allowance for its real CLI processes and project snapshots; assertions are unchanged.
The full CLI rerun passed all 546 tests (39 files).

**12/58 tasks remain checked.** RT-25 still needs selected recipe feature
requirements and remaining runtime acceptance. No Deno/Electron execution is
claimed. This closes one capability mismatch rather than the entire task.

<a id="codex-node-development-runtime-2026-10-03"></a>
### Codex continuation: Node development runtime (2026-10-03)

**Author: Codex.** The generated Node dev server now requires the entry's exported
`app` and `runtime`, attaches runtime upgrades, and disposes replaced runtimes on
source reload. Reloads share one promise with a queued repeat, invalidate the SSR
module graph, and clear failed loads so later edits can recover. Previous runtime
cleanup errors are reported without preventing the replacement from attaching.

The HTTP server is passed to Vite's HMR configuration. Removed the old catch-all
upgrade listener, which both rejected Cossack upgrades and attempted to dispatch
HMR through a middleware object. Vite and Cossack now own their respective upgrade
paths. SIGINT/SIGTERM stop reloads, drain runtime disposal, close Vite, and close
the HTTP server, collecting cleanup failures. PORT=0 supports ephemeral test ports.

Verification: all four `packages/cossack/tests/generated-runtime-build.test.js`
cases pass. The new case creates a real project, launches its actual dev script,
connects to Vite's authenticated HMR socket and the Cossack page socket, verifies
state, edits the page, observes old socket closure, and receives updated state on
reconnect. Two rapid writes converge to the final value, HMR remains connected,
HTTP still works, and SIGTERM exits normally without the fallback kill. All 92
scaffold tests and root `pnpm tsc --noEmit` pass. No TypeScript runtime source
changed in this checkpoint.

**12/58 tasks remain checked.** RT-25 remains open for selected feature requirements,
remaining capability audits, and runtime acceptance outside Node. Deno execution
and Electron launch/packaging have not been verified. User actions that never
settle can still delay runtime disposal/reload; no forced timeout is claimed.

<a id="codex-node-guarded-runtime-2026-10-03"></a>
### Codex continuation: guarded Node runtime (2026-10-03)

**Author: Codex.** Added `createNodeAdapter()` with a structural router contract
(no framework runtime dependency). `attach(server, fetch)` routes `/ws/` upgrades
through the complete app and only handshakes after its guarded handler succeeds.
Middleware may reject before or after routing. Handshake headers retain cookies.
The adapter shares pending initialization by route/provider/scope, reserves
capacity, evicts idle components with awaited cleanup, and drains initialization,
active actions, sockets, and services during idempotent disposal. Generated Node
production entries pass this adapter to `createApp` and attach it to their server.
The old registry adapter remains exported but is not used by generated entries.

Real generated-app acceptance exposed compiled page providers still attempting
to resolve Cloudflare bindings during snapshot serialization. Bootstrap now
accepts router-resolved `providerTargets`, which take precedence over provider
binding lookup. SSR and runtime factories pass the authorized process-local scope.
Providers without an explicit target retain their normal resolution behavior.

A full framework build exposed two SSG demos that only exported named classes,
contrary to the default-export route contract established earlier. Both now
export their page as default; the expected SSG artifacts are generated again.
Audit remaining bundled examples separately rather than restoring first-export
selection or hiding missing artifacts.

Validation covers 675 core tests, 15 Node adapter tests over actual sockets,
92 scaffold tests, 608 framework tests, and three generated runtime build cases.
The Node generated case executes HTTP SSR and a WebSocket page's SSR, rejects
untrusted origins and another user's target, and receives a real state snapshot
from the built app. Core/Node/framework builds and root/all package types pass.
Commands: package `build` scripts; core/framework `vitest run`; Node adapter
`test`; scaffold `vitest run`; CLI `vitest run tests/generated-runtime-build.test.js`;
`pnpm tsc --noEmit`; `pnpm typecheck`.

**12/58 tasks remain checked.** RT-25 still needs generated development-server
attachment/reload cleanup (the current dev script rejects Cossack upgrades),
remaining selected recipe requirements, and broader runtime capability acceptance.
Node shutdown must be initiated with `runtime.dispose()` before waiting for an
embedded HTTP server to close. Actions must settle; no forced action timeout is
implemented. Request scheme follows the actual socket, not forwarded headers.
Deno live execution and Electron launch/packaging remain unverified here.

<a id="codex-deno-shutdown-2026-10-03"></a>
### Codex continuation: Deno shutdown and action lifetime (2026-10-03)

**Author: Codex.** Added idempotent adapter `dispose()` and native server lifecycle
integration. Disposal blocks new upgrades, drains pending initialization, closes
clients, waits for in-flight actions and already-retiring entries, and destroys
all cached components. One failed component cleanup does not skip the others;
errors are aggregated. Eviction also waits for active actions, so disconnecting
during a mutation does not destroy its service scope underneath it.

The server wrapper preserves native receivers/properties and coordinates native
`shutdown()` with adapter disposal. Its `finished` promise includes cleanup even
when the native server stops independently. Embedded users may call `dispose()`
directly; HTTP fetching remains usable. Cleanup has no forced timeout: an action
that never settles can keep cleanup pending.

Verification: adapter suite passed (15 tests), adapter build passed, root
`pnpm tsc --noEmit` and all 11 package configurations via `pnpm typecheck` passed.
Six added tests cover pending initialization, active actions, repeated disposal,
late events, rejection of new upgrades, cleanup failure isolation, native shutdown,
and independent native completion. The live smoke fixtures now provide component
cleanup methods. **Deno is not installed here; those live tests were not run.**

**12/58 tasks remain checked.** Keep RT-12/RT-25 open until real runtime acceptance
and the remaining Node integration/capability work are complete. Next wire Node
through the framework's guarded upgrade factory and verify generated applications.

<a id="codex-deno-runtime-eviction-2026-10-03"></a>
### Codex continuation: Deno runtime eviction (2026-10-03)

**Author: Codex.** Deno previously created duplicate components for concurrent
connections to one scope and discarded idle runtime entries without destroying
their components. It now caches pending creation by an unambiguous tuple key,
reserves capacity before asynchronous initialization, and releases reservations
after success or failure. Idle/over-capacity eviction awaits component destruction.
Connections closed during initialization cannot register afterward; late open or
message callbacks do not create new instances. Cleanup failures are reported
without rejecting the close event callback.

Verification: `pnpm --filter @cossackframework/deno-adapter test` passed (9 tests),
`pnpm --filter @cossackframework/deno-adapter build` passed, and root/package type
checks passed. Six new tests use the actual in-memory runtime with mocked Hono
socket events. They verify shared initialization, last-client eviction, awaited
replacement disposal, reserved capacity, failed-creation retry, early/late close,
and cleanup failure reporting. They do not execute Deno or a real network socket.

**12/58 tasks remain checked.** RT-12/RT-25 are still open. Continue with explicit
adapter/server shutdown, waiting for in-flight actions before disposal, and live
Deno acceptance. Node generated applications still need guarded WebSocket wiring.
Idle pruning remains activity-triggered, not timer-driven.

<a id="codex-runtime-websocket-scopes-2026-10-03"></a>
### Codex review: runtime WebSocket service scopes (2026-10-03)

**Author: Codex.** Reviewing the prerequisite for Node realtime integration found
that the framework's runtime WebSocket factory constructed a page without its
ancestor layout service scopes. Bootstrap also received the WebSocket URL context
instead of the original page parameters used by scope authorization.

The factory now builds the root and nested layout scopes, binds authenticated
user/context/environment to each, and injects from the innermost scope. The page
owns cleanup of the scope tree separately from service-state ownership, so layout
services are not incorrectly serialized as page-owned state. Constructor,
bootstrap, or render failures dispose the tree; successful pages dispose it when
`destroyAsync()` runs. Repeated destruction is safe.

Verification: `pnpm --filter @cossackframework/core build` passed;
`pnpm --filter @cossackframework/core test` passed (673 tests);
`pnpm --filter @cossackframework/framework exec vitest run` passed (608 tests);
`pnpm tsc --noEmit` and `pnpm typecheck` passed (all 11 package configurations).
The three new factory tests cover nested service shadowing, page parameters,
auth/bindings, serialization ownership, repeated cleanup, and constructor and
bootstrap failure. They use the real router with a test transport adapter.

**Completion audit: 12/58 checked, unchanged.** This is prerequisite work for
RT-12/RT-25, not live Node WebSocket acceptance. Generated Node entries still need
adapter wiring through the framework's guarded upgrade path. Node/Deno runtime
entry eviction and shutdown must invoke component cleanup; concurrent creation
for a shared runtime key also needs coverage. Do not attach the legacy Node
adapter as-is: it independently constructs context/components and bypasses the
shared router middleware and service-scope path. Retain origin/auth/scope checks,
exercise real connections and shutdown, and then reconcile advertised capabilities.

<a id="codex-generated-runtime-builds-2026-10-03"></a>
### Codex continuation: generated Node/Deno/Desktop builds (2026-10-03)

**Author: Codex.** Added generated-project acceptance using actual scaffold output,
Vite configuration, package exports, client assets, and SSR/desktop entries.
Fixtures build minimal Node and Deno applications plus a Node application's
Desktop side target. All emitted JavaScript chunks in their server/desktop output
are checked for accidental `cloudflare:workers` imports. Desktop rebuilds reject
an added SSE page through the generated mode-specific capability configuration.

The built Node app is imported in a fresh Node process and serves a real Hono
request that must return a rendered HTML document. This exposed a template bug:
the direct-entry guard called `pathToFileURL(process.argv[1])` even when Node eval
or embedding supplied no entry filename. The guard now checks for that argument
first, preserving direct startup while allowing programmatic imports.

This proves build compatibility and Node HTTP SSR, not Deno runtime execution,
Electron launch/native packaging, or WebSocket behavior. Source review also found
that generated Node entries do not attach `CossackNodeAdapter`, despite the runtime
profile allowing process-local WebSockets. Reconcile generated runtime wiring and
capability enforcement before closing RT-25; do not attach the legacy adapter
without auditing authentication, middleware, and service-scope behavior.

Verification: all **3 generated runtime integration cases passed**, including
Node HTTP execution, full emitted chunk checks, and Desktop rejection; complete
scaffold suite **92 passed**; `pnpm tsc --noEmit` passed.
**12/58 tasks remain checked; RT-25 stays open.** Next address Node realtime configuration and selected feature
requirements in recipe planning, then audit the complete RT-25 acceptance set.

<a id="codex-handler-default-parity-2026-10-03"></a>
### Codex review: functional handlers and default component selection (2026-10-03)

**Author: Codex.** CLI inspection/checks now recognize functional HTTP modules
under the same `/src/pages/api/` boundary as the router. Named method exports,
default functions, and locally declared default function references are identified
without execution. They expose `routeStyle: http-handlers`, HTTP transport, no
layout scopes, and `not-applicable` component method/dispatch facts. Explanations
do not attribute their transport to a nonexistent decorator. Identical source
outside the functional API boundary does not bypass component checks.

Build discovery uses that same classifier and boundary. The router, SSR layout
selection, RPC transports, SSG discovery, client navigation/loading, and Durable
Object component lookup now use a common default-export selector instead of the
first enumerated module value. A named helper can no longer change the selected
component. Component modules need default exports; named functional API methods
remain supported independently.

Runtime regressions insert a throwing named helper before the real default
page/layout. Actual SSR, SSG discovery, and transport guard paths select the right
component; functional HTTP requests still work. These close the two acceptance
gaps found during generated-app verification. Unsupported/dynamic forms remain
explicitly unknown rather than being executed to obtain metadata.

Verification: complete CLI suite **539 passed across 38 files**, including
generated staging deployment/Worker integration. Complete framework suite
**605 passed across 46 files** after component selection changes; final targeted
module/guard/build suites **26 passed** after functional default-handler support.
Framework declaration build, root TypeScript, and all **11 package type checks
passed**. **CLI-04 is complete again; 12/58 tasks are checked.**
RT-25 still needs full generated application/side-target coverage and feature
planning requirements. Browser and production release gates stay open.

<a id="codex-recipe-capability-wiring-2026-10-03"></a>
### Codex continuation: recipe wiring and environment binding discovery (2026-10-03)

**Author: Codex.** Generated Vite configurations now enable capability checks
for their selected web adapter and switch to Desktop's HTTP-only profile in
desktop mode. Markdown composition preserves the capability option. Bindings are
not baked into templates.

When explicit binding names are absent, Cloudflare builds load the project's
installed Wrangler parser and read its configuration for `capabilities.environment`
or `CLOUDFLARE_ENV`. Unknown environments fail. Wrangler's non-inherited binding
rules remain authoritative; resource values and variables never leave the helper.
Missing configuration/dependencies and parser errors fail without secret-bearing
configuration excerpts. Node/Deno/Desktop do not load Wrangler for these checks.

Published-export Vite builds prove that root SSE bindings work but do not satisfy
an environment that omits them. Additional real-parser tests cover names-only
output and safe parser errors. Recipe tests cover all adapters with and without
Markdown plus feature addition/removal.

Generated-app validation exposed named HTTP handler files in the route set.
Build discovery now recognizes their named method exports and treats them as HTTP
without requiring component decorators. This also revealed two remaining CLI-04
acceptance gaps: CLI checks still apply component metadata requirements to these
modules, and router selection through the first module export can differ from
inspection's default-export choice. **CLI-04 is reopened; 11/58 tasks are checked.**
Fix these discrepancies before claiming full inspection/runtime parity.

Verification: **92 scaffold tests**, **18 binding/build tests**, and the complete
generated staging deployment/Worker integration passed. The broader CLI run
passed 535 tests and exposed the named-handler build failure; that previously
failing integration passed on its own after correction. Framework declaration
build, root TypeScript, and all **11 package type checks passed**.
**RT-25 remains open.** Next verify complete generated applications through their
actual generated configuration, including Desktop side targets, and add selected
feature requirements to recipe planning where needed. A small Vite transport
fixture is not proof of full application or native packaging compatibility.

<a id="codex-page-capability-discovery-2026-10-03"></a>
### Codex continuation: shared source parser and page capability discovery (2026-10-03)

**Author: Codex.** Moved the CLI's AST page inspection implementation into the
published framework `page-inspection` subpath. The CLI retains a thin re-export,
so build and inspection share option selection, aliases, unknown handling,
default-export facts, and compiler-backed method classification. No application
runtime depends on the CLI or scaffold package.

With `capabilities.runtime` configured, `cossackPages` now derives page transport
requirements automatically from the Vite root's route set. Explicit requirements
remain optional additions. Source parsing never instantiates pages. Dynamic or
unresolved options fail with `COSSACK_CAPABILITY_REQUIREMENTS_UNKNOWN`; generated
Markdown uses its fixed HTTP transport. Build errors identify the authored page
and decorator line. Existing route exclusions also apply to discovery.

Real published-export Vite fixtures prove automatically discovered Desktop SSE
rejection, selected Cloudflare binding requirements, aliased decorators, unknown
options, and non-execution of a throwing page constructor. CLI source-inspection
regressions exercise the moved implementation through its public export.

Verification: complete framework suite **597 passed across 44 files**; complete
CLI suite **536 passed across 38 files**; framework declaration build, root
TypeScript, and all **11 package type checks passed**. Published-export build,
capability, and service acceptance focused suites also passed (23 tests).
**12/58 tasks remain checked; RT-25 remains open.** Next wire runtime/binding selection into recipe
output and resolve selected-environment bindings. Full generated application
build and runtime acceptance still remain; these fixtures prove build checks.

<a id="codex-schedule-capability-2026-10-03"></a>
### Codex review: adapter-dependent schedule capability (2026-10-03)

**Author: Codex.** Auditing Node/Deno adapter source found no scheduled-handler
dispatch, although both profiles advertised it as available. The shared model
now reports `adapter-required` for their scheduled handlers. This differs from
Desktop's unsupported capability and Cloudflare's platform support. Selected
schedule requirements produce `COSSACK_CAPABILITY_ADAPTER_REQUIRED` with the
feature and source location; real Vite builds reject them before output.

This does not introduce a scheduler or a flag that pretends an integration is
installed. Future scheduling work must supply and validate that integration
before the capability can become available. Unrelated HTTP routes remain valid;
CLI summaries show the missing schedule integration without failing those routes.

Verification: shared capability and real-build suites **18 passed**; CLI runtime
metadata and inspection suites **17 passed**; framework declaration build, root
TypeScript, and all **11 package type checks passed**. **12/58 tasks remain
checked; RT-25 stays open.** Next integrate automatic page requirements and
recipe-generated configuration with the build checker. Selected-environment
binding resolution and complete generated-app acceptance are still required.

<a id="codex-capability-build-2026-10-03"></a>
### Codex continuation: selected build capability requirements (2026-10-03)

**Author: Codex.** Added `checkCapabilityRequirements` to the shared runtime
model. Selected feature declarations carry requirements and file/line/column
locations. The checker returns all unsupported or missing-binding diagnostics,
with names only; false requirements are omitted. It is reusable by build and
recipe consumers without importing application modules or Cloudflare APIs.

`cossackPages({ capabilities })` checks those declarations in `buildStart` and
fails before bundle output. Documentation shows explicit runtime, binding names,
and selected feature requirements. Real Vite builds exercise Desktop SSE
rejection, missing Cloudflare SSE bindings, supported HTTP builds on all four
runtimes, and a supported Cloudflare SSE configuration. An unused module importing
`cloudflare:workers` does not enter portable fixture bundles.

This is enforcement of supplied requirements, not automatic discovery. RT-25
remains open: connect scaffold registry selection and generated Vite configs to
this API; derive page requirements from shared compiler metadata; resolve bindings
from the selected environment; audit adapter-dependent capabilities; and verify
complete generated application builds. Do not claim these small build fixtures
prove application transport execution or all package graph boundaries.

Verification: framework declaration build passed; capability/model suite
**15 passed**, including real Vite builds through published package exports;
complete framework suite **590 passed across 44 files**. Root TypeScript and
all **11 package type checks passed**.
**12/58 tasks remain checked.** The full release goal remains active.

<a id="codex-module-inspection-2026-10-03"></a>
### Codex review: module validity and CLI-04 acceptance audit (2026-10-03)

**Author: Codex.** Pages and layouts now expose `moduleExport` facts. Checks fail
for missing default exports or exports that do not resolve to a local class.
Direct, identifier, and local export-clause class defaults resolve without
execution. Dynamic/default factory exports and external re-exports remain
unknown. Inspection stays readable for invalid modules. The no-parser fixture
now covers module facts too.

Dynamic service references (computed properties, optional access, or calls)
produce unknown options. Undecorated derived layouts do not borrow metadata from
a decorated base. Service explanations explicitly identify source expressions
and do not claim to resolve runtime token identity across aliases/imports.

CLI-04 requirement audit:

- Shared model: route commands consume `buildEffectiveRouteModel`; compiler facts
  come from the published security-plugin analysis, recipes from the shared
  scaffold registry, and transport capabilities from the runtime model.
- Facts, diagnostics, explanations: inspection/check commands share that model;
  checks fail on missing or unknown facts, invalid declarations, and unsupported
  or missing-binding transports. Explanations carry source locations and reasons.
- No application execution: inspection fixtures contain throwing constructors;
  source import resolution reads files without loading application modules.
- Combined acceptance: `inspection-acceptance.test.js` covers grouped routes,
  nested layouts, declared services, mixed methods, resource expansion, scaffold
  recipes, and actual compiler stripping output. The companion framework
  `inspection-service-acceptance.test.ts` executes the inspected sources through
  SSG and proves service sharing/shadowing, owner IDs, state, disposal, and
  check/explain behavior against the same project.
- Unsupported cases: parser failure, dynamic options, unresolved inheritance,
  ambiguous source resolution, missing/unknown exports, and dynamic service
  references have explicit unknown facts or source-bearing diagnostics.

This completes CLI-04's inspection/check/explain contract, not the broader
RT-07 typed-route/API generation, RT-24 configuration registry, RT-25 build/recipe
gating, or browser/production runtime release gates. Those tasks stay open.

Verification: complete CLI suite **534 passed across 38 files**; the executed
framework service acceptance fixture passed again; `pnpm tsc --noEmit` passed.
The preceding service checkpoint verified all 11 package type checks; this
checkpoint changes JavaScript and documentation only.

**12/58 tasks are now checked. CLI-04 is complete.** Next continue RT-25
build-time and recipe capability enforcement, reusing the existing runtime
capability model. The full release goal stays active.

<a id="codex-service-inspection-2026-10-03"></a>
### Codex review: executed service inspection acceptance (2026-10-03)

**Author: Codex.** Added a framework/CLI integration fixture that writes grouped
route and nested layout sources, emits those same sources with TypeScript legacy
decorators, and renders them through the real SSG renderer. It verifies inner
layout shadowing, page sharing of the inner instance, owner IDs, per-owner
hydration state, and inner-to-outer disposal. Check and explain commands run
against the same source project. This is actual SSG/bootstrap execution, not a
full Vite application build or browser navigation test.

The fixture confirmed that page-level `services` declarations do not create a
scope in either router or SSG bootstrap. Route checks now fail with
`COSSACK_PAGE_SERVICES_UNSUPPORTED` and explain how to move declarations to a
layout; inspection explains that the page does not own them. A throwing service
constructor proves SSG does not instantiate a service merely listed on the page.

Also fixed selection of the inspected class: indirect local default exports now
select their actual class, even when an exported decorated helper comes first.
Undecorated, dynamic, or external default exports no longer borrow that helper's
options or methods. Regression cases cover both default export syntaxes.

Verification: SSG/service acceptance suites **11 passed**; all **11 package type
checks** and `pnpm tsc --noEmit` passed. Full CLI suite: **517 passed across
37 files**. The service integration test also passed again after the default
export selection fix.

**11/58 tasks remain checked; CLI-04 remains open.** Next audit module validity
(missing default exports still allow syntax-only inspection), inherited layout
options, and service token identity across imports before treating inspection as
complete. Keep browser/SSR lifecycle release gates separate from this SSG test.
RT-25 build/recipe capability gating also remains unfinished.

<a id="codex-inspection-acceptance-2026-10-03"></a>
### Codex review: combined inspection fixture and middleware order (2026-10-03)

**Author: Codex.** Added a combined project fixture covering grouped routes,
nested layouts, declared services, recorded scaffold features, imported base
methods, resource expansion, and mixed client/server methods. Inspection reads a
page whose constructor throws without executing it. The fixture compares method
facts with the published compiler transform and checks that private bodies are
removed while reachable client helpers remain.

The fixture exposed missing layout middleware facts. Inspection now reports
layout/page middleware counts in execution order: outer layouts, inner layouts,
then the page. An unresolved layout keeps the total unknown. Explanations
explicitly exclude global bootstrap middleware from this result.

Verification: focused acceptance/inspection/scanner suite **53 passed**;
`pnpm tsc --noEmit` passed; full CLI suite **512 passed across 37 files**.
The full run also exposed a stale contract test that rejected the now-supported
`inspect routes --env=production`; it now checks rejection of a missing environment
value instead.

**11/58 tasks remain checked; CLI-04 remains open.** This fixture validates
compiler output and static declarations, but does not instantiate a complete
application to verify service ownership and DI/bootstrap behavior. GLM should
extend it with real layout/page service resolution, compare the reported owners
with executed behavior, and exercise check/explain diagnostics on the same
project. Keep unsupported project resolution explicit; do not equate declared
member precedence with constructor or decorator side effects. RT-25 still needs
build/recipe capability gating. No release versions changed.

<a id="codex-inherited-options-2026-10-03"></a>
### Codex review: inherited options and action receivers (2026-10-03)

**Author: Codex.** Core timeout lookup, component proxy/bootstrap metadata, and
service bootstrap/disposal previously read only the nearest server-method map.
They now share a hierarchy collector that retains inherited declarations,
preserves their timeout/channel/provider/input options, and lets the nearest
explicit method declaration win without mutating ancestor maps. Compiler-generated
registration also copies inherited options instead of replacing them with default
channel/provider metadata.

A real derived component dispatched through `InMemoryWebSocketRuntime` exposed
another bug: an inherited state-changing action was invoked without its component
receiver because only the nearest prototype had been auto-bound. RPC execution
now applies the action with the component receiver. The regression proves
inherited input validation, ordinary state mutation, and successful results when
the child owns an unrelated server-method map. A separate loopback regression
proves inherited timeout enforcement for a derived client metadata map.

Verification: complete core suite **673 passed**; complete framework suite
**581 passed**; core build, framework declaration generation, root TypeScript,
and all **11 package type checks passed**. The compiler
execution fixtures also verify inherited channel/timeout retention for server and
client output, while unit metadata tests verify nearest-declaration precedence
and ancestor isolation.

**11/58 tasks remain checked.** These fixes improve actual inheritance behavior;
they do not by themselves complete CLI-04's grouped-route/layout/service acceptance,
full DI/bootstrap lifecycle, or remaining runtime/release requirements. Continue
that acceptance fixture using the shared compiler/scaffold/runtime model.

<a id="codex-inherited-rpc-2026-10-03"></a>
### Codex review: inherited compiler RPC registration (2026-10-03)

**Author: Codex.** Executing compiled inheritance fixtures exposed a runtime bug
that text assertions missed: registration inserted before `super()` accessed
`this.constructor`, which throws in derived constructors. Generated constructors
also dropped arguments, and child automatic RPC registration omitted base-class
methods.

Registration now uses `new.target`, which is valid before `super()`, so the full
derived registry is available during base construction. Generated constructors
forward arguments. Static registration chains through the superclass before
adding local methods, preserving child metadata without contaminating the
parent's own registry.

The new tests run both server and client compiler output through Vite's TypeScript
transform, execute explicit and generated derived constructors, verify arguments
and registration during base construction, and call inherited/local server bodies
or client proxies. Parent metadata remains independent. These fixtures prove
compiler registration behavior; they are not a full Cossack bootstrap/DI test.

Verification: focused compiler suite **154 passed**; complete framework suite
**581 passed**; declaration generation, root TypeScript, and all **11 package type
checks passed**.

**11/58 tasks remain checked; CLI-04 remains open.** Next verify inherited
per-method options and actual framework bootstrap/dispatch. In particular,
`serverMethodTimeout` still reads the nearest `Reflect.getMetadata` map; inherited
options must be checked when a derived class owns another metadata map. Then
complete the grouped-route/layout/service acceptance fixture and remaining gates.

<a id="codex-runtime-inspection-2026-10-03"></a>
### Codex continuation: binding-aware transport inspection (2026-10-03)

**Author: Codex.** Published the shared runtime-capability module and included it
in declaration generation. Corrected its transport model: Node/Deno support the
`durable-object` transport through process-local adapters, while durable
cross-instance coordination remains unsupported. Requested transports are now
actually evaluated. Cloudflare SSE and Durable Object transports require
`COSSACK_SSE` and `COSSACK_OBJECT`, respectively; HTTP requires neither.

Route listing, inspection, checks, and explanations consume this model. Runtime
selection reuses scaffold detection. Cloudflare binding names come from the
existing Wrangler-backed deployment inspector. `--env` or `CLOUDFLARE_ENV`
selects the configuration environment. Missing route bindings and unsupported
transports produce failing diagnostics. Unreadable bindings remain unknown;
an undetected runtime is not guessed. Only binding names are passed to capability
evaluation; configuration values and raw parser errors are excluded.

Results explicitly describe configuration presence, not provisioned remote
resources, correct adapter installation, durable Node/Deno state, or successful
runtime execution. General capability summaries do not replace per-route checks.

Verification:

- Runtime capability suite: **7 passed**.
- Six CLI inspection/route/command/subprocess suites: **110 passed**.
- Final metadata/inspection suites: **15 passed**, including a new real Wrangler
  parser fixture proving named-environment non-inheritance and redeclared SSE
  binding availability, plus the route explanation result.
- Framework declaration generation, root TypeScript, and all **11 package type
  checks passed**. The initial CLI run caught the missing declaration-build entry;
  that packaging omission was fixed before the successful runs above.

**11/58 tasks remain checked.** CLI-04 now has shared compiler, scaffold, and
runtime transport facts, but its full grouped-route/layout/service acceptance
and actual inherited framework RPC behavior still need verification. RT-25 remains
open for build-time and recipe gating. Continue those requirements; do not infer
remote deployment readiness from local binding presence.

<a id="codex-declaration-dispatch-2026-10-03"></a>
### Codex continuation: declared member precedence (2026-10-03)

**Author: Codex.** Effective route inspection now includes `declarationDispatch`,
using compiler member facts across local and imported bases. It resolves child
prototype overrides, same-class getter/setter pairs, replacement of inherited
accessor descriptors, and instance fields that shadow prototype members. Derived
fields replace base fields. Static/private members are excluded. Entries identify
the declaring class and source file.

Tests compare these precedence rules with actual JavaScript class instances,
including a base field shadowing a child method and a child setter removing an
inherited getter. A compiler-backed imported-base route fixture verifies model
integration. Erased TypeScript `declare` fields do not participate. Constructor
parameter properties, computed names, missing member facts, and unresolved bases
produce unknown results. `check routes` fails with
`COSSACK_ROUTE_DISPATCH_UNKNOWN` when declaration precedence is unknown.

This is explicitly declaration precedence, not proof of constructor, decorator,
initializer side effects, later property mutation, or framework RPC installation.
Those runtime effects must not be inferred from a resolved static result.

Verification: compiler suite **150 passed**; dispatch/route/inspection suites
**55 passed**; declaration generation, root TypeScript, and all **11 package type
checks passed**. The complete CLI subprocess suite passed **38 tests**, including
failing diagnostics for unknown declared precedence.

**11/58 tasks remain checked; CLI-04 remains open.** Next integrate binding-aware
capabilities and verify the complete grouped-route/layout/service fixture,
including actual framework inherited RPC behavior and explicitly unsupported
runtime mutations. Static declaration precedence now has runtime-language tests;
the larger framework acceptance requirement remains open.

<a id="codex-member-facts-2026-10-02"></a>
### Codex continuation: compiler member facts for dispatch (2026-10-02)

**Author: Codex.** Added compiler member inventory to own and inherited route
metadata. Members distinguish ordinary methods, fields, getters, setters,
static members, private names, and unknown computed names. The inventory uses
expanded compiler classes: a `server$` field becomes a getter rather than being
misrepresented as an instance field. Imported base declarations retain their
member inventory through source resolution.

This is necessary input to effective dispatch resolution. A base instance field
can shadow a child prototype method; choosing the nearest method name alone is
incorrect. No effective runtime dispatch claim is made yet. GLM should use these
facts to resolve field/prototype precedence, getter/setter behavior, overrides,
and unknown computed members, with runtime fixtures verifying the results.
Constructor or runtime mutation effects must remain explicitly outside any
unproven static result.

Verification: compiler suite **149 passed**, route suites **40 passed**,
framework declaration generation, root TypeScript, and all **11 package type
checks passed**. **11/58 tasks remain checked; CLI-04 remains open.** Binding-aware
capabilities and the complete inspection acceptance fixture also remain open.

<a id="codex-inspection-integration-2026-10-02"></a>
### Codex verification: inspection integration checkpoint (2026-10-02)

**Author: Codex.** Ran broader workspace validation after `81ff48a` rather than
relying only on focused compiler/CLI suites. Package type checking caught five
unsafe accesses in the new inheritance test assertions. Optional access now
allows the expected-value assertions to fail normally for a missing class while
satisfying strict TypeScript. The full CLI suite also caught one expectation for
wording from the removed syntax scanner; it now checks the shared compiler's
explicit-server reason while retaining its RPC/local-method assertions.

The root solution-style `pnpm tsc --noEmit` alone does not check package test
files. Keep running `pnpm typecheck` as part of workspace verification.

Final verification:

- `pnpm build`: passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm typecheck`: all **11 package configurations passed** after the assertion fix.
- `pnpm run test:unit`: **2,492 tests passed across 13 packages** on the clean rerun, including all **499 CLI tests** and **573 framework tests**.
- Focused route explanation suite: **10 passed** after correcting the old wording expectation.

Logs: `/tmp/cossack-inspection-workspace-build.log`,
`/tmp/cossack-inspection-root-types-final.log`,
`/tmp/cossack-inspection-package-types-final.log`, and
`/tmp/cossack-inspection-workspace-unit-final.log`.
No browser, generated-app tarball matrix, or workerd acceptance suite was rerun
for this checkpoint; those results are not inferred from the unit suite.
**11/58 tasks remain checked.** This checkpoint does not complete CLI-04 or
REL-03: inherited dispatch, binding-aware capabilities, complete inspection
acceptance, generated applications, and relevant browser/runtime release gates
remain open. The CLI-04 checklist row now reflects implemented scaffold recipe
and relative base-declaration inspection rather than its older partial state.

<a id="codex-imported-inheritance-2026-10-02"></a>
### Codex continuation: relative imported base declarations (2026-10-02)

**Author: Codex.** Added source-only resolution for relative TypeScript imports,
named/default exports, import aliases, and explicit re-export chains. Base
methods retain compiler classification, declaring class, resource identity, and
project-relative source locations. The resolver reads source rather than loading
modules; a subprocess fixture deliberately throws at module scope and still
resolves its declarations successfully.

Cycle detection prevents recursive export/base chains from looping. Missing
files, package imports, namespace imports, wildcard exports, path aliases,
dynamic bases, and ambiguous extensionless candidates remain unresolved.
`.js` imports map to `.ts` source and `.mjs` to `.mts`; the resolver does not guess
between competing extensionless candidates. Checks retain explicit diagnostics
for unresolved cases. Known partial declarations may still be inspected.

Verification: route suites **40 passed**; focused base-resolution subprocess
tests and root TypeScript checks passed. This adds declaration resolution, not
an effective inherited runtime dispatch model. **11/58 tasks remain checked.**

GLM continuation: finish override/field/accessor dispatch semantics, extend
resolution only where compiler/project configuration supports it, integrate
binding-aware runtime capabilities, and prove CLI-04's full acceptance fixture.

<a id="codex-local-inheritance-2026-10-02"></a>
### Codex continuation: local inheritance declarations (2026-10-02)

**Author: Codex.** Compiler inspection now reports local base-class chains and
whether the declarations resolve within the source file. Framework root aliases
and namespaces are recognized; cycles, dynamic bases, and imported bases that
need project resolution remain unresolved. CLI route facts include base methods
grouped by declaring class with compiler classification and authored locations.
Own methods remain separate. This deliberately does not claim an effective
runtime dispatch table: instance fields, accessors, and overridden methods still
need explicit resolution semantics and verification.

Route explanations include the base declarations. `check routes` emits
`COSSACK_ROUTE_INHERITANCE_UNKNOWN` for unresolved bases, without loading imports
or executing application code. Local declaration resolution does not change the
readiness statement that inherited runtime behavior remains unchecked.

Verification: compiler suite **148 passed**; route suites **38 passed**;
framework declaration generation and root TypeScript checks passed.
CLI subprocess suite: **36 passed**, including unresolved imported-base checks.

**11/58 tasks remain checked; CLI-04 remains open.** Next resolve imported bases
using source modules and exports, account for overrides/fields/accessors without
inventing dispatch facts, and integrate binding-aware capabilities. Then run the
complete grouped-route/layout/service acceptance fixture from the plan.

<a id="codex-scaffold-inspection-2026-10-02"></a>
### Codex continuation: shared scaffold recipe inspection (2026-10-02)

**Author: Codex.** Exposed `resolveManifestRecipe` from scaffold and reused it in
composition and CLI project inspection. Schema-v3 recorded recipes now resolve
through the actual registry, including transitive feature requirements and
provider/runtime compatibility. Effective route JSON includes these scaffold
facts. Unknown fields, secrets, file contents, and dependency baseline values
are not emitted.

Missing manifests are `unrecorded`; invalid JSON, unsupported schemas, and
invalid recipes are `invalid`. Invalid metadata produces
`COSSACK_SCAFFOLD_METADATA_INVALID` and makes `check routes` fail. Inspection
can still return available route facts. These are recorded recipe facts, not
proof that generated files remain unchanged or that bindings are available.

Verification:

- Complete scaffold suite: **89 passed**, covering composition after extraction.
- CLI metadata/route/subprocess suites: **75 passed**.
- Final metadata suite: **4 passed**, including the added effective-model integration case.
- `pnpm tsc --noEmit`: passed.

**11/58 tasks remain checked; CLI-04 remains open.** GLM should now finish
inheritance resolution, runtime capability evaluation using actual binding
metadata, and the complete grouped-route/layout/service acceptance fixture.
Recipe inspection is integrated; runtime capability gating and recipe completion
under CLI-05/RT-25 still remain separate unfinished requirements.

<a id="codex-resource-inspection-2026-10-02"></a>
### Codex continuation: authored resource inspection (2026-10-02)

**Author: Codex.** `server$` expansion now records generated method names,
resource names, and authored loader offsets. Inspection analyzes the expanded
class with the compiler classifier, then maps both generated resources and
ordinary methods back to authored source. Field resources, inline render
resources, and named import aliases are covered. Comment text containing
`server$` no longer makes inspection unavailable. Unsupported macro declarations
still produce unknown diagnostics without source excerpts or loader bodies.

CLI inspection passes the absolute file ID used for generated resource hashes,
while presenting project-relative source locations. `check routes` accepts valid
resources; a subprocess fixture compares the generated name against compiler
metadata for that exact file and confirms private loader text is absent.

Verification:

- Framework security-plugin suite: **147 passed**.
- CLI route, unavailable-parser, and subprocess suites: **72 passed**.
- Focused generated-resource identity subprocess check: passed after the file-ID correction.
- Framework declaration generation and root TypeScript check: passed.

**11/58 tasks remain checked; CLI-04 remains open.** Resource source mapping is
now implemented for the compiler's supported macro forms. GLM should continue
project inheritance resolution and scaffold/capability integration, then verify
the full grouped-route/layout/service acceptance fixture. Historical notes that
all macros yield unknown metadata are superseded by this checkpoint.

<a id="codex-parser-unavailable-2026-10-02"></a>
### Codex continuation: remove heuristic route facts (2026-10-02)

**Author: Codex.** Effective route inspection no longer falls back to regex
extraction when the TypeScript parser is unavailable. Pages and layouts report
unknown options with a parser-unavailable reason, retaining null/empty values
instead of guessed transport, SSG, and services. The standalone legacy helper
remains available, but the effective project model does not consume it.

Verification: route suites passed **37 tests**, including a mocked unavailable
parser with plausible decorator text in both a page and layout. `pnpm tsc
--noEmit` passed. CLI-04 remains open for project inheritance, macro source
mapping, and scaffold/capability integration. **11/58 tasks remain checked.**

<a id="codex-static-options-2026-10-02"></a>
### Codex review: truthful static option extraction (2026-10-02)

**Author: Codex.** Fixed static inspection reporting `ssg: { ...settings }` as
enabled and coercing invalid scalar SSG values to false. Nested spreads and
computed SSG keys now produce unknown metadata. Boolean SSG values and string
transport values are required for resolved facts. Duplicate static `enabled`
keys use the last value, matching JavaScript. Sparse middleware arrays no longer
produce a misleading known count. These unknown results feed the existing
failing `check routes` diagnostics.

Verification: `pnpm --filter cossack exec vitest run tests/scan-routes.test.js`
passed **36 tests**, including eight unresolved/invalid option cases and duplicate
key behavior. `pnpm tsc --noEmit` passed.

**11/58 tasks remain checked.** CLI-04 still requires project inheritance,
macro source mapping, and scaffold/capability integration; this correction does
not complete it. GLM should continue those requirements from the detailed plan.

<a id="codex-namespace-methods-2026-10-02"></a>
### Codex review: namespace method decorators (2026-10-02)

**Author: Codex.** Found a compiler/inspection mismatch during CLI-04 work:
namespace `@Core.Page` decorators discovered framework classes, but method
classification did not normalize `@Core.Server` or `@Core.Client`. A server
function field could consequently retain its implementation in the browser,
and ordinary server methods lacked explicit RPC classification.

Method collection now resolves named and namespace decorator imports from the
AST before classification. Both compilation and the shared inspection API use
these normalized facts. Tests verify retained client methods, stripped server
methods/function fields/input validators, RPC proxies, rejection of unsupported
server accessors, and route inspection through the published compiler export.
Computed decorator syntax was excluded after the parser rejected the attempted
fixture; this change claims ordinary namespace member decorators only.

Verification:

- Framework security-plugin suite: **145 passed**.
- CLI route-model suite: **27 passed**.
- Framework declaration generation and `pnpm tsc --noEmit`: passed.

**11/58 tasks remain checked; CLI-04 remains open.** GLM should continue inherited
project facts, macro source mapping, and scaffold/capability integration. This
fix is necessary compiler parity, not proof of complete project inspection.

<a id="codex-route-checks-2026-10-02"></a>
### Codex continuation: static route checks (2026-10-02)

**Author: Codex.** Added `check routes` to shared command metadata and dispatch.
The command consumes the same route/compiler model as inspection. Unknown page
or layout options, unavailable method classification, and invalid transports
produce stable source-bearing diagnostics and a failing exit code. All four
core transports are accepted. Inspection remains available for failed inputs.
Neither command executes application constructors or server methods.

The JSON readiness fields state the scope explicitly: static metadata is
validated; inheritance and runtime behavior are not checked. CLI-04 remains
open for the complete project model, inherited declarations, macro source maps,
and scaffold/capability integration. **11/58 tasks remain checked.**

Verification:

- `pnpm --filter cossack exec vitest run tests/cli-subprocess.test.js`: **34 passed**, including successful checks for all transports, non-executed constructors, failing dynamic/layout metadata, unsupported macros, and scoped flag rejection.
- `pnpm --filter cossack exec vitest run tests/command-spec.test.js`: **17 passed**.
- `pnpm tsc --noEmit`: passed.

GLM should continue the unresolved project-model requirements rather than treating
this command as full route correctness validation. The public CLI guide documents
the same limits. Full release gates were not rerun for this CLI-only change.

<a id="codex-compiler-facts-2026-10-02"></a>
### Codex continuation: compiler-backed own-method inspection (2026-10-02)

**Author: Codex.** After `29475c9`, extracted the common class analysis used by
client stripping and server automatic-RPC registration. The public
`inspectCompilerMethods` export uses that analysis and the same built-in policy.
It returns own-method body retention, RPC registration, classification reasons,
and authored body locations without executing application code.

Route inspection now consumes this export instead of independently interpreting
method decorators. `serverMethods` contains RPC methods, `clientMethods` contains
retained implementations, and `strippedMethods` identifies methods that have no
RPC registration. Exported page selection still excludes unrelated classes.
Parser failures, unsupported server declarations, unavailable compiler exports,
and resource macros without source maps produce unknown results. These are
file-level facts: inherited methods are explicitly outside the current result.

**GLM continuation:** finish CLI-04's project-level model. Resolve inheritance,
map macro-generated methods to authored locations, join scaffold recipes and
runtime capabilities, add route checks, and prove the grouped-route/layout/service
fixture in the detailed plan. Do not mark CLI-04 done from own-method parity.
The earlier compiler-preservation note remains relevant, but its first three
implementation steps now have this shared-analysis foundation.

Validation:

- `pnpm --filter @cossackframework/framework exec vitest run tests/vite-security-plugin.test.ts`: **143 passed**, including compiler/transform parity and unknown-input fixtures.
- `pnpm --filter @cossackframework/framework exec tsc -p tsconfig.declarations.json`: passed; generated the published metadata export used by CLI tests.
- `pnpm --filter cossack exec vitest run tests/scan-routes.test.js tests/cli-subprocess.test.js`: **57 passed**, including exported-page selection and actual compiler-backed route classification.
- `pnpm tsc --noEmit`: passed after CLI integration.

**11/58 tasks remain checked; CLI-04 remains open.** No release versions were
changed. Full workspace/runtime release gates were not rerun for this slice.

<a id="codex-compiler-preservation-2026-10-02"></a>
### Codex review: deep client helper preservation (2026-10-02)

**Author: Codex.** Reviewed the compiler classification used as the foundation
for CLI-04 after `cd9f489`. Found that `computePreservedSet` stopped after three
rounds. A client lifecycle method calling a longer helper chain therefore had
reachable helpers replaced by server stubs. The existing test explicitly
accepted the depth limit rather than testing complete reachability.

Replaced the cap with a finite worklist. Each reachable method is visited once;
cycles terminate, and explicit `@Server` methods remain RPC boundaries. Their
bodies and helpers reached only through those bodies remain stripped. The same
function feeds client transforms and automatic server method registration.
The regression fixture covers a five-helper chain, a cycle, and a server-only
branch in one class.

Verification:

- `pnpm --filter @cossackframework/framework exec vitest run tests/vite-security-plugin.test.ts`: **139 passed**.
- `pnpm tsc --noEmit`: passed.

**Status: 11/58 checked; no additional task completed.** CLI-04 remains open.
This focused correction does not establish compiler/inspection parity or replace
release-wide checks. User changes to `reports.md` and `.zcodeignore` are excluded.

**GLM next steps for CLI-04:**

1. Extract a shared per-class analysis from the security compiler. Both transforms
   and inspection must consume it, including preserved methods, explicit and
   automatic RPC registration, stripped methods, and retained function fields.
   Share the built-in method policy; do not create another decorator-only scanner.
2. Export analysis through the existing framework security-plugin subpath. Retain
   source positions and reasons, and account for `server$` transformations without
   presenting generated offsets as authored source locations.
3. Replace `extractMethodClassificationsFromAst` in the CLI with these facts.
   Resolve supported inheritance and report unresolved imported/dynamic cases
   explicitly. Do not execute project classes to infer behavior.
4. Join compiler facts with route/layout ancestry and scaffold recipe/capability
   metadata. Keep unknown options unknown; a regex fallback cannot prove facts.
   Add route checks with failing exit codes alongside inspection/explanation.
5. Prove parity using a grouped-route fixture with nested layouts, services,
   inheritance, function fields, automatic RPC, deep helper chains, and unsupported
   syntax. Only then evaluate CLI-04's complete acceptance criteria in the plan.

<a id="codex-cli-upgrades-2026-10-02"></a>
### Codex continuation: complete release-aligned upgrade plans (2026-10-02)

**Author: Codex.** Continues the unfinished release after `eea3dad`.
**CLI-06 is complete: 11/58 tasks checked.** The other 47 tasks remain in scope;
package versions remain 0.8.3 until the release gates pass.

**Problems fixed and acceptance evidence:**

- Upgrade previously emitted empty dependency addition/removal lists and used
  the installed CLI's templates even when another release was requested.
  `upgrade-scaffold.js` resolves the target scaffold version, reuses the installed
  package only for that same version, or installs the exact foreign version into
  temporary storage with pnpm lifecycle scripts disabled. It validates package
  identity and the ESM import entry, then removes temporary storage on completion
  or load failure. It never falls back to current templates for an unavailable
  release. Application files stay unchanged during planning/dry runs; pnpm can
  populate its cache.
- Scaffold manifests now record `dependencyBaseline` independently of merged
  application package contents. `planDependencyChanges()` compares recorded,
  current, and desired values across dependency sections. It updates/removes
  unchanged owned entries and adds new target entries, including section moves.
  Local pins, intentional deletions/moves, and user-added dependencies remain
  preserved conflicts where applicable. A matching pre-existing dependency does
  not become owned merely by matching a recipe. Adapter force remains explicit.
- Creation, composition, removal, and adapter switching retain this ownership.
  Source-only composition keeps the baseline even when package.json is unchanged.
  Current-version legacy manifests can reconstruct it locally. For a different
  legacy version, composition requires `cossack upgrade` first; upgrade loads the
  recorded exact release to reconstruct ownership and labels its source in JSON.
  Missing/invalid ownership metadata never silently becomes an unmanaged upgrade.
- Plans expose old/new dependency values, additions/removals, preserved edits,
  conflicts, file writes/deletions, manifest effects, build-setting migration,
  installation requirements, and next actions. Follow-up template commands pin
  the resolved version. Human dry runs show dependency decisions as well as files.
  Custom URL/path dependency specifiers are redacted from machine plans.
- Applying templates removes obsolete unchanged owned files. Edited auth modules
  and edited obsolete files remain intact. Package/runtime configuration and local
  secret files cannot be overwritten by `--force-file`. Invalid paths and symbolic
  links in owned paths fail before effects. Owned files and the ownership manifest
  are checked again after package resolution to reject stale plans.
- Installation failure retains the applied dependency/file/manifest changes in
  the result with a retry action. JSON hides package-manager output; human mode
  exposes underlying download/install diagnostics. Successful repeat upgrades
  produce no new filesystem effects or unnecessary installation.

**Acceptance tests:** `upgrade-release.test.js` contains ten subprocess cases,
including dry-run snapshots, requested-version files/dependencies, additions and
removals, edited authentication, obsolete files, repeat snapshots, legacy ownership,
missing releases, stale manifests, unsafe force paths, malformed JSON, symbolic
links, private specifiers, and installation failure. Its local-registry case uses
**real pnpm** to download an ESM-only tarball with integrity metadata; other cases
control package installation to test its failure/results deterministically.
The fixture uses `pnpm_config_registry`, as required by pnpm 11. Seven new scaffold
ownership tests cover merge behavior and composition. Existing upgrade/subprocess
tests continue to exercise explicit file replacement and stale source plans.

**Verification:**

- `pnpm build`, `pnpm tsc --noEmit`, and `pnpm typecheck` pass; package type
  checks cover all 11 configurations.
- `pnpm test:unit`: **2,455 passing tests in 13 packages**, including CLI
  **474 tests in 32 files**, scaffold 86, auth 118, database 84, renderer 256,
  core 669, node-adapter 10, test-utils 8, UI 112, framework 564,
  deno-adapter 3, desktop 16, and Studio 55.
- The final scaffold run passes **89 tests**, including three ownership edge
  cases added after its portion of the root run. The focused CLI matrix passes
  **67 tests in three files**, including the real package-download case and
  human/JSON failure diagnostics. The last stale-plan guard check passes both
  source/manifest regressions; it retains the first package/workspace baselines
  when collecting owned paths. Root `pnpm tsc --noEmit` was repeated afterward
  and passes. Together the final suites cover **2,458 distinct tests**.
- `git diff --check -- docs packages specs`: passes.

Logs use the `/tmp/cossack-upgrade-` prefix: `workspace-build.log`,
`root-types.log`, `package-types.log`, `workspace-unit.log`, `scaffold-final.log`,
`cli-final.log`, `stale-final.log`, and `root-types-final.log`. No browser suite, complete platform
matrix, or full published application tarball matrix was repeated. The local
registry tarball test verifies the upgrade loader, not REL-02's entire matrix.
REL-02/03/05 remain open. No deployment, push, or publication occurred. Preserve
the user's `reports.md` and `.zcodeignore`.

**GLM continuation:** next finish **CLI-04**. Replace the separate syntax-only
inspection decisions with compiler-owned classification and scaffold recipe
metadata. Prove that inspection matches emitted server proxies, transitive client
preservation, inherited declarations, effective layout ownership, and unknown
dynamic declarations. Return source locations and reasons without executing
application constructors. Then complete **CLI-05/RT-25** recipes/capabilities
against generated applications. Keep the existing Group 3 runtime acceptance
gaps and all 47 unchecked tasks in scope; this checkpoint is not the release.

<a id="codex-cli-json-2026-10-02"></a>
### Codex continuation: complete JSON command contracts (2026-10-02)

**Author: Codex.** Continues the review of GLM's implementation and the CLI-02
checkpoint `f30a5a7`. **CLI-03 is complete: 10/58 tasks checked.** The other 48
tasks remain in scope; package versions remain 0.8.3.

**Problems fixed and acceptance evidence:**

- ORM package imports could print before the database tooling's own isolation
  began. Generic scaffold/parser and ORM exception messages could expose project
  values. Every JSON CLI execution now runs in `json-runner.js`, supervised by
  `json-process.js`; raw stdin/stdout/stderr are detached from the protocol.
  Validated framework envelopes cross IPC. Finite results are published only
  after validating both the terminal envelope and process exit.
- Premature exit, missing/duplicate/malformed ORM results, mismatched exit
  codes, and hung project imports now produce one coded failure instead of
  silent success or contaminated output. Canonical command names also cover
  aliases, top-level help/version, and unknown colon-form commands.
- `dev` and `start` now support JSON execution. Their `started` event confirms
  process creation and supplies a PID/tool, without claiming HTTP readiness.
  Clean exits and requested graceful stops emit `stopped`; spawn/runtime/forced
  shutdown errors emit `failed`. Studio retains its ready/stopped/failed contract
  with an explicit tsx loader in its isolated child.
- Finite commands default to a five-minute wall deadline, configurable with
  `COSSACK_COMMAND_TIMEOUT_MS`. Dev/start have a 30-second startup bound; Studio
  retains its configurable readiness timer. Once started/ready, servers run until
  stopped. Signal handling bounds shutdown and reclaims the POSIX process group;
  Windows uses taskkill. Native Windows execution was not tested on this Linux host.
- ORM results retain public target identity and canonical `seeder`/`data.action`.
  Only documented identity fields enter `resolvedTarget`; extra factory fields
  are excluded. Error codes retain known ORM error classes, while messages omit
  application exceptions, connection values, SQL details, and parser excerpts.
  `data.phase` distinguishes configuration, connection, operation, and cleanup;
  human output retains full diagnostic chains.
- Results include affected paths/targets and follow-up actions where available.
  Create/add/remove expose next actions; partial command failures retain recorded
  effects. Noninteractive defaults and explicit choices are documented. Info
  accepts only version-shaped package-manager output.
- The new 43-test subprocess matrix complements existing command-contract,
  subprocess, database integration, and generated-app tests. It checks actual
  filesystem effects and unchanged snapshots for file dry runs, successful and
  failing configuration/ORM paths, top-level import logs, malformed protocols,
  noisy package managers, deadline validation, and servers that ignore termination.
  Lifecycle fixtures prove the server body ran before requesting cancellation.
  The deploy fixture uses actual Wrangler type generation and local deployment
  dry-run with a controlled Vite build fixture; the existing generated-app tests
  exercise real Vite/workerd. The image fixture uses a controlled converter.

**GLM continuation:** next finish **CLI-06**. Track owned dependency additions
and removals in the scaffold manifest; render against the requested target
version rather than the installed CLI's templates. Prove add/remove/preserve
decisions, edited and user-added dependencies, stale plans, and partial install
failure recovery in generated applications. Then finish **CLI-04** from compiler
classification and **CLI-05/RT-25** from shared recipe/capability metadata. Reuse
the JSON process boundary; handlers must return only intentional public metadata.
Do not mark any runtime or release gate complete from this CLI checkpoint.

**Verification:**

- `pnpm build`: passes.
- `pnpm tsc --noEmit`: passes.
- `pnpm typecheck`: passes, all 11 package configurations.
- `pnpm test:unit`: **2,440 passing tests in 13 packages** — auth 118,
  database 84, renderer 256, scaffold 82, core 669, node-adapter 10,
  test-utils 8, UI 112, CLI 463, framework 564, deno-adapter 3, desktop 16,
  Studio 55. The CLI result includes the final **43** machine-matrix tests
  and existing local generated-app Vite/workerd integration tests.
- Earlier focused ORM tooling run: **25 passing tests**. The focused native
  local deployment/image run passed before the final matrix additions.
- `git diff --check -- docs packages specs`: passes.

Logs: `/tmp/cossack-cli-json-workspace-build.log`,
`/tmp/cossack-cli-json-root-types.log`, `/tmp/cossack-cli-json-package-types.log`,
and `/tmp/cossack-cli-json-workspace-unit.log`. No browser suite or complete
published-tarball/platform matrix was repeated. REL-02/03/05 remain open for
the full release. The local Wrangler dry-run performed no remote upload or
provisioning. No push or publication occurred. Preserve the user's `reports.md`
and `.zcodeignore`.

<a id="codex-cli-metadata-2026-10-02"></a>
### Codex continuation: complete CLI validation metadata (2026-10-02)

**Author: Codex.** Continues the review and fixes in `3731dbb` and the
implementation checkpoint `01c3c4b`. **CLI-02 is complete: 9/58 tasks checked.**
The other 49 tasks remain in scope; versions remain 0.8.3.

**Problems fixed and acceptance evidence:**

- Create, migration, seeder, schema, and Cloudflare inspection could bypass
  shared option validation. Database wrappers could import project tooling
  before rejecting invalid options. All commands now validate before dispatch
  and direct calls also use shared preflight validation.
- `src/command-specs.js` owns accepted flags, types, aliases, repeats, scoped
  options, positional counts, choices, and constraints. Parser and generated
  help use that metadata. Recipe choices/runtime compatibility come from the
  scaffold's pure `@cossackframework/scaffold/registry` export with declarations.
  Libraries do not import the CLI.
- Boolean repeats using the same spelling explicitly use the last value.
  Contradictory canonical/alias values fail; identical aliases are accepted.
  Scalars reject repeats; supported lists and `--force-file` retain order.
  Short inline boolean values such as `-f=false` work. Separate flag-looking
  values fail; inline values such as `--title=--literal` work. `--` ends parsing.
- Local/remote/target conflicts, explicit runtime/provider incompatibility,
  remote Studio with a non-D1 driver, page-only generation options on other
  types, and options used on the wrong database subcommand fail before effects.
  Language commands reject extra arguments, conflicting locales, and locale
  path traversal. Default-locale errors use the JSON formatter.
- Vite lifecycle forwarding and help remain read-only. Help supports explicit
  booleans, command aliases, and metadata-generated scoped options. JSON
  validation retains all diagnostics and supported alternatives without echoing
  invalid values.
- `command-contracts.test.js` adds **92 tests**, including actual subprocesses
  for invalid booleans across all 23 commands, unknown options across all 19
  non-forwarding commands, command aliases, and incompatible/scoped inputs.
  Those subprocess fixtures contain malformed private project data; results
  must be one JSON envelope, empty stderr, and no files created or changed.
  Three additional fixtures declare real importable ORM modules with filesystem
  and console effects; invalid scoped options must never import those modules.
  Existing actual ORM and deployment integration tests remain part of the CLI
  suite.

**Intentional alpha changes:** unknown/missing/repeated options now receive the
shared `COSSACK_OPTION_*` / `COSSACK_ARGUMENT_*` codes. Removed generate options
`--tag`, `--database`, `--dialect`, and `--yes`, which were accepted but ignored.
Direct command APIs take parsed flags in `ctx.flags`; lang no longer reparses
inline argv. CLI inline flags continue to work through the shared parser.
Studio's remote forwarding fixture now uses D1 instead of an invalid Postgres
combination.

**GLM continuation:** next finish **CLI-03**, using this metadata and the existing
subprocess fixtures. Add success/failure/dry-run coverage for every meaningful
command family. Audit raw project/parser errors, especially project ORM imports;
do not include secrets or project logs in JSON. Long-running commands must have
an explicit structured event or unsupported-mode contract. Keep the full
acceptance criteria in the detailed plan. Then finish CLI-06's dependency
ownership and target-version templates, CLI-04's compiler classification, and
CLI-05/RT-25's recipes/capabilities. Do not re-check these partial tasks merely
because helper APIs or tests exist. The earlier Group 3 review still records
the runtime tasks needing completion.

**Verification:**

- `pnpm build`: passes.
- `pnpm tsc --noEmit`: passes.
- `pnpm typecheck`: passes, all 11 package configurations.
- `pnpm test:unit`: **2,394 passing tests in 13 packages** — auth 118,
  database 84, renderer 256, scaffold 82, core 669, node-adapter 10,
  test-utils 8, UI 112, CLI 417, framework 564, deno-adapter 3, desktop 16,
  Studio 55. The final CLI package run also covers the three additional
  project-import regressions added after its portion of the root run.
- `pnpm --filter cossack test`: **420 passing tests in 30 files**, including all
  **92** metadata-contract tests and the final project-import regressions.
- Focused metadata/dispatch/Studio checks before those last regressions:
  **128 passing**. Scaffold package: **82 passing**.
- `git diff --check -- docs packages specs`: passes.

Logs: `/tmp/cossack-cli-metadata-build.log`, `root-tsc.log`,
`package-types.log`, `unit.log`, and `cli-final.log`, each latter filename
with the same `/tmp/cossack-cli-metadata-` prefix. No browser suite or complete
tarball/generated-app matrix was repeated; prior runtime/browser results remain
in the preceding checkpoint. REL-02/03/05 stay open. No deployment, push, or
publication was run. Preserve the user's `reports.md` and `.zcodeignore`.

<a id="codex-continuation-2026-10-02"></a>
### Codex continuation: development upgrades and machine contracts (2026-10-02)

**Author: Codex.** Continued the unfinished release after review checkpoint
`3731dbb`. The full 58-task objective remains active. **8/58 tasks remain
checked**; the changes below complete useful slices, not whole-task acceptance.
Versions remain 0.8.3. Preserve the user's `reports.md` and `.zcodeignore`.

1. **Development WebSockets.** The previous Miniflare assertion was triggered
   by framework asset middleware probing ASSETS with an Upgrade request before
   `/ws` dispatch. The Vite plugin implements this binding as an HTTP Node
   middleware bridge. Upgrade requests now skip asset lookup and retain global
   and transport policies. Regression tests reject any attempted ASSETS probe,
   including mixed-case WebSocket and other upgrade values. The existing 24
   navigation/guard/view-transition tests now pass. A browser regression checks
   actual Durable Object state frames, an action request ID, and its correlated
   `done` frame rather than accepting an optimistic UI change as proof.
2. **Adapter and image JSON.** Adapter suppresses human lines and prompts in
   JSON/non-TTY operation, returns its public plan and follow-up commands, and
   propagates coded failures. Its public recipe removes generated secret values.
   Image validates format/quality, plans without a converter, reports effects
   and counts, rejects traversal and escaping symlinks, and fails for missing
   sources or conversion errors. Converter logs never enter machine output.
3. **Upgrade planning.** File drift, force-file ownership, dependency resolution,
   build-setting migration, installation, and follow-up actions are computed
   before writes. Locally modified files remain preserved unless explicitly
   selected. A file changed during registry resolution rejects the stale plan
   before effects. Installation failure returns a nonzero structured partial
   result with applied changes and a retry command. pnpm build-setting migration
   keeps its merged approvals instead of being overwritten by a template copy.
   Resolution uses bounded `pnpm view`; unresolved versions fail before effects.
   **Still partial:** additions/removals are empty, and templates come from the
   installed CLI, not the dependency version selected at the registry. Finish
   those requirements before checking CLI-06.
4. **Studio lifecycle.** JSON execution imports project code in an isolated
   child process. Ready/stopped/failed events use the versioned envelope, with
   token-free loopback metadata and no browser launch. Startup defaults to a
   30-second deadline; SIGINT/SIGTERM request cleanup. The Studio library has
   `quiet`/`onReady` hooks and finally-based server/database disposal on schema,
   readiness, and shutdown failures. Dry-run does not import project code.
   CLI subprocess tests cover log/token isolation, import failure, and timeout;
   library tests use an actual loopback server and in-memory SQLite connection.
5. **Build/SSG privacy.** Their JSON path previously included raw project and
   parser output in `data.output`. It now discards that output and supplies an
   exit code, coded diagnostic, and a human-mode follow-up command. Legacy SSG
   warnings are structured and include option names only. Captured processes
   have no inherited stdin and resolve on close.

**Verification:**

- `pnpm build`: passes.
- `pnpm tsc --noEmit` and `pnpm typecheck`: pass; all 11 package configs.
- `pnpm test:unit`: **2,305 passing tests in 13 packages** — auth 118,
  database 84, renderer 256, scaffold 82, core 669, node-adapter 10,
  test-utils 8, UI 112, CLI 328, framework 564, deno-adapter 3, desktop 16,
  Studio 55. The final CLI package run repeats all 328 after tightening the
  image output-symlink guard, including dangling links.
- Focused CLI protocol/dispatch tests: 65 passing; Studio lifecycle: 3;
  asset middleware: 14.
- `pnpm --filter @cossackframework/framework exec playwright test
  e2e/core-features/navigation.spec.ts e2e/pages/prevent-navigation.spec.ts
  e2e/pages/view-transitions.spec.ts --reporter=line --workers=2`:
  **24 passing**.
- `pnpm --filter @cossackframework/framework exec playwright test
  e2e/pages/optimistic-counter.spec.ts --reporter=line --workers=1`:
  **7 passing**, including the actual correlated WebSocket action regression.
- `git diff --check -- docs packages specs`: passes.

Logs for this checkpoint are `/tmp/cossack-continuation-build.log`,
`types-final.log`, `unit.log`, `navigation-e2e.log`, `ws-actions-final.log`, and
`cli-package-final.log`, each latter filename with the same
`/tmp/cossack-continuation-` prefix. No full generated-app/native production
matrix was repeated in this slice; REL-02/03/05 remain open.

**Continue next:** finish CLI-02's metadata-backed parser/help and conflict
handling, then complete CLI-03's full command-family matrix. Finish CLI-06's
dependency ownership/version alignment, compiler-backed CLI-04, and scaffold
capabilities (CLI-05/RT-25). Resume the remaining runtime/service/Cloudflare
tasks in the detailed plan; do not treat this checkpoint as the release.

Do not run builds or framework pretest concurrently with CLI or browser tests:
they recreate dist exports. One exploratory browser attempt overlapped a core
rebuild and failed entry resolution; run the final gates serially. The first
new protocol assertion incorrectly looked for `result`; the defined terminal
frame is `done`, and the corrected assertion remains in the browser suite.


<a id="codex-review-group3-2026-10-02"></a>
### Codex review of GLM command-contract follow-up and Group 3 (2026-10-02)

**Reviewer: Codex.** Reviewed all 13 GLM commits from `11f1499` through
`fac3daf`, after the previous Codex checkpoint `59fa58e`. This section is the
current handoff. Earlier GLM verification logs record what was claimed at those
checkpoints; this acceptance audit supersedes their completion claims.

**Task audit: 8/58 checked.** CLI-02 and CLI-03 are reopened. No new Group 3
task meets all of its detailed acceptance criteria yet. Completed slices are
recorded below, and the task rows name the remaining work. Keep the eight
previously accepted tasks checked: CLI-01, RT-19, CF-03, CF-05, CF-06, CF-07,
CF-11, and REL-01. Versions remain 0.8.3 until REL-04.

#### Findings fixed

1. **Validation errors and ownership.** WebSocket validation previously became
   a generic client error; JSON/stream proxies discarded field errors. Forwarded
   service contracts used the page constructor and could skip their service's
   rules. All now retain the stable validation code and fieldErrors, using the
   declaring service class. WebSocket dispatch accepts only unchanged
   framework-installed forwarders and retains the action allowlist. A canceled
   action stops after asynchronous validation before calling the mutation.
   Non-array payloads and array inputs fail validation.
2. **Client validation-code exposure.** Server input rules remained in client
   decorators, including custom validator closures. The client transform now
   removes input rules before dependency analysis. Static option objects are
   required; spreads and dynamic options fail closed. Timeout/provider metadata
   remains available. This is an alpha API constraint, documented in validation.
3. **Resource refresh races.** Refresh called loaders without their dependency
   arguments and let an older refresh overwrite a newer value. It also skipped
   serialization/disposal checks and mishandled synchronous failures. Initial
   load and refresh now share one loader path and each refresh owns a separate
   entry. Stale results do not publish, dependency arguments are captured, and
   falsey rejection reasons still represent errors.
4. **Task cleanup.** Rapid changes could start a task before its previous async
   cleanup finished; a canceled run could start after waiting for cleanup.
   Cleanup returned by late async setup was dropped. Cleanup barriers now remain
   visible across reruns, canceled starts are skipped, late cleanups run once,
   and thenables are awaited. Arbitrary writes inside task bodies are still
   cooperative; the documentation now requires an AbortSignal check.
5. **Development state identity.** Each read created a different proxy, and
   warning changed later reads back to the raw object. Deeper nested writes
   escaped diagnosis. Proxies are cached per field/object, recursive reads keep
   stable identity, reassignment unwraps diagnostic proxies, and the diagnostic
   runs only when DEV is true.
6. **Compiler projection.** Regex generic parsing mixed yield/return/next types.
   Async/generator modifiers were left on RpcCall signatures, imports could
   collide, and function-field replacements overlapped annotation splices.
   Parsing now uses the TypeScript AST, proxy signatures remove the modifiers,
   existing RpcCall aliases are reused, and field replacements do not overlap.
   Function fields retain their current stub signatures; their complete client
   typing remains open. Rewriting Vite input does not change authored-source
   TypeScript/IDE inference.
7. **Inspection accuracy.** Spreads, dynamic properties, and recovered invalid
   syntax were presented as static facts or silently replaced with regex guesses.
   Methods from helper classes could be attributed to the page. Inspection now
   selects the exported Page class, reports unresolved options as unknown,
   supports quoted keys/SSG objects/service member names, and honors local/shared
   decorator precedence. Method extraction explicitly describes its syntactic
   scope and its missing compiler analysis.
8. **CLI results.** Unknown route inspection emitted two envelopes and accepted
   an extra ignored route argument. Empty results emitted no envelope, while
   numeric failures had no diagnostic. These are fixed. Add/remove keep status
   data and avoid prompts under JSON/non-TTY execution; delete has structured
   planned-delete/deleted effects and a coded missing-file failure. Dry-run
   deletions are labeled as plans.
9. **Navigation.** Guard errors escaped the typed result, public callbacks
   discarded results, URLs lost query/fragment or used the pre-redirect path,
   and a slow bootstrap could finish after a newer commit. Public component
   navigation and the client-app return value now expose outcomes; fetch keeps
   its effective URL; guard failures settle; superseded errors do not reload;
   DOM commits are ordered with sequence checks. Missing modules fail rather
   than report success. Six behavioral tests replace the prior sample-object
   tests. Renamed the demo layout's sidebar handler to avoid overriding the new
   public navigate method.

#### Verification

Focused tests first reproduced seven failures in the new core regressions.
The following checks pass on the reviewed implementation:

- `pnpm build`.
- `pnpm tsc --noEmit` and `pnpm typecheck` (all 11 TypeScript package configs).
- `pnpm test:unit`: **2,288 passing tests across 13 packages** — auth 118,
  database 84, renderer 256, scaffold 82, core 669, node-adapter 10,
  test-utils 8, UI 112, CLI 317, framework 561, deno-adapter 3, desktop 16,
  Studio 52. Package tests remain serial because framework pretest recreates
  dist exports used by CLI tests.
- Focused final CLI subprocess/AST/inspection run: 55 passing tests after
  improving child-process tracking and removing the unused AST walker.
- `pnpm audit:bundle`: 28 neutral modules; Cloudflare entry is Workers-safe.
- `git diff --check -- docs packages specs`.

Browser verification is **not green**. The existing navigation, prevention,
and view-transition suites were attempted with Playwright (`--workers=2`):
3/24 passed, then the Vite/Miniflare development server crashed during a
WebSocket upgrade. Miniflare's `#handleLoopback` asserts that its HTTP response
exists for `CUSTOM_NODE_SERVICE`, but `#handleLoopbackUpgrade` calls it without
that response. The remaining 21 tests could not connect to the dead server.
This is a concrete dev/runtime integration failure to resolve under CF-10
and REL-03 before treating browser acceptance as verified. Retrying the same
three files with `--workers=1` reproduces the assertion: 2/24 pass and the
remaining 22 cannot connect. The exact commands use
`pnpm --filter @cossackframework/framework exec playwright test`
with `e2e/core-features/navigation.spec.ts`,
`e2e/pages/prevent-navigation.spec.ts`, and
`e2e/pages/view-transitions.spec.ts`, followed by `--reporter=line` and the
worker option. Do not report these suites as passing or suppress the assertion.
No remote deployment was attempted.

#### GLM continuation — concrete next work

1. **Finish CLI-02/CLI-03 before closing them.** Convert adapter, upgrade, image,
   and Studio to structured results or an explicit unsupported JSON boundary.
   Add subprocess success, failure, dry-run, non-TTY, and prompt-cancellation
   coverage for every family. Include conflicts between aliases and incompatible
   targets; derive parsing/help from command metadata. The original 17 tests
   did not cover every family. Preserve the single-envelope regressions.
2. **Provide actual client type inference (RT-01), then typed targets
   (RT-03/RT-05).** Decide how authored client code sees RpcCall without changing
   the server implementation signature. Generated declarations/client views or
   an editor/compiler integration need semantic type tests, including inferred
   returns, nested generics, aliases, generators, and function fields. A string
   assertion about transformed source is not an inference test.
3. **Finish RT-02 with RT-14.** Infer the server input from rules/schema, settle
   unknown keys and file/array handling, and enforce resource policies before
   mutation. Test forged requests and nested field errors through browser and
   direct transport calls. Keep validation code out of client bundles.
4. **Finish RT-03/RT-04/RT-05 acceptance.** Add typed resource names/results and
   typed task dependencies. Add a result-application mechanism for stale work,
   or make the explicit cooperative contract the reviewed design and revise the
   acceptance criteria deliberately. Test disposal during setup, rejection of
   async cleanup, SSR/hydration deduplication, nested arrays, cycles, computed
   dependencies, and production semantics.
5. **Finish navigation and ownership together (RT-09/RT-12).** Ordered commits
   prevent late overwrites, but a bootstrap that never resolves can still block
   later navigation. First resolve the reproduced Vite/Miniflare WebSocket
   upgrade crash (CF-10/REL-03) and establish a working browser baseline.
   Add cancellation/bounded completion and the Playwright
   matrix for guards, rapid clicks, back/forward, fragments, reused layouts,
   failures, redirects, transition fallback, and service/child disposal. Emit
   the planned cache/layout/scroll diagnostics. Current tests run real
   navigation logic with controlled component lifecycle fixtures in jsdom;
   they do not prove the full renderer/browser matrix.
6. **Unify inspection (CLI-04/RT-07/RT-12).** Expose compiler metadata for
   automatic RPC, transitive client preservation, inheritance, effective
   middleware, and actual service ownership. Keep dynamic facts unknown until
   the shared model can resolve them. Add scaffold-recipe awareness and typed
   routes/API schemas.
7. Resume the remaining groups in the detailed plan after these foundations.
   Update task rows and append a new GLM verification section. Do not place a
   new section between an existing Codex anchor and its heading.

Preserve the user's uncommitted `reports.md` and untracked `.zcodeignore`.
This review does not publish, deploy, push, or start another agent/chat.

### GLM continuation: compiler typing of RPC results (2026-10-02)

Review item 3 (typing): the vite-security-plugin client transform rewrites
stripped `@Server` method signatures to the call contract —
`AsyncGenerator<Y, R>` → `RpcCall<R, Y>`, one-arg generators and
`AsyncIterableIterator<Y>` → `RpcCall<any, Y>`, `Promise<R>` →
`RpcCall<R, never>` — with a type-only RpcCall import injected on first
rewrite. Unrecognized/missing annotations keep declared types. Tests cover
all mappings plus untouched cases; framework 550 and core 647 tests green.

### GLM continuation: Group 3 application-state items (2026-10-02)

Six more checklist items advanced with implementation + tests:

- RT-01 audit (upload boundary): raw arguments are validated BEFORE the
  upload walker transforms them, so Maps/Sets fail with the original path on
  HTTP exactly like WS/service instead of being silently emptied; Dates pass
  through; handled values (File/FileList/DOM) are exempt; rejections never
  throw synchronously. `describeUnsupportedValue` gained a handled-predicate.
- CLI-04: `inspect routes` now lists method classifications — every @Server
  method with the reason it becomes an RPC proxy (source line included) and
  @Client/@Shared methods as transport-free. AST-extracted, no execution.
- RT-05: task executions carry an AbortController identity; dependency
  changes abort the previous execution, stale results are discarded, disposal
  cancels in-flight tasks; failures report task, component, and trigger
  (bootstrap vs dependency change with paths); slow tasks no longer block
  siblings. Acceptance test: slow-first/fast-second retains the second
  result; stale deferreds never apply.
- RT-02: `@Server({ input })` declares action input contracts enforced on
  every transport (HTTP /crpc, WebSocket, service RPC) BEFORE the method
  runs — invalid input can never reach a mutation; failures reject
  client-visibly with `COSSACK_VALIDATION_FAILED` and stable nested field
  errors; declared coercion applies before the payload reaches the method.
  Cross-module detection via a structural validationCode marker.
- RT-03: `resourceStatus$(name)` exposes pending/ready/error, latest value,
  last failure, and staleness (including the refresh window);
  `refresh$` retries the loader directly without a render pass.
- RT-04: development-only shallow-mutation diagnostics — nested mutations on
  plain @State warn once per field with the component name and both fixes;
  @Store stays silent; compiled out of production. docs/states.md gains the
  mechanism selection table (GLM).
- RT-09: `navigate()` settles with a typed `{ outcome, url, error? }` across
  completed/redirected/superseded/canceled/failed; a navigation sequence
  discards late responses when superseded; documented in
  docs/prevent-navigation.md (GLM).
- Gates: core 661, framework 553, CLI 312 tests green after each slice.

### GLM continuation after review: command contract + AST inspection (2026-10-02)

Completed review items 1 and 2:
- CLI-02/CLI-03 closed as one command contract: `createCommandOutput`
  formatter (structured effects; human output suppressed under `--json`);
  add/generate failures carry coded diagnostics (`COSSACK_FEATURE_ADD_FAILED`,
  `COSSACK_FILE_EXISTS` naming the path); `inspect routes` runs through
  CommandSpec and returns single-envelope data; documented exit codes,
  noninteractive flags, and long-running behavior in docs/cossack-cli.md;
  `tests/cli-subprocess.test.js` (17 tests) exercises every command family
  through the real binary, including the review's acceptance example.
- AST extraction (`page-options-ast.js`): vite's oxc `parseSync` (lazy) with
  a labeled regex fallback; aliased Page imports followed; nested objects,
  comments, strings, and trailing commas handled; dynamic options reported as
  unknown with a reason. `buildEffectiveRouteModel` records
  `{ method, reason }` per page and layout.
- `pnpm --filter cossack exec vitest run`: 312 tests green.

<a id="codex-review-2026-10-02"></a>
### Codex review of GLM Groups 1–2 (2026-10-02)

**Reviewer: Codex.** Reviewed the seven GLM commits from `937843d` through
`e6b7153`, against the detailed plan and checkpoint `289d181`. This review fixes
regressions in those slices; it does not implement or close the remaining release
phases. Versions remain 0.8.3. The checklist now has **8 of 58 tasks checked**:
CLI-02, CLI-03, and RT-12 are reopened because their full acceptance criteria have
not been met. Their implementations remain useful partial progress.

#### Findings fixed in this review

1. **CLI JSON dispatch was unreachable for lifecycle commands.** Dispatch
   forwarded `--json` to Vite and supplied empty framework flags. Build and SSG
   also printed a banner before their result. Dispatch now removes the framework
   JSON option before the forwarding boundary, preserving downstream arguments
   and everything after `--`. Build/SSG emit one envelope. `dev --json` and
   `start --json` fail with `COSSACK_JSON_UNSUPPORTED` before launching a process;
   event output remains unfinished. Route-list JSON also skips its human table.
   Regression tests: `dispatch.test.js` and existing command-spec JSON tests.
2. **CommandSpec ignored its declared value types.** Direct invocation accepted
   boolean values for string flags, empty strings, repeated single-value options,
   and arbitrary `x-*` options. The shared validator now enforces declared types
   and repeat rules, rejects unknown options, and accepts the parser's `f`/`h`
   aliases. Direct JSON help emits an envelope. This strengthens converted
   commands; it does not provide complete command coverage by itself.
3. **Inspection IDs and collision winners differed from the runtime.** The CLI
   assigned page IDs before layouts, while runtime IDs use a combined sorted
   list. Route-group collisions could also display a losing page. Inspection now
   uses the published runtime `computeRouteIds` and `resolvePageRouteFiles`
   functions. Tests compare exact IDs and concrete-vs-grouped route precedence.
   Explanation no longer claims that a different dynamic pattern matches merely
   because its prefix is the same.
4. **Request helpers destroyed the production context getter.** A helper reset
   the getter globally and disposed services after leaving its ALS context.
   Nested or overlapping calls could expose another request or lose the
   framework getter. `setRequestContextGetter` now returns the previous getter;
   test-utils uses one ALS with active-scope accounting, composes the prior
   getter, and awaits disposal inside the helper context. Tests cover nested
   scopes, overlapping completion order, restored production context, and async
   service cleanup. Controlled deferreds clear their timers on settlement.
5. **Explicit service streams lost the ORM before their first pull.** Unlike
   component streams, they did not retain response middleware lifetime. Both now
   release the ORM and DI scope only after completion/cancellation. Tests execute
   SQL between service frames and check that cleanup occurs exactly once.
6. **SSR did not await or fully execute component cleanup.** The router called
   synchronous scope disposal and left rendered component hooks unowned. It now
   records constructed components before bootstrap, destroys them in reverse
   order, and awaits root scope disposal. Independent cleanup failures do not
   skip later owners. Replaced server descendants are retained for final cleanup.
   A gated async service hook proves that SSR waits in its original request
   context before returning.
7. **SSR generated different child IDs from RPC.** A preliminary render followed
   by composition advanced child counters; RPC rendered once and could not find
   the hydrated child's target. Composition resets the render counter and SSR
   removes the redundant preliminary pass. Child RPC tests now exercise actual
   rendered children and their SSR-derived IDs.
8. **Child SSE actions replaced the page's shared snapshot.** Ordinary and
   generator calls published the target child's state into the page DO.
   Ordinary actions now publish the page state. Child stream frames carry
   separate target `state` and page `scopeState`; the coordinator publishes the
   latter. The page is hydrated before rendering conditional children. Tests
   prove that child-local values do not overwrite the page snapshot.
9. **Partial state broadcasts could corrupt the authoritative snapshot.**
   Deferred `broadcastState` messages were treated as complete state replacement,
   potentially after the action slot released. Coordinator state commits now
   come only from full action results/frames. Event and client-action broadcasts
   are tracked and flushed before committing or releasing their action context.
10. **SSE subscriptions ignored backpressure and body cancellation.** Timer
    callbacks accumulated unawaited writer operations and kept polling after
    reader cancellation. The Cloudflare subscription uses a demand-driven
    readable stream, one delivered frame per pull, a bounded persisted-log batch,
    and a cancellable wait timer. Cancellation/abort removes its listener and
    timer. Cold starts construct the actual layout service ancestry before
    rendering, then dispose temporary owners. Tests cover subscription without
    SSR, no polling without reader demand, and cancellation.
11. **Reconnect cursors could acknowledge events before delivering them.**
    Sending the latest snapshot ID before older broadcasts made IDs move
    backwards and allowed a disconnect to skip an unseen broadcast. Replay now
    precedes the latest snapshot, in increasing cursor order. Expired history
    produces resync plus a snapshot. Tests check ordering and a missed broadcast.
12. **WebSocket reconnect backoff did not reset internally.** Status reported
    zero attempts on open, but the retry closure retained its old count. A
    successful open now resets both. The test closes the connection again and
    verifies the first 500 ms retry delay.
13. **RPC serialization silently discarded values or hung callers.** Functions
    could disappear during cloning or JSON encoding; service serialization could
    throw before lifecycle cleanup; WebSocket send failures in encoding were
    swallowed. Validation now precedes state cloning and frame encoding, includes
    ordinary component/service results, and returns coded path diagnostics.
    Shared references are accepted as aliases rather than mistaken for cycles;
    Maps/Sets are rejected at boundaries that inspect them. Generator failures
    close the iterator. Regression tests cover nested function results, aliases,
    unsupported collections, and loading cleanup.
14. **Cancellation and deadline handling left calls waiting.** Local WebSocket
    cancellation now wakes its frame queue immediately; a deadline sends a
    best-effort cancel and clears per-frame timers. Server hooks are registered
    before an action enters its queue, so cancelling a queued mutation skips it.
    Running generator hooks close on cancellation/failure. Arbitrary application
    I/O remains cooperative: cancellation cannot undo an external side effect,
    and uncertain outcomes must never trigger automatic replay.
15. **Realtime frame input and queues were unbounded/unvalidated.** HTTP and
    WebSocket frames now share structural validation, including optional page
    scope state. Socket frames are byte bounded, and pending yields have limits
    of 256 frames / 4 MiB per call. Overflow rejects with
    `COSSACK_RPC_BUFFER_EXCEEDED`, clears loading, and requests cancellation.
    Tests cover malformed frames, slow consumers, and queued cancellation.
16. **Custom Response streams released ownership on return.** A custom body may
    execute SQL or other request I/O when pulled. The router now wraps component
    and explicit-service Responses with captured request context and retained
    middleware/DI cleanup. The DO holds its action slot through all response-body
    completion, failure, or cancellation, including non-NDJSON bodies. Tests
    cover custom body SQL/context, headers, cleanup, and native cross-Worker queue
    ordering/cancellation. Cookie/flash propagation remains RT-11 work.
17. **The root test command raced framework builds with CLI imports.** Sharing
    the authoritative route-ID export exposed the framework/CLI workspace cycle:
    framework pretest deleted `dist/esm` while CLI subprocess tests loaded it.
    Root `test:unit` now uses `--workspace-concurrency=1`. Package suites retain
    their own tests/build hooks; package-level parallel test workers still run.

#### GLM continuation: concrete remaining work

Follow this order before advancing to the next major feature group:

1. **Finish CLI-02/CLI-03 as one coherent command contract.** Inspect/check route
   commands still bypass shared validation; the parser maintains a separate
   hard-coded boolean list; aliases/conflicts and all positional counts need a
   complete audit. Several converted handlers still print human status lines
   under `--json` (for example generate/add/remove/lang), and a handler returning
   nothing emits no envelope. A numeric failure result can lack a diagnostic.
   Convert handlers to return structured data, affected paths, and coded errors,
   with one formatter deciding human/JSON output. Do not capture process-global
   console methods around async work. Add actual CLI subprocess tests for every
   command's success, invalid option, conflict, and failure paths. Specify the
   noninteractive and long-running behavior explicitly. Example acceptance:
   `generate component ReviewProbe --dry-run --json` must produce exactly one
   parseable envelope with planned paths and perform no writes.
2. **Complete CLI-04/RT-07/RT-12 from compiler metadata.** `extractPageOptions`
   remains a regex heuristic. Nested option objects, comments/string text,
   trailing commas, aliased decorators, imported options, and namespaced service
   declarations can be misreported. Declared identifier lists do not prove DI
   ownership or lifetime. Reuse the AST/import-resolution machinery in
   `framework/src/vite-security-plugin.ts`, or extract a shared Node-only
   compiler module. Keep inspection read-only and never execute application
   constructors/configuration to obtain facts. Represent unresolved dynamic
   options as unknown with a reason. Verify inspection against the actual layout
   scope chain, including route groups and navigation cleanup. Add source
   locations and proxy classification reasons as required by the original plan.
3. **Finish RT-01's remaining transport contract.** Compiler/client typing of
   generator yields and final returns is still missing. Audit request upload
   normalization: HTTP's file walker transforms objects before validation, so
   Maps/Sets and other special objects can still lose information there, while
   direct WebSocket/service boundaries reject them. Define supported values and
   paths consistently, including dates, cycles, and DOM/file arguments. Add
   generated-app conformance cases and avoid claiming transport parity from
   source-only tests. Coordinate Response cookies/flash with RT-11.
4. **Finish RT-24/RT-25 using real adapter capabilities.** The new capability
   model is not yet wired into builds, recipes, or inspection. Its profiles need
   correction before they become authoritative: Node/Deno do have process-local
   WebSocket support for the `durable-object` protocol; their framework scheduled
   handlers are not implemented; transport evaluation ignores its requirement;
   storage availability does not verify a concrete bucket binding. Derive facts
   from installed adapters and actual named bindings. Reject unsupported/missing
   capabilities before effects and test the emitted diagnostics. Binding presence
   and platform support must remain separate concepts.
5. **Finish RT-29 without overstating the helper.** `withRequestScope` scopes the
   core request getter and DI, not the framework's config/locale/auth/ORM stores.
   Add fixtures using the actual Hono/router lifecycle, authenticated requests,
   RPC dispatch, SSR/hydration, cancellation, and tarball imports. Keep the
   nested/overlap restoration regression tests. Verify framework middleware
   getter registration alongside helper use, including lazy module loading.
6. **Extend runtime adversarial coverage before release gates.** Preserve the two
   real workerd suites. Add conditional-child scope cases, multi-field state
   broadcasts, dynamic-param subscription cold starts, slow native subscribers,
   response-cookie handling, and restart *during* active callbacks. Harness reload
   proves persisted state across instances; it does not prove atomic external
   side effects or safe replay after an in-flight restart. Node/Deno still use
   the older process-local subscription implementation with timer/writer queues;
   do not imply Cloudflare durability or backpressure guarantees for that path.

After these acceptance gaps, continue the original execution groups in
[release-0.9.0-plan.md](./release-0.9.0-plan.md). No unchecked feature was removed
from scope. Preserve user edits to `reports.md` and the untracked `.zcodeignore`.
The user arranges GLM continuation. This review did not publish, push, deploy,
provision, rotate credentials, or start/message another chat.

#### Verification by Codex

Passed after the fixes:

- `pnpm build`.
- `pnpm tsc --noEmit`.
- `pnpm typecheck` — all 11 package checks.
- `pnpm test:unit` — **2,227 tests across 13 packages**: auth 118, database 84,
  renderer 256, scaffold 82, core 647, node-adapter 10, test-utils 8, UI 112,
  CLI 292, framework 547, deno-adapter 3, desktop 16, Studio 52. This includes
  `deploy-integration.test.js` (generated staging artifact, public exports,
  real workerd/D1/auth/RPC/SSE/SSG/assets/migrations) and
  `sse-coordinator-integration.test.js` (two native Workers sharing a SQLite DO,
  state persistence, cursor history, custom-response ownership, cancellation).
- `pnpm audit:bundle` — 28 neutral modules; the database Cloudflare entry
  remains Workers-safe. Native framework import boundaries are also exercised
  by the generated application build.
- `git diff --check -- . ':!reports.md'`.

The first full run exposed the framework/CLI build race described above; the
final run passed using the corrected root test command. An initial new SSR test
also needed `Promise.resolve(app.request(...))` for Hono's synchronous-or-async
return type; package type checks pass after that test correction. Focused new
regressions passed before the full run. No Playwright suite, complete tarball
matrix, or live Cloudflare deployment was run. Passing this checkpoint does not
close REL-02, REL-03, or REL-05 for the full 0.9.0 release.


### CLI lifecycle and creation

- Dispatcher regression tests exercise all command help handlers, Vite argument
  forwarding, legacy SSG diagnostics, and real temporary-directory creation plans.
- `create --dry-run --json` emits one versioned result without writing files,
  prompting, checking updates, or exposing generated secret values. Creation
  failures have diagnostic codes. Other commands still need JSON conversion.
- Explicit boolean flags accept `true`/`false`, reject other values, and use the
  last repeated value. Canonical `--force=false` takes precedence over `-f`.
- `pnpm --filter cossack exec vitest run`: 222 tests passed.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 81 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed after all code changes in this slice.

### SSG environment resolution

- Named Cloudflare environments resolve APP_URL from JSON, JSONC, and TOML
  without inheriting top-level vars. Explicit environment selection overrides
  CLOUDFLARE_ENV, and explicit shell APP_URL remains highest priority.
- Dotenv files follow environment/local precedence. Tests cover these rules,
  quoted TOML environment names, and the existing build plugin behavior.
- `pnpm --filter @cossackframework/framework exec vitest run tests/ssg-config.test.ts tests/vite-ssg-plugin.test.ts`: 35 tests passed.
- Updated SSG and sitemap documentation to describe the integrated Vite build
  and remove obsolete CLI flag examples. Deployment orchestration, binding
  selection, and remote migrations remain open.

### Cloudflare deployment and scaffold secrets

- Added `cossack deploy --env <name> --dry-run --json`. It uses the project's
  Wrangler parser and executable, selects CLOUDFLARE_ENV before type generation
  and Vite build, verifies target configuration in the artifact, and passes
  the exact built config to Wrangler. Dry runs build and validate locally;
  they do not upload or provision. Remote secret checks are explicitly reported
  as not checked during local validation.
- Preflight rejects unknown environments, secrets in vars, invalid/default
  APP_URL, missing Worker entry points, and placeholder resource IDs. JSON
  results contain names and diagnostics, not raw configuration values.
- Stale deployment metadata is removed before building. A build without the
  Cloudflare plugin cannot deploy metadata left by a previous build.
- New Cloudflare apps generate a local APP_SECRET, preserve it during feature
  composition, declare required secret names, ignore environment-specific local
  files, and use automatic D1 provisioning. Hyperdrive resource selection is
  still open; its placeholder is rejected by deployment preflight.
- Removed R2 credential values and APP_SECRET from the tracked demo Wrangler
  vars and regenerated binding/runtime types. A scan of tracked working-tree
  files found no copies of the removed R2 credentials. Any active credentials
  need external rotation; no rotation or cloud deployment was performed.
- Updated deployment documentation for environment selection, dry-run effects,
  secrets, custom domains, Node entry path, and code/state rollback differences.
- `pnpm --filter cossack exec vitest run`: 235 tests passed before adding the
  integration test; `tests/deploy-integration.test.js` then passed separately.
- The integration test generates a staging app, uses real project Vite and
  Wrangler, generates types, builds, verifies the environment, and completes
  a Wrangler deployment dry run without uploading.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 82 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed with regenerated types.
- Migrations, remote database target selection, broader runtime tests, preview
  automation, and the remaining release checklist are still open.

### Database plans and Cloudflare inspection

- ORM adapter factories receive project root, config path, environment,
  local/remote target, and read-only intent. Commands validate flags by action,
  reject extra arguments and conflicting targets before adapter creation, and
  emit versioned JSON results. CLI forwarding preserves false/repeated values.
- Migration plans include SQL, parameter counts, destructive risk, direction,
  checksum, completeness, and squash consolidation. The disconnected driver
  substitutes the application's ORM scope, including static entity/shared SQL
  calls, and retains its naming strategy. Live query callbacks produce an
  incomplete result. Seeder previews select metadata without executing callbacks.
- History inspection does not initialize bookkeeping and correctly recognizes
  already-applied migrations. Snapshot/generation/squash/schema-pull dry runs
  return proposed changes without writing application files.
- Generated D1 tooling uses project Wrangler, shares local development storage,
  forces local or the selected remote D1 binding, preserves the configured
  account, and disposes proxy resources. Remote binding setup is tested with an
  injected Wrangler; no live Cloudflare database was changed.
- Real local D1 tests cover schema inspection, queued migration plans, applying
  migrations and reading their history, reversal plans, and unique columns.
  D1 inspection avoids a catalog query rejected by workerd and hides Cloudflare
  internal tables. SQLite tests also cover squash consolidation; catalog query
  tests cover PostgreSQL/MySQL history without writes.
- Studio now shares D1 discovery with database tooling instead of maintaining
  separate JSONC/TOML parsers. Tests reject missing environment declarations and
  prevent fallback to top-level bindings, including quoted TOML environment names.
- Added read-only `cossack inspect cloudflare` and `cossack check cloudflare`.
  They share deployment preflight, emit resource/secret names without values,
  report diagnostics, and distinguish local configuration validity from
  unchecked build/remote readiness. Inspection describes invalid configurations;
  checks fail on them. Tests verify no project artifact/config changes.
- Ran the inspection CLI against packages/framework: it returned one JSON
  envelope with the Worker, Durable Object binding, required secret names, valid
  local configuration, and build/remote readiness explicitly not checked.
- The remaining provider target semantics, broader compiler inspection/MCP,
  runtime services, distributed SSE, resource setup, preview automation, and
  release gates remain in scope. These changes do not complete the release.
- Database JSON output is now isolated in a child process. Configuration,
  adapter, migration, disposal, and inherited subprocess logs cannot enter
  stdout/stderr; one validated result returns over IPC. Tests cover console
  output, direct writes, spoofed stdout JSON, parent environment isolation,
  and premature process termination. Live remote D1 verification remains open.
- `pnpm --filter @cossackframework/database build`: passed.
- `pnpm --filter @cossackframework/database exec vitest run`: 81 tests passed.
- `pnpm --filter @cossackframework/database audit:bundle`: passed; neutral
  imports and the Cloudflare runtime retain their runtime boundaries.
- `pnpm --filter cossack exec vitest run`: 245 tests passed. After the final
  help text change, inspection and dispatcher suites passed again (37 tests).
- `pnpm --filter @cossackframework/studio exec vitest run`: 52 tests passed.
- `pnpm --filter @cossackframework/scaffold exec vitest run`: 82 tests passed.
- `pnpm tsc --noEmit` and `pnpm typecheck`: passed after the database changes.

### Current reports.md: CSM-004 Tabs underline

- Removed static active/inactive bottom borders from Tabs triggers. The sliding
  indicator remains the single underline; variant props still stay out of the
  DOM attribute spread.
- Server rendering tests verify one indicator and no trigger border classes.
  A browser-method test verifies that selected tab widths/offsets continue to
  position the indicator when the controlled tab changes.
- `pnpm --filter @cossackframework/ui build`: passed.
- `pnpm --filter @cossackframework/ui exec vitest run`: 112 tests passed.
- Root and all package type checks passed after the component change.
- Final `pnpm tsc --noEmit` and UI package TypeScript checks passed after adding
  the browser-method test.
- `pnpm --filter @cossackframework/framework exec vitest run tests/package-contract.test.ts tests/ssg-config.test.ts tests/vite-ssg-plugin.test.ts`:
  51 tests passed, including the package and SSG regressions from earlier reports.
- No edits were made to the user's reports.md contents. Its existing final
  blank line is the only reported issue from `git diff --check`; the remaining
  tracked changes pass the whitespace check.

### Public SSG and Worker-first assets

- SSG now uses a real anonymous Hono request and runs global, layout, and page
  middleware. Synthetic user state and the context mock were removed. Denied
  or redirected requests cannot bootstrap protected pages; authenticated
  identities, cookies, credential-dependent output, and private cache policies
  fail generation. Middleware failures remain build failures.
- SSR and SSG share layout ancestry from source paths, including route groups
  and dynamic layouts. Disabled SSG is honored. Catch-all HTTP routes now use
  a real Hono multi-segment parameter; an actual request test exposed and
  replaced the former nonmatching `:name*` pattern.
- The plugin validates all routes before writing HTML or sitemap files. Failed
  renders, output collisions, and traversal attempts publish no generated
  routes. Static parameter replacement handles catch-alls and rejects missing
  parameters instead of publishing template URLs.
- Generated apps and the demo use Worker-first assets. Framework middleware
  serves matching files within global and page/layout policies, retains
  middleware headers, redirects known HTML aliases to canonical routes, and
  falls through to SSR/API handling for missing assets. Deployment preflight
  requires Worker-first routing and the ASSETS binding and verifies these
  settings in the built artifact.
- A generated staging application's actual Vite artifact ran locally under
  workerd: public SSG and client JavaScript loaded, protected static HTML/files
  were denied, and authorized responses retained policy headers. No upload or
  remote resource mutation was performed. Wider auth/database/realtime runtime
  gates and the remaining release work remain open.

### Static render services and awaitable cleanup

- SSG now creates App, layouts, and pages through core DI. Each render has an
  anonymous request root and explicit nested layout scopes, including grouped
  and dynamic source ancestry. Scoped services bind real request parameters
  and the resolved APP_URL. Layout service slots and scope keys hydrate with
  the same ownership metadata as SSR.
- Added `ServiceScope.disposeAsync()` and `Cossack.destroyAsync()`. They await
  hooks already started by synchronous disposal, release descendants and
  subscriptions even when a hook throws, and report collected failures.
  Completed successful child disposals are removed from long-lived roots.
  Component hooks finish before owned service disposal. Registered async task
  cleanup is awaited without delaying ordinary synchronous task execution.
- SSG awaits all constructed instances and service scopes on success and after
  construction, init, render, or head failures. Cleanup failures fail the render;
  an earlier render failure remains the cause. Constructor DI, lazy injection,
  nested shadowing, concurrent render isolation, public service hydration, and
  renderer-created child cleanup have focused regression coverage.
- The generated staging app integration now hydrates a real layout-owned
  service through published packages and Vite, then runs the artifact under
  workerd. SSG and repeated live SSR requests each get fresh state and the
  staging APP_URL. Protected static files, global/layout/page guards, and the
  failed-public-SSG build gate remain covered. No cloud upload was performed.
- A production framework build generated all six expected static pages and
  the sitemap. Core and framework library builds, root TypeScript, and all
  package type checks passed. Full core tests passed: 40 files, 594 tests.
- `pnpm test:unit` passed: 2,080 tests across all 12 packages that have unit suites,
  including the expanded generated-app/workerd integration. Framework: 495
  tests; CLI: 259 tests. This does not replace the remaining end-to-end and
  final release gates.
- After adding a separate successful-render/failed-cleanup case, the focused
  SSG service suite passed all 10 tests; root and framework TypeScript checks
  passed again. This verifies cleanup failure alone prevents a successful render.
- Library type generation uses a dedicated entry-free Wrangler configuration;
  application-generated declarations no longer import the demo into published
  library output. Package-contract tests check the boundary and generated
  asset/Durable Object binding types.
- Current SSR/RPC completion and browser navigation remain nonblocking.
  Cancellation of in-flight tasks and client compilation of service disposal
  hooks still require work; the broader DI, transport, and release gates remain
  unchecked. This slice does not complete 0.9.0.

### Response-local component RPC streams

- Replaced the separate HTTP/SSE client implementations with one request per
  component action. The call supports iteration, shared promise completion,
  cancellation, and automatic draining for unobserved event-handler calls.
  Iterating SSE actions no longer dispatches a second mutation. Awaiting an
  ordinary async SSE action now waits for its actual result.
- Added a versioned UTF-8 NDJSON frame protocol for yields, final values, state,
  and correlated errors. Both sides enforce a 1 MiB frame limit; the incremental
  parser also bounds buffering overhead for tiny network chunks. Malformed,
  truncated, oversized, and inconsistent frames fail explicitly. HTTP/SSE
  component calls reject failures instead of silently resolving undefined.
- Generator pulls and cleanup use the original action's AsyncLocalStorage
  snapshot. Component RPC reconstructs layout DI scopes and waits for component,
  descendant, and scope cleanup. SSE scopes are checked before constructors.
  SSE's subscription store no longer retains or drives action generators.
- Request-context middleware exposes a structural response-lifetime contract.
  ORM middleware defers factory-owned database closure for retained streams,
  including cancellation, without depending on framework. Ordinary responses
  and caller-owned databases retain their ownership behavior. Generated
  Cloudflare ORM factories now supply async-local scopes for static models and
  global SQL. The database's neutral and Cloudflare entry graphs stay unchanged.
- Real generated staging-app tests build published packages with Vite, validate
  the artifact, and run it under workerd. They verify D1 queries between yields,
  middleware/config/request context, layout-service state, final results,
  client-visible failures, and cancellation through a real HTTP listener. The
  existing public SSG and protected asset checks remain covered.
- These tests exposed Vite's source-relative D1 migration-path rewrite. Artifact
  validation now compares resolved migration directories while still comparing
  every other binding setting. Regression tests reject changed databases, IDs,
  and migration targets, including custom source migration directories.
- `pnpm build`, `pnpm tsc --noEmit`, and `pnpm typecheck` passed. All 11 package
  type checks passed after the dependency build completed. A concurrent earlier
  type check saw temporarily missing core declarations during rebuilding; the
  post-build check passed without a source workaround. Database bundle audit
  passed for the 28 neutral modules and the Workers-safe Cloudflare entry.
- `pnpm test:unit` passed: 2,124 tests across all 12 packages with unit suites.
  Core: 615; framework: 515; database: 84; CLI: 261. The expanded real-worker
  integration is included. No cloud upload or remote provisioning was performed.
- Distributed SSE coordination is still incomplete: its shared state store
  remains Worker-local. WebSocket and explicit service RPC parity, cancellation
  of stale tasks, typed client generator-result inference, preview/release
  tooling, and all other unchecked release requirements remain in scope.
  Versions remain 0.8.3 until the complete 0.9.0 checklist and release gates pass.

### Group 1/2 completion pass (GLM, 2026-10-02)

Closed the remaining acceptance gaps so four rows could be checked honestly:
- RT-12: service ownership in route inspection — layouts' `services: [...]`
  declarations and per-page injectable ancestry appear in `cossack inspect
  routes` output and route explanations, matching what DI resolution finds.
- CLI-02: value flags now require values (`--tag --force` is a parse error,
  not a silent boolean); enumerated acceptance tests cover aliases, repeated
  values, `--` passthrough, explicit false, and flag-like values.
- CLI-03: hard-failure prints in add/generate/remove/delete/lang converted to
  coded throws so `--json` failures are structured diagnostics with nonzero
  exits.
- CF-06: the artifact now applies a real migration through the ORM migration
  system against the bound D1 (creates the table, records `_cossack_migrations`
  bookkeeping, idempotent re-run, schema serves reads through `/api/db`).
- RT-01 (still open, strengthened): `describeUnsupportedValue` walks argument,
  state, and stream-frame trees to name the first unsupported value by path;
  client proxies reject before dispatch instead of letting JSON.stringify
  silently drop functions.
- Gates: core 640, framework 536, CLI 286 tests; `tsc --noEmit` clean.

### Group 2 continued: route metadata, inspection, test utilities (GLM, 2026-10-02)

- RT-07 slice: `buildEffectiveRouteModel` in the CLI — route IDs computed in
  the runtime's index space (`cmp_<base36>`), dynamic and catch-all
  parameters in the framework's `:name{.+}` form (this fixed a real CLI bug:
  `filePathToHttpRoute` derived `:...name` for catch-alls, diverging from the
  router), layout ancestry, nearest 404/error boundaries, and source-level
  @Page options (transport, ssg, middleware count via depth-aware array
  parsing, decorator line numbers). Nothing executes during inspection.
- CLI-04 slice: `cossack inspect routes [route]` — one command lists effective
  facts with source locations and explains a route's behavior with reasons
  (transport origin, ancestry, middleware count, SSG, params, boundaries).
- RT-29 slice: `@cossackframework/test-utils/server` published entry with
  `withRequestScope` and `controlledAsync`; ES-only named-entry lib build;
  the package's own suite (5 tests) joined root `pnpm test:unit` (now 13
  packages, 2,192 tests).
- Gates: `pnpm tsc --noEmit`, `pnpm build`, and `pnpm test:unit` green; CLI
  280 tests, framework 536 tests.

### Group 2 start: CLI spec, required bindings, capability model (GLM, 2026-10-02)

- `command-spec.js` (CLI-02/CLI-03): `CommandSpec` declares flags (type,
  aliases), positionals, and forwarding boundaries; `runWithSpec` validates
  before any effect (unknown options list their `--`-prefixed supported
  alternatives; missing/extra positionals fail with stable codes), keeps the
  `help` flag/positional convention, and emits the versioned JSON envelope —
  data handlers, exit-code results, and `{ exitCode, data }` captured-output
  results. 16 commands converted; database cluster commands already emit
  isolated JSON via their child-process path and move to `runWithSpec` later.
  `build`/`ssg` capture child output under `--json` via `runCaptured` so
  stdout carries exactly one envelope. Existing tests updated to the new
  validation contract; new `command-spec.test.js` (10 tests).
- RT-24: `requireBinding`/`requireEnv` + `ConfigBindingError`
  (`COSSACK_BINDING_MISSING`) name the missing binding, list available binding
  names only — secret values never enter diagnostics — and point at
  per-environment Wrangler configuration. Covered in `config.test.ts`.
- RT-25: `runtime-capabilities.ts` models transports, durable realtime
  coordination (binding-gated on `COSSACK_SSE`), process-local realtime,
  scheduled handlers, serverless storage, and filesystem per runtime
  (cloudflare/node/deno/desktop), distinguishing available, missing-binding,
  and unsupported; `describeRuntimeCapabilities`/`formatCapabilityResult`
  expose it for inspection. Covered in `runtime-capabilities.test.ts` (5
  tests). Scaffold/CLI consumption remains open.
- `pnpm --filter cossack exec vitest run` (273 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (554 tests), and
  both packages' `tsc --noEmit` passed.

### Group 1 runtime work: unified RPC contract and realtime recovery (GLM, 2026-10-02)

- RT-01 slice: WebSocket `@Server` calls are now request-scoped RPCs on the
  shared `createRpcCall` contract — correlated `yield`/`done`/`error` frames
  by request id through `executeAction` and both socket runtimes (in-memory
  and Durable Object), cancellation frames that close the server generator,
  forbidden/not-found error frames, and per-socket cancellation registries.
  Explicit service RPC (`/crpc` service envelope) streams generators through
  the same NDJSON response protocol with service state per frame, awaits
  scoped-service disposal on ordinary results (matching component RPC), and
  its client proxy consumes `createRpcCall` with redirects, stream frames,
  cancellation, and RpcError mapping. `@Server({ timeout })` adds client-side
  deadlines on HTTP/SSE, WebSocket, and service calls; expiry rejects with
  `COSSACK_RPC_TIMEOUT` and an unknown-outcome message, never a retry.
  Transport failures reject: unopened sockets `COSSACK_RPC_TRANSPORT_UNAVAILABLE`,
  send failures `COSSACK_RPC_TRANSPORT_FAILED`, socket loss mid-call
  `COSSACK_RPC_TRANSPORT_CLOSED`.
- RT-19: `component.realtime` (sse + per-provider websockets) exposes
  `state`, `attempts`, `lastEventId`, `lastError`, `resynced`; WebSocket
  reconnect uses bounded exponential backoff and never revives sockets closed
  by component disposal; the SSE subscription endpoint announces snapshot
  resynchronization with a `resync` event carrying the cursor.
- CF-06 slice: the generated staging app now exercises credentials
  authentication through the built artifact — D1-backed sessions via
  `@cossackframework/auth` `createAuth`, a login API route, a protected page,
  and authenticated SSE coordinator scope isolation (`user:u1` state separate
  from the anonymous scope). Artifact-level application of the migration
  system is still open, so CF-06 stays unchecked.
- Tests: core `rpc-conformance.test.ts` (WS loopback through the real runtime:
  ordinary/generator/error/cancel/timeout/disconnect/duplicate-consumer,
  service proxy over mocked fetch, protocol helpers) and
  `realtime-recovery.test.ts` (status transitions, backoff bounds and reset,
  no reconnect after disposal); framework service-stream router tests;
  expanded deploy-integration auth assertions.
- `pnpm --filter @cossackframework/core exec vitest run` (638 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (528 tests),
  `pnpm --filter cossack exec vitest run` (263 tests), and core/framework
  `tsc --noEmit` passed.

### DI resolution diagnostics (GLM, 2026-10-02, RT-12 slice)

- Missing `@Inject` declarations now fail with an actionable error: the
  requested service, the requesting component, the active scope chain
  innermost-first (each layout with the services it declares, ending at the
  request root), the `@Page({ services: [...] })` fix, and the
  global-singleton alternative. `ServiceScope.describeScopeChain()` exposes
  the same ancestry for inspection without failing; `resolveDeclared` accepts
  an optional consumer used only for diagnostics.
- specs/service.md now documents the global-singleton versus layout versus
  request ownership table and when each is request-safe.
- RT-12 remains open: SSR, navigation, and explicit service RPC cleanup
  completion parity and inspection that matches actual ownership (CLI-04
  dependency) are not done.
- `pnpm --filter @cossackframework/core exec vitest run` (616 tests),
  `pnpm --filter @cossackframework/framework exec vitest run` (526 tests), and
  `pnpm tsc --noEmit` passed.

### Distributed SSE coordinator integration (GLM, 2026-10-02)

- Finished CF-05 from the agent handoff. `SseDurableObject` now publishes an
  explicit RPC surface (`initialize` with a `fresh` flag via `rowsWritten`,
  `currentState`, `updates`, `publish`, `broadcast`, `execute`) with
  first-initialization-wins snapshots, per-scope action serialization through
  an explicit queue, per-frame state publication for RPC streams, pass-through
  for materialized responses, explicit failure for frames without object
  state, and a bounded (128 events / 1 MiB) SQLite event log.
- The neutral router and SSE transport reach the coordinator only through the
  `COSSACK_SSE` binding (a structural stub contract; no `cloudflare:workers`
  imports outside the Cloudflare-only `@cossackframework/framework/SseDurableObject`
  entry). On Cloudflare without the binding, `/crpc`, `/sse`, and SSR fail
  with `COSSACK_SSE_BINDING_MISSING` instead of falling back to
  process-local state; Node and Deno keep the documented process-local
  backend.
- SSR initializes the scope with the rendered public state and hydrates the
  authoritative snapshot on later renders; it never resets shared state.
  `/crpc` executes SSE actions inside the coordinator's serialization slot
  with the request's AsyncLocalStorage snapshot, hydrating from the
  authoritative state — a stale browser snapshot cannot overwrite shared
  state. Middleware, layout DI, ORM scope, rate limits, and the `@Server`
  allowlist are preserved; component broadcasts fan out through the
  coordinator.
- The `/sse` subscription streams the snapshot plus incremental events with
  SSE `id` cursors, resumes from `Last-Event-ID` without replaying observed
  events, resynchronizes from the snapshot when history expired, and
  reconnects by closing the stream on poll failure. Ordinary results,
  redirects, custom Responses, and generators are supported through the
  coordinator.
- Scaffold/template/demo wiring: generated Cloudflare apps declare the
  `COSSACK_SSE` binding with a `new_sqlite_classes` migration and export
  `SseDurableObject` from the Worker entry; the framework library type
  generation includes the binding. New preflight diagnostic
  `COSSACK_ENV_BINDING_NOT_INHERITED` (Cloudflare environments do not inherit
  bindings — re-declare `durable_objects` per environment).
- Tests: two-Worker coordinator integration under workerd (serialization,
  publish/broadcast, disconnected queued caller, invalid frames, history
  bounds with resync, reload persistence, cancel slot release); framework
  router/endpoint tests against a structural fake coordinator (SSR hydration,
  authoritative stale-state protection, redirects, subscriptions,
  Last-Event-ID resume, missing-binding diagnostics); the generated staging
  app now builds and runs with the coordinator and covers shared-state
  continuation, stale client state, redirects, subscriptions, broadcasts, and
  reconnect under workerd. Existing D1/context stream, SSG, and asset checks
  retained.
- Environment note: the workspace `node_modules` pnpm virtual store was found
  emptied (2026-10-02 05:29, before this session); `pnpm install` was rerun
  after removing the stale state markers. The earlier intermittent deploy-test
  build failures came from this broken install, not from source changes.
- `pnpm build`, `pnpm tsc --noEmit`, `pnpm typecheck` (all packages),
  `pnpm audit:bundle` (28 neutral modules; Cloudflare entry Workers-safe), and
  `git diff --check -- . ':!reports.md'` passed after the final documentation
  edits. `pnpm test:unit` passed with 2,137 tests across 12 packages (auth 118,
  renderer 256, database 84, scaffold 82, core 615, node-adapter 10, UI 112,
  framework 526, CLI 263, desktop 16, deno-adapter 3, Studio 52), including
  both real-workerd integration tests.

### Distributed SSE prototype and agent handoff

- Added a native SQLite-backed `SseDurableObject` prototype with serialized
  actions, bounded snapshots/event history, and callback RPC that runs actions
  in their original Worker request context. Its native integration test uses
  two Workers sharing one namespace and exercises concurrent increments,
  scope isolation, AsyncLocalStorage, persistence after reload, and progress
  after canceling an HTTP response.
- This prototype is not connected to SSR, `/crpc`, or `/sse`, is not scaffolded,
  and is not yet a published package entry. The application still uses the
  Worker-local SSE store. The distributed SSE checklist item remains open.
- The user requested a commit and handoff to GLM. See
  [handoff-0.9.0.md](./handoff-0.9.0.md) for the implementation map, exact remaining
  integration work, verification results, and the later review checklist.
- Fixed the prototype's SQL row generic types and explicit async-iterator
  return arguments. The checkpoint build, root TypeScript check, all 11 package
  type checks, and database bundle audit passed. `pnpm test:unit` passed 2,125
  tests across 12 packages, including the new coordinator test. Exact commands
  and outstanding verification gates are recorded in the handoff note.

<a id="codex-cache-contracts-2026-10-03"></a>
## Codex cache contract review — 2026-10-03

Author: **Codex**. Continued from `e6e5677` while preserving the full 58-task
release scope. This checkpoint advances RT-18 and does not check it off.

Regressions reproduced cache manager cross-request binding reuse, missing-binding
fallback, custom option omission, skipped built-in registration, invalid TTL
writes, namespace collisions, lost nulls and normalized dot-segment keys. The
ownership baseline had 19 failures in 23 new cases; the duration baseline had
31 failures in 36 cases. The fixes select wrappers by actual binding identity/
complete named declarations, keep custom selections request-owned, and obtain
DO I/O stubs per operation. Custom factory disposal remains caller-owned and
nested env object mutations are outside the shallow memoization contract.

All public cache TTLs now use nonnegative integer milliseconds (`ttlMs`), matching
limiter windows. `set()` defaults to one hour; direct stores/batches omit expiry
unless supplied. KV frames namespace/key tuples and stores versioned logical
expiration envelopes, independently of rounded minimum-60-second retention.
Stale expired/corrupt KV reads cannot delete fresh replacements. SQL cleanup
matches its selected value/deadline, proven against a real replacement race.
DO query keys and found/missing batch replies preserve reserved paths and null.

Inputs are validated/snapshotted before writes: valid UTF-8 keys at most 512
bytes, JSON values at most 1 MiB, write batches at most 128 entries/2 MiB including
overhead. Memory evicts LRU entries at count/serialized-byte budgets, and invalid
capacity or oversized overwrite rejects first. These are per-store serialized
limits, not a process heap bound. DO JSON requests/replies are bounded, strict
UTF-8 and EOF checked; the client uses five seconds/current-request signals and
detached cancellation. Started storage writes may commit and later failures may
leave partial batches. Custom/DB I/O does not inherit the DO deadline.

The native fixture imports the compiled public cache/config/core modules in
workerd. Two Workers share native KV/DO bindings, separate alternate namespaces,
survive actual DO eviction and entrypoint reload, and expire short TTLs while KV
still retains the record. It checks missing-binding failure, private invalid
batch non-mutation, namespace collision prevention and null/dot-segment values.
This is native compiled-library acceptance, not proof of every generated cache
configuration, regional KV propagation, production write throttling, actual TCP
abort delivery, or remote producer shutdown.

Breaking migration: multiply old TTL numbers by 1,000, rename batch
`ttlSeconds` to `ttlMs`, update custom providers and deploy DO client/class
together. DB/DO stored epoch timestamps remain valid. New KV keys/envelopes
start a fresh cache; old indefinite records require explicit cleanup. Docs,
architecture, agent examples and runnable/generated acceptance were updated.

Final verification: framework **1144** cases in **53** files (cache contracts
**161**, shared transport matrix **354**); CLI **570** in **42** files including
all **14** generated/runtime cases, native cache storage acceptance and the
real-pnpm release fixture; database **86** in **15** files; scaffold **108** in
**4** files. Total **1908** passing cases across those suites. Final framework
and database builds pass, root `pnpm tsc --noEmit` passes and `pnpm typecheck`
passes all **11** package/test configs. Consumer suites ran after declaration
builds. Core/Node/Deno sources were unchanged in this checkpoint; retain their
prior evidence and separate release gates. Owned-file whitespace checks pass;
the pre-existing `reports.md` EOF warning is preserved with the user's changes.

Requirement audit: **14/58 checked, all 44 unchecked retained.** RT-18 still
requires limiter URL/key/namespace/capacity validation, explicit provider
capabilities/units in inspection and pre-operation rejection of unsupported
requested guarantees. RT-01's actual pre-header disconnect and arbitrary action
deadlines, Deno/Electron/live-provider gates and all other remaining criteria
stay open. Package versions remain 0.8.3 until REL-04. Preserve user-owned
`reports.md` and `.zcodeignore`.


<a id="codex-resource-lifecycle-2026-10-03"></a>
## Codex resource lifecycle review — 2026-10-03

Author: **Codex**. Continued after `cab1560`. Only **RT-03** newly completes:
**18 checked / 40 unchecked**, preserving all 58 original IDs. Read the detailed
[RT-03 audit](./release-0.9.0-plan.md#rt-03),
[RT-05 continuation](./release-0.9.0-plan.md#rt-05) and
[migration](./migration-0.9.0.md#typed-server-resources-and-dependency-aware-hydration).

Resource lifecycle calls now support declared public names with value inference.
The compiler records named fields so status/refresh can bind a getter before
render or after hydration without running arbitrary getters or duplicate loads.
Hydration retains dependencies and only settled values. Superseded/disposed
results and errors cannot replace live data or fail SSR. Refresh failure retains
last data, retry recovers and invalidation restores declared initial behavior.
Validation no longer misidentifies repeated references as cycles or invokes
custom JSON hooks before validating; Dates/class instances/non-finite values and
undefined dependencies fail clearly. Final review caught generated methods
serializing before resource validation. The generated method now validates before
RPC JSON as well as SSR settlement; native forged Date/toJSON calls reject before
conversion. Generator loaders receive an authored diagnostic.

Review also reproduced two settled task signal failures. Keeping controllers
until rerun/disposal and aborting before cleanup fixes subscriptions that lost
cancellation ownership when setup returned. TaskMethod includes signal and async
cleanup. This does not implement RT-05's typed paths or gated writes.

Native fixture review caught a missing ORM route scope, two implicit status
roles, and a browser filter declared as shared State. Resource HTTP passed, but
SSE authoritative state correctly reset that local selection. Fixture/recipe/
bundled example now use ClientState for local filters; requests carry dependency
arguments without publishing those filters as shared state. Private loader
failures stay out of browser output and chunks. Resource checks run early in the
native suite to expose fixture failures before the large policy/schema matrix.
An initial generated test had a quoting typo; a serialization assertion's expected
diagnostic changed while validation order was tightened. These intermediate
failures were fixed, not treated as passing evidence.

Final evidence:

- Core **1107 tests / 64 files**, framework **1316 / 57**, scaffold **108 / 4**.
- Published resource declaration fixture rejects invalid names/value use and
  preserves inherited/null/optional values without Vite.
- Core/framework builds, `pnpm tsc --noEmit` and all **11** package typecheck configs.
- Generated production Node/browser selection: **2 passed, 12 skipped / 14**;
  hydration reuse, stale response, retry and navigation cleanup are observed.
- Native staging/socket: **2/2**, about **109 seconds**; resource HTTP/SSE SSR,
  D1/user context, private failure/recovery and four precise dependency calls.
  Existing schema/policy/stream/counter/socket cases remain passing.
- Owned whitespace and JS syntax checks pass. User-owned reports.md/.zcodeignore
  remain untouched by staging. No full CLI, monorepo release, tarball, native Deno
  or Electron acceptance is claimed. Versions stay 0.8.3 until REL-04.

**Next for GLM:** finish RT-05's typed dependencies, owned commit API, contextual
cleanup failures and navigation/scoped-service disposal matrix. Then follow the
remaining original tasks and release gates. Never count cooperative signals as
proof that arbitrary writes are gated or ignored I/O stops. Do not reintroduce
controller deletion after setup or weaken authoritative realtime snapshots.

<a id="codex-task-ownership-2026-10-03"></a>
## Codex typed task ownership review — 2026-10-03

Author: **Codex**. Continued after `95b2dd4`. Only **RT-05** newly completes:
**19 checked / 39 unchecked**, preserving all 58 original task IDs. Read the
[criterion audit and next plan](./release-0.9.0-plan.md#rt-05),
[task guide](../docs/tasks.md#typed-dependency-paths) and
[migration](./migration-0.9.0.md#typed-task-dependencies-and-owned-commits).

Task decorators accept a host/dependency-shape generic and readonly typed paths.
Methods receive an immutable TaskContext as their second argument. Typed field
patches commit only while the execution remains current; obsolete/disposed
contexts return false, including results of ignored-cancellation I/O. Runtime
patch validation rejects nonreactive fields, promises/callbacks/classes and
getters before changing any fields. Direct writes remain cooperative; this API
cannot stop ignored I/O, undo mutations or transact across reentrant setters.

Review found subclass declarations could hide parent task siblings. Root-to-child
own registration now retains siblings and resolves child kind/track replacement
before server/client filtering. Signals remain owned after setup, abort before
cleanup and cannot revive after destruction. Setup, commit and cleanup failures
name component/task/trigger/stage. Rejected cleanup drains next setup/siblings;
owned scope disposal awaits cleanup. Late uncancellable setup cleans up once,
even after disposal, but cannot depend on an already disposed service.

Final evidence:

- Core **1115 tests /65 files**, including **16** task cancellation/ownership cases
  and a published-export typed dependency/patch fixture; framework **1316 /57**.
- Core/framework builds, root `pnpm tsc --noEmit` and all **11** package typecheck
  configs pass. A generated task app also passes its own TypeScript check.
- Generated Node production/browser **1 passed, 14 skipped /15** proves newer
  result retention, stale/disposed refusal, live sibling navigation and retained
  layout service identity, abort-before-service-disposal and exactly-once cleanup.
  Typed ServerTask private sentinel is absent from client chunks.
- Native staging/socket **2/2** pass with rebuilt packages, preserving existing
  HTTP/SSE/resource/schema/D1/counter/stream/socket behavior. No standalone
  service-task engine or native Deno/Electron acceptance is claimed.
- Initial declaration build caught TypeScript retaining a phase narrowing across
  an asynchronous closure. Ownership checks now read live context state rather
  than assuming the phase remains unchanged. Final type review fixed null-only/
  undefined-only fields being excluded as functions; published fixtures cover
  both tracking and commits. Builds/type tests then passed.
- Owned whitespace and JS syntax checks pass; reports.md has a user-owned trailing
  blank line and remains unstaged, along with .zcodeignore. Versions remain 0.8.3.

**Next for GLM:** RT-04's state/store/computed guidance and contextual serialization
matrix, using the concrete continuation plan above. RT-01 and every other original
unchecked task remain in scope. Full CLI/monorepo, tarball, native Deno/Electron
and release/version/publication gates are still open.

<a id="codex-state-diagnostics-2026-10-03"></a>
## Codex state contracts and diagnostics review — 2026-10-03

Author: **Codex**. Continued after `abd80ad`. Only **RT-04** newly completes:
**20 checked /38 unchecked**, preserving all 58 original IDs. Read the
[original criterion audit](./release-0.9.0-plan.md#rt-04),
[RT-06 continuation](./release-0.9.0-plan.md#rt-06),
[state guide](../docs/states.md) and
[migration](./migration-0.9.0.md#state-contracts-and-development-diagnostics).

The state guide now explains shallow/deep, public/client, computed, resources
and standalone stores with complete compiled public-export examples. Shallow
writes change raw data without rendering; replacement and nested store writes
request renders. Computed calculates on read, without an independent cache.
Standalone createStore compares replacements with Object.is; connectStore owns
a subscription that must disconnect. Documentation no longer recommends cloning
Proxy values directly with structuredClone or calling browser toasts from server
methods. Browser singletons live in client-only modules; server request data needs
request/service ownership.

Development public-state diagnostics use bounded read-only canonical RPC
inspection and report owner/field/boundary/path without values. Known cycles,
unsupported values and invalid Dates warn. Valid Dates/models/repeated acyclic
references retain their canonical behavior. Inspection does not run custom toJSON,
property getters or accessor object tags. Unknown representations are left to
the real serializer; depth/visit limits mean silence is not validity evidence.
Warnings deduplicate per field/issue, with recovery after a valid value. Shallow
diagnostics cover ClientState too, identify nested paths and the correct deep
decorator, keep stable identity, and ignore no-op/missing-delete/failed writes.
Removed old value-bearing change logs. Production writes and serialization remain
unchanged. Core's build preserves consuming Vite DEV selection with optional env
access, so published direct Node imports also remain safe.

Review fixed inherited field loss and inconsistent request sanitization. Gather
own reactive declarations root-to-child and replace the same field's complete
kind/options. Bootstrap, explicit/legacy service state, optimistic field discovery,
channel validation and component/service sanitizers now agree. Parent siblings
remain; public Store channels validate; client-only child replacements reject
forged parent public input. This does not add a new service task engine, a general
transaction, native value revival or a deeper Computed dependency system.

Final evidence and exact scope:

- Core `pnpm --filter @cossackframework/core exec vitest run`: **1147 tests /68
  files**. New state serialization/mechanism/docs fixtures and expanded shallow
  diagnostics cover objects/arrays/computed inputs, cycles/native values,
  inheritance, service forwarding/channel checks, sanitization, no getter/hook
  invocation, diagnostic bounds, published declaration imports and direct Node.
- Framework `pnpm --filter @cossackframework/framework exec vitest run`:
  **1316 /57**. Core/framework package builds pass. Root `pnpm tsc --noEmit`
  and `pnpm typecheck` pass all **11** package configurations. Both full example
  files compile against built declarations; the generated state app passes its
  own TypeScript check against package exports.
- Generated Node/browser command `pnpm --filter cossack exec vitest run
  tests/generated-runtime-build.test.js -t 'state documentation examples|gates
  typed task commits'`: **3 passed /14 skipped of 17**. The exact state example
  runs in development and production, proving shallow/replacement/deep changes,
  computed totals, local draft retention, actual flat RPC overlay exclusion,
  resource dependency arguments, DEV warnings and quiet production. The existing
  typed-task/navigation/scoped-service acceptance also passes.
- Native command `pnpm --filter cossack exec vitest run
  tests/deploy-integration.test.js tests/websocket-peer-integration.test.js
  --maxWorkers=1`: **2/2**, about **110 seconds**. Native HTTP/SSE resource pages
  preserve local Store edits, omit local/computed state from SSR and actual flat
  requests, retain inherited public fields, and reject forged client-only child
  overlays. HTTP accepts allowed public input; SSE keeps authoritative coordinator
  state. Existing actual D1/user/policy/schema/private failure/recovery, streams,
  socket cancellation and limiter cases remain passing. These are local disposable
  Workers; no account resources or live deployment were changed.
- Workers fixture review loaded the Workers skill, current primary best practices
  and latest Workers types; this change adds no platform APIs or Wrangler settings.
  Owned whitespace/JS syntax checks pass. No full CLI/scaffold/monorepo, tarball,
  native Deno or Electron release gate is claimed. Versions remain 0.8.3.

Intermediate failures and corrections:

- Constructor metadata typing needed to tolerate unknown input. Test render spies
  initially returned Promise<void>; they now match the required boolean result.
  Documentation outside package roots initially lacked @core resolution; a strict
  built-declaration fixture supplies paths, and generated app compilation also
  proves real package export resolution.
- Core's original library build erased DEV checks before consuming development
  apps could enable them. A first preserved DEV expression used nonoptional env
  access and failed outside Vite; the final optional expression and direct Node
  subprocess fixture fix and verify both cases.
- Plain generated Node Vite dev returned 404. The development acceptance harness
  now owns an explicit HTTP SSR bridge to the real Vite graph. Initial SIGTERM
  cleanup produced exit 143; owned IPC shutdown now closes the listener/Vite cleanly.
  This bridge does not fix scaffold or CLI Node dev. Its first-party integration
  stays open under [REL-03](./release-0.9.0-plan.md#rel-03) and guide execution CF-10.
- Initial browser assertions expected a nonexistent components wrapper; they now
  inspect the actual page initial.public. RPC fixtures also mistakenly treated
  request.state as state.public, making exclusion checks vacuous. Browser/native
  fixtures now assert actual flat keys. Native HTTP/SSE expectations distinguish
  accepted HTTP overlays from SSE coordinator authority instead of weakening it.
  The initial native fixture failure is superseded by the final rebuilt 2/2 run.

**Next for GLM:** RT-06's action-owned optimistic updates/rollback, using the
detailed plan. Preserve newer local edits, settle loading once, distinguish
rejection from uncertain completion, and resync without replay. Also fix the
first-party Node development gap before the final runtime gate. All other original
unchecked tasks remain; reports.md and .zcodeignore remain user-owned and unstaged.

<a id="codex-optimistic-ownership-2026-10-03"></a>
## Codex optimistic invocation ownership checkpoint — 2026-10-03

Author: **Codex**. Continued after `83ea5e4`. **No checkbox closes: 20 checked /38
unchecked**, all 58 original IDs preserved. RT-06 remains open against its
[original criteria and next plan](./release-0.9.0-plan.md#rt-06). Read the
[optimistic guide](../docs/optimistic.md) and
[migration](./migration-0.9.0.md#optimistic-call-ownership-and-flat-connection-snapshots).

The first 20-case controlled matrix reproduced 17 failures across HTTP, SSE and
socket calls. Previous locks grouped calls by method name, retained failed
previews, dropped a newer success when an older failure settled last, missed
nested Store changes, and sent previewed public values back as server input.

Core now owns each invocation and its resulting field layers separately. Known
plain trees capture before/after values without JSON hooks. Failure removes the
owned preview; newer confirmed data, another pending call, or a later local edit
remains. Component/service setters observe local edits, including Store paths.
Handlers run once and synchronously. Async handlers are refused; synchronous
promise/throw/over-depth failures restore captured changes while the actual action
can still dispatch. Native values remain scalar references. Inherited handler
metadata retains parent action siblings. Uncorrelated completion messages cannot
settle modern request-scoped loading counts.

HTTP/service request state now excludes pending previews, preventing an action
from receiving its own optimistic increment as its starting value. Explicit
services use the same ownership, sanitized state merging and subscriber loading
settlement. Shared rpc-state.ts removes the service's direct-hydration race and
keeps canonical JSON equality for unrelated fields, without a Cossack/Node import.
The current representation is whole-field resulting values. It does not infer
arithmetic/array contribution operations, transact database updates or stop
application I/O. A later nested edit protects the full field and can retain older
preview data it read. These limits are explicit in the remaining RT-06 audit.

Review also found Node/Deno initial WebSocket frames carried wrapped hydration
state, while clients expect a flat public record. The process runtime now exposes
getPublicState, and both Node upgrade paths plus Deno send that record. SSR
hydration remains wrapped. Actual socket/dev/HMR fixtures now inspect flat fields;
this fixes connection-state delivery, not the separate Node plain Vite dev 404 gap.

Final verification:

- `pnpm --filter @cossackframework/core exec vitest run`: **1197 tests /69 files**.
  New optimistic matrix has **48** cases; legacy cleanup file now has **5**.
  Coverage includes overlap/success/failure completion order, independent fields,
  nested/local values, later user edits, intervening broadcasts, null request
  values, timeout/cancel/disconnect, inherited/throwing/promise/over-depth handlers,
  actual component setters and explicit service subscribers.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1316 /57**.
  Node adapter suite **16 /4**, Deno adapter suite **16 /2** pass. These Deno
  fixtures run under Vitest; native Deno execution remains REL-03.
- Core/framework/Node/Deno package builds pass. Final root `pnpm tsc --noEmit`
  and `pnpm typecheck` pass all **11** package configurations. Builds complete
  before consumers run; no declaration-deleting build overlaps those checks.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  **18/18**, about **111 seconds**. New generated production HTTP/SSE pages prove
  late older validation rejection after newer success, preview exclusion from
  actual requests, client-only exclusion, nested authoritative state, correct
  loading and later user edits. The app passes its own tsc. Existing state DEV/
  production, task/navigation/scoped service, protected-route, schema/resource,
  portable builds and actual Node production/dev/HMR socket cases also pass.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: final **2/2**, about
  **121 seconds** while the full generated suite ran separately. Native Worker
  HTTP/SSE pages preserve newer count 20 after a held older invalid call, settle
  loading from 2 to 1 to 0, send confirmed count 0 for both calls, retain local
  Store edits and a later user count 99. Existing native D1/resource/schema/policy/
  limiter/stream/socket acceptance remains passing. All fixtures are disposable
  and local; no remote resource or live deployment changed.
- Owned whitespace and JS syntax checks pass. reports.md/.zcodeignore remain
  user-owned and unstaged. Versions remain 0.8.3. No full CLI/monorepo, tarball,
  native Deno, Electron or release/version/publication gate is claimed.

Intermediate corrections are retained here rather than hidden:

- A first targeted command named a nonexistent service-scope.test.ts; Vitest ran
  the two matching files only (**59** cases). The subsequent explicit commands
  included layout-service-scope and service-rpc-security, and final full core
  verification covers every core file.
- Review separated local user layers from the authoritative base so an intervening
  broadcast cannot erase a later edit while a call is pending. Request extraction
  now preserves an authored null, rather than falling back via nullish coalescing.
  Plain snapshots preserve enumerable symbol properties in local object trees.
- A throwing handler can throw undefined; a dedicated failure flag now restores
  it. Capture failures restore fields instead of escaping before the actual call's
  lifecycle is installed. Promise rejection is consumed without unhandled errors.
- The over-depth preview fixture initially also sent the same invalid deep tree
  as an RPC argument, so canonical validation correctly prevented dispatch. The
  corrected fixture generates the bad preview locally and sends valid arguments;
  it proves preview restoration and one actual call independently of RPC rejection.
- An initial native expanded run passed 2/2; the final rebuilt run after capture
  edge fixes also passed 2/2. Final full generated acceptance replaces earlier
  selected 1/18 optimistic and 2/18 adapter snapshots.
- Late review reproduced explicit service subscriber loading being cleared by an
  unrelated completion broadcast. Per-call subscriber loading now ignores that
  broadcast, counts duplicate subscriptions once, and releases the original owner
  even after unsubscribe without rendering it. The new cleanup regression failed
  before this fix and passed afterward.
- A later client-only tree beyond snapshot depth initially made its ordinary
  setter throw and could mask the RPC error/leak loading. A real Cossack setter
  regression reproduced it. Unsupported local values now retain references with
  owner/field diagnostics; cleanup catches per-field failures, drains siblings and
  settles loading. Public request extraction leaves canonical validation in charge
  instead of throwing an earlier plain-clone error.
- Full-state responses initially treated an unrelated echoed input as a newer
  confirmation, canceling another field's preview. Three transport cases failed
  before the fix. Unrelated echoes now retain that pending ownership; actual
  changes and the owning call's response still supply authority. Final source and
  rebuilt package verification supersede the earlier intermediate green runs.

**Completion audit: RT-06 stays open.** Controlled tests manually applying a
snapshot after uncertainty do not prove an actual lost-response read/reconnect.
Define the authoritative HTTP/service read contract, test an already committed
mutation with a deliberately lost reply and zero replay, finish native socket/SSE
recovery and late broadcast coverage, and audit operation-aware contribution
rebasing plus stream failure/cancellation. Follow the detailed next plan before
checking the task. Preserve all other original unchecked IDs and release gates.

<a id="codex-optimistic-operations-2026-10-03"></a>
## Codex explicit optimistic operation checkpoint — 2026-10-03

Author: **Codex**. Continued after `231bcc1`. **20/58 checked, 38 unchecked**.
No task closes. RT-06's contribution audit now has an explicit supported contract;
uncertain authoritative reads, native reconnect, different late snapshots and
stream/consumer acceptance remain open. Read its
[detailed continuation](./release-0.9.0-plan.md#rt-06),
[operation guide](../docs/optimistic.md#record-relative-operations) and
[migration](./migration-0.9.0.md#explicit-optimistic-operations).

The initial contribution tests failed **2/3**. Whole-field snapshots retained an
older failed increment and append after a newer pending or committed local edit.
Inferring a numeric delta or replaying arbitrary application handlers cannot
safely establish intent. Public `optimistic<Host>(target)` now records explicit
finite increment, detached append and first-structurally-equal remove operations
within the exact synchronous handler capture. Internal replay folds surviving
operations in invocation order. Handler code executes once. A no-op removal
still records intent if an older removal later fails. Array duplicate order stays
stable, and confirmed public replies exclude operations that they confirm.

Successful local operations remain ordered while other calls are pending. A
later local replacement supplies the base for subsequent relative operations.
One new regression initially discarded that replacement at local success; cleanup
now preserves it. Direct assignments keep absolute whole-field semantics. Mixing
assignment and operations on one field in a handler rejects and restores its
capture. Stale helpers reject before writes, including during another handler.
Runtime metadata checks reactive fields; published types check writable numeric/
array names and item shapes. The guide has a complete public-export example.
Types within methods require a concrete Host because polymorphic this leaves
mapped field constraints unresolved. Data operations accept finite acyclic plain
enumerable properties and do not execute serialization hooks. Native object and
arbitrary later nested-write limitations still apply.

A full generated browser run found an additional real regression: a late equal
SSE snapshot replaced count 99 with count 30 after the call settled. A controlled
regression reproduced it before correction. Weak per-target history now retains
the confirmed value only for fields with surviving user edits. Equal ambient
snapshots preserve those edits, including while another increment is pending.
Changed state and explicit RPC reads clear that field's history. Socket/EventSource
open and SSE resync clear history while preserving active preview ownership.
This compares values, not server revisions; it does not prove ordering between
different late snapshots. Actual native lost-response/reconnect tests remain
required before RT-06 closes.

Final verification against the rebuilt core:

- `pnpm --filter @cossackframework/core run build` passes, including declarations
  and rewritten ESM imports. Builds finish before package consumers run.
- `pnpm --filter @cossackframework/core exec vitest run`: **1225 /71**.
  New operation journal file **14** cases, including all six completion orders
  with four success/failure patterns; optimistic concurrency file **58** cases;
  cleanup **5**, published operations types **1**, realtime recovery **8**.
  The explicit final targeted command covers these five files (**86** cases).
  In addition to the prior transport matrix, checks cover stale/mixed/invalid
  helpers, item detachment, removal intent/duplicates, authoritative rebasing,
  retained local replacements, explicit service subscribers, late equal echoes,
  direct reads, and connection-open/resync authority with active previews.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1316 /57**.
  Final root `pnpm tsc --noEmit` and `pnpm typecheck` pass all **11** package
  configurations. No full monorepo/runtime release gate is claimed.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  final **18/18**, about **111 seconds**. Generated apps compile through published
  exports and run actual Node production HTTP/SSE with Chromium. Held negative
  and valid append requests cover older rejection while the newer call remains
  pending and newer success before older rejection. Counts/arrays retain only
  valid contributions; loading releases 2 → 1 → 0; local fields stay absent from
  actual request state. The earlier count-99 late-echo failure is fixed. Existing
  state/task/recipe/schema/resource/native-response/portable-build/Node socket
  production, development and HMR acceptance also passes.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: final **2/2**, about
  **120 seconds**. Native Worker HTTP/SSE acceptance now holds two append actions,
  rejects the older validated input while the newer action remains pending,
  retains one increment and only the newer array item, and settles loading once.
  Existing D1/resource/schema/policy/cancellation/stream/limiter/socket acceptance
  remains passing. This does not yet test a new optimistic mutation whose response
  is lost after commit and then recovers through a real socket reconnect.
- Owned whitespace, JS syntax and relative documentation file links pass. All
  58 IDs and checked states are preserved. Versions remain 0.8.3. reports.md and
  .zcodeignore remain user-owned and unstaged. No remote/live resource changed.

Intermediate evidence is retained:

- Initial direct-snapshot contribution matrix: **2 failed, 1 passed**. Replacing
  those previews with the explicit operation contract makes all three pass.
- The retained-local-replacement regression failed before cleanup was corrected.
- The first extra transport append cases registered metadata after proxies had
  already captured their reactive keys. The fixture now registers it before proxy
  installation; production components already follow that initialization order.
- Published/service/browser example checks initially failed on mapped polymorphic
  this. Concrete Host arguments now compile, and the guide names that constraint.
  The first selected browser run failed its app tsc before reaching a browser.
- An intermediate full browser suite passed 17/18 and exposed the late equal
  snapshot regression. It is not final acceptance. The new controlled case also
  failed before the history fix. Final rebuilt browser **18/18**, native **2/2**,
  core/framework/types results above supersede those intermediate runs.
- An intermediate native run passed 2/2 before the history fix. The final rebuilt
  native run also passes 2/2. No checks were restarted merely on an observation
  timeout; each restarted run followed an actual fixture/source correction.

**Next:** finish RT-06 steps 2–4. Use an explicit authoritative read/resource
contract for uncertain HTTP/service outcomes. Start with an actual persisted
record and hold/consume the mutation response before deliberately failing its
client delivery. Prove the committed record changes exactly once, the client
reports uncertainty, one read converges, and no mutation replay occurs. Reuse
existing `refresh$`/resource identity and RT-19 recovery instead of inventing a
second state system. Then exercise actual native socket loss/reconnect, SSE
recovery and different late snapshots, retained layouts/service subscribers,
post-yield errors and cancellation, with full original criterion audit. Continue
all other unchecked IDs and the Node plain Vite dev gap afterward.


<a id="codex-optimistic-reconciliation-2026-10-03"></a>
## Codex review: authoritative optimistic reads (2026-10-03)

Author: Codex. Continued after `7cdb039`. **20/58 checked, 38 unchecked.**
All original IDs remain. RT-06 stays open. This phase implements its explicit
read contract and committed/lost-response HTTP/service acceptance.

Core exports `isUncertainRpcError` and ServerResourceReconciliation. Components
call typed `reconcile$(failure, ...names)` for declared resources. Known uncertain
RpcError diagnostics select reads. Standard guard/pre-dispatch/consumer errors
skip reads. Server-correlated serialization failures and generic HTTP 5xx RPC
failures also qualify. Plain application errors and code-shaped objects do not.
This classification does not establish transaction outcomes for authored errors
following writes. Applications explicitly read data for those cases.

All names bind before read dispatch. Each unique target refreshes once. A weak
per-error cache shares the promise for the sorted target set and current dependency
identities. Cached recovery failures require explicit refresh$ for a later retry.
The exact resource entries bind synchronously before dependencies can change.
Results distinguish not-needed/recovered/failed/superseded/disposed. Recovery
errors remain separate from the original mutation failure. Destruction refuses
late state updates and discards the cache. Existing resource/RPC lifecycle owns
these reads. No new deadline or termination of ignored I/O is promised.

RPC target reconstruction previously started an incidental render resource read
before executing the selected generated read action. A failing router regression
observed two reads instead of one. Core's synchronous __renderRpcTarget depth
suppresses loader dispatch across nested reconstruction, with finally cleanup.
Framework uses this render entry point. Deterministic child targets still build.
SSR and ordinary browser resource discovery retain their behavior. The selected
action reads once. Existing child-target and transport guard acceptance passes.

A shared browser fixture runs real Node production HTTP/SSE pages and native
Worker pages backed by D1. Component and layout-owned service actions update a
record. The interception consumes the real response and checks persisted counts
before aborting delivery to the browser. Each case reports NETWORK_FAILED,
restores its preview, performs exactly one resource read, displays the persisted
value, releases loading and never dispatches the mutation again. Backend telemetry
requires mutations +1 and reads +1, not merely a matching final display. Service
requests carry an actual service reference. The SSE page requires its authenticated
EventSource to be open before the cases start. Actions/recovery still use HTTP
through its coordinator. Socket mutation loss/reconnect and SSE resync delivery
are not certified by these cases. Node's fixture uses process-owned records.
Native workerd uses actual D1 and request-user isolation.

Final verification:

- Core/framework builds pass, including published declarations and framework SSG.
  Builds completed before their consumers ran.
- `pnpm --filter @cossackframework/core exec vitest run`: **1255 /72 files**.
  New reconciliation tests: **30**, including dependency races, cached errors,
  code classification, disposal, explicit supersession and immutable snapshots.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1317 /58 files**.
  New reconstruction regression: **1**. Existing child/guard/conformance coverage
  passes. The targeted reconstruction/child/conformance command passes **491 /3**.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  **19/19**, about **116 seconds**. The new case generates, type checks and builds
  an app, then proves four committed/lost-reply cases in production Chromium.
  Existing recipes/state/tasks/resources/schema/HTTP/SSE/Node sockets/dev/HMR pass.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: **2/2**, about **111
  seconds**. Existing native D1/policy/schema/stream/cancellation/limiter/socket
  acceptance remains passing alongside the new persisted-recovery matrix.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package configurations.
  The complete public-export guide example is included in the resource type
  fixture. Its final standalone published-type test passes **1/1** after that
  addition. Negative names and immutable result types are covered too.
- Owned whitespace, fixture JS syntax and relative documentation file links pass.
  All 58 original checkbox IDs/states remain unchanged. Versions stay 0.8.3.
  reports.md/.zcodeignore are user-owned and unstaged. No remote/live resource changes.

Intermediate failures and corrections:

- The first unit cases failed because reconcile$ did not exist. A later dependency
  race sent both reads to the later record. Synchronous entry binding fixes that.
- The router reconstruction regression failed with two reads before suppression.
  An initial test import used a nonexistent router export and was corrected before
  the valid failing baseline. The final test uses the actual createApp factory.
- Generated fixture compilation exposed invalid Layout/Inject declarations and
  an untyped API Context. Correct Page service ownership, explicit Inject type,
  typed Hono context and an inline server$ loader now compile. These were fixture
  defects, not final production acceptance.
- A native run passed the peer test but failed while waiting for actual SSE open.
  Its test app omitted /sse/ from ORM middleware coverage. ORM-backed session
  validation failed outside database context, so the stream could not authenticate.
  The fixture now initializes database context on /sse/ before session validation.
  Earlier SSE-page checks did not wait for actual open. The stronger final check
  does. This changes the disposable test application, not library auth policy.
- The first full framework run passed 1316 cases and failed one partial component
  fixture lacking __renderRpcTarget. The fixture now models the new internal entry
  point. Its original forbidden-method status assertion passes unchanged. The
  final full suite above supersedes that intermediate run.

Next for GLM: finish RT-06 steps 3–4. Prove native socket loss after committed
writes, reconnect without replay, actual SSE resync and different late snapshots,
multiple pending calls, retained layout/service consumers, post-yield stream
errors and cancellation. Make every loading owner settle once. Audit all original
criteria before checking RT-06. Existing value fingerprints do not order different
snapshots by server revision. Keep broader RT-01 incoming disconnect/deadline/init
and RT-11 session gates separate. Continue all remaining IDs and the Node plain
Vite development 404 gap. The [detailed plan](./release-0.9.0-plan.md#rt-06) and
[Codex handoff](./handoff-0.9.0.md) identify the next concrete work.


<a id="codex-optimistic-socket-2026-10-03"></a>
## Codex review: native optimistic socket recovery (2026-10-03)

Author: Codex. Continued after `51bef75`. **20/58 checked, 38 unchecked.**
All original IDs and states remain. RT-06 stays open for the remaining SSE,
late-snapshot, retained-consumer and optimistic stream/service matrix criteria.

Native acceptance now generates a stateful durable-object page, builds through
published framework exports and runs Chromium against actual workerd and D1.
A mutation inserts an operation record, increments the durable count, updates
public state and signals commit while its correlated reply remains held. The
checker audits D1, loading and request IDs before a test-only DO endpoint closes
the real server socket. Held I/O releases after close starts. The browser reports
TRANSPORT_CLOSED, releases loading once and sees no correlated terminal reply.
Backend counts prove one committed write and zero mutation replay.

A second case sends two pending calls on one socket. The server queue starts one
write and holds it. The second invocation remains queued. Closing cancels both
client owners, and the queued method never executes. D1 contains one operation
and one increment for the pair. This preserves the actual socket queue contract,
not a claim that every pending client action already committed.

The harness then actually evicts the DO and closes any early replacement socket.
The checker requires a different open socket after eviction. Its authoritative
public snapshot restores the persisted count. The client-only draft stays local.
The next action uses restored component state and handshake identity. Actor
assertions require the signed-in user u1. The test app installs its ORM context on
/ws/ before ORM-backed session validation, as it already does on /sse/. This
changes disposable app wiring, not production authentication policy.

Two further native cases commit and yield before a client-visible stream error
or explicit client cancellation. Each retains persisted public data and the draft,
releases loading once and sends one action. The final D1 count is four, with four
unique committed operations. The extra queued request has no operation record.
A canceled or failed stream cannot establish rollback of a preceding write.
This matrix is component-owned. Explicit service and HTTP/SSE optimistic stream
acceptance remains separate.

The native fixture initially supplied an explicit registry. Inspection uncovered
a production default-registry bug: AppDurableObject used a package-relative glob
and registered bundled framework demos instead of generated application pages.
A failing unit regression returned those demo keys. The default now uses the
router's virtual application page/layout registry, preserves exact compiler paths
and accepts only default Cossack subclasses. Named helpers, missing defaults and
native HTTP modules are excluded. Final native acceptance subclasses this default
only to add socket-close control. Lookup/restoration use the published production
registry. No fixture-specific page registry remains.

A client asset audit also found socket SQL in an emitted native API chunk. The
route used D1 directly, so the import-based server-only detector did not classify
it. Client catalog imports could therefore expose the handler and its dependency.
The security load hook now uses the shared functional-HTTP source classifier for
route modules. It replaces their default/named export shapes with throwing stubs
before original imports/body evaluation. Explicit aliases and string export names
remain usable module bindings. Ambiguous runtime export stars refuse compilation
with a route-specific diagnostic. SSR returns original modules, and component
classes still follow normal stripping. This does not infer arbitrary non-route
module privacy. The native fixture scans every emitted client JS asset for both
socket SQL table names. Those checks pass after the compiler correction.

Final verification against the rebuilt framework:

- `pnpm --filter @cossackframework/framework run build`: declarations, library ESM
  and executed framework SSG pass. Build completed before runtime consumers ran.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1326 /60 files**.
  Default DO registry regression: **1**. Native HTTP boundary file: **8**, including
  four handler shapes, SSR preservation, component/helper separation, explicit
  aliases/string exports and export-star refusal. Final targeted boundary/security
  command passes **177 /2 files**. Child-target regressions also remain passing.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  final **19/19**, about **114 seconds**. Existing published Node/Deno/Desktop
  builds and production Node/browser HTTP/SSE/resource/state/task/schema/recipe/
  socket/dev/HMR acceptance pass. This is not native Deno or Electron execution.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: final **2/2**, about
  **120 seconds**. New generated native socket/eviction/stream cases, explicit
  actor identity and client SQL exclusion pass. Existing native D1/schema/policy/
  HTTP/SSE/cancellation/limiter/socket-peer acceptance remains passing.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package configurations
  pass on final source. Core implementation is unchanged from the preceding
  checkpoint's **1255 /72** suite. No new full monorepo release gate is claimed.
- Owned whitespace, fixture JS syntax and relative documentation file links pass.
  All original 58 checkbox IDs/states are preserved. Versions remain 0.8.3.
  reports.md/.zcodeignore remain user-owned and unstaged. No remote/live changes.

Intermediate evidence:

- The first fixture used transport websocket on Cloudflare. Capability validation
  rejected it before build. The fixture now uses durable-object. This was a
  fixture error, not a new production transport capability.
- The first native checker initiated browser close and waited for every pending
  action to commit while holding the first action. Its queue made that impossible,
  and the close handshake could also wait on the held callback. The valid checker
  distinguishes committed from queued work, initiates server close, then releases
  I/O. It never weakens the one-mutation/no-replay invariant.
- An intermediate native run passed after that correction with an explicit
  registry. The default registry regression subsequently failed on demo keys.
  Corrected default-registry/actor/eviction acceptance passed **2/2** before the
  API-body audit. It did not certify client SQL exclusion.
- The API boundary baseline failed **4/6**. Actual client chunk inspection also
  exposed the D1 SQL. Eight final boundary cases pass after the load guard.
  The final rebuilt native run executes both SQL-exclusion assertions and passes.
  Final rebuilt generated **19/19** and framework **1326/60** supersede the earlier
  **19/19** and **1318/59** runs before the compiler guard.
- Processes were observed through their original handles. No live test restarted
  solely because an observation timed out. Each rerun followed a fixture/compiler
  correction or a changed acceptance assertion.

References retrieved for native API/type checks: current
[Cloudflare WebSocket guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
and the latest Workers type definitions. Installed Wrangler harness declarations
provide the authoritative evictDurableObject signature used by the test.

Next for GLM: finish RT-06 steps 3–4. Prove actual SSE resync and different late
snapshots before/after call cleanup. Test retained layout/service consumers and
late subscribers joining pending service work. Extend optimistic post-yield
failure, malformed reply and cancellation acceptance through HTTP/SSE and explicit
services. Preserve mutation uncertainty, server snapshot authority and local
drafts, then audit every original criterion before checking RT-06. Echo history
is still value-based and does not order different snapshots by server revisions.
Broader RT-01 incoming disconnect/deadline/init and RT-11 session criteria remain
open. Continue every unchecked ID and the Node plain Vite development 404 gap.
Read the [plan](./release-0.9.0-plan.md#rt-06) and [Codex handoff](./handoff-0.9.0.md).

<a id="codex-retained-service-loading-2026-10-03"></a>
### Codex continuation: retained service consumers and loading (2026-10-03)

Author: Codex. Continued after `43c189a`. No checkbox closes: **20/58 checked,
38 unchecked**. All original IDs and states remain. RT-06 stays open for actual
SSE resync/different late snapshots and the remaining optimistic stream matrix.

Six of eight initial controlled regressions failed. A consumer that joined a
retained service during an action received its preview but no loading count.
The scope also attached unrelated action counts to consumers of another service.
ServiceScope now tracks active invocations by declared service class. Each
invocation records one release per consumer. New subscriptions attach to matching
pending work, including work that started without subscribers. Duplicate injection
and unsubscribe/rejoin keep one count. Shadowed scopes remain independent.

The ten final controlled cases cover late consumers, overlapping calls, work
without initial subscribers, duplicates/rejoin, another declaration, equal action
names, independent component loading, shadowing, exited consumers and settled work.
Ambient completion protection uses the same per-consumer RPC ownership guard.
A consumer that exits releases on settlement without another render. A consumer
that now only subscribes to another declaration also avoids an unrelated render.

Production Node/browser acceptance extends the actual scoped-service recipe.
The test adds a declared optimistic increment and observable loading to its
published application. It holds success and rejection replies during sibling
navigation. The retained layout, new sibling page and new nested consumer share
the preview and pending count, then receive confirmed state or rollback. Five
browser action dispatches remain five. Leaving the layout runs its actual disposal
hook once. Returning creates fresh service state.

The shared recovery fixture also runs under production Node and native workerd/D1.
It consumes a real committed service response, then holds delivery to the browser.
Navigation creates new consumers before settlement. Loading and local preview
remain visible in each consumer. Releasing the reply settles every count once.
Backend audit records one additional mutation, with no repeated action dispatch.
A subsequent real input rejection is held during return navigation. It removes
only its preview and performs no additional write. Actual HTTP and authenticated
SSE pages use the same fixture. The SSE connection must open before each relevant
case. Explicit service mutations still use HTTP. These assertions do not prove
SSE resync delivery or an optimistic streamed service action.

This change preserves the existing invocation lifetime. Layout exit does not
cancel that invocation. It does not stop ignored I/O, add a deadline or establish
transaction rollback. RT-01 retains its wider lifecycle/disconnect criteria.
Snapshot fingerprints still do not order different server snapshots.

Final verification:

- `pnpm --filter @cossackframework/core run build`: ESM and declarations pass.
- `pnpm --filter @cossackframework/framework run build`: declarations, library ESM
  and executed framework SSG pass. Runtime consumers ran after builds completed.
- `pnpm --filter @cossackframework/core exec vitest run`: **1265 /73 files**,
  including all **10** new loading regressions and existing optimistic cleanup.
- `pnpm --filter @cossackframework/framework exec vitest run`: **1326 /60 files**.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js`:
  final **19/19**, about **113 seconds**. Extended recipe and recovery navigation,
  previous production/browser tests and portable target builds pass. This does
  not establish native Deno or Electron execution.
- `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js
  tests/websocket-peer-integration.test.js --maxWorkers=1`: final **2/2**, about
  **125 seconds**. Native retained-consumer/D1 cases and preceding socket,
  eviction, stream, session, policy, migration and asset acceptance pass.
- Final root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package
  configurations pass. Owned whitespace, JS syntax and relative documentation
  file links pass. Versions remain 0.8.3. reports.md/.zcodeignore remain user-owned
  and unstaged. No remote/live changes or complete monorepo release gate claim.

Intermediate results: the original controlled suite failed **6/8** before the
source correction. Initial native acceptance failed **1/2**, and an already
running generated suite failed **1/19**. Both reached the new navigation/rollback
assertions but expected the wrong input-validation code. The established code is
COSSACK_VALIDATION_FAILED. Corrected acceptance preserves that production contract.
The final native **2/2** and generated **19/19** supersede those runs. An early
package typecheck overlapped framework declaration rebuilding and observed its
removed dist entry. Final root/all-package checks ran after rebuilding and pass.
No source change was needed for that build-order error. Tests were observed through
their original handles. Reruns followed source, coverage or fixture corrections.

Next for GLM: finish RT-06 steps 3–4. Prove actual SSE resync and different late
snapshots before/after cleanup. Extend optimistic malformed replies, post-yield
failure and cancellation across HTTP/SSE and explicit services. Preserve retained
consumer ownership, server snapshot authority and client-only drafts. Audit every
original done criterion before checking RT-06. Continue all other unchecked tasks,
including the Node plain Vite development 404 gap and final release gates.
Read the [plan](./release-0.9.0-plan.md#rt-06),
[service lifetime](../docs/services.md#scope-and-lifetime) and
[Codex handoff](./handoff-0.9.0.md).

<a id="codex-optimistic-sse-ordering-2026-10-03"></a>
## Codex optimistic SSE ordering and resync (2026-10-03)

Author: **Codex**. Continued after `4d8fff0`. Ledger remains **20/58 checked,
38 unchecked**. All original IDs and states remain. RT-06 stays open for the
remaining optimistic HTTP/service stream cases, complete example and criterion audit.

The new native browser/workerd/D1 case reproduced a production error: the server
committed one increment, but its ambient SSE publication doubled the pending browser
preview to two before the held HTTP response arrived. Publications now correlate the
originating request to only the target's active optimistic call. Public confirmation
removes that call's contribution without releasing its terminal response/loading
ownership. The authoritative snapshot remains plain public state; request identity
is bounded event metadata. Re-encoded stream frames retain the byte budget.

Event IDs, `X-Cossack-SSE-Cursor` response headers and reserved generator state metadata
order page snapshots. An older reply confirms its own contribution without replacing
a newer base; its return value still belongs to that action. Duplicate cursors cannot
undo a surviving edit. Higher revisions restore public authority after settlement,
even for equal values. Child-local replies never carry their parent page cursor.
ClientState/ClientStore drafts stay local. Sources without cursor metadata retain
value-fingerprint behavior. Reopening resets the client baseline; this is not a
universal epoch protocol across unrelated processes or server generations.

A second review found process-local SSR reset publication IDs under an existing
subscriber. Node/Deno now use process publication IDs across entry replacement and
recreation; active connection counts survive replacement. Scopes can observe gaps.
An actual stream reader regression proves updates before and after replacement.
The store remains process-local with no durable history or distributed guarantees.

Native acceptance uses actual cookie authentication, COSSACK_SSE, D1 and native
Chromium EventSource. A committed HTTP reply is consumed and held while its real
publication arrives. Different snapshots arrive before and after settlement; newer
state survives. A private fixture middleware ends the real subscription response
after a selected event. The client enters reconnecting; offline mode holds retry
while 130 real coordinator publications exceed retained history. Restoring network
allows automatic Last-Event-ID reconnect/resync. The browser converges to persisted
count 777 with its draft intact and no repeated mutation. The native EventSource
class and production subscription handler are unchanged.

Native optimistic streams commit/yield, then fail visibly or are canceled explicitly.
Counts converge to 778/779, loading settles once, drafts persist and each action
dispatches once. The cancellation fixture releases held application I/O explicitly;
it does not prove termination of ignored I/O or rollback. Production Node/browser
uses the actual process-local SSE backend for correlated confirmation, different
late snapshots and post-yield failure. It does not claim native Deno execution.

Thirteen controlled core cases cover own broadcast/reply order, coalesced updates,
other callers, old/duplicate state, pending local edits, equal newer authority,
reopened baseline and malformed header/final-frame cursors with correlated errors.
The Node SSR stream-reader case and router JSON/multipart frame assertions require
strictly increasing safe cursor values. All earlier owned tests remain.

Intermediate evidence: the original native case failed with browser count 2 versus
D1 count 1. Offline mode alone did not terminate an existing subscription, so the
fixture now closes the actual response before holding retry. Existing exact stream
expectations were updated to include cursor metadata and enforce monotonicity. The
Node fixture needed its generated Cossack type without Cloudflare Env. Two early
consumers overlapped dist rebuilding; final consumers run after completed builds.
These fixture/build-order failures are distinct from the reproduced production bug.

Final verification:

- Core ESM/declaration build passes; core **1278 /74 files** passes, including all
  **13** new snapshot ordering cases. Subsequent source changes affected only
  the framework process-local cursor and its tests.
- Framework build passes declarations, library ESM and executed SSG. Consumers
  run after builds complete. Expected local missing-secret warnings do not fail
  the build and provide no live-deployment evidence.
- Final framework suite: **1327 /60 files**, including the new SSR replacement
  stream-reader regression. Targeted scope/router stream checks: **58/58**.
- Final generated runtime suite: **20/20**, about **126 seconds**. Real production
  Node/browser SSE, previous service/navigation/recovery acceptance and portable
  builds pass. No native Deno or Electron execution claim.
- Final native workerd/D1 and socket-peer suite: **2/2**, about **138 seconds**.
  Native SSE confirmation/resync/post-yield failure/cancellation and all preceding
  auth, RPC, socket, migration, policy and client-asset audits pass.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package configurations
  pass after builds. JS syntax, owned whitespace and relative documentation file
  links pass. Ledger comparison against HEAD preserves all **58** original IDs
  and checkbox states. reports.md/.zcodeignore remain user-owned and unstaged.
  This is a targeted checkpoint, not the complete monorepo release gate.

Next for GLM: finish remaining HTTP and explicit-service optimistic malformed
payload, post-yield failure and cancellation cases. Preserve retained service
consumers and per-call ownership. Audit RT-06's original combinations and publish
its full example before checking the task. Keep wider RT-01 deadline/init/incoming
disconnect and RT-11 session gates separate. Continue all other unchecked IDs and
release gates. Node plain Vite development 404 remains CF-10/REL-03 work. Versions
stay 0.8.3. Preserve reports.md/.zcodeignore. No remote/live change was made.
Read the [detailed plan](./release-0.9.0-plan.md#rt-06),
[SSE contract](../docs/sse.md#optimistic-confirmation-and-snapshot-order),
[optimistic guide](../docs/optimistic.md), and [handoff](./handoff-0.9.0.md).

<a id="codex-optimistic-completion-2026-10-03"></a>
## Codex RT-06 completion and stream ownership (2026-10-03)

Author: **Codex**. Continued after `0272cba`. RT-06 now passes its original
criterion audit: **21/58 checked, 37 unchecked**. All original IDs remain.
Only RT-06 changes checkbox state. The complete objective remains all 58 tasks.

The first controlled stream suite found a real service bug: cancellation before
iterator startup never entered the generator's finally block, retaining both the
preview and loading. Explicit service cancellation now invokes idempotent cleanup.
Terminal/finally cleanup cannot release the call twice. Component/service calls also
share an abort-aware response waiter. Cancellation/deadlines stop waiting even when
a request producer ignores abort. The original promise stays observed, and a late
body is released without state hydration. This does not terminate external I/O.

The final **32-case** controlled suite covers component HTTP/SSE and explicit-service
streams: confirmed yields followed by visible errors, malformed JSON, wrong request
IDs, missing completion or trailing terminal data; pending-reader cancellation,
before-iteration cancellation, stalled pre-header cancellation/deadlines and
post-yield deadlines. Repeated cancellation and result reads dispatch once and keep
loading settled. Late consumers inherit loading, then settle together. Two service
cases confirm count while independent title rejects, with/without a later local edit.
Confirmed public state survives. Unconfirmed client-only previews roll back.

A shared **25-case** production Node/browser and native Chromium/workerd/D1 matrix
executes real mutations before failures. Component HTTP/SSE streams and explicit
services on HTTP/open SSE/open socket pages cover post-yield error, cancellation,
malformed JSON, truncation and trailing terminal frames. The test corrupts only
bounded actual response delivery after the backend commits. Each record has one
mutation, each browser action dispatches once, public state remains one, local drafts
persist, and page/layout/nested loading is zero. Services use HTTP regardless of page
transport. Earlier native component socket stream failure/cancellation stays verified.
Cancellation fixtures explicitly release held application I/O; they do not prove
server rollback or termination of ignored work.

The published [page](../docs/examples/optimistic-stream.ts) and
[private store](../docs/examples/optimistic-stream.server.ts) are executable artifacts.
The page uses validated input, explicit previews, rpc$ iteration/cancel, automatic
loading, a ClientState draft and declared persisted reads. The private SQL helper
uses the authenticated request's owner ID and an atomic parameterized increment.
It uses SQLite/D1 syntax and shows demo table creation; real apps use a migration.
Generated fixtures copy the exact page. Native D1 uses the exact helper; Node replaces
only persistence. Actual controls exercise success, authored post-write failure and
cancel/read convergence. Three increments remain three dispatches and persisted
count three; no uncertain mutation is retried. The SQL names stay out of client chunks.

The example chooses refresh explicitly for its deliberately authored post-write
client-visible error; that error is outside transport uncertainty classification.
Network/cancel uncertainty uses reconcile$. A recovered read remains distinct from
the original mutation's outcome. The read can include other callers' changes.

Final verification:

- Core ESM/declaration build passes. Full core suite **1310 /75 files**, including
  all **32** new stream cases and the published-export example declarations.
- Framework build passes declarations, library ESM and executed SSG; full suite
  **1327 /60 files**. Consumer runs use completed dependency builds.
- Generated runtime suite **21/21**, about **139 seconds**, including actual
  production Node/browser stream and example acceptance, all prior navigation,
  service, recovery and portable-build checks. The production test server now
  attaches the real Node WebSocket runtime before announcing its origin.
- Native workerd/D1 and socket-peer suite **2/2**, about **140 seconds**, including
  the 25-case stream matrix, exact example/helper, preceding socket eviction/SSE
  resync, sessions, policies, migrations and client-private-SQL asset audits.
- Root `pnpm tsc --noEmit` and `pnpm typecheck`: all **11** package configurations
  pass. JS syntax, owned whitespace, documentation file links and exact ledger
  ID/state comparison are checked before commit. No complete monorepo release
  gate, native Deno/Electron execution or live deployment claim.

Intermediate results: an import typo stopped the first new suite before collection.
The initial collected **24-case** run had **18 failures**; one reproduced the service
pre-start cancellation bug. The others reflected fixture assumptions about closed
stream cancel callbacks, the existing truncated-stream error code, or canceling a
late already-closed body. Corrected assertions inspect the actual EOF/reader ownership
contract. The extended final 32 cases pass. The first example declaration run lacked
published package paths for files outside packages; explicit declaration paths now
compile the real artifacts. An expanded Node socket-page run timed out because the
production fixture omitted runtime.attach. Correct fixture wiring makes the connection
open, and the final generated 21/21 supersedes that run. Native final 2/2 follows all
fixture/example extensions. Tests were observed through their original live handles.

Read the [original criterion audit](./release-0.9.0-plan.md#rt-06),
[guide](../docs/optimistic.md#cancel-a-stream), and [Codex handoff](./handoff-0.9.0.md).
Next for GLM: RT-07 typed URLs/parameters/API contracts from the compiler route model
and existing inspection metadata, then every other unchecked task and release gate.
Broader RT-01 initialization/incoming disconnect/server-execution deadlines, RT-11
sessions and Node plain Vite development 404 remain open. Versions stay 0.8.3 until
REL-04. reports.md/.zcodeignore remain user-owned and unstaged. No push/publication,
live cloud operation, external message or new chat was performed.

<a id="codex-navigation-acceptance-2026-10-04"></a>
## Codex: RT-08/RT-09 acceptance audit (2026-10-04)

Audited the original Purpose, Approach and Done when requirements against source,
public contracts and behavioral assertions. The criterion tables are in
[RT-08](./release-0.9.0-plan.md#rt-08) and [RT-09](./release-0.9.0-plan.md#rt-09).
Both tasks are complete. The checklist retains all 58 IDs: 24 checked, 34 open.

Added browser regressions for an older linked-page response arriving after a newer
commit, actual fragment scrolling with missing-target fallback, and navigation
without `document.startViewTransition`. The transition example now exposes the
stable `item-preview` target. The rapid-link fixture uses temporary anchors because
collapsed sidebar groups do not render their links. Its initial fixture timeout was
corrected before the final complete browser run.

Verification on the final implementation:

- Full generated-runtime file: **31 passed**, including actual production Node and
  native workerd ownership, backend-read and interrupted same-URL history fixtures.
- Navigation, guard and view-transition browser suites: **27 passed**.
- Focused core URL-state, published type, SSR/hydration and navigation suites:
  **70 passed across 6 files**.
- Framework navigation outcome/owner suites: **50 passed across 2 files**.
- Root `pnpm tsc --noEmit` and all **11** package type checks: passed.
- Whitespace check excluding the user's existing `reports.md`: passed.

Logs: `/tmp/cossack-navigation-matrix-audit.log`,
`/tmp/cossack-navigation-browser-verified.log`,
`/tmp/cossack-navigation-audit-core.log`,
`/tmp/cossack-navigation-audit-framework.log`,
`/tmp/cossack-navigation-audit-root-types-verified.log` and
`/tmp/cossack-navigation-audit-package-types-verified.log`.

The initial Playwright startup probe delayed server launch. A locally started
server supplied the final browser runs. A concurrent automatic startup hit the
occupied devtools port during the first run; the final run reused the single
server and passed. No credentials, remote resources or deployment were required.

RT-28 still needs its broader devtools snapshots/timeline interface. Navigation
events alone do not close it. REL-03 still requires the complete final release
matrix. Versions remain 0.8.3 until REL-04. Arbitrary external side effects, ignored
application I/O and legacy global DI remain outside the documented ownership
contract. No other task status changed.

<a id="codex-local-mcp-2026-10-04"></a>
## Codex: Local MCP inspection foundation (2026-10-04)

Implemented the `cossack-mcp` package binary with the official MCP server SDK
2.3.0 and strict Zod input/output schemas. The SDK client is a development-only
test dependency. pnpm updated the lockfile and added version-specific release-age
exceptions for the new SDK server/core/client packages. Framework versions remain
0.8.3. No application runtime imports the SDK.

The read-only `inspect_project` tool shares static route/deployment/provider models
with CLI inspection. Route explanation/check logic now lives in an output-free
service. The server binds to the real startup project path and reports installed
CLI/framework versions. The import-only framework export exposed a version lookup
bug during testing; manifest lookup now follows package search paths without
executing modules. Missing framework installation reports null.

Workers capture dependency logs and terminate on cancellation, deadline or shutdown.
Concurrency and serialized result sizes are bounded. The public setup guide records
these limits and the remaining tool families. Local project binding does not claim
a sandbox against malicious dependency/source files.

Verification:

- **234 tests across 8 files** passed: MCP, inspect, inspection acceptance, provider
  inspection, CLI subprocess, command contracts, JSON matrix and command specs.
- After aligning default environment selection, **23 tests across 2 files** passed
  again (MCP and inspect). The follow-up covers inherited environment selection.
- Root `pnpm tsc --noEmit` and all **11** package type checks passed after final edits.
- Whitespace check excluding the user's existing `reports.md` passed.
- Actual SDK subprocess tests cover legacy and `2026-07-28` protocol clients,
  installed versions, unknown tools/fields/route paths and configured-secret
  redaction. Raw subprocess tests prove prompt exit on pre/post-initialization EOF
  and SIGTERM. Worker tests prove synchronous cancellation, timeout, shutdown,
  concurrency limits and oversized-result rejection.

Logs: `/tmp/cossack-mcp-regression.log`, `/tmp/cossack-mcp-env-verified.log`,
`/tmp/cossack-mcp-root-types-verified.log` and
`/tmp/cossack-mcp-package-types-verified.log`.

CLI-07 stays unchecked: installed documentation, stored test results, development
traces, further native interruption acceptance and packaged-entry acceptance remain.
The checklist still contains 58 IDs, with 24 complete and 34 open. Nothing was
published, deployed or pushed. User changes in `reports.md` and `.zcodeignore`
remain outside this checkpoint.

<a id="codex-installed-catalog-2026-10-04"></a>
## Codex: Installed-version catalog foundation (2026-10-04)

Added `cossack docs` and MCP `read_documentation` through one offline service.
The catalog follows installed package search paths rather than repository source
paths. It reads versions, manifest hashes and declared export targets with their
conditions and availability. No entrypoint executes. Re-reading after a manifest
change removes stale exports and refreshes versions. Unknown package paths reject
before file access, and malformed manifest errors omit raw contents.

Command schemas come from CLI command metadata. A packaged agent guide identifies
its CLI version and states discovery limits. New scaffolded AGENTS files point to
local discovery commands. MCP keeps its outer framework-version metadata fresh,
including packages installed after the server started. Both tools use strict input
and versioned output schemas and the existing cancellable worker runner.

Verification:

- **212 tests across 6 CLI files** passed: documentation, MCP, command contracts,
  command specs, CLI subprocess and JSON matrix.
- **78 scaffold tests** passed, including generated offline-discovery guidance.
- After allowing startup with malformed framework metadata, **18 MCP/catalog tests**
  passed again. A broken manifest now produces a redacted tool diagnostic instead
  of preventing the agent from inspecting the project.
- Root `pnpm tsc --noEmit` and all **11** package type checks passed.
- Whitespace check excluding the user's existing `reports.md` passed.

Logs: `/tmp/cossack-docs-regression.log`, `/tmp/cossack-docs-scaffold-final.log`,
`/tmp/cossack-docs-malformed-verified.log`,
`/tmp/cossack-docs-root-types-verified.log` and
`/tmp/cossack-docs-package-types-verified.log`.

CLI-07 and CLI-08 remain open. File presence is not evidence of a valid runtime
import. Named API/component symbols, signatures, runtime support, authored and
executable examples, wildcard expansion and offline installed-tarball verification
still need implementation/evidence. Test-result and devtools trace tools remain
CLI-07/RT-28 work. All 58 task IDs remain: 24 complete, 34 open. Versions stay
0.8.3 until REL-04. No remote publication, deployment or push occurred.

<a id="codex-declaration-index-2026-10-04"></a>
## Codex: Compiler-backed declaration catalog (2026-10-04)

Added optional per-package symbol indexing to CLI/MCP documentation. The Node-only
CLI pins TypeScript API 6.0.3 under `typescript-api`; the root TypeScript 7 compiler
is unchanged. Public signatures come from fresh programs over installed type files,
not regex parsing, repository sources or executed entrypoints.

The index includes aliases and re-exports, overloads/generics, public class and
interface members, static members, object/namespace/enum helpers and CommonJS
export assignments. It omits private/protected members and constructors and marks
abstract classes. Declared type-only class/function signatures never imply runtime
value availability. Programs do not load project tsconfig plugins. The documentation
records the fixed ES2022/ESNext/Bundler strict profile with no automatic ambient
packages, partial/unavailable states and the first-100 diagnostic limit.

Tests prove freshness when referenced declarations change without manifest/version
changes. They also cover missing/unresolved type files, non-module declarations,
private constructor exclusion, CLI input validation and actual MCP worker results.
A manual installed-core run indexed 357 root exports and four additional declared
entrypoints. It returned partial with five unresolved platform-type diagnostics,
which remains a reported limit rather than hidden compatibility evidence.

Verification:

- **222 tests across 7 CLI files** passed before the final member-visibility follow-up.
- **30 declaration/documentation/MCP tests across 3 files** passed after the final edits.
- Root `pnpm tsc --noEmit` and all **11** package type checks passed after final code changes.
- Whitespace check excluding the user's existing `reports.md` passed.

Logs: `/tmp/cossack-declaration-regression.log`,
`/tmp/cossack-declaration-verified.log`,
`/tmp/cossack-declaration-root-types-verified.log` and
`/tmp/cossack-declaration-package-types-verified.log`.

CLI-08 stays unchecked. Authored API/component/recipe guidance, executable examples,
verified runtime support, wildcard/implicit type discovery and offline installed
package acceptance remain. CLI-07 still needs test-result and devtools trace tools.
The checklist retains 58 IDs: 24 complete, 34 open. Versions remain 0.8.3 until REL-04.

<a id="codex-export-discovery-2026-10-04"></a>
## Codex: Public export and implicit declaration discovery (2026-10-04)

Implemented concrete wildcard inventory with exact/more-specific precedence and
private null exclusions. Repeated target stars share one named capture, including
numeric trailers. Unreachable default branches are skipped. Array fallbacks follow
resolution rules instead of selecting whichever file exists. Native Node tests
verify exported paths and private denial without executing package entrypoints.

The scanner skips nested symlinks and node_modules, bounds directory-entry visits
at 20,000 and reports incomplete scans. Unsupported URL targets/file names and
constant pattern mappings remain explicit. Targets reject traversal, encoded
separators and forbidden path segments. These are discovery limits, not a claim
that all local projects are sandboxed.

TypeScript extension substitution finds declarations beside JS/MJS/CJS targets
and legacy main/default-index entries. The catalog records each candidate's
conditions, resolved file and status. Missing public type coverage makes the index
partial. Wildcard type files can be indexed while their runtime target remains
missing. Runtime availability remains unverified.

Verification:

- **243 tests across 8 CLI files** passed before the final type-only/numeric-trailer follow-ups.
- **51 focused discovery/declaration/documentation/MCP tests across 4 files passed** after the final follow-ups.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed after the final code changes.
- `git diff --check -- . ':!reports.md'` passed.

Logs: `/tmp/cossack-discovery-regression.log`,
`/tmp/cossack-discovery-final-verified.log`,
`/tmp/cossack-discovery-root-types-verified.log` and
`/tmp/cossack-discovery-package-types-verified.log`.

CLI-08 remains open for authored guidance, executable examples, verified runtime
support and offline tarball acceptance. CLI-07 test-result and devtools trace tools
remain open. The release checklist retains 58 IDs, with 24 complete and 34 open.
Versions remain 0.8.3 until REL-04. No publication, deployment or push occurred.

<a id="codex-installed-docs-acceptance-2026-10-04"></a>
## Codex: Installed documentation acceptance (2026-10-04)

Added `pnpm test:agent-docs:local`, also included in the existing generated-app
CI acceptance path. It builds and packs local packages, generates a minimal
application and installs the tarballs. CLI/MCP entrypoints and inspected packages
must resolve inside that installation, rather than to workspace symlinks.
The test checks installed versions, command metadata, packaged/generated guidance,
renderer signatures, CLI/MCP parity and version/export refresh in a running server.
Manifest replacement uses new files to avoid modifying pnpm store hardlinks.

Node fetch, socket, HTTP and DNS calls are blocked during discovery. The guard
records attempts even if callers catch errors. It is tested before discovery,
and the final assertion proves no attempts occurred. MCP workers inherit the
guard. Dependency installation can use the registry. This is ordinary Node API
coverage, not operating-system isolation against hostile native code.

Verification:

- `pnpm test:agent-docs:local` passed after correcting a test assertion to expect
  the server's explicit `isError: false`. Log: `/tmp/cossack-agent-docs-tarball-final.log`.
- The acceptance builds publishable packages before packing them. The focused
  command skips the unrelated application build/runtime smoke scenarios.
- Script syntax checks, workflow YAML parsing and whitespace checks passed.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed.
  Logs: `/tmp/cossack-docs-acceptance-root-types-final.log` and
  `/tmp/cossack-docs-acceptance-package-types-final.log`.

CLI-08 remains open for authored API/component/recipe guidance, executable
examples, verified runtime support and acceptance of that remaining content.
The renderer signature check does not establish complete declaration coverage
for every package. CLI-07 stored results and RT-28 trace tools remain open.
Task status remains 24 complete and 34 open. Versions remain 0.8.3.
No publication, deployment, push or external credential rotation occurred.

<a id="codex-package-guidance-2026-10-04"></a>
## Codex: Package-owned guidance and executable examples (2026-10-04)

Library packages can now publish `agent-docs.json` with authored usage explanations
and TypeScript examples. The shared CLI/MCP reader ties each guide to its installed
package version, hashes fresh content and reports unavailable/invalid/partial data.
The bounded reader validates schema and identities, rejects files outside the
package and omits guides whose listed public imports are unavailable. Errors do
not expose raw guide contents. CLI text output includes prose and example source.
Discovery never evaluates the examples or claims runtime compatibility.

Core includes a typed route URL guide and encoded parameter/catch-all example.
Renderer includes a server HTML guide and escaped-text example. Both files ship
in package tarballs. The installed acceptance harness compiles their source with
strict TypeScript and executes emitted JavaScript through public package exports.
The harness selects these repository-owned guides explicitly. It does not offer
execution of arbitrary installed guidance through the CLI or MCP.

The initial example run passed compilation and behavior assertions but detected
a local socket attempt from the tsx loader. The final harness uses TypeScript's
emitted JavaScript directly. The final zero-attempt network assertion passes.
CI now runs generated-app acceptance for core and renderer changes too.

Verification:

- **61 tests across 5 files passed**, covering guidance validation/refresh,
  human CLI output, declaration/export discovery and MCP behavior.
  Log: `/tmp/cossack-package-guidance-tests-final.log`.
- `pnpm test:agent-docs:local` passed: **2 packaged examples compiled and executed**,
  installed CLI/MCP parity, stale export/guide removal and zero Node network attempts.
  Log: `/tmp/cossack-package-guidance-tarball-final.log`.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed.
  Logs: `/tmp/cossack-package-guidance-types.log` and
  `/tmp/cossack-package-guidance-package-types.log`.
- Script syntax, workflow YAML parsing and whitespace checks passed.

CLI-08 remains open for broader authored API/component/recipe coverage, verified
runtime guidance and the original RT-23/REL-02 dependency gates. These examples
establish Node behavior only. CLI-07 stored results and RT-28 traces remain open.
Task status stays 24 complete and 34 open. Versions remain 0.8.3. No publication,
deployment, push or external credential rotation occurred.

<a id="codex-recipe-guidance-2026-10-04"></a>
## Codex: Recipe guidance and pure registry declarations (2026-10-04)

Scaffold now publishes package-owned guides for resource, mutation, scoped-service
and protected-route recipes. They explain generated behavior, limits, dry-run and
application commands, adaptation steps and the boundary between static capability
checks and remote readiness. Four executable planning examples use the installed
public registry. Protected-route coverage checks auth/database/UI dependencies,
D1 binding requirements and rejection of a Node/D1 selection.

A compiler fixture reproduced TS2591 for Buffer when importing only the pure
registry with no Node ambient types. The registry declarations previously
re-exported the root filesystem declarations. Shared metadata declarations now
live in registry.d.ts, and the root API re-exports them. Dedicated fixtures verify
both the pure registry and the full Node API. Runtime recipe behavior is unchanged.

Verification:

- **109 scaffold tests across 5 files passed** after the declaration fix.
  Log: `/tmp/cossack-recipe-guidance-tests.log`.
- **2 final public declaration checks passed**, covering the registry without Node
  globals and the root API with Node types. The root fixture was corrected to
  pass recipe options rather than the distinct add-feature options type.
  Log: `/tmp/cossack-recipe-guidance-types-tests-final.log`.
- `pnpm test:agent-docs:local` passed with **6 compiled/executed installed examples**,
  CLI/MCP parity, version/export refresh and zero Node network attempts.
  Log: `/tmp/cossack-recipe-guidance-tarball.log`.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed.
  Logs: `/tmp/cossack-recipe-guidance-types.log` and
  `/tmp/cossack-recipe-guidance-package-types.log`.
- Script syntax and whitespace checks passed.

CLI-08 remains open for broader API/component guidance, verified runtime support
and its original RT-23/REL-02 gates. These examples verify planning behavior in
Node, not application execution on every adapter or remote readiness. Task status
remains 24 complete and 34 open. Versions remain 0.8.3. No publication, deployment,
push or external credential rotation occurred.

<a id="codex-prop-catalog-2026-10-04"></a>
## Codex: Installed component prop contracts (2026-10-04)

Declaration catalogs now retain member comments, JSDoc tags, optional callback
signatures and index signatures. Exported classes with public props expose an
instantiated propsContract, including inherited generic contracts. Private and
protected props stay excluded. Union shapes report partial common-member views,
and unstructured types such as any remain unknown. Declared object shapes do
not imply strict attribute typing, browser behavior or accessibility.

The actual UI catalog exposes Button's declared prop descriptions and unrestricted
string/any index signature. Existing unresolved platform diagnostics stay partial.
The installed tarball acceptance now compares the UI catalog through CLI and MCP.
The first fixture attempt correctly reported UI unavailable because the minimal
app had no direct UI dependency. The acceptance fixture now declares the local UI
tarball as a development dependency without adding UI feature source or imports.
CI includes UI changes in its generated-app acceptance trigger.

Verification:

- **36 tests across 3 CLI files passed**, including inherited generic props,
  private/unknown/union shapes, JSDoc, optional callbacks and index signatures.
  Log: `/tmp/cossack-props-catalog-tests.log`.
- `pnpm test:agent-docs:local` passed with installed UI CLI/MCP parity,
  six compiled/executed examples, fresh manifests/guides and zero Node network attempts.
  Log: `/tmp/cossack-props-catalog-tarball-final.log`.
- Root `pnpm tsc --noEmit` and all 11 package checks via `pnpm typecheck` passed.
  Logs: `/tmp/cossack-props-catalog-types-final.log` and
  `/tmp/cossack-props-catalog-package-types-final.log`.
- JavaScript syntax, workflow YAML parsing and whitespace checks passed.

RT-23 remains open: Table is a styled wrapper, and the inspected UI sources have
no DataTable implementation despite its blocks README mention. Controlled server
data, typed column accessors, selection/pagination, native attribute contracts and
keyboard/focus/accessibility acceptance still require implementation. CLI-08 also
retains broader usage/runtime guidance and its RT-23/REL-02 gates. No checklist
status changed: 24 complete and 34 open. Versions remain 0.8.3. No publication,
deployment, push or credential rotation occurred.

<a id="codex-data-table-2026-10-04"></a>
## Codex: Controlled DataTable foundation (2026-10-04)

Added the generic public DataTable with typed row keys/accessors, column IDs,
controlled page/filter/sort state, explicit totals and stable string row IDs.
Parents own data fetching and stale-response handling. The table renders only
supplied rows. Selection updates copy the controlled set, preserve off-page IDs,
ignore unavailable/unselectable rows and block changes during loading/errors.
Column/row identity and query invariants fail explicitly.

The component provides caption, labeled native controls, sort state, mixed page
selection, status/error/empty views and retry behavior. Chromium exposed focus
loss when paging buttons became disabled during loading. Focusable aria-disabled
controls now guard inactive actions and retain focus through loading/boundaries.
Retry transfers focus to the stable filter before removing its own button.
The package-owned guide documents these contracts and application responsibilities.

Published type acceptance exposed missing .js suffixes in UI declaration imports.
UI builds now use the existing declaration rewrite. DataTableProps is a closed
object type, compatible with renderer composition without an arbitrary attribute
index signature. Consumer tests reject invalid keys, accessors and competing
key/accessor definitions. Table remains available as the simpler native wrapper.

Verification:

- **119 UI tests across 10 files passed**, including controlled state/selection,
  SSR semantics and escaping, invalid inputs and published consumer types.
  Log: `/tmp/cossack-data-table-final-ui.log`.
- **Chromium HTTP-data acceptance passed** using a production bundle of public
  dist exports: server page/filter/sort/size requests, off-page selection, loading,
  empty/error/retry flows, native keyboard activation and retained focus.
  Log: `/tmp/cossack-data-table-final-browser.log`.
- `pnpm test:agent-docs:local` passed: installed DataTable prop and guide discovery,
  UI CLI/MCP parity, six existing executable examples and zero network attempts.
  Log: `/tmp/cossack-data-table-tarball.log`.
- UI build, root `pnpm tsc --noEmit` and all 11 package checks passed.
  Logs: `/tmp/cossack-data-table-final-build.log`,
  `/tmp/cossack-data-table-final-root-types.log` and
  `/tmp/cossack-data-table-final-package-types.log`.
- Whitespace checks passed, excluding the user's existing reports.md changes.

RT-23 remains open. The browser fixture uses a real HTTP endpoint and compiled
public components, but is not a generated Cossack app. Next verify that integration
with server resources/query state, compiler/hydration and runtime ownership, then
audit native attributes/events/accessibility across the remaining UI catalog.
CLI-08/REL-02 retain their broader acceptance gates. Status remains 24 complete
and 34 open. Versions remain 0.8.3. No publication, deployment, push or credential
rotation occurred.

<a id="codex-data-table-integration-2026-10-04"></a>
## Codex: Generated DataTable integration and navigation focus (2026-10-04)

Author: **Codex**. RT-23 remains open for the remaining UI catalog audit.

Generated Node and local workerd apps now compose DataTable with `server$`,
`defineUrlState` and client-only selection. Each fixture type-checks and builds
through public package entries, then runs in Chromium against its production
runtime and a local HTTP data backend. These fixtures use workspace package
links, not an installed-tarball distribution or live Cloudflare deployment.

Acceptance covers copied-page SSR, matching hydration without extra backend
reads/RPC, keyboard selection, paging, browser history, filtering, sorting,
page-size changes, empty results and resource refresh failure/retry. Off-page
selected IDs survive those operations. The test waits for committed URL/results
before refresh so an already-visible row cannot conceal an unfinished navigation.
A failed route transition is distinct from an existing resource refresh failure.

The focus checks exposed lost focus when query navigation replaces the page.
Same-owner publication now restores a unique-ID control with matching tag, type
and name, preserving text selection only for an unchanged value. Retained nodes,
intentional focus moves, duplicate IDs and ownership changes prevent transfer.
Rollback rendering uses the same guarded restoration. DataTable exposes an
optional unique `id` for filter, page-size, sort and paging control IDs.
Generated browser acceptance checks paging/filter/retry focus. Focus regression
tests cover ambiguous IDs, mismatched controls, changed values and retained or
intentionally moved focus. SSR regression assertions also prevent duplicate
`value` and `checked` attributes in DataTable controls.

Verification:

- Generated DataTable and typed URL-state acceptance: 4 cases passed across Node
  and workerd. Log: `/tmp/cossack-generated-data-table.log`.
- Final framework build: generated DataTable and navigation-ownership acceptance
  passed 4 cases across Node/workerd. Log: `/tmp/cossack-table-integration-final.log`.
  Both DataTable cases also passed after adding an explicit client-ready wait
  before hydration read assertions. Log: `/tmp/cossack-table-hydration-final.log`.
- Focus helper and navigation outcome tests: 56 passed across 2 files.
  Log: `/tmp/cossack-navigation-focus.log`.
- UI suite: 119 tests passed across 10 files.
  Log: `/tmp/cossack-table-integration-ui.log`.
- Standalone Chromium HTTP-data acceptance passed after the SSR attribute fix.
  Log: `/tmp/cossack-table-integration-browser.log`.
- UI/framework builds and root/package type checks are recorded in
  `/tmp/cossack-table-integration-build.log`,
  `/tmp/cossack-table-integration-framework-build.log`,
  `/tmp/cossack-table-integration-root-types.log` and
  `/tmp/cossack-table-integration-package-types.log`.

Next audit native attributes, event types, labels, keyboard behavior and focus
across the rest of the UI catalog. Keep CLI-08/REL-02 and the full runtime/release
matrix open. Status remains 24 complete and 34 open. Versions remain 0.8.3.

<a id="codex-native-controls-2026-10-04"></a>
## Codex: Typed native controls and mapped prop discovery (2026-10-04)

Author: **Codex**. RT-23 and CLI-08 remain open. The
[UI inventory](./ui-contract-audit.md) tracks 65 component source files, including
multi-export files, plus a final blocks/icons pass. Seven component foundations
are reviewed, including the earlier DataTable work; this is not full UI acceptance.

Button, Input, Label, Checkbox, Switch and Form now share explicit native attribute
and DOM event contracts. ARIA names come from string-valued DOM reflection fields;
element-reference reflection properties are not advertised as HTML attributes.
Only data-* retains a patterned scalar-value index signature. Checkbox/Switch
exclude text-only input attributes. Bind/live/ifDefined/preventDefault result types
have declaration-only private brands so plain objects cannot impersonate runtime
directives. This changes type checking without adding runtime fields. Event
currentTarget is the actual native control. Renderer component() preserves declared prop types
instead of adding a string index signature that accepted misspelled props.

Checkbox now consumes its label prop, renders a single checked binding and keeps
children as the fallback label. Switch renders its children and updates the native
checked property when parent state changes after user interaction. Chromium
checks native labels, keyboard toggles, controlled reset, disabled state, constraint
validation, event targets and FormData. Public type tests exercise valid renderer
directives and reject misspelled props/listeners, incompatible event types, string
boolean values and competing checked/type overrides.

The stricter types exposed sample/studio issues. Forms now use boolean loading
flags and matching field IDs. Loading button text uses component()'s third argument.
Studio checkbox/switch change handlers use inferred native events and currentTarget.
The new installed native-controls guide explains prop ownership, event syntax,
labeling, property binding, FormData and Form submission/validation behavior.

Installed-tarball verification exposed an agent catalog bug: synthetic remapped
members have no declaration node and were reported as any. The declaration indexer
now supplies the owning declaration when resolving their types, preserving concrete
generic event targets and boolean attributes. Synthetic source locations remain
null instead of attributing them to an invented source property. Regression tests
cover exported mapped aliases and inherited class props.

Verification:

- 121 UI tests across 10 files passed, including public consumer types and SSR
  label/checked ownership. Log: `/tmp/cossack-native-ui-tests.log`.
- 284 renderer tests across 22 files passed. Log: `/tmp/cossack-native-renderer-tests.log`.
- Chromium native-control acceptance passed. Log: `/tmp/cossack-native-browser.log`.
- 17 declaration-index tests passed. Log: `/tmp/cossack-native-catalog-tests.log`.
- Installed tarball CLI/MCP acceptance passed with typed native props, the new guide,
  six existing executable examples, version/export refresh and Node networking
  disabled during discovery. Log: `/tmp/cossack-native-agent-docs.log`.
- Root and all 11 package type checks passed after fixing sample/Studio consumers.
  Logs: `/tmp/cossack-native-root-types.log`, `/tmp/cossack-native-package-types.log`.

Next fix Checkbox/Switch disabled appearance in a themed browser fixture. Current
browser checks verify native semantics without CSS. Then continue with textarea/select
wrappers, RadioGroup, Slider, composite controls and the remaining catalog. Keep runtime/distribution and
release gates open. Status remains 24 complete and 34 open; versions remain 0.8.3.

<a id="codex-choice-controls-2026-10-04"></a>
## Codex: Themed choice controls and range state (2026-10-04)

Author: **Codex**. RT-23 remains open. Nine component foundations now have focused
contract coverage; the [UI inventory](./ui-contract-audit.md) retains the remaining
component, block/icon and full form/runtime work.

The native-control browser fixture now builds Tailwind with the actual UI base
and theme CSS. It reproduced enabled-looking disabled Checkbox labels: their
`:disabled` utility could never match a label. Checkbox/Switch/RadioGroup wrappers
now match their child input's actual disabled state. Slider styles its own native
`:disabled` state. This covers direct disabled flags, Checkbox/Switch presence
bindings, and inherited disabled fieldsets without duplicating browser state.

RadioGroup and Slider now have closed native prop contracts. RadioGroup separates
root div attributes/events from input form flags and the typed onValueChange
callback. It rejects empty names/duplicate values, keys items by value, and updates
native checked properties. Parent resets after user selection, callback targets
and DOM identity across reordered choices are exercised in Chromium.

The browser fixture also reproduced Slider initialization at 1000 when requesting
1500 with bounds 1000–2000. Assigning value before constraints caused premature
browser clamping. Slider now applies bounds first and uses a live value binding.
It recovers a previously clamped requested value when bounds widen. Browser-native
clamping/step rules remain authoritative. Non-finite values, inverted bounds and
nonpositive steps fail explicitly. The label alias no longer duplicates aria-label.

Verification:

- Themed Chromium acceptance passed: light/dark opacity and cursor styles,
  disabled fieldsets, Switch keyboard focus ring, native labels/validation/FormData,
  radio keyboard selection/reset/reordering/callback targets and range keyboard,
  initialization/clamping/bounds updates. Log: `/tmp/cossack-themed-controls.log`.
- 124 UI tests across 10 files passed, including public prop/event types and SSR
  ownership/validation regressions. Log: `/tmp/cossack-themed-ui-tests.log`.
- Root and all 11 package type checks passed. Logs:
  `/tmp/cossack-themed-root-types.log` and `/tmp/cossack-themed-package-types.log`.
- Installed tarball CLI/MCP acceptance passed with RadioGroup/Slider prop contracts,
  the radio-and-range guide, six existing executable examples, catalog refresh and
  Node networking disabled during discovery. Log: `/tmp/cossack-themed-agent-docs.log`.
- UI build and whitespace checks passed. Build log: `/tmp/cossack-themed-ui-build.log`.

Next audit Textarea, Select/NativeSelect, InputGroup and PasswordInput, including
initial values during SSR/hydration. Continue the remaining inventory afterward.
These checks do not close the full UI contrast/layout/cross-browser or release
matrix. Status remains 24 complete and 34 open. Versions remain 0.8.3.

<a id="codex-select-values-2026-10-04"></a>
## Codex: Dynamic select values (2026-10-04)

RT-23 continuation. Plain and live `.value` bindings could run before dynamic
options existed, leaving a select on the wrong option. Replacing option children
could also discard a live selection. Plain spread properties additionally reset
manual selection on unrelated renders. Seven new regression cases failed before
this correction.

Direct and spread select values now retry after child commits. Pending writes
belong to the current binding and are canceled when replaced, cleared or removed.
Repeated synchronous renders retain the latest pending value. Plain bindings
preserve manual selection when the bound value stays unchanged. `live()` reapplies
the controlled value after option changes. Existing `bind()` writeback remains
covered, including transitions to and from plain/live bindings.

Verification:

- Renderer: 299 tests in 22 files passed, including 15 new select cases.
- UI: 124 tests in 10 files passed.
- Production Chromium native-control fixture passed with direct/spread dynamic
  options, manual selection, live resets, reordered options and canceled writes.
- Renderer production build, root `pnpm tsc --noEmit` and all 11 package checks
  through `pnpm typecheck` passed. The final focused select run also passed.
- Logs: `/tmp/cossack-select-{renderer,ui,browser,build,root-types,package-types,final-focused}.log`.

Next: textarea/select SSR value serialization and the Textarea, Select/NativeSelect,
InputGroup and PasswordInput contracts. This checkpoint does not close RT-23,
CLI-08 or the full runtime/release matrix. Status remains 24 complete and 34 open.
The handoff also consolidates completed history into links, as requested by the user.

<a id="codex-form-ssr-2026-10-04"></a>
## Codex: SSR form controls and focused agent contracts (2026-10-04)

RT-23 and CLI-08 continuation. Textarea, Select and NativeSelect now declare native
attributes and exact event targets. Unsupported `value` attributes are rejected;
use `.value` for text or selection. Studio's select handler now uses the native
change event and `currentTarget`. The component audit records twelve reviewed
foundations. InputGroup and PasswordInput remain next.

SSR uses parse5 source locations to convert property values into escaped textarea
text and selected options without reserializing surrounding markup or hydration
markers. It preserves leading newlines, nested options, decoded text values and
first-match selection. Property values override static defaults. Null/undefined
values serialize as empty text. Plain input/textarea spreads now preserve user
edits when the bound value stays unchanged. Minification preserves whitespace-only
textarea values and text resembling attributes.

The renderer's browser entry keeps SSR parsing out of normal UI bundles. Root
`renderToString` in browsers directs callers to the explicit `/server` entry.
Node, Deno, worker and workerd conditions retain the root serializer. The migration
guide records this browser API change. The browser fixture resolves public package
exports and checks the built module graph, not a hard-coded renderer alias.

Expanded UI declarations exceeded MCP's unchanged 4 MiB response limit. CLI
`--symbol <name>` and MCP `symbol` now select one exact public export before member
expansion. Filtered entries list available names and report whether the name matched.
Unknown names return a diagnostic instead of a fabricated contract. CLI/MCP use
the same service. Full package indexing remains available when it fits the bound.

Limits: unmatched single-select values cannot encode `selectedIndex=-1` in static
HTML with options present. Use a matching option for SSR parity. Multiple selections
use selected option children; a scalar `.value` selects one option. Interpolated
textarea child text remains unsupported; use `.value`. Broader UI, agent guidance
and release gates remain open. Status remains 24 complete and 34 open.

Verification for this checkpoint:

- Renderer: 326 tests in 23 files. UI: 124 tests in 10 files, including published
  declaration checks. Core: 1,442 tests in 85 files.
- CLI declaration/documentation/MCP suites: 38 tests. Final command-contract,
  command-spec and Chromium suites: 114 tests in four files.
- Chromium verifies minified SSR values without JavaScript, the same hydrated
  controls/options, labels, native event targets, keyboard selection, required
  validation, disabled FormData exclusion and subsequent updates. Public package
  resolution selects the browser entry; its built graph excludes parse5 and the
  SSR form serializer. Existing themed choice/range acceptance also passes.
- Generated Node and workerd DataTable acceptance: two cases passed. This verifies
  server rendering and browser navigation under the new renderer export conditions.
- Renderer production build, root `pnpm tsc --noEmit`, and all 11 package checks
  through `pnpm typecheck` passed.
- Real installed-tarball acceptance passed: six existing executable guide examples,
  new UI prop contracts, exact-symbol CLI/MCP parity, metadata refresh and discovery
  with Node networking disabled. An initial oversized UI response exposed the need
  for filtering; the 4 MiB limit was preserved.
- Logs: `/tmp/cossack-form-{ssr-renderer,ui-tests,core,docs-tests,final-cli,generated,agent-docs,ssr-build,root-types,package-types}.log`.

These focused results do not close the complete UI catalog, cross-browser/form
recipe acceptance, CLI-07/CLI-08 guidance/runtime requirements or REL-03.

<a id="codex-input-addons-2026-10-04"></a>
## Codex: InputGroup and PasswordInput contracts (2026-10-04)

RT-23 continuation. InputGroup now declares native input props/events and consumes
prefix/suffix content. Its error border and ring follow the input's `aria-invalid`
state. The native input remains the destination for names, labels, descriptions,
values, classes and listeners.

PasswordInput now declares its native attributes and component-owned value/type/
disabled state. It consumes onChange and label settings instead of serializing them.
Autocomplete overrides render once, and empty placeholders remain empty. The
onChange callback and a supplied native @input listener receive the same event in
that order. preventDefault directives retain their validation settings.

Reveal buttons support localized names and reference the input ID. Disabling the
field also disables its button; inherited fieldsets and the native disabled state
block reveal. Pointer reveal restores field focus/selection after the component
update, without stealing deliberate focus changes. Keyboard reveal retains button
focus for repeated activation. Parent value changes do not receive stale selection
restoration.

The audit exposed missing ARIA reference attributes in shared native types. DOM
Element/Elements reflection properties now map to string ID attributes, including
aria-controls, aria-describedby, aria-labelledby and aria-activedescendant.
Reflection property names, element objects and invalid reference values remain
rejected. This also restores the existing Studio InputGroup combobox contract.

The UI inventory now records fourteen reviewed foundations. Next: InputOTP, then
Combobox, MultiSelect and DatePicker. The broader UI, form-recipe, cross-browser and
release acceptance requirements remain open. Release status stays 24 complete and
34 open. Native guidance, migration notes and the compact handoff are updated.

Verification for this checkpoint:

- UI build and all 126 tests in 11 files passed, including public declaration
  assertions, callback-free SSR attributes and native attribute forwarding.
- Both production Chromium fixtures passed. They cover minified SSR without JS,
  retained hydration, reveal after native edits, pointer selection restoration,
  keyboard focus and focus rings, parent reset, callback composition, native
  FormData, direct/fieldset disabling, localized labels and themed error styles.
- Root `pnpm tsc --noEmit` and all 11 package checks through `pnpm typecheck` passed.
- Installed-tarball CLI/MCP acceptance passed for the new native/ARIA contracts,
  filtered PasswordInput declarations, six existing executable guide examples,
  metadata refresh and discovery with Node networking disabled.
- Logs: `/tmp/cossack-addons-{build,ui,browser,root-types,package-types,agent-docs}.log`.

<a id="codex-input-otp-2026-10-04"></a>
## Codex: Native InputOTP contract (2026-10-04)

InputOTP previously ignored native attributes and parent value changes. Its
completion condition could never pass. Separate digit inputs also lost empty
positions and pasted only at the beginning.

The component now uses one native text field and decorative, aria-hidden slots.
Closed props expose labels, ARIA references, native events and form attributes.
The component owns numeric input mode, digit validation and length (1–32).
Controlled values require parent acceptance. Uncontrolled defaults remain stable.
Changed complete codes invoke onComplete after onChange. Initial values and parent
updates do not trigger callbacks. Completion does not prove server verification.

Selection-aware paste preserves leading zeroes, strips separators and respects
application cancellation. Composition text survives rerenders until composition
ends. Native form reset restores the initial uncontrolled code or current
controlled value. Canceled reset preserves the edit. Reset listeners attach with
the input ref and are removed during component cleanup.

Verification: UI build, 134 UI tests across 12 files, root `pnpm tsc --noEmit` and
all 11 package type checks pass. The production Chromium fixture checks no-JS SSR,
retained hydration, one accessible textbox, typing/deletion, paste, completion,
FormData, validation, parent acceptance/rejection, composition, readonly/fieldset
disabling and canceled/native reset. The real Tailwind theme verifies slot size,
focus ring and pointer caret placement. Public types reject competing native value
controls, invalid callbacks and misspelled attributes.

Installed guidance describes attribute ownership and state behavior. The tarball
verifier checks the InputOTP declaration and exact-symbol CLI/MCP parity.
Installed-tarball acceptance passed with Node networking disabled during discovery.
All six existing packaged examples compiled and executed. Logs for this checkpoint
are `/tmp/cossack-otp-{build,ui,browser,root-types,package-types,agent-docs}.log`.

Fifteen UI foundations are reviewed. RT-23 and CLI-07/CLI-08 remain open.
Next: Combobox, MultiSelect and DatePicker. Combobox currently drops native props,
lacks combobox ARIA semantics and can retain a stale selected label after parent
updates. The broader application/accessibility and release runtime matrix remain.
No release checkbox or package version changed.

<a id="codex-combobox-2026-10-04"></a>
## Codex: Combobox selection and form contract (2026-10-04)

Combobox previously discarded native props, used random popup IDs, lacked
combobox/listbox semantics and retained old selected labels after parent updates.
Its text input did not provide a usable form-value contract.

Combobox now requires a stable page-unique id and exposes closed input attributes
and event types. It owns popup relationships and submits the selected option value
through a hidden input. Search text filters choices without committing arbitrary
values. Controlled selections require parent acceptance; uncontrolled selections
start from defaultValue. Current options determine the displayed label. Missing
or disabled options cannot be committed or submitted as valid selections.

Arrow keys skip disabled choices. Enter commits the active option. Escape, Tab,
blur and native popup dismissal discard search and restore the committed label.
The input keeps focus while aria-activedescendant identifies the active option.
Popup placement follows input size, viewport space, scroll and resize. Disabled
fieldsets close an open popup. Required validation checks selection, and form
reset respects controlled values, initial defaults and canceled reset events.
Native event cancellation takes precedence over internal keyboard handling.

The demo now supplies a stable ID and accessible name. Migration notes and
package-owned guidance explain attribute, focus and selection ownership. The
keyboard design follows the [W3C combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
Full assistive-technology acceptance remains part of the broader UI audit.

Verification: UI build, 141 UI tests across 13 files, root `pnpm tsc --noEmit`
and all 11 package type checks pass. Production Chromium checks no-JS SSR,
retained hydration, fresh rendering, pointer/keyboard focus, theme sizing/rings,
controlled acceptance/rejection, parent resets, option removal, disabled options,
required validation, FormData, native/canceled reset, fieldsets and event vetoes.
The fresh-render check also verifies fieldset changes after client insertion.

The installed-tarball verifier checks Combobox props and exact-symbol CLI/MCP
parity. Installed acceptance passed with Node networking disabled during discovery.
All six existing packaged examples compiled and executed.
Logs: `/tmp/cossack-combobox-{build,ui,browser,root-types,package-types,agent-docs}.log`.

Sixteen UI foundations are reviewed. Next: MultiSelect, then DatePicker.
RT-23 and CLI-07/CLI-08 remain open. No release checkbox or package version changed.

<a id="codex-multiselect-2026-10-04"></a>
## Codex: MultiSelect tags, validation and form values (2026-10-04)

MultiSelect previously ignored native props, used random popup IDs and had no
native submission or disabled contract. Validation failures were silent, and
predefined additions bypassed validation. Popup options and removal buttons lacked
complete keyboard/focus ownership.

The component now requires a stable page-unique id and exposes closed native input
props/events. Controlled arrays require parent acceptance; defaultValue supplies
uncontrolled initial tags. Callbacks receive fresh arrays. Repeated hidden inputs
submit selected values through name/form, including external form associations.
Required validation depends on tags rather than search text. Disabled fieldsets
block all edits and omit submitted values; readonly preserves submitted values.

Both predefined and custom additions run validate. Errors are escaped, visible
through role=alert, linked through aria-describedby and used for native validity.
Parent error messages persist until cleared; clearing a parent message does not
leave a copied internal error. Max limits block additions without truncating
existing parent values. Creation/removal labels and constraint messages are
localizable. Parent arrays and options require unique nonempty strings.

Arrow keys navigate suggestions while the input retains focus. Composition Enter
cannot add a tag. Escape/Tab dismiss search. Empty-query Backspace removes the last
tag; keyboard chip removal moves focus to another removal button or the input.
Pointer removal returns input focus, with guards against stale asynchronous focus.
Native event cancellation takes precedence over internal actions. Native and
canceled reset restore or preserve the appropriate controlled/default selection.

Verification: UI build, 154 UI tests across 14 files, root `pnpm tsc --noEmit` and
all 11 package type checks pass. Production Chromium checks no-JS SSR, retained
hydration, fresh rendering, keyboard/pointer and chip focus, validation of known
and custom values, required/max constraints, repeated FormData, controlled
acceptance/rejection, composition, parent errors, native/canceled/external form
reset, readonly/disabled fieldsets and event vetoes. The fixture builds the real
Tailwind/UI theme and checks the focused field's visible ring.

Installed guidance and the tarball verifier now include MultiSelect props,
validation signatures and exact-symbol CLI/MCP parity. Installed acceptance passed
with Node networking disabled during discovery. All six packaged examples compiled
and executed.
Logs: `/tmp/cossack-multiselect-{build,ui,browser,root-types,package-types,agent-docs}.log`.

Seventeen foundations are reviewed. DatePicker is next, together with its duplicated
Calendar behavior. DatePicker currently ignores min/max and native props, retains
inner selection over parent updates and lacks complete calendar keyboard/focus
semantics. RT-23 and CLI-07/CLI-08 stay open. The full application, assistive-technology
and published-runtime matrix remain separate acceptance requirements.
No release checkbox or package version changed.

<a id="codex-date-controls-2026-10-04"></a>
## Codex: Calendar and native DatePicker (2026-10-04)

DatePicker ignored min/max and native attributes, retained its own selection over
parent updates and duplicated a calendar without keyboard semantics. Calendar
initialized its selected month only after mount and allowed invalid dates to roll
into other months. Local Date constructors also mapped early years incorrectly.

The controls now share strict Gregorian date-only helpers for years 0001–9999,
UTC arithmetic, real-date/range validation and month-end clamping. The public
isCalendarDate guard checks external data without throwing. Calendar renders the
selected month before JavaScript, supplies a labeled grid/live heading, and keeps
one day in the tab sequence. Arrows, Home/End and month/year paging stay within
bounds. Rapid key actions use the latest cursor state. Focus is preserved when
month updates replace or move the old button, including parent value changes.

Calendar supports controlled/default values, localized Gregorian labels and a
configurable week start. onChange reports changed proposals; onSelect reports
every valid pick. DatePicker composes this Calendar with a native date input and
a nonmodal popup. Name/form, required/min/max, reset, readonly and disabled
fieldsets use native semantics. Selection/Escape restore trigger focus; Tab can
leave the popup. Native date entry and clearing use the same change contract.

Studio consumers now provide stable IDs and associated labels. Invalid stored
text and timestamp-like values remain editable without truncation or rollover.
The insert form encodes field IDs so names containing spaces still have usable
label associations. Migration notes cover the removed DatePicker placeholder,
input ownership, strict values, UTC reference day and localization.

Verification: UI build, 177 UI tests across 15 files, five Studio editor regressions,
root `pnpm tsc --noEmit` and all 11 package type checks pass. The production Chromium
fixture checks no-JS SSR, retained hydration, fresh rendering, leap/month/year
navigation, bounds, parent changes, controlled rejection/acceptance, repeated keys
before rendering, native validation/FormData/reset, same-date popup closure,
Escape/Tab focus and disabled fieldsets. The browser uses America/Los_Angeles;
unit rendering/arithmetic also runs under UTC and Pacific/Kiritimati settings.
Tests verify years below 100 rather than relying on Date's local constructor.

The grid keyboard behavior follows the [W3C date-picker example](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/).
Cossack's custom popup is explicitly nonmodal; it does not claim the example's
modal focus trap. Full assistive-technology and published-runtime acceptance
remain broader release requirements.

Installed guidance/catalog acceptance now checks both component contracts,
isCalendarDate and exact-symbol DatePicker CLI/MCP parity. Installed acceptance
passed with Node networking disabled during discovery. All six existing packaged
examples compiled and executed.
Logs: `/tmp/cossack-dates-{build,ui,studio,browser,root-types,package-types,agent-docs}.log`.

Nineteen foundations are reviewed. Continue Modal, Sheet, Drawer and Popover,
including native events, controlled closing, labeling and focus restoration.
RT-23 and CLI-07/CLI-08 remain open. No release checkbox or version changed.

<a id="codex-dialog-controls-2026-10-04"></a>
### Codex: native Modal, Sheet and Drawer contracts (2026-10-04)

The three controls now share typed dialog attributes, native events and lifecycle
handling. Controlled dismissal reopens unless the parent accepts it. Uncontrolled
`defaultOpen` applies once. Prop-driven closing does not call the dismissal callback.
Native `@close` still observes those close events. Escape vetoes, pointer-origin
backdrop dismissal, native dialog forms and cleanup retain browser behavior.
SSR stays closed and opens through `showModal` after client connection.

The browser regression found Drawer had a zero-size native container around its
fixed panel. Its theme now supplies a full-viewport container. Drawer forwards
native attributes to the dialog, applies vertical size and provides a localizable
close control on all sides. Studio, scaffold navigation and CommandPalette now
supply accessible dialog names. Migration notes describe changed callback and
attribute ownership. Package guidance exposes the same contract to agents.

Verification: UI build, 183 UI tests across 16 files, five Studio editor regressions,
root `pnpm tsc --noEmit` and all 11 package type checks pass. Public declarations
reject competing native state, role overrides, unknown props and incorrect event
targets. The themed Chromium fixture covers no-JS SSR, retained hydration, fresh
mounts, autofocus, background inertness, controlled acceptance/rejection, Escape
vetoes, backdrop and panel clicks, native form validation/return values, nested
dialogs, focus restoration, rapid close/reopen and cleanup.

Installed-tarball acceptance passes for all three dialog contracts and the new
guide, with exact-symbol Modal parity between CLI and MCP. Discovery passes with
Node networking disabled. The six existing packaged examples compile and execute.
The UI guide itself does not add an executable example.

Native focus behavior follows the [HTML focus specification](https://html.spec.whatwg.org/multipage/interaction.html#sequential-focus-navigation):
background content is inert, but keyboard navigation can reach browser chrome.
Chromium coverage does not prove other browser engines or assistive-technology acceptance.
Logs: `/tmp/cossack-dialog-{build,ui,studio,browser,root-types,types,agent-docs}.log`.

Twenty-two foundations are reviewed. Continue Popover and remaining UI audit rows.
RT-23, CLI-07/CLI-08 and the broader release matrix remain open. The checklist stays
at 24 of 58 completed tasks. Package versions remain 0.8.3 until REL-04.

<a id="codex-popover-2026-10-04"></a>
### Codex: native Popover contract (2026-10-04)

Popover now requires a stable ID and exposes typed native trigger attributes.
`contentProps` supplies typed panel attributes and events. Native targeting,
expansion, light dismissal and focus remain browser-owned. Supplied callbacks and
preventDefault directives retain their real event targets and veto behavior.
The public show/hide/toggle methods respect disconnected and disabled triggers.
Inherited disabled fieldsets close existing content.

Positioning now follows nested scrolling, trigger/content size changes and the
visual viewport. It flips toward available space, clamps oversized panels and
uses RTL alignment. Cleanup releases listeners/observers and closes the panel.
The demo supplies an explicit ID. Migration notes cover IDs, attribute ownership,
placement classes and positioning styles. Package guidance states naming, role
selection and keyboard responsibilities without implying menu behavior.

Verification: UI build, 189 tests across 17 UI files, root `pnpm tsc --noEmit` and
all 11 package type checks pass. The themed Chromium fixture covers no-JS native
activation, deterministic retained hydration, fresh mounts, keyboard focus,
Escape/light dismissal, real native event targets, click/beforetoggle vetoes,
preventDefault directives, fieldset disabling, content growth, nested scrolling,
RTL alignment, viewport resizing, oversized content and cleanup. Chromium's
native accessibility tree verifies implicit expanded state; Playwright's simplified
snapshot omits this browser-derived property. Source and browser behavior align
with the [HTML popover specification](https://html.spec.whatwg.org/multipage/popover.html).
Other browser engines and assistive-technology acceptance remain unverified.

Installed-tarball acceptance passes for the Popover contract and new guide, with
exact-symbol CLI/MCP parity and discovery with Node networking disabled. All six
existing packaged examples compile and execute. The new UI guide does not add
an executable example.

Logs: `/tmp/cossack-popover-{build,ui,browser,root-types,types,agent-docs}.log`.
Twenty-three foundations are reviewed. Continue DropdownMenu and ContextMenu,
then the remaining pending UI rows. RT-23 and CLI-07/CLI-08 remain open. No release
checkbox or package version changed.

<a id="codex-action-menus-2026-10-04"></a>
### Codex: DropdownMenu and ContextMenu contracts (2026-10-04)

Both menus now require stable IDs and expose closed native attribute/event types.
MenuPanelProps names the panel contract; MenuItem separates labeled actions from
separators. Disabled actions remain focusable but cannot activate. Custom dropdown
buttons/links declare their roles explicitly. The dashboard template and demo
consumers now provide IDs and menu-item semantics. ContextMenu requires a menu name.

A shared controller handles arrow/Home/End navigation, prefix search, Tab exits,
Escape, focus restoration and bounded positioning. It preserves focus when an
action opens a dialog and recovers when the focused item disappears. Setup waits
until refs join the live document, avoiding temporary-document focus/listener
ownership. Cleanup cancels deferred setup and removes listeners and observers.

DropdownMenu uses native auto dismissal. ContextMenu retains manual popover mode:
the opening right-click otherwise immediately dismissed an auto popover in Chromium.
Scoped handlers provide outside-click/Escape dismissal. External scrolling closes
context menus while internal scrolling remains usable. Public imperative methods
remain safe before connection and after removal.

Verification: UI build, 193 UI tests across 18 files, root `pnpm tsc --noEmit` and
all 11 package type checks pass. The themed Chromium fixture covers retained SSR
hydration, fresh mounts, first/last opening, disabled generated/custom actions,
wrapping/typeahead/Home/End, callback/default-event vetoes, Tab/Shift+Tab exits,
context keyboard/pointer invocation, native fieldsets, outside focus, removed-item
recovery, dialog-opening actions, all four placement sides, oversized panels,
internal/external scrolling and cleanup before deferred connection.

Installed-tarball acceptance passes for both contracts and the new guide, including
exact-symbol DropdownMenu CLI/MCP parity with Node networking disabled during
discovery. All six existing packaged examples compile and execute. The new UI guide
does not add an executable example. Migration notes describe IDs, callback types,
separator changes, custom item roles and style ownership.

The keyboard contract follows the [W3C menu-button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)
and [menu pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/).
These controls implement single-level actions. Submenus, menu checkbox/radio widgets,
other browser engines and assistive-technology acceptance are not claimed here.

All 78 scaffold recipe tests also pass after updating the dashboard menu template.

Logs: `/tmp/cossack-menu-{build,ui,browser,root-types,types,agent-docs,scaffold}.log`.
Twenty-five foundations are reviewed. Continue Tooltip and HoverCard, then pending
UI audit rows. RT-23 and CLI-07/CLI-08 remain open. The release still has 24 of 58
completed tasks. Package versions remain 0.8.3 until REL-04.

<a id="codex-generated-trace-acceptance-2026-10-04"></a>
### Codex generated development-trace acceptance (2026-10-04)

Author: Codex. A generated Cloudflare app now exercises real Chromium component
stream, service and failure buttons through capture, server dispatch/terminal
evidence, Vite persistence, the CLI process and an MCP SDK stdio client. Shared
records match; values, action names and raw errors stay excluded. The fixture
checks generated TypeScript and production client/Worker bundles, and shuts down
the development server through its awaited close operation.

This exposed and fixed two gaps. Worker-rendered HTML bypassed the HTML-transform
bridge injection; the client route registry now loads the same canonical virtual
module, without duplicating the HTML publisher. Core render source markers relied
on absent metadata rather than an explicit development guard; the guard now
removes marker handling from production bundles while preserving development markers.

Verification:

- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'shares a generated development browser RPC trace'`:
  **1 passes, 33 unrelated tests skipped**. Generated types, live development
  browser/server/CLI/MCP parity and production client/Worker exclusion pass.
  Log: `/tmp/cossack-generated-trace-final-verified.log`.
- `pnpm --filter @cossackframework/framework exec vitest run tests/devtools-browser.test.ts tests/development-trace-bridge.test.ts tests/development-traces.test.ts tests/navigation-trace-build.test.ts`:
  **18 tests / 4 files pass**, including custom-base HTML plus registry bootstrap
  without duplicate publications and existing capture/storage lifecycle checks.
  Log: `/tmp/cossack-generated-trace-framework.log`.
- `pnpm --filter @cossackframework/core exec vitest run tests/development-trace-build.test.ts`:
  **3 tests pass** for production component/service proxy and renderer exclusion.
  Log: `/tmp/cossack-generated-trace-core-build-tests.log`.
- Core/framework declaration builds, root `pnpm tsc --noEmit` and
  `pnpm typecheck` pass (all 11 packages).
  Logs: `/tmp/cossack-generated-trace-final-build.log`, `/tmp/cossack-generated-trace-types-final.log`.

Limits: this fixture uses workspace package links. Installed-tarball trace
acceptance remains before the CLI-07 audit. RT-28 retains WebSocket/native-body
server evidence and other runtime development acceptance. No task closes:
**25 complete, 33 open**. No deployment or publication occurred.

<a id="codex-cli07-complete-2026-10-04"></a>
### Codex: installed trace acceptance and CLI-07 completion (2026-10-04)

Author: Codex. **CLI-07 is complete** against its original tool, parity and
lifecycle criteria. The release now has **26 complete and 32 open tasks**.
RT-28 transport enrichment and CLI-08 documentation coverage remain open.

The shared browser acceptance fixture now runs against workspace links and actual
installed tarballs. The application, Vite, CLI and MCP server resolve from the
installation; only the browser driver and MCP test client come from the repository.
Real component-stream, service and failure buttons produce the same bounded record
through the browser, stored file, CLI and MCP. CLI/MCP reads run with Node networking
disabled. The fixture restores its source/configuration files and verifies generated
TypeScript, graceful server shutdown and production client/Worker exclusion.

Installed acceptance found a bug hidden by workspace links: the bridge imported
the inspector by filesystem path while the app used Vite's optimized public import.
That created duplicate toolbars and separate capture owners. The virtual module now
resolves the public inspector and supplies that instance to the bridge. The bridge
has no runtime import of a second inspector or core capture module.

Completion audit:

| Original requirement | Evidence |
| --- | --- |
| Inspection, docs, diagnostics, test results and traces share services | All four MCP tools dispatch through the shared readers/inspection service. CLI commands use those services directly; no human-output parsing. |
| Tool and CLI answers match for one fixture | SDK tests compare route facts/checks and recorded evidence. The installed fixture compares documentation, reporter records and real browser traces with the installed CLI/MCP entrypoints. |
| Typed inputs, versioned output and accurate annotations | Strict schemas, schema version 1 and read-only/non-destructive/idempotent/local annotations are present on every tool; SDK negotiation and output validation pass. |
| Invalid paths and unknown operations fail predictably | SDK tests reject unknown tools/fields, route traversal, package paths and record IDs; startup binds one real project root. |
| Secrets are redacted and installed versions identified | Configured-secret tests pass; recorded actions exclude values, names and raw errors. Installed versions match manifests and refresh after metadata changes. |
| Startup, shutdown and interrupted calls release resources | Existing deadline/concurrency/output-limit tests pass. New stdio tests block four real compiler workers at a controlled file read, then observe each native worker exit after SDK cancellation, stdin EOF or SIGTERM. Cancellation frees all four slots for subsequent calls; EOF exits without signal escalation. |

Verification:

- `pnpm --filter cossack exec vitest run tests/mcp.test.js`: **18 tests pass**,
  including the three busy-server interruption cases. Log: `/tmp/cossack-installed-trace-mcp.log`.
- `pnpm --filter @cossackframework/framework exec vitest run tests/devtools-browser.test.ts tests/development-trace-bridge.test.ts tests/development-traces.test.ts tests/navigation-trace-build.test.ts`:
  **18 tests / 4 files pass**. Log: `/tmp/cossack-installed-trace-framework.log`.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'shares a generated development browser RPC trace'`:
  **1 passes, 33 unrelated tests skipped**. Log: `/tmp/cossack-installed-trace-workspace.log`.
- `COSSACK_KEEP_SMOKE=1 node scripts/test-local-scaffold.mjs --agent-docs-only`:
  sequential package builds, 12 tarballs, installed examples/catalog/reporter/trace
  acceptance and production exclusion pass. Log: `/tmp/cossack-installed-trace-tarballs.log`.
  Installed runtime tools: Vite **8.3.2**, Cloudflare Vite plugin **1.62.5**,
  Wrangler **4.147.0**, TypeScript **7.0.2**, Vitest **4.1.11**.
- Root `pnpm tsc --noEmit` and `pnpm typecheck` pass for all **11 packages**.
  Log: `/tmp/cossack-installed-trace-types.log`.

Limits: reads expose local, editable evidence with provenance and receipt age;
they do not prove live state or remote readiness. RT-28 still needs WebSocket
server dispatch, native-body terminal evidence and other runtime development
acceptance. CLI-08 retains broader authored guidance; REL-02/REL-03 retain their
full package/runtime gates. Versions remain 0.8.3. No deployment or publication occurred.

<a id="codex-rt11-websocket-auth-2026-10-05"></a>
### Codex RT-11 WebSocket freshness (2026-10-05)

**Behavior completed:** WebSocket actions and all outbound state, event and
client-action frames revalidate identity, inherited guards, owner and computed
scope immediately before dispatch or delivery. Cloudflare peers carry bounded,
credential-free request/identity descriptors through Durable Object
hibernation. Fresh middleware executes within the new request/config/locale/ORM
scope. Stale peers receive a terminal authorization frame and close; client
reconnect stops. Node and Deno peers use per-connection serialized delivery
queues with bounded pending work. Ordinary response headers set by rechecked
middleware are discarded on the synthetic context; `Set-Cookie` mutation remains
a closed failure because it would change credentials after the live response.

The generated Cloudflare auth fixture stores a one-way session fingerprint in
its descriptor. It does not serialize a bearer session ID. `reports.md` and
`.zcodeignore` were pre-existing user files and were not included in this work.

**Verification:**

- Core runtime tests: 3 files, **28 tests pass** (`do-runtime-robustness`,
  `in-memory-websocket-runtime`, `realtime-recovery`).
- Framework tests: 4 files, **32 tests pass** (`realtime-context`,
  `runtime-websocket-scopes`, `transport-security`, `durable-object-auth`).
- Concurrent session/flash scope tests: 2 files, **19 tests pass**. Barrier
  fixtures overlap two requests in one isolate and verify request values and
  signed output cookies stay separate.
- Node adapter guarded WebSocket test: **6 tests pass**.
- Deno adapter WebSocket lifecycle test: **13 tests pass**.
- Cloudflare WebSocket peer integration test: **1 test passes**, including a
  forced Durable Object reconstruction with active sockets.
- Generated Cloudflare deployment/auth/browser acceptance: **1 test passes**.
- `pnpm typecheck` passes all 11 package type checks; `pnpm tsc --noEmit` passes.

The test commands were run with the checked-in Vitest 4.1.11 and Wrangler
4.114.0. The generated deployment test takes about 146 seconds in isolation.
An earlier full `pnpm test:unit` run failed with load-sensitive 5-second CLI
timeouts and unrelated Deno runner skips/errors; that suite was not rerun here.

**Limits:** RT-11 remains open for broader concurrent request semantics. A
checked in-flight action or frame may finish after revocation; storage latency
and queue backpressure prevent a strict wall-clock revocation guarantee. Idle
sockets are rechecked on the next action or outbound frame. Desktop is complete
for this release by user decision; waived OS-specific checks are not claimed as
passed. Overlapping flash requests stay isolated, but a copied valid signed
cookie can be replayed until expiry; these tests do not claim durable one-use
semantics. Task count remains **28 complete / 30 open** and package versions
remain 0.8.3. No deployment, publishing or push occurred.

<a id="codex-rt11-session-concurrency-2026-10-05"></a>
### Codex RT-11 database session concurrency (2026-10-05)

**Issue reproduced:** database session `set()` and `unset()` used to load and
replace the entire serialized bag. Two requests writing different keys could
interleave after their reads, causing the last full-bag write to silently drop
the other request's value.

**Fix:** each operation now emits one SQLite `json_set`/`json_remove`, PostgreSQL
`jsonb_set`/key deletion, or MySQL `JSON_SET`/`JSON_REMOVE` statement. Distinct
keys are preserved by the database update; TTL refresh remains limited to `set`,
and both operations still update only an existing, live session. SQLite resets
malformed/non-object JSON, and MySQL validates stored text before casting it;
null, empty and valid non-object values are normalized to an empty object.
Malformed non-empty PostgreSQL text remains a storage-corruption error because
PostgreSQL's JSON cast rejects it. Undefined values remove their key, matching
JSON bag semantics. The session API and docs state
that custom stores must mutate one key without replacing concurrent unrelated
updates. Same-key writes remain last-writer-wins.

**Verification:**

- Before the fix, a deterministic SQLite driver barrier let two `set()` calls
  read the same bag; the resulting row lost one of the keys.
- `pnpm --filter @cossackframework/database exec vitest run test/cossack.test.ts`:
  **11 tests pass**, including the concurrency regression, unusual JSON key and
  dialect query-shape checks.
- `pnpm --filter @cossackframework/database exec vitest run`: **15 files / 92
  tests pass**.
- Root `pnpm typecheck` passes all **11 package checks** and `pnpm tsc --noEmit`
  passes.

**Limits:** RT-11 remains open. This prevents distinct-key lost updates in the
built-in database store; it does not make signed flash durable or one-use,
enforce stronger same-key ordering than the database, or resolve in-flight
request/revocation and transport backpressure limits. Desktop remains complete
by user decision, with its waived OS acceptance not represented as passed.

<a id="codex-cli08-database-guidance-2026-10-05"></a>
### Codex: Installed database guidance and cold-start acceptance (2026-10-05)

`@cossackframework/database` now packages `agent-docs.json` with guides for
parameterized Node SQLite and Cloudflare D1 usage. They document runtime-specific
package entries, bound SQL values, `sql.id` for identifiers, the restricted role
of `unsafe`, migration practice and the difference between sequential atomic
D1 `batch()` operations and general interactive transactions. The Node example
creates an in-memory SQLite database from the installed `/node` export and
proves a hostile SQL-looking value stays bound. The D1 example imports the
installed `/cloudflare` adapter and runs a parameterized query against a binding
contract fixture; this checks the adapter path but is not a Miniflare or live D1
runtime test. The package-guidance reader test proves authored docs are accepted
only when every referenced package entry is exported, without importing modules.

The first clean generated Cloudflare run exposed stale Vite optimized SSR chunks:
trace fixtures rewrite transport/page graphs, while API handlers and page
inspectors are discovered after Vite's initial scan. The scaffold template now
pre-bundles `@cossackframework/framework/api` and
`@cossackframework/framework/client/devtools`; trace and packaged-page fixtures
clear `node_modules/.vite` before starting a new generated graph.

**Verification:**

- `COSSACK_KEEP_SMOKE=1 PATH=/home/tan/.local/share/pnpm/bin:/home/tan/.nvm/versions/node/v24.19.0/bin:$PATH pnpm test:agent-docs:local`:
  passes fresh package builds/installation, database build tests (**15 files /
  92 tests**), twelve standalone examples including the D1 binding assertion,
  four auth examples, four generated
  action/resource/task/public-form pages, offline CLI/MCP parity, Cloudflare
  HTTP/SSE/WebSocket traces, installed UI contracts and production JavaScript /
  source-map stripping. Desktop is deliberately excluded from this focused
  docs gate, consistent with the user's release decision.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`:
  **13 tests pass**.
- `pnpm tsc --noEmit`: passes.
- `git diff --check -- . ':!reports.md'`: passes.

**Limits:** This adds one Node database example; it does not establish D1 ORM
runtime behavior or cover every library, UI component or recipe. CLI-08 remains
open for broader guidance and runtime coverage. REL-02/REL-03 retain their full
acceptance criteria. No Desktop platform check is claimed as passed; no publish
or deployment occurred. Release status remains **28 complete / 30 open**.

<a id="codex-rt11-flash-expiry-2026-10-05"></a>
### Codex RT-11 server-enforced flash expiry (2026-10-05)

The signed flash cookie now contains an envelope with the outgoing data, a
format marker and exact expiry timestamp. The middleware validates the expiry only after
signature verification and clears invalid, expired or legacy raw-data payloads.
The default expiry matches the cookie's 30-second `Max-Age`. Configured `maxAge`
must be a positive whole number of seconds. This closes the gap where a copied
token could be replayed after the browser would have discarded it. A valid
copied token remains replayable before its signed expiry because the framework
does not yet have a durable atomic replay store.

The generated public-form page and independent Node/Cloudflare old-input fixtures
now read the envelope's `data` field, assert the signed expiry, and continue to
verify cookie clearing, selected field restoration and credential exclusion.
Tests also reject a legacy signed raw-data token and simulate a copied token
after the exact expiry without sleeping.

**Verification:**

- `pnpm --filter @cossackframework/framework exec vitest run`: **79 files / 1,544 tests pass**.
- `pnpm --filter @cossackframework/core exec vitest run tests/flash.test.ts tests/crypto.test.ts`:
  **2 files / 39 tests pass**.
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'excludes private old input'`:
  **2 generated cases pass** (Node and Cloudflare; 62 unrelated cases skipped).
- `COSSACK_KEEP_SMOKE=1 PATH=/home/tan/.local/share/pnpm/bin:/home/tan/.nvm/versions/node/v24.19.0/bin:$PATH pnpm test:agent-docs:local`:
  passes fresh builds/installation, twelve standalone examples, four auth
  examples, four generated Cloudflare pages, Cloudflare HTTP/SSE/WebSocket
  traces, CLI/MCP parity, UI contracts and production source-map stripping.
- `pnpm tsc --noEmit` and `pnpm typecheck`: pass.
- `git diff --check -- . ':!reports.md'`: pass.

**Limits:** RT-11 remains open for durable one-use flash consumption and other
concurrency guarantees. Replaying a copied cookie during its configured expiry
still repeats its data. Already-started actions/frames can finish after session
revocation; response delivery and application storage effects are not rolled
back. Desktop remains complete by user decision; waived platform checks are not
claimed as passed. No deployment or publication occurred.

<a id="codex-cli08-ui-example-2026-10-05"></a>
### Codex: Installed UI example and SSR acceptance (2026-10-05)

The UI package's `native-controls` guide now includes an executable accessible
profile form using `Button`, `Input` and `Label`. Its source is retrieved from
the installed CLI catalog, typechecked against installed package declarations,
then bundled and executed under Node. Bundling matches the app's Vite handling
of the UI barrel's Solar icon TypeScript source. Rendered output checks the
label/control relationship, email/name/required attributes, linked help and
submit button. This example covers server rendering only; it does not establish
browser interaction or assistive-technology behavior.

The isolated example compiler uses the root workspace's `skipLibCheck` policy.
The UI declarations transitively include core Cloudflare APIs whose ambient
Worker types belong to generated Worker projects; the examples themselves use
only renderer and UI APIs.

**Verification:**

- `COSSACK_KEEP_SMOKE=1 PATH=/home/tan/.local/share/pnpm/bin:/home/tan/.nvm/versions/node/v24.19.0/bin:$PATH pnpm test:agent-docs:local`:
  fresh package builds and installation pass; **13 standalone examples**, four
  auth examples, four generated application pages, HTTP/SSE/WebSocket browser
  traces, offline CLI/MCP parity, UI declaration contracts and production
  source-map stripping pass. Database package tests pass **15 files / 92 tests**.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`:
  **1 file / 13 tests pass**.
- `pnpm tsc --noEmit` passes.
- `git diff --check -- . ':!reports.md'` passes.

CLI-08 remains open for broader API/component/recipe examples and real Worker
runtime coverage, including D1. Desktop is complete by user decision; the
focused docs gate excludes Desktop, and waived platform checks are not claimed
as passed. REL-02/REL-03 keep their existing acceptance criteria. Release status
remains **28 complete / 30 open**. No deployment or publication occurred.

<a id="codex-cli08-ui-guides-2026-10-05"></a>
### Codex: Expanded installed UI guide examples (2026-10-05)

Four of 39 UI guides have installed, executable examples: `native-controls`,
`server-data-table`, `native-dashboard-stat` and `native-settings-panel`. They
demonstrate an accessible native form; typed, server-owned table state with
stable row identity and selection; zero-safe metrics with separately localized
direction and meaning; and controlled settings within a native form owned by
the application. The examples assert meaningful SSR markup and avoid invoking
client callbacks while rendering.

The installed documentation verifier now selects all four examples from the
catalog returned by the installed CLI. It typechecks them with the installed
TypeScript compiler and declaration files, bundles UI examples for Node, and
executes the bundles. Bundling is required because the UI package's Solar icon
barrel includes TypeScript source, as it does in Vite applications. The isolated
compiler uses `skipLibCheck` to match the root config: transitively imported
Cloudflare declarations use ambient Worker globals that are generated only in a
Worker project. The examples themselves use renderer and UI APIs only.

| Command | Result |
| --- | --- |
| `COSSACK_KEEP_SMOKE=1 PATH=/home/tan/.local/share/pnpm/bin:/home/tan/.nvm/versions/node/v24.19.0/bin:$PATH pnpm test:agent-docs:local` | Fresh package builds/install pass; 16 standalone examples and four auth examples compile and execute from installed tarballs. Four generated application pages, Cloudflare HTTP/SSE/WebSocket browser traces, offline CLI/MCP parity, UI prop/index contracts and source-map-enabled production stripping pass. Database suite: 15 files / 92 tests. Retained logs: `/tmp/cossack-local-pack-DKi3wm`. |
| Focused installed-example check (strict `tsc`, esbuild bundles, Node execution) | All three added UI examples pass against the fresh installed package set. |
| `pnpm --filter cossack exec vitest run tests/package-guidance.test.js` | 1 file / 13 tests pass. |
| `pnpm tsc --noEmit`; `git diff --check -- . ':!reports.md'` | Both pass. |

Limits: the UI examples verify SSR only; they do not establish browser interaction,
other engines or assistive-technology support. Thirty-five UI guides remain without
examples. CLI-08 and REL-02/REL-03 stay open. The D1 guide uses an installed
binding-contract fixture, not Miniflare/workerd or a deployed database. Desktop
remains complete by user decision, with waived platform checks not claimed as
passing. Release status remains 28 complete / 30 open. No deployment or
publication occurred.

<a id="codex-rt11-cloudflare-flash-claims-2026-10-05"></a>
### Codex: Cloudflare one-use flash claims (2026-10-05)

Cloudflare flash cookies now carry a signed random UUID nonce in addition to the
signed expiry. A page request claims that nonce through a `COSSACK_SSE` Durable
Object named `cossack.flash.v1:<nonce>`. The DO verifies that its name matches
the nonce, schedules expiry cleanup, and uses a unique SQLite insert with
`RETURNING` to make the first read the only winner. Its alarm removes expired
claims. Each token has a separate object name, so flash reads do not serialize
unrelated SSE scopes. Background RPC/upload/realtime requests preserve the
cookie without claiming it. Cloudflare without the binding returns a fixed 503
on valid page reads and fails flash writes with a setup error. Node/Deno remain
stateless and copied tokens can be read until their signed expiry.

Middleware tests cover background preservation, simultaneous reads with one
winner, replay rejection, missing binding and coordinator failure. A native
two-Worker workerd fixture verifies the unique claim across Workers, replay
rejection, malformed nonce and expired claim rejection.

**Verification:**

- `pnpm --filter @cossackframework/framework exec vitest run tests/flash-middleware.test.ts tests/sse-coordinator-transport.test.ts`:
  **2 files / 39 tests pass**.
- `pnpm --filter cossack exec vitest run tests/sse-coordinator-integration.test.js -t 'atomically consumes signed flash nonces'`:
  **1 test passes** (two unrelated tests skipped).
- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'excludes private old input'`:
  **2 generated Node/Cloudflare cases pass**, including cookie decode, browser
  clearing and subsequent SSR old-input behavior.
- `COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local`: fresh installed-package
  acceptance passes **16 standalone examples**, four auth examples, four
  generated pages, Cloudflare HTTP/SSE/WebSocket traces, offline CLI/MCP parity,
  UI contracts, source-map-enabled production stripping and the database suite
  (**15 files / 92 tests**). Desktop is excluded from this focused gate.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`:
  **13 tests pass**.
- `pnpm build` and `pnpm tsc --noEmit` pass.
- `git diff --check -- . ':!reports.md'` passes.

**Limits:** RT-11 remains open for process-runtime replay prevention and broader
concurrent request semantics. In a full run of the existing coordinator test
file, its unchanged native RPC stream case failed with
`COSSACK_RPC_STREAM_TRUNCATED`. The same failure reproduced once while the DO
source was temporarily restored to `HEAD`; the separate new claim test passes.
Treat the coordinator stream failure as a current baseline issue, not as a green
full-file result, and investigate it before claiming that broader suite passes.
Desktop remains complete by user decision; no Desktop platform checks are
claimed. No deployment or publication occurred.

<a id="codex-cli08-ui-coverage-2026-10-05"></a>
### Codex: Four more executable UI guides (2026-10-05)

The installed UI catalog now has executable SSR examples for eight guides:
native controls, one-time codes, breadcrumbs, pagination, status/progress,
server DataTable, dashboard metrics and settings. The four new examples verify
that OTP normalization keeps leading zeroes and emits six decorative slots;
breadcrumbs expose named native links and mark the final link current;
pagination renders accessible native URLs for previous/current/next; and a
polite status alert can accompany named determinate progress at zero. They make
no claim about browser interaction or assistive-technology output.

The verifier reads all eight examples from the installed CLI catalog, compiles
them against installed declarations, bundles UI output for Node, then executes
the examples. Their assertions use only the runtime-neutral example environment.

**Verification:**

- `COSSACK_KEEP_SMOKE=1 PATH=/home/tan/.local/share/pnpm/bin:/home/tan/.nvm/versions/node/v24.19.0/bin:$PATH pnpm test:agent-docs:local`: passes fresh package builds and installs, **20 packaged usage examples**, four auth examples, four generated application pages, installed Cloudflare HTTP/SSE/WebSocket traces, offline CLI/MCP parity, UI prop/index contracts and production source-map stripping. D1 bound-value acceptance passes.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`: **1 file / 13 tests pass**.
- `pnpm tsc --noEmit` and `git diff --check -- . ':!reports.md'`: pass.

CLI-08 remains open for broader authored library/component/recipe guidance and
real Worker runtime coverage of the D1 guide. Thirty-one of 39 UI guides remain
without executable examples. Desktop is complete by user decision; waived
platform checks are not claimed as passed. REL-02/REL-03 remain open for
non-Desktop criteria. Release status remains **28 complete / 30 open**. No
deployment or publication occurred.

<a id="codex-cli08-ui-coverage-2-2026-10-05"></a>
### Codex: Four additional executable UI guides (2026-10-05)

Twelve of the 39 installed UI guides now have executable SSR examples. The four
new examples demonstrate Field-provided accessibility attributes on an actual
input and a usable empty-state action; Card slots, status content and decorative
Skeleton dimensions; native action-group, separator and aspect-ratio semantics;
and informative/decorative avatar naming with localized group overflow text.
Their markup checks avoid treating visual styling as behavior or treating SSR as
proof of browser or screen-reader behavior.

The installed verifier typechecks these sources against the packed declarations,
bundles UI imports for Node, and executes them. Its selected example list now
covers twelve UI guides while preserving the offline CLI/MCP catalog parity
checks.

**Verification:**

- `COSSACK_KEEP_SMOKE=1 PATH=/home/tan/.local/share/pnpm/bin:/home/tan/.nvm/versions/node/v24.19.0/bin:$PATH pnpm test:agent-docs:local`: passes fresh package builds and installs, **24 packaged usage examples**, four auth examples, four generated application pages, installed Cloudflare HTTP/SSE/WebSocket traces, offline CLI/MCP parity, UI prop/index contracts and production source-map stripping. D1 bound-value acceptance passes.
- `pnpm --filter cossack exec vitest run tests/package-guidance.test.js`: **1 file / 13 tests pass**.

CLI-08 remains open for broader authored guidance and D1 Worker runtime
coverage. Twenty-seven UI guides remain without executable examples. Desktop is
complete by user decision; waived platform checks are not claimed as passed.
REL-02/REL-03 retain non-Desktop acceptance. Release status remains **28
complete / 30 open**. No deployment or publication occurred.

<a id="codex-rt01-per-call-deadlines-2026-10-05"></a>
### Codex: Per-call RPC deadlines and cancellation (2026-10-05)

`rpc$` now has a factory overload for one-call settings:
`rpc$(() => this.save(), { timeout, signal })`. The previous direct-call form
remains a typed identity view. The helper checks bounded integer timeout values
and AbortSignal structure before the factory runs, so invalid options do not
dispatch an action. A pre-aborted signal also prevents dispatch. Per-call timeout
overrides a method's declared default for component HTTP/SSE and WebSocket calls
and layout-service HTTP calls. An active signal aborts the local request and
settles its RPC call; server application work may have started or may ignore
cancellation, so the result is still treated as uncertain and never retried.

**Verification:**

- `pnpm --filter @cossackframework/core build`: passes, including Vite output,
  declaration generation and ESM declaration import rewriting.
- `pnpm --filter @cossackframework/core exec vitest run tests/rpc-conformance.test.ts tests/rpc-client-types.test.ts tests/server-method-timeout.test.ts`:
  **3 files / 63 tests pass**.
- `pnpm --filter @cossackframework/core exec vitest run`: **94 files / 1,558
  tests pass**.
- `pnpm tsc --noEmit`: passes.

**Limits:** The new checks prove client deadline override, local abort, factory
prevalidation, type inference and cleanup. They do not prove native incoming
TCP disconnect delivery, terminate application I/O that ignores an aborted
signal, rollback an already-applied mutation, or prove component
initialization/restoration concurrency. RT-01 remains open. Desktop is complete
by user decision; its waived platform checks remain unclaimed.

<a id="codex-cli08-renderer-guides-2026-10-05"></a>
### Codex: Installed renderer API guides (2026-10-05)

The renderer package now has installed guides for conditional templates and
optional attributes, keyed list rendering, server-rendered form values, and CSS
composition. Together with the escaped-HTML guide, these cover five common
areas of the public renderer API. The examples import the exact published root
and `/server` entrypoints. They explain that keyed identity is a browser
reconciliation behavior rather than a property proven by SSR; form binding only
seeds HTML before hydration; and `unsafeCSS` marks trusted input rather than
sanitizing it.

The installed-docs verifier selects and compiles each example from its tarball
catalog, then runs it with Node network APIs blocked. The full published-package
catalog now has 72 guides, and the installed run has 75 non-auth examples plus
four separately bundled auth examples.

**Verification:**

- `COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local`: passes package builds and
  tarball installs without Desktop; compiles and executes **75 packaged usage
  examples**, then checks **4 auth examples**, local workerd D1 binding,
  Cloudflare HTTP/SSE/WebSocket browser traces, generated page examples, UI
  catalog contracts, production client/source-map stripping and offline CLI/MCP
  parity.
- The first acceptance run exposed an over-specific form assertion: serialized
  textarea property bindings include whitespace before `>`. The final example
  checks escaped content and the closing element without relying on incidental
  attribute whitespace.

**Limits:** Renderer examples are installed-package SSR examples. They do not
prove browser DOM identity, interactive binding write-back, CSS rendering, or
accessibility. The renderer has existing DOM/hydration tests; this checkpoint
does not rerun the entire package suite. CLI-08 remains open for wider
library/component/recipe coverage and REL-02/REL-03 acceptance. No Desktop
checks, deployment or publication were run.

<a id="codex-cli08-transactions-2026-10-05"></a>
### Codex: Installed transaction and rollback example (2026-10-05)

The database catalog now includes `node-sqlite-transaction-rollback`. It uses
the published Node SQLite adapter and `ORM.transaction()` to transfer funds
between two rows. The example checks that both writes commit, then throws after
one write in another callback and verifies that neither balance changes. The
guide explains that every operation which must commit together belongs inside
the callback; the example does not cover distributed transactions across
connections.

The guidance makes a runtime distinction needed by Cloudflare agents: D1
supports atomic sequential `batch()` operations but does not support interactive
ORM transactions. Calling `orm.transaction()` against D1 fails before the
callback. This example proves only Node's in-memory SQLite adapter.

The installed verifier compiles and executes the example from the package
tarball with outbound Node network access disabled. With this guide, the
published catalog contains 73 guides and acceptance covers 76 standalone
examples plus four separately bundled auth examples (80 total). The full gate
also checks generated Cloudflare pages, CLI/MCP parity, UI catalog contracts,
production stripping and local workerd D1 behavior.

**Limits:** No Cloudflare account or deployed database was contacted. This does
not prove interactive transaction support on D1, provider portability, or
atomicity across separate adapters. CLI-08 remains open for broader
library/component/recipe coverage; REL-02/REL-03 retain the final non-Desktop
acceptance gates. Desktop remains complete by user decision with its waived
platform checks unclaimed.

<a id="codex-cf04-scaffold-guidance-2026-10-05"></a>
### Codex: Accurate Cloudflare scaffold resource guidance (2026-10-05)

Generated D1 config comments and the README now state that the named remote
database must exist before deploy. The README shows `wrangler d1 create` with
the default generated name, explains the pinned Wrangler behavior, and tells
users to replace the Hyperdrive all-zero placeholder with a real configuration
ID while keeping origin credentials in Cloudflare configuration. This corrects
the scaffold's earlier claim that D1 would be provisioned automatically when
`database_id` was omitted.

**Verification:**

- `pnpm --filter @cossackframework/scaffold exec vitest run tests/scaffold.test.js tests/adapter.test.js`: **2 files / 100 tests pass**.
- `pnpm tsc --noEmit`: passes.
- `git diff --check` for the scaffold files: passes.

No Wrangler account calls were made. This is offline setup guidance and a
generated-output regression only; resource selection, authenticated account
inspection and provisioning remain unimplemented. CF-04 stays open. Release
status remains **30 complete / 28 open**. No deployment or publication occurred.

<a id="codex-rt11-process-flash-claims-2026-10-05"></a>
### Codex: Process-local flash replay claims (2026-10-05)

Without a Cloudflare Durable Object coordinator, the framework now atomically
claims each signed flash nonce in a synchronous module-local store. A min-heap
purges expired entries. At the 10,000 live-claim limit, flash reads fail closed
with `COSSACK_FLASH_REPLAY_UNAVAILABLE` (503), clear the cookie, and preserve all
live claims. This gives one winner within a loaded module instance in its
current process or isolate. It does not coordinate across processes/isolates
and does not survive restart. Cloudflare continues to use its durable DO claim.

**Verification:**

- `pnpm --filter @cossackframework/framework exec vitest run tests/flash-middleware.test.ts`: **1 file / 21 tests pass**.
- `pnpm --filter cossack exec vitest run tests/sse-coordinator-integration.test.js -t 'atomically consumes signed flash nonces'`: **1 test passes**; two unrelated tests skipped.
- Root `pnpm tsc --noEmit`: passes after integration.

The tests cover a copied-cookie race, background-request non-consumption,
capacity failure without eviction of a still-live token, expiry cleanup and the
Cloudflare atomic claim path. They do not prove cross-process, cross-isolate or
restart durability. RT-11 remains open for the broader concurrency contract.
Release status remains **30 complete / 28 open**.

<a id="codex-cf08-rpc-logging-2026-10-05"></a>
### Codex: Correlated RPC failure logs (2026-10-05)

HTTP component and layout-service failures now emit structured RPC events.
Each event carries a validated request ID, bounded route/action/runtime labels,
duration, stage and a fixed failure code. The logger never receives an exception
object or request payload. The same safe event format covers action, request,
stream, native-response cleanup and SSE coordinator failures. Expected client
validation, authorization and cancellation failures do not create internal-error
events.

The framework tests match action and stream log events to the request ID returned
to the caller. They also check the route, action, runtime, duration, stage and
failure code fields. A private error marker must not appear in the captured logs.

**Verification:**

- `pnpm --filter @cossackframework/framework exec vitest run tests/rpc-conformance-matrix.test.ts`: **1 file / 478 tests pass** across HTTP, SSE, WebSocket and layout-service cases.
- `pnpm --filter @cossackframework/framework exec vitest run tests/rpc-stream.test.ts tests/native-response-evidence.test.ts`: **2 files / 24 tests pass**.
- `pnpm tsc --noEmit`: passes.
- `git diff --check` for the changed source and test files: passes.

Limits: These are local framework tests. They do not prove Cloudflare Workers
Logs ingestion, production source-map resolution or build/startup budget checks.
The change does not audit all framework logs. SSR, API, SSG and other log paths
remain separate review work. CF-08 stays open. Release status remains **30
complete / 28 open**. No deployment or publication occurred.

<a id="codex-rt20-safe-hydration-diagnostics-2026-10-05"></a>
### Codex: Safe hydration mismatch diagnostics (2026-10-05)

Root hydration fallback warnings now identify the mismatch category, structural
DOM path, expected and actual node shape, and fallback action. Nested component
fallbacks also identify the component class. Text values and comment contents
are omitted. The renderer does not include application state or absolute source
paths in these events.

The tests create a root node-type mismatch and a nested component tag mismatch.
They assert that the warning includes its structural facts and excludes private
rendered-text markers. Normal hydration tests still require node identity to
survive matching templates.

**Verification:**

- `pnpm --filter @cossackframework/renderer exec vitest run`: **24 files / 333 tests pass**.
- `pnpm tsc --noEmit`: passes.
- `git diff --check` for the changed renderer files: passes.

Limits: This work does not compare server and browser state values or report a
field/source location. It does not add a test helper or browser coverage for
retained layout services. RT-20 remains open. Release status remains **30
complete / 28 open**.

<a id="codex-rt12-navigation-fixture-2026-10-05"></a>
### Codex: Navigation ownership browser acceptance (2026-10-05)

The first run of this acceptance returned HTTP 409 at authenticated SSE for both
generated Node and Cloudflare apps. The test middleware set a synthetic user but
omitted `captureRealtimeIdentity`, so the framework correctly rejected an
incomplete authenticated-realtime setup. The fixture now supplies a test-only
versioned identity descriptor; no production runtime code changed.

**Verification:**

- `pnpm --filter cossack exec vitest run tests/generated-runtime-build.test.js -t 'isolates navigation ownership'`: **2 cases pass** (Node and Cloudflare); 62 unrelated tests skipped.
- Root `pnpm tsc --noEmit`: passes after the fixture change.

The focused browser cases now pass navigation state retention, failed-navigation
cleanup, async cleanup ownership, user/scope changes, SSE open and retirement,
WebSocket open/target replacement, and stale-owner disposal. The synthetic
fixture is not real authentication. RT-12 remains open for runtime
metadata/lifecycle acceptance and the full CLI/release gates. Release status
remains **30 complete / 28 open**. No deployment or publication occurred.

<a id="codex-rt24-typed-paths-2026-10-05"></a>
### Codex RT-24 typed configuration paths (2026-10-05)

The `config()` overload fallback used to accept any string after an application
had augmented `CossackConfigRegistry`. That allowed a misspelling to bypass the
typed dotted-path overload and return `unknown`. The fallback now accepts
arbitrary strings only while the registry is empty. Once populated, only
registered dotted paths match, and a provided default must match that path's
value type.

**Verification:** `pnpm tsc --noEmit` passes with framework compile-time
regressions for a misspelled path and a mismatched default. The installed
request-config example includes the same negative type assertions.
`COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` passes with 76 standalone
examples and four auth examples, including published framework declaration
checks.

**Limits:** The app must still declare its own registry augmentation; automatic
registry generation from `src/config/*.ts` was not added. This checkpoint does
not complete RT-24. No task count changed: 30 complete / 28 open. The complete
current summary is in the [release checklist](./release-0.9.0.md#codex-rt24-typed-paths-2026-10-05).

<a id="codex-rt12-service-scope-construction-rollback-2026-10-05"></a>
### Codex RT-12 service-scope construction rollback (2026-10-05)

If a declared service constructor or hydration step fails after earlier
services have initialized, the framework now begins disposal of the partial
scope before rethrowing the construction error. Existing instances receive
`onDispose()` once, and pending asynchronous cleanup remains attached to the
parent so an awaitable parent disposal observes it. The public services guide
describes the behavior.

**Verification:** `pnpm --filter @cossackframework/core exec vitest run tests/cleanup.test.ts` passes **8 tests**. The added regression blocks an earlier service's async `onDispose()`, forces a later constructor to throw, and confirms parent `disposeAsync()` waits until cleanup finishes. Root `pnpm tsc --noEmit` passes. `git diff --check` passes for the implementation and test files.

**Limits:** This covers partially initialized service scopes. It does not
complete RT-12 runtime metadata/lifecycle acceptance or the CLI/release gates.
No task count changed: 30 complete / 28 open.

<a id="codex-rt10-typed-headless-form-controller-2026-10-05"></a>
### Codex RT-10 typed headless form controller (2026-10-05)

Core now exports a schema-backed `FormController` for DOM-free form state. It
types raw and parsed values, accepts typed nested dot paths, copies plain values,
tracks dirty/touched/errors/submission state, resets to initial data, aborts
stale validation, blocks duplicate submits, and maps nested action/RPC field
errors. `File` and `Blob` values retain identity. Forms documentation separates
this API from the existing reactive `@Store()` workflow and fixes a missing
`async` in a `getFormData()` example.

**Verification:** The focused controller tests pass **9/9**; the full Core
suite passes **95 files / 1,568 tests**; `pnpm tsc --noEmit` passes, including
negative field-path/value type checks; `git diff --check -- . ':!reports.md'`
passes.

**Remaining:** This does not satisfy the whole RT-10 contract. Accessible
bindings, reactive UI adapters, keyboard submission, labels/error associations,
focus recovery, nested array-item paths, and file transport have no acceptance
yet. RT-10 remains open. Release count stays **30 complete / 28 open**.

<a id="codex-cf04-static-resource-plan-2026-10-05"></a>
### Codex CF-04 static Cloudflare resource plan (2026-10-05)

Local Cloudflare inspection now classifies each resource reference as configured
or unresolved, records whether the reference is a name or ID, includes a setup
action, and states that remote existence/access was not checked. It removes the
previous `provisioning: existing|automatic` labels. D1 bindings missing either
required field pass the pinned Wrangler local parser but are unresolved for remote deployment,
because Cloudflare's [current configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)
requires `database_name` and `database_id`.
Scaffold docs point to `wrangler d1 list` for an existing ID and the explicit
`d1 create --update-config --binding` command for creating a database and
updating config. Hyperdrive's all-zero placeholder remains an error and now has
a direct remediation. Static inspection does not infer a Cloudflare account
from `--env` or contact Cloudflare. A generated staging app also passed a local
`cossack deploy --dry-run` integration without upload or resource creation.

**Verification:** Cossack's focused deployment/inspect tests pass **30/30**; scaffold's `tests/scaffold.test.js` passes **81/81**; `pnpm --filter cossack exec vitest run tests/deploy-integration.test.js -t 'builds a generated staging app and validates deployment without uploading'` passes **1/1**. Root `pnpm tsc --noEmit` and `git diff --check -- . ':!reports.md'` pass.

**Limits:** This is local static planning only. It does not select resources,
check account ownership or live resource existence/access, provision resources,
or establish wrong-account/repeated-application behavior. CF-04 remains open;
task counts stay **30 complete / 28 open**. The dry-run did not upload or create
resources; remote account/resource readiness remains unverified.

<a id="codex-rt24-generated-config-2026-10-05"></a>
### Codex: Generate configuration factory types (2026-10-05)

Vite configuration tooling now generates `.cossack/config.d.ts` from flat config
factory filenames and refreshes it on development additions, changes and removals.
Type-only references infer factory return shapes without evaluating modules or
copying values. A separate generated registry preserves explicit authored
registry overrides. Scaffold TypeScript includes the generated declaration and
Git ignores it. The Node-only `framework/config-codegen` export supports explicit
pre-typecheck generation and a no-write preview; authored or symlinked output
files are protected. Server config discovery now excludes declarations/tests/specs.

**Verification:** framework config-codegen/config/route-codegen suites pass
**32/32**, including actual compiler checks with `skipLibCheck: false`, inferred
nested paths, bad defaults/paths and authored override precedence. Scaffold suite
passes **81/81**, including generated include/ignore assertions. Framework
`tsc -p tsconfig.declarations.json`, root `pnpm tsc --noEmit`, emitted tooling
import/no-write preview and task-owned diff checks pass. A read-only subagent
review found interface-return and symlink-discovery issues; Codex fixed both and
reran the combined framework tests.

**Limits:** RT-24 remains open. Standalone CLI generation/inspection, required
variable and binding metadata/coercion, selected-environment preflight, and full
secret-redaction/request-isolation acceptance remain. Tests prove no factory
execution/source-value copying and an empty client virtual module, but a fresh
installed app/browser bundle gate was not run for this checkpoint. Config types
require generation before standalone typechecking; Vite performs it on startup.
Task counts remain **30 complete / 28 open**; Desktop platform checks stay waived.

<a id="codex-rt24-config-cli-2026-10-05"></a>
### Codex: Configuration CLI and installed acceptance (2026-10-05)

`cossack config` catalogs filename-based factory keys and type origins without
reading source or executing modules. JSON explicitly reports evaluation and
validation as not performed. `--generate` emits configuration declarations;
`--generate --dry-run` preserves existing output and creates no missing output.
Read-only discovery remains available when generation would conflict with an
authored file. Shared command validation rejects unknown options before writes.
The generator exports discovery separately; Vite and CLI retain one file scope.
Agent documentation, CLI help/README and config/architecture specs explain the
workflow and its limits. A real client build proves the virtual configuration
module excludes factory code and private-value sentinels.

Codex integrated an exclusive-file CLI implementation subagent and a read-only
requirements/review subagent. Review corrected documentation about factory scope
and clarified that filename discovery does not validate default exports.

**Verification:** combined CLI config/command-spec/documentation suites pass
**34/34**; combined framework codegen/config/routes/publication suites pass
**50/50**; core form-controller tests pass **9/9**. Core build, framework declaration
emission, root `pnpm tsc --noEmit`, and task-owned diff checks pass. Fresh
`COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` passes 76 packaged examples,
four auth examples, offline CLI/MCP checks and installed Cloudflare browser
trace/guidance/source-map stripping checks. The new installed configuration
acceptance helper passes separately against that retained tarball app: packaged
CLI generation, typed paths/default errors, stable regeneration and removal.
The local smoke script now invokes this helper before documentation acceptance.

The first installed gate found a real pre-existing RT-10 declaration error:
`FormController<S>` parsing resolves through its object constraint. The validated
result now retains the correlated `InputOf<S>` type, with typed parsed-value
assertions and successful core declaration emission. RT-10 remains open.

**Limits:** installed configuration checking follows the scaffold's
`skipLibCheck: true` policy; the focused generator compiler test separately uses
`skipLibCheck: false`. Published cache declarations still require Worker ambient
types for strict declaration checking, which this installed fixture does not
supply. The initial strict installed attempt failed for missing
`DurableObjectState`, not generated registry inference. No global compatibility
claim follows from the installed gate.

RT-24 remains open: SSR and SSG build factories before entering the request
config scope, so imported required helpers inside factories cannot read that
pending environment. Required variable/binding metadata, coercion, runtime
applicability, selected-environment preflight and full isolation/hydration
redaction acceptance remain. The virtual-module sentinel test does not prove all
direct-import or hydration secrecy. Counts remain **30 complete / 28 open**;
Desktop-only platform acceptance remains waived. No external deployment or
remote resource provisioning occurred.

<a id="codex-rt24-factory-scope-2026-10-05"></a>
### Codex: Prepare factories in their request binding scope (2026-10-05)

SSR and SSG previously evaluated factories before entering the configuration
scope, so imported required helpers saw no bindings or could inherit an outer
scope. `prepareConfigStore` now evaluates synchronous factories inside a fresh
scope containing the selected bindings and an empty config tree. It publishes
the completed tree only after factories succeed, then SSR/SSG use that store for
downstream work. Nested preparation restores its caller on success and failure.
Missing factory requirements stop subsequent factories, user middleware and
page lifecycle. SSG supplies only APP_URL and fails named required live bindings.
The low-level buildConfig evaluator remains available; it does not create a scope.

Codex integrated the exclusive-file scope-test subagent and reviewed all changes.
Coordinator-owned actual router/SSG tests verify interleaved HTTP requests,
omitted environments, required helper failures and middleware exclusion. The
packaged request-config guide now demonstrates scoped preparation.

**Verification:** eight focused framework suites pass **94 tests** (71 scope,
config/router/SSG/CORS tests plus 23 SSG public/service/global tests). The changed
runtime-preparation suite was rerun **5/5** after adding middleware assertions.
Framework declaration emission, root `pnpm tsc --noEmit` and task-owned diff
checks pass. Fresh `COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` passes the
installed config CLI/inference/removal helper, 76 packaged examples, four auth
examples, offline CLI/MCP checks, installed Cloudflare HTTP/SSE/WebSocket and
packaged guidance/source-map stripping acceptance, and UI documentation parity.
Its real workerd fixture now verifies concurrent prepared request values, raw
D1 binding identity, and named missing-binding diagnostics excluding a private
sentinel. Retained evidence: `/tmp/cossack-local-pack-VQ1yPC`.

The Worker acceptance follows current [Cloudflare ALS documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/)
and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/);
Codex retrieved current types and inspected Wrangler's config schema before
extending the local harness. No remote resources were created or deployed.

**Limits:** required helpers still validate when called, rather than reading
independent declarations before the first factory. Variable/binding metadata,
coercion, runtime applicability, selected-environment preflight and full
classification/hydration secrecy remain. Async factories remain unsupported.
Installed config checking retains scaffold skipLibCheck policy; strict cache
ambient-type acceptance remains separate. RT-24 stays open; counts remain
**30 complete / 28 open**. Desktop remains complete by user decision, with its
remaining platform checks waived.


### Codex: Declared configuration requirements (2026-10-05)

Author: **Codex**. Tasks: **RT-24**, with shared **CLI-07/CLI-08/CF-04** inspection
and documentation integration. This is a verified implementation slice; RT-24
remains open. Release counts remain **30 complete / 28 open**.

**Behavior and API:** Config files can export literal named requirements beside
their synchronous default factory. Shared portable normalization/checking covers
required/optional string, number and boolean variables, strict opt-in coercion,
secret classification, binding kinds and runtime filters. Conflicting active
rules reject by name; compatible rules promote required/secret flags. Metadata
accessors and customized runtime-array iterators reject without execution.
Diagnostics exclude values. Runtime binding validation checks minimal public
method shapes without invoking methods; it does not establish platform branding
or connectivity. Parsed scalars stay in server request stores.

`prepareConfigStore` validates all active requirements before the first factory.
`configVariable(name, type)` and `requireConfigVariable` expose typed validated
scalars. Legacy `env` remains string-based and `binding` preserves raw identity.
SSR derives runtime from its actual adapter and preserves selected environment.
SSG explicitly uses `ssg` and supplies APP_URL only. Realtime authorization replay
was found still using the low-level evaluator; it now uses fresh preparation,
retains runtime/environment in server-local snapshots and fails closed before
factory, middleware, authorization or operation callbacks.

**Tooling:** Node-only `framework/config-inspection` uses Vite's AST parser;
`framework/config-requirements` is portable. Static literals and simple local
const export aliases are accepted. Dynamic expressions, imported exports,
mutations, getters, spreads, computed fields, unsupported exported forms and
ambiguous top-level effects remain unknown. Review fixed false absence for
exported binding patterns and TypeScript enum/namespace/import-alias forms.
Static parsing never evaluates modules, factory bodies or user compiler plugins.
Its conservative policy can also reject unrelated dynamic top-level initializers.

`cossack config --check --env staging --json` validates privately parsed selected
Wrangler facts. It does not inherit production vars/bindings into a named
environment, read .env/process overrides, contact remote resources, or expose raw
or parsed values. Required secret existence stays unverified even when a secret
name is declared. Unsupported Node/Deno declaration checks return an explicit
unavailable diagnostic instead of invented missing values. Runtime validation
supports their supplied bindings. Failure with --check --generate stops writes.
Cloudflare CLI inspection/checks and MCP use the shared inspection service;
deployment invokes the same checker before tools or artifact deletion.

**Ownership/review:** Codex checked Git status and preserved user-owned reports.md
and .zcodeignore. Three bounded agents exclusively owned AST inspection/tests,
pure-checker tests, and CLI requirement inspection/config command/tests. Codex
owned the shared types/checker, runtime integration, deployment/shared-service
integration, installed fixtures, final review and acceptance. Agents reported
changed files and focused results; Codex integrated and reviewed all changes.
The package compiler caught the missing Hono context-key type; Codex declared it
and reran declaration emission successfully. No tests read a replaced distribution
during the final gate.

**Observed source checks:**

- Framework combined config, SSR/SSG, realtime/auth, HTTP/SSE/WebSocket and RPC
  regression run: **24 files / 800 tests pass**.
  Log: /tmp/cossack-config-requirements-framework.log.
- CLI config/requirement inspection/deployment/inspection acceptance:
  **6 files / 62 tests pass**. Actual shared Cloudflare inspection matches CLI
  diagnostics and excludes private numeric/factory sentinels.
  Log: /tmp/cossack-config-requirements-cli.log.
- Actual stdio SDK MCP suite: **18/18 pass**, including shared requirement
  diagnostics and parser/dependency-output secrecy.
  Log: /tmp/cossack-config-requirements-mcp.log.
- Framework `pnpm --filter @cossackframework/framework exec tsc -p
  tsconfig.declarations.json` and root `pnpm tsc --noEmit` pass after final source
  edits. Root references alone do not compile package sources.
- Changed JS/helper syntax checks and task-owned diff checks pass.

**Installed/runtime evidence:** Fresh `COSSACK_KEEP_SMOKE=1 pnpm
test:agent-docs:local` passes against all final implementation changes. It builds
and packs fresh non-Desktop packages, verifies the installed config CLI and type
inference, executes 76 packaged examples plus four auth examples, checks installed
reporter/public declarations and offline CLI/MCP parity, and passes Cloudflare
HTTP/SSE/WebSocket browser traces, packaged guidance, source-map-enabled
production stripping and UI documentation parity. Retained project/tarballs:
`/tmp/cossack-local-pack-5dbkLj`. Log:
`/tmp/cossack-config-requirements-final-installed.log`.

The config helper checks literal catalogs without factory execution, generated
inference from typed accessors, missing requirements stopping generation without
changing output, secret availability remaining unverified, and deterministic
removal. Installed type checking follows scaffold skipLibCheck policy. The exact
packaged configuration example now exercises typed number/boolean coercion.
The installed workerd fixture checks real D1 shape/identity, concurrent scoped
configuration, numeric coercion, and invalid declared values stopping factory
execution with no private sentinel in errors. These are local runtime checks;
no deployed Cloudflare resources or secret values were queried.

A coordinator-owned real Vite SSR build loads named requirement metadata and the
selected environment without entering factories. Feeding its actual virtual
exports into preparation rejects a private invalid port before factory entry,
then accepts/coerces valid bindings. The final combined framework run includes
this build test. Client build acceptance excludes factory bodies, private values
and requirement metadata.

Current official [binding docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/),
[D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[KV API](https://developers.cloudflare.com/kv/api/), and
[Durable Object namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/)
were retrieved for binding shape review; current Workers types/schema retrieval
from the preceding scoped-factory checkpoint remains applicable.

**Limits/next work:** Direct Vite declaration preflight, Node/Deno declaration-source
policy and full secret-classification/hydration acceptance remain RT-24 work.
Secret classification cannot prevent deliberate application exposure in props,
factories or responses. Async factories remain unsupported. Installed config
type checks use scaffold skipLibCheck policy; strict cache Worker ambient-type
acceptance remains separate. Full cossack/release-matrix acceptance is not claimed.
Desktop remains complete by user decision, with platform checks waived. No
remote resource, deployment, publication or push occurred. No new external blocker
was found; the remaining release tasks still need implementation/acceptance.

### Codex: Direct Vite configuration preflight (2026-10-05)

Author: **Codex**. Tasks: **RT-24**, shared CLI/Cloudflare tooling, and failed-build
SSG publication protection. This completes a bounded implementation slice;
RT-24 remains open. Counts remain **30 complete / 28 open**.

**Changes:** The Node-only `framework/config-preflight` export shares private
Wrangler normalization and safe declaration inspection across Vite, CLI and
build binding discovery. Direct builds reject missing/wrong binding declarations,
invalid scalar coercion and ambiguous metadata before config type generation,
module transforms and output cleanup. Explicit runtime/environment options win;
scaffold metadata precedes package metadata and adapter dependencies. Cloudflare
uses the selected named declarations, without assuming variables inherit.
Node/Deno/unknown targets validate metadata, conflicts and runtime compatibility
only; process/development values are not inspected. Development startup permits
incomplete values. Build/watch cycles reread facts and watch factory files,
Wrangler paths and project metadata. Failed build/render hooks suppress SSG
publication for their environment. Deployment's secondary named-environment raw
parse now sanitizes exceptions. Public catalogs contain no scalar values.

**Ownership/review:** Codex preserved the existing reports.md and .zcodeignore.
An implementation subagent owned only the new config-build-preflight.test.ts;
it reported 15 passing source cases. A read-only audit found the secondary parse
redaction gap. Codex integrated and reviewed all changes, fixed factory-file
watch registration, and added the parser-failure regression. No overlapping
package builds and tests consumed workspace dist.

**Verification:**

- Focused framework suite: **131 tests / 6 files** pass, including 15 direct-build
  cases with real Vite builds, client stripping, before-write rejection,
  selected environments, target inference and fresh watch-hook checks.
- Full framework suite: **1,686 tests / 86 files** pass.
- Combined CLI/deployment/inspection/actual stdio MCP suite: **73 tests / 6 files**
  pass, including the parser exception redaction regression.
- Framework declaration emission and root `pnpm tsc --noEmit` pass. The root
  solution alone does not compile package sources; package emission was also run.
- Fresh installed tarballs pass CLI config inference/removal and direct Vite
  failure-before-write acceptance. The failing installed build preserves an
  existing output marker and generated declarations, names the missing variable,
  and does not evaluate factory sentinels. **76 packaged examples + 4 auth examples**
  compile and execute; D1 and prepared config pass real workerd checks.

- Full `COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` gate passes (exit 0),
  including Cloudflare HTTP/SSE/WebSocket browser traces, CLI/MCP trace parity,
  production exclusion, packaged action/resource/task/public-form browser/type
  checks and source-map stripping, UI prop contracts and offline documentation
  parity. Desktop build/pack/platform checks are excluded from this gate.

Current installed tooling: Wrangler 4.147.0, Cloudflare Vite plugin 1.62.5,
Vite 8.3.2. Current official Wrangler API/environment docs were checked; tests
exercise project-local parsers rather than a handwritten inheritance model.

Logs: /tmp/cossack-vite-preflight-{focused,framework,cli,installed}.log.
Retained gate: /tmp/cossack-local-pack-r8P8f3.

**Limits/next work:** Node/Deno declaration-source policy and full secret
classification/hydration secrecy acceptance remain RT-24 work. Remote resources
and secret existence are unverified. Classification cannot prevent intentional
application exposure. Async factories remain unsupported; strict installed cache
ambient types remain separate. Desktop remains complete by user decision;
platform checks were waived, not run. Versions remain 0.8.3 until REL-04.
No deployment, publication or remote provisioning occurred.

<a id="codex-safe-http-ssr-failures-and-private-hydration-2026-10-05"></a>
### Codex: Safe HTTP/SSR failures and private hydration (2026-10-05)

Author: **Codex**. Tasks: **CF-08 / RT-24**, verified partial implementation.
Neither parent task is closed. Counts remain **30 complete / 28 open**.

**Implementation:** A portable framework-internal server logging helper validates
outgoing UUIDs and bounds static labels. Native API and class API internal
exceptions emit `cossack.api.failure` with stage/code, template, runtime and
handler duration; class API failures now return generic code/requestId JSON.
Failing class methods cannot replace the managed correlation header. Unknown
HTTP methods become `unknown`. SSR rendering and router cleanup catches emit
`cossack.ssr.failure`; unhandled request config/middleware failures use a safe
Hono `onError` event/response instead of its arbitrary exception logger.
Authorization and controlled HTTP exceptions keep their existing behavior.

An installed Cloudflare helper temporarily declares a test secret in
Wrangler secrets.required (local injection filters those names), reads it into
an undecorated private field and publishes only a boolean/count. It verifies
actual SSR HTML and parsed hydration, browser hydration and real server RPC,
delivered JavaScript, request/response traffic and CLI config/check/Cloudflare
catalogs. A real generated-app production build emits client scripts/maps and
both are scanned. The helper restores exact source/config/types and original
output, Wrangler and optimizer directories, and removes only its own temporary
files/new empty directories. It rejects an existing scratch directory.

**Ownership/review:** Existing reports.md and .zcodeignore remain preserved.
One implementation agent exclusively owned API source and API regression files;
another exclusively owned the new installed hydration helper. A third read-only
agent audited Node/Deno declaration-source policy. Codex owned the shared helper,
router/error handling, full integration, gate invocation, documentation and
final verification. Review added modified-header and custom-method redaction
coverage. The full suite found a non-UUID policy fixture; its correlation ID was
updated to a canonical UUID. Desktop checks were excluded under the existing user waiver; all verification
listed below was executed. Package builds and dist-consuming tests did not overlap.

**Verified evidence:**

- Final framework source suite: **1,696 tests / 88 files** pass. Four focused
  integration suites pass **44 tests**, covering native schema/auth/handler/output
  errors, class handler/gate/output errors, SSR cleanup and config/middleware
  failures, correlation, authored templates and secret property/value absence.
- Framework declaration emission and root `pnpm tsc --noEmit` pass. The package
  emitter compiles sources; the root reference solution alone does not.
- `node --check` passes for all three changed acceptance scripts.
- The installed retained helper separately passes generated-app typechecking,
  actual workerd/browser private-read/RPC acceptance, CLI redaction and production
  client/source-map scanning. Retained original fixture files are restored.
- Fresh installed workerd asserts a real native API handler's single structured
  console event has the same response header/body UUID, authored `/items/:id`,
  Cloudflare runtime and fixed handler stage/code, without private error/property,
  path or query sentinels. Capture is test-only and forwarded to console; this
  proves local runtime emission, not remote Workers Logs ingestion.

- Final fresh `COSSACK_KEEP_SMOKE=1 pnpm test:agent-docs:local` passes (exit 0):
  76 packaged examples + four auth examples, D1/config/native API workerd checks,
  reporter and CLI/MCP evidence parity, Cloudflare HTTP/SSE/WebSocket browser
  traces, application/page browser checks and production stripping, UI contract
  and offline documentation parity, and the corrected private hydration helper.
  The helper's installed app typechecking, SSR/browser/RPC and client maps checks
  all ran against the final tarballs. Desktop is excluded.

Initial full gate failed the new fixture's generated-app typecheck (TS2416):
its live Node process had cached the earlier synchronous init before the agent
corrected it to async. The corrected helper passed independently on that same
fresh installation, then the full gate was rerun from final sources and passed.
No failing check was waived. Recovery log:
/tmp/cossack-server-logging-hydration-recovery.log. Final gate log:
/tmp/cossack-server-logging-installed-final.log. Retained final gate:
/tmp/cossack-local-pack-mL6TSQ. Earlier recovered installation:
/tmp/cossack-local-pack-kzOQ0z. Current installed tooling: Wrangler 4.147.0,
Cloudflare Vite plugin 1.62.5, Vite 8.3.2, TypeScript 7.0.2.
Logs: /tmp/cossack-server-logging-{focused,combined,framework,installed}.log.

**Limitations/next work:** CF-08 still needs core lifecycle/WebSocket, adapter,
manifest/SSG/access-log review, development SSR exception-detail policy,
whole-request timing, remote log ingestion, production source-map resolution and
measured/configurable budgets. Global fallback duration starts at failure
handling, so it does not measure middleware elapsed time. These changes do not
claim every framework log is safe. Detailed development SSR error pages still
include application exceptions; arbitrary private values in those messages are
not covered by the successful hydration case.

RT-24 still needs native Node/Deno hydration, declaration-source policy and
broader failure-diagnostic/classification acceptance. The browser fixture uses
a development Cloudflare Worker; production client artifacts/maps are scanned,
not a production Worker browser session. The new helper uses CLI metadata, not
MCP (existing installed catalog parity remains a separate gate). Remote resources
and secret existence are unverified. Classification cannot prevent intentional
public state/HTML/resource/RPC exposure. Versions remain 0.8.3 until REL-04.
Desktop stays complete with platform checks waived. No deployment, publication
or remote provisioning occurred.

<a id="codex-core-node-redaction-2026-10-05"></a>
### Codex: Core and Node runtime failure redaction (2026-10-05)

Portable core diagnostics replace raw exceptions in component actions, iterator
cleanup, server task setup/cleanup, asynchronous component cleanup and service
rollback/disposal. Metadata is captured before teardown; missing or throwing
request context metadata cannot break cleanup. Durable Object malformed frames
and delivery failures, shared socket missing-target/authentication diagnostics,
and Node authentication/scope/bootstrap/state/upgrade/socket/cleanup paths use
fixed structured events. Incoming socket target/action labels are not logged.
Browser task diagnostics and controlled socket-close behavior are preserved.

CF-08 remains open. Adapter events may have unavailable IDs and unknown authored
labels; Node in-memory callbacks use generic dispatch stages. Task setup duration
starts at failure capture. Component update catches, Deno, development SSR error
pages, manifest/SSG/access logs, whole-request timing, remote Workers Logs,
production source-map resolution and budgets remain open. No live deployment or
fresh installed-tarball gate is claimed for this checkpoint. Release status stays
**30 complete / 28 open**. Desktop remains complete with platform checks waived.

Verification: Node adapter **33/33**, framework RPC/stream/logging **501/501**,
root `pnpm tsc --noEmit`, Node package no-emit check, core build/declaration emit,
Node build/declaration emit and framework `build:types` pass. Full core results
are recorded below after the final serial run. Core package-wide no-emit remains
failing in untouched `form-controller.test.ts` (two diagnostics) and
`rpc-conformance.test.ts` (two missing `loading` members); framework package-wide
no-emit also reports unowned source/test diagnostics. These are not claimed as
passed; its production declaration build succeeds. The introduced fixture Hono
context typing error was corrected.

Earlier full core runs exposed and corrected three partial-context lifecycle
regressions and a socket test fixture missing `readyState`. Another run overlapped
core dist rebuilding and failed seven published-declaration fixtures; the final
run uses completed builds and no concurrent dist writers. Logs:
`/tmp/cossack-runtime-redaction-{core-serial,node-final,framework-final,types-final,core-types-final,node-types,framework-types,build-final,node-build,framework-emit}.log`.

Final serial full core suite: **1580/1580 tests across 97 files pass**. Final owned-file whitespace check passes. No fresh installed tarball or remote Cloudflare check ran.

<a id="codex-framework-deno-redaction-2026-10-05"></a>
### Codex: Framework, SSG and Deno runtime redaction (2026-10-05)

Development SSR fallback HTML now includes only a fixed code, managed UUID and
bounded authored route. Exception stacks/messages/custom values are omitted.
Authored error boundaries and response statuses remain intact. Manifest, CSS,
Durable Object state and SSG loader/render/cleanup catches emit fixed metadata.
SSG failed-page messages retain a fixed public-route code or generic failure;
original cleanup causes remain available for control flow without being logged.
Optional access logging records matched authored templates and allowlisted methods,
not concrete paths or queries. Core server update catches now omit exceptions;
browser diagnostics and explicit propagated navigation errors retain behavior.

Request-context middleware captures monotonic entry time. Managed API/SSR/global
failure durations now include downstream configuration and middleware; standalone
handlers retain a local start fallback. This excludes pre-framework transport,
startup and background work. Deno socket/runtime/development catches use fixed
metadata; shared in-memory callbacks use generic dispatch stages rather than
misclassifying delivery as parsing. Controlled socket closure remains unchanged.

CF-08 and RT-24 remain open; **30 complete / 28 open**. Deno Vite module
transport/load/reload compiler-channel review, native Deno startup/cleanup fault
acceptance, remote Worker log ingestion, production source-map resolution and
artifact/startup budgets remain. Desktop is closed with platform checks waived.
No remote deployment or provisioned resource was used.

Source verification: final full framework suite **1705/1705 across 91 files**
passes with `--testTimeout=30000`; full core **1581/1581 across 97 files** and
configured Deno suite **30/30 across 5 files** pass. Root `pnpm tsc --noEmit`,
core build/declaration emit, Deno build/declaration emit and framework
`build:types` pass. The first framework run had **1697 passes / one five-second
SSG globals timeout**; the full extended-timeout rerun passed, followed by another
full run after final agent additions. No timeout is recorded as a pass or waiver.
Native Deno subprocess fault acceptance did not run (no `deno` executable on
PATH); Node-based tests cover adapter socket/cleanup semantics, not actual
Deno development startup faults. Deno Vite compiler-channel work remains open.
Logs: `/tmp/cossack-redaction-phase2-{core-tests,framework-verified,deno-tests,root-types,core-build,deno-build,framework-types,installed}.log`.

Final installed verification: `COSSACK_KEEP_SMOKE=1 node
scripts/test-local-scaffold.mjs --agent-docs-only` **passes** from freshly built
and packed non-Desktop packages. It verifies generated app types, configuration
preflight, all 80 packaged usage/auth examples, local D1/workerd prepared config,
HTTP/SSE/WebSocket browser traces, CLI/MCP parity, production stripping and private
config SSR/browser/RPC/client-JavaScript/source-map secrecy. Retained fixture:
`/tmp/cossack-local-pack-KrpbyE`. This existing gate proves package integration;
new deliberate SSR/SSG/Deno failure cases are source regression evidence, not
remote logging or native Deno fault acceptance. Final Deno rerun after correcting
the generic dispatch callback: **30/30** (`deno-final.log`). Final root typecheck
and owned-file diff checks pass. Reports and `.zcodeignore` remain untouched and
excluded from the commit.

<a id="codex-cf08-budgets-deno-transport-2026-10-05"></a>
### Codex: Project size budgets and Deno development transport (2026-10-05)

`package.json` literal `cossack.buildBudgets` now configures warning/error limits
for upload/gzip KiB. CLI build and deploy share a local measurement service after
fresh Cloudflare artifact validation. Stale redirects are removed before builds.
A violated error budget stops before upload; warnings allow continuation. Dry-run
deployment reuses the measurement instead of invoking deployment twice. JSON
reports selected metrics/limits and fixed diagnostics; private tool stdout/stderr
is bounded and omitted. Unsupported precision, ambiguous summaries, missing
metrics, malformed settings and tool failures cannot pass a hard budget.
Wrangler reports two decimals; comparisons use its upper rounding interval,
not invented exact bytes. `providerStartupMs` remains unavailable locally and
fails a configured hard gate; build duration is not substituted for startup.

Deno Vite invoke/startup/socket/reload/proxy catches now emit fixed events and
safe HTTP500/502 bodies without forwarding arbitrary exceptions into Vite's
public error renderer. Authenticated compiler results remain unchanged on the
private ModuleRunner channel. Recovery/socket destruction remain covered.
Deno 2.9.6 was obtained with pnpm's temporary tool runner; native smoke includes
real socket action-failure redaction and preserved1013 closure.

CF-08 remains open; **30 complete / 28 open**. Budgets currently require CLI
Cloudflare build/deploy paths, not direct Vite or Node/Deno artifacts. Provider
startup/local profiling, production source-map resolution and remote log
acceptance remain. Native Deno development startup/cleanup fault fixtures remain
open despite passing native socket smoke. Desktop remains closed by user decision.

Verification: final combined budget/deployment suites **44/44 across 5 files**
pass, including a real generated Cloudflare app that generates types, builds,
verifies the artifact and rejects an actual measured size before upload.
Initial fixture runs stopped at existing APP_URL preflight because the generated
URL was localhost; corrected to an HTTPS test URL, then the real budget failure
passed. Reviewer-found summary precision, manifest parse privacy and rejected
tool resolution gaps have regressions and fixed diagnostics.

Full Deno adapter suite **34/34 across 6 files** and native Deno socket smoke
**2/2** pass. Deno build/declaration emission and root `pnpm tsc --noEmit` pass.
CLI JSON matrix initially **54/54** passes in the combined 72-case run; after
final source changes, all **4 selected build/deploy cases** pass with 50 unrelated
cases skipped. Final generated/combined run includes budget-step reporting and
warning-only dry-run reuse. Syntax checks and owned-file diff checks pass.
Logs: `/tmp/cossack-budget-{complete,cli-final,deno-tests,deno-native-final,deno-build,typecheck-verified}.log`.
The earlier precision/input/rejection fixes were reviewed independently.
No fresh full tarball gate ran in this checkpoint; the actual measurement helper
also checked the retained prior installed artifact locally (539.89 KiB upload /
157.41 KiB gzip) and rejected a 0.001 KiB threshold. This is local tool evidence,
not provider startup, deployed source-map resolution or remote logs. Existing
package-wide type failures recorded previously remain outside this checkpoint.
Reports and `.zcodeignore` remain untouched and excluded from staging.

<a id="codex-package-type-repair-2026-10-05"></a>
## Codex: package type repair (2026-10-05)

Scope: coordinator repaired shared InputSchema/config APIs and middleware consumers,
reviewed and integrated the exclusive framework test-repair agent, and added
regressions. A separate read-only agent audited direct Vite budgets; no budget
runtime changes or tests came from that audit. User-owned reports.md and
.zcodeignore were excluded from edits and staging.

InputSchema now defaults Raw to Output. Coercing schemas retain explicit incoming
types; noncoercing nested strings, enum choices, file arrays and optional strings
reject invalid raw values through published declarations. Existing controller
field-value assertions now compile and their invalid assignments fail as intended.
Config accepts roots/subtrees with precise inferred shapes; unknown paths and
incorrect defaults remain rejected. Locale consumers infer types. Optional CORS
uses a bounded internal read without widening public config overloads, with actual
request-store coverage for present/absent configuration.

Verified final checks:
- pnpm --filter @cossackframework/core build: passes JS/declaration emission.
- pnpm exec tsc -p packages/framework/tsconfig.declarations.json: passes emission.
- pnpm tsc --noEmit: passes; root is a references-only solution, so package checks
  below provide source/test verification rather than relying on that root result.
- pnpm exec tsc --noEmit -p packages/{core,framework,node-adapter}/tsconfig.json:
  each run separately; all pass. Final framework check includes new CORS coverage.
- pnpm --dir packages/core exec vitest run --maxWorkers=2:
  **1,581 tests / 97 files**, all pass, including published InputSchema declarations.
- pnpm --dir packages/framework exec vitest run --maxWorkers=2:
  **1,707 tests / 91 files**, all pass, including compiled config inference fixtures.
- Owned-file git diff --check passes.

Initial full runs used default concurrency together and produced test timeouts;
that run was stopped, not counted as passing. Final bounded suites ran separately
with stable dependency declarations. Initial package-working-directory invocations
could not find pnpm/node; root pnpm --dir invocation resolved the environment.
Logs: /tmp/cossack-types-repair-{build,framework-build,root-final,core-final,
framework-final,node,core-tests-final,framework-tests-final}.log.

Limits: no fresh tarball-wide gate, browser E2E, remote deployment/log ingestion,
provider startup measurement or deployed source-map check ran in this checkpoint.
Core build verifies declarations used by the published-type fixture; framework
codegen compiles source config types, not a freshly installed package. RT-10 still
needs accessible/reactive bindings, array-item paths and browser/file transport
acceptance; CF-08 still needs direct Vite integration and recorded operational
acceptance. REL-03 remains open for its complete non-Desktop final-version gate.
Direct Vite ordering/shared-module/artifact/receipt constraints are preserved in
CF-08's detailed plan. No task closed; **30 complete / 28 open**. Desktop is
complete by user decision, remaining platform checks waived. No blocked work.

<a id="codex-direct-vite-budgets-2026-10-05"></a>
## Codex: opt-in direct Vite budgets and built-target environment safety (2026-10-05)

Coordinator owns the shared implementation. One read-only agent located actual
generated/installed Vite fixtures; another reviewed ordering, target verification,
privacy and final CLI deployment. Neither edited files or ran tests/builds.
The initial scope review found no defects; its final-deployment follow-up found
and confirmed the ambient-environment bug described below. Reports/tool settings
remain user-owned and were excluded from edits/staging.

Behavior: `cossackBuildBudgets()` is an opt-in post application-build plugin after
Cloudflare. It rejects unfinished Worker environments, deletes stale redirect
metadata before building, validates the fresh primary artifact against selected
source config, measures private bounded Wrangler output and enforces warning/error
limits. Primary Worker scope and the installed CLI/createBuilder().buildApp()
requirement are documented. The single-environment Vite build() API bypasses these
hooks; no claim is made for that API. Framework owns Node-only budget/artifact
modules, exported for CLI reuse, with no framework-to-CLI dependency.

The actual staging fixture initially failed target comparison: Wrangler reads
CLOUDFLARE_ENV even with explicit generated config, treating it as an ordinary
config and applying the environment again. Built-artifact reads now pass explicit
empty env; measurement clears ambient selection. Review caught the same issue in
final CLI deployment, which now clears selection only after types and Vite build.
Source selection stays intact. Unit and published CLI tests verify this boundary.
No remote upload was performed.

Verified source/build evidence:
- Framework declaration emitter passes; root pnpm tsc --noEmit and framework
  package --noEmit pass. Root is references-only; package checks provide source
  and test checking. Final logs are recorded below.
- Full framework: **1,716 tests / 94 files**, all pass. Includes 6 plugin cases,
  real Wrangler ambient-target verification and 2 native private-capture cases.
- CLI budget/artifact/generated suite: **35 tests / 4 files**, all pass, including
  actual staging Vite warning, hard-error and generous-limit builds and deliberately
  stale initial metadata. After final deployment correction, affected CLI unit
  suites pass **43 tests / 4 files** (including 10 deploy tests). The overlapping
  runs are not added together as distinct coverage.
- Modified JS/MJS syntax and owned-file whitespace checks pass.

Installed evidence: the fresh non-Desktop command
COSSACK_KEEP_SMOKE=1 node scripts/test-local-scaffold.mjs --agent-docs-only
passes, retained at /tmp/cossack-local-pack-G0M6gm. It uses real tarballs,
Vite 8.3.2 and Wrangler 4.147.0, versus workspace Vite 8.1.4/Wrangler 4.114.0.
It verifies configuration inference/preflight, 76 usage examples, 4 auth examples,
D1/workerd behavior, CLI/MCP parity, HTTP/SSE/WebSocket browser traces, private
SSR hydration/RPC/client source-map secrecy, plus installed direct budget warning,
hard rejection, selected target and private measurement. Its database package
build also passes 93 tests / 15 files and the neutral Workers bundle audit.
This full gate completed before the final CLI deployment correction. The CLI
was then repacked into /tmp/cossack-final-cli-pack/cossack-0.8.3.tgz, reinstalled in
the retained project, and the expanded published helper rerun successfully:
installed direct Vite warnings/rejection/target/privacy plus actual corrected
CLI selected-target types/build/artifact dry run. That targeted run verifies the
last CLI change; do not call it another complete tarball gate.

CLI JSON timing evidence: the initial 54-case run passed 51 cases; 3 real
multi-command cases hit their default five-second test timeout. An isolated retry
also timed out all 3. Those cases now use the existing neighboring 30-second
integration allowance, retaining every behavior/output/snapshot assertion.
Final `pnpm --dir packages/cossack exec vitest run tests/cli-json-matrix.test.js
--maxWorkers=1` passes **54/54** with those per-case timeouts. Duration: 144.78s.
The ordinary full run failed its three original timeout budgets, not behavior
assertions; no passing result is claimed for that earlier run.
This adjusts test harness timing; it does not prove CLI latency improved.

Logs: /tmp/cossack-direct-budget-{build-final,root-verified,
framework-types-verified,framework-final,cli-final,cli-verified,
cli-matrix-final,installed,published-final}.log. Initial mismatch and timeouts
remain in cli-tests, cli-matrix and cli-matrix-retry logs.

Limits/next work: CLI result receipts and default Cloudflare scaffold composition
remain open. Opted-in CLI builds currently measure twice when successful and
report plugin rejection as a build failure. Keep receipt validation bound to a
fresh invocation, settings, environment and artifact modules/config; no bypass.
Custom config paths/watch semantics, auxiliary Worker policies, local/provider
startup metrics, native development faults, deployed source maps and remote logs
remain as specified in the detailed plan. Desktop stays complete by user decision,
platform checks waived. No parent acceptance row closed; **30 complete / 28 open**.
Versions stay 0.8.3 until REL-04. No blocked work.

<a id="codex-budget-receipts-2026-10-05"></a>
## Codex signed budget receipts and default scaffold (2026-10-05)

Ownership: coordinator implemented shared Node-only framework APIs, CLI
integration, template composition and tests. The independent receipt audit was
read-only, changed no files and ran no checks; it reported no actionable defects.
User-owned `reports.md` and `.zcodeignore` were preserved and excluded from staging.

Receipt acceptance: 20 new framework regressions cover authenticated round trips,
stale invocation/environment, signature tampering/corruption, settings drift,
module/config/redirect/tool changes, before/after identity, unsupported graphs,
symlinks, storage clearing, safe values and fixed measurement failures. Ten new
command regressions cover successful reuse, failing receipt classification,
unrelated failures, fresh fallback and settings mutation for build and deploy.
Native generated-app acceptance proves deliberate hard rejection, direct Vite
selected-environment warning/error/pass and successful CLI build/deploy warning reuse with
zero `runProjectToolCaptured` fallback calls. Only the primary Worker is measured.

Verification:
- Full framework: **1,736/1,736, 95 files** (`/tmp/cossack-receipt-framework-full.log`).
- Affected CLI: **56/56, 6 files** (`/tmp/cossack-receipt-cli-verified.log`).
- Native integration: **3/3** in the final combined run, including build/deploy
  reuse. Earlier deploy-only reuse pass: `/tmp/cossack-receipt-native-reuse.log`.
- Scaffold creation/adapter regressions: **91 passed, 9 Desktop cases skipped**
  (`/tmp/cossack-receipt-scaffold.log`). Desktop platform checks remain waived.
- Root `pnpm tsc --noEmit`, framework package typecheck and declaration emission
  pass. Initial numeric `createReadStream` flags type error was repaired with
  `fs.promises.open` and a bounded handle stream before final checks.
- Installed helper syntax check and fresh Cloudflare tarball gate pass:
  `COSSACK_KEEP_SMOKE=1 node scripts/test-local-scaffold.mjs --agent-docs-only`.
  Retained `/tmp/cossack-local-pack-gZdSQv`; terminal exit 0 in
  `/tmp/cossack-receipt-installed.log`. Installed Vite 8.3.2 / Wrangler 4.147.0
  validate the new export/default template, selected-environment direct warning,
  hard rejection, signed CLI warning/hard diagnostics, and private measurement.
  The gate also verifies 76 packaged usage examples, four auth examples,
  configuration generation/inference, CLI/MCP parity, real Cloudflare
  HTTP/SSE/WebSocket browser traces, application examples/client stripping and
  private SSR hydration. This is the Cloudflare agent-docs gate, not the full
  non-Desktop release matrix; no remote deployment or resource creation occurs.

Limits: fingerprints accept bounded no-bundle JavaScript primary-Worker graphs.
They hash a conservative output directory superset, native traversal order,
metadata, redirect, installed Wrangler manifest/entry/bin and Node identity.
Inventory caps are 4,096 files / 64 MiB including tool files. Unsupported or
changed inventories disable reuse and trigger fresh measurement after successful
builds. Failed builds keep build diagnostics unless a valid failing receipt
classifies them. Receipts contain no signing key, tool output, binding values or
private diagnostics. Watch/custom-config-path acceptance, auxiliary Worker
policies, provider startup metrics, native development faults, deployed source
maps and remote logs remain open. No live deployment/provisioning occurred.
CF-08 remains open; **30 complete / 28 open**, no blocked work.

<a id="codex-custom-config-watch-2026-10-05"></a>
## Codex custom Cloudflare config and watch policy (2026-10-05)

Ownership: coordinator owns shared config/binding APIs, page/config/budget plugin
changes, CLI integration and native/installed acceptance. One agent audited Vite
8.1.4 / Cloudflare plugin 1.47.0 watch orchestration without edits or execution.
Another agent exclusively added the seven selector regressions in
`cloudflare-config-path.test.ts` and ran them successfully. Coordinator reviewed
and integrated both; user-owned reports.md and .zcodeignore remain untouched.

Implemented explicit/environment/root source selection with no missing-selected
fallback. Declaration preflight and page build bindings support explicit plugin
paths; CLI inspection uses Cloudflare's documented environment control, propagated
to type generation and Vite. Native acceptance covers a nested config with a
rebased main, selected environment, signed CLI reuse without fallback measurement,
and direct explicit plugin options without a root Wrangler config.

Watch policy is intentionally explicit: budgeted watch builds reject with a fixed
code before deleting artifact metadata/building. Vite currently returns watchers
before output completion and marks environments built; buildApp is not rerun for
subsequent watch generations. Root/environment settings and mutated custom
builders are guarded. Unconfigured budgets and normal DEV get no added guard.
No per-watch-generation measurement support is claimed.

Verification:
- Final framework **1,757/1,757 across 96 files**:
  `/tmp/cossack-custom-config-framework-complete.log`.
- Final affected CLI **60/60 across 6 files**:
  `/tmp/cossack-custom-config-cli-verified.log`, including five native cases.
- Seven agent-authored selector tests passed independently; focused plugin and
  actual Vite declaration preflight **33/33 across two files** passed.
- Root `pnpm tsc --noEmit`, framework package check and final declarations pass;
  new/changed installed helper syntax passes.
- Initial combined CLI run: **57 passed / 1 failed**. Explicit direct Vite
  composition reached a page capability reader still using the root config.
  Added its matching source-path option and reran the full combined checks.

Scope: primary Worker only; CLI does not evaluate Vite config to infer explicit
plugin options, so use CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH for CLI custom configs.
Programmatic Worker config overrides, auxiliary budget policies, wider module
inventories, startup profiles/provider metrics, production source-map resolution
and remote logs remain open. Desktop platform checks remain waived; no live
resources were created or deployed. CF-08 stays open, **30 complete / 28 open**.

Installed acceptance initially exposed a separate CLI executable-resolution gap:
`cossack build` attempted a bare vite executable absent from the parent PATH,
while invoking the installed Vite by absolute path succeeded. Build now uses the
shared project-tool resolver for captured and human output, matching deploy.
Two new command regressions cover unbudgeted JSON/human builds; native receipt
assertions distinguish the Vite invocation from additional Wrangler measurements.
The final affected CLI total above is 60 after this repair. Initial installed
failure and the diagnostic reproduction are recorded in
`/tmp/cossack-custom-config-installed{,-debug}.log`.

Further integration review found SSG's sync URL reader still selected root files.
The async config reader and SSG now share a pure Node source-path candidate
helper. `getSiteUrl` and `cossackSsg` accept explicit configPath; JSONC/TOML tests
prove selected environment URLs, explicit-over-environment priority and no root
fallback for a missing selected source. Final framework total above is 1,757.

Installed fixture corrections: pnpm-workspace overrides initially pinned the
older framework despite updated manifest dependencies. Corrected the fixture's
framework/CLI overrides, verified resolved package paths and selected distinct
final tarball filenames. A later COSSACK_APP_URL_INVALID result correctly
rejected the scaffold's placeholder domain; the helper now supplies its HTTPS
acceptance domain. Intermediate logs are retained in
`/tmp/cossack-custom-config-installed-{final,debug-nonce,verified}.log`.

Final installed package acceptance: **PASS**, terminal exit 0 in
`/tmp/cossack-custom-config-installed-ssg-final.log`. Repacked final framework
and CLI into `/tmp/cossack-custom-config-tarballs`, updated both retained fixture
overrides and verified installed resolution to those final tarballs. Executed
`verifyBudgetBuildModes` in `/tmp/cossack-local-pack-gZdSQv/minimal-production`
with Vite 8.3.2 / Wrangler 4.147.0. It verifies CLI build/deploy signed receipts
using a custom config without a root Wrangler file, direct explicit plugin paths,
published SSG URL discovery through both environment and explicit paths, prompt
native watch rejection, missing receipts after rejection and private output.
The helper restores its fixture files and is now wired into the Cloudflare
agent-docs tarball gate. This is focused final-package acceptance in the retained
fixture, not another full gate or full non-Desktop release matrix. The preceding
full Cloudflare gate is recorded in the signed-receipt checkpoint.
No blocked work; task counts remain 30 complete / 28 open.

<a id="codex-local-startup-2026-10-05"></a>
### Codex: local startup budget validation (2026-10-05)

Author: Codex. Continued after `2872880e`. This completes CF-08's opt-in local
profiling slice, not its provider startup/source-map/log/development acceptance.
Counts remain **30 complete / 28 open**. Versions remain 0.8.3. Desktop remains
complete by user decision; its unrun platform checks remain waived.

Two independent read-only audits established native profiler semantics and the
primary-only deployment boundary. An implementation agent exclusively owned
`startup-profile.ts` and its 33 parser tests. Another exclusively owned the 15
startup measurement integration tests. Codex reviewed all code and owned shared
budget APIs, CLI capture, receipt integration, native acceptance and final checks.

The configured local profile window uses `(endTime - startTime) / 1000` ms.
Active time sums non-idle sampled deltas, including GC; empty samples leave active
time unavailable. Malformed node/sample graphs and unsafe numeric ranges reject.
The two metrics retain separate names from unavailable `providerStartupMs`.
Wrangler writes a private multipart bundle, then a CPU profile, in a mode-0700 OS
temporary directory. Each file is limited to 64 MiB and must be a regular file;
raw code, binding values, URLs, function names and tool output do not enter JSON
results or receipts. Success and failure both remove the directory; cleanup
failure returns a fixed measurement error. Each tool call has a 30-second deadline
and 1 MiB combined capture. Unix termination kills its process group, including
pipe-holding descendants. Windows uses taskkill, but native Windows/macOS CLI
termination was not tested here. This is separate from Desktop's waiver.

Signed receipts authenticate the local numeric timings with existing invocation,
settings, environment, artifact/tool identity checks. Local-only values cannot
invent available upload sizes. Size-only budgets make no profile files or calls.
Missing/invalid profiles, oversized or symlink files, failed tools and timeouts
fail closed. Warning-only provider settings explicitly remain unverified.

Verification:

- Framework focused parser/budget/receipt checks: **57 passed / 3 files**.
- Complete framework rerun: **1,808 passed / 98 files**, using `--maxWorkers=2`;
  `/tmp/cossack-startup-framework-final.log`. First unrestricted run had 1,803
  passes and four failures across SSG globals/view transitions, beginning with
  five-second timeouts under competing load. No changes to those features were
  needed; complete rerun passed. Initial log: `/tmp/cossack-startup-framework.log`.
- Initial affected CLI run: **62 passed / 6 files**;
  `/tmp/cossack-startup-cli.log`. Additional native generated Worker profile/
  signed receipt acceptance: **1 passed, 5 filtered skips**,
  `/tmp/cossack-startup-generated.log`. Filtered skips are not passes. Final
  combined affected CLI run: **63 passed / 6 files**, including all six native
  cases; `/tmp/cossack-startup-cli-final.log`, terminal status 0.
- Root `pnpm tsc --noEmit`, framework package `tsc --noEmit`, declaration emission,
  CLI/helper JavaScript syntax and owned diff whitespace checks pass. Logs:
  `/tmp/cossack-startup-build.log`, `/tmp/cossack-startup-types-final.log`.
- Native Wrangler **4.114.0** simple Worker profiling passes for local window and
  active time, explicitly leaves provider startup unavailable, and rejects an
  intentionally tiny active-time error threshold. Private binding sentinel is
  absent from results. `/tmp/cossack-startup-native.log`.
- Repacked installed framework/CLI pass the expanded custom-config acceptance
  helper, including build/deploy startup receipts, explicit Vite options, SSG
  URL discovery and prompt watch rejection. Retained fixture:
  `/tmp/cossack-local-pack-gZdSQv/minimal-production`; Vite 8.3.2 / Wrangler
  4.147.0. `/tmp/cossack-startup-installed.log`, terminal status 0. Tarballs:
  `/tmp/cossack-startup-tarballs/{framework,cli}-startup-0.8.3.tgz`.

Limitations: local timings include profiler overhead and depend on machine/tool
versions and sampling. Unsupported application modules/bindings may fail native
profiling. No remote upload, provisioning, publication or push occurred. No
fresh full agent-docs gate, full CLI suite or non-Desktop release matrix was run
at this checkpoint. Auxiliary Worker budgets/receipts/uploads remain future work;
current deploy uploads only the primary Worker. CF-08 and REL-03 remain open.

<a id="codex-auxiliary-budgets-2026-10-05"></a>
### Codex: explicit auxiliary Worker budget validation (2026-10-05)

Author: Codex. Continued after `292a2aca`. CF-08 gains explicit auxiliary budget
policies and broader deployment-target comparison. No parent task closes: counts
remain **30 complete / 28 open**, versions remain 0.8.3. Desktop remains complete
by user decision; remaining Desktop platform acceptance is waived, not passed.

Ownership/review: the policy-reader agent exclusively wrote the new literal
reader and its 34 tests. A separate agent exclusively wrote 21 auxiliary verifier
tests. An independent binding audit then exclusively wrote ten native Wrangler
binding/D1 tests. Codex reviewed all code, consolidated limit validation, owned
shared APIs/CLI/Vite integration, added the Cron and final dry-run regressions,
and ran combined/native/installed verification. No shared implementation files
were concurrently assigned to agents.

The Node-only API captures source configs before building and matches raw generated
source-path metadata to exactly one fresh auxiliary redirect entry. Every selected
artifact must pass normalized target comparison before any auxiliary measurement.
Source/policy changes are checked after measurement, with a final check before
primary upload or dry-run success. Ambiguous/duplicate/missing metadata,
primary/prerender reuse and non-project/symlink configuration files fail. Limits:
32 policies/redirect entries, 1 MiB regular source/redirect/artifact config files.
Private normalized targets remain internal; result envelopes contain authored
relative paths and fixed safe metrics/diagnostics only.

Deployment comparison adds ordinary omitted bindings and deployment fields. Native
fixtures directly cover vectorize, AI, browser, images, version metadata, Analytics
Engine, mTLS and email binding changes/removals. D1 migration glob patterns and
directories resolve to their source locations despite generated rewrites. Cron
absence and explicit empty lists canonicalize equally; nonempty changes reject.
Compiled entrypoints and bundle settings intentionally differ from source config;
this comparison does not authenticate every compiled module graph or source entry.

Verification:

- Focused shared integration: **107 passed / 7 files** before adding the Cron
  regression; `/tmp/cossack-aux-combined-focused.log`.
- Full final framework: **1,874 passed / 101 files**, `--maxWorkers=2`;
  `/tmp/cossack-aux-framework-complete.log`, terminal status 0.
- Native generated multi-Worker warning build, deployment dry run and deliberate
  auxiliary hard-limit failure: **1 passed, 6 filtered skips**;
  `/tmp/cossack-aux-native-repaired.log`. The private tool capture proves the hard
  failure was `COSSACK_BUILD_BUDGET_EXCEEDED`; no values appeared in JSON.
- First combined affected CLI: **64 passed / 6 files**;
  `/tmp/cossack-aux-cli-complete.log`. Final review found the dry-run early return
  before the post-primary-measurement recheck. It was repaired and a source-mutation
  regression added; focused deploy **11 passed**, `/tmp/cossack-aux-final-recheck.log`.
  Final combined CLI: **65 passed / 6 files**, including all seven native cases;
  `/tmp/cossack-aux-cli-final.log`, terminal status 0.
- Root `pnpm tsc --noEmit`, framework package types, declaration emission, changed
  JS/helper syntax and owned diff whitespace checks pass. Logs:
  `/tmp/cossack-aux-{build-repaired,final-types}.log`.
- Initial native attempts `/tmp/cossack-aux-native.log` and
  `/tmp/cossack-aux-native-debug.log` failed `COSSACK_DEPLOY_TARGET_MISMATCH` on
  empty Cron defaults. Native Vite output includes `triggers.crons: []`, whereas
  project Wrangler can normalize an absent field to `{}`. Canonicalization and a
  native regression repaired this; the successful rerun is recorded above.
  Debug capture is private mode 0600 at `/tmp/cossack-aux-native-private-tool.log`;
  it can contain fixture binding values and must not be published.
- Repacked installed auxiliary acceptance initially passed
  `/tmp/cossack-aux-installed.log`. That CLI predates the final dry-run recheck;
  final repaired-package acceptance is recorded separately below.

Limits: auxiliary redirects continue to disable signed receipt reuse. Successful
CLI builds receive fresh measurements and may repeat the plugin's work. Failed
Vite auxiliary builds retain generic compiler/build envelopes; no unauthenticated
auxiliary receipt is trusted. No auxiliary Worker upload is implemented. No remote
upload/provisioning, publication, push, fresh full agent-docs gate, full CLI suite,
or non-Desktop release matrix occurred at this checkpoint. Native wider-graph,
provider startup, DEV failure, production source-map and remote log acceptance
remain open. No local progress is blocked.

Final repaired-package acceptance: `/tmp/cossack-aux-installed-final.log`, terminal
status **0**. Runs the installed auxiliary-only multi-Worker warning/build/deploy
validation and hard failure helper, then the installed primary startup/custom
source config, signed receipts, explicit Vite options, public SSG URL discovery
and prompt watch rejection helper. Retained fixture:
`/tmp/cossack-local-pack-gZdSQv/minimal-production`, Vite **8.3.2**, Wrangler
**4.147.0**. Final tarballs are
`/tmp/cossack-aux-tarballs/framework-aux-0.8.3.tgz` and
`/tmp/cossack-aux-tarballs/cli-aux-final-0.8.3.tgz`.
This is focused repacked acceptance with unchanged dependency tarballs, not a
fresh full installed agent-docs gate or release matrix.

<a id="codex-runtime-receipt-identity-2026-10-05"></a>
## Codex primary receipt runtime identity and bounded inventories (2026-10-05)

Author: **Codex**. The dependency audit found that startup receipt reuse bound
Wrangler but omitted the external Miniflare/workerd runtime producing its profile.
An exclusive implementation agent owned the new private inventory helper/tests,
then the receipt regression file. A separate read-only agent reviewed identity,
resource limits and malformed receipt handling. The coordinator reviewed and
integrated all changes, fixed shared APIs and native regressions, and owns final
verification. No source ownership collisions occurred.

Primary fingerprints now resolve Miniflare from Wrangler and workerd from
Miniflare, hash their manifests/entrypoints and the native package/executable,
and bind runtime override/autogate settings. Standard package resolution must
agree with workerd's selected executable. Only absolute regular nonsymlink
executable overrides are supported; bare/relative/empty overrides and downloaded
fallbacks decline reuse. Unsupported identities retain fresh measurement after
successful builds; failed builds do not run measurement again.

The private helper bounds artifact/source files to 4,096 files/64 MiB, metadata
files to 1 MiB, traversal to 4,096 directories/8,192 entries, and tool/runtime
identity files separately to 256 MiB. Checked descriptors and file/directory
metadata plus entry lists detect changes during traversal. All regular files
remain hashed in native traversal order. Empty subtrees contribute no modules
and no fingerprint entries, but retain traversal bounds/race checks; files added
there change the digest and populated ancestor entries. Primary redirects are
read through a bounded regular descriptor before parsing. Atomic HMAC storage
remains private, invocation-bound and numeric-only.

Missing/malformed fingerprints cannot match an unsupported inventory. Partial
configured upload/gzip evidence is rejected before signing and when reading;
missing configured values are never reconstructed as zero. Unconfigured size
counterparts remain irrelevant to evaluation.

Review and repair evidence:

- Initial agent inventory run: 30 passed / 1 timed out on the 4,096-file filesystem
  boundary case. That case received a local 20-second allowance; all 31 then
  passed. Subsequent coordinator tests add directory/runtime caps and overrides.
- First integrated focused run: **67 passed / 2 files**;
  `/tmp/cossack-receipt-runtime-focused.log`.
- First full framework run: **1,921 passed / 102 files**;
  `/tmp/cossack-receipt-runtime-framework.log`. Further malformed-evidence and
  empty-directory regressions were added afterward; final results follow below.
- First affected CLI run: **61 passed / 4 failed / 6 files**;
  `/tmp/cossack-receipt-runtime-cli.log`. Native reuse declined because Wrangler
  creates empty `dist/ssr/.wrangler/tmp` directories during dry runs. Fingerprinting
  their names invalidated before/after identity despite unchanged modules.
  Coordinator repaired empty-subtree handling and added a regression proving
  that later file additions still invalidate identity. Independent read-only
  review found no omitted regular files or weakened race/cap checks.
- Repaired native acceptance: **3 passed / 4 filtered skips**, terminal status 0;
  `/tmp/cossack-receipt-runtime-native-repaired.log`. Verifies structured hard-limit
  failure, successful build/deploy size reuse, and startup reuse without a second
  CLI measurement. Filtered cases are not claimed as passed in this run.

Limits: this checkpoint hardens existing primary receipts. It does not implement
authenticated aggregate receipts or auxiliary uploads, expand supported module
graphs, or identify every transitive tool dependency. Local startup timings remain
machine/profiler dependent and do not establish provider startup/production CPU
limits. Native evidence is Linux only; Windows/macOS runtime execution is not
verified. No remote upload/provisioning, publication, push, full CLI package suite,
fresh full installed agent-docs gate or non-Desktop release matrix is claimed.
CF-08 stays open; **30 complete / 28 open**. Desktop remains complete by user
decision, with its platform checks waived. No local progress is blocked.

Final verification for this batch:

- Framework **1,926 passed / 102 files**, `--maxWorkers=2`, terminal status 0;
  `/tmp/cossack-receipt-runtime-framework-final.log`.
- Affected CLI **65 passed / 6 files**, including all seven native cases,
  terminal status 0; `/tmp/cossack-receipt-runtime-cli-final.log`.
- Root `pnpm tsc --noEmit`, framework noEmit, declaration emission, emitted
  helper syntax and owned diff checks pass. Logs:
  `/tmp/cossack-receipt-runtime-{root-types,framework-types,build-final}.log`.
- Changed-package installed acceptance passes, terminal status 0;
  `/tmp/cossack-receipt-runtime-installed-final.log`. Runs the primary startup,
  custom-source, build/deploy receipt, explicit Vite options, public SSG URL and
  watch rejection helper once against the final package. Retained fixture:
  `/tmp/cossack-local-pack-gZdSQv/minimal-production`, Vite 8.3.2 / Wrangler
  4.147.0. Final framework tarball:
  `/tmp/cossack-runtime-receipt-tarballs/framework-runtime-final-0.8.3.tgz`.
  CLI/dependency packages were unchanged; this is not a fresh full installed gate.

User-directed strategy change: defer further CF-08 budget expansion unless it
closes a required criterion. Next batch targets full RT-12 and RT-27 acceptance,
with exclusive implementation ownership and one combined verification run.

<a id="codex-rt12-rt27-complete-2026-10-05"></a>
### Codex: RT-12 and RT-27 completed acceptance (2026-10-05)

Author: Codex. Three implementation agents owned separate core lifecycle,
CLI/localization and generated runtime fixture files. Codex reviewed and integrated
shared command/MCP schemas, global declaration typing and SSR/SSG locale scopes.

RT-12 acceptance:
- Concurrent requests retain separate context/user/env facilities across awaits.
  Decorated inherited layouts, constructor/property injection, nested same-token
  shadowing and stable service slots match static inspection declarations.
- Missing injection diagnostics identify the requester, active owner source paths,
  available declarations and corrective Page service declaration.
- Layout departure disposes owned services once; SSR and explicit service RPC
  await asynchronous cleanup. A deliberate failing native hook does not prevent
  sibling/ancestor hooks. Throwing onDispose getters now also preserve cleanup.
- Existing navigation/SSE/WebSocket ownership checks pass together with the new
  concurrent SSR/RPC and runtime metadata assertions in both generated production
  Node and Cloudflare apps. This uses a synthetic identity provider, not real auth.

RT-27 acceptance:
- One compiler-based service handles literal/global/imported/aliased/re-exported
  calls and locations, dynamic-key/parameter uncertainty, missing/unused keys,
  placeholder mismatches, plural contracts and fallback locale diagnostics.
  Project modules never execute; JSON omits catalog text.
- lang extract/check/types use versioned CLI envelopes and exit status; read-only
  MCP localization inspection shares the same model. Dry-run types writes nothing.
- Generated augmentation of the published core root rejects unknown keys, missing
  parameters and wrong plural count types through imported and bare global __.
  Apps without a generated registry retain intentional string keys.
- Scoped catalog/default metadata replaces global SSR/SSG seeding. Parallel SSR
  with different environment defaults and parallel SSG with different catalogs
  (including the same locale name) retain their own locale, fallback and hydration.

Final verification:
- Core affected combined suite: 100 tests / 6 files passed.
- Framework combined config/SSG/localization suite: 87 / 8 passed.
- CLI localization and static ownership: 45 / 3 passed; MCP: 19 / 1 passed.
- Generated production ownership: 2 passed (Node, Cloudflare); the other 62 tests
  in that file were not selected, not reported as passed.
- Root pnpm tsc --noEmit and core/framework package checks passed. Core build and
  framework declaration build passed; modified CLI/helper JS syntax passed.
- Packed changed core/framework/CLI once and installed into the retained fixture.
  scripts/verify-localization-tooling.mjs passed against actual installed tarballs,
  including generated published imported/global type acceptance. No unchanged
  installed budget/documentation gates were rerun.
- Initial integration tests caught a test syntax error, incorrect config factory
  fixture shape and minified HTML quoting assertion; these were repaired. Required
  types caught fixture implicit-any/unknown JSON typings; the corrected checks pass.
  An initial MCP run overlapped framework dist replacement and failed 8 tests;
  the stable-build isolated MCP run passed all 19. This was test orchestration,
  and is not evidence for running consumers during future builds.

Logs: /tmp/cossack-completion-{core-combined,framework-combined,cli-final,mcp,native,installed,root-types,core-types,framework-types}.log.
Retained fixture: /tmp/cossack-local-pack-gZdSQv/minimal-production.
Tarballs: /tmp/cossack-completion-tarballs/{core,framework,cli}.tgz.

Limits: no full release/every-package suite, remote deployment or provider startup
was run in this batch. Those remain REL-03/Cloudflare work; they are not missing
RT-12/RT-27 acceptance. Desktop checks remain waived by user decision. Localized
SSG route variants remain RT-22. Runtime transport/auth criteria remain RT-01/RT-11.
Release count: 32 complete / 26 open; versions remain 0.8.3 until REL-04.

<a id="codex-rt21-rt29-complete-2026-10-05"></a>
### Codex: RT-21 and RT-29 completed acceptance (2026-10-05)

Author: Codex. Two agents owned separate SSG entry and plugin files; a third
owned test-utils and its docs. Codex integrated renderer root lookup, native
helper fixtures, lockfile changes and installed verification scripts.

RT-21 criteria proven:
- Structured mixed-route outcomes include source, parameters, output, duration,
  render/skip/failure status and fixed diagnostic cause. All parameter records
  and output collisions are validated before any renderer call. Render failures
  clear the publication batch; protected output fails with source context.
- Enabled production config rejects missing/misordered required compiler plugins
  early and fails on missing route manifests. Disabled/development setup is allowed.
- Real Vite production fixtures prove public HTML, referenced hashed client assets,
  sitemap/routes and reports; invalid params, duplicate outputs and protected
  output prevent partial HTML/sitemap. Fixtures use a Vite root different from cwd.
- Installed generated Cloudflare application builds through its actual Vite,
  Cloudflare plugin and Wrangler baseline, publishing static HTML, hydration,
  existing client scripts, correct public sitemap URL, report and Worker config.

RT-29 criteria proven:
- createServerApp injects the actual fetch contract and uses real Request and
  production component/service RPC envelopes. authFixture attaches credentials;
  it grants no access or alternate policy. Helpers keep runtime packages independent.
- Browser helpers use createInstance/bootstrap with typed state/props and DI scope;
  hydration/actions match core rendering. Awaitable, idempotent unmount cleans
  component/service hooks and DOM even on bootstrap/constructor/cleanup failure.
- Generated production Node and workerd fixtures use helpers against the same
  real application tested by Chromium. Policies deny Bob and allow Alice; parallel
  service RPC retains user/request facilities and awaits cleanup once; production
  hydration and subsequent browser RPC mutation agree. Client JS/maps omit the
  server-only sentinel. Test identities are synthetic, not real authentication.
- Published browser/server exports import without source aliases, deferred and
  hydration/credential helpers execute, and strict installed declaration consumers
  accept valid requests and reject missing route identity/wrong deferred values.
  The package has its own 17-test suite in the existing root unit workflow.
  Docs explicitly state what DOM simulation cannot prove and preserve native tests.

Final checks: framework SSG combined **105 tests/8 files**, test-utils **17/3**;
generated production helper **2 passed** (Node/Cloudflare), 64 unselected tests
not claimed passed. Root pnpm tsc --noEmit, framework/test-utils package checks,
framework declaration and test-utils builds passed. JS syntax and owned diff checks
passed. Installed verify-test-utilities.mjs and verify-ssg-release.mjs passed.

Initial native helper run failed because the verifier used CommonJS resolution
for import-only exports. Corrected to Node ESM resolution; both final cases pass.
The agent added a constructor-failure cleanup fix after the first test-utils build;
only that package was rebuilt/repacked to bind installed evidence to final code.
No unchanged installed gates or broad release suite were rerun.

Logs: /tmp/cossack-rt21-combined.log, /tmp/cossack-rt29-combined.log,
/tmp/cossack-rt29-native-final.log, /tmp/cossack-rt29-installed.log,
/tmp/cossack-rt21-installed.log, /tmp/cossack-rt21-29-root-types-final.log,
/tmp/cossack-rt21-29-framework-types.log, /tmp/cossack-rt29-types-final.log.
Tarballs: /tmp/cossack-rt21-29-tarballs/framework.tgz and test-utils-final.tgz.
Installed root: /tmp/cossack-local-pack-gZdSQv/minimal-production.

Limits: no remote deployment or complete release suite; other tasks retain those
criteria. SSG report rendering success does not imply publication after a later
failure. Node-only server helpers do not emulate Workers; actual workerd/browser
checks remain required. Desktop platform checks are waived by user decision.
Release: 34 complete / 24 open. Versions remain 0.8.3 until REL-04.


<a id="codex-rt20-rt24-complete-2026-10-05"></a>
## Codex: RT-20 and RT-24 complete (2026-10-05)

Author: **Codex**. Both tasks meet their original full acceptance criteria.
Three implementation agents owned renderer/config diagnostics, native config
fixtures/docs, and native hydration fixtures/docs independently. Codex reviewed
all changes, owned shared APIs/compiler/router integration and final verification.
User changes reports.md and .zcodeignore remain untouched and outside this commit.

RT-20 acceptance:
- Intentional static/dynamic text, structural and hydrated public-state shape
  mismatches report categories, component ownership, relative source positions,
  DOM paths and explicit field paths. Values and absolute paths stay out of logs.
  Tests cover nested asynchronous boundaries and intentional client-only suppression.
- Native Chromium verifies retained SSR button/nested nodes, no baseline or normal
  update warnings, one click effect, exactly one consumed server resource load,
  and retained layout service state/identity through navigation.
- Production client HTML/JS contains neither diagnostic code, development source
  metadata nor absolute project paths. Consumer-selected DEV survives the library
  build; the same checks pass in fresh apps installed from final tarballs.
- Fixed actual nested SSR/client wrapper disagreement, production source lookup,
  compiler Unicode offsets and false warnings on ordinary reactive updates.
  Compiler tests preserve class text in literals/comments and handle aliased bases.

RT-24 acceptance:
- Actual generated registry rejects misspelled paths/wrong inferred default types.
- Native Node and Deno reject missing variables/bindings and invalid scalar/binding
  shapes before factory or page use. Server events name requirements with approved
  fixed codes; public HTTP errors stay generic. Forged errors and accessors cannot
  inject arbitrary exception text into the logger.
- Interleaved alpha/beta SSR and RPC use isolated environment/config scopes;
  browser hydration and private config reads never publish test secret values.
- CLI catalogs inspect declarations without running factories or reading arbitrary
  dotenv/process values. Node/Deno --check explicitly returns
  COSSACK_CONFIG_CHECK_UNAVAILABLE. Production hosts supply values; development
  adapters load their documented dotenv sources. Local object-shape validation
  does not prove remote connectivity. Prior installed Cloudflare/workerd acceptance
  remains the Cloudflare evidence; unchanged gates were not rerun.
- Fresh installed Node/Deno builds/types/catalogs/SSR/RPC/browser and production
  JS/source-map scans prove private values, factory sentinels and private requirement
  metadata stay excluded. Secret classification is not automatic data tainting:
  intentional application publication remains the author's responsibility.

Final verification:
- pnpm --dir packages/renderer exec vitest run: **343/25**.
- pnpm --dir packages/core exec vitest run: **1,587/100**.
- Framework config-diagnostics/config-requirements/config/config-inspection/
  ssg-config/hydration-source-metadata combined: **147/6**.
- CLI hydration-diagnostics-runtime: **3/3** (parser + Node development/production).
- CLI config-release-acceptance with actual Deno 2.9.6: **2/2** (Node/Deno).
- COSSACK_HYDRATION_INSTALLED_ROOT=/tmp/cossack-local-pack-gZdSQv/minimal-production
  pnpm --dir packages/cossack exec vitest run tests/hydration-diagnostics-runtime.test.js
  --maxWorkers=1: **3/3**, bound to final renderer/core/framework tarballs.
- COSSACK_DENO_BINARY=<verified local binary> node scripts/verify-config-release.mjs
  /tmp/cossack-local-pack-gZdSQv/minimal-production: installed **Node and Deno pass**.
- pnpm tsc --noEmit and renderer/core/framework package typechecks: pass.
  Renderer/core builds and framework build:types: pass. JS syntax and owned diff
  checks: pass. Native suites ran sequentially; dist was stable during consumers.

Earlier failures were fixed, not waived: malformed fixture, unconsumed loader,
missing production server build and RPC Origin; actual wrapper/source/Unicode/
normal-update defects described above. The first installed attempt ignored local
workspace override policy and resolved an old transitive core; corrected install
uses the app's override file. Test installs disable lifecycle scripts explicitly;
all required built runtime/browser behavior subsequently executed successfully.
Only changed final renderer/framework were repacked after fixes; core was unchanged.

Logs: /tmp/cossack-rt20-renderer-verified-suite.log,
/tmp/cossack-rt20-core-final-suite.log,
/tmp/cossack-rt20-24-framework-final-suite.log,
/tmp/cossack-rt20-native-final-acceptance.log,
/tmp/cossack-rt24-native-final.log,
/tmp/cossack-rt20-installed-verified.log,
/tmp/cossack-rt24-installed-verified.log,
/tmp/cossack-rt20-24-verified-root-types.log.
Tarballs: /tmp/cossack-rt20-24-tarballs/core.tgz, renderer-final.tgz,
framework-final.tgz. Installed root: /tmp/cossack-local-pack-gZdSQv/minimal-production.

Limits: state comparison is a bounded development initializer-shape hint, not
runtime type validation; nullable/custom classes are skipped. No full release
matrix or remote deployment/log ingestion/resource existence was claimed. Those
criteria remain under other task IDs. Desktop checks are waived by user decision.
Release: **36 complete / 22 open**. Versions remain 0.8.3 until REL-04. No blocker.

<a id="codex-rt16-rt22-complete-2026-10-05"></a>
## Codex: RT-16 and RT-22 completed acceptance (2026-10-05)

Closed both parent tasks against their full archived criteria. Three implementation
agents owned separate database plans, Markdown metadata, and generated acceptance
files. Codex reviewed all changes and integrated exports, tooling, route/locale
scopes, canonical publication and final verification. No Desktop work was reopened.

RT-16: Declarative migration/seed operations are authoritative for preview and
execution. Plans include direction, ordered SQL, risks, affected objects and their
completeness, bookkeeping, target identity, atomicity and provider limitations.
Callbacks are never invoked by planning and explicitly produce incomplete plans.
SQLite tests compare file bytes, application rows, history and generated files
before/after planning. Exact returned plans bind to the live runner/connection,
recheck definitions (including parameters) and full history, and apply detached
snapshots. Tests cover changed/already-applied status, legacy checksums, reversal,
squash consolidation/partial-history rejection, foreign/stale plans, mid-apply
mutation, SQL failure/rollback, transaction requirements and dialect limits.
Actual local D1 applies/reverts the reviewed declarative plan. Target metadata uses
own data descriptors and a bounded field whitelist; secrets/getters are excluded.
Generated migrations and seed dry-runs use the same declarations/plan service.

RT-22: Public frontmatter types and explicit extension validators reject wrong or
unknown metadata with file/line/column diagnostics without rejected values.
The shared routing model preflights Markdown/TypeScript, parameterized and alias
output collisions before publishing HTML. Authored locale scopes override visitor
preferences for content and remain isolated through async work. Real generated
Node Vite builds produce English/French Markdown and parameterized TypeScript
pages with correct language, metadata, links and active hydration catalogs.
Aliases reuse canonical HTML once; canonical links are unique and the sitemap
contains four canonical URLs for five output pages. Installed public imports and
positive/negative author-facing type contracts pass from fresh tarball apps.

Final verification (source stable before builds and checks):

- `pnpm --dir packages/database exec vitest run`: **104 tests / 17 files passed**,
  including actual SQLite, local D1, tooling JSON/dry-run and provider limitations.
- Framework targeted combined run: **108 tests / 8 files passed**, covering
  metadata/types/processor, localization, SSG entry/rendering, sitemap and Vite SSG.
  Additional existing config/public-route/service scope regressions: **42 / 3**.
- `pnpm --dir packages/cossack exec vitest run tests/markdown-release-acceptance.test.js --maxWorkers=1`:
  **6/6 native generated-app checks passed**.
- The same command with `COSSACK_MARKDOWN_INSTALLED_ROOT=/tmp/cossack-local-pack-gZdSQv/minimal-production`:
  **5 installed behavior/type/rejection cases passed**; the fixture-source parser
  exceeded its initial five-second timeout while installing. After giving it the
  same 180-second fixture allowance, `-t 'writes parseable'` passed **1/1**; the
  five unchanged cases were skipped on this focused retry, not rerun or waived.
- `node scripts/verify-database-plans.mjs /tmp/cossack-local-pack-gZdSQv/minimal-production`:
  installed public types, unchanged planning bytes, unknown-callback rejection,
  selected SQLite apply/revert, parameter secrecy, seed commit/rollback and stale
  migration-plan rejection passed.
- Framework `build:types`, database `build`, database `audit:bundle` (29 neutral
  modules and Workers-safe Cloudflare entry), framework/database `tsc --noEmit`,
  required root `pnpm tsc --noEmit`, script syntax and owned diff whitespace passed.

Only changed framework/database runtime packages were packed, once after their
final runtime fixes, into /tmp/cossack-rt16-22-tarballs/{framework,database}.tgz.
Packing disabled lifecycle scripts because equivalent build/test/audit evidence
was collected explicitly. Gate installation and each fresh Markdown application
use their local override policy and disable install scripts; actual Vite/runtime
execution then passes. No unchanged hydration/config packages were repacked.

Logs: /tmp/cossack-rt16-database-final-suite.log,
/tmp/cossack-rt22-final-combined.log, /tmp/cossack-rt22-scope-regressions.log,
/tmp/cossack-rt22-native-final.log, /tmp/cossack-rt22-installed-final.log,
/tmp/cossack-rt22-installed-parser.log, /tmp/cossack-rt16-installed-final.log,
/tmp/cossack-rt16-bundle-audit.log, /tmp/cossack-rt16-22-final-root-types.log,
/tmp/cossack-rt22-framework-final-types.log, /tmp/cossack-rt16-database-final-types.log.

Limits: no remote Cloudflare database or live PostgreSQL/MySQL server was used.
PostgreSQL/MySQL evidence covers dialect/driver policies, not production rollback;
MySQL DDL explicitly warns of implicit commits. Raw SQL object/risk inference is
conservative; bound values are private, authored SQL literals remain visible.
JSON plans cannot be imported for execution; CLI apply checks current definitions
rather than accepting prior JSON. External callback effects remain application
owned. Static aliases are copies, not runtime redirects. Default translation
fallback catalogs may appear in hydration; active locale/body do not leak.
Broader RT-15, CLI-08 and REL-02/03 provider/documentation/release gates stay open.
Desktop checks are waived by user decision, not passed.
Release: **38 complete / 20 open**. Versions stay 0.8.3 until REL-04. No blocker.

<a id="codex-rt10-rt15-rt17-complete-2026-10-05"></a>
## Codex: RT-10, RT-15 and RT-17 full acceptance (2026-10-05)

Three exclusive implementation owners handled form bindings, database runtime DX,
and generated form/Studio acceptance. Codex reviewed their code and integrated
public APIs, schema/provider fixes, shared tooling, Studio rendering and installed
checks. Existing reports.md and .zcodeignore were preserved. Desktop was not reopened.

RT-10: Core exposes typed observable controller state and accessible native
bindings, UI exposes the same bindings through Input/Checkbox/Form props. Numeric
array paths retain field types and reject unsafe indices. Owned subscriptions and
refs synchronize file/multi-select reset and dispose correctly. Real generated
Node and workerd apps, with Chromium, prove keyboard submit, stable label/error
associations, first-invalid/summary focus, nested server and form errors, edits and
resubmit, coerced checkbox/numeric data, real File bytes over multipart HTTP RPC,
stale async validation and held server responses, single-flight double submit,
values/errors/touched/dirty reset and file clearing. Positive/negative public types
reject invalid paths/values and preserve parsed submit result types. Explicit public
return interfaces prevent excessive generic declaration expansion without weakening
the type contract. Application owners dispose bindings/subscriptions; resetting a
form does not roll back a server effect already started.

RT-15: Detached finalized metadata excludes classes/hooks/default values and names
both relationship ends. Invalid relationship fields name entities/properties.
Query diagnostics retain bounded SQL structure/duration/provider/outcome with
redacted parameters/literals/comments and fixed failure codes; observers cannot
change query/transaction success. Simple entity pages append primary-key tie
breakers, offset-only SQL is dialect-valid, and count/aggregates restore the original
window. Joined/projected/grouped/distinct pages require explicit unique ordering;
keyset pagination uses existing predicates/orders. Capability reports distinguish
interactive/nested/batch transactions, DDL rollback, schema/generated values,
returning/reservation/cancellation and limits. Unsupported identities/arrays,
parameter limits, transaction modes and queued schema alterations fail before
effects. Queues render every operation before publishing any DDL. Native SQLite,
embedded Turso, PostgreSQL 18 and MySQL 8 prove generated keys, commit, rollback and
nested savepoints. Acceptance exposed and fixed MySQL prepared SAVEPOINT commands,
Turso transaction handle/RETURNING labels and PostgreSQL/MySQL generated DDL.

RT-17: Database owns the shared versioned read-only inspection service used by
`cossack schema inspect --json` and Studio. It reports schema/model/relationship
facts, capabilities, bounded target identity and migration applied/changed/pending
status/full history, omitting column default values and private connection extras.
Real SQLite fixtures compare shared service, CLI, Studio project and Studio schema
payloads; bytes remain unchanged and no migration bookkeeping is created. Exact
named environment selection is passed read-only, known mismatches fail before
inspection, and existing D1 tests reject named-environment top-level fallback.
Owned temporary connections close on success, inspection failure and construction
failure; borrowed local Studio connections keep their owner. Remote Studio uses the
application's orm.config.ts adapter factory and checks explicitly selected binding.

Verification after integration:

- Core `vitest run`: **1,595 tests / 101 files passed**.
- Database `vitest run`, with COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL
  pointing at task-owned isolated loopback servers: **123 / 20 passed**. Native
  provider acceptance **6/6, zero skips**, including four actual drivers and two
  pre-effect rejection cases. Final default-omission inspection retry **6/1 passed**.
- Studio `vitest run`: **69 / 12 passed**. Final shared-inspection affected retry
  **6/1 passed**. Studio package typecheck passed after annotating the deliberately
  invalid model with @ts-expect-error.
- UI combined run initially had **639 passed / 1 failed** while an unfinished old
  declaration compiler was still writing dist. The coordinator stopped that compiler,
  emitted/re-wrote stable Core/UI declarations, then reran only affected published
  DataTable types and new form bindings: **6/2 passed**. Other runtime checks were
  unchanged. No claim that the initial UI run passed.
- CLI command/spec/contracts/database combined run: **169 passed / 6 failed**;
  those six assertions expected legacy Vite spawn rather than the existing safe
  project-local Node/Vite command. Accurate command/args/cwd/env/shell/JSON assertions
  were repaired; affected dispatch run **50/50 passed**. The other three files passed
  unchanged; the complete combined command was not repeated.
- Native `vitest run tests/form-controller-release-acceptance.test.js --maxWorkers=1`:
  parser and Cloudflare browser passed; Node initially lacked its explicit SSR build.
  After correcting only that harness branch, focused Node retry **1/1 passed**,
  two unchanged cases filtered. The earlier deliberately interrupted run supplies
  no acceptance evidence.
- Same form command with COSSACK_FORM_INSTALLED_ROOT set to the fresh installed
  gate: **3/3 passed**, including both browser runtimes and public type fixtures.
- `node scripts/verify-database-inspection.mjs <gate>`: actual installed SQLite
  generated keys/paging, diagnostics privacy, metadata/capabilities, unchanged bytes,
  no bookkeeping, CLI/Studio parity and positive/negative public types passed.
  Harness-only initial retries corrected ESM import resolution and the fixture's
  project/dependency manifest; no runtime repack was needed.
- `node scripts/verify-form-bindings-types.mjs <gate>`: installed Core/UI public
  binding imports and positive/negative field/value/result/FormProps types passed.
- Required root `pnpm tsc --noEmit` and Core/UI/database/Studio package typechecks
  passed. Core runtime build/declarations, UI runtime build plus final declaration
  emit/rewrite, database build, Studio server/client/SSR builds and database bundle
  audit passed. Audit: **32 neutral modules; Workers-safe Cloudflare entry**.
  Owned diff whitespace and helper syntax checks passed.

Final changed Core/UI/database/Studio/CLI packages were packed once to
/tmp/cossack-rt10-15-17-tarballs with lifecycle scripts disabled because the equivalent
checks were recorded explicitly. Renderer/framework and other unchanged packages
were reused. The gate is /tmp/cossack-local-pack-gZdSQv/minimal-production; gate and
fresh form apps preserve local pnpm override policy, install with scripts disabled,
and execute actual production Vite builds/native runtimes. Final installed checks began only after all build/declaration writers exited. Task-owned PostgreSQL/MySQL
servers shut down after verification; existing system services were not changed.

Logs: /tmp/cossack-rt10-core-suite.log, /tmp/cossack-rt10-ui-suite.log,
/tmp/cossack-rt10-ui-final-focused.log, /tmp/cossack-rt15-17-database-suite.log,
/tmp/cossack-rt15-native-providers.log, /tmp/cossack-rt17-inspection-targeted.log,
/tmp/cossack-rt17-studio-suite.log, /tmp/cossack-rt17-studio-final-inspection.log,
/tmp/cossack-rt17-cli-combined.log, /tmp/cossack-form-controller-native.log,
/tmp/cossack-form-controller-node.log, /tmp/cossack-rt10-installed-final.log,
/tmp/cossack-rt15-17-installed-final.log, /tmp/cossack-rt10-15-17-root-types.log.

Limits: provider proof is local SQLite/embedded Turso/PostgreSQL/MySQL, not remote
Cloudflare/Turso or a production server compatibility guarantee. D1 rejection uses
its actual driver with a no-effect mock binding; existing suite retains local D1
execution/selection coverage. MySQL DDL may commit implicitly. Custom capability
and adapter selection declarations remain implementer-owned; unknown target facts
are not guessed. Offset pages can shift under concurrent writes. No opaque cursor
API was added. Shared inspection intentionally omits default values; Studio's richer
row-editor indexes/views/locators are separate extensions. Desktop platform checks
are waived by user decision, not passed. REL-02/03 and CLI-08 remain open for broader
release/doc coverage. **41 complete / 17 open**, versions 0.8.3 until REL-04. No batch blocker.

<a id="codex-svc01-svc05-complete-2026-10-05"></a>
## Codex: SVC-01 and SVC-05 complete (2026-10-05)

Coordinator inspected status, AGENTS, architecture, checklist, plan and handoff.
User reports.md/.zcodeignore were preserved. Three implementation agents owned
separate core jobs, auth verifier and UI widget files; subsequent fixture/guidance
assignments remained exclusive. Codex reviewed/integrated public exports, scaffold,
D1 storage and native Queue acceptance. Desktop was not reopened.

SVC-01 criterion proof:

- `core/jobs` defines inferred payload registries, dispatch and consumer validation,
  explicit bounded JSON tenant/actor context, deterministic local queue/clock and
  Cloudflare producer adapter. No request retention or implicit in-memory durable
  fallback. Tests prove duplicate/concurrent delivery, scope/environment identity,
  delayed dispatch, transient/permanent classification, exhaustion, all cleanup
  hooks, fixed failure inspection, observer/store failure and ownership fencing.
- D1 ledger uses atomic conditional claims, persisted logical attempt counts,
  retry deadlines, token-fenced completion/failure and retained terminal keys.
  Actual SQLite SQL tests close/reopen connections for completion and backoff,
  fence expired owners, and prove inspection never creates schema. Duplicate
  delivery during backoff neither runs handlers nor increments attempts.
- The generated Cloudflare recipe declares producer/consumer, separate JOB_STATE
  migration and JOB_NAMESPACE, without requiring the ORM. A real native workerd
  Queue producer invokes its generated consumer; actual local D1 receipts prove
  deduplication, delayed delivery, explicit actor/tenant and completion across a
  Worker reload, including a fresh module boot identifier. Installed public
  positive/negative payload types compile and the generated Vite app builds.
- Recipe acceptance proves create/add convergence, repeat safety, edited file
  preservation and pre-write unsupported Node rejection. Installed scaffold
  additionally composes jobs, Turnstile and an existing D1 ORM database with
  independent DB/JOB_STATE bindings and private challenge configuration.

SVC-05 criterion proof:

- `auth/turnstile` verifies every submitted token at Siteverify with server-owned
  secret, hostname/action and overall timeout/response/retry bounds. Missing,
  malformed, expired/reused, forged and context-invalid tokens fail closed with
  fixed codes. Unit tests compose validation and prove rejection prevents mutation;
  retries share a server-generated provider idempotency key, not mutation authority.
- UI root publishes typed success/expiry/error callbacks, reset and test-loader
  contracts. SSR is inert; hidden transport fields clear on reset/expiry/failure
  and disposal. Shared official script loading handles failure/retry and independent
  widget cancellation. Generation guards discard stale callbacks.
- Actual Chromium against generated and installed Node/Cloudflare servers verifies
  script failure and keyboard retry, reset, expiry/error, disposal/late callbacks,
  hide/show remount and form resubmission. Missing/forged/expired/reused submissions
  leave the protected counter unchanged; two fresh tokens mutate, and client success
  cannot substitute for server verification. Public type positives/negatives compile.
  Client JS/maps omit secret/provider sentinels, Siteverify and private config paths.
- Scaffold publishes only the site key through server initialization, keeps the
  secret private, composes the validated contact form and declares requirements.
  Auth helper use adds no full-auth/ORM dependency. Local test keys and injectable
  verification are documented. Four package agent guides ship executable examples.

Confirmed terminal checks after integration:

- `pnpm --dir packages/core exec vitest run`: **1,612 / 102 files**.
- `pnpm --dir packages/ui exec vitest run`: **649 / 48 files**.
- `pnpm --dir packages/auth exec vitest run`: **298 / 12 files**.
- `pnpm --dir packages/scaffold exec vitest run`: **153 / 9 files**.
- Framework jobs-d1-store/config-declared-requirements/config-requirements/runtime-capabilities:
  **85 / 4 files**, including five SQL ledger cases.
- CLI command-spec/command-contracts/inspect/config-requirements-inspection:
  **141 / 4 files**.
- Root `pnpm tsc --noEmit` and core/UI/auth/framework package
  `pnpm --dir packages/<name> exec tsc --noEmit`: all pass.
- Core/UI full runtime/declaration builds and framework `build:types`: terminal 0.
  Builds completed before consumers; no full framework deployment/build claim.
- `pnpm --dir packages/cossack exec vitest run tests/jobs-release-acceptance.test.js --maxWorkers=1`:
  **1/1**, final namespace/backoff code; **1/1** again with
  `COSSACK_JOBS_INSTALLED_ROOT=/tmp/cossack-local-pack-gZdSQv/minimal-production`.
- `tests/turnstile-release-acceptance.test.js --maxWorkers=1`: **3/3**
  (parser + Node + Cloudflare), and **3/3** with `COSSACK_TURNSTILE_INSTALLED_ROOT`
  pointing at that gate. Chromium uses injected SDK/Siteverify fixtures.
- Core/UI/auth/framework/scaffold packed once with scripts disabled into
  `/tmp/cossack-svc01-05-tarballs`. Exact tarball overrides were retained in gate
  package.json and pnpm-workspace.yaml; install used `--ignore-scripts` and
  `--config.strict-dep-builds=false`, never `--ignore-workspace`. The unchanged CLI,
  renderer, adapters and other package payloads were reused.
- Four examples extracted from matching installed metadata independently pass
  strict no-path TypeScript compilation and execution: turnstile-server-rejection,
  turnstile-inert-ssr, jobs-duplicate-backoff, jobs-sqlite-ledger-restart. Runner:
  `/tmp/cossack-local-pack-gZdSQv/minimal-production/.svc-guide-acceptance`.
  All 77 catalog guides have examples, 84 examples total. Prior unchanged 80
  examples were not rerun. CLI-08 remains open for broader coverage.

Failures fixed, with evidence kept separate from passing checks: initial queue
fixture passed multiline schema to D1.exec; replaced with the actual migration
API. Closing/recreating a TestHarness loses its nonpersistent local host storage;
Worker reload with fresh boot marker now tests Worker restart, while file SQLite
separately tests connection persistence. Browser fixture initially used ambiguous
status queries and duplicated a private secret as a public binding; corrected
fixture selectors/private .dev.vars. Native remount exposed renderer document
adoption timing; component now resolves the document after synchronous adoption
and its new regression passes. Review found retrying jobs could bypass delay on
redelivery; both ledgers persist the deadline and new backoff/restart regressions
pass. An initial package typecheck invocation was invalid; the corrected explicit
`exec tsc` chain passed. Strict installed guide compilation found closure counter
narrowing; its assertion uses a fresh numeric read. Only changed Core guide metadata
was repacked to `core-guides-final.tgz` and reinstalled; runtime payloads are unchanged,
so native installed checks were not repeated. First smoke runner used require.resolve
for an ESM-only export; corrected to public import, then composition passed.

Logs: `/tmp/cossack-svc-final-{core,ui,auth,scaffold,framework,cli,types}.log`,
`/tmp/cossack-svc01-native-final.log`, `/tmp/svc05-turnstile-native-final.log`,
`/tmp/cossack-svc01-installed.log`, `/tmp/cossack-svc05-installed.log`,
`/tmp/cossack-svc-installed-guides-final.log` and
`/tmp/cossack-svc-installed-scaffold.log`.

Limits: providers are local workerd/Queues/D1 plus file SQLite, not remote account,
resource provisioning or production restart acceptance. Worker reload preserves
host storage; no whole-harness/OS process persistence claim. Challenge provider
responses and SDK are deterministic injected fixtures, not real challenges.
External effects require persisted receipts/provider idempotency; lease expiry
can overlap external calls, and deleting terminal keys removes deduplication.
Generated jobs require Cloudflare; process-local adapters are test infrastructure.
Auth root remains TypeScript-source packaging; no plain-Node root-auth claim.
CF-04/08, CLI-08 and REL-02/03 remain open for broader criteria. Desktop checks
remain waived, not passed. **43 complete / 15 open**, versions 0.8.3 until REL-04.
No batch blocker.

<a id="codex-svc02-svc03-complete-2026-10-05"></a>
## Codex: SVC-02 and SVC-03 completed (2026-10-05)

Closed both parent tasks after coordinator integration/review of three agents with
exclusive implementation ownership. Core owns portable schedule/notification
contracts; framework owns Node-only static inspection and Cloudflare D1/email;
Node owns SMTP; coordinator owns public entries, scaffold, CLI/MCP and integration.
User-owned reports.md and .zcodeignore were preserved. Desktop was not reopened.

### Full criterion proof

**SVC-02:** Named validated JSON schedules dispatch the existing typed jobs.
Generated Cloudflare configuration registers Cron and a native scheduled handler;
actual WorkerHandle.scheduled produces Queue delivery, D1 receipts and asynchronous
job cleanup. Provider duplicates and runOnce share occurrence identity; different
UTC timestamps produce distinct work. Jobs own handler retries; separate schedule
occurrences may overlap. There is no catch-up or promise of automatic Cron
redelivery. Invalid job payloads publish no work; invalid Cron JSON fails actual
Vite build and CLI inspection before exposing private values. Literal job types
and the explicit validated JSON boundary pass positive/negative public type tests.
Static CLI/MCP facts omit payload and actor/tenant scope, preserve authored files,
compare selected environment triggers, and report handler/remote as not checked.
Node/Deno generated recipes reject before writes with an explicit adapter
requirement; the portable API permits explicit external schedulers/dispatchers.

**SVC-03:** Schema-inferred templates and escaped HTML compose email/in-app
channels, preferences at enqueue and delivery, persisted intent and jobs dispatch.
Memory is an explicit process adapter; fenced D1 is optional database integration.
Cloudflare structured email and existing createNodeEmailSender SMTP adapters are
explicit and non-idempotent. Queued/provider-accepted/failed/unknown/delivered are
distinct. Only authenticated matching message evidence may promote accepted email
to delivered. Tests cover escaping, opt-out and preference failures, retryable
pre-accept rejection, recipient isolation/read/unread, stale fencing, restart,
provider capability changes, truthful uncertainty and terminal duplicate suppression.
Preview performs no store/job/provider writes. Actual loopback SMTP returns 450
before DATA, then accepts one DATA for that logical operation; duplicate replay
sends nothing. A second operation drops the connection after DATA acceptance:
status becomes unknown and remains unsent on replay after actual SQLite reopen.
Generated/installed notifications execute actual Queue/in-app delivery with D1
opt-in preferences, tenant/user isolation, read/unread and persistence across
Worker reload. Recipient authorization remains an application responsibility;
the native test supplies trusted test identities, not production auth middleware.

### Commands and verified evidence

- `pnpm --dir packages/core exec vitest run`: **1,665/104 files** passed.
  Subsequent bounded schedule array validation added one regression;
  `... vitest run tests/schedules.test.ts`: **35/35** passed on final code.
  Final notification targeted suite is **19/19**. No claim of a repeated full
  1,666-test run; unchanged full-suite evidence is retained.
- Framework `vitest run tests/notification-email.test.ts tests/notification-d1-store.test.ts`:
  **19/19**. Final `tests/schedules-inspection.test.ts tests/config-build-preflight.test.ts`:
  **23/23** (42 unique framework cases across four files).
- Node adapter full `exec vitest run`: **38/7 files**; scaffold full:
  **160/10 files**. After the generated import fix, scaffold's seven application
  service composition/ownership/schema/preferences cases reran **7/7**.
- CLI `tests/mcp.test.js tests/inspect.test.js`: **34/2 files**, including actual
  stdio MCP schedule inspection/redaction/invalid-definition parity. An extra
  nonexistent command-specs filename matched no cases and is not separate evidence.
- Required root `pnpm tsc --noEmit`: passed, again after the final Core fix.
  Affected Core/framework/Node `pnpm --dir packages/<name> exec tsc --noEmit`:
  terminal 0. Framework reran after the fixture import correction.
- Core full runtime/declaration build, Node full build and framework `build:types`:
  terminal 0. All dist writers stopped before consumers. Core rebuilt once after
  the final inherited-array validation fix, with native consumers stopped.
- Source public schedules acceptance **2/2**, generated notification Queue/D1
  **1/1**, and real loopback SMTP **1/1**. Fresh installed versions of all three
  fixtures pass the same **2/2**, **1/1**, **1/1** respectively:
  ```sh
  COSSACK_SCHEDULES_INSTALLED_ROOT=/tmp/cossack-local-pack-gZdSQv/minimal-production pnpm --dir packages/cossack exec vitest run tests/schedules-release-acceptance.test.js --maxWorkers=1
  COSSACK_NOTIFICATIONS_INSTALLED_ROOT=/tmp/cossack-local-pack-gZdSQv/minimal-production pnpm --dir packages/cossack exec vitest run tests/notifications-release-acceptance.test.js --maxWorkers=1
  COSSACK_NOTIFICATIONS_INSTALLED_ROOT=/tmp/cossack-local-pack-gZdSQv/minimal-production pnpm --dir packages/cossack exec vitest run tests/notifications-smtp-acceptance.test.js --maxWorkers=1
  ```
- Core/framework/Node/scaffold/CLI packed once, scripts disabled, into
  `/tmp/cossack-svc02-03-tarballs`. Exact file overrides in gate package.json and
  pnpm-workspace.yaml; `pnpm install --ignore-scripts --config.strict-dep-builds=false`.
  Other package tarballs reused; no unchanged installed matrix rerun.
- Four examples extracted from matching installed metadata into gate
  `.svc02-03-guide-acceptance` pass strict no-path standalone compilation and
  execution: schedule-occurrence-identity, notification-preview-isolation,
  notification-durable-no-resend, notification-smtp-rejection. Source public
  examples also passed. Catalog now **81 guides / 88 examples**; earlier unchanged
  84 examples were not rerun and CLI-08 remains open for broader coverage.
- Installed public scaffold composes schedules+notifications with one Queue,
  EMAIL binding and Cron registry; repeat additions preserve authored files.
  Installed CLI and actual installed MCP agree on redacted valid facts and reject
  malformed metadata. Smoke runner uses the repository MCP client only as protocol
  harness; server/CLI/scaffold come from installed tarballs.
- `git diff --check -- . ':!reports.md'`: passed before commit.

### Integration failures and fixes

The first generated schedule build resolved extensionless './schedules' to the
JSON file rather than the runtime directory. Generated entry and fixture now use
'./schedules/index'; scaffold regression proves that path. The initial static
inspection fixture linked a nonexistent package-local Wrangler directory;
createRequire resolves its actual package root, then all six cases pass.
Review fixed unsafe array accessors/overridden map in notifications and inherited
array toJSON/extra properties in schedules; regression proves no accessor/schema
or publication side effects. Recovery after earlier provider uncertainty now
retains unknown even after a later rejection, opt-out or provider downgrade;
Memory and actual SQLite tests cover that truthfulness. The first installed smoke
runner used require.resolve for an import-only scaffold entry; a real ESM public
import fixed the runner without changing or repacking runtime packages.

Logs: `/tmp/cossack-svc02-03-{core,framework,node,scaffold,cli}-tests.log`,
`/tmp/cossack-svc02-03-preflight-tests.log`,
`/tmp/cossack-svc02-03-schedules-final-tests.log`,
`/tmp/cossack-schedules-{native,installed}.log`,
`/tmp/cossack-svc02-03-notifications-{native,installed}.log`,
`/tmp/cossack-svc03-installed-smtp.log`,
`/tmp/cossack-svc02-03-installed-guide-types.log`,
`/tmp/cossack-svc02-03-installed-smoke-final.log` and affected type/build logs.

Limits: local workerd/Queues/D1 and file SQLite, no remote account/resource or
production restart proof. Worker reload preserves harness-host storage; SQLite
close/reopen independently proves durable rows. Cloudflare email binding responses
are injected, SMTP binds 127.0.0.1, no external email was sent. Non-idempotent
unknown sends require deliberate reconciliation; terminal-key deletion loses
deduplication. No exactly-once external delivery or automatic Cron retry promise.
Framework schedules syntax is a conservative provider subset; no satisfiable-date
proof. Generated recipes require Cloudflare; other runtimes require adapters.
Desktop checks remain waived, not passed. **45 complete / 13 open**, versions
0.8.3 until REL-04. No batch blocker.

<a id="codex-rt01-rt11-complete-2026-10-05"></a>
## Codex: RT-01 and RT-11 full acceptance audit (2026-10-05)

Completed **RT-01 and RT-11**. Release **47 complete / 11 open**, versions
0.8.3 until REL-04. Original criteria/checkpoints are retained in the
[RT-01 context](./release-0.9.0-plan-archive.md#codex-rt-01-completed-2026-10-05)
and [RT-11 context](./release-0.9.0-plan-archive.md#codex-rt-11-completed-2026-10-05).
No batch blocker. Desktop remains complete by user decision; platform checks
are waived, not passed.

### Criterion mapping

| Task and criterion | Proven behavior and retained evidence |
| --- | --- |
| RT-01 shared HTTP/SSE/WebSocket/service completion, generators, errors, deadlines/cancellation | Existing shared framework conformance matrix, stream handlers and service scopes; relevant combined seven-file suite now 581 passing cases. Preserve [contract matrix](#codex-rpc-conformance-matrix-2026-10-03), [protocol boundaries](#codex-rpc-protocol-boundaries-2026-10-03), [native response timing](#codex-rpc-native-response-2026-10-03) and [per-call deadlines](#codex-rt01-per-call-deadlines-2026-10-05). |
| RT-01 correlation, serialization and inferred yield/final types | Existing [authored types](#codex-authored-rpc-types-2026-10-03), [value paths](#codex-rpc-json-values-2026-10-03), frame/terminal request IDs and inherited contracts remain; current root/affected typechecks pass. |
| RT-01 native disconnect and cleanup | New rpc-disconnect-release-acceptance fixture resets real incoming TCP after the action starts and before any response bytes. Node and direct native workerd each prove four HTTP/SSE component/layout-service cases: native/action abort once, settlement once, timeout/mutation zero, original request cleanup once and independent successful recovery. Parser + Node passed in initial run; final Cloudflare-only run passes one case with two unrelated cases filtered. |
| RT-01 duplicate consumers and lifecycle concurrency | Core 14-case focused file proves one pending restored/fresh owner, saved target rather than forged /state query, no publication/peers before readiness, failure cleanup once/retry, stateless overlapping replacement cleanup, one iterator plus shared completion consumers, duplicate cancel and valid/reserved/throwing socket close. Actual generated Node/Cloudflare Chromium calls dispatch one mutation and clean up once. Actual workerd first joins share init, then closed peers retire; forced eviction and overlapping state reads restore one saved count91 with gets2/inits1. Final installed Core reproduces the full Cloudflare case. |
| RT-11 native cookie/flash behavior, RPC failures and secret-free old input | Preserve [forms](#codex-rt11-forms-2026-10-05), [input](#codex-rt11-input-2026-10-05), [dashboard](#codex-rt11-dashboard-2026-10-05), [flash expiry](#codex-rt11-flash-expiry-2026-10-05) and native cookie/header timing evidence. Generated validation/login/reset/logout/rotation flows and password/token exclusion already passed; these unchanged fixtures were not rerun or reclassified as newly passing. Current session/flash unit tests pass. |
| RT-11 documented concurrent requests/rotation and realtime | New source and installed actual SQLite/D1 request barriers preserve different keys, order same-key last-commit writes, prove auth rotation one winner/cookie, old token invalid, one signed flash consumer and no replay. In-flight revoked work can finish, subsequent auth request fails. Two anonymous bindUser upgrades can create two valid replacement bags: documented application serialization requirement, no atomic upgrade claim. Preserve [SSE](#codex-rt11-sse-auth-2026-10-05), [WebSocket](#codex-rt11-websocket-auth-2026-10-05), [database mutations](#codex-rt11-session-concurrency-2026-10-05), [two-Worker flash](#codex-rt11-cloudflare-flash-claims-2026-10-05) and [bounded process replay](#codex-rt11-process-flash-claims-2026-10-05). |

### Implementation and review

Coordinator owns CossackDurableObject shared runtime. A promise latch admits one
unpublished owner; init and initial persistence finish before component/runtime
publication. Restoration uses persisted config/state without init; /state no
longer bootstraps a second query-selected component. Failed bootstrap/render/init/
persistence disposes once, retry creates a new owner. Idle stateless replacement
awaits old cleanup; first socket acceptance occurs before latch release. Close
acknowledges a reciprocal frame, normalizes reserved local codes and still retires
RPC/delivery state if a terminal socket rejects close.

Three exclusive implementation agents owned disconnect fixtures, concurrency
fixtures/Core regressions, and session fixtures/concurrency guide respectively.
Coordinator reviewed/integrated all changes, ran combined verification and
installed acceptance, and owns architecture/migration/release records. Initial
user-owned reports.md and .zcodeignore are preserved and excluded from staging.

The native fixture first exposed service-entry proxy cancellation suppression;
its direct Miniflare application socket uses compiled modules and generated vars,
DO bindings and flags. Static asset registration is omitted for this pure SSR/RPC
fixture because it redirects direct sockets through a proxy. No Request signal
mock or node_modules patch is used. Initial CF close/eviction attempts failed:
browser sockets remained CLOSING. Official [close-handler documentation](https://developers.cloudflare.com/durable-objects/api/base/)
confirms reciprocal close is required on older compatibility dates and safe with
automatic replies. Fixing the actual handler makes real browser close, zero peers,
eviction and restoration pass; no failing criterion was waived.

### Commands and evidence

- `pnpm --dir packages/core run build`: passes, then repeated once after the
  close-handshake runtime fix invalidated the first build.
- `pnpm --dir packages/core exec vitest run`: initial **1673 /105 files**, final
  runtime **1674 /105 files** pass. Six close regressions were added after that
  full run started; final `vitest run tests/rpc-lifecycle-concurrency.test.ts`
  passes **14** (agent terminal output, not the older five-case barriers log).
  Do not claim a full 1680-case run.
- Framework `vitest run tests/rpc-conformance-matrix.test.ts tests/rpc-stream.test.ts
  tests/router-rpc-stream.test.ts tests/session.test.ts tests/flash-middleware.test.ts
  tests/runtime-websocket-scopes.test.ts tests/runtime-websocket.test.ts`:
  **581 /7 files** pass. After the close fix, affected two socket files rerun:
  **6 /2 files** pass. Other contracts were unchanged.
- `pnpm --dir packages/node-adapter exec vitest run`: **38 /7 files** pass.
- Root `pnpm tsc --noEmit` and Core/framework/node-adapter package
  `exec tsc --noEmit`: pass. Root/Core repeat after final runtime fix, pass;
  agent final Core typecheck with all 14 focused regressions passes.
- `pnpm --filter cossack exec vitest run tests/rpc-disconnect-release-acceptance.test.js`:
  initial parser + Node pass, CF proxy fails. Corrected direct native workerd
  `-t cloudflare`: **1 pass /2 filtered**; Node/parser branches unchanged.
- `pnpm --filter cossack exec vitest run tests/rpc-concurrency-release-acceptance.test.js`:
  Node native browser passes. Final `-t cloudflare`: **1 pass /1 filtered**, real
  close/eviction/concurrent restoration. Prior failed attempts are diagnostic
  evidence, not acceptance.
- `pnpm --filter cossack exec vitest run tests/session-concurrency-release-acceptance.test.js`:
  **2 source native cases** pass. Same command with
  `COSSACK_SESSION_CONCURRENCY_INSTALLED_ROOT=/tmp/cossack-local-pack-gZdSQv/minimal-production`:
  **2 installed native cases** pass. This ran before the unrelated CossackDO
  close fix; sessions/flash use other middleware/DO paths, so proof is retained.
- Core alone packed with scripts disabled, initially core.tgz then core-final.tgz
  after the runtime close fix. Other exact verified tarballs were reused.
  Gate package/workspace overrides use file refs, fresh applications install
  with scripts disabled and prove package realpaths within their node_modules.
  `COSSACK_RPC_CONCURRENCY_INSTALLED_ROOT` pointing to the gate, concurrency
  `-t cloudflare`: **1 installed pass /1 filtered** from final Core payload.
  No unchanged guide catalog, old installed matrix or unrelated package repack.
- `git diff --check -- . ':!reports.md'`: pass.

Logs: `/tmp/cossack-rt01-11-{core-tests,framework-tests,node-tests}.log`,
`/tmp/cossack-rt01-11-core-final-tests.log`,
`/tmp/cossack-rt01-11-framework-final-sockets.log`,
`/tmp/cossack-rt01-11-{root,core,framework,node}-types.log`,
final root/Core types/build logs,
`/tmp/rt01-native-concurrency-cloudflare.log`,
`/tmp/cossack-rpc-disconnect-{native,direct-worker}.log`,
`/tmp/cossack-session-concurrency-native.log`,
`/tmp/cossack-rt01-11-installed-{sessions,concurrency}.log`.

Limits: local workerd/D1/DO and Node SQLite, not live Cloudflare or production
restart acceptance. Wrangler/Miniflare service-entry proxy suppresses incoming
pre-header signal; direct application socket proof does not fix that proxy.
Cancellation is cooperative and is not write rollback or termination of ignored
I/O. Revocation does not undo admitted work. Generic bindUser is non-atomic;
application serialization remains necessary. Signed flash protects integrity,
not confidentiality; Node/Deno claims are process-local and do not survive restart
or span processes. Workers require COSSACK_SSE coordination and fail closed when
unavailable. Scratch session fixture replaces legacy callback migrations with
literal declarative SQL so static plan/apply is provable; generated callbacks
are not newly claimed to have complete static plans. No native Deno interruption
or Desktop execution claim; REL-03 owns the remaining non-Desktop full matrix.

<a id="codex-rt26-complete-svc04-open-2026-10-06"></a>
## Codex: RT-26 completed; SVC-04 native acceptance remains open (2026-10-06)

**Author: Codex.** Continued from `be6a2a52` after checking git status, AGENTS,
architecture, checklist, plan and handoff. Only user `reports.md` and
`.zcodeignore` existed before this batch; they were preserved. Selected independent
RT-26 and SVC-04 implementations, using three agents with exclusive ownership:
local filesystem provider; R2/S3 providers and storage acceptance; Workflow
contracts/native bridge and tests/docs. Coordinator owned Core storage,
exports/builds, image diagnostics, scaffold, inspection, integration and records.
No Desktop work. Versions remain 0.8.3.

### RT-26 criterion mapping — complete

- Portable `core/storage` defines provider contracts and a server authorization
  facade. Every CRUD operation and signed redemption authorizes before provider
  access. Tests deny cross-user reads/writes/deletion and expired/tampered access
  without backend operations. Exact byte counts, size/type/key limits, plain
  metadata and fixed failure messages are enforced. Signing credentials/provider
  closures are not serialized. Signed URLs target an authenticated application
  endpoint; they are not direct bucket presigned URLs.
- Local Node storage uses immutable generations and atomic manifest publication.
  Actual filesystem tests prove reopen persistence, metadata, replacement with
  readers retaining the old generation, concurrent writers, traversal/symlink
  rejection, queued/blocked cancellation and unpublished-file cleanup. Actual
  provider/facade composition proves authorization and signed expiry.
- R2/S3 publish multipart objects only after complete streamed data, with bounded
  5 MiB parts and exact count checks. Tests prove cancellation/mismatch preserving
  old data, metadata and bounded cleanup, including uncooperative stream cancel.
  S3 uses the actual AWS SDK against a loopback HTTP multipart protocol endpoint.
  Native workerd R2 proves authorized CRUD, signed GET/PUT and expiry, denial,
  cancellation preserving the old object, metadata/progress and a 20 MiB streamed
  upload/download. It uses supported compatibility date 2026-07-29; an initial
  newer-date runtime rejection was fixed only in the fixture.
- Public installed imports and strict positive/negative contracts resolve for
  Core Storage, Node LocalStorageProvider and framework R2/S3 factories.
  Installed checks exposed missing `@aws-sdk/client-s3`: it was only a development
  dependency. Promoted it to framework runtime dependencies; lockfile only moves
  its existing 3.1075.0 importer entry. Final imports/types and installed provider
  protocol tests pass. Storage documentation now uses published imports.
- Image diagnostics reject unsupported provider/source/dimensions/quality/fit/
  format with fixed actions, and explain missing transforms and local Cloudflare
  originals. JSON metadata is no longer an image format; invalid fit aliases were
  removed. Migration and architecture notes document these boundaries.

CF-04 remains open for broader real resource selection/provisioning. These tests
use explicitly configured local R2/Workflow bindings and server-owned S3 clients;
they do not claim the unfinished parent resource or observability tasks passed.

### SVC-04 criterion mapping — partial, not complete

Source-verified: typed input/event/identity clients, authorization hooks,
data-only JSON, local retry/backoff/deadline/event/termination tests, native entry
and pure provider module separation, fixed status/error inspection, generated
binding/class/declarations and read-only CLI/MCP/Vite preflight. Generate/add are
idempotent and reject unsupported runtimes before writes. Definitions stay outside
routes; pure server helpers avoid importing `cloudflare:workers` during Node SSG.

Native failures found and fixed without relaxing the criterion:

1. Missing emitted storage modules: broad declaration exclusion overrode includes;
   narrowed it to the legacy demo. Workflow schema uses actual `input` export,
   and explicit `workflows/index` avoids JSON/directory import ambiguity.
2. Native Workflow entry in the server API graph broke Node static generation;
   split pure binding provider from native entry imports. Generated ambient types,
   strict public input/event/inspection proof and actual Vite builds then pass.
3. Cloudflare RPC rejects null-prototype JSON records. Core clones now use ordinary
   records with safe defineProperty, retaining getter/prototype-pollution guards.
4. Native RPC methods reject Function.call/apply/bind access. The bridge now invokes
   `.do()` directly on its receiver; a Proxy regression proves the old path fails.

The strict native waiting-status assertion **still fails**. Actual native status
is running with completed step outputs `[1,2]`; D1 effects show first=1,
retry-attempt=2, and no last effect. Pinned Miniflare defines Waiting but never
assigns it in its implementation. This is event-barrier evidence, not a passing
native waiting-status check. Preserve the strict assertion. No pause/process
interruption/resume/event completion, native permanent failure or installed
Workflow acceptance is claimed: that run stops before those checks. Local tests
and mocked status mapping do not substitute for them. SVC-04 remains unchecked.

The two new failed acceptance files are batch-owned but **not committed**:
`packages/cossack/tests/workflows-release-acceptance.test.js` and
`packages/cossack/tests/fixtures/workflows-acceptance.js`. Preserve them for the
remaining native gate. Verified contracts/bridge/recipe/inspection and source
regressions are included in the batch commit. No upstream module patch or fake
waiting status was introduced. Continue independent release work instead of
repeating this unchanged failing provider barrier.

### Commands, counts and evidence

- Core final build and `pnpm --dir packages/core exec vitest run`:
  **1716 tests /107 files**, terminal 0.
  `/tmp/cossack-rt26-svc04-core-{final-build,combined}.log`.
- Framework relevant combined command (`storage-providers`, `workflows`,
  `workflows-inspection`, `rpc-conformance-matrix`, `ssg-config`,
  `config-build-preflight`): **529 /6**, terminal 0. After the native RPC bridge
  fix, only its affected Workflow file reruns: **3 /1**, terminal 0. Do not claim
  a full 530-case combined run. Logs: framework-combined and
  `/tmp/svc04-framework-workflows.log`. Final framework build: terminal 0.
- Node full suite: **47 /8**, terminal 0. Scaffold full suite: **164 /11**,
  terminal 0. Logs `/tmp/cossack-rt26-svc04-{node,scaffold}-combined.log`.
- CLI `command-spec`, `command-contracts`, `mcp`: **141 /3**, terminal 0;
  new `workflows-inspection`: **2 /1**, terminal 0. Logs cli-contracts and
  cli-combined. No full CLI suite or REL-03 matrix claim.
- Root `pnpm tsc --noEmit`: final terminal 0. Explicit Core/framework/Node
  `exec tsc --noEmit`: terminal 0. Initial Core/Node checks overlapped declaration
  removal during a build and failed missing declarations; reran only those after
  terminal build. Final logs: root-types-final, core-types-final,
  framework-types, node-types-final under `/tmp/cossack-rt26-svc04-*`.
- Source R2 `tests/storage-release-acceptance.test.js`: **1 passed** before adding
  the separate public-import case; `/tmp/cossack-storage-native.log`, terminal 0.
- First installed storage two-case run: native R2 **passed**, public imports
  **failed** missing SDK. `/tmp/cossack-storage-installed-native.log`, exit 1;
  do not summarize the whole file as passing.
- After metadata repair, `COSSACK_STORAGE_INSTALLED_ROOT=/tmp/cossack-local-pack-gZdSQv/minimal-production
  pnpm exec vitest run --root packages/cossack --config packages/cossack/vitest.config.ts
  tests/storage-release-acceptance.test.js -t 'resolves published storage exports'`:
  **1 passed /1 filtered**, terminal 0. The unchanged native R2 case was retained,
  not waived or repeated. `/tmp/cossack-storage-installed-public.log`.
- `pnpm exec vitest run --config /tmp/cossack-storage-installed-vitest.config.mts`:
  **9 installed provider tests**, terminal 0; matched aliases use the installed
  public provider exports/Core identity. Real SDK protocol endpoint is local.
  `/tmp/cossack-storage-installed-providers.log`.
- `pnpm --dir packages/node-adapter exec vitest run --config
  /tmp/cossack-local-storage-installed-vitest.config.mjs`: **9 unchanged installed
  local tests**, terminal 0. Public ESM exports resolve inside the gate pnpm store.
  `/tmp/cossack-local-storage-installed-{tests,resolution}.log`.
- Workflow native strict probe ran repeatedly after actual fixes; latest
  `/tmp/svc04-workflows-native.log` is **exit 1**, not passing. Installed Workflow
  acceptance was **not run**. No requirement was waived to close SVC-04.

Final changed payloads: `/tmp/cossack-rt26-svc04-tarballs/{core,node-adapter,
scaffold,cli}.tgz` and `framework-final.tgz`. Framework was repacked only after
its installed SDK dependency failure invalidated initial metadata. Other payloads
were packed once; unchanged old installed matrices/guides were not rerun. Gate:
`/tmp/cossack-local-pack-gZdSQv/minimal-production`, exact file dependencies and
both manifest/workspace overrides, scripts disabled. Installed all-provider import
proof is native ESM, not private dist traversal; aliased backend tests reuse the
same tested public artifacts.

Limits: local workerd/R2, local filesystem and S3 SDK protocol endpoint, not live
Cloudflare/AWS ownership, deployment, storage service availability or remote logs.
Multipart cleanup is bounded/best effort; completion races can leave a committed
object, never promised rollback. Local storage needs one process and trusted OS
root/parents; no distributed locking, hostile parent replacement or power-loss
claim. Local Workflow adapter is process-only and cannot recover a restart or
forcibly stop authored callbacks. Native durable lifecycle remains the unfinished
SVC-04 criterion. Desktop's remaining platform checks stay waived, not passed.

Completed **RT-26 only**. Release: **48 complete /10 open**. Native Workflow
waiting support/proof is a genuine task blocker; independent work remains.

<a id="codex-cli08-cf04-complete-2026-10-06"></a>
## Codex: CLI-08 and CF-04 completed (2026-10-06)

Release: **50 complete / 8 open**. This batch closes two full acceptance paths,
not another budget or Workflow checkpoint. Three implementation agents owned
separate Core/skills, Framework/adapters/scaffold/test-helper guidance, and
Wrangler provider/tests/docs files. Codex integrated command APIs, resource
application, family inventory, installed acceptance and final fixes. Desktop
remains complete by user decision; remaining platform checks are waived, not passed.

### CLI-08 acceptance

- Offline generated-project discovery returns current installed versions,
  exports, commands, signatures and authored usage. The new `guidanceCoverage`
  inventory lists maintained API families and missing guides separately from
  runtime proof. All 11 maintained package catalogs validate, with **109 guides /
  116 examples**. CLI/MCP catalog results agree with outbound Node networking
  blocked. Discovery does not execute examples.
- **28 new guides/examples** cover Core state, scopes/DI, optimistic uncertainty,
  transport, forms, storage/images, local Workflows, diagnostics, requirements,
  request context/navigation; Framework storage, pure/native Workflow graph
  separation, sessions, HTTP APIs, locale/static plans and private inspection;
  Node storage; complete recipe registries/conflict-safe composition; and test
  helpers. Every new example strictly compiles and executes against public
  installed tarball entries. Browser helper invocation uses jsdom; production
  fetch helper invocation proves its contract with an injected fixture, not a
  substitute for production auth/router acceptance.
- The family inventory checks every literal Cossack import in guide prose and
  source against current public targets. Existing removal/refresh tests remain
  passing. Fixed two UI metadata defects: cross-package `imports` invalidated
  the catalog, and the settings guide omitted its owning root import. Example
  source was unchanged. Native-only imports retain explicit graph requirements;
  available metadata never claims runtime support.
- Non-Desktop skills now use the same tested APIs. Fixed stale inbound Shared
  RPC, implicit undecorated RPC, injected user arguments, computed memoization,
  default old-input retention, missing SSE binding, global user state and typed
  optimistic guidance. Named snippet imports typecheck; two portable examples
  execute. Existing generated compiler/browser/stripping and recipe evidence is
  retained. The full installed CI harness now enumerates additional families and
  all auth examples instead of silently excluding new guide IDs.

### CF-04 acceptance

- `cossack resources plan|apply --account <ID> [--env <NAME>] [--select <JSON>]`
  distinguishes existing selections, unsupported create requests, provider-managed
  Durable Objects and unresolved setup. IDs/names are explicit, bounded and
  cannot be zero placeholders. Default and named environments are pinned;
  inherited `CLOUDFLARE_ENV` cannot redirect either configuration or discovery.
- Authenticated read-only project Wrangler verification checks account membership
  before D1/KV/R2/Hyperdrive identity. Temporary account-only configuration keeps
  app settings and inherited account values from redirecting requests. Raw tool
  output/credentials are discarded, with deadlines/cancellation/output bounds.
  Actual Wrangler **4.114.0** account/D1 JSON runs against an isolated loopback
  Cloudflare protocol fixture; wrong account makes no resource request.
- Queue, Workflow, service and Durable Object remote discovery has precise
  unsupported/manual actions rather than table scraping or guessed readiness.
  Automatic cloud provisioning is explicitly unsupported. This closes the
  selection-or-precise-unresolved-action criterion; it does not claim provisioning.
- Apply requires verified account and every selected resource. It changes only
  local JSON/JSONC references and selected-environment account ownership, preserves comments,
  variables and other environments, rejects stale/serialized plans, and repeats
  unchanged without another write. TOML application requires manual edits.
  Tests cover all eight kinds, wrong accounts, unavailable resources, unsupported
  provisioning, repeated apply and conflicting inherited environments.
- Final installed CLI plan, top-level help and documented public provider import
  pass using the retained generated project and Wrangler **4.147.0** parser. Its
  default environment ignores an unconfigured inherited environment. No real
  Cloudflare/AWS account or resource was contacted or mutated.

### Commands, failures and retained evidence

- Targeted provider **22/22**, plan **13/13**, native-parser/CLI command **5/5**;
  Core/skills **4/4**, other-family **4/4**, family inventory **2/2**.
- Combined CLI integration command selected 17 files: **369 passed / 3 failed**
  of 372. The failures were one five-second creation timeout under contention
  and two obsolete PATH-only Vite fixtures. Fixtures now provide a local Vite
  package/bin, preserve output/environment assertions, and keep each subprocess
  bounded to 20 seconds (three-call creation test allows 65 seconds total).
  **5 affected cases pass**, 49 unchanged matrix cases were filtered. This is
  not a claim that the complete CLI suite passed.
- After the final environment fence/top-level help change:
  `pnpm --filter cossack exec vitest run tests/resource-plan.test.js tests/cloudflare-resource-provider.test.js tests/resource-command-acceptance.test.js tests/command-contracts.test.js tests/dispatch.test.js`:
  **197 passed / 5 files**, `/tmp/cossack-cli08-cf04-final-resource-tests.log`.
  Final account-isolation review then found named apply could overwrite inherited
  root account ownership. Pinning the selected environment fixes it; the actual
  Wrangler-parser regression proves root/production accounts stay unchanged and
  named apply converges. **18 tests / 2 files pass**,
  `/tmp/cossack-cli08-cf04-account-isolation-tests.log`. The unaffected provider/
  contract/dispatch evidence remains valid.
- `pnpm tsc --noEmit`: **exit 0** after final code changes,
  `/tmp/cossack-cli08-cf04-account-isolation-types.log` (final); preceding root
  `/tmp/cossack-cli08-cf04-final-root-types.log` also passed. Core, Framework, Node adapter,
  Scaffold, Test-utils, UI and CLI package typechecks each exited **0**, logs
  `/tmp/cossack-cli08-cf04-<package>-types.log`. No TypeScript source changed
  after those package checks. Lockfile-only offline validation exited **0**.
- Installed guide batch initially found Markdown runtime dependencies wrongly
  listed as development-only. Moved 11 runtime libraries plus public mdast types
  to Framework dependencies; importer-only lock changes preserve all versions.
  No rebuild was needed. The first installed attempt strictly compiled all 28
  and executed the 15 new Core examples before the Markdown import failed.
  The affected 13-guide retry executed 10 before the DOM wrapper's missing
  `NodeFilter`; fixing the wrapper and rerunning only that browser guide plus the two previously
  unrun Scaffold guides passes.
  Thus all **28 new installed examples** execute, with both failures retained
  rather than reporting either failed whole run as passing. Existing 88 examples
  were not rerun. Logs: `/tmp/cossack-cli08-cf04-installed-guides.log`,
  `/tmp/cossack-cli08-cf04-installed-final.log`, and
  `/tmp/cossack-cli08-cf04-installed-browser.log` and
  `/tmp/cossack-cli08-cf04-installed-scaffold.log` (final offline CLI/MCP parity).
- Final published resource acceptance:
  `/tmp/cossack-cli08-cf04-owned-installed-resources.log`, **exit 0**.
  Final installed CLI proves default-environment isolation, public provider/help
  contracts and named-account local apply preserving root/production accounts,
  with repeated apply unchanged. Actual Wrangler parsing and an injected verified
  provider were used; no live cloud calls.
  Fresh payloads: `/tmp/cossack-cli08-cf04-tarballs`; corrected Framework:
  `/tmp/cossack-cli08-cf04-final/cossackframework-framework-0.8.3.tgz`; final CLI:
  `/tmp/cossack-cli08-cf04-owned-final/cossack-0.8.3.tgz`. Retained installation:
  `/tmp/cossack-local-pack-gZdSQv/minimal-production`. Unchanged tarballs remain
  reused. Install initially rejected placeholder build-policy values; explicit
  false values acknowledged skipped scripts, and subsequent installs exit 0.
  Native dependency build scripts were not run in this metadata-only install.
- Owned diff whitespace validation passes. Preserve unrelated `reports.md`,
  `.zcodeignore`, and the two prior uncommitted failed Workflow acceptance files.

### Remaining limits

**Open: SVC-04, CF-08/09/10, REL-02/03/04/05 (8).** Native Workflow waiting,
interruption/resume/events/failure and installed acceptance remain unproven;
its strict failing probe was preserved and not rerun. Native/source-map/remote
log ingestion, real isolated preview lifecycle and deployment-guide compatibility
acceptance remain required. REL-02 retains full final published/generated matrices;
REL-03 retains complete non-Desktop unit/build/runtime gates. CLI-08's focused
installed documentation criteria are proven independently of those broader gates.
Versions remain **0.8.3** until REL-04. No publication, push, deployment or
credential rotation occurred.

<a id="codex-cf10-release-batch-2026-10-06"></a>
## Codex: CF-10 complete; installed/native release acceptance (2026-10-06)

**Author: Codex. CF-10 complete; 51 complete / 7 open.** REL-02/REL-03 remain
open for their full criteria. This batch chose executable guide acceptance,
installed/generated package acceptance, and the complete CLI suite because they
exercise existing features and expose release gaps. Three implementation agents
owned separate guide, package-matrix and CLI-fixture files. Codex integrated and
reviewed them, owned the shared Node lifecycle API and stream fix, and ran the
final type checks. No user changes or previous Workflow probes were staged.

### CF-10 criterion mapping

| Original criterion | Verified evidence |
| --- | --- |
| New user follows the public guide without repository imports or private configuration patches | Installed CLI creates a disposable minimal app with pnpm. The only configuration changes are the documented application URL, authored staging environment/routes/secrets, and public SSG page. Generated entry/date/flags/coordinator/migration declarations match the guide. |
| Supported combinations build and dry-run | Default and staging inspect/check/build/deploy dry-run succeed. Staging Vite mode selection, SSG HTML/sitemap URL, local dev HTTP 200 and bounded shutdown succeed. Built configuration preserves selected Worker, custom-domain and zone routes, required secret names, date and flags. Final dry-run succeeds after deleting local secret files. |
| Unsupported combinations fail clearly | Generated placeholder URL and undeclared environment reject. A project Wrangler without configuration parser APIs returns `COSSACK_WRANGLER_API_UNSUPPORTED`. |
| CI executes guide commands | `scripts/test-local-scaffold.mjs` runs the verifier in the normal generated-app gate and exposes `--deployment-guide-only`. Workflow triggers cover affected packages, verifiers and public guides. Hosted GitHub CI was not run locally. |

Final installed guide command:

```sh
node scripts/verify-deployment-guide.mjs /tmp/cossack-local-pack-H0KNkO/minimal-production
```

Exit 0: `/tmp/cossack-cf10-fresh-gate-guide.log`. Installed combination: Node
24.19.0, CLI/Framework 0.8.3 worktree tarballs, Vite 8.3.2, Cloudflare Vite plugin
1.62.5, Wrangler 4.147.0, generated date 2026-06-06 and flags `nodejs_als` /
`enable_request_signal`. Required-secret and D1 creation commands were checked
with real Wrangler **help only**, never mutation. The verifier's strict network
guard records **zero non-loopback attempts** in the final run.

The first cold-cache CI entry-point run failed its guard because Miniflare fetched
optional `Request.cf` metadata from `workers.cloudflare.com`. The request was
blocked. Supported `CLOUDFLARE_CF_FETCH_ENABLED=false` disables that fetch;
telemetry/error reporting/update banners are disabled too. The final fresh-gate
verifier passes without relaxing the guard. Diagnostic logs:
`/tmp/cossack-guide-ci-integration.log` and `/tmp/cossack-cf10-remote-diagnostic.log`.
No claim that the first CI-wrapper command passed, or that remote DNS, secrets,
permissions, previews or deployment readiness were verified. CF-09 and REL-02
retain their original dependency gates independently of CF-10's proven criteria.

### Installed/generated package acceptance and fixes

`scripts/verify-published-release.mjs` checks all twelve maintained non-Desktop
package families using the installed CLI export scanner. Actual installed
coverage: **200 concrete conditional targets**, **90 strict Bundler / 88 strict
NodeNext declaration imports**, **74 executed Node imports**. Auth intentionally
publishes bundler-consumed TypeScript; it is not a native Node ESM claim.
**94 deferred imports** have explicit browser/generated/native/CLI reasons;
target presence is not runtime execution. Actual installed local storage persists
across provider instances; structural R2/S3/Workflow adapters and request test
helpers execute. Structural Workflow state is not native lifecycle proof.

```sh
node scripts/verify-published-release.mjs /tmp/cossack-local-pack-Kkq9IK/minimal-production
COSSACK_KEEP_SMOKE=1 node scripts/test-local-scaffold.mjs --scaffold-only --reuse-artifacts=/tmp/cossack-release-batch-artifacts
node scripts/test-local-scaffold.mjs --resume-node-acceptance=/tmp/cossack-local-pack-Kkq9IK/app
```

Installed import/provider verification exits 0:
`/tmp/cossack-rel02-published-final-payload.log`. The representative matrix's
initial command **failed** its final Node typecheck; its completed earlier
segments cover Cloudflare minimal build, portable resource/mutation/service
composition, Markdown/SSG, Deno types/build/stripping, Node auth/dashboard/Studio/UI
composition, bidirectional local D1/SQLite adapter migration, seed/schema/cache/
session checks, and server-code stripping. Deno build is not native execution.
Initial log: `/tmp/cossack-rel02-generated-matrix.log`.

That matrix exposed numeric Button `disabled`, invalid NativeSelect `onchange`,
and the Node shutdown server union type. The repaired templates use a Boolean
loading comparison and typed `@change` event; the Node lifecycle accepts Hono's
HTTP/HTTPS/HTTP2 server shape. Only changed Scaffold/Node payloads were rebuilt or
packed. Installed CLI upgrade plan/apply reconciled the two form templates while
preserving local artifact pins, without manual generated-source edits. The
bounded resumed Node command exits 0 for strict types, production build, stripping
and real JS/CSS/logo HTTP content/cache checks:
`/tmp/cossack-rel02-generated-matrix-resumed.log`. This composite evidence does
not mean the initial whole matrix command was green.

Generated migration plans exposed another real gap: all seven templates had only
callbacks, which the read-only planner deliberately does not execute. Templates
now declare authoritative up/down operations. Three SQLite regressions prove
complete read-only plans, exact schema equivalence to callbacks, full rollback,
conditional template coverage, and rejection of changed historical checksums.
No migration history was rewritten; existing applied callback histories require
explicit reconciliation guidance under REL-04.

```sh
pnpm --filter @cossackframework/scaffold exec vitest run tests/generated-migration-plan.test.js
node scripts/verify-generated-migration-plans.mjs /tmp/cossack-local-pack-Kkq9IK/minimal-production
```

Source **3/3 pass**, `/tmp/cossack-rel02-generated-migration-plan.log`.
Final installed/native exit 0, `/tmp/cossack-rel02-generated-native-migrations-final.log`:
**7 complete migration plans / 9 zero-parameter DDL statements**; planning leaves
application/history tables absent. Actual generated config, Wrangler types,
strict tsc and Vite build pass. A separate empty native D1 applies **only planned
SQL**; real HTTP requests prove generated User/Session inserts, finds, counts and
public session IDs. The build database is separately migrated through the public
CLI. The verifier is wired after the full-stack Cloudflare switch in the normal
scaffold gate; the entire matrix was not rerun after this new hook.

Initial installed-native harness attempts lacked direct `reflect-metadata` in the
borrowed minimal gate. The verifier resolves that already installed transitive
package, never a workspace alias. Isolated Cloudflare gate dependencies include
its generated full-stack Solar icons. One coordinator install incorrectly ignored
that gate's pnpm workspace overrides and failed offline; restoring the overrides
and normal workspace install succeeds. These are failed setup attempts, not
passing migration/provider evidence. Unchanged packages were reused.

### Node standalone shutdown and stream integration

Public `installNodeShutdown` installs process handlers only with explicit host
ownership. SIGTERM/SIGINT share one drain: close admission, drain HTTP and HTTP2
sessions, dispose runtime, and bound everything by a 10-second default deadline.
Remaining HTTP/upgraded sockets are destroyed at the deadline. Generated direct
entries exit 0 for clean draining or 1 for forced/failed cleanup. Embedded imports
install no handlers; ignored external I/O is not claimed complete or rolled back.

A real installed generated `dist/server/index.js` drains an accepted response on
SIGTERM, rejects new admission, tolerates repeated signals, and bounds stuck work
on SIGINT with exit 1. Strict public NodeNext negative tests preserve actual API
types. They initially exposed extensionless declarations silently resolving
re-exports to `any`; Node's build now uses the existing declaration rewriter.
Canonical Node build subsequently verifies the exact package pipeline.

```sh
pnpm --filter @cossackframework/node-adapter exec vitest run tests/shutdown.test.ts tests/guarded-websocket.test.ts tests/vite.test.ts
COSSACK_NODE_SHUTDOWN_INSTALLED_ROOT=/tmp/cossack-node-drain-installed pnpm --filter cossack exec vitest run tests/generated-node-shutdown.test.js
pnpm --filter @cossackframework/node-adapter build
```

Combined Node **17/17 pass**, `/tmp/cossack-node-release-combined.log`; installed
signals and negative declarations **1/1 pass**,
`/tmp/cossack-generated-node-drain-typed-final.log`; canonical build exit 0,
`/tmp/cossack-node-release-canonical-build.log`. Native tests include actual
HTTP2 GOAWAY/accepted-stream draining, upgraded sockets and cleanup failure.
Initial keepalive draining and public type tests failed before their fixes.

Native SSE also reproduced stream truncation when source modules were bundled
by Wrangler: missing Vite `import.meta.env` caused both normal and error-frame
encoding to throw. Optional environment guards preserve production behavior and
allow those native graphs to run. No stream assertions were relaxed.

```sh
pnpm --filter cossack exec vitest run tests/sse-coordinator-integration.test.js
pnpm --filter @cossackframework/framework build
pnpm --filter @cossackframework/framework exec vitest run tests/rpc-stream.test.ts tests/native-response-evidence.test.ts tests/navigation-trace-build.test.ts
```

Native SSE **3/3 pass**, `/tmp/cossack-sse-native-truncation-fixed.log`, after
strict reproduction failed at `/tmp/cossack-sse-native-truncation-repro.log`.
Canonical Framework build exit 0, `/tmp/cossack-release-framework-native-build.log`;
stream/native-body/trace integration **29/29 pass**,
`/tmp/cossack-release-rpc-env-combined.log`. Shared builds occurred only after
previous CLI consumers terminated.

The final changed Framework tarball was packed once from that canonical build
and installed into the isolated Cloudflare gate. Its native stream regression
also passes **1/1** (two unrelated cases filtered), without repository module
imports:

```sh
COSSACK_SSE_INSTALLED_FRAMEWORK_ROOT=/tmp/cossack-local-pack-Kkq9IK/minimal-production pnpm --filter cossack exec vitest run tests/sse-coordinator-integration.test.js -t 'coordinates native RPC callbacks'
```

Log: `/tmp/cossack-release-installed-sse-encoder.log`. The coordinator target is
selected from the installed public export; the encoder is intentionally tested
through its private installed module path. This is a private regression claim,
not a new public encoder API or full artifact-matrix claim. Final changed
Framework/Scaffold/Node tarballs are in `/tmp/cossack-release-batch-final`.

### Complete CLI run and resolved follow-ups

```sh
pnpm --filter cossack exec vitest run --maxWorkers=1 --no-file-parallelism --exclude tests/workflows-release-acceptance.test.js
```

The original process was allowed to finish: **120 files (114 pass / 6 fail),
1,032 tests (1,007 pass / 19 fail / 6 skip)**, 1,989.23 seconds, exit 1.
`/tmp/cossack-rel03-cli-suite.log`. The earlier uncommitted failed Workflow probe
was excluded and remains preserved/unverified. This broad run included four
existing thin Desktop command/build cases incidentally; no new Desktop platform
acceptance is claimed. Three Desktop native skips are waived, not passed.

Every original failure now has targeted passing evidence:

- Full fixture files `cli-subprocess`, `upgrade-release`, `package-guidance`:
  **62/62 pass**, `/tmp/cossack-rel03-cli-fixture-fixes.log`. Per-child deadlines
  and aggregate test budgets cover their multiple bounded commands; privacy,
  no-write, process cleanup and error assertions remain. The Vite failure stub
  now resolves through the project's package/bin. Expanded authored input-guide
  omission assertions retain every missing-export guide, including the original
  three explicit identities.
- Selected real Node/Deno/auth-SSE/config cases with the verified Deno 2.9.6
  binary: **12 pass / 1 fail** initially,
  `/tmp/cossack-rel03-native-followup.log`. The failed Deno production fixture
  used the obsolete handshake expectation; the subsequent run passes it.
- Final three cases: **Deno production and Cloudflare auth forms pass**, OAuth
  initially fails through `harness.fetch` with an already consumed 400 body.
  `/tmp/cossack-rel03-native-final-cases.log`. Node/Deno wrong-origin remains
  HTTP 403; scope rejection now requires the current exact terminal
  authorization frame, close 1008, and zero state delivery. This aligns RT-13's
  existing contract without changing production authorization.
- Cloudflare OAuth through real native HTTP: **1/1 pass**,
  `/tmp/cossack-rel03-cf-oauth-native-http.log`. Original OAuth assertions remain:
  concurrent atomic state take, exact diagnostics/redaction/cookie expiry, one
  exchange/profile mapping, and one account/session. No production OAuth change.
- Native SSE's remaining original failure passes its **3/3** coordinator run.

All three initially skipped Deno production/development cases execute and pass;
six Deno HTTP/HTTPS trace cases also pass. The invalid `context.skip()` in the
parameterized trace fixture was removed: required native execution now uses the
configured binary or Deno on PATH and reports an unavailable launcher honestly.
Filtered-out cases in targeted runs are not acceptance skips or passing tests.
No second broad CLI run was performed; this is composite final evidence.

Other integrated regressions: generated form events **2/2**, native textarea and
Boolean-button type contracts **2/2**, guide/generated configuration **1/1**.
Logs: `/tmp/cossack-batch-scaffold-final.log`, `/tmp/cossack-batch-ui-final.log`,
`/tmp/cossack-batch-guide-contract-final.log`. No UI production code or package
rebuild was needed.

### Final verification and remaining criteria

```sh
pnpm tsc --noEmit
pnpm run typecheck -- --exclude-desktop
```

Both exit 0 after the final shared TypeScript change. All **10 non-Desktop
package configs** are checked; Desktop explicitly prints waived/not passed.
Logs: `/tmp/cossack-release-batch-final-root-types.log` and
`/tmp/cossack-release-batch-final-package-types.log`. Root solution tsc alone is
not package proof. Owned whitespace, integrated JavaScript syntax, metadata and
workflow parse checks pass; the known user `reports.md` whitespace is excluded.

**Open: SVC-04, CF-08, CF-09, REL-02, REL-03, REL-04, REL-05 (7).** Native
Workflow interruption/waiting/resume/event/failure and installed lifecycle remain
unproven. CF-08 retains remote log/source-map and original remaining criteria;
CF-09 needs actual preview lifecycle/isolation/cleanup/promotion evidence.
REL-02 retains final native/provider/artifact coverage; REL-03 retains the whole
final non-Desktop release matrix, Deno Deploy and generated Deno shutdown/draining.
No requirement was weakened to improve task counts. Versioning/migration/release
preparation remain gated; versions stay 0.8.3. No cloud mutation, deployment,
publication, push or credential rotation occurred.


<a id="codex-deno-standalone-draining-2026-10-06"></a>
## Codex — generated standalone Deno draining (2026-10-06)

REL-03's generated Deno shutdown/draining criterion is verified. No numbered
release task closes: **51 complete / 7 open**. Deno Deploy and the final required
non-Desktop matrix still keep REL-03 open; SVC-04's native lifecycle gap still
keeps REL-02 open. Desktop remains completed by user decision; checks are waived.

Implementation: `deno-adapter` exports explicit `installDenoShutdown`, with
SIGTERM/SIGINT sharing one promise, uninstallable ownership, a default 10-second
HTTP/runtime deadline, and fixed completion facts. Adapter servers expose
`forceShutdown` backed by native `Deno.serve` AbortController. Scaffold installs
ownership only inside `import.meta.main`, exits 0 after successful drain or 1 for
forced/failed cleanup. Embedded imports install no owner. README, web guide,
agent guidance and architecture document scope. Native ignored application work
is neither completed nor rolled back. Public declarations now rewrite relative
runtime extensions; negative NodeNext fixtures reject invalid options/results.
The repeatable Deno gate includes the generated signal regression.

Exact verification (all listed final commands exit 0):

- `pnpm --filter @cossackframework/deno-adapter run build` — canonical build.
  `/tmp/cossack-deno-shutdown-build.log`.
- `pnpm --filter @cossackframework/deno-adapter exec vitest run` — 8 files,
  **42 passed**; six signal-owner and two adapter native-abort wiring regressions.
  `/tmp/cossack-deno-shutdown-combined.log`.
- Deno 2.9.6 `test --allow-env --allow-net --allow-read
  packages/deno-adapter/tests/deno-smoke.test.ts` — **2 passed**, real native HTTP
  and WebSocket dispatch/failure cleanup. Binary recorded at
  `/tmp/cossack-deno-binary.txt`; `/tmp/cossack-deno-shutdown-native-smoke.log`.
- `COSSACK_DENO_BINARY=<recorded executable> pnpm --filter cossack exec vitest run
  tests/generated-deno-shutdown.test.js` — **1 passed** after adding strict
  public type checks. `/tmp/cossack-deno-shutdown-types-source.log`.
- `pnpm --filter @cossackframework/scaffold exec vitest run
  tests/scaffold.test.js -t 'renders the deno/'` — **4 passed**, other 77 filtered.
  `/tmp/cossack-deno-shutdown-scaffold.log`. Initial nonexistent filter selected
  no cases; that invocation is not passing test evidence.
- Pack only changed Deno adapter and Scaffold once into
  `/tmp/cossack-deno-shutdown-artifacts`; fresh offline install into
  `/tmp/cossack-deno-shutdown-installed` reuses unchanged prior tarballs. No
  workspace aliases. Initial install launcher could not resolve pnpm outside the
  repository; absolute pnpm launcher then succeeded. Pack/install logs:
  `/tmp/cossack-deno-shutdown-pack.log`,
  `/tmp/cossack-deno-shutdown-scaffold-pack.log`,
  `/tmp/cossack-deno-shutdown-install.log`.
- `COSSACK_DENO_BINARY=<recorded executable>
  COSSACK_DENO_SHUTDOWN_INSTALLED_ROOT=/tmp/cossack-deno-shutdown-installed
  pnpm --filter cossack exec vitest run tests/generated-deno-shutdown.test.js`
  — **1 passed**. Real installed public CLI generates the app; strict NodeNext
  imports and negative declarations pass; built standalone Deno entry finishes
  an accepted HTTP response on SIGTERM, rejects new admission, shares repeated
  signals, and bounds a stuck request on SIGINT to the default deadline with
  status 1 and client disconnect. `/tmp/cossack-deno-shutdown-installed.log`.
- `pnpm tsc --noEmit` and `pnpm run typecheck -- --exclude-desktop` — root and all
  ten non-Desktop package checks pass after integration. Logs:
  `/tmp/cossack-deno-shutdown-root-types.log`,
  `/tmp/cossack-deno-shutdown-package-types.log`. Desktop excluded, not passed.

Scope: existing full CLI/published guide proofs were not repeated. No Deno Deploy,
hosted CI, full release build/unit/browser matrix or remote Cloudflare action ran.
Official native shutdown/abort contract consulted:
https://docs.deno.com/api/deno/http-server/ . Native process behavior is proved
by the fixture, not inferred from documentation alone.

CF-09 implementation feasibility was checked in parallel. Existing
`cloudflare-resource-provider.js` is read-only and supplies no remote creation,
independent ownership attestation, deploy or deletion primitives. The proposed
unconnected provider-injected prototype was removed; its fixture tests provide
no release evidence. CF-09 still needs native provider/CI wiring, persisted
creation intent, independent ownership verification, real isolated smoke tests,
retry cleanup and production promotion/migration order. SVC-04's strict failed
native waiting probes are unchanged. No credentials or live mutation were used.


<a id="codex-production-source-maps-release-gates-2026-10-06"></a>
## Codex — production source maps and release gates (2026-10-06)

**51 complete / 7 open; no numbered task closes.** This batch completes local
production-map/prepared-upload acceptance within CF-08, migration-history upgrade
acceptance within REL-04, and substantial REL-02/03 integration gates. Desktop
remains complete by user decision; its remaining platform checks are waived.
Versions remain 0.8.3. Two implementation agents owned separate fixture/guide and
browser-test files; Codex reviewed their changes, fixed shared production/API
issues, integrated and verified the batch. No budget feature expansion occurred.

### Production maps and published native loading

Generated web SSR builds now emit linked private server maps; generated Cloudflare
configuration sets `upload_source_maps: true`. Client maps remain opt-in and
Desktop's existing false setting is retained. Existing application configuration
is preserved. The logging guide explains private diagnosis, deployment artifact
matching and the distinction between caught fixed failure logs and remote
uncaught-stack remapping.

`production-source-maps.test.js` builds actual minimal and Workflows Cloudflare
applications, starts native Wrangler/workerd HTTP listeners and requests a real
fault through a random-token, test-only private channel. Actual JavaScript stack
coordinates resolve through that module's linked emitted map to the exact authored
TypeScript file, line 2 and Error-constructor column 12, with exact sourcesContent.
Public failures omit the exception and source path; server maps return 404 and
private fixture values are absent from public client artifacts.

Wrangler `deploy --dry-run --outfile` then prepares its real multipart upload
body. Tests inspect actual application/source-map parts containing the authored
TypeScript and accompanying Worker JavaScript byte-for-byte identical to the
artifact whose native fault was checked. This is prepared-upload proof, **not
remote upload, provider log ingestion or Cloudflare remapping proof**. Initial
hidden-map local resolution did not prove Wrangler selection: Wrangler requires
sourceMappingURL for this prebuilt path. Final linked maps and actual multipart
checks replace that insufficient evidence. --outdir alone also omits the prebuilt
entry map and was not used as a proxy for upload parts.

Framework's public Workflow entry now exports `./provider.js`; the extensionless
published native import was a real defect exposed by the package gate. Both
installed compositions load the final native graph. Workflow **loading** does not
prove waiting, interruption, event resume, retries or lifecycle completion.
Framework publication tests retain demo exclusions and now require the real
portable S3 and public Markdown artifacts/dependencies. No production dependency
was added to make stale tests pass. Trace-mapping is an explicit CLI test dev
dependency; its existing lock snapshot is reused.

Final commands, all exit 0:

- `pnpm --filter cossack exec vitest run tests/production-source-maps.test.js`
  — **2 passed**. `/tmp/cossack-source-map-final-source.log`.
- `COSSACK_SOURCE_MAPS_INSTALLED_ROOT=/tmp/cossack-source-map-linked-installed
  pnpm --filter cossack exec vitest run tests/production-source-maps.test.js`
  — **2 passed**. `/tmp/cossack-source-map-final-installed.log`.
- Changed Framework/Scaffold tarballs in `/tmp/cossack-source-map-linked-artifacts`;
  fresh offline installation in `/tmp/cossack-source-map-linked-installed`, with
  unchanged dependency tarballs reused and no workspace aliases. Logs:
  `/tmp/cossack-source-map-linked-framework-pack.log`,
  `/tmp/cossack-source-map-linked-pack.log`,
  `/tmp/cossack-source-map-linked-install.log`.

Official contract reviewed: https://developers.cloudflare.com/workers/observability/source-maps/ .
Wrangler's real local source-map selection and serialized FormData were also
inspected. No provider upload was inferred from documentation or mocks.

### Migration history and SQLite upgrade proof

The migration guide explains why replacing applied callback definitions with
otherwise equivalent authoritative operations changes checksums. Preserve exact
applied definitions/toolchain, append only required new pending migrations, review
a live plan and apply that exact plan on the same runner. Baseline markers do not
reconcile changed history; never rewrite journal rows to bypass validation.

Two real SQLite tests execute the generated definitions: retained historical
callbacks plus the new declarative session-public-ID migration preserve rows and
historical checksums, including rollback of only the new migration. Blind template
replacement rejects plan/up/down even after baseline insertion. These tests are
included in the final **171-passing Scaffold suite** below. They do not validate
an application's remote database, reconcile mixed histories automatically or
complete the version/changelog/release-note criteria of REL-04.

### Builds, units, bundle audit and type checks

Canonical dependency builds ran with the user-waived Desktop package excluded:
Core/Renderer, Framework build:types, Node/Deno/UI/Database and Studio builds;
Test-utils build; real Framework `vite build`; `pnpm audit:bundle`. All final
builds exit 0, including real client/Worker/SSG artifacts and **32 neutral database
modules** in the Workers-safe audit. Framework build/audit logs:
`/tmp/cossack-release-build-framework.log`, `/tmp/cossack-release-bundle-audit.log`.
The literal root `pnpm build` was not run because it includes Desktop.

The serial non-CLI/non-Desktop workspace unit command initially failed one stale
Scaffold Node-import assertion. The Framework suite then found stale publication
assertions, the real Workflow extension defect and cold-import timeouts under
unbounded concurrency. Assertions were corrected to existing public behavior;
the actual import was fixed. The final Framework run bounded workers to four and
retained the existing import deadlines. No failing test was skipped.

Final package results: Auth 298, Database 121 + **2 external-provider skips**,
Renderer 343, Core 1,716, Deno 42, Node 52, Test-utils 17, Scaffold 171, UI 651,
Studio 69, Framework 2,045. Together: **5,525 passed / 2 skipped**. Logs:
`/tmp/cossack-release-noncli-units.log` (initial failed composite),
`/tmp/cossack-release-scaffold-units-fixed.log`,
`/tmp/cossack-release-remaining-units.log`,
`/tmp/cossack-release-framework-units-bounded.log` (117 files / 2,045 passed).
Database PostgreSQL/MySQL skips require COSSACK_TEST_POSTGRES_URL and
COSSACK_TEST_MYSQL_URL; neither skip is claimed passed.

Subsequent browser-gate config tests add eight passing cases and the Sidebar
repair adds two passing unit cases. All changed contracts were rerun after the
last shared source change: `pnpm --filter @cossackframework/ui exec vitest run
 tests/sidebar-contracts.test.ts --maxWorkers=1` — **24 passed**;
`pnpm --filter @cossackframework/framework exec vitest run
 tests/package-contract.test.ts tests/playwright-config.test.ts --maxWorkers=2`
— **25 passed**. Logs: `/tmp/cossack-release-sidebar-contracts.log`,
`/tmp/cossack-release-final-contracts.log`. This is composite evidence, not a
single unchanged all-package green invocation.

Final `pnpm tsc --noEmit` and `pnpm run typecheck -- --exclude-desktop` both exit 0
after all TypeScript changes/builds. All **10 non-Desktop package configs** pass;
Desktop prints waived/not passed. Logs: `/tmp/cossack-release-integrated-root-types.log`,
`/tmp/cossack-release-integrated-package-types.log`. An earlier check overlapped
UI pretest deleting declarations and failed Studio; the final settled checks
supersede that race. Owned syntax/whitespace checks pass; user reports.md whitespace
is excluded rather than changed.

### Full CLI run and bounded follow-ups

`COSSACK_DENO_BINARY=$(cat /tmp/cossack-deno-binary.txt) pnpm --filter cossack
 exec vitest run --maxWorkers=1 --no-file-parallelism
 --exclude tests/workflows-release-acceptance.test.js -t '^(?!.*[Dd]esktop).*'`
finished in 2,332.90 seconds: **1,028 passed / 1 failed / 8 skipped**, 123 passing
files and one failed file. `/tmp/cossack-release-cli-final.log`. Native Deno cases
executed. Strict previously failed Workflow probes were excluded explicitly and
remain unproven; they were not waived or rewritten. This run is **not green**.

The one failure was Studio's 5-second aggregate test deadline for three separately
bounded subprocesses, followed by its child-cleanup assertion after timeout. The
outer test budget now allows 65 seconds; each child retains its 20-second bound
and the production deliberately hanging Studio fixture retains --timeout=100.
Targeted Studio rerun passes, including the no-live-child assertion:
`pnpm --filter cossack exec vitest run tests/cli-subprocess.test.js
 -t 'Studio has bounded startup' --maxWorkers=1` — **1 passed / 38 filtered**,
`/tmp/cossack-release-studio-subprocess-fixed.log`.

The name filter accidentally selected out two required tests containing
“non-Desktop”. Both files were subsequently run without that filter:
`pnpm --filter cossack exec vitest run tests/skill-guide-consistency.test.js
 tests/guidance-family-inventory.test.js --maxWorkers=1` — **4 passed**,
`/tmp/cossack-release-cli-nondesktop-guidance.log`. The six actual Desktop cases
remain waived, not passed. Source-map settings changed during the live CLI run;
final changed artifacts have separate source/installed proof above. Do not call
this composite one immutable final green CLI run.

### Browser integration and installed Sidebar acceptance

Initial default Playwright reused a temporary CLI app on port 5173 and produced
invalid fixture results. Those results were discarded. Dedicated COSSACK_E2E_PORT
now validates a port, disables reuse, binds an explicit loopback host and enforces
strictPort; eight config regressions cover dev/SSG/default/invalid settings.
This host left unused loopback TCP connections in SYN-SENT, so Playwright's initial
HTTP availability check stalled before launching any server. NO_PROXY alone did
not fix it. Codex launched owned dev/preview servers first, verified actual HTTP
200 responses, and used a temporary config importing the repository config with
only absolute testDir and webServer:undefined overrides. This preserves all
repository suites/browser assertions without trusting an unrelated listener.

Reproduction: start `pnpm --filter @cossackframework/framework run dev --host
 127.0.0.1 --port 15173 --strictPort`. Temporary
`/tmp/cossack-release-browser.config.mts`:

```ts
import base from '/home/tan/Sites/cossack/packages/framework/playwright.config.ts';
export default { ...base, testDir: '/home/tan/Sites/cossack/packages/framework/e2e', webServer: undefined };
```

Run with `NO_PROXY=localhost,127.0.0.1,::1 COSSACK_E2E_PORT=15173`:
`pnpm --filter @cossackframework/framework exec playwright test
 --config /tmp/cossack-release-browser.config.mts --workers=2 --reporter=line`.
Full development run completed: **278 passed / 19 failed** across 297 cases,
9.9 minutes; `/tmp/cossack-release-browser-owned-server-final.log`. Not green.

All 19 failures now have verified follow-ups. Repairs select actual disclosed
sidebar links, wait for hydration, verify real event/count/key/resize behavior,
use accessible native controls and current static-alert/calendar/avatar semantics,
and target the actual SSE chat input. Dashboard overflow remains forbidden, but
its assertion waits for the shell's existing responsive margin transition to
settle. No force clicks, assertion removals or skips hide failures.

Sidebar had omitted its footer's icon-rail state marker. The shared component now
propagates it, with unit regression and strict actual-browser footer/name/avatar
checks. An agent's component run encountered two unchanged cases during the UI
rebuild: 41 passed / 2 failed, then both pass in a stable targeted rerun. The final
integrated run supersedes those affected-file results:

- Same owned-server command with these eight paths: core-features/decorators.spec.ts,
  core-features/navigation.spec.ts, core-features/loading-states.spec.ts,
  pages/counter-http.spec.ts, pages/optimistic-counter.spec.ts,
  pages/components-demo.spec.ts, pages/sse-chat.spec.ts,
  pages/dashboard-stat-block.spec.ts — **87 passed**, 2.6 minutes, exit 0.
  `/tmp/cossack-release-browser-batch-final.log`. All original failed cases are
  covered. Unchanged passing cases retain earlier full-run evidence; this is
  composite coverage of the 297 cases, not a second full green invocation.
- `pnpm --filter @cossackframework/framework run build:ssg` and owned
  `pnpm --filter @cossackframework/framework exec vite preview --host 127.0.0.1
  --port 15174 --strictPort`, then same temporary Playwright config with
  COSSACK_TEST_SSG=1 / COSSACK_E2E_PORT=15174 / loopback NO_PROXY — **6 passed**,
  exit 0. `/tmp/cossack-release-ssg-build.log`,
  `/tmp/cossack-release-ssg-browser.log`. SSG artifacts precede the final Sidebar
  marker repair; changed Sidebar behavior has separate final native proof.
- UI canonical build exits 0: `/tmp/cossack-release-sidebar-build.log`.
  Pack only changed UI with `pnpm --filter @cossackframework/ui exec pnpm
  --config.ignore-scripts=true pack --pack-destination /tmp/cossack-sidebar-release-artifacts`.
  Fresh offline --ignore-scripts install `/tmp/cossack-sidebar-release-installed`
  reuses all unchanged final tarballs. Pack/install logs:
  `/tmp/cossack-release-sidebar-pack-final.log`,
  `/tmp/cossack-release-sidebar-install-final.log`.
- `pnpm --filter cossack exec vitest run tests/sidebar-browser.test.js --maxWorkers=1`
  — **1 passed**; same command with
  COSSACK_SIDEBAR_INSTALLED_ROOT=/tmp/cossack-sidebar-release-installed — **1 passed**.
  `/tmp/cossack-release-sidebar-browser-source-final.log`,
  `/tmp/cossack-release-sidebar-browser-installed.log`. Actual public ESM imports,
  packaged themes and client module graph are checked; no workspace UI alias.
  Footer collapse/expansion and retained keyboard/focus/disclosure/native-link,
  no-JavaScript, offcanvas and cleanup assertions pass.

Initial Sidebar fixture CJS require.resolve could not select import-only exports;
using an actual public ESM module fixed the fixture. An invalid pack flag failed
before packaging; the final config flag succeeded. Neither failed attempt counts
as acceptance. Owned temporary dev/preview servers are stopped after verification.

### Exact remaining criteria

SVC-04: strict native waiting/interruption/event resume/failure/retry and installed
lifecycle. CF-08: remote Workers Logs ingestion/deployed remapping, provider startup,
native development faults and remaining original module-graph/receipt criteria.
CF-09: actual ownership-verifying native preview provider/CI lifecycle, isolated
resources/smoke, retry cleanup and production promotion/migration ordering.
REL-02: final native/provider/published matrix, including Workflow lifecycle.
REL-03: final-version non-Desktop matrix and Deno Deploy; local results above are
composite and not remote acceptance. REL-04: version/dependency/lockfile/changelog/
release-note alignment after gates. REL-05: final requirement audit. No requirement
was relaxed to improve counts. No cloud mutation, deployment, publication, push or
credential rotation occurred. Preserve user reports.md/.zcodeignore and the two
prior uncommitted Workflow probes; they are not included in this commit.


<a id="codex-native-preview-cli-ci-2026-10-06"></a>
## Codex: connected native preview CLI/CI — 2026-10-06

**No completed task IDs. 51 complete / 7 open.** This batch implements the
remaining CF-09 execution path; it does not close its remote acceptance criteria.
Two agents exclusively implemented the native provider/tests and CI template/tests;
a third wrote the operator guide. Codex reviewed and integrated CLI parsing,
scaffold ownership/rendering, prepared artifacts, journals, smoke and cleanup.

- Public `preview create|inspect|cleanup` uses actual project Wrangler, singular
  `preview`, `--ignore-defaults`, explicit selected account and fixed official
  account-scoped REST reads. Tool/version/help/account contracts are checked.
- Explicit staging D1/KV/R2 references must differ from production and are
  retained. Local DO classes use native preview ownership. Shared/unsupported
  service/Workflow/Queue bindings and required Worker secrets fail closed.
- The existing deploy dry-run gate performs configuration checks, binding types,
  Vite build, artifact verification and configured budgets before upload. The
  native-build fixture runs real Vite and Wrangler; the remote provider and
  smoke response are fixture inputs, not remote execution.
- Journals precede mutation; receipts precede smoke. Cleanup checks provider
  ID/name/creation time and deployment scope/tag, deletes by immutable ID, then
  confirms absence. Lost deletion responses can converge; absent previews are
  idempotent. Replaced identities/tags/accounts, arbitrary journal fields,
  symlinks/traversal, active locks and uncertain reads block deletion. Dead
  same-host locks can be reclaimed; foreign/live locks fail closed.
- Manual CI installs without the deployment token, limits credentials to the
  lifecycle steps, uploads intent/final journals and restores explicit same-
  repository prior artifacts for retry. Actual YAML/shell behavior is tested
  locally; hosted Actions and cloud effects are not exercised. Promotion and
  backward-compatible migration ordering remain separate and reviewed. Code
  rollback does not restore storage/state.

Verified checks (all exit 0):

```sh
pnpm --filter cossack exec vitest run tests/preview-service.test.js tests/cloudflare-preview-provider.test.js tests/command-contracts.test.js tests/mcp.test.js
pnpm --filter @cossackframework/scaffold exec vitest run tests/preview-workflow.test.js tests/preview-rendering.test.js tests/scaffold.test.js
pnpm --filter cossack exec vitest run tests/preview-build-acceptance.test.js
pnpm --filter cossack exec vitest run tests/preview-service.test.js
pnpm --filter @cossackframework/scaffold exec vitest run tests/preview-rendering.test.js
COSSACK_PREVIEW_INSTALLED_ROOT=/tmp/cossack-preview-installed-final pnpm --filter cossack exec vitest run tests/preview-service.test.js tests/preview-build-acceptance.test.js tests/preview-installed-acceptance.test.js
pnpm tsc --noEmit
pnpm run typecheck -- --exclude-desktop
```

Results: combined CLI **184 pass / 4 files** (32 native-provider contract cases);
scaffold **88 pass / 3 files**; source native-build **1 pass**. Final journal
hardening adds one case: final service **23 pass**, render **3 pass** and final
installed **25 pass / 3 files**. These final checks supersede the earlier service
run. Actual provider subprocess tests prove bounded output/deadlines and process
tree reclamation using local Node children; their payloads are fixtures. Initial
real-parser fixture failed because it linked CLI dependencies without Wrangler;
corrected to the project tool graph and final public-CLI parser acceptance passes.
No production requirement was removed to make a generated app pass: the installed
default-secret app explicitly rejects unsupported preview creation.

Only changed CLI/Scaffold were packed into `/tmp/cossack-preview-final-artifacts`,
installed into a fresh `/tmp/cossack-preview-installed-final` with unchanged
dependency tarballs. Packing was repeated only after final journal hardening
changed CLI behavior/source. Logs: `/tmp/cossack-preview-combined-cli.log`,
`/tmp/cossack-preview-combined-scaffold.log`, `/tmp/cossack-preview-source-build.log`,
`/tmp/cossack-preview-final-service.log`, `/tmp/cossack-preview-final-render.log`,
`/tmp/cossack-preview-installed-acceptance.log`, `/tmp/cossack-preview-root-types.log`,
`/tmp/cossack-preview-package-types.log`. Root and all ten non-Desktop package
checks pass; Desktop remains explicitly waived, never reported as passed.

**Missing CF-09 criteria:** no configured explicit account/API token in this
session and no hosted CI run, so real isolation/production-unchanged/create/smoke/
cleanup/retry proof remains absent. Required-secret setup is unsupported; generated
apps requiring APP_SECRET fail closed. Lost creation before tagged receipt cannot
authorize automatic removal and requires manual provider recovery. Existing
staging storage is not provisioned per branch. CI cancellation may prevent upload.
These limits are documented, not waived. Strict SVC-04 native Waiting/lifecycle
acceptance remains open; CF-08 remote and final REL gates remain as previously
recorded. Versions remain 0.8.3. No cloud mutation/deployment/push/publication.
Preserved baseline changes: reports.md, .zcodeignore and two Workflow probe files.


<a id="codex-preview-secrets-recovery-2026-10-06"></a>
## Codex: native preview secrets and recovery — 2026-10-06

**Completed task IDs: none. 51 complete / 7 open.** This verified batch closes
CF-09's local required-secret and lost-tagged-receipt acceptance gaps, not its
hosted lifecycle criteria. Independent agent ownership: provider/recovery/tests;
new secret loader/native transport tests; CI template/tests. Codex integrated
service/CLI/scaffold and reviewed generated-app/published acceptance.

Implementation:

- `--secrets-file` requires an explicit private staging JSON map with exactly the
  declared secret names. Rejects duplicates/extra/missing/reserved names, invalid
  values, oversized inputs, symlinks/hardlinks and unsafe POSIX ownership/modes.
  Values stay internal; errors/results/journals contain no secret values. No
  production or local-development secret copying.
- Real Wrangler 4.147 against a test-only local HTTP API proves prepared native
  `secret_text` bindings are sent in the selected preview deployment JSON, with
  `ignore_defaults=true`. Root production bindings are absent and no global
  Worker/defaults PATCH occurs. The production provider still fixes the official
  API endpoint; tests alone override the native tool API for transport evidence.
- Native validation warnings expose values even with sanitization enabled. This
  discovery required captured/discarded stderr plus a mode-700 private temporary
  Wrangler log directory, removed on success/failure/cancel/deadline. Provider
  tests verify these file effects with dummy secrets. Log-cleanup failure returns
  a fixed failure code. Prepared configuration stays mode 600 and is removed
  after the operation; abrupt kill may retain private local files.
- Recovery independently GETs preview identity and its native `latest` deployment
  scoped to immutable ID, then checks exact ownership annotation. Inspection is
  read-only. Cleanup saves recovered proof before deletion, rejects mismatched
  latest/saved identities, and confirms remote absence. Missing latest deployment
  is explicitly distinct from an absent preview. No name/intent-only deletion.
- CI uses protected `COSSACK_PREVIEW_SECRETS_JSON`, creates a mode-600 temporary
  file under umask 077, unsets the blob before invoking CLI, removes the file on
  EXIT and excludes it from journal artifacts. Real bash fixture tests cover
  success/failure/missing-input cleanup and installation credential scope.

Verified checks, all exit 0:

```sh
pnpm --filter cossack exec vitest run tests/preview-service.test.js tests/cloudflare-preview-provider.test.js tests/preview-secrets.test.js tests/preview-secrets-native.test.js tests/command-contracts.test.js
pnpm --filter @cossackframework/scaffold exec vitest run tests/preview-workflow.test.js tests/preview-rendering.test.js tests/scaffold.test.js
pnpm --filter cossack exec vitest run tests/preview-generated-acceptance.test.js
COSSACK_PREVIEW_INSTALLED_ROOT=/tmp/cossack-preview-secret-recovery-installed pnpm --filter cossack exec vitest run tests/preview-service.test.js tests/preview-generated-acceptance.test.js tests/preview-installed-acceptance.test.js
pnpm tsc --noEmit
pnpm run typecheck -- --exclude-desktop
```

Results: CLI **182 pass / 5 files** (27 service, 43 provider, two loader/native
transport cases and command contracts), scaffold **89 pass / 3 files**, source
generated-app **one pass**, installed **29 pass / 3 files**. The source/installed
generated app retains required APP_SECRET, executes the real production build
gate, checks prepared native secret bindings, serves a real workerd 200 response
and scans client bundles/journal/result for the dummy secret. Provider creation
is a fixture input; workerd secrets are explicit test overrides. Thus this proves
local generated usability, not remote Worker preview execution. First generated
source attempts exposed fixture module links missing framework packages and an
incompatible harness Request invocation; corrected the fixture links/API call.
No application secret requirement, assertion or runtime criterion was removed.

Changed CLI/Scaffold packed once into `/tmp/cossack-preview-secret-recovery-artifacts`,
installed fresh in `/tmp/cossack-preview-secret-recovery-installed`; unchanged
package tarballs reused. No unchanged installed matrix repacked/rerun. Logs:
`/tmp/cossack-preview-secret-recovery-cli.log`,
`/tmp/cossack-preview-secret-recovery-scaffold.log`,
`/tmp/cossack-preview-generated-source.log`,
`/tmp/cossack-preview-secret-recovery-installed.log`,
`/tmp/cossack-preview-secret-recovery-root-types.log`,
`/tmp/cossack-preview-secret-recovery-package-types.log`. Root/all ten non-Desktop
package types pass; Desktop waived explicitly, not reported as passed.

**Missing criteria:** no configured explicit account/API token and no hosted CI
run, so actual create/smoke/owned cleanup/retry and unchanged-production evidence
remain missing. Creation interrupted before a matching tagged deployment exists
remains manual-recovery only. Existing staging D1/KV/R2 is retained, not provisioned
per branch. Strict SVC-04 Waiting/lifecycle, CF-08 remote/provider startup and
final versioned REL/runtime gates remain unchanged. No cloud mutation, deployment,
push or publication; versions remain 0.8.3. Preserved all four baseline changes.


## Codex — Workflow native lifecycle (2026-10-06)

<a id="codex-workflow-native-lifecycle-2026-10-06"></a>

**51 complete / 7 open; SVC-04 and REL-02 remain open.** Two implementation
agents owned the native event/failure fixture and executable guide test
respectively. Codex reviewed both, implemented the separate persisted native
runner and integrated the batch. No public API/package behavior changed.

Proven source and installed acceptance:

- Generated Cloudflare Workflow entry executes an actual failed step, retries
  once, accepts a validated external event and completes. D1 counters prove
  first=1, attempts=2 and last=1. Invalid events reject without private payload.
- A separate native instance fails permanently; native status is errored with
  the dummy private error, while public inspection reports failed with fixed
  WORKFLOW_FAILED and excludes provider errors, payloads and outputs.
- A native local Wrangler process pauses fully at an event boundary, then its
  POSIX process group is killed. A new PID uses the same explicit persisted
  directory, reads actual native paused state, resumes, receives an event and
  completes with first=1, attempts=2 and last=1. No completed-step repeat.
  Wrangler createTestHarness hardcodes persist:false; the restart test uses
  wrangler dev --local --persist-to instead of pretending harness roots persist.
- All four TypeScript fences in docs/workflows.md compile unchanged under
  strict Bundler resolution with generated Cloudflare binding types. A separate
  NodeNext consumer checks core Workflow and framework entry/provider exports.
  Negative cases reject numeric reference, nonboolean event and undeclared
  event discriminator. Application operations/authorization are explicit type
  fixtures only, not transaction/authentication implementation acceptance.

Verified commands, all exit 0:

```sh
pnpm --filter cossack exec vitest run tests/workflow-failure-native.test.js tests/workflow-restart-native.test.js tests/workflow-documentation-acceptance.test.js
COSSACK_WORKFLOWS_INSTALLED_ROOT=/tmp/cossack-preview-secret-recovery-installed pnpm --filter cossack exec vitest run tests/workflow-failure-native.test.js tests/workflow-restart-native.test.js tests/workflow-documentation-acceptance.test.js
pnpm tsc --noEmit
pnpm run typecheck -- --exclude-desktop
```

Results: **4 pass / 3 files** source, **4 pass / 3 files** installed; root
and all ten non-Desktop package type checks pass. Logs:
`/tmp/cossack-workflow-batch-source.log`,
`/tmp/cossack-workflow-batch-installed.log`,
`/tmp/cossack-workflow-batch-root-types.log`,
`/tmp/cossack-workflow-batch-package-types.log`. Reused unchanged tarballs and
the existing installed gate; no repack or broad unchanged matrix repeated.
Documentation prose now states the precise local restart proof and limits.

**Exact remaining SVC-04 criterion:** observable native Waiting status is still
unproven. The pinned Miniflare implementation reports Running at the external
event barrier; this batch does not substitute Running, Paused or private step
metadata. Earlier strict failing probes are preserved unchanged, uncommitted.
The process interruption proof pauses before killing; it does not cover every
possible mid-effect crash or prove hosted Cloudflare durability. No real cloud
API, deployment, CI run, provisioning, push or publication occurred. CF-08/09
hosted criteria, Deno Deploy and final REL artifact gates remain open. Versions
stay 0.8.3. Desktop checks remain waived, not passed. Preserved baseline
reports.md, .zcodeignore and both older uncommitted Workflow probes.


## Codex — migration and native development acceptance (2026-10-06)

<a id="codex-migration-native-development-2026-10-06"></a>

**51 complete / 7 open; no numbered task closes.** Two implementation agents
owned separate new tests/fixtures; a third performed a read-only open-task
dependency audit. Codex reviewed the implementation, requested exact per-event
correlation and bounded child-process cleanup, and ran the integrated batch.

Proven acceptance:

- All nine unchanged TypeScript fences from specs/migration-0.9.0.md compile
  under strict Bundler and NodeNext against public Core/Renderer/UI exports.
  Negative checks enforce serialized Date strings, Input vocabulary, native
  scroll bindings and boolean disabled controls. Explicit application-owned
  auth/save/transport/data contexts establish types only. The old before-style
  for-await example compiles against an app-owned RpcCall declaration; this is
  not runtime endorsement of its old yield behavior.
- A real generated Cloudflare Vite/workerd development process handles authored
  API and SSR exceptions with fixed 500 JSON/HTML diagnostics. Each response's
  distinct UUID matches its own structured failure event with the correct
  authored route template, action, runtime, stage, code and finite duration.
  Dummy private exception, cause, storage path, dynamic request path, query,
  header and body sentinels stay out of client output and captured failure logs.
  Editing the failed SSR page produces a 200 response in the same process.
  Group cleanup covers normal close, deadline and output overflow.

Verified commands, all exit 0:

```sh
pnpm --filter cossack exec vitest run tests/migration-documentation-acceptance.test.js tests/cloudflare-development-faults.test.js
COSSACK_MIGRATION_INSTALLED_ROOT=/tmp/cossack-preview-secret-recovery-installed COSSACK_DEV_FAULTS_INSTALLED_ROOT=/tmp/cossack-preview-secret-recovery-installed pnpm --filter cossack exec vitest run tests/migration-documentation-acceptance.test.js tests/cloudflare-development-faults.test.js
pnpm tsc --noEmit
pnpm run typecheck -- --exclude-desktop
```

Results: **2 tests / 2 files pass** source, **2 tests / 2 files pass** installed.
Root/all ten non-Desktop package types pass; Desktop waived, not passed. Logs:
`/tmp/cossack-release-guide-dev-source.log`,
`/tmp/cossack-release-guide-dev-installed.log`,
`/tmp/cossack-release-guide-dev-root-types.log`,
`/tmp/cossack-release-guide-dev-package-types.log`. Reused existing installed
artifacts; no package source changes, shared dist rebuilds or repacks. The first
agent installed setup failed because require.resolve used Scaffold's import-only
root; its fixture now resolves the actual public import target from package
metadata. The final source/installed batch verifies the corrected fixture.

Separate broad gate started (result pending, not passed):

```sh
COSSACK_DENO_BINARY="$(cat /tmp/cossack-deno-binary.txt)" pnpm --filter cossack exec vitest run --maxWorkers=1 --no-file-parallelism --testNamePattern='^(?!.*(?:[Dd]esktop|Electron))' --reporter=default --reporter=json --outputFile=/tmp/cossack-rel03-current-cli.json
```

Stdout/stderr: `/tmp/cossack-rel03-current-cli.log`. This serial run includes
the preserved uncommitted strict Workflow probe and enables the recorded Deno
executable. Desktop-named tests are omitted by the explicit release waiver.
No missing or waived check is reported passed. The running handle must be polled
to terminal before recording suite counts or failure conclusions.

Remaining: native Workflow Waiting; CF-08 wider graphs/aggregate receipts and
provider Logs/maps/startup; hosted CF-09 isolated lifecycle/retry/unchanged
production plus safe no-tag recovery; Deno Deploy and final package/runtime
matrix; gated version/release preparation and final requirement audit. No cloud
mutation, deployment, provisioning, publication or push. Versions 0.8.3. All four
baseline changes preserved unchanged.


<a id="codex-cli-gate-scroller-hosted-preparation-2026-10-06"></a>
## Codex — terminal CLI gate, scroller regression and hosted preparation (2026-10-06)

Author: **Codex**. Counts **51 complete / 7 open**, versions **0.8.3**. No numbered
row closes; Desktop remains completed by user decision with six checks waived.
Baseline reports.md/.zcodeignore and the two earlier strict Workflow probes remain
unchanged and unstaged. Two implementation agents exclusively owned the UI leaf
and hosted fixture respectively; a third reviewed preparation read-only. Coordinator
reviewed all changes and ran combined/installed acceptance and required types.

The previously running serial CLI gate (session 48392) terminated with exit **1**:
**134 files passed / 2 failed / 1 skipped; 1,112 tests passed / 2 failed / 9 skipped**.
Exact command is recorded in the preceding batch; log and structured JSON remain
`/tmp/cossack-rel03-current-cli.log` and `/tmp/cossack-rel03-current-cli.json`.
All three native Deno generated-runtime cases executed and passed. Failures:

- Strict preserved Workflow probe: native status remained `running` after retry
  and first-step counters were proven, instead of actual `waiting`. No relaxation
  or inferred status; the two probe files remain uncommitted and unchanged.
- MessageScroller: removing the first visible row after resize used a surviving
  sibling's stale offset, losing **25px**. A deterministic same-task resize/removal
  regression fails the old build and passes after flushing pending reconciliation
  before the next render mutates rows. Original **<1px** tolerance remains. Native
  focus/draft, following/history, images/resize, veto/disabled controls and observer
  cleanup assertions remain. Installed mode resolves public exports and packaged
  CSS/source from a fresh consumer, without repository package symlinks.

Skipped-case accounting: six Desktop/Electron cases are explicitly waived. Two
non-Desktop cases contained “non-Desktop” in their names and were accidentally
matched by the broad exclusion; both files now execute without the filter and
pass. `preview-installed-acceptance` lacked its optional installed-root environment;
it now passes separately with the unchanged installed gate. No skipped case is
counted as passed in the original broad report. Targeted recovery is not a green
full-suite rerun, and the original broad result predates the UI fix.

Final verified commands (exit **0**):

```sh
pnpm --filter @cossackframework/ui run build
pnpm --filter @cossackframework/ui exec vitest run tests/message-scroller-contracts.test.ts
pnpm --filter cossack exec vitest run tests/message-scroller-browser.test.js tests/guidance-family-inventory.test.js tests/skill-guide-consistency.test.js tests/hosted-workflow-fixture.test.js --maxWorkers=1 --no-file-parallelism
COSSACK_PREVIEW_INSTALLED_ROOT=/tmp/cossack-preview-secret-recovery-installed pnpm --filter cossack exec vitest run tests/preview-installed-acceptance.test.js --maxWorkers=1
pnpm --filter @cossackframework/ui pack --pack-destination /tmp/cossack-scroller-release-artifacts
pnpm --dir /tmp/cossack-scroller-release-installed install --ignore-scripts --no-frozen-lockfile
COSSACK_MESSAGE_SCROLLER_INSTALLED_ROOT=/tmp/cossack-scroller-release-installed pnpm --filter cossack exec vitest run tests/message-scroller-browser.test.js --maxWorkers=1
node scripts/prepare-hosted-release.mjs --installed-root /tmp/cossack-preview-secret-recovery-installed --out /tmp/cossack-hosted-release-ready-final --build
pnpm tsc --noEmit
pnpm run typecheck -- --exclude-desktop
```

Results: combined source **6 tests / 4 files**, UI contracts **12 / 1 file**,
installed browser **1 / 1**, separate installed-preview correction **1 / 1**;
root and all ten non-Desktop package types pass. UI rebuilt/repacked **once**;
all other package tarballs reused. Fresh consumer copied the existing lockfile and
changed only the UI tarball reference. Logs: `/tmp/cossack-release-batch-combined.log`,
`/tmp/cossack-release-batch-scroller-contracts.log`,
`/tmp/cossack-release-batch-scroller-installed.log`,
`/tmp/cossack-release-installed-filter-correction.log`,
`/tmp/cossack-release-batch-root-types.log`,
`/tmp/cossack-release-batch-package-types.log`,
`/tmp/cossack-message-scroller-same-frame-repro.log`,
`/tmp/cossack-message-scroller-ui-build.log`,
`/tmp/cossack-scroller-pack.log`, `/tmp/cossack-scroller-install.log`.

Hosted fixture/preparation:

- `writeHostedWorkflowAcceptance` writes only three server modules. Both APIs
  require a nonempty private ACCEPTANCE_KEY; workflow operations use a fixed trusted
  scope. Retry/terminal-failure sentinels and D1 effect counters permit independent
  provider evidence. The deliberate function-API exception reaches the framework's
  standard **request** error boundary without custom logging/catching.
- `prepare-hosted-release.mjs` requires a fresh private output directory, selects
  the single authenticated cached Wrangler OAuth account, generates a minimal
  installed Workflows app and unique resource names, and stores keys/logs privately.
  Actual generated Workflow types, strict semantic typecheck, Vite build, native
  Wrangler upload **dry-run** with secret-file input and client secret scans pass.
  D1 uses an explicit zero-ID placeholder; no existing resource or production route
  is selected. No provisioning or deployment-write command is implemented.
- A separate bounded subprocess runs the native local harness with controlled
  environment and private logs. It proves unauthenticated 401 guards, authenticated
  500/COSSACK_REQUEST_INTERNAL plus request UUID and redaction, retry attempts=2,
  first/last side effects=1, approved event completion and redacted terminal failure.
  The first smoke run incorrectly expected COSSACK_API_INTERNAL for a function
  route. The corrected assertion matches the actual request-boundary implementation;
  the final complete preparation/smoke succeeds. Private failure diagnostics are
  retained without echoing exception details to public output.
- Subprocesses use existing bounded runCaptured process-group cleanup and an 8MiB
  capture ceiling. Native listen/close run within the 120s parent deadline. The
  private review artifact has actual Markdown newlines, not literal escapes.

Private prepared artifacts: `/tmp/cossack-hosted-release-ready-final`; summary log
`/tmp/cossack-hosted-ready-final.log`. `plan.json` records localSmokePassed=true and
remoteMutationPerformed=false. Cached OAuth is authenticated with one account;
API token/account environment and hosted CI credentials remain unconfigured. Do
not infer authentication absence from those missing environment variables. Account
metadata, secret files and raw native logs remain outside the repository. Approval
for the concrete hosted resource/check/ownership-verified cleanup plan is pending;
no cloud mutation, deployment, provisioning, publication or push occurred.

Remaining criteria: actual native Workflow Waiting; CF-08 compiler diagnostics,
wider graph/aggregate receipts and provider Logs/remapping/startup; CF-09 hosted
CI lifecycle/isolation/retry/unchanged production and safe no-tag ownership recovery;
Deno Deploy and final versioned artifact/runtime matrix; gated versioning/release
prose completeness and final requirement audit. Local hosted-fixture smoke does
not prove any remote criterion. Desktop waiver is not runtime acceptance.


<a id="codex-compiler-aggregate-acceptance-2026-10-06"></a>
### Codex — compiler HTTP faults and complete aggregate receipts (2026-10-06)

Author: **Codex**. **51 complete / 7 open; no numbered task closes.** Two
implementation agents had exclusive compiler and aggregate-test ownership;
coordinator reviewed all changes and owned shared APIs, integration and installed
public CLI acceptance. Baseline reports.md/.zcodeignore and both strict uncommitted
Workflow probes were preserved and excluded from this batch.

**CF-08 criteria completed:**

- One signed version-2 receipt for primary plus every selected auxiliary policy;
  no partial prefix. Before-first/after-last identity binds primary even with
  auxiliary-only budgets, each selected source snapshot/settings/environment,
  complete redirect membership/order, module inventories and tool/runtime identity.
  Unselected auxiliary membership and unsupported identities decline reuse.
- Only configured finite numeric values and fixed measured/failed outcomes persist;
  diagnostics are reconstructed from current policies. Malformed/signed-partial,
  unknown fields/outcomes, tampered values, reordered/missing Workers and stale
  source/module/chunk/tool/runtime identities reject reuse. A passing receipt
  cannot disguise unrelated build failures. Genuine complete failing batches
  provide structured budget failures without another tool run.
- Actual installed public CLI success build, success deploy dry-run and failed
  deploy dry-run each perform one native measurement per configured Worker in
  Vite. Private fixed-command counters observe zero measurement commands in CLI.
  Primary case performs 3 upload + 3 actual local startup checks across its three
  builds; auxiliary-only case performs 6 upload checks across two Workers/three
  builds. Real Wrangler executable/metrics run unchanged; no fabricated output.
- Cloudflare Vite/compiler HTTP boundary returns fixed COSSACK_RUNTIME_FAILED JSON,
  UUID matching response header/structured event, unknown route/action (routing
  never ran), Cloudflare runtime/dispatch stage and finite entry duration, no-store.
  Malformed @Server private method sentinel/source/path is absent from response
  and structured event; full compiler source remains in trusted terminal. Active
  page repair recovers in the same native process.

**Verification:**

| Check | Terminal result | Evidence |
| --- | --- | --- |
| Framework targeted combined receipt/budget/auxiliary/codegen checks (`pnpm --filter @cossackframework/framework exec vitest run`, eight selected files) | 157 passed / 8 files | `/tmp/cossack-aggregate-framework-final-combined.log` |
| CLI `budget-reuse-command.test.js` | 10 passed / 1 file | `/tmp/cossack-aggregate-cli-unit.log` |
| Related CLI build-budget-command/deploy/deployment checks | 33 passed / 3 files | `/tmp/cossack-aggregate-cli-related.log` |
| Source `build-budget-integration.test.js` two-auxiliary regression, selected with `-t` | 1 passed / 6 filtered skips | `/tmp/cossack-aggregate-native-two-aux-final.log` |
| `COSSACK_AGGREGATE_INSTALLED_ROOT=/tmp/cossack-aggregate-release-installed pnpm --filter cossack exec vitest run tests/aggregate-budget-installed.test.js` | 2 passed / 1 file | `/tmp/cossack-aggregate-public-installed-final.log` |
| `pnpm --filter cossack exec vitest run tests/cloudflare-compiler-faults.test.js` | 1 passed / 1 file | `/tmp/cossack-server-compiler-source-final.log` |
| Same compiler command with `COSSACK_COMPILER_FAULTS_INSTALLED_ROOT=/tmp/cossack-aggregate-release-installed` | 1 passed / 1 file | `/tmp/cossack-server-compiler-installed-final.log` |
| Root `pnpm tsc --noEmit` | Passed | `/tmp/cossack-aggregate-final-root-types.log` |
| Ten non-Desktop package typechecks | All passed; Desktop waived | `/tmp/cossack-aggregate-final-package-types.log` |
| Framework `build:types` and changed-package tarballs | Passed | `/tmp/cossack-aggregate-framework-final-build.log`, `/tmp/cossack-aggregate-framework-final-pack.log`, `/tmp/cossack-aggregate-cli-pack.log` |

Aggregate units include 32 cases; native undefined vs empty targetEnvironment
default metadata now normalizes to the same independently bound selection.
Source Wrangler 4.114.0/plugin 1.47.0 and installed Wrangler 4.147.0/plugin
1.62.5/Vite 8.3.2 exercised. Framework packed twice because native testing exposed
a real identity mismatch; CLI packed once. All unchanged packages reused, including
the previous batch's fixed UI tarball. Fresh consumer uses pnpm-workspace.yaml
overrides for every Cossack tarball; private transitive resolution audit found
zero registry Cossack bindings across five inspected dependency relationships.

**Failed iterations retained:** first source combined run was 8 passed/1 failed:
CLI remeasured both auxiliaries because Wrangler default metadata differed. Fixed
normalization and selected failed case passed; six unaffected source budget cases
and native API/SSR proof retain their prior evidence. This is not a green rerun of
all nine combined cases. Initial test typecheck failed inferred test-only shapes;
explicit types fixed them before final checks. Initial installed setup lacked
workspace overrides, and a later private-module integration mode could not spy
on immutable installed ESM namespaces (4 passed/4 failed). Removed that mode and
used the actual public CLI fixture above. The new fixture first caught a launcher
that did not execute native require.main and then missing production APP_URL;
correct real-bin spawn and valid test URL precede the final two-case pass. No
acceptance assertions were weakened. Compiler fixture was subsequently strengthened
from shared render syntax to server-only syntax; final source/installed proofs
above apply to this strengthened variant.

**Remaining:** wider external/rebundled module graph acceptance; hosted Workers
Logs ingestion/remapping/provider startup; browser overlay/HMR and initially
malformed startup are not proven by the HTTP boundary. Auxiliary upload remains
a separate capability. SVC-04 needs actual native Waiting; CF-09 needs hosted
CI lifecycle/isolation/retry/unchanged-production evidence and safe no-tag recovery.
Hosted approval is still pending despite working cached OAuth; token/CI config
remains absent. Deno Deploy, final versioned artifact/runtime matrices and REL-04/05
gates remain open. No broad CLI/root build rerun, cloud mutation, publication or
push occurred. Desktop checks were waived, not passed.


<a id="codex-preview-creation-release-build-2026-10-06"></a>
### Codex — preview creation proof and release build (2026-10-06)

Author: **Codex**. **51 complete / 7 open; no numbered task closes.** Previous
goal turn was progress (commit 8d27e4eb); this batch implements existing CF-09
cleanup and REL-03 build acceptance gaps. Two implementation agents exclusively
owned provider/tests and build orchestration/tests. Coordinator owned lifecycle,
CLI help/docs, native integration, package script and final checks. User baseline
reports.md/.zcodeignore/two uncommitted strict Workflow probes remain untouched.

**Completed criteria:**

- Empty preview creation uses verified account auth, bounded POST `{name}` and
  explicit default bypass, without resource settings. Provider response is reduced
  to validated ID/name/creation time and saved atomically before native upload.
  Parent Worker must already exist; Cossack never provisions it in this path.
- If upload fails before deployment, cleanup requires exact saved creation identity
  matching an independent provider read plus actual latest-deployment 404. Names,
  missing creation proof, unknown reads, substituted preview ID/time/name and
  foreign latest deployment never authorize removal. Saved deployment proof cannot
  be downgraded into empty-preview proof. Delete failure retains retryable state;
  only provider-confirmed preview absence records cleaned. Lost create response
  before persistence still requires manual recovery.
- Real Wrangler 4.147 help uses `--ignore-base-config`, not the formerly assumed
  `--ignore-defaults`. Provider now negotiates actual help, prefers current flag,
  supports the legacy flag only when advertised and uses corresponding REST query.
  Native source confirms no create-only CLI exists, so empty creation uses its
  account-scoped REST contract; deployments/deletions still use native Wrangler.
- Native source and changed installed CLI acceptance use actual Wrangler binary
  version/help/whoami/deploy/delete. A loopback API replaces only destination and
  authenticated responses; no synthetic CLI success, fake tool output or cloud
  write occurs. Fixture observes creation receipt before upload, actual multipart
  staging-variable metadata, failed upload, failed delete, successful retry and
  idempotent cleanup. All mutations stay under the exact account/Worker preview
  subtree; production Worker/default endpoints receive no mutations. This local
  proof does not establish hosted provider/CI isolation or real production state.
- `pnpm build:release` preserves every root non-Desktop build stage, orders
  Renderer→Core→UI before consumers, adds test-utils and performs Studio's full
  Vite build. Framework retains root build's library `build:types` stage. Auth has
  no build script and publishes source; its typecheck passed. Desktop explicitly
  waived, never reported passed. First failed native stage stops/propagates exit.

**Terminal verification:**

| Command / scope | Result | Evidence |
| --- | --- | --- |
| `pnpm build:release` | Nine native non-Desktop build stages passed | `/tmp/cossack-preview-release-build.log` |
| `pnpm audit:bundle` | Passed, 32 neutral modules / Workers-safe entry | `/tmp/cossack-preview-release-bundle-audit.log` |
| `pnpm tsc --noEmit` | Passed | `/tmp/cossack-preview-empty-root-types-final.log` |
| `node scripts/typecheck.mjs --exclude-desktop` | Ten packages passed; Desktop waived | `/tmp/cossack-preview-empty-package-types.log` |
| `pnpm --filter cossack exec vitest run tests/preview-service.test.js tests/cloudflare-preview-provider.test.js tests/preview-secrets.test.js tests/release-build-command.test.js` | 108 passed / 4 files | `/tmp/cossack-preview-empty-combined.log` |
| `COSSACK_PREVIEW_NATIVE_TOOL_ROOT=/tmp/cossack-aggregate-release-installed pnpm --filter cossack exec vitest run tests/preview-creation-native.test.js` | 1 passed / 1 file | `/tmp/cossack-preview-empty-native-source-final3.log` |
| `COSSACK_PREVIEW_INSTALLED_ROOT=/tmp/cossack-preview-empty-release-installed pnpm --filter cossack exec vitest run tests/preview-creation-native.test.js tests/preview-service.test.js tests/preview-installed-acceptance.test.js` | 38 passed / 3 files | `/tmp/cossack-preview-empty-installed-final.log` |
| Changed CLI `pnpm pack`; fresh overridden consumer | Passed, CLI packed once; unchanged tarballs reused | `/tmp/cossack-preview-empty-cli-pack.log`, `/tmp/cossack-preview-empty-installed-setup-final.log` |

Provider has 67 tests, lifecycle 36, release orchestrator four and secrets one.
Installed resolution audit confirms CLI binds the new preview-empty tarball and
Framework binds prior verified aggregate tarball, with native Wrangler 4.147.0.
Only that changed package was packed; native build refreshed local dist without
repacking unchanged packages or repeating unchanged installed matrices.

**Failed iterations:** real 4.147 help exposed a product compatibility failure
missed by mock-help tests (renamed bypass flag). Initial new native fixture then
failed verification because its memberships response was missing; corrected the
account-intersection fixture. Next test wrongly required PATCH for variable-only
settings, although native puts variables in deployment metadata; assertion now
checks actual staging upload contents. Native 4.147 uploads multipart, whereas the
earlier 4.114 fixture used JSON; updated metadata parser to real multipart before
final source/installed passes. No ownership checks weakened. Initial copied lock
was edited incorrectly and retained old CLI resolution; restored unchanged prior
lock before installing the new manifest/overrides. Actual new artifact binding
was checked before installed acceptance; initial resolution failure is not a pass.

**Limits and remaining tasks:** CF-09 stays open for hosted CI creation/smoke/
cleanup, isolation, retry and unchanged production. Cached OAuth exists, but
preview token/CI configuration and hosted approval are pending. Creation response
loss before saving immutable identity stays manual recovery; random intent is not
proof. SVC-04 actual native Waiting, CF-08 wider graphs and remote Logs/remapping/
provider startup, Deno Deploy and final versioned runtime/unit/browser matrices
remain unproven. REL-04 versioning and REL-05 audit remain gated. No broad unit
rerun, remote resource write, publication or push; Desktop remains waived.


<a id="codex-module-graphs-unit-gates-2026-10-06"></a>
## Codex — native module graphs and non-CLI unit gates (2026-10-06)

**51 complete / 7 open; no numbered task closes.** Coordinator integrated two
exclusive-file implementation agents (native graph acceptance and strict actual
installed Workflow probe); a third agent diagnosed the Core reporter failure
without changing or filtering its tests. Product code and dependencies are unchanged.

CF-08's wider upload/gzip graph slice now passes real Cloudflare Vite builds,
native Wrangler measurements and the public CLI for dynamic chunks/source maps,
rebundled `no_bundle: false` output, and a local import outside the output tree.
Configured warnings and hard upload limits are exercised; the rebundled hard
limit exercises gzip. Dynamic graphs reuse the authenticated receipt without a
second CLI measurement. Unsupported rebundled/external identities require fresh
CLI measurements on success; their failed builds retain COSSACK_BUILD_FAILED.
Separate direct Vite failures prove actual hard-budget enforcement for those
unsupported identities, rather than treating a generic failure as budget proof.
Malformed dynamic source remains a redacted compiler failure, never a budget
failure. The wrapper counts actual native invocations; measurements are not mocked.
Wider-graph startup profiles and remote/provider startup, Logs ingestion and
remote remapping remain unproven. No new feature or budget policy was added.

### Terminal checks

| Scope / command | Result | Evidence |
| --- | --- | --- |
| `pnpm --filter cossack exec vitest run tests/budget-module-graphs-native.test.js` | Initial source 3 passed; final gzip-only delta 1 passed / 2 name-filtered | `/tmp/cossack-module-graphs-source.log`, `/tmp/cossack-module-graphs-source-gzip.log` |
| `COSSACK_BUDGET_GRAPH_INSTALLED_ROOT=/tmp/cossack-preview-empty-release-installed pnpm --filter cossack exec vitest run tests/budget-module-graphs-native.test.js` | Final installed 3 passed | `/tmp/cossack-module-graphs-installed.log` |
| `pnpm tsc --noEmit` | Passed | `/tmp/cossack-module-graphs-final-root-types.log` |
| `node scripts/typecheck.mjs --exclude-desktop` | Ten packages passed; Desktop waived | `/tmp/cossack-module-graphs-final-package-types.log` |
| `node --check` for both new graph files | Passed | Coordinator terminal |

Source uses Wrangler 4.114.0 / Vite 8.1.4; installed uses Wrangler 4.147.0 /
Vite 8.3.2 and the existing verified overridden tarballs. No repack, rebuild or
unchanged installed-matrix rerun was needed for these test-only changes.
The final source gzip delta did not invalidate unchanged dynamic/external proof;
the final installed run covers all three modes.

All unit commands used `pnpm --filter <package> exec vitest run --maxWorkers=1`
with the standard reporter, serial heavy jobs and no name filters. Framework's
pretest rebuild was avoided because current declarations were already built.
These are current implementation gates, not final 0.9.0 artifact acceptance.

| Package | Files passed | Tests passed | Skipped | Native log under `/tmp/` |
| --- | --- | --- | --- | --- |
| Core | 107 | 1,716 | 0 | `cossack-release-core-unit-default.log` |
| Renderer | 25 | 343 | 0 | `cossack-release-renderer-unit.log` |
| Framework | 119 | 2,085 | 0 | `cossack-release-framework-unit.log` |
| Auth | 12 | 298 | 0 | `cossack-release-auth-unit.log` |
| Database | 20 | 121 | 2 | `cossack-release-database-unit.log` |
| Node adapter | 9 | 52 | 0 | `cossack-release-node-adapter-unit.log` |
| Deno adapter | 8 | 42 | 0 | `cossack-release-deno-adapter-unit.log` |
| test-utils | 3 | 17 | 0 | `cossack-release-test-utils-unit.log` |
| UI | 49 | 653 | 0 | `cossack-release-ui-unit.log` |
| Studio | 12 | 69 | 0 | `cossack-release-studio-unit.log` |
| Scaffold | 16 | 179 | 0 | `cossack-release-scaffold-unit.log` |
| Total (non-Desktop, non-CLI) | 380 | 5,575 | 2 | All terminal exits 0 |

Database's PostgreSQL/MySQL integration cases were skipped because
COSSACK_TEST_POSTGRES_URL/COSSACK_TEST_MYSQL_URL were absent. They are unrun,
not passes. Desktop is waived, not passed. The full CLI gate was not rerun:
its prior terminal failures and subsequent targeted fixes remain separately
recorded, including unresolved strict Waiting.

**Failed diagnostics:** Core's optional JSON reporter threw RangeError: Invalid
string length from JsonReporter.onTestRunEnd/JSON.stringify and produced no JSON
artifact (`/tmp/cossack-release-core-unit.log`). Its subsequent complete standard
reporter run passed 1,716 tests; no repository/config change was justified.

The new strict Workflow probe resolves createTestHarness and Miniflare from the
actual installed project, not a workspace import. Wrangler 4.147.0 with
Miniflare 5.20261001.0-alpha still reports `running` throughout a 30-second event
barrier poll. Retry effects (two attempts, one completed first step) passed before
the direct native Waiting assertion failed; public Waiting and later event/failure
assertions were not reached. Terminal: 1 failed, 41.12s,
`/tmp/cossack-workflow-waiting-native.log`. An initial package-export resolution
setup error was corrected before this native probe; it is not acceptance proof.
No dependency upgrade, Running-to-Waiting mapping or inferred state was introduced.
The two newly created failing probe files were copied to
`/tmp/cossack-workflow-waiting-current-toolchain/` and removed from this batch's
checkout; the two original uncommitted strict probes remain untouched. Only the
passing graph files are committed. A private `/tmp/` archive is local diagnostic
evidence, not a durable checked-in acceptance test.

**Exact remaining criteria:** SVC-04 needs literal native Waiting at the event
barrier. CF-08 needs wider startup profiles and hosted Logs/remapping/provider
startup; initial-malformed-startup and browser overlay/HMR privacy remain unproven.
CF-09 needs hosted CI creation/smoke/ownership cleanup, retry, resource isolation
and unchanged production. REL-02/03 need the remaining final artifact/runtime
matrix, Deno Deploy and a green complete CLI gate. REL-04/05 remain dependent on
those gates. Hosted approval/CI configuration remain pending; authenticated OAuth
alone does not authorize or prove hosted readiness. No cloud writes, push,
publication or version bump occurred. Baseline reports.md, .zcodeignore and both
original Workflow probes were preserved and excluded from staging.


<a id="codex-local-observability-browser-gates-2026-10-06"></a>
## Codex — local observability criteria and full browser gate (2026-10-06)

**51 complete / 7 open; no numbered task closes.** Three exclusive-file agents
implemented wider startup acceptance, compiler-browser acceptance and the SSE
browser isolation repair. Codex reviewed/integrated them and owned the shared
public-channel fix, declarations, packaging, types and final gates. Baseline
reports.md, .zcodeignore and the two original uncommitted Workflow probes remain
untouched and excluded from the commit. Desktop remains waived, not passed.

**CF-08 local wider-graph startup criterion completed:** real native Wrangler
multipart dry-run output and CPU profiling now prove both local profile-window
and active-sample metrics, warnings and hard limits for dynamic/source-map,
rebundled and outside-output import graphs. Dynamic signed receipts avoid repeat
CLI profiling; unsupported rebundled/external identities receive fresh profiling
on successful builds and retain generic failed-build classification on failure.
Their direct Vite hard-limit failures separately prove actual startup enforcement.
Private raw bundles/profile directories are removed on success and failure;
receipts/public JSON exclude raw profile data. Provider startup is explicitly
unavailable locally, never substituted with these metrics. Earlier upload/gzip
acceptance remains valid; unchanged upload cases were name-filtered this batch.

**CF-08 malformed-startup/browser criterion completed for the tested @Server
syntax fault:** both native toolchains reject malformed startup before listening,
with the exact authored parse error and source retained in the private terminal.
A fresh healthy process then supplies browser acceptance: real connected HMR,
malformed edit, safe HTTP 500/UUID/no-store and terminal correlation, no private
sentinel or absolute authored path in page/overlay/WebSocket diagnostics, then
repair in that same healthy process. This does not claim the initially rejected
process survived or resumed. It does not redact every intentional client compiler
diagnostic, prove remote logging, or establish provider startup metrics.

Native acceptance discovered Vite's public full-reload `triggeredBy` absolute
path leak. Framework now omits that optional field at the browser WebSocket
boundary while preserving reload path, custom events, original private payload
objects, send receiver and disposal. Private ModuleRunner hot channels are not
wrapped. Source and freshly packed Framework installed acceptance pass. Only
Framework was packed once; unchanged artifacts were reused in the overridden
consumer `/tmp/cossack-compiler-browser-release-installed`. Its real package path
resolves the new `/tmp/cossack-compiler-browser-release-artifacts` tarball.

**REL-03 current development browser criterion completed:** all 297 repository
cases pass in one unfiltered final invocation. The initial run found the SSE
multi-tab test using persisted shared rooms and heading-only readiness; one
failed and its serial successor did not run. The repair gives each test UUID
rooms, shares a room only between intended tabs, requires HTTP 200 SSE and
hydration, uses the exact chat input and waits for its controlled value before
normal Enter submission. Broadcast/isolation assertions remain; WebSocket cases
are unchanged. No force clicks, skips or removed assertions hide the failure.
Both corrected SSE cases pass before the final full run. This is development
acceptance, not a new final-versioned/production/installed full matrix.

### Terminal verification

| Command / scope | Result | Private evidence under `/tmp/` |
| --- | --- | --- |
| `pnpm --dir packages/cossack exec vitest run tests/budget-module-graphs-native.test.js -t 'local startup'` | Final source 3 passed / 3 filtered unchanged upload cases, 114.40s | `cossack-startup-graphs-source-final.log` |
| Same with `COSSACK_BUDGET_GRAPH_INSTALLED_ROOT=/tmp/cossack-preview-empty-release-installed` | Final installed 3 passed / 3 filtered unchanged upload cases, 113.14s | `cossack-startup-graphs-installed-final.log` |
| `pnpm --filter cossack exec vitest run tests/cloudflare-compiler-browser-native.test.js` | Source 1 passed, 19.02s | `cossack-public-reload-source-native.log` |
| Same with `COSSACK_COMPILER_BROWSER_INSTALLED_ROOT=/tmp/cossack-compiler-browser-release-installed` | Installed 1 passed, 15.12s | `cossack-public-reload-installed-native.log` |
| Framework reload privacy / development trace bridge+traces / route tests | 4 / 16 / 6 passed respectively | `cossack-public-reload-unit.log`, `cossack-public-reload-traces.log`, `cossack-public-reload-route-final.log` |
| `pnpm --filter @cossackframework/framework exec vitest run --maxWorkers=1` | Final full 120 files / 2,089 tests passed, 168.35s | `cossack-public-reload-framework-full.log` |
| Root `pnpm tsc --noEmit` after final edits | Passed | `cossack-public-reload-root-types-complete.log` |
| `node scripts/typecheck.mjs --exclude-desktop` | Ten packages passed; Desktop waived | `cossack-public-reload-package-types.log` |
| Final Framework `pnpm --filter @cossackframework/framework exec tsc --noEmit` | Passed | `cossack-public-reload-framework-types-final.log` |
| Framework `build:types`, one pack, fresh offline overridden consumer | Passed | `cossack-public-reload-declarations.log`, `cossack-public-reload-pack.log`, `cossack-public-reload-install.log` |
| Browser corrected SSE-only run | 2 passed, 14.8s | `cossack-release-browser-sse-fixed.log` |
| Final complete browser command below | 297 passed, 7.6m, terminal 0 | `cossack-release-browser-full-verified.log` |

Owned server: `pnpm --filter @cossackframework/framework run dev --host
127.0.0.1 --port 59123 --strictPort`, verified native HTTP 200 before tests.
Private config `/tmp/cossack-release-browser-current.config.mts` imports the
repository Playwright config, changes only absolute testDir and
`webServer: undefined`. Complete command:

```sh
NO_PROXY=localhost,127.0.0.1,::1 COSSACK_E2E_PORT=59123 pnpm --filter @cossackframework/framework exec playwright test --config /tmp/cossack-release-browser-current.config.mts --workers=2 --reporter=line
```

SSE targeted invocation additionally selected
`e2e/core-features/transport-sync.spec.ts --grep SSE --workers=1`. No grep,
sharding, exclusions or retries were added to the final 297-case invocation.
Owned server PID was stopped only after terminal browser success; session exited
143 from intentional SIGTERM and port 59123 was confirmed unbound. This cleanup
exit is not a failed test. Native source uses Vite 8.1.4/Wrangler 4.114.0;
installed uses Vite 8.3.2/Wrangler 4.147.0.

**Failed iterations retained:** initial installed startup cases all failed
measurement (70.74s, `cossack-startup-graphs-installed.log`). The fixture used a
clock-terminated busy loop; newer Workers profiling does not advance that clock
during CPU work. Finite five-million-iteration integer work with a retained
result corrected the fixture without changing limits/assertions or product code.
Initial source clock-based pass is superseded by the final bounded source pass.
See [Workers timer semantics](https://developers.cloudflare.com/workers/runtime-apis/performance/).
Private failing generated fixture remains `/tmp/cossack-native-budget-graph-7hATqt/app`.

The initial compiler-browser fixture assumed malformed startup must listen and
failed before browser assertions (`cossack-compiler-browser-installed.log`).
Actual native startup rejects before a listener; the corrected branch requires
nonzero compiler-specific failure, exact authored file/source and no origin,
never generic process death. The first corrected assertion failed because native
ANSI colors separated every source character; only trusted terminal assertions
now normalize ANSI. Raw public channel assertions remain intact. Subsequent
installed acceptance found the real triggeredBy leak
(`cossack-compiler-browser-installed-agent.log`) before the product fix. One route
unit mock lacked Vite's ws member; added it while preserving assertions. A focused
command included two nonexistent file filters and actually ran only the four
privacy tests; it is not evidence for those nonexistent suites. The real trace
files subsequently passed all sixteen cases.

Initial standard Playwright setup was intentionally stopped after confirming a
live SYN-SENT availability probe and no started server; no test had run. Owned
server workaround preserves all suite assertions. First complete owned run:
295 passed / 1 failed / 1 did not run, 8.4m,
`cossack-release-browser-full-final.log`. The final 297-pass invocation supersedes
that failure for the repaired suite; it does not erase its history.

**Remaining:** CF-08 hosted Logs ingestion/remapping/provider startup, CF-09
hosted CI lifecycle/isolation/retry/unchanged production, SVC-04 literal native
Waiting, and REL-02/03's final artifact/runtime matrix, Deno Deploy and complete
CLI gate. REL-04/05 remain dependent on those gates. Prior unchanged package unit
proof is retained; Framework's new full run supersedes its previous 2,085-pass
run. Current non-Desktop/non-CLI composite is 5,579 passed across 381 files,
with two external Database cases unrun. It is not a single root monorepo command
or a green full CLI gate. No remote writes, push, publication or version bump.
Hosted approval and CI credentials remain pending. Versions stay 0.8.3.

<a id="codex-hosted-readiness-blockers-2026-10-06"></a>
### Codex — hosted readiness blockers (2026-10-06)

Read-only recheck; no implementation or completed task. Baseline reports.md,
.zcodeignore and the two uncommitted strict Workflow probes remain untouched.
GitHub CLI `gh auth status` exits 0 with an authenticated account; absent token
environment variables alone do not establish lack of cached authentication.
Cloudflare API-token/account environment and CI credential configuration remain
unavailable; cached Wrangler OAuth does not prove hosted CI readiness.

The recorded native executable is Deno 2.9.6, although it is absent from PATH.
Native `deno deploy --help` exits 2 (duplicate help option); `deno deploy help`
exits 2 (too many arguments). Direct official module help succeeds:
`deno run --no-config -A jsr:@deno/deploy@0.0.9908 --help`. Its read-only
`whoami --json --non-interactive` exits 2 with `NON_INTERACTIVE_REQUIRED`,
explicitly requiring DENO_DEPLOY_TOKEN or --token. No login, deployment or
provisioning was attempted. Private logs:
`/tmp/cossack-release-readiness-{github,deno,deno-help,deno-direct-help,deno-auth}.log`
(mode 600); account details are not copied into release records.

Remaining criteria are unchanged: SVC-04 native Waiting; CF-08 provider Logs,
remapping and startup; CF-09 hosted CI isolation/lifecycle/retry/unchanged
production; REL-02/03 Deno Deploy and final artifact/runtime/full CLI gates;
REL-04/05 prerequisite-dependent versioning and final audit. Hosted approval
remains pending. No code changed, broad tests/types/packing were not rerun and
prior evidence is retained. **51 complete / 7 open**, versions 0.8.3, Desktop
waived. This readiness check does not satisfy any hosted acceptance criterion.

<a id="codex-hosted-cf08-complete-2026-10-09"></a>
### Codex — CF-08 hosted completion (2026-10-09)

**CF-08 complete; 52 complete / 6 open.** User authorized temporary Cloudflare
and Deno acceptance. Existing reports.md/.zcodeignore and two uncommitted strict
Workflow probes are untouched. Coordinator integrated/reviewed two exclusively
owned hosted-observability assertion files. Two Deno acceptance files remain
batch-owned/uncommitted pending the missing organization API credential.

CF-08 acceptance mapping:
- Returned HTTP500 JSON and X-Cossack-Request-Id contain the same UUID as the
  actual deployed Worker's fixed cossack.request.failure event. Native tail has
  78 records; real persisted query has 80 events, including that matching UUID.
  Completed nondry stored Workers Logs record has provider identity/timeframe,
  owned Worker name, safe exact source fields and agreement with native tail.
- Framework event/public response exclude both runtime secrets and deliberate
  private exception marker. Its route/action/runtime/stage/code and finite
  duration match the authored fixture. Raw provider envelopes remain private;
  provider headers and the separate deliberate map exception are not claimed
  as redacted framework output. All 19 compiled client files exclude secrets
  and private server markers.
- Provider exception stack directly resolves Object.fetch to src/index.ts:25:17
  in the deployed current Worker. This is provider output, not local mapping or
  upload-only evidence. Native Wrangler 4.148.0 deploy reports 10 ms startup,
  545.11 KiB upload / 159.07 KiB gzip. Local/size warning and measured hard-limit
  regression, atomic receipts/wider graphs and compiler/browser acceptance remain
  proven by the prior source/installed archive; unchanged tests were not rerun.
- Eight hosted evidence criteria pass via
  `node packages/cossack/tests/fixtures/cloudflare-hosted-observability.js /tmp/cossack-hosted-20261009/observability-evidence.json`.

Private evidence directory /tmp/cossack-hosted-20261009 is mode700; receipts,
secrets, provider raw logs and final verification logs mode600. Generated app
installed the retained current tarballs through all-package overrides, without
workspace package links. Generated Wrangler types, application typecheck/build
pass. No packages repacked. Account equality and fresh absence of all three
resource names were proven before creation. D1 UUID was saved before deployment;
Worker immutable ID/creation time, Workflow ID and owned DO namespace IDs were
saved and rechecked before deletion. Cleanup confirmed Worker, Workflow, D1 and
owned namespace absent. See private cleanup-verified.json and before/after receipts.

Batch verification: agent targeted assertion regressions 23 passed; coordinator
combined invocation `pnpm --filter cossack exec vitest run tests/cloudflare-hosted-observability.test.js tests/deno-deploy-hosted-acceptance.test.js`
passes 23 / 1 file, with the explicitly opt-in Deno case skipped. Separate agent
Deno installed preparation passes 1 case with real client/SSR build, stripping
and native Deno2.9.6 cached-only graph proof. It is not hosted Deno acceptance.
Root `pnpm tsc --noEmit` and `node scripts/typecheck.mjs --exclude-desktop` pass
(all ten packages). JS syntax/owned whitespace pass. Prior browser297/full
Framework2089 evidence retained; no broad reruns. Desktop remains waived.

Failed iterations/limits: the original private app used a shared node_modules
link; pnpm12 refused its hoist layout and offline metadata. A fresh private app
with current overrides installed successfully. No repository manifests/lockfile
changed. Initial Python HTTP User-Agent received edge403/1010 without entering
the Worker; browser User-Agent requests reach the intended authorization401.
Initial filtered persisted query was empty; the unfiltered completed query using
actual tail timestamps supplies the raw stored proof. No synthetic tail-to-stored
conversion was used. Native Workflow Waiting still fails at the external event
barrier after the 65-second hosted poll; independent provider API also reports
running. D1 effects are first1/attempt2. Retry/event/failure/paused-restart local
proof remains valid; these hosted observations do not establish Waiting. Owned
Workflow was deleted during verified cleanup.

Deno personal CLI token authenticates and lists one organization, but documented
REST app management returns401; no Deno resource created. Organization-scoped
DENO_DEPLOY_API_TOKEN is pending so UUID cleanup can be verified before creation.
CF-09 hosted CI remains unrun; cf/Wrangler OAuth does not supply portable CI
credentials or authorize GitHub changes. REL-02/03/04/05 remain open, versions
0.8.3. No production promotion, GitHub push, npm publication or credential rotation.

## Codex Deno Deploy hosted — 2026-10-09

<a id="codex-deno-deploy-hosted-2026-10-09"></a>

Author: **Codex**. REL-02/03 Deno Deploy compiled installed-artifact criterion
verified; neither full row closes. **52 complete / 6 open**, versions 0.8.3.
User authorized creating, deploying, testing and deleting a temporary app in the
accessible test organization. Interactive zsh loads DENO_DEPLOY_TOKEN and
DENO_DEPLOY_API_TOKEN; token values stay in inherited environments/HTTP headers.
Personal CLI and organization REST identities match the same organization UUID.
Management access and fresh name absence were checked before creation.

Exclusive agent ownership: packages/cossack/tests/deno-deploy-hosted-acceptance.test.js
and packages/cossack/tests/fixtures/deno-deploy-hosted-acceptance.js. Coordinator
reviewed the harness, including explicit production builds, real transport
assertions and nested browser-close/resource-cleanup finally blocks. No shared
product APIs, package manifests or lockfile changed.

Native hosted command: interactive zsh with COSSACK_DENO_HOSTED_MODE=deploy,
COSSACK_DENO_HOSTED_INSTALLED_ROOT=/tmp/cossack-compiler-browser-release-installed,
and COSSACK_DENO_BINARY pointing to the retained native Deno2.9.6 executable,
running `pnpm --filter cossack exec vitest run tests/deno-deploy-hosted-acceptance.test.js`.
Official native Deploy module is pinned to jsr:@deno/deploy@0.0.9908. Terminal
result: **1 passed / 1 file, 31.75 seconds**, recorded privately in
/tmp/cossack-deno-hosted-deploy-test-fourth.log.

Private final evidence: /tmp/cossack-deno-hosted-mFjtUA (mode700; receipts/logs
mode600). prepared.json identifies the retained installed tarball consumer.
Native client/SSR production builds, client server-marker exclusion and absence
of cloudflare:workers imports pass; native cached-only Deno graph check passes.
Provider revision px6p2t6kqeff runs native Deno **2.9.5+e312172**. POST echoes the
request body and returns two separate Set-Cookie headers. All three browser
routes hydrate and mutate count0 to2. Native SSE response is HTTP200 with
text/event-stream; native WebSocket receives a real frame. browser.json records
no page errors; production assets load successfully.

owned.json, hosted-verified.json and cleaned.json agree on exact app UUID/slug.
Cleanup rechecks UUID/slug with GET200, deletes that UUID with DELETE204, then
confirms GET404. Coordinator separately rechecked GET404 with authenticated
REST; coordinator-cleanup-lookup.json preserves that receipt. All temporary
apps from failed iterations were also deleted and verified absent.

Failed iterations retained privately: ZWEMLK reached app creation but native
configuration lacked deploy.org; ywpfuR deployed/API passed but browser mutation
failed; E4Axm2 reused that upload and proved dev asset URLs returned404. The
fixture inherited Vitest NODE_ENV=test. Explicit NODE_ENV=production for both
builds resolved it; no framework behavior was changed. Each attempt's exact
UUID cleanup passed DELETE204/GET404. Rebuilding the invalid upload was necessary;
no packages were repacked or unchanged installed matrices rerun.

Final coordinator verification: `pnpm tsc --noEmit` and
`node scripts/typecheck.mjs --exclude-desktop` pass (all ten non-Desktop packages).
Private logs: /tmp/cossack-deno-hosted-final-root-types.log and
/tmp/cossack-deno-hosted-final-packages-types.log. JavaScript syntax and owned
whitespace checks pass. Prior broad test evidence remains valid; no broad rerun.
Desktop acceptance remains waived, not passed.

Limits: this deploys bundled compiled artifacts from installed current tarballs;
it does not prove provider source installation/build, final 0.9.0 artifact
versions, distributed Deno transport durability or the complete CLI/release
matrix. SVC-04 literal native Waiting, CF-09 hosted CI lifecycle and final
REL-02/03/04/05 gates remain open. No GitHub write, package publication or
existing production promotion. Baseline reports.md, .zcodeignore and both strict
Workflow probes are preserved and excluded from staging.

## Codex SVC-04, database providers and hosted CI preparation — 2026-10-09

<a id="codex-svc04-waiting-provider-ci-2026-10-09"></a>

Author: **Codex**. **53 complete / 5 open. SVC-04 complete against its original
criteria; CF-09 and REL-02/03/04/05 open.** Versions remain0.8.3. Desktop remains
completed by user decision, with outstanding platform checks waived, not passed.
Three exclusively scoped agents implemented provider tooling, Workflow evidence
and CI preparation. Coordinator reviewed/integrated all six owned new files and
verified final types, tests, exact original acceptance mapping and remote absence.
Baseline reports.md/.zcodeignore and both strict Workflow probe files preserved.

SVC-04 acceptance audit (coordinator plus independent agent):
- Interruption/resume/no completed-step repeat: retained native persisted runner
  kills its POSIX process group, starts a new PID against the same state, reads
  paused state, resumes, sends event and completes with D1first1/attempt2/last1.
- Failure/reporting/event/retried-step: native source and installed bridge tests
  prove invalid-event rejection, failed-first/successful-second retry, native
  errored/public failed WORKFLOW_FAILED and private-error exclusion.
- Both actual lifecycle logs /tmp/cossack-workflow-batch-source.log and
  /tmp/cossack-workflow-batch-installed.log terminate4passed/3files. Workflow
  implementation paths last changed at baa8d7a9, before that4b0f368e proof;
  unchanged lifecycle gates were not repeated. See the prior
  [native lifecycle archive](#codex-workflow-native-lifecycle-2026-10-06).
- Sole previously missing Waiting criterion: fresh deployed retained installed
  fixture, actual Wrangler4.148.0. After330seconds without instance requests,
  independent provider REST reports waiting, native binding HTTP200 reports
  waiting, and public inspection HTTP200 reports waiting. Provider envelope and
  public inspection match the exact invoked Cossack identity. D1first1/attempt2.
  Evidence /tmp/cossack-workflow-waiting-20261009-aOl5MB: identity.json,
  first-wait-provider.json, http-receipts.json and idle start/end timestamps.
- SVC-01, RT-24, RT-25, CF-04 and CF-08 dependencies are complete. Original
  Done when does not require all criteria in one hosted run, every interruption
  point or immediate Waiting after every resume. This is composite original-scope
  proof, not a claim that the expanded hosted end-to-end test passed.

Expanded hosted experiment remains FAILED, not waived:
1. aOl5MB reached all three Waiting observations, then immediate pause inspection
   returned WORKFLOW_PROVIDER_UNAVAILABLE. Polling failed rather than establishing
   paused/resumed Waiting. Empty successful cf D1-delete output initially masked
   that failure; independent after-lookups subsequently confirmed full cleanup.
2. 8HLHiE reached invoke and an empty effects audit, then received HTML that the
   old parser could not decode. Raw status was not recorded, so its exact HTTP
   cause is unknown. Cleanup succeeded. Fixture now preserves raw status/text
   before decoding, bounds known read-only gateway retries and never replays
   invoke/pause/resume/event/terminate mutations.
3. Df35Du passed invalid-identity readiness HTTP400, then invoke received an actual
   Cloudflare-branded404 HTML response. No mutation replay and no idle interval
   occurred. This proves inconsistent routing; propagation is only a hypothesis.
   Final terminal /tmp/cossack-workflow-waiting-hosted-third-20261009.log is
   4unitpassed/1hostedfailed, not a green runtime result. No further speculative
   deployment cycles were run.
All three owned Worker/Workflow/D1/DO namespaces are confirmed absent with
immutable receipts. Coordinator independently re-queried Worker/Workflow/D1 for
all three, saving coordinator-*-absent.json. Earlier and latest owned namespace
UUIDs were independently checked absent. Private directories mode700/logs600.

Local strict Waiting/full CLI remains red under REL-03. Workspace
Wrangler4.114.0/Miniflare4.20260722.0 and retained installed
Wrangler4.148.0/Miniflare5.20261006.0-alpha maps show a five-minute grace period,
commented hibernation abort and no Waiting assignment. Source locations:
node_modules/miniflare/dist/src/workers/workflows/binding.worker.js.map and
/tmp/cossack-hosted-20261009/app/node_modules/.pnpm/miniflare@5.20261006.0-alpha_@types+node@22.20.5/node_modules/miniflare/dist/src/workers/workflows/binding.worker.js.map.
[Official current source](https://github.com/cloudflare/workers-sdk/blob/main/packages/workflows-shared/src/lib/gracePeriodSemaphore.ts)
and [native statuses](https://developers.cloudflare.com/workflows/build/workers-api/)
provide context; five minutes is not a documented hosted timing guarantee.
No provider patch, private-state inference, status substitution or test waiver.

REL-03 external-provider omissions close: coordinator final
`node scripts/test-database-providers.mjs` proves **6passed/zero skips**, actual
PostgreSQL18.6 and Oracle MySQL8.0.46. Evidence
/tmp/cossack-provider-acceptance-ip6yF4 contains versions, Vitest JSON and cleanup
receipts. Private loopback data directories and exclusively owned POSIX process
groups are removed; existing services/databases/Docker untouched. The runner
supports explicit native binary path overrides; it requires POSIX and optional
pg/mysql2 drivers. Agent SIGTERM-during-testcommand evidence
/tmp/cossack-provider-acceptance-egd2Hz confirms13owned descendants exited;
startup interruption also cleaned. SIGKILL of the runner cannot execute cleanup.
Final focused `pnpm --filter @cossackframework/database exec vitest run test/provider-runner.test.ts`
passes4. No full database/monorepo matrix rerun or package repack.

CF-09 preparation only: user explicitly authorizes a temporary private GitHub
acceptance repo, reviewed manual workflow installation/run and deletion; portable
CLOUDFLARE_API_TOKEN promised in ~/.zshrc but final interactive presence check is
false. No GitHub/cloud CI resources created. Prepared fresh installed app
/tmp/cossack-preview-ci-20261009-agent/app uses relative retained tarballs and
pnpm11.19.0 locked install; setup.mjs verifies access/account and immutable
creation/cleanup ownership before writes. Pipeline helper checks real run IDs,
actual workflow bytes on both refs, remote gitblob hashes/portable lock, successful
create, failed-smoke journal, cleanup retry, staging D1 effects and unchanged
production snapshot. These checks have not run on hosted CI. Full requirement
remains open; fake snapshots in pure regression tests are not provider evidence.

Final integrated checks: combined CLI fixture regression invocation passes22
with2explicit hosted skips; after later Workflow capture fixes, focused
`pnpm --filter cossack exec vitest run tests/workflow-waiting-resolution.test.js`
passes4with1hostedskip. Unchanged CI helper's21regressions remain valid.
Root `pnpm tsc --noEmit` passes after final source changes; log
/tmp/cossack-batch-final-root-types-20261009.log. All ten non-Desktop package
checks pass via `node scripts/typecheck.mjs --exclude-desktop` in
/tmp/cossack-batch-package-types-20261009.log. JavaScript syntax/owned whitespace
pass. No broad unchanged browser/installed/unit reruns or version bump.
Remaining tasks: CF-09 hosted CI, REL-02 final artifacts, REL-03 full CLI/runtime/
versioned matrix, REL-04 versioning/doc audit and REL-05 final requirement audit.

## Codex release gate order and current artifact audit — 2026-10-09

<a id="codex-release-gate-order-audit-2026-10-09"></a>

Author: **Codex**. **53 complete / 5 open; no task closes.** Original plan at
289d1810 requires tarball imports, helpers/providers and final public-API examples
for REL-02, with all API-changing tasks/RT-29 as dependencies. REL-04 explicitly
bumps versions after REL-02/03, then rebuilds/repeats affected package/install
checks. Requiring final 0.9.0 artifacts before REL-02 introduces a circular
prerequisite. Corrected current plan/handoff/checklist sequencing; no requirement
removed. Final versioned artifacts still require verification under REL-04/05.

Coordinator and independent agent inspected the actual twelve retained package
tarballs referenced by /tmp/cossack-compiler-browser-release-installed/package.json.
Coordinator compared 1,356 published file paths against current workspace bytes;
private audit /tmp/cossack-rel02-current-payload-audit-20261009.json. Runtime
code, declarations, templates and guides match except recorded asset/cache
variation. Inherited LICENSE files are artifact-only at package roots, supplied
from the monorepo license; these are not missing runtime dependencies.

Studio's manifest names an older hashed entry JS/CSS pair; entry JavaScript bytes
are identical to current output. Current CSS differs only by the additional
.static{position:static} rule. This is not a byte-identical current Studio
artifact claim. Semantic comparison is saved in
/tmp/cossack-rel02-studio-payload-audit-20261009.json. Test-utils differs only in
dist/tsconfig.tsbuildinfo; runtime/declaration payloads match. Agent metadata
comparison found only database/UI development test-script differences after
normalizing packed workspace ranges. No packages were rebuilt/repacked, and no
unchanged installed acceptance was repeated. Final versioning will refresh
artifacts and verify the affected package/install gates.

Retained import/example coverage remains valid for unchanged APIs: 200 exports,
90 Bundler/88 NodeNext declaration imports, 74 Node imports, published helpers/
providers and recorded generated/runtime/guide acceptance. The artifact byte
comparison alone is not runtime or declaration execution proof. SVC-04's sole
missing Waiting criterion is now verified; CF-09 remains the outstanding original
API-changing task dependency. Thus REL-02 stays open, without adding a version
prerequisite that depends on REL-02 itself.

Actual blockers revalidated: interactive zsh has neither exported nor unexported
CLOUDFLARE_API_TOKEN (CF_API_TOKEN absent too); hosted CI cannot start despite
existing authorization/preparation. Strict local Waiting/full CLI remains red;
no change to baseline probes, provider status mapping or required assertions.
No hosted jobs/resources are live. No source changes, tests/typechecks reruns,
GitHub writes or cloud mutations. Baseline user changes preserved.

Independent implementation agent owned only CHANGELOG.md and
specs/release-notes-0.9.0.md. Prepared Unreleased prose across all release
categories, migration changes and provider/runtime limits. Coordinator reviewed
both files against architecture, checklist, migration sections and linked guides;
all 97 relative links/anchors resolve. Explicitly retain full CLI/local Waiting
failure, broader hosted experiment failure, hosted CI omission and Desktop waiver.
No new code examples, source changes or package version edits. Root/package
TypeScript and runtime suites were not rerun for this prose-only batch; prior
results are retained at their documented scope, not reported as new passes.
Owned whitespace and 58-task status consistency checks pass. Full REL-04 remains
open for REL-02/03 dependencies, final migration completeness, version/range/lock/
template alignment and affected build/install proof. No new task ID completes.


## Codex current-API migration coverage — 2026-10-09

<a id="codex-migration-coverage-2026-10-09"></a>

Author: **Codex**. **53 complete / 5 open; no full task closes.** Independent
agent exclusively edited specs/migration-0.9.0.md; coordinator reviewed the final
diff, public guides and relevant source/manifests. Filled genuine omissions in
scaffold ownership, CLI finite/lifecycle JSON, MCP/stored evidence, public imports,
generated route/config/translation contracts, private configuration, DataTable,
scoped DI/awaitable cleanup, production helpers, Cloudflare flags/environments/
bindings/assets/targets, Node/Deno development/shutdown/locality, maps/budgets,
preview secrets/journals/cleanup/rollback and SSG/locale upgrade instructions.
Removed stale completed-task acceptance-gap prose; Desktop sections untouched.

Migration coverage mapping (migration guidance, not final acceptance proof):

- CLI-01–08: upgrade order/scaffold ownership, CLI automation/agent inspection,
  public imports/generated contracts; static evidence is distinct from execution.
- RT-01: existing Durable Object readiness/socket context, new Node/Deno shutdown.
- RT-02–06: typed input/resources/tasks/state and optimistic ownership sections.
- RT-07–09: file routes/browser query/history and generated route/API contracts.
- RT-10: existing typed forms and native UI control migration sections.
- RT-11/13: credentials/session dashboard, authenticated SSE, OAuth and old input.
- RT-12: new service ownership/awaitable disposal and test-helper boundaries.
- RT-14: existing typed input/resource policies and explicit native authorization.
- RT-15–17: database inspection, read-only plans and applied-history preservation.
- RT-18: limiter deadlines/persistence and storage guarantees/key migration.
- RT-19: optimistic/socket context and paused-consumer cancellation limits.
- RT-20: state/inspector/server evidence and new private-configuration boundaries.
- RT-21–22: typed Markdown and SSG/localization upgrade checks.
- RT-23: new controlled server DataTable plus unchanged native UI sections.
- RT-24–25: generated/config/runtime contracts and Cloudflare binding/flag guidance.
- RT-26: existing storage/image/provider contracts.
- RT-27: generated translations and SSR/SSG locale checks.
- RT-28: inspector/server evidence, agent inspection and diagnostics.
- RT-29: new production-fetch/credential/hydration test-helper migration guidance.
- SVC-01–05: existing jobs/Turnstile/schedules/notifications/Workflows sections.
- CF-01–07/10: environment/targets/types/secrets/resources/SSE/asset and SSG guidance.
- CF-08–09/11: maps/budgets/previews/journals/rollback and external credential rotation.
- REL-01–05: draft status, upgrade order, public-import/verification boundaries and
  migration history; these process gates do not create a separate product API.

Coordinator checks: all 75 local links/anchors resolve. All nine TypeScript fences
and all nine code blocks exactly match HEAD before this batch; baseline hashes at
/tmp/cossack-migration-prose-baseline-20261009.json. Retained source/installed
Bundler/NodeNext compile and negative-type results remain valid for those unchanged
examples (codex-migration-native-development-2026-10-06). No new executable examples.
Checked actual installed Vite 8.1.4 Node engine range, adapter exports/shutdown,
deployment request-signal preflight, selected environment/scaffold configuration,
config check policy, SSG legacy flags, public Core/Auth entries and packaged
DataTable/service/helper contracts. Documentation describes tested-version limits
without turning them into unsupported universal runtime claims.

Owned whitespace and 58-task count/status checks pass. No source/API/version edits;
root/package typechecks, runtime suites and installed checks were not rerun for
prose-only edits. No publication, GitHub/cloud mutations or new live resources.
User baseline files preserved. Current migration prose criterion is prepared;
full REL-04 remains open for REL-02/03 dependencies, version/internal ranges/
lock/template alignment and affected rebuilt artifact/install proof. REL-05 final
requirement audit remains separate. Interactive zsh still lacks the portable
Cloudflare CI token; strict local Waiting/full CLI remains red. No requirement,
status mapping or baseline Workflow probe was weakened.


## Codex cf token bootstrap and hosted CI attempts — 2026-10-09

<a id="codex-cf-token-bootstrap-2026-10-09"></a>

Author: **Codex**. **53 complete / 5 open; no release task closes.** User explicitly
asked to use cf to get an API token. Installed cf command discovery/schema and
provider permission groups establish account-owned token creation support; current
OAuth login has account_api_tokens:create. This supersedes the prior assumption
that the user must manually supply a token. Verified the selected account against
the retained test plan and authenticated cf account membership before creation.

Created an account-owned token with only Workers Scripts Write and D1 Write,
resources restricted to the one test account, expires 2026-10-10T00:52:59Z.
Provider account-token verification reports active; Worker script inventory, D1
inventory and selected account GET each return 200/success. Token files live at
/home/tan/.config/cossack/acceptance-cloudflare, directory 0700/files 0600. Added a
conditional ~/.zshrc loader that preserves an existing environment export. Fresh
interactive zsh confirms availability. No credential value entered tool output,
argv, repository, commit or handoff. Token intentionally remains for authorized
CI until its provider expiry; it is distinct from cleaned test infrastructure.

Four disposable setup attempts: first stopped before Worker upload on placeholder
APP_URL; second uploaded then upload-index guard rejected .dev.vars.example;
third reached real hosted CI; fourth reached dispatch. Private fixture fixes use
the provider account subdomain/actual test Worker URL, exclude the example file
without relaxing secret guards, and use the account-owned token verify endpoint.
No framework/public CLI/template/API changes or repacking.

Actual hosted Vitest attempts each report **21 passed / 1 failed**, zero hosted
skips. First GitHub run fails without the cossack-preview-intent artifact;
missing journal is not evidence of successful preview creation. Next attempt
fails on workflow dispatch (GitHub operation receipt gh-19); the helper does not
retain failed-command stderr, so the underlying cause is unproven. No invented
permission/billing/tool diagnosis. Private job/log capture was added before
teardown for the latter attempt; no dispatched run was recorded. Future work must
preserve bounded actual GitHub failure diagnostics before deleting the repository.
Full success/failure/retry lifecycle and unchanged-production proof remain open.

Logs: /tmp/cossack-preview-ci-hosted-acceptance-20261009.log and
/tmp/cossack-preview-ci-hosted-second-20261009.log. Both terminal summaries have
ACCEPTANCE_EXIT=1/CLEANUP_EXIT=0. Four private cleanup-verified receipts under
/tmp/cossack-preview-ci-20261009-agent (failed-url-setup, failed-index-setup,
failed-hosted-first, current root) independently check Worker absence, owned DO
namespace absence, D1 UUID absence and repository absence. Current ownership
flags confirm parent, both databases and private repository cleaned. No live
CI/test resources remain; no production application promotion/publication.

Only release records change in the repository. Root/package typechecks were not
rerun for these prose-only edits; hosted test results are reported as failures,
not acceptance. Baseline reports/tool settings/two Workflow probes preserved.
REL-02 retains CF-09 dependency; REL-03 local Waiting/full CLI remains red;
REL-04/05 versioning/affected artifact checks/final audit remain gated. Desktop
remains complete with waived platform checks.

## Codex hosted preview CI and public-artifact completion — 2026-10-09

<a id="codex-hosted-ci-complete-2026-10-09"></a>

Author: **Codex**. **55 complete / 3 open. CF-09 and REL-02 complete against
original criteria; REL-03/04/05 remain open.** Versions remain 0.8.3. Desktop
remains complete by user decision, with its remaining platform checks waived.

One implementation agent exclusively owned the hosted CI fixture/tests, then
sequentially the provider/tests. Codex reviewed all changes, caught a malformed
REST-result regression, integrated fixes, owned cloud/GitHub operations and final
verification. User baseline reports.md, .zcodeignore and both Workflow probe files
are preserved and excluded from staging. No production promotion or publication.

### Repairs proven by actual provider behavior

The portable-tarball helper previously replaced pnpm-workspace.yaml and removed
the generated explicit esbuild/workerd approvals. Actual GitHub installation
failed with ERR_PNPM_IGNORED_BUILDS. Conversion now changes only owned package
references/overrides, preserving approvals, denied builds, comments, package
selection and other workspace settings. It uses scaffold's declared YAML
dependency, not an undeclared dependency in the CLI package.

Actual Cloudflare deployment bodies omit preview_id/preview_name. Normalization
now uses the validated paired native preview or immutable REST endpoint context,
while rejecting explicit foreign/null scope, absent deployment ID/tag and foreign
ownership tags. Explicit deployment names receive independent preview identity
verification. Malformed successful REST bodies return fixed diagnostics.

Actual Wrangler 4.148.0 also emits asset progress before --json output. The
provider accepts one complete trailing own-line object after textual progress;
competing envelopes, malformed payloads and trailing junk reject. Existing byte
limits, whitelisted results, exact creation identity, latest deployment/tag checks,
redirect protection and deletion confirmation remain intact. No raw bindings,
progress paths or exception values enter public results.

GitHub failures now have real private receipts containing bounded, known-secret-
redacted stdout/stderr/exit metadata; thrown messages contain only the fixed
receipt reference. Completed run metadata/jobs/check annotations/logs are captured
before artifact downloads and teardown. Diagnostic reads are best effort and
never retry uncertain dispatch POSTs or replace missing acceptance evidence.
Private directories/files use 0700/0600 permissions.

### CF-09 original criteria

The exact reviewed scaffold manual workflow was compared remotely at both refs.
All twelve installed tarball blobs, portable package/workspace/lock references and
private repository identity were verified before dispatch. Only the changed CLI
was repacked as its behavior changed; other packages were retained unchanged.
Final installed provider bytes match current source.

| Criterion | Actual hosted evidence |
| --- | --- |
| CI creates and smoke-tests preview | GitHub run 37875418537 completes success; intent deployed, final cleaned; independent preview GET404. |
| Failure preserves inspectable ownership | Run 37875541930 intentionally receives smoke failure; intent smoke-failed retains immutable preview/deployment/tag; final cleaned and GET404. |
| Cleanup can be retried | Run 37875641680 completes success after restoring the prior failure intent artifact; exact ownership remains in the final cleaned journal. |
| Separate staging resources | Distinct D1 UUIDs; production scope/visits remain production/0, staging changes staging/0→staging/2 through both hosted smokes. |
| Production remains unchanged | Before/after parent settings and active deployment are identical; production D1 sentinel/rows are identical. |
| Owned resources are cleaned | Both preview identities independently return404. Final Worker/two D1/known owned namespaces/private repository are absent; coordinator repeats independent reads. |
| Promotion and rollback scope | Existing reviewed guidance keeps production deployment/promotion separate and states that code rollback does not restore database/object state. No production promotion was performed. |

Private authoritative evidence: /tmp/cossack-preview-ci-20261009-agent/hosted/
evidence.json and verification.json (**passed:true, missing:[]**), per-run immutable
journals, provider snapshots and diagnostic receipts. Final cleanup-verified.json
records teardown; coordinator-cleanup-verified.json repeats five exact Cloudflare
404 reads, namespace inventory rejection of known owned IDs/preview references,
and independent private repository404. This is not a claim to delete unrelated
account resources. The scoped account token intentionally remains until
2026-10-10T00:52:59Z, outside the repository; it is not cleaned test infrastructure.

### Commands and results

- `pnpm --filter cossack exec vitest run tests/cloudflare-preview-hosted-ci.test.js tests/preview-service.test.js tests/cloudflare-preview-provider.test.js tests/preview-secrets.test.js`:
  **4 files / 159 passed / 1 hosted opt-in skipped**. Final log:
  /tmp/cossack-preview-ci-combined-final-20261009.log. The skipped hosted case is
  subsequently executed below, not represented as a local pass.
- Interactive zsh exports COSSACK_PREVIEW_HOSTED_CI_OPTIONS pointing to the private
  options.json, then `pnpm --filter cossack exec vitest run tests/cloudflare-preview-hosted-ci.test.js`:
  **28 passed / zero skipped**, actual three-run lifecycle. Log:
  /tmp/cossack-preview-ci-hosted-seventh-20261009.log. Terminal
  **ACCEPTANCE_EXIT=0 / DIAGNOSTICS_EXIT=0 / CLEANUP_EXIT=0**.
- `pnpm tsc --noEmit`: passes after final source changes; final log
  /tmp/cossack-preview-ci-final-root-types-20261009.log. CLI has no separate package
  typecheck script; unchanged packages retain their earlier ten-package evidence.
- At the preceding normalization repair,
  `COSSACK_PREVIEW_INSTALLED_ROOT=/tmp/cossack-preview-ci-20261009-agent/app pnpm --filter cossack exec vitest run tests/preview-installed-acceptance.test.js tests/preview-creation-native.test.js`:
  **2 passed**, including real native failed-deployment/empty-preview cleanup retry.
  Log: /tmp/cossack-preview-provider-fix-installed-20261009.log. Final asset-parser
  behavior is proven by the later actual hosted run, not retroactively by this run.
- Owned `git diff --check` passes, excluding unchanged user reports.md whitespace.
  No unchanged full browser/package suite repeats or unchanged package repacking.

Failed iterations remain failures: hosted-third fails on lost build approvals;
hosted-fourth exposes missing native scope fields and initially blocks safe
cleanup. After fixing normalization, source public cleanup independently recovers
exact latest ownership and confirms both previews absent before final teardown.
Hosted-fifth stops before dispatch because pnpm update normalized the private
manifest's required file:./ prefix; the private manifest is corrected and verified
before reprovisioning. Hosted-sixth exposes asset-progress text before JSON;
cleanup succeeds but acceptance remains red. A separately owned diagnostic
preview captures actual native output and is confirmed cleaned by the public
service. Their logs/private archived receipts remain under the same /tmp root;
all owned resources are absent. No assertion, ownership rule or requirement was
weakened to obtain the final green run.

### REL-02 original acceptance audit and remaining gates

REL-02's last API-changing feature dependency CF-09 now closes. Retained current
public import/example evidence remains valid: 200 export targets, 90 Bundler/88
NodeNext declaration imports, 74 Node imports, published helpers/providers,
representative generated applications and executable guides. Native database,
Workflow composite and hosted Deno installed compiled-artifact results retain
[their scope](#codex-svc04-waiting-provider-ci-2026-10-09). The changed CLI source is
now freshly packed, installed and exercised through actual CI; provider repairs
introduce no public declaration/example API changes. Other runtime/declaration/
guide payloads match the prior [artifact audit](#codex-release-gate-order-audit-2026-10-09),
with its explicitly recorded Studio CSS/asset names and build-cache variation.
This is not a claim of byte-identical Studio output or final 0.9.0 artifacts.

The original order permits REL-02 against current completed public APIs; REL-04
then aligns versions/ranges/lock/templates, rebuilds and reruns affected artifact/
install gates. REL-03 still lacks a green full CLI/runtime gate: strict local
Waiting remains red because Miniflare disables the native hibernation transition;
the expanded hosted Workflow experiment also remains red. Those baseline probes,
provider statuses and required assertions are preserved. REL-04/05 remain gated
on verification and final-version evidence. No complete release readiness claim.

The checklist, compact current plan/handoff, changelog and release notes are
updated once for this verified batch; historical failed checkpoints stay archived.
All 17 added local documentation links/anchors resolve, and the 58-ID checklist
count is verified as 55 complete / 3 open.

<a id="codex-workflow-lifecycle-agent-scenario-2026-10-09"></a>
## Codex — hosted Workflow lifecycle and installed agent scenario (2026-10-09)

**Tasks:** REL-03 acceptance and REL-05 scenario audit. **55 complete / 3 open**;
no numbered release task closes. REL-03, REL-04 and REL-05 retain their criteria.
Desktop remains complete by user decision, with remaining platform checks waived.

### Hosted Workflow acceptance

The current repaired harness executes once against the retained installed
production fixture. Its private copy extends only the event deadline to allow
native hibernation; it does not patch the provider, infer Waiting or change the
user-owned local probe. Native Wrangler OAuth is authenticated before deployment;
the narrow CI token is unset only in this child shell. No credential value is
printed or passed in command arguments. Fresh random resources have immutable
ownership receipts before cleanup.

Command, with the shell's existing Wrangler OAuth authentication:

```sh
COSSACK_WORKFLOW_WAITING_RETAINED_ROOT=/tmp/cossack-hosted-20261009 \
  pnpm --filter cossack exec vitest run tests/workflow-waiting-resolution.test.js
```

**5 passed / 0 skipped**, 733.75 seconds, exit 0. Private full output:
`/tmp/cossack-workflow-hosted-final-20261009.log`; immutable deployment, HTTP,
provider, timing, effect and cleanup receipts:
`/tmp/cossack-workflow-waiting-20261009-bLqE3W`.

Observed assertions:

- Retry barrier records first=1 and attempt=2 before the first untouched 330-second
  interval. Provider REST, native binding and public inspection then report literal
  `waiting`, with effects unchanged.
- Pause is sent once. One read reports `WORKFLOW_PROVIDER_UNAVAILABLE`, followed
  by actual `paused` inspection within the bounded poll. Resume is sent once.
  Read polling fixes the earlier immediate-failure experiment without replaying
  any uncertain mutation.
- After a second untouched 330-second interval, all three channels again report
  literal `waiting`. Invalid event input rejects; valid input completes the job.
  Final effects are approved=1, attempt=2, first=1, last=1.
- A separately invoked permanent-failure instance reaches `failed` with public
  `WORKFLOW_FAILED`; inspection contains no private payload/output/message.
- Guarded cleanup removes the receipt-matched Workflow, Worker, D1 database and
  owned Durable Object namespace. Independent coordinator `cf` inventories confirm
  all four absent, saved in `coordinator-cleanup-verified.json`.

This closes the expanded hosted experiment's missing lifecycle proof. It does
not prove strict local Waiting or a green full CLI suite. Original SVC-04 remains
complete at its already recorded composite scope.

### Installed cross-feature scenario 4

An implementation agent exclusively owns the two new agent-scenario fixture/test
files. Coordinator review corrects a trailing-separator workspace exclusion guard;
agent also adds authored-file snapshots around read-only checks and dependency-link
cleanup even when MCP close fails. Initial fixture assumptions about exported
package metadata and route/feature shape were corrected; no product defect or API
change was found. Final agent retest: **1 passed**, 28.74 seconds, evidence
`/tmp/cossack-agent-scenario-U6X7ai/verified.json`.

The harness resolves CLI, Scaffold, Framework, Core and Renderer from actual file
tarballs in `/tmp/cossack-preview-ci-20261009-agent/app`, rejects workspace
consumers/import paths, and creates a fresh private minimal app. It shares the
retained immutable installed dependency tree without changing the consumer,
installing packages or repacking artifacts. Seven actual CLI commands and real
installed MCP stdio execute the complete scenario:

1. Inspect the authored app without executing its deliberate top-level throw.
2. Obtain a real UI recipe dry-run and prove no authored files changed.
3. Apply the recipe while preserving an edited scaffold-owned page byte-for-byte
   and preserving its original owned-template baseline hash.
4. Run structured checks, verify the added recipe metadata, and compare actual
   CLI/MCP metadata and diagnostics exactly. Checks do not change authored files.
5. Add an invalid authored transport, compare matching CLI/MCP failure metadata
   and codes (`COSSACK_TRANSPORT_UNSUPPORTED`, `COSSACK_ROUTE_TRANSPORT_INVALID`),
   then remove it and prove matching green recovery. Detach dependencies after
   closing MCP.

This verifies installed composition/static inspection at **0.8.3**. It does not
claim UI rendering/browser acceptance, registry publication or final 0.9.0
artifacts. MCP remains read-only; recipe application uses CLI.

Coordinator combined command:

```sh
COSSACK_AGENT_SCENARIO_INSTALLED_ROOT=/tmp/cossack-preview-ci-20261009-agent/app \
  pnpm --filter cossack exec vitest run \
  tests/agent-release-scenario.test.js tests/workflow-waiting-resolution.test.js
pnpm tsc --noEmit
```

**5 passed / 1 hosted opt-in skipped**; the skipped hosted case actually ran and
passed in the separate hosted invocation above. Root types pass. Full logs:
`/tmp/cossack-release-workflow-agent-combined-20261009.log` and
`/tmp/cossack-release-workflow-agent-types-20261009.log`. No unchanged installed
acceptance, packing, broad unit or browser suites were repeated.

### Remaining scope and upstream blocker

[Criterion-level scenario audit](./release-0.9.0-scenario-audit.md) indexes the
five original cross-feature scenarios. Scenario 4 now has combined installed
proof. Scenarios 1, 2, 3 and 5 still need the listed compositions, not new product
features; individual completed-task evidence remains valid at its named scope.
Native workerd can prove scenario 2; no additional browser/hosted condition is
invented. Request-side API dispatch can satisfy scenario 3 without requiring a
specific decorator or garbage-collection instrumentation.

Strict user-owned local Workflow acceptance expects literal Waiting within
30 seconds and has a 60-second event timeout. Workspace Miniflare
4.20260722.0, retained 5.20261006.0-alpha, current stable 4.20260730.0 and latest
5.20261006.1-alpha distribution/source inspection reveal no path assigning native
Waiting. Current [upstream grace handler](https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/workflows-shared/src/lib/gracePeriodSemaphore.ts)
still omits its hibernation abort and uses five minutes. Cloudflare documents that
[remote Workflow bindings/development are unsupported](https://developers.cloudflare.com/workflows/build/local-development/).
Newer distributions were inspected, not installed/executed; no dependency upgrade,
provider patch, status substitution, weakened assertion or waiver is claimed.

Thus REL-03 still lacks a green full CLI/runtime implementation gate. After that
prerequisite, align versions and prove affected final artifacts before final
REL-03/04 completion; original REL-03 also requires final package versions.
REL-05 then audits every task and the remaining combined scenarios. Earlier
failed hosted checkpoints remain historical; only the current handoff/plan status
is updated. Unrelated user files remain untouched and unstaged.

Coordinator documentation check repairs four pre-existing historical index links
by adding explicit IDs to their original archived checkpoints; no historical
results or task counts are changed. All current checklist/plan/handoff/audit and
new archive-block local links resolve (514 checked). Numbered checklist count: 58 total,
55 complete / 3 open.

<a id="codex-cross-feature-scenarios-123-2026-10-09"></a>
## Codex — cross-feature scenarios 1, 2 and 3 (2026-10-09)

**Tasks:** REL-03/REL-05 cross-feature acceptance. **55 complete / 3 open**;
no numbered task closes. Scenarios 1–4 now have combined current-version evidence.
Scenario 5, the strict local Waiting/full CLI implementation gate, final 0.9.0
artifacts and final requirement audit remain. Desktop stays complete by user
choice; waived platform checks are not reported as passed.

Three implementation agents independently own one new fixture/test pair each.
Coordinator reviews every file and actual receipts, keeps shared APIs and records,
then runs one combined installed invocation and root types. No product/shared API
changes are necessary. Retained package payloads are reused without installation
or repacking; each new app verifies CLI/Scaffold/Core/Framework/Renderer manifests
at external consumer file-tarball paths with versions and SHA-256 receipts.

### Scenario 1 — protected resource and validated edit

Implementation: `packages/cossack/tests/fixtures/protected-resource-scenario.js`
and `packages/cossack/tests/protected-resource-scenario.test.js`.

One protected page composes public `server$`, typed rows, `defineUrlState`,
`@Server` input validation/authorization and client error/refresh handling.
Generated application `pnpm exec tsc --noEmit` and production Vite build pass.
Native workerd/D1 and actual Chromium demonstrate:

- The anonymous page is denied. A server-owned random cookie identity opens it
  and loads Alice/Bob rows from the typed server resource.
- Filtering sets browser `search=Alice`, records actual D1 reads by the same
  typed loader and changes visible rows. `updateUrlState` performs navigation;
  a query RPC is not falsely claimed.
- The edit with input `x` receives its authored server field error, retains `x`
  and leaves rows/effects unchanged.
- The accepted edit produces row version 1 and exactly one durable effect, then
  refreshes the filtered visible row.
- Anonymous replay of that same captured edit with forged user/permission client
  state rejects HTTP 401; durable rows and effects remain identical.
- Browser errors remain empty. Browser/harness close independently; private
  dependencies are removed even if one cleanup fails, with truthful receipts.

Final agent retest: **1 passed**, 11.12 seconds. Evidence:
`/tmp/cossack-protected-resource-cbCBTP`. Identity is synthetic and server-owned;
this is no real external authentication-provider or hosted Worker claim.

### Scenario 2 — two permitted users through two Workers

Implementation: `packages/cossack/tests/fixtures/realtime-release-scenario.js`
and `packages/cossack/tests/realtime-release-scenario.test.js`.

The generated app typechecks before its production build. Two actual native
Workers share the installed public `SseDurableObject`, use the public production
Page/SSE/RPC path and structural captured/revalidated fixture sessions. Assertions
join every scenario clause in one case:

- Alice/Bob are permitted in one team; each RPC result identifies its distinct
  executing Worker. Concurrent edits yield counts 1 and 2 and both live
  subscriptions converge on the same two authored effects.
- A denied identity and another scope cannot invoke/subscribe to the shared
  component. Forged client count/effects never enter the authoritative state.
- An actual TCP streaming caller receives a native yield, aborts, and the public
  `readRpcStream` reports `COSSACK_RPC_CANCELLED`. A subsequent Bob call succeeds;
  both subscribers converge to count 4 with exact effects. Cancellation does not
  promise rollback of the already observed yield.
- Another scope's live subscription receives its own positive control and state,
  with none of the shared private sentinel or forged updates.
- Native harness closes and its private app is removed. Cleanup records true
  only after actual successful close/removal, rather than unconditionally.

Final agent retest: **1 passed**, 12.96 seconds. Evidence:
`/tmp/cossack-realtime-scenario-jo6gvs`; log
`/tmp/cossack-realtime-scenario-installed.log`. Sessions are application-owned
synthetic identities, not a login-provider claim. Local native Workers satisfy
this original scenario; no browser UI or hosted condition is added.

### Scenario 3 — background retry and notification preferences

Implementation: `packages/cossack/tests/fixtures/background-release-scenario.js`
and `packages/cossack/tests/background-release-scenario.test.js`.

An installed CLI generates jobs/notifications composition. Native production
build, Wrangler binding generation (`types --env-interface CloudflareBindings`)
and installed application `tsc --noEmit` pass. Actual native Queue/D1 evidence:

- The request-side operation returns HTTP 202 before any consumer attempt starts.
  Only serialized notification ID and explicit tenant/actor context are queued;
  the request-owned prepared statement stays in the request operation.
- Controlled transient preferences failure records job retrying/attempt 1 with
  `JOB_TRANSIENT_FAILURE`, and notification queued/attempt 1 with
  `NOTIFICATION_PREFERENCES_UNAVAILABLE`.
- Actual native retry completes both jobs on attempt 2. The enabled in-app
  notification reaches `delivered`; opting out during the retry window records
  `failed`/`NOTIFICATION_PREFERENCE_DISABLED` and creates no delivered inbox row.
- Four actual Queue envelopes contain only the public versioned JSON job fields,
  notification ID payload and explicit IDs. Request, D1 binding and non-JSON
  request context inputs reject in three separate checks.
- Each attempt opens a consumer-owned facade and registers awaited release with
  `onCleanup`; all four cleanup rows are confirmed by bounded polling. D1 platform
  bindings have no close API; no binding closure or garbage-collection claim is
  substituted for the scoped-facade release.
- Native harness closes and the private application is removed.

Final agent retest: **1 passed**, 31.14 seconds. Evidence:
`/tmp/cossack-background-scenario-KOBvMD`. Scope is local native Queue/D1 and
in-app notifications; no external email delivery is claimed. The original
scenario permits a request-side server operation, without a mandatory decorator.

### Coordinator review, fixes and combined checks

Review corrections preserve all acceptance assertions:

- Reject workspace consumers and verify actual retained file-tarball origins.
- Isolate Vite caches with private dependency directories and per-package/tool
  links. Earlier whole-directory-link runs do not prove the retained consumer
  was untouched; that stronger preliminary assertion is retracted. Final helpers
  keep new caches private; no retained package payload was intentionally changed.
- Use truthful teardown receipts and clean private dependencies/apps when native
  cleanup fails. Final acceptance has successful cleanup, not a waiver.
- Observe job and notification state in one native D1 batch, require the exact
  transient notification state, and wait for actual cleanup receipts. Earlier
  mixed-time probe failure is a fixture observation race, not an inferred product
  defect. Terminal job state alone does not establish cleanup completion.

Combined command, using the retained installed consumer:

```sh
COSSACK_SCENARIO_INSTALLED_ROOT=/tmp/cossack-preview-ci-20261009-agent/app \
COSSACK_REALTIME_SCENARIO_INSTALLED_ROOT=/tmp/cossack-preview-ci-20261009-agent/app \
COSSACK_BACKGROUND_SCENARIO_INSTALLED_ROOT=/tmp/cossack-preview-ci-20261009-agent/app \
  pnpm --filter cossack exec vitest run \
  tests/protected-resource-scenario.test.js \
  tests/realtime-release-scenario.test.js tests/background-release-scenario.test.js
pnpm tsc --noEmit
```

**3 files / 3 passed / 0 skipped**, 31.29 seconds, exit 0. Root types pass,
exit 0. Logs: `/tmp/cossack-cross-feature-combined-20261009.log` and
`/tmp/cossack-cross-feature-root-types-20261009.log`.
Coordinator inspects final combined verified/cleanup receipts:

- `/tmp/cossack-protected-resource-lSWhqR`: browser/harness closed; dependencies detached.
- `/tmp/cossack-realtime-scenario-2Trn1u`: native harness closed; app removed.
- `/tmp/cossack-background-scenario-fpaiUb`: native harness closed; app removed.

All used packages remain **0.8.3**. No broad unchanged suites, scenario-4 or hosted
Workflow repeats, packing, installation or cloud writes. These current-version
proofs do not establish final 0.9.0 artifacts or a green full CLI release gate.
The strict user-owned local Workflow probe stays unchanged, with its upstream
blocker retained; no provider patch/status inference/waiver.

Checklist, current plan, scenario audit and handoff are updated once for this
verified batch. The next independent criterion is scenario 5's actual hosted
CI migration plan/apply and protected asset/RPC checks, preserving production
and proving cleanup. Existing CF-09 simple hosted smoke is insufficient for those
additional assertions. Original feature completions retain their evidence;
REL-03/04/05 stay open. User reports/tool settings/baseline probes stay unstaged.

Coordinator documentation validation: **523 local links/anchors resolve**, all
58 numbered checklist rows account for 55 complete / 3 open, and owned-file
syntax/whitespace checks pass. Only the six new acceptance fixture/test files and
five release-record files belong to this batch; unrelated user files are excluded.
