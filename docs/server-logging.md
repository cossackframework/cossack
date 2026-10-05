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

This is a partial production logging contract. Core lifecycle/WebSocket logs,
adapter errors, manifest/SSG diagnostics and the optional access logger still
need review. Development SSR error pages still include detailed application
exceptions; keep secrets out of authored error messages. Workers Logs ingestion,
production source-map resolution and configurable build/startup budgets remain
release work. Local workerd acceptance verifies event emission and redaction,
not ingestion into Cloudflare's remote logging service.
