# Draft 0.9.0 migration guide

This is a working record of verified behavior changes. It is not yet a complete
release migration guide. REL-04 must audit the full release checklist, add every
remaining break, compile its examples, and verify package installation before
publishing 0.9.0. Package versions remain 0.8.3 while that work is open.

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
