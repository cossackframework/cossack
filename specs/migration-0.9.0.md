# Draft 0.9.0 migration guide

This is a working record of verified behavior changes. It is not yet a complete
release migration guide. REL-04 must audit the full release checklist, add every
remaining break, compile its examples, and verify package installation before
publishing 0.9.0. Package versions remain 0.8.3 while that work is open.

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

Prefer `@Server({ input: contract })` with an `input` schema and annotate the
native method parameter with `InputOf<typeof contract>`. Plain rule maps still
run their previous rules; they do not gain strict unknown-key, positional-argument,
file or array behavior. See [the schema contract](../docs/validation.md).

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

Native server calls retain their authored signature and do not run decorator
validation. Resource authorization is still an unfinished release gate. These
changes do not authorize a release or remove that gate.

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
