# Server failure events

Native `defineApi` handlers and class API methods emit `cossack.api.failure`
for unexpected failures. SSR rendering and its router cleanup catches emit
`cossack.ssr.failure`. Unhandled request middleware/config failures emit
`cossack.request.failure` instead of Hono's raw exception logger.

These events contain a UUID request ID, authored route template, action, runtime,
fixed stage/code and bounded nonnegative duration. They omit exception messages,
stacks, causes, custom properties, headers, payloads, concrete path parameters
and query strings. An unknown HTTP method is logged as `unknown`.

Use the response's `X-Cossack-Request-Id` to find the event. Internal API/request
JSON failures include the same `requestId` and a generic error code. The framework
replaces invalid existing response IDs with UUIDs and restores its managed ID
when a failing API method changes the header. Controlled authorization failures
and `HTTPException` responses keep their existing public behavior.

API and SSR durations cover their handler scope. The global fallback starts its
context when handling an uncaught failure; its duration does not measure the
whole middleware chain. This is not a request timing or startup budget report.

Core component actions, iterator cleanup, server tasks, asynchronous component
cleanup and service rollback/disposal emit `cossack.runtime.failure`. Durable
Object malformed-frame/delivery failures and Node adapter failures use the same
portable `@cossackframework/core/server-diagnostics` entry. Unknown context fields
and arbitrary exceptions are omitted. Authored labels are bounded; callers must
supply authored identifiers, never actual URLs or arbitrary input. Missing or
non-UUID request IDs become `unavailable`; adapter-level events can therefore
lack correlation. The Node in-memory callback uses a generic `dispatch` stage
because it cannot distinguish parsing from delivery. Task setup duration currently
starts at failure capture; it is not task execution timing. Browser diagnostics
retain their existing behavior.

This is a partial production logging contract. Remaining component update,
Deno adapter, manifest/SSG diagnostics and optional access logs need review. Development SSR error pages still include detailed application
exceptions; keep secrets out of authored error messages. Workers Logs ingestion,
production source-map resolution and configurable build/startup budgets remain
release work. Local workerd acceptance verifies event emission and redaction,
not ingestion into Cloudflare's remote logging service.
