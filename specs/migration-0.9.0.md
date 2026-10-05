# Draft 0.9.0 migration guide

This is a working record of verified behavior changes. It is not yet a complete
release migration guide. REL-04 must audit the full release checklist, add every
remaining break, compile its examples, and verify package installation before
publishing 0.9.0. Package versions remain 0.8.3 while that work is open.

## Authenticated SSE requires live session revalidation

Add `realtime: { key, capture, validate }` to your `createAuth` provider before
opening authenticated SSE pages. The generated `src/auth.ts` now supplies it.
Port those helpers after applying `0008_add_session_public_id`; upgrades preserve
application-owned auth files. HTTP login/session middleware without this option
still works, but opening an authenticated `/sse` connection returns HTTP 409
`COSSACK_REALTIME_AUTH_REQUIRED` rather than keeping a stale actor indefinitely.

Use a stable provider key and a bounded server-only JSON descriptor. Capture an
independent session reference plus a fingerprint of the token; validate live
storage, purpose, expiry and the current fingerprint before returning the owner.
A reference alone survives rotation and is insufficient. Never retain a bearer
credential in the descriptor or expose its fingerprint to a browser.

SSE rechecks current user/roles, inherited guards and scope before every frame
and heartbeat in fresh request/config/database scopes. Credential headers are
removed, the subscription locale is retained, and late response-header/cookie
writes reject. Make guards read-only and use the revalidation provider rather
than reading the original session cookie. A denial closes EventSource with fixed
`COSSACK_REALTIME_AUTH_CHANGED` feedback and stops retries until explicit reload.
Rotation affects subscriptions in every tab sharing that cookie. A validated
frame can still be in flight; idle checks depend on heartbeat reader demand and
storage response time. WebSocket freshness is not included in this change.
Read the [SSE provider contract](../docs/sse.md#session-changes-on-an-open-subscription).

## Shared credential and session primitives

Generated `src/auth.ts` now consumes `createCredentialVerifier`,
`createSessionManager` and the shared password helpers from the auth package.
Port the generated storage callbacks when updating an existing application.
User models, role lookup, password reset and database selection remain app-owned.

Password hashes now use `pbkdf2-sha256$iterations$salt$digest`. The old
`pbkdf2$salt$digest` encoding is rejected. Reset existing passwords or explicitly
migrate records whose algorithm, work factor and canonical salt/digest sizes are
known. Do not guess missing parameters. Default hashing remains 100,000 iterations;
the [primitive guide](../docs/auth-primitives.md#password-hashes) records Workers
limits and configuration choices. Inputs are nonempty and at most 1,024 UTF-8
bytes; they are never truncated or normalized.

New auth session tokens contain 32 random bytes rather than UUIDs. Existing
valid UUID tokens can still be read; validation checks their auth purpose and
original timestamps. Time fields in `AuthSessionRecord` are Unix milliseconds.
Translate database Date fields at the storage boundary. Exact expiry is invalid,
validation does not refresh lifetime, and `rotate` invalidates the previous token
through one conditional replacement. Apply returned cookie headers only after
the storage operation succeeds.

Generated rotation and logout use the canonical `{"type":"auth"}` metadata.
If an existing store uses another JSON representation, adapt its conditional
matching or explicitly normalize those records. Keep password-reset and other
token purposes separate. Hash upgrades also need an atomic expected-hash match.

`AuthError` exposes fixed codes, stages and messages for shared primitive
operations. Raw crypto, database and mapping exceptions are discarded. A failed
operation does not undo a storage side effect that already committed.

## Session dashboard references

Apply `0008_add_session_public_id` before deploying the updated auth application.
It adds a nullable `public_id` column and unique index without changing bearer
tokens or the existing `0002_create_sessions` migration. Port `Session.publicId`,
the generated auth storage/management helpers, the sessions page and the
dashboard layout's `requireDashboardUser` middleware. Template upgrade planning
preserves locally edited files; merge these changes explicitly when needed.

New auth rows receive independent random public references. Existing canonical
auth rows receive one on their first management request through a conditional
assignment and re-read. Rotation preserves the reference. Reset and OAuth-state
rows can leave the column null. Do not copy or derive a reference from a bearer
token. Noncanonical auth-purpose metadata requires the normalization described
above before legacy backfill or conditional management writes.

`SessionInfo.id` becomes `SessionInfo.reference`; arbitrary `meta` is removed
from the public DTO. Replace the old user-ID/token arguments with
`listUserSessions(c)`, `revokeSession(c, reference)` and
`revokeAllUserSessions(c, keepCurrent = false)`. The context must pass through
auth middleware. Ownership comes from its authenticated user, never RPC state.
Single revocation returns a boolean, rejects the current session and checks
purpose/owner/expiry atomically. Keeping the current session also checks its
stable reference so concurrent token rotation cannot expose it to bulk deletion.
Bulk management deletes auth rows only. Password reset retains its separate,
intentional account-wide token invalidation policy.

Dashboard RPCs now require the layout's authenticated-user guard. Session-page
storage failures use fixed messages. If a delete commits and a later list fails,
the delete remains committed. Sessions-only dashboards use an empty application
seeder instead of importing unselected role models.

The auth recipe no longer auto-registers the separate framework session bag.
Authentication still uses its own persistent `session_id` cookie. Applications
that call framework `session()` must explicitly register the exported
`sessionMiddleware` after ORM middleware, scoped to routes that need it.
Public static pages must not use middleware that issues visitor cookies.
Read the [session guide](../docs/session.md) for registration and the auth bridge.
Standalone SSG rendering now installs the same bare translation/config helpers
as the SSR entry before component lifecycle hooks run.

## Generated auth drafts and action contracts

Generated login/register/forgot/reset pages now use `ClientStore` and client-only
validation. Replace public `Store` or `State` credential fields with browser-owned
drafts. The server receives credentials only in an explicit submission object.
Add the app-owned `src/auth-input.ts` contracts when porting the new pages.
`cossack upgrade` preserves edited files; changing dependencies does not migrate
an application's auth pages.

The generated action signatures change from positional arguments to one object:

```typescript
await this.login({ email, password });
await this.register({ name, email, password });
await this.requestReset({ email });
await this.doReset({ token, password });
```

Each action declares `@Server({ input })` and parses the same schema inside its
body for native calls. Unknown fields, invalid shapes and extra RPC arguments
reject before storage. Passwords keep their original bytes and must fit the
shared hasher's 1024-byte UTF-8 limit. Fixed messages replace arbitrary caught
exception text; the register page preserves only its known duplicate-account
message. Reset-request confirmation stays generic.

The sessions dashboard adds `rotateCurrent()`. It applies the replacement cookie
and redirects before listing through the next request. Its public reference
remains stable. Dashboard logout uses fixed failure state and clears the cookie
only after revocation succeeds. Apply these layout changes as well as auth pages.

Account writes, token consumption and response delivery are separate steps.
Registration may have created the account when session creation fails. Reset
may have consumed the token or updated the password before a later failure.
An error is not proof of rollback. Read the [auth failure guidance](../docs/authentication.md)
before adding retries or transactional behavior.

## Explicit public old input

`getFormData()` no longer flashes submitted values by default. Nonempty
validation errors remain automatic; `flash: true` also means errors only.
Replace `flash: { input: true }` with an explicit public-field list, for example
`flash: { input: ['name', 'address.city'] }`. `flash: false` disables both
categories and `errors: false` still disables errors. The no-rules overload now
correctly returns the parsed DTO when options contain only a flash policy.

Manual calls require `flashInput(data, { fields: ['name', 'address.city'] })`.
Older JavaScript calls without the policy retain no submitted values.
`flash()` calls cannot write the reserved `__input` namespace; migrate such
calls to `flashInput()` before upgrading. Whole object branches are no longer
copied: select nested leaves. Scalar arrays are
copied; object arrays need numeric leaf paths such as `contacts.0.label`. Files,
Date values, accessors and other unsupported values are omitted. Selected values
are detached from later source mutations. Parsed/validated server data is intact.

The cookie is signed, not encrypted. Common credential names are excluded even
if selected, and `old()` also excludes those names from older signed payloads.
Unknown custom secrets must remain outside the public field list. Keep that
list in server code and do not place credentials in arbitrary flash/error
messages. Read the full [selection and cookie contract](../docs/session.md#flash-and-old-input).
Merge the explicit field policy into application form recipes before upgrading.
This does not make previously issued cookies secret-free or durably single-use.

## Atomic OAuth state storage

Cookie-based `createOAuth` now requires `stateStore`. Its `create` callback
inserts the library's provider-scoped digest and absolute timestamps. Its
`consume` callback atomically removes a matching unexpired record and returns
boolean true for one winner only. Missing or incomplete stores fail at the type
and runtime boundaries. The explicit `stateless: true` mode has no state store
and remains responsible for its own CSRF and replay protection.

Port generated `oauthStateStore` from `src/auth.ts` when upgrading existing
OAuth applications. It uses anonymous `sessions` rows with canonical
`{"type":"oauth_state","provider":"..."}` metadata and one conditional SQL
delete. The existing sessions schema needs no new columns. Reset and auth rows
cannot satisfy this state purpose. Expired abandoned records need app cleanup.

Old signed cookies have no registered server state and are rejected. Users must
start a new authorization flow. State remains consumed if provider exchange,
profile processing or account mapping fails; retry through a new redirect.
Use `COSSACK_OAUTH_STATE_UNAVAILABLE` for used, expired or missing records and
the `state-create`/`state-consume` stages for safe storage diagnostics.

## OAuth failure diagnostics

OAuth `onError` now receives `OAuthError` instead of an arbitrary thrown value.
Branch on `error.code` or `error.stage`; use `error.toJSON()` for safe logs.
Raw provider bodies, descriptions, status text and exception causes are omitted.
An upstream HTTP rejection exposes only its numeric `providerStatus`.

Default responses include `error`, `code`, `stage` and `status`. Invalid callback
parameters and state return 400, denied consent returns 403, provider exchange
or profile failures return 502, and configuration or application mapping failures
return 500. Generated missing-configuration responses also use this contract.
Replace checks for the old generic 502 or generated 503 response.

Rejected callbacks clear the state cookie. The separate required state store
provides atomic consumption before provider exchange. Session middleware
continues as a guest after extraction, validation or user lookup exceptions and
logs a fixed stage code. Raw exception details are no longer logged.

## File routes and boundary identities

Remove `route` from `@Page` and `@Component` options. This declaration never
registered an alternate URL. Place the page file under the desired `src/pages`
path. No in-repository callers require conversion. Published types now reject
the option. JavaScript callers receive `COSSACK_ROUTE_ALIAS_UNSUPPORTED` before
the framework reads its value. Static inspection reports the unsupported option
without executing the initializer.

404 and error components now retain separate source IDs across route groups.
Their source paths identify them for hydration and transport reconstruction.
Do not persist generated `cmp_*` values across builds. Rebuild server and browser
assets together. Boundary `routePath` metadata now contains the full source path.
Boundaries remain excluded from public typed URLs.

For unknown URLs, selection uses matching effective source prefixes. Equally
ranked disjoint groups fall back to a common ancestor. Boundary and layout guards
run before rendering. Already-entered source middleware runs once per request.
The browser accepts server-selected 404/500 documents and does not cache them
as successful pages. Plain error documents still fail navigation. Read the
[boundary guide](../docs/routing.md#unknown-urls-and-boundary-identity) for examples.

For CLI explanations, replace a public boundary pattern such as `/404` with the
exact source path. `COSSACK_ROUTE_BOUNDARY_SOURCE_REQUIRED` lists the candidates.
Normal public route explanations retain their existing syntax.

## Browser query context and history

Browser `this.c.req.query()` now reads the component's resolved destination.
During navigation bootstrap, it no longer reads the previous address while
history waits to commit. `this.c.req.url` exposes that same destination. Initial
hydration retains the visible browser fragment. Retained layouts receive the
new URL when their path updates.

Use `defineUrlState` for typed query defaults and serialization. Choose
`this.navigate(path, { history: 'replace' })` to replace the active history entry.
Existing calls create a new entry. Read the [URL-state guide](../docs/url-state.md)
for the API and the remaining RT-08 integration work.

For overlapping query edits, use `this.updateUrlState(definition, patch, options)`.
It merges against the latest live pending intent. Constructing a URL from the
committed request for each overlapping edit can lose an earlier field change.
Client navigation now prepares pages and new layouts before publishing them.
Framework tasks, connections and mount hooks start at publication. Latest local
drafts transfer immediately before those hooks. A custom bootstrap override runs
before that point and must not assume visibility or transferred drafts.
Asynchronous navigation waits have a 30-second budget and report
COSSACK_NAVIGATION_TIMEOUT. Superseding a stalled bootstrap lets a newer page
complete. Arbitrary application effects after publication cannot be rolled back.

Navigation now keeps the outgoing page alive until rendering and history commit
succeed. Failure before commit restores framework-owned tree, context, resource
and SSR state. Pending resource reads can reload after recovery. Application
side effects and nested state already removed by DOM teardown are not restored
by this mechanism. Errors after history commit leave that destination current.

Core owns navigation rendering and propagates render errors into the navigation
failure path. Unrelated pending App update promises no longer block it. Use render
and lifecycle hooks for customization; requestUpdate/performUpdate overrides are
not navigation synchronization hooks. An App shouldUpdate veto fails navigation
with COSSACK_NAVIGATION_RENDER_SKIPPED instead of reporting a completed render.

Local draft transfer now copies plain records and arrays instead of sharing their
raw targets with the disposed page. Cycles, aliases and native File identity are
preserved. Native/class/function values remain opaque references. Accessors in
draft records fail before publication with COSSACK_NAVIGATION_DRAFT_ACCESSOR.
Move computed getters to the component and retain data properties in the draft.

Same-page query navigation now preserves declared ClientState/ClientStore drafts,
including local File values, when ownership matches. Browser file-input DOM
values remain empty after page replacement. Copied URLs and unrelated pages
start new drafts. Retained layout resources adopt matching SSR data without
another hydration RPC; late old results cannot overwrite the new query.

Guarded back/forward now restores the prior Cossack-owned history entry.
Confirmation resumes the original traversal without adding an entry. Failed
fetches or module imports restore the entry before the navigation error event.
Preserve `history.state.__cossackNavigation` when adding application history data.
Foreign or overwritten positions cannot be inferred; restoration failures use
`COSSACK_NAVIGATION_HISTORY_RESTORE_FAILED`. See the
[history guard contract](../docs/prevent-navigation.md#guards-during-back-and-forward).

## Rate-limit configuration and counters reject invalid values

An explicit `rateLimit`/`RATE_LIMIT` now requires a supported non-empty string
and valid backend bindings or credentials. Missing bindings and unknown modes
throw instead of silently switching to memory. Selection belongs to the current
request environment; another request's configuration cannot choose its store.
Configuration/binding/credential changes are read on the next evaluation.
Unconfigured requests use the process memory default. A manual
`setRateLimitStore` remains an intentional process-wide override; register it
once for a fixed backend, rather than changing it for each request.

`configureRateLimitFromEnv(env)` now returns the selected store without changing
a global backend. Internal integrations that inspect it should use the return
value or `getRateLimitStore(env)`. Without an environment, `getRateLimitStore()`
returns the manual/default store. Shared socket components evaluate limits using
the action context's environment, with their bootstrap environment as fallback
only when no context environment is supplied.

`window` requires positive safe-integer milliseconds; `max` requires a
non-negative safe integer, with zero denying all calls. Key functions must return
non-empty strings. Invalid options reject before touching a counter. All counter
replies require positive safe-integer counts and positive epoch-millisecond reset
times. Corrupt KV records, malformed Redis/custom replies and invalid Redis TTLs
reject before mutation rather than restoring a caller's budget. A backend may
have counted an attempt before its invalid/error reply; no retry or rollback is
implied. The explicit Redis environment helper no longer borrows process
credentials when its supplied environment lacks them.

Redis now uses PEXPIRE and millisecond durations, without whole-second rounding.
KV storage retention has a minimum of 60 seconds, while its stored millisecond
deadline determines the logical window. KV still cannot guarantee exact counting
across regions or sustain more than one write to a key per second; write failures
reject. Provider inspection and required-guarantee checks are documented in the cache
and rate-limiting guides. Actual native pre-header disconnect delivery remains
an RT-01 acceptance gap.

## Counter decisions own a deadline and bounded replies

Framework counter decisions now expire after 5000 ms by default. Set
`@RateLimit({ backendTimeoutMs })` (or the handler wrapper option) to choose a
positive safe-integer deadline up to `2147483647` ms. This is separate from the
window and a client method timeout. Async built-in stores support the optional
third `hit` argument `{ signal, timeoutMs }`. Custom stores receive it too, but
framework enforcement races them even if they ignore the signal. Direct custom
store calls must provide their own ownership policy.

DO/Redis JSON replies now reject above 8192 bytes, on malformed UTF-8, or before
a valid EOF. KV text records have the same encoded byte cap before parsing.
HTTP error and late response bodies are cancelled; readers release locks.
Cleanup does not wait indefinitely for a producer's cancel callback. Stalled
providers reject without action mutation, retry or rollback of a charged hit.
Observed HTTP request abort and socket cancellation/close stop a pending decision
from invoking its action. In-flight writes or already started application work
can still finish. Cloudflare incoming disconnect signals require the
[`enable_request_signal` compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-requestsignal-for-incoming-requests).
Native coordinator queued cancellation remains a separate gate.

HTTP, multipart and service proxies send a UUID v4 `X-Cossack-Request-Id` from
dispatch. The transport guard accepts a valid UUID v4 and generates a fresh ID
for absent/unsupported input. IDs now survive cancellation/deadlines before
response headers; a returned server ID remains authoritative. These public IDs
are not identity assertions. Origin and route authorization checks still run.
Custom XMLHttpRequest doubles used with component upload progress must implement
`setRequestHeader`.

## Durable Object rate limits persist through eviction

`RateLimitDurableObject` now commits each counter and its fixed reset deadline
to transactional storage. Reconstructing the object no longer restores a spent
budget. Active windows retain their deadline when a caller requests a different
duration; the new duration takes effect after expiry. Expiry alarms remove old
records and do not shorten a newer window.

DO windows must be positive safe-integer milliseconds within the alarm timestamp
range. Invalid direct requests return 400/`COSSACK_RATE_LIMIT_CONFIG_INVALID`;
`DurableObjectRateLimitStore.hit()` rejects invalid windows before contacting the
binding. Corrupt records and malformed replies reject rather than reset budgets.
Storage failures reject before action mutation. Counter validation now also applies to other providers; capability inspection
and cache duration conventions remain under the RT-18 audit.

Create new namespaces with `new_sqlite_classes`. Keep existing migration history;
the transactional key-value implementation also supports legacy DO storage.
Unit fixtures must supply transactional storage and alarm methods; an empty fake
`DurableObjectState` is no longer sufficient. Existing in-memory windows cannot
be recovered during the first upgrade; subsequent windows are persisted.

## Ordinary RPC results no longer appear as generator yields

Ordinary HTTP/SSE component calls previously yielded their JSON return value
once. WebSocket and explicit service calls returned it only at completion.
All transports now keep ordinary results in completion, matching
`RpcCall<Result, never>`. Async generator actions still yield their incremental
values and return their final result separately.

Replace a loop that consumes an ordinary method's single result:

```typescript
// Before: depended on HTTP/SSE's extra yield.
for await (const result of this.save(input)) {
  this.savedId = result.id;
}

// After: completion works across transports.
const result = await this.save(input);
this.savedId = result.id;
```

If the action is a generator, keep one call and iterate then await it:

```typescript
const call = rpc$(this.generate(3));
for await (const progress of call) {
  this.progress = progress.step;
}
const result = await call;
this.total = result.total;
```

Import `rpc$` from `@cossackframework/core` and use it in a client handler.
The helper infers the authored generator's yield and terminal types; it returns
the existing proxy operation by identity. It is not a wrapper for native server
execution. See [the complete client contract](../docs/rpc.md) for cancellation,
duplicate consumers, broad iterable annotations, and native Response types.

## Streaming writes now reject after headers finalize

Late cookie, flash, and `c.header` writes previously appeared to succeed even
though the browser could not receive them. They now throw
`COSSACK_RESPONSE_HEADERS_COMMITTED`. Session `bindUser()` and `destroy()` also
reject before changing storage. Move these writes into an ordinary async server
method before returning a generator. Generator bodies execute lazily after
middleware finishes, including statements before the first yield. Session bag
writes that do not change cookies retain their storage behavior.

## Native responses require HTTP/SSE actions

WebSocket actions returning native `Response` objects now fail with
`COSSACK_RPC_HTTP_RESPONSE_REQUIRED`, instead of silently returning `{}`.
Return serializable data or use an HTTP/SSE action for HTTP response behavior.
Nested `Response`, `Request`, and `Headers` objects in serialized RPC values
now produce a path-specific `COSSACK_RPC_SERIALIZATION_FAILED` error.

Native HTTP/SSE RPC redirects become client navigation metadata. Response cookies
are preserved alongside helper and flash cookies. Valid flash survives background
transport requests until the next page; RPC HTTP failures discard partial outgoing
flash. Stream errors after headers finalize cannot retract previously sent cookies.
See [RPC examples and timing](../docs/rpc.md).

## Typed server input contracts

Use `@Server({ input: contract })` with an `input` schema and annotate the
native method or public function-field parameter with `InputOf<typeof contract>`.
Plain action rule maps are removed in 0.9. TypeScript rejects them; stale
JavaScript metadata fails before callbacks or mutation with a private migration
error. Form rules (`@Validate`/`storeRules`) retain their existing API.
See [the schema contract](../docs/validation.md).

Standalone schema and form helpers are available from
`@cossackframework/core/input`. This entry keeps component and runtime imports
out of the helper graph. Existing imports from the core root remain available.

When migrating a rule map, declare every accepted key and nested/file shape.
Unknown keys now fail by default; opt into `unknownKeys: 'strip'` where dropping
extra keys is intentional. Use `.optional()` and `.nullable()` explicitly.
Typed contracts accept one positional argument. Number/boolean coercion rejects
ambiguous values instead of silently accepting them; date coercion requires a
canonical UTC ISO string. Objects/arrays are cloned instead of being changed in
place, and object results have no prototype.

Shared client `storeRules` can supply string constraints to a separate private
server schema. The generated mutation recipe uses this pattern. Keep the schema
private: the compiler removes its unused module dependencies and rejects a local
contract retained by runtime client code or exports. Expected `.refine()` failure
returns nested field errors. An exception remains an internal error. Use the
callback's signal for I/O cancellation and put writes in the actual action.

Refinement and resource policy/lookup exceptions remain internal even if their
class normally produces a public RPC or HTTP error. Their original cause stays
available in server logs. Return `false` from a refinement/policy for its expected
failure; use the kit's explicit authorization methods for fixed 401/403 denials.
Intentional `ClientVisibleError` exceptions in action bodies retain their normal
public behavior.

Native server calls retain their authored signature and do not run decorator
validation. Public function fields use the same parsed parameter checking;
their native return type remains unchanged. Private/protected fields cannot use
this schema decorator inference. Keep actions public.

`RawInputOf` describes boundary values and does not widen native or browser
method parameters. Normalize form strings before calling an authored method.
Native API handlers explicitly parse their request values before use. Use
`@Server({input:contract,authorize:policy.action('edit',lookup)})` for RPC resource
access; native handlers/reads explicitly call `policy.authorize`. The
[resource kit](../docs/authorization.md#typed-resource-policies) is implemented.
Session freshness and the final release gates remain separate.

## Service RPC keeps internal exceptions private in development

Service actions previously returned internal exception messages and stacks to
clients when development mode was active. They now return `Internal Server Error`
with `COSSACK_RPC_INTERNAL_ERROR` and the request ID, matching component and
WebSocket calls. Inspect server logs for the original exception. Use
`ClientVisibleError` for a deliberate message or action validation for field
errors that callers should receive.

## Client RPC types now describe JSON values

`rpc$`, `RpcResult`, and `RpcYield` now use `RpcSerialized<T>` for returned and
yielded data. A Date becomes a string, array entries containing undefined become
null, undefined object fields disappear, model prototype methods disappear, and
typed `toJSON()` output replaces the native class shape. The compiler's recognized
return annotations delegate to these same core types.

Replace native Date use in client completions with explicit parsing:

```typescript
const result = await rpc$(this.loadRecord());
const createdAt = new Date(result.createdAt);
```

Non-finite numbers, invalid Dates, binary and opaque native values now reject
instead of silently becoming null, empty objects, or numeric-keyed records.
Custom JSON output is evaluated once and validated before encoding. WebSocket
File/Blob arguments reject before dispatch; they are no longer silently removed.
HTTP component file uploads use multipart arguments through the shared action dispatcher. Ordinary
multipart result serialization and private-error redaction match JSON RPC.
Root result JSON hooks receive the empty key consistently across transports.

## HTTP generator completion validates the response ending

HTTP/SSE component and service calls now wait for response EOF before exposing
the terminal result/error. A terminal frame followed by data or a body failure
rejects instead of reporting success and hydrating final state. Yields remain
incremental; previously applied progress is retained. Custom response producers
must close after the terminal frame. Deadlines and cancellation remain active
while awaiting EOF. Frame IDs must match the response's request-ID header when
present. Malformed data retains the known ID for diagnostics.

WebSocket calls complete at their correlated terminal frame; their shared
connection stays open. Unknown IDs do not affect a different pending call.

## Ordinary JSON RPC replies are validated before hydration

Clients now reject malformed service state, redirect metadata, and HTTP error
fields instead of silently completing or copying untyped diagnostics. Custom
producers must provide an object `_cossack_service_state` on ordinary service
successes. Component replies cannot contain that service wrapper. Redirects
must contain only a nonempty `_cossack_redirect` using HTTP/HTTPS or a relative
URL. Error codes/IDs must be nonempty strings, messages strings, and field errors
objects. An error body ID must match the response ID when that header exists.
Application component state named `requestId` remains ordinary state data.

The total ordinary JSON/error body limit is 1 MiB, including envelope metadata,
state and results (`RPC_JSON_RESPONSE_MAX_BYTES`). Overflow reports
`COSSACK_RPC_RESPONSE_TOO_LARGE`. Move larger results to an HTTP endpoint.
Decoding now requires valid UTF-8 and waits for EOF with deadlines/cancellation
active. Invalid envelopes report `COSSACK_RPC_RESPONSE_INVALID` and the known
request ID before hydration. Native failure bodies remain opaque even when
JSON-shaped; non-JSON middleware errors keep generic HTTP status diagnostics.
None of these client rejections undo a completed server mutation or retry it.

## WebSocket actions use each connection's request context

Anonymous Cloudflare sockets no longer become `user:anonymous` for rate limiting;
they have no user and use their captured IP headers. Custom keys can read the
socket's own headers and page params. Node/Deno shared components also use the
originating connection's context instead of their first peer's headers.

Cloudflare reconstructs action context from the native socket attachment;
Cookie/Authorization, common credential and internal assertion headers are
excluded. Custom headers and query values are retained. Keep credentials out of
those values. The snapshot supplies user/env/read-request facilities, not an
HTTP middleware scope or per-message session revalidation. Existing connections
without metadata reject calls and close with 1012 for reconnect. Oversized
snapshots fail upgrades with structured 413 rather than silently dropping headers.
The runtime adapter upgrade contract adds optional `context`; the framework
supplies it with decoded page params, and built-in adapters pass it per socket.
Custom process runtimes can pass context as `addClient(client, user, context)`
or provide `getContext` in runtime options. Counter backend persistence and
consistency guarantees are unchanged in this checkpoint.

## RPC limits and child state ownership

`@RateLimit` now applies to WebSocket action execution, including inherited and
forwarded service methods. Rejections use `COSSACK_RPC_RATE_LIMITED` and the
request ID; HTTP responses retain 429 and `Retry-After`. HTTP limiter JSON bodies
now include the stable code. Canonical route/action ownership prevents changing
transport or request IDs from restoring the same shared-store/caller budget;
page and child classes no longer charge each other for same-named methods.
Existing rate-counter keys change, so counters start fresh after this upgrade.
Anonymous identity/header availability and store consistency remain runtime
constraints described in [rate limiting](../docs/rate-limiting.md).

Process-local SSE publishes the page root's snapshot after child actions.
Child-local state no longer overwrites page keys with identical names. Invalid
target metadata rejects before dispatch, and missing/forbidden targets carry
the same correlated diagnostic codes as WebSocket actions.

## Native HTTP RPC responses have an explicit client result

Successful ordinary HTTP/SSE component and service actions returning `Response`
now resolve to a local buffered browser `Response`, instead of parsing the body
as framework state. Text, JSON, binary and 204 responses work. Component uploads
preserve binary bodies and browser-visible headers. Use `response.text()`,
`json()`, `blob()` or `arrayBuffer()` after checking for undefined: native redirects
navigate and complete with undefined. `RpcResult` now infers `Response | undefined`.
Non-success HTTP statuses still reject with status/request-ID diagnostics.

Native bodies are consumed before the RPC completes, with a 1 MiB limit,
`COSSACK_RPC_RESPONSE_TOO_LARGE`, cancellation, deadlines and request cleanup.
The local response has no original fetch URL or redirect flag. Repeated awaits
share the same one-use body; clone it before multiple reads. Native response
bodies never hydrate component/service state. Prefer typed data returns for
state synchronization or use an HTTP endpoint for large or continuous bodies.
Generator Response values remain unsupported; their inferred terminal result
is now never rather than unknown. WebSocket rejection cancels the native body.

## Multipart actions use the shared RPC pipeline

File arguments in HTTP/SSE component or explicit scoped service calls now use
the same action dispatcher as JSON. Nested references are restored before input
validation; layout services, request/ORM context, generator replies, cookies,
redirects and cleanup follow the existing RPC contract. Duplicate metadata/file
parts, missing or malformed markers, invalid JSON and envelope shapes reject
with `COSSACK_RPC_REQUEST_INVALID` before actions run. `_cossack_file_id` is a
reserved multipart payload field. Malformed JSON RPC envelopes use the same code.

Component uploads use Fetch unless a numeric `<method>Progress` field requests
XHR progress events. Prefer `@ClientState` for that field. XHR generator replies
are decoded progressively at complete lines; native binary replies still use
arraybuffer. XHR retains downloaded text and cannot apply download backpressure;
use the default Fetch path for long streams. Service uploads use Fetch. Files and
FileList/arrays are arguments only, not JSON state or returned values.

Cancellation between yields now preserves a known request ID on component,
service and WebSocket calls, including iterator return. IDs can still be unknown
before HTTP headers arrive. Cancellation never implies mutation rollback or
automatic retry.


## Storage guarantees and limiter key migration

Cache and rate-limit stores expose validated capability declarations. Required
shared/durable/strong/atomic/millisecond guarantees reject if unsupported or
unknown, before operations. KV is not atomic; DO cache get/set is not an atomic
increment. Database deployment traits and Redis persistence remain unknown.
Custom providers can declare their own traits; declarations do not probe remote
services. See [cache](../docs/cache.md#required-guarantees-and-inspection) and
[limiter](../docs/rate-limiting.md#required-storage-guarantees) examples.

Framework scope/caller and KV/Redis namespace/key tuples replace concatenated
limiter keys. This creates a fresh budget once on deployment. Coordinate mixed
versions to avoid independent quotas; old records follow their prior expiry.
Keys/namespaces must be valid bounded UTF-8; final KV/Redis keys are capped at
512 bytes. Memory saturation rejects new keys without forgetting live quotas.
Redis REST URLs now require HTTPS without credentials/query/fragment, and manual
redirect responses reject. Tokens must be bounded ASCII bearer tokens.
Null/malformed/misspelled limiter options now fail instead of bypassing limits.


## Typed server resources and dependency-aware hydration

Add the names of public server$ fields to the second Cossack type parameter:
`Cossack<Env, { Resources: 'users' | 'selected' }>`. Lifecycle methods then check
those names and infer status values from the fields, including null/undefined.
Combine `Resources` with existing `Channels` options. Without this declaration,
names retain runtime validation. The generated resource recipe includes it.

Named `resourceStatus$` can start a load before render. `refresh$` binds current
dependencies and starts one invocation before render or after hydration. Neither
method evaluates unrelated getters for an unknown target. Inline render resources
still require a render pass; prefer fields for typed lifecycle control.

Serialized `serverResources[name]` now contains `{ argsKey, value }`, only for
resolved loads. Rebuild server and browser together and update hand-written state
fixtures; value-only hydration snapshots are no longer supported. Preserve the
opaque dependency key from the server instead of assigning it to whichever
arguments the browser reads first. Generated fixtures exercise normal hydration
without an initial RPC and dependency changes that retain stale data.

Resource validation now runs before toJSON in both SSR and generated RPC methods: convert Dates to ISO strings and
custom classes to plain values. Non-finite numbers reject. Use null rather than
undefined anywhere in dependency tuples/objects; JSON otherwise collapses their
identity. Repeated acyclic object references are supported. Loader results may
still be undefined. See [server resources](../docs/server-functions.md#refresh-and-invalidation).

Task cancellation signals now remain owned after setup settles. Rerun aborts
before registered cleanup; destroy aborts all task signals before any application
cleanup hook. Returned subscriptions can keep checking the signal. Application
writes remain cooperative; typed paths and framework-gated commits remain RT-05.

## Typed task dependencies and owned commits

Task methods now receive `(signal, task)`; existing methods can omit either
argument. Opt into checked dependency paths with `@Task<ComponentType>`,
`@ServerTask<ComponentType>` or `@ClientTask<ComponentType>`. Readonly tuples,
nested nullable fields and array paths are supported. Private dependency names
need an explicit shape; no host type retains untyped path behavior.

Use `TaskContext<ComponentType>` for the second argument and apply results with
`task.commit({ result: value })`. The framework returns false for stale/disposed
executions, including results of operations that ignore AbortSignal. Runtime
patches must contain initialized reactive fields and plain data properties;
functions/promises, ordinary fields and injected services fail with TaskCommitError.
Use whole-field replacements, not callback commits. Direct application writes
still need cooperative ownership checks. This API cannot roll back writes or
cancel external effects. Settled setup remains owned until rerun/disposal.

Inheritance now retains parent task siblings when a subclass declares tasks.
A child decorator on the same method replaces task kind/dependencies before
server/client filtering. If code depended on parent tasks disappearing, declare
the replacement explicitly. Cleanup errors now name component, trigger and stage.

## State contracts and development diagnostics

Inherited reactive fields now remain active when a subclass declares another
field. A child decorator on the same field replaces its public/client and
shallow/deep contract. Replace a parent State with ClientState explicitly when
the browser owns that value. Component/service request sanitizers reject forged
overlays for that replacement. Legacy service forwarding now includes public
Store fields and preserves inherited siblings.

Store channels now receive the same validation as State channels. Fix undefined
channel names instead of relying on an unvalidated Store declaration. Public
state remains untrusted client input; validate and authorize server mutations.

Consuming Vite development builds now retain state diagnostics from the core
library. State and ClientState warn on detectable ineffective nested writes;
replace the field or choose Store/ClientStore. Public snapshot warnings identify
known unsupported values and cycles without printing values or invoking getters
and custom toJSON. These diagnostics are bounded and cannot certify every value.
No-op/failed writes remain quiet. Earlier value-bearing change logs are removed.
Production JSON semantics and writes are unchanged; direct Node imports without
Vite disable diagnostics. Resource JSON rules remain stricter than state rules.

Client-only fields are omitted from serialized state, but their authored initial
values still exist during SSR and can appear in HTML. Explicit RPC arguments can
also contain those values. Do not put secrets in client-only fields. Read the
[state examples and JSON contract](../docs/states.md) before choosing field kinds.

## Optimistic call ownership and flat connection snapshots

Optimistic calls now own their previews separately, including concurrent calls to
the same method. Rejection removes the failed call's preview; newer confirmed
state and later user edits remain. Nested plain Store trees are captured as
whole-field values. This does not infer arithmetic/array contribution rollback or
undo server mutations. Explicit scoped services use the same ownership rules.
Unrelated echoed state no longer cancels a pending field preview. Service loading
is owned by its invocation and cannot settle from an ambient completion message;
duplicate subscriptions count once and exited subscribers release without render.
Consumers that join a retained service during a pending invocation now inherit
its loading count. Sibling pages and nested consumers receive the eventual state
or rollback without another mutation. Loading attaches only to consumers of that
declared service. A different service or shadowed scope remains independent,
including services with the same action name. Each consumer counts once per
invocation across duplicate subscription and unsubscribe/rejoin.
Unsupported later local snapshots retain references with diagnostics and do not
make client setters throw or block sibling/loading cleanup.

HTTP/service request state now excludes pending optimistic previews. Express the
actual edit in validated action arguments rather than expecting previewed values
to arrive as server input. An optimistic increment must not execute twice because
its preview became the server's starting value. Public user-authored edits remain
request input; client-only values stay out of the public state overlay.

Optimistic handlers must be synchronous. Declared async handlers no longer run.
Promise-returning synchronous handlers and throwing handlers restore captured
changes; their server action can still dispatch. Started application effects cannot
be canceled by this rule. Native collections/classes remain scalar values.

Node/Deno WebSocket connection snapshots now carry flat public state, matching
Cloudflare and later broadcasts. Update hand-written adapter tests from
`state.public.count` to `state.count` for those frames; SSR hydration still uses
`initial.public`. The process runtime getPublicState checks that record shape.

Timeout, cancellation and network/socket loss still leave the server result
uncertain. Never retry a mutation automatically. Use an authoritative read or
resource refresh, and retain the distinction between local preview restoration
and server rollback. RT-06 now has a complete criterion audit for its explicit optimistic contract.
Broader execution/session and full release gates remain separate.

## Explicit optimistic operations

Use `optimistic<YourClass>(this)` within `@Optimistic` handlers when concurrent
increments or array edits must retain independent ownership. The helper records
`increment`, `append`, and first-equal `remove` operations. Handler code runs once.
A failed call removes its operations; later pending or committed local operations
remain. Public replies supply a confirmed base and replace confirmed previews.
Client-only operations stay out of public request state.

Direct assignments still describe absolute field values. They do not infer
arithmetic intent or array ownership. Replace dependent `this.count++` or
`this.items.push(item)` previews with explicit operations for contribution rollback.
Do not mix direct assignment and operations on one field within a handler.
That capture restores and logs an error while the actual server action can run.
The helper checks field/item types and runtime reactive metadata. Retained helpers
reject outside their exact handler execution. Item values must be finite acyclic
plain data without hooks, accessors, symbols, or native objects.

The server still owns validation, authorization, persistence, and write consistency.
Local rollback does not establish server rollback after an uncertain result.
See the complete example and limitations in [the optimistic guide](../docs/optimistic.md).

Late equal realtime echoes now preserve user edits that survived optimistic
settlement. Changed broadcasts and explicit reads retain server authority.
Reconnect and resync clear duplicate history without clearing pending calls.
Sources without cursor metadata still compare values. SSE page events now correlate
pending request IDs and order snapshots by cursor, including HTTP replies and generator
frames. A late older response cannot undo newer public state. Higher revisions restore
server authority after settlement. Reopen resets the source baseline. Child-local
replies never use the parent page cursor. Client-only drafts remain browser-owned.

## Explicit reads after uncertain mutations

Use `reconcile$(failure, 'declaredResource')` in a mutation catch handler when a
known uncertain RpcError needs an authoritative read. Declare target names in
Cossack's Resources option. The helper returns an immutable result and never
retries the mutation. A recovered result confirms only that the read completed.
Read errors remain separate from the original failure. Repeated requests with
the same error, names and current dependencies share a promise. Use refresh$
for an explicit later read retry. Application failures outside the known code
classification require an application-chosen read. See the
[complete example](../docs/optimistic.md#handle-an-uncertain-result).

RPC tree reconstruction now suppresses incidental resource loaders, including
nested components. Generated resource actions perform exactly their selected
read. Do not depend on render-triggered resource I/O running before an RPC guard
or mutation. SSR discovery and browser resource rendering keep their behavior.
Actual native socket loss/reconnect and SSE resync/late-snapshot acceptance now pass.
The remaining optimistic stream/service matrix and RT-06 criterion audit now pass.
Read the [completion review](./release-0.9.0.md#codex-optimistic-completion-2026-10-03).

## Default Durable Object application registry

AppDurableObject now uses the compiler's application page and layout registry.
Generated application targets use the router's exact source paths. Named helpers
and native HTTP handler modules are excluded. The old library-relative glob
registered bundled framework demos and could not resolve generated application pages.
Custom Durable Object subclasses can retain their explicit registry overrides.
The default registry requires the framework's Vite virtual-module integration.
See [socket recovery behavior](../docs/websockets.md#application-component-registry-and-lost-replies).

Functional HTTP route exports now become throwing stubs in the browser catalog,
including binding-only handlers. The server keeps the original functions.
Browser code must call their URLs. Shared values belong in separate non-route
modules. Use explicit exports instead of runtime export stars. Read the
[API boundary guide](../docs/api-routes.md#browser-boundary-for-functional-handlers).

## Canceling optimistic service streams

Service cancellation now releases previews and loading before iterator startup.
Client deadlines/cancellation release response waits even when a producer ignores
abort. Late response bodies are discarded. A confirmed yield remains public state;
unconfirmed client-only previews roll back. No mutation retry or server rollback is
implied. The [complete example](../docs/optimistic.md#complete-streamed-recovery-example)
uses a validated streamed mutation, ClientState draft and explicit persisted read.


## Textarea and native select values

Use `.value` instead of `value` with Textarea, Select and NativeSelect. Their closed
prop types reject unsupported native attributes and incorrect event targets.
Textarea listeners expose `HTMLTextAreaElement` as `currentTarget`; select listeners
expose `HTMLSelectElement`. Native change events are `Event`, not `InputEvent`.

SSR writes textarea text and selects matching options. Use an option matching the
initial single-select value; HTML cannot represent `selectedIndex=-1` while options
exist before JavaScript runs. For multiple selections, supply selected option
children instead of a scalar `.value`. Use `.value` for textarea content because
interpolated child text cannot contain hydration comment anchors.

Null/undefined `.value` bindings now serialize explicit empty values, including
`value=""` on inputs. Plain input/textarea/select spread values preserve user edits
when the bound value remains unchanged. Use `live()` when parent renders must
restore the requested value. `bind()` retains native two-way updates.


The default browser entry now reports an error when calling root `renderToString`.
Use `render()` or `hydrate()` for DOM updates. If browser code deliberately needs
HTML serialization, import `renderToString` from `@cossackframework/renderer/server`.
That explicit import includes the SSR parser. Node, Deno, Workers and workerd keep
the existing root serializer.


## Input addons and password controls

InputGroup accepts native input props, plus prefix/suffix content. Its attributes
and listeners target the input. Adornments do not replace the field label.

PasswordInput owns type, value and disabled. Replace competing `type`, `.value` or
`?disabled` props with `value`, `onChange` and `disabled`. Its `onChange(value, event)`
callback runs before a supplied native `@input` listener. Existing callbacks that
use only the value remain valid. Both callbacks receive the same input event.
`autocomplete` overrides the current-password default, and an empty placeholder
stays empty. Use `showLabel` and `hideLabel` to localize the reveal button.

Keyboard reveal keeps focus on the button. Pointer reveal returns focus to the
field and preserves selection unless the value or focus changed during the update.
Disabled inputs and inherited disabled fieldsets block reveal.

ARIA relationship attributes accept string IDs, including `aria-controls`,
`aria-describedby`, `aria-labelledby` and `aria-activedescendant`. DOM reflection
property names such as `aria-controlselements` remain invalid.

## InputOTP uses one native field

InputOTP now renders one text input with decorative digit slots. Apply labels,
ARIA attributes, native events and form attributes to the component's input props.
Replace selectors that expect one input per digit. The component owns type,
inputmode, maxlength, minlength, pattern and `.value`.

Use `defaultValue` for an initial uncontrolled code. When supplying `value`, accept
edits in `onChange` by updating that value. Codes contain ASCII digits and preserve
leading zeroes. Length must be an integer from 1 to 32 (default 6).

`onComplete` now fires after `onChange` for changed complete codes. Parent updates
and initial values do not emit either callback. Both receive the native input target.
Completion reports an edited code and does not imply server verification.
Native form reset restores the uncontrolled default or current controlled value.

## Combobox requires a stable ID and explicit selection ownership

Provide a page-unique `id` and associate a visible label through `for`, or set
`aria-label`. Random popup IDs are removed. The component owns combobox roles,
popup ARIA relationships, autocomplete and the input value. Native `@events`
and other supported attributes target the text input.

Use `defaultValue` for an uncontrolled initial selection. With `value`, update the
parent value in `onChange` to accept selection. Options need unique nonempty string
values and nonempty labels. Disabled options cannot be selected. A missing or
disabled selected option displays and submits an empty value.

Typing filters labels without changing selection. `name` submits the option value
through a hidden input. Escape, Tab, blur and popup dismissal restore the committed
label. Form reset restores the initial uncontrolled selection or current controlled
value. Native `required` needs a selected option, not arbitrary search text.
Localize `placeholder`, `emptyLabel` and `requiredMessage` as needed.

## MultiSelect submits tags and exposes validation

Provide a stable page-unique `id` and a label through `for` or `aria-label`.
Native props and `@events` target the editable input. The component owns its
combobox roles, popup relationships and validation attributes. Use `error` for
a parent-owned validation message and `aria-describedby` for helper text.

Use `value` with `onChange` for a controlled array. Accept the fresh callback array
to retain an edit. Use `defaultValue` for uncontrolled initial tags. Supplied arrays
are never mutated. Options and selected values must be unique nonempty strings.
`max` must be a nonnegative integer; zero means unlimited. Existing parent values
are preserved if options change or a new maximum makes the selection invalid.

`name` produces one hidden input per tag. Read selections with `FormData.getAll`.
`form` supports external forms. Disabled fields are omitted from submission;
readonly fields keep their values. Native form reset restores initial uncontrolled
values or the current controlled array without emitting `onChange`.

`validate` now checks predefined and custom additions. Returned errors are visible,
linked to the input, and block submission until corrected or dismissed. Parent
`error` messages persist until cleared by the parent. Required validation depends
on selected tags, not search text. Localize creation/removal labels and validation
messages with the corresponding props.

Enter during composition never adds a tag. Arrow keys select suggestions, and
Backspace on an empty query removes the last tag. Keyboard removal moves focus
to a remaining removal button or the input. Pointer removal returns input focus.

## Calendar and DatePicker use strict date-only contracts

Both components now require a stable page-unique `id`. Calendar forwards native
attributes/events to its root div; DatePicker forwards them to its date input.
Use `value` with `onChange` for controlled state, or `defaultValue` for uncontrolled
initial state. Calendar `onSelect` fires for every valid user pick, including an
unchanged date. Initial and parent values do not emit change callbacks.

Dates must be real Gregorian `yyyy-mm-dd` values from year 0001 through 9999, or
empty for no selection. Invalid dates and inverted limits throw. Use the public
`isCalendarDate(value)` guard before passing external data. Empty strings and
timestamps are not calendar dates. Studio now preserves invalid database text in
a text field instead of truncating or rolling it into a different date.

DatePicker now renders a native date input plus a button for the shared Calendar.
Replace selectors that expect a single trigger button. Its removed `placeholder`
prop does not apply to a browser-formatted date input. Native name/form, required,
min/max, disabled, readonly and reset behavior now work. Out-of-range real values
remain visible and fail native validation. The custom popup is nonmodal: Tab can
leave it, and Escape/selection return focus to the trigger.

Calendar renders the selected month during SSR and supports arrows, Home/End,
PageUp/PageDown and Shift+PageUp/PageDown. It clamps navigation at date limits and
month ends. Arithmetic and custom labels use UTC with the Gregorian calendar.
Use `locale`, `weekStartsOn` and the navigation labels to localize the calendar.
Pass `today` when the application's local day or deterministic SSR matters; its
default is the current UTC day. Native date-input formatting follows the browser.

## Modal, Sheet and Drawer

These components now share typed native dialog attributes and events. Drawer
forwards attributes to its dialog instead of its panel. Replace assumptions that
`class`, `style` or event targets refer to the panel. Supply `aria-label` or
`aria-labelledby`; Drawer also uses its title as a fallback name.

`open` is controlled. Accept `onClose` by setting `open=false`, or the dialog
reopens. Use `defaultOpen` for initial uncontrolled state. `onClose` reports user
or native dismissal, not prop-driven closing or cleanup. Use `@close` to observe
native close events from prop changes. `@cancel` can prevent Escape dismissal.
`closeOnEscape=false` and `closeOnBackdrop=false` disable those dismissal paths.
Backdrop clicks must start and end outside the panel.

SSR always emits a closed dialog. Client connection opens it through `showModal`.
Native form validation and `method="dialog"` submission remain available.
`onClose` receives the actual native event; its currentTarget contains returnValue.
A new opening clears the previous returnValue. Drawer now applies vertical size
and offers its localizable close button on all sides.

## Popover

Provide a stable, page-unique `id` without whitespace. The trigger uses that ID;
the panel uses `${id}-content`. Random IDs are removed. Native attributes and
`@event` callbacks now target the trigger button instead of being ignored. Use
`contentProps` for panel attributes and events. Neither object accepts arbitrary
props. Trigger type, native targeting and expansion semantics are owned.

The panel uses native auto-popover state. `show()`, `hide()` and `toggle()` remain
available. There is no controlled `open` prop. Disabled buttons and fieldsets
block opening and close existing content. Native events preserve their targets
and cancellation behavior. Supply appropriate panel semantics and names through
`contentProps`; Popover does not implement menu navigation or a focus trap.

Positioning now follows nested scrolling, content/trigger resizing and the visual
viewport. It flips and clamps within viewport limits, uses RTL start/end alignment,
and scrolls oversized content. Use `data-side` for actual placement instead of
`cs-popover--<side>` classes. The component owns panel positioning and maximum
viewport dimensions. Use `contentProps.style` width/height for desired size.
Native targeting works without JavaScript; custom positioning requires hydration.

## DropdownMenu and ContextMenu

Both menus require a stable, page-unique `id`. ContextMenu also requires
`menuLabel`. Top-level native attributes/events target the dropdown button or
context div. Use `menuProps` for the menu panel. Arbitrary props are rejected.
Native targeting, expansion and menu roles belong to the components.

Action labels are required strings. Separators use their own `{ separator: true }`
entry. Split old ContextMenu entries that combine a separator and action. Disabled
actions use `aria-disabled` and remain focusable during menu navigation. Custom
DropdownMenu children must use `role="menuitem"` and `tabindex="-1"` for actions.
Use `aria-disabled="true"` for custom unavailable actions. Plain buttons and links
are no longer treated as implicit menu items.

The menus now support arrow navigation, Home/End, typeahead, Escape and Tab exits.
DropdownMenu supports ArrowUp/Down opening. ContextMenu supports Shift+F10 and the
ContextMenu key. Item callbacks receive native button events. Prevent default to
keep the menu open. Callbacks that move focus elsewhere retain that focus.

ContextMenu retains manual popover mode and now owns scoped outside-click/Escape
listeners. It closes on external scrolling. DropdownMenu uses native auto mode.
Both release observers/listeners on cleanup and cancel deferred connection work.
Panel positioning and maximum dimensions belong to the controller. Use width and
height in `menuProps.style` for desired sizes. Interactive menu behavior requires
hydration; SSR supplies stable IDs, names and roles.

## Tooltip and HoverCard

Tooltip now requires a stable, page-unique `id` and a plain-text `label`.
The ID belongs to the tooltip panel. Add `aria-describedby` with that ID to the
actual child trigger, and give the trigger its own accessible name and keyboard
focus. Native attributes and events belong to the outer span. The wrapper no
longer receives the tooltip text as its own accessible name. Interactive content
belongs in HoverCard. The sessions scaffold now passes `label`; its old `content`
prop was ignored.

HoverCard requires `id`, `label` and `content`. The label names its nonmodal dialog.
Native attributes and events belong to the outer div; `contentProps` belongs to
the panel. Supply a focusable child trigger. The extra wrapper tab stop and
ineffective span `popovertarget` are removed. `show()` and `hide()` remain available.

Both controls require JavaScript for visual opening and use manual native popovers.
Tooltip no longer relies on CSS hover visibility. Focus opens immediately; pointer
hover uses `delay` (300 ms by default). `closeDelay` defaults to 150 ms. Both delays
must be integers from 0 through 60000. Content stays open while hovered or focused.
Escape cancels pending opening and dismisses visible content until interest leaves.
Opening preserves focus, including with autofocus descendants. Dismissing a card
returns focus to its trigger when the panel owns focus. Disabled controls close
and suppress opening. Re-enabling requires a fresh interaction or explicit `show()`.

The controller owns positioning and viewport bounds. `side` selects preferred
placement; Tooltip defaults to top and HoverCard to bottom. Panels flip and clamp,
follow scrolling/resizing, and scroll internally when oversized. Cleanup cancels
pending timers, observers and listeners.

## AlertDialog

AlertDialog requires a stable page-unique `id` and a nonempty text `title`.
`description` is optional plain text. Derived IDs connect its visible title and
message to the native `alertdialog`. The component owns those ARIA relationships.
Native attributes and events now target the dialog. Arbitrary props are rejected.

Cancel receives initial focus. Backdrop clicks never dismiss. Native Escape,
Cancel and `close()` share the dialog controller. Controlled callers must accept
`onClose` by setting `open=false`; otherwise the dialog reopens. `defaultOpen`
supports initial uncontrolled state. SSR stays closed until client connection.
Prop-driven closing and cleanup do not emit `onClose`.

`onAction` receives the native button event. Confirmation keeps the dialog open;
the caller owns asynchronous work, errors and successful closing. Use
`actionDisabled` to block repeated confirmation while work is pending. Cancellation
does not abort that work. `cancelLabel` and `actionLabel` must be nonempty strings.

## Command

Command requires `id` and an accessible `label`. Native attributes/events now
belong to a native modal dialog. `CommandItem` is exported, and readonly items
require unique nonempty IDs and labels. `disabled` items cannot be selected.
The search field owns keyboard focus and exposes the active result through ARIA.
Arrow navigation skips disabled results and retains item identity across reordering.
Search is case-insensitive substring matching. Composition Enter does not select.

Global Ctrl/Meta+K registration now requires `shortcut=true`. Enable it on one
app-level palette. Remove duplicate document handlers and open local palettes
through `setOpen()` or controlled `open`/`onOpenChange`. Competing eligible palettes
use document order. An open modal prevents unrelated palettes from taking over.

`defaultOpen` initializes uncontrolled state. Controlled callers must accept
`onOpenChange`. Confirmation calls `onSelect(id)` and proposes closing; it does not
await promises or own application errors. Accepted state changes reset search.
Localize `searchLabel`, `placeholder`, `emptyLabel` and `closeLabel`.

SSR now retains closed dialog markup instead of returning null. Tests must assert
hidden state after dismissal rather than expect the search element to be removed.
Native modal behavior supplies focus containment and restoration. Escape/backdrop
configuration follows the shared dialog contract, and cleanup removes shortcuts.

## Accordion and Collapsible

Accordion/AccordionItem and Collapsible require a stable `id`. Accordion `summary`
and Collapsible `trigger` now require nonempty text. Collapsible owns its native
button; replace `trigger: component(Button, ...)` with trigger text and style it
through `triggerProps`. Accordion wraps its button in a heading, with configurable
`headingLevel` from 2 through 6 (default 3).

Native attributes/events belong to the root div. `triggerProps` targets the button;
`panelProps` targets the content wrapper. The component owns derived trigger/panel
IDs, expanded/controls relationships and panel animation/inert state. Trigger click
handlers can prevent default to veto toggling. Events retain native bubbling.

`defaultOpen` is captured once. Use `open` with `onToggle` for later changes.
Disabled controls and enclosing disabled fieldsets block activation. Buttons use
`type=button` and never submit a form. When an enabled trigger's panel closes with
focus inside it, focus returns to that trigger before the panel becomes inert.
Open content retains auto height after animation. Cleanup cancels animations and
releases refs. Source ejection now imports native attribute types through the public
UI package while retaining the shared disclosure helper inline.

## Tabs

Tabs requires `id` and a nonempty `label` for its tab list. IDs now include the
instance prefix and encoded item value. Update selectors that used `tab-value`
or `panel-value`. Native attributes/events target the root div; `listProps`
targets the tab list. Rich item labels remain supported but require `ariaLabel`.
`TabsItem` and `TabsListProps` are public types. Item values must be unique and
nonempty; `disabled` excludes a tab from activation and arrow navigation.

Replace writes to the old public `active` field with controlled `value`/`onChange`.
Use `defaultValue` for initial uncontrolled selection. Local clicks no longer
supersede controlled updates. Invalid/disabled requested values fall back to the
first enabled item without emitting a callback. All-disabled lists select nothing.

Automatic activation remains the default; `activation: 'manual'` moves focus with
arrows and waits for Enter/Space to select. Horizontal navigation honors RTL.
Focus and selection remain separate when a parent rejects a proposal. Native
list key handlers can veto built-in handling. Panels remain keyed and mounted,
so switching retains edits. Reordering repairs focus after DOM moves; hiding or
removing focused content returns focus to an enabled tab or the list fallback.

Indicator positioning now uses post-render measurement and ResizeObserver instead
of uncanceled animation frames. Both orientations retain pill/underline variants.
Reduced motion disables transitions. Cleanup releases observation and queued work.

## Toggle and ToggleGroup

Toggle now owns native `type=button` and `aria-pressed`. Native attributes and
`@events` target its button. Use stable named children or an icon-only `aria-label`.
`defaultPressed` is captured once. Controlled `pressed` changes only when the parent
accepts `onPressedChange`. A native click handler can prevent default to veto it.

ToggleGroup requires a nonempty `label`. Native attributes and events target its
root div. `ToggleGroupItem` is exported; readonly arrays are accepted. Item values
must be unique and nonempty. Rich item labels require `ariaLabel` and noninteractive
content. Single mode uses string values and callbacks; multiple mode uses arrays.
The default single mode infers the callback parameter without an explicit type.

Replace writes to the old `selected` field with `value` and `onChange`. `value`
is fully controlled, including SSR. Use `defaultValue` for initial uncontrolled
selection. Selecting a pressed single item clears it and emits `''`. Multiple-mode
callbacks receive a new array, preserving disabled and unknown selected values.
The component does not mutate caller arrays or keep callback arrays as local state.

Arrows and Home/End move focus without selection. Enter/Space activate the focused
button. Navigation supports RTL and vertical orientation, skips disabled buttons
and repairs focus when keyed items move or disappear. Native disabled fieldsets
block activation. Group key handlers can veto navigation with `preventDefault()`.
ResizeObserver follows the single-selection indicator; cleanup releases observers
and pending setup. Toggles do not submit values or reset with forms.

## Menubar

Menubar requires an instance `id` and a nonempty `label`. Each menu now requires
its own stable `value` and text label. Derived trigger/panel IDs use that value and
the instance prefix. Replace selectors based on the old `cs-menubar-index` IDs.
`MenubarMenu` and `MenubarTriggerProps` are exported. Readonly arrays are supported.

Native root attributes/events target HTMLDivElement. Per-menu `triggerProps` and
`menuProps` target the button and panel. IDs, naming, roles, expansion and disabled
state belong to Menubar. Actions use the shared typed `MenuItem` contract. Labels
must be plain nonempty text, separators are distinct entries, and callbacks receive
a native button event. Prevent default in an action/panel click handler to retain
the open menu. Trigger click and native key handlers can veto built-in behavior.

Replace direct writes to `openMenu` with native trigger activation. Open state now
follows native auto popovers. There is one roving tab stop. Menus and actions marked
disabled remain focusable but cannot activate. Native disabled fieldsets still apply.
Keyboard navigation supports RTL, Home/End, typeahead, adjacent menus, Escape and
Tab exit. Hover only switches an already-open menu. Focus repairs after menu/action
removal and preserves focus moved outside by application actions.

Panel placement follows the viewport and bounds oversized content. Cleanup removes
listeners, observers and deferred setup. CLI ejection now includes the shared menu
helper and merges duplicate named imports. Menubar, DropdownMenu and ContextMenu
sources compile after ejection together with the existing disclosure components.

## NavigationMenu

Supply a page-unique `id` and a nonempty `label` for the navigation landmark.
Each section now requires a stable `value`; each link requires a stable `value`
unique within its section. Labels and descriptions are text. `href` must be
nonempty. Use values that survive translations and item reordering. Replace
selectors based on global indexes with the instance-prefixed trigger/panel IDs.

`NavigationMenuSection`, `NavigationMenuLink`, `NavigationMenuTriggerProps`,
`NavigationMenuPanelProps` and `NavigationMenuLinkProps` describe the public
contract. Arrays can be readonly. Native attributes and `@events` target the
root `HTMLElement`; nested props target the button, panel div and native anchor.
`AnchorAttributes` exposes native link options. Replace unsupported `onMouseenter`
style callbacks with typed `@pointerenter` handlers where needed.

Both hover and click modes support native click, Enter and Space. Hover preserves
keyboard focus, ignores touch entry and cannot dismiss another focused popup.
Delays are integer milliseconds from 0 through 60000 (defaults: 100 open, 150 close).
`disabled` applies to the whole navigation or one section; enclosing disabled
fieldsets also disable triggers. Tab follows native links and buttons. Arrow keys,
Home/End and Escape provide disclosure navigation and dismissal. Native callbacks
can prevent the corresponding built-in action with `preventDefault()`.

The native popover owns open state; the former public `activeSection` index is
removed. Keyed updates preserve focus, with a remaining link, panel, trigger or
root as a fallback when the focused target disappears. Panels own fixed positioning,
viewport bounds and overflow. Cleanup cancels timers and deferred connection.
SSR renders named navigation and relationships; disclosure interaction requires
hydration. Load the UI theme and use the packaged `native-navigation` guide for
the full keyboard, event and focus contract.

## Pagination

Choose one navigation contract. Controlled in-place pagination now requires
`onPageChange(page)` alongside `page` and `totalPages`. URL pagination uses
`href(page)` instead; do not combine them. Replace callbacks that assign
`window.location.href` with `href` to preserve native links and modified clicks.
The scaffold user/role lists use this mode. The demo now updates controlled state.

`page` must be a positive safe integer; `totalPages` a nonnegative safe integer.
A stale page above a reduced count displays the last page without a callback.
Zero pages render only disabled Previous/Next controls. `maxButtons` is now an
integer from 1 to 100 and limits the sliding window, excluding edge shortcuts.

Native attributes and `@events` are forwarded to the navigation `HTMLElement`.
Use `label`, `previousLabel`, `nextLabel` and `pageLabel(page)` to localize names.
`PaginationButtonProps` and `PaginationLinkProps` target the corresponding native
controls. Generated labels, current/disabled state, URLs and button type belong
to Pagination. Native click handlers can veto behavior with `preventDefault()`.

The component uses ordinary Tab order. Keyed controls retain focus across page
window updates; removed/disabled focused controls fall back to the current page,
an enabled control, or the root. Button controls use `type="button"` and honor
native disabled fieldsets. Anchors retain native semantics, so a disabled fieldset
does not disable them; pass `disabled` when needed. Disabled links omit URLs and
leave the Tab order. Use the packaged `native-pagination` guide for full behavior.

## Breadcrumb

Every item now requires a stable, unique `value`. Use values that survive label
translation and URL changes. `items` accepts readonly `BreadcrumbItem` arrays.
Plain labels supply names; rich labels require a nonempty `ariaLabel` and must
contain noninteractive presentation only. Empty labels and URLs reject early.

The final item now preserves a supplied `href` and renders a native current-page
link. Omit `href` to render plain text. Both forms have `aria-current="page"`.
Decorative separators are hidden from assistive technology. `separator` defaults
to `/`; the former comment describing `>` was incorrect.

Native attributes and `@events` now reach the root `HTMLElement`. Use `label` to
localize its name, `listProps` for the ordered list, `linkProps` for native anchors
and `textProps` for nonlinked spans. Do not combine link and text prop targets.
Their public types are exported. Native links retain Tab, Enter, modified-click
and new-tab behavior; handlers cancel navigation with `preventDefault()`.

Keyed updates preserve link focus. A removed link or link becoming text falls
back to the first remaining visible link or the root. Outside focus is preserved,
and cleanup invalidates queued focus repair. The demo and scaffold blog layout
now use stable item values and the blog imports the shared item type. See the
packaged `native-breadcrumb` guide for full ownership and accessibility behavior.

## ButtonGroup, Separator and AspectRatio

ButtonGroup now requires a nonempty `label`. Its typed native props/events target
HTMLDivElement; orientation and naming props are consumed instead of leaking onto
the DOM. Load the UI base stylesheet for joined borders: only direct native button
and anchor children are joined. Logical corners/margins support RTL and vertical
layout, and focused controls are raised above adjacent borders. The group supplies
no toolbar navigation, selection or child action behavior. Child types, disabled
state and form behavior remain native.

Separator now types horizontal `<hr>` callbacks as HTMLHRElement and vertical
`<div>` callbacks as HTMLDivElement. `decorative` controls textual
`aria-hidden="true"`; false omits it. Decorative vertical dividers have no separator
role. Roles, orientation, hidden state and tabindex belong to the component.
This is a static divider, not a focusable splitter. Horizontal lines are one pixel
high without an additional native border.

AspectRatio forwards native attributes to its outer div and requires a positive
finite numeric ratio. It now uses an inner CSS `aspect-ratio` box instead of
percentage padding, so custom wrapper widths size content correctly. Wrapper
style and ratio style are separate. Update selectors relying on the previous
internal wrapper/padding structure. Children occupy an absolute content layer;
keep their image alternatives and object-fit behavior explicit. Use the packaged
`native-layout` guide for ownership and layout details.

## Skeleton, Card, Badge and Kbd

Skeleton rectangles now default to a visible `1em` height. Rectangles use
`width`/`height`; circles use `circle: true` with one `size` (default `1em`).
Replace circle width/height pairs with size. Dimensions accept nonnegative finite
pixel numbers or nonempty CSS lengths. Generated sizing composes with native
styles, including `ifDefined`; supplied CSS follows the generated declarations.
The placeholder remains decorative and cannot become a focus stop. Reduced motion
disables its animation. Announce loading on the containing content region.

Rename Card `interactive` to `hoverable`. This option is a visual effect and adds
no keyboard or button behavior. It no longer supplies a pointer cursor, and reduced
motion disables its lift and transition. Put actions in native controls. Root
padding is independent of slot padding; use `padding: 'none'` when the supplied
slots already own spacing. The components demo now does so.

Card and all three slots have typed native div attributes/events. CardHeaderProps,
CardBodyProps and CardFooterProps are public. Badge has native span props and
rejects unsupported variants. Kbd has native HTMLElement props on its kbd tag;
it describes keys and does not register shortcuts. Use readable text for status
and key names. The packaged `native-display` guide describes all seven exports.

## Alert, Progress and Spinner

Alert uses typed native div attributes. `announcement` selects `assertive` (the
existing default), `polite` or `off`; choose `off` for static callouts. Tone remains
visual. Role and live-region attributes belong to the component. Icons take imported
entries, not string names; visible title text remains separate from native attributes.

Progress now requires a nonempty `label`. Omitted or null `value` means unknown
progress and omits `aria-valuenow`; pass zero for determinate zero. Finite values
still clamp to the range. Invalid/nonfinite values and nonpositive/nonfinite maxima
now throw instead of silently falling back. Use `valueText` for a human-readable
value. Naming, range attributes and focus behavior are component-owned. Only unknown
progress shimmers; reduced motion removes shimmer and width transitions.

Spinner has typed SVG attributes/events, with `SVGSVGElement` currentTarget. HTML
form props and competing geometry/semantic props are rejected. Its size and stroke
must be positive and finite, with stroke smaller than size. An omitted label means
decorative content; a supplied label must be nonempty and supplies status semantics
and SVG title text. Rotation stops under reduced motion. Use the packaged
`native-status` guide for announcement and loading ownership.

## Field and Empty

Field now requires `label`, `for` and a `control` callback. Move the native control
from the third argument into that callback and spread the supplied attributes:

```ts
component(Field, {
    label: 'Email', for: 'email', hint: 'Use work email', error, required: true,
    control: attributes => component(Input, {
        ...attributes, name: 'email', type: 'email', '.value': value,
    }),
});
```

The callback receives `FieldControlAttributes`: the control ID, required state,
linked descriptions and invalid state. Hint and error now render together with
stable IDs derived from `for`. Error text sets `aria-invalid`; it does not change
native validity or run validation. Keep native type/value/events and form ownership
on the actual control. Separate children are rejected. Root attributes/events target
the wrapper div; use a different ID for that wrapper. All scaffold Field consumers
use the callback, including password controls that previously lacked matching IDs.

Empty now forwards native div attributes/events instead of silently discarding them.
Visible title and description remain component props. The caller owns illustration
alternatives and native child buttons/links. Neither wrapper adds focus management
or automatic announcements. See the packaged `native-field-empty` guide.

## Avatar and AvatarGroup

Avatar now requires `alt`: a meaningful name or an explicit empty string for a
decorative portrait. Its span owns the accessible name across image and fallback
states. The nested image has empty alt and is hidden from accessibility naming.
Keep fallback content noninteractive and put actions on a surrounding native link
or button. Native `@events` target the span; `onImageLoad` and `onImageError` receive
image events. Loading, decoding and referrer policy apply to the image.

Failures now belong to a source request. A changed URL retries rather than retaining
the old failed flag. Cached failures before hydration are detected without synthetic
callbacks. Size must be positive and finite; native styles compose with generated
sizing. Source changes create new image nodes to prevent stale event ownership.

AvatarGroup requires `label`, readonly `items`, and a unique stable `value` plus
explicit `alt` per item. Native root props are now forwarded. `max` must be a
nonnegative safe integer; zero displays the overflow count. `overlap` changes from
a negative margin to a nonnegative pixel distance smaller than size. Logical
margins support RTL and row-reverse. `overflowLabel(count)` supplies localized
count text. Use a separate list/action to expose hidden identities. The packaged
`native-avatar` guide describes ownership and browser/runtime limits.

## Typography and Item

Typography has native prop/event types for each rendered tag. The default remains
p. Quote `cite` belongs to blockquote; list `start`, `reversed` and `type` belong to
ol. Incompatible attributes and unknown variants now fail public type checks, and
unknown variants also reject at runtime. Ordered-list marker styles follow native
`type` instead of always forcing decimal. QuoteAttributes and OrderedListAttributes
are public. Keep children valid for the chosen native tag, including li children
for lists and phrasing content in paragraphs/inline variants.

Rename Item `interactive` to `hoverable`. It controls visual hover colors only and
no longer suggests a pointer cursor or adds focus styles. Use native child buttons
and links for actions. Item props/events now target a typed native div; slots keep
their own native behavior. Boolean layout flags are validated and reduced motion
removes the hover transition. See the packaged `native-typography-item` guide.

## Table and ScrollArea

Table's top-level native props and event listeners now target the table. Move
attributes and styles intended for its overflow div into `wrapperProps`. Name the
table with a caption or ARIA attribute. For keyboard access to horizontal overflow,
set wrapperProps `tabindex: 0`, `role: "region"` and an accessible name where appropriate. The five
section/row/cell helpers now declare native props; use `colspan`, `rowspan`, `headers`
and header-only `scope`/`abbr`. `striped` now applies actual even-row theme colors.

ScrollArea requires a nonempty `label` and renders a single named region. Native
props, styles and `@scroll` now target that scrolling div. Both existing CSS classes
remain on this element; update selectors that assumed a nested viewport. It defaults
to `tabindex: 0`; use -1 only when keyboard access is supplied elsewhere. Numeric
height means nonnegative finite pixels, while strings remain CSS values. Authored
style follows generated height/overflow and may override them.

## Resizable

Replace positional children with explicit `primary` and `secondary` props. Supply
an `id` unique in the document and a `label` naming the primary panel and handle.
The old demo's `defaultWidth` never affected sizing; use `defaultSize` (percentage).
Defaults are captured once. Optional controlled `size` changes only when its caller
acknowledges `onSizeChange` proposals. Both panels respect `minSize` (0–50).

Root attributes now reach the root div. Use `primaryProps`, `secondaryProps` and
`handleProps` for other native targets. IDs, visibility, separator semantics and
keyboard/pointer handlers are component-owned. `orientation` describes panel
layout; the separator's ARIA orientation is perpendicular. Root styles may override
the generated layout, but authors then own its geometry. Give the root a height.

The handle supports Tab, axis arrow keys (including RTL), Shift acceleration,
Home/End and Enter minimize/restore. Zero-width/height panels become inert and
hidden from assistive technology; focus inside a collapsed panel moves to the
handle. Pointer capture replaces document mouse listeners. Interruption, prop
changes and unmount release capture and the owned window-blur listener.

## Sidebar

Supply a stable `id`, a navigation `label`, and a globally unique `value` for every
item, including nested groups. Leaves require href; groups require nonempty children
and may retain a separate destination. Arrays can be readonly. `active` means the
current page; ancestors open by default until the user makes an explicit choice.
Manual closing now wins over the active-child default. Item keys survive reordering.

Root props now target the aside. Use navProps for navigation attributes and item
linkProps for native anchors. title remains visual brand text. Group markup uses
native details/summary, and every link uses `cs-sidebar__link`; update selectors
that relied on `cs-sidebar__sublink`. Both group destinations and children remain
reachable in icon mode. Names remain available when visible labels are hidden.

onToggle now receives the next collapsed boolean. Without it, there is no built-in
toggle button. Default button names are “Expand navigation” and “Collapse navigation”;
use expandLabel/collapseLabel for localization. onNavigate receives the item and
native anchor event, and leaves modifiers, downloads, non-self targets, external
origins and non-HTTP(S) protocols to the browser. Item link listeners run first.

Offcanvas mode requires restoreFocusTo naming an external focusable opener. The
caller owns its aria-controls/aria-expanded and placement. Hiding now removes the
sidebar from layout and Tab order and restores focus before hiding focused content.
This mode is not a modal overlay; compose Sheet when modal behavior is required.

## Toast store and presenter contracts

Author: Codex, 2026-10-04. Toast mutations and subscriptions now require a browser. Return a server
result to a client handler before calling `toast.success`, `toast.error` or another
mutation. The old server-call guidance was incorrect: it changed shared module
state without delivering a notification to the caller's browser.

`toast` and the newly root-exported `toastStore` expose the same default store.
Mount one default `Toaster` in the application root. For another presenter, use
`createToastStore({ maxToasts: 5 })` and pass its result as `store`. Store identity
cannot change while mounted. The queue bound is an integer from 1 to 100; a full
queue rejects new messages. A second presenter for the same store rejects.

Snapshots and items are readonly and frozen. Replace `toastStore.set/update`
with `show`, `dismiss(id)` or `clear`. `subscribe` still returns an unsubscribe
function. `ToastOptions` accepts only `duration` and `variant`; variant helpers
accept only `duration`. IDs and messages cannot be overridden through options.
Durations are finite milliseconds from 0 to 2147483647. Zero stays until dismissed.
The default remains 4000. Messages and accessible labels must be nonempty.

Timers start when a presenter connects, pause for hover/focus, window blur and
hidden documents, and resume with their remaining time. Unmount clears the queue
and cancels timers. `dispose` permanently clears an isolated store and subscribers;
do not dispose the shared default store. Queue messages before mounting if needed.
Use persistent notifications or another accessible view when information must
remain available after a timed toast disappears.

Native root props/events now target an HTMLDivElement. `label` names the region;
`dismissLabel` supplies the dismissal-name prefix. The component owns roles,
announcement attributes and tab order, and accepts no children. Dismissal buttons
use `type="button"`. One permanent polite announcer replaces nested live regions.
Escape dismisses the focused toast; removal repairs focus without focusing new
messages. The stack fits narrow viewports and removes animation for reduced motion.

## Carousel slide and navigation contracts

Author: Codex, 2026-10-04. Carousel now requires `id`, `label` and `slides`.
Replace positional children with explicit slide records:

```ts
component(Carousel, {
    id: 'product-photos',
    label: 'Product photos',
    slideSize: '12rem',
    slides: photos.map(photo => ({
        value: photo.id,
        label: photo.description,
        content: html`<img src=${photo.url} alt=${photo.description}>`,
    })),
});
```

Values must be unique and stable. Each record requires a nonempty label and a
content property. The array can be empty. `slideSize` is a CSS flex-basis string,
defaulting to `100%`; a record's `size` overrides it. Use compact sizes to preserve
multi-card layouts. Native root props target the outer div, `viewportProps` targets
the scroll viewport, and each slide's `props` targets its own div. Public types are
`CarouselSlide`, `CarouselSlideProps` and `CarouselViewportProps`.

The component owns IDs, roles, labels and the viewport tab stop. Localize
`viewportLabel`, `previousLabel`, `nextLabel` and `emptyLabel` as needed. Root or
slide `aria-roledescription` can override the default description. Controls retain
focus with `aria-disabled` at measured scroll boundaries. There is no automatic
rotation or wrapping. Native slide content remains in reading and tab order.

With the viewport focused, arrows follow RTL/LTR direction and Home/End navigate
to the ends. Keys inside nested controls remain native. `scrollNext`, `scrollPrev`
and new `scrollToSlide(value)` target real slide geometry. Remove code that reads
the old public `viewportRef`; use `viewportProps` for native attributes/events.
Unknown browser method targets throw. A valid disconnected call has no effect.

`onValueChange` reports the settled visible anchor, not a controlled selection or
an awaited operation. It uses the nearest leading slide, the last slide at the
scroll end, and the first when all content fits. It reports `undefined` after the
list becomes empty and does not fire on initial mounting. Reordering preserves
identity; removal falls back to the nearest remaining ordinal. Focus recovery,
reduced motion and observer/frame/timer cleanup now belong to the component.

## Attachment filenames, status and native props

`Attachment` requires a nonempty `name`. It no longer accepts arbitrary props or
silently ignores positional children. Root native attributes and `@events` reach
its div. Use `removeProps` for the button and `thumbnailProps` for the decorative
image. All three targets have public prop types and typed native events.

Status words no longer select colors. Set `statusVariant` to `neutral` (default),
`success` or `error`, independently of localized `status` text. A status such as
“Upload failed” previously selected both success and destructive styles. Status
text does not automatically announce; the application owns any live region.

```ts
component(Attachment, {
  name: file.name,
  size: file.displaySize,
  status: 'Upload failed',
  statusVariant: 'error',
  removeLabel: `Remove ${file.name}`,
  removeProps: { disabled: saving },
  onRemove: event => {
    // Read event.currentTarget before awaiting. The list owns removal and focus.
    removeFile(file.id);
  },
});
```

The removal label defaults to `Remove ${name}`. `removeLabel` localizes it.
The button stays `type="button"`; Enter/Space, disabled props and native disabled
fieldsets apply. `removeProps['@click']` runs first and can veto `onRemove` with
`preventDefault()`. The renderer's `preventDefault(handler)` directive also vetoes
removal. Root bubbling handlers run afterward. The list owner must restore focus
when removing its focused item; Attachment does not know the replacement target.

File type inference uses a known final extension, case-insensitively. Bare names
such as `js`, hidden names such as `.js`, and unknown or prototype-property suffixes
use the generic file icon. Explicit `type` still overrides inference. A thumbnail
is decorative, with owned `src`, empty `alt` and `aria-hidden`. Its native load/error
callbacks do not implement retries or fallback icons. The filename remains when
an image fails. Image source and alternate text cannot be overridden through
`thumbnailProps`; use a separate informative image if its content needs describing.

## Bubble, Message and Marker native chat contracts

All three components now forward typed native root div attributes and `@events`.
They remain display components. Native child links, buttons and form controls own
their actions; the application owns transcript/list/live-region semantics.

`BubbleReaction` now requires a localized `label` as the text equivalent of its
decorative `emoji`. Counts must be nonnegative safe integers. Zero stays visible.
Use `reactionsLabel` to localize the list's accessible name (default `Reactions`).
Reaction records are readonly; the parent rerenders changes. Display reactions are
list items, not interactive toggles.

```ts
component(Bubble, {
  variant: 'sent',
  time: '10:30 AM',
  datetime: '10:30',
  reactionsLabel: 'Reactions',
  reactions: [{ emoji: '👍', label: 'Like', count: 0 }],
}, 'Message text');
```

Bubble's width limit now applies to its content box. The default maximum remains
75%, and `--cs-bubble-max-width` can override it. Reactions wrap in normal flow
instead of overlapping following content. Corners and alignment use logical edges
for RTL. Message uses an 80% body limit and supplies a 100% bubble limit inside it,
so nested bubbles do not apply both percentage limits. Authored CSS may override
these defaults; constrain oversized media and code blocks in application content.

Message now renders supplied name, time and avatar for **both** variants. Omit
metadata explicitly when a sent row should not show it. Keep parent/child variants
consistent. Native child actions and input state survive ordinary metadata updates.

Bubble and Message render a native `time` element only when `datetime` accompanies
nonempty `time` text. The caller owns the valid machine-readable value and all time
zone/locale conversion. Without it, arbitrary display text stays in a span.

Marker validates its default/unread variant, forwards root props and hides only
its decorative lines. Its phrasing children remain readable. Unread styling adds
no announcement, keyboard handling or focus change. None of these controls adds
automatic live-region or message-log semantics.

## MessageScroller native ownership and reading position

MessageScroller now requires `id` and a viewport `label`. Root native props reach
the outer div; `viewportProps` reaches the scrolling div and `jumpProps` reaches
the jump button. Their public types describe actual event targets. The named
viewport owns `tabindex="0"`, so keyboard scrolling works before hydration.
Constrain the parent's height or set an explicit root height.

```ts
component(MessageScroller, {
  id: 'conversation',
  label: 'Conversation',
  style: 'height: 24rem',
  initialPosition: 'end',
  threshold: 80,
  jumpLabel: 'Scroll to latest messages',
  viewportProps: {
    '@scroll': event => console.log(event.currentTarget.scrollTop),
  },
}, messageContent);
```

Replace `newMessageLabel` with `jumpLabel`. The button reports a scroll action,
not an unread count. Replace direct `scrollRef` access with the public browser
method `scrollToBottom()` or the typed native viewport event. The button is
non-submit; native caller handlers can veto its action, and disabled props apply.
When the focused button disappears, focus returns to the viewport.

`initialPosition` defaults to `end` and is captured on mount. Existing browser
focus or scrolling takes precedence. Native scrolling within `threshold` resumes
following; history reading and focused message controls pause automatic movement.
Threshold must be finite and nonnegative. Content growth and resizing follow the
bottom only while following. Geometry-driven browser clamping does not resume it.

Use keyed direct element children to preserve their DOM identity across prepends
and reorders. Visible child offsets anchor history reading. A removed anchor uses
another surviving visible child; a complete replacement clamps the old scroll
offset. Text-only content and rebuilt nodes cannot preserve a row anchor, and
this does not promise word-level anchoring inside an edited row. Do not override
native `overflow-anchor` or force smooth scrolling behind the component's back.
Explicit jumps use instant movement and recover offscreen child focus to the
viewport. Setup, observers and queued frames are owned and cleaned up on unmount.

The generated Chat template now gives the viewport a name and streaming busy
state. A separate short status region announces progress/completion instead of a
live region around every token in the transcript. MessageScroller itself owns no
live announcements, unread counts, message fetching or authorization.

## Icon native SVG props

Use `variant` for Solar artwork styles; `style` now supplies native CSS. Import
individual entries, for example `ArrowRightIcon` from
`@cossackframework/solar-icons/arrow-right`, and pass `entry: ArrowRightIcon`.
The removed name lookup is not supported. Canonical variants are line, bold,
duotone, broken, outline and line-duotone. `normalizeStyle` converts supported
aliases and now rejects unknown names. A missing variant uses own line artwork;
missing or empty artwork rejects rather than rendering nothing.

`size` must be positive and finite. `label` owns informative naming; omitted or
blank labels mark decoration. Native SVG attributes and `@event` listeners bind
to the SVG root, with `SVGSVGElement` currentTarget. Native `style`, fill and stroke
remain available. Do not override width/height/viewBox, naming or focus attributes.
Put actions on named native buttons or links. Positional children are rejected.

Native attributes and labels use renderer escaping. Only `entry` artwork is raw,
explicitly trusted SVG; this change does not sanitize arbitrary user artwork.
Renderer creation and artwork updates now retain SVG namespaces and HTML
integration inside foreignObject instead of creating HTML path elements.

## AuthForm native fields and explicit callbacks

Import the block and its types from `@cossackframework/ui/blocks`. Supply a stable
unique `id` and `onSubmit(data, { signal })`. Data now includes a discriminating
`mode`; only signup data has `name`. Credentials stay in native fields and are read
at submit time. PasswordInput now omits its value binding when `value` is omitted,
so uncontrolled hydration and autofill preserve browser edits.

Use `defaultMode` for local mode or `mode` plus `onModeChange` for controlled mode.
The initial mode renders on the server. Replace `social: true` with explicit
`providers: [{ id, label }]` and `onSocial(providerId, { signal })`. Provider clicks
no longer send empty credentials through onSubmit. There are no default providers.
Root native props target a div; `formProps` targets the form. All labels and IDs
are connected, including PasswordInput. Localize text through `labels`.

Login accepts existing shorter passwords. Signup uses native and snapshot length
checks, with configurable `signupPasswordMinLength` (default eight). The server
still owns password policy and validation. Return safe `AuthFormResult` errors;
raw thrown messages are no longer displayed. `false` is not a supported result.
The native form uses POST and disables actions before hydration. Applications
needing no-JavaScript login must provide their own native server POST form.

Pending requests disable controls and suppress duplicate submissions. Parent mode
changes and cleanup abort the signal and discard stale results. Callbacks must
honor cancellation themselves; side effects are not rolled back or replayed.
Safe errors link to fields and focus them without stealing focus from outside.
The new `cossack add ui auth-form` recipe ejects source with public UI dependencies.

## CommandPalette shared search and dialog ownership

Import from `@cossackframework/ui/blocks`. Supply required `id`, `label`, readonly
`commands` and `onSelect`. Native props now target HTMLDialogElement, rather than
an inner div. Use `open` with `onOpenChange` for controlled state or `defaultOpen`
for local state. The public `setOpen(boolean)` and `toggle()` methods propose
changes; controlled parents must accept them. Local state no longer collides
with the mirrored open prop.

The block composes Command instead of maintaining a separate Modal/search loop.
Grouped visual and keyboard order now agree. Stable IDs preserve the highlighted
command through updates; disabled commands are skipped. Icons remain supported.
`shortcut` on an item is only a visible hint and default accessible description.
An explicit item `description` can replace that supporting text.

Global Ctrl/Meta+K is now opt-in via `shortcut: true`. Command and CommandPalette
share first-eligible-owner arbitration. Closed owners ignore input, textarea,
select and contenteditable targets unless `shortcutInEditable` is true. Existing
active modals take precedence. Use explicit triggers for local palettes alongside
an app-level shortcut owner. The framework demo and Studio consumers now supply
identity/naming and connected trigger attributes.

CommandItem fields are readonly; replace records when changing command metadata.
Command adds `grouped`, presentational `renderItem` and item `description` for
this composition. Labels still own search and option names; do not put interactive
controls inside options. Search trims surrounding whitespace. Localize search,
empty and close text with the existing label props. Native close, Escape, backdrop
and focus behavior comes from the shared dialog controller. Action callbacks and
promises remain application-owned; no authorization or command shortcut execution
is inferred from UI visibility or hint text.

## DashboardStat metric identity and change meaning

Import the block and its public metric types from `@cossackframework/ui/blocks`.
Every metric now requires a stable nonempty `id`, unique within its list. `stats`
and metric records are readonly. Labels and string values must be nonempty;
numeric values must be finite. Zero remains visible. Format units in the caller.

The root is now a native `ul`; forwarded attributes and events target
`HTMLUListElement`. The block owns `role=list` and renders `dt`/`dd` label/value
pairs. Remove positional children. Long text wraps, and narrow screens use one
column. `columns` accepts only 2, 3 or 4. The stray literal template text is removed.

Do not infer business meaning from direction. `trend` still describes up, down
or neutral; `tone` explicitly describes positive, negative or neutral and defaults
to neutral. Both require nonempty `change` text. Add `tone: 'positive'` or
`tone: 'negative'` where the old implicit color was intended. Direction and
positive/negative meaning have visible text, localized through `trendLabels` and
`toneLabels`. An increase in cost may be unfavorable; a decrease in errors may
be favorable. Native optional spread classes now merge with component classes
through `ifDefined` instead of replacing them during browser updates.

## SettingsPanel values, identity and native forms

SettingsPanel now requires an instance `id`, unique section IDs and unique row
keys across the panel. Sections, rows and value records are readonly. Replace the
old loosely typed row object with the `SettingsRow` union. Text values must be
strings, switch values booleans; absent values default to empty text or false.

The old `values` prop was described as initial state and collided with the private
state field. Use `defaultValues` for local state captured once, or `values` with
`onChange` for controlled state. Do not combine them or switch ownership later.
Callbacks receive fresh snapshots of current controls. Controlled callers must
accept proposals; rejected edits restore native values. Keep persistence and
async error handling in the application.

Fields now have connected labels, descriptions and native names (defaulting to
row keys). Text uses reactive properties. Each button row requires `action` text
and the panel requires `onAction`. Replace key-based destructive styling with
`variant: 'destructive'`; all actions use `type='button'`. Root props and events
now target `HTMLDivElement`; root tabindex is owned for focus fallback.

Inside an application-owned form, a non-prevented native reset proposes the
snapshot captured at first render. Local state resets; controlled state follows
the parent's acceptance. Reset callbacks run after the native default action and
are cancelled on cleanup. Keyed row updates preserve controls; focus is repaired
after movement/removal without taking focus from another active element.

## Development inspector gestures

Use Ctrl-Shift-click to inspect a component snapshot. This replaces the previous
Ctrl-double-click gesture and raw instance/public-state console output. Ctrl-click
continues to open source through the local editor service. Recording is explicit
through the toolbar or inspection gesture; values are omitted unless selected
through the controller API. See [development traces](../docs/development-traces.md#browser-inspector).

## Paused RPC consumers

Deadlines and WebSocket transport failures now settle calls even while a consumer
is paused after a yield. Do not rely on consumer pauses to extend a declared
`@Server({ timeout })` deadline. Completion rejects and local loading releases;
the next iterator pull observes the interruption once before later pulls finish.
Explicit cancellation uses `COSSACK_RPC_CANCELLED`; deadlines use
`COSSACK_RPC_TIMEOUT`. Already reconciled state is retained. See [RPC failure
semantics](../docs/rpc.md) for remote-outcome limits.


## Development server evidence

Development snapshots now include `server-rpc` dispatch and `server-stream`
terminal event kinds. Narrow on `kind` before reading fields. Terminal evidence
joins an earlier dispatch ID and reports cleanup separately from outcome. It is
optional and does not change RPC results; local cancellation never implies a
server terminal. Server timestamps use a different clock from browser receipt
timestamps. See [development traces](../docs/development-traces.md#server-dispatch-evidence).


Development trace consumers must also handle `kind: 'server-socket'`. These
WebSocket dispatch records have a `frame` type and no HTTP `status`. The first
yield and terminal can share a dispatch ID; a terminal is not evidence of iterator
cleanup. Unknown or absent optional evidence must not change application results.
See [WebSocket trace semantics](../docs/development-traces.md#websocket-dispatch-evidence).

## Desktop native request ownership

Upgrade Electron to 43.7+ in the 43.x series, or 44.4+. Native RPC now requires
Electron request-initiator evidence and a managed window. Renderer-supplied
`Origin`, referrer and `__cossack_window` values cannot establish ownership.
The adapter strips its private proof headers before calling the application.

Desktop windows now use `persist:cossack.<identifier>`. Existing cookies and
browser storage in Electron's default session are not copied; users may need to
sign in again. Native files under `app.getPath('userData')` are unaffected. Keep
the identifier stable. Cossack reserves this session's private protocol and
`onBeforeSendHeaders` hook; attach unrelated app hooks to a separate session.
See [Desktop guidance](../docs/desktop.md).

The generated Forge config now includes only `package.json`, `dist/client`,
`dist/desktop` and `desktop-assets`. Existing apps should apply the same filter
to their owned `forge.config.ts`; the old exclusions could include `.env` and
other local files. Move required native runtime assets to `desktop-assets` or
explicitly review any additions to the package filter.

## Desktop Vite development

Replace the old production build watchers with the updated `cossack-desktop`
runner (the generated `desktop:dev` script). Install the Desktop package's
optional Vite peer for development; packaged runtime imports do not load Vite.

Update `src/desktop/index.ts` to export the router as `frameworkApp`, application
bindings as `env`, and `async function startDesktop(createApplication = createDesktopApp)`.
Inside that function, call the supplied `createApplication` factory, install native
menus/tray/close handlers and return the resulting Desktop application. Guard the
production invocation with `if (!import.meta.env.DEV)`; development invokes the
export itself. See the complete [bootstrap example](../packages/desktop/README.md).
Do not top-level await creation or run native setup during module evaluation.

Change the Vite config callback to accept `{ mode, command }` and apply
`ssr.noExternal: true` only for `mode === 'desktop' && command === 'build'`.
Keep the selected web adapter excluded in Desktop mode as before. Production
bundles native dependencies; development needs regular package externalization.

Application source edits reload windows. Native bootstrap, config and root
`.env*` edits restart Electron; process state is not preserved across restarts.
Page syntax errors can recover after repair. The renderer stays on the private origin,
and native request ownership rules still apply. Opt in to stored development
captures through `cossackPages({ developmentTraces: true })` and the public
inspector. Do not expose native handlers through a loopback HTTP endpoint.

## Codex: Read-only plans and typed Markdown (2026-10-05)

Migration and seeder planning no longer invokes application callbacks. Callback-only
operations report an incomplete plan with an explicit unknown reason. To obtain
a complete plan, declare `operations`: migrations use `{ up: [...], down: [...] }`
and seeders use an array of SQL fragments. These declarations drive execution as
well as preview; callbacks on the same declaration are ignored. Generated
migrations now use this form. Omit `down` for an irreversible baseline.

Apply the returned array through the same live runner's `applyPlan(plan)`. The
runner checks definitions, connection identity and migration history before
applying its detached snapshot. Serialized JSON is inspection output and cannot
be imported as an executable plan. CLI apply commands still perform their own
current-definition/history checks; they do not consume a prior CLI JSON preview.
Bound parameter values are excluded from the public plan. SQL literals remain
authored SQL. Provider limits appear on the plan; MySQL DDL can commit implicitly
and D1 does not offer interactive transactions.

Unchanged callback-only migrations retain their historical checksum. Converting
an already-applied migration to declarative operations changes its definition: add
a new migration instead of editing applied history. Dynamic callbacks remain
available for explicit execution, with application-owned external effects.

Markdown standard metadata now has a shared typed contract. Unknown metadata
fields require an explicit validator passed to `createMarkdownProcessor` from
`@cossackframework/framework/markdown-processor`. Use ISO calendar dates for `date`,
language tags for `locale`, and HTTP(S) or root-relative URLs for `canonical`.
Validation errors name the file, field and location without echoing rejected values.

`aliases` are additional static output copies of the canonical page. They must be
literal, unencoded, root-relative static paths on SSG-enabled static source routes.
They are not runtime redirects. Duplicate output paths, including TypeScript
parameter outputs, fail before publication. Aliases reuse canonical HTML and do
not add duplicate sitemap entries. Markdown locale metadata takes precedence
over visitor preferences; a named locale requires its application catalog when
catalogs exist. The default catalog may still be included as the documented
translation fallback in hydration.

## Codex: Typed forms and database inspection (2026-10-05)

Use Core `createFormBindings(controller, { id })` for native controls or UI
`createUiFormBindings` for Input/Checkbox props and Form's `bindings` prop.
Subscribe once to controller changes to request rendering, and dispose both
subscription and bindings with their UI owner. Use stable HTML IDs and indexed
paths such as `items.0.name`; selected File values are preserved, never assigned
back to a native file input. Reset clears owned file controls. Form accepts one
of `bindings` or `submit`. Stale validation/replies do not overwrite edits;
reset does not undo server mutations already started.

Database logger events now expose bounded redacted SQL structure and typed
parameter markers, provider/outcome and a fixed failure code. They omit raw
errors and literal values; logger exceptions cannot change query outcomes.
Simple paginated entity queries append primary-key tie breakers. Projected,
joined, grouped or distinct pages require an explicit unique order. Offset pages
can shift under concurrent writes; keyset pages use existing predicates/orders.

Use `orm.inspectMetadata()` and `orm.inspectCapabilities()` for finalized entity
facts and supported provider operations. Unsupported generated identity/arrays,
parameter limits, transaction modes and queued schema changes reject before
execution. PostgreSQL increment keys use identity, MySQL uses AUTO_INCREMENT,
and SQLite increment requires an integer primary key. Column type changes use
provider-specific SQL; default/constraint changes require explicit SQL. MySQL
DDL is not rollback-safe.

`cossack schema inspect --json --env staging --target local` and Studio use the
same database-owned read-only inspection contract. Shared inspection omits column
default values (`defaultValues: 'omitted'`) and private connection fields.
Temporary inspection connections always close; borrowed connections keep their
owner. Adapter factories must honor target/environment and read-only context.
Remote Studio inspection now requires the application's orm.config.ts remote
factory; an explicit requested binding must match the inspected target.
