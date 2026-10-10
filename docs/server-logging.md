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

Framework-managed API, SSR and unhandled middleware failures measure duration
from request-context entry. Standalone handlers without that middleware fall
back to their own scope start. This does not measure time before framework
middleware, startup, or background task execution.

Core component actions, iterator cleanup, server tasks, asynchronous component
cleanup, server update catches and service rollback/disposal emit
`cossack.runtime.failure`. Durable Object and Node transport failures use
the portable `@cossackframework/core/server-diagnostics` entry. Callers supply
bounded authored identifiers, never actual URLs or arbitrary input. Missing or
non-UUID IDs become `unavailable`. In-memory callbacks use generic dispatch
stages because parsing and delivery share the callback. Browser diagnostics
retain their existing behavior.

Development SSR fallback pages show a fixed code, request ID and authored route.
They do not publish exception text. Authored error boundary pages remain under
application control. Optional access logging emits `cossack.request` with the
matched route template and allowlisted HTTP method, omitting concrete paths and
queries. SSG loader/render/cleanup diagnostics use fixed events and failed-page
messages; controlled public-route failures retain `COSSACK_SSG_NOT_PUBLIC`.

This is partial release acceptance. Remote Workers Logs ingestion, production source-map resolution and configurable
startup budgets remain unverified by these source tests. CLI Cloudflare upload
size budgets are described in [Build budgets](./build-budgets.md). Local workerd
checks prove local emission and redaction, not remote logging service ingestion.


## Production server source maps

New web projects emit server maps through the generated
`environments.ssr.build.sourcemap` setting. Cloudflare artifacts use `dist/ssr`;
standalone Node builds use `dist/server`. Client maps remain opt-in. Cloudflare
projects also set `upload_source_maps: true`; deploy the built Wrangler artifact
so this setting and the matching server maps stay together. Existing applications
preserve their owned configuration during upgrades: add these settings explicitly.
Server JavaScript references its matching map with `sourceMappingURL`, which
Wrangler needs when uploading a prebuilt Worker. Keep server maps outside
`dist/client` and other publicly served asset roots.

These maps resolve generated JavaScript locations to authored TypeScript during
private diagnosis. They do not change the fixed failure events or add stack
traces, source paths or caught exception values to public responses. Cloudflare's
remote remapping handles uncaught exception stacks after invocation; a framework
catch that emits only a fixed code does not supply an exception stack to remap.
Local map verification does not prove uploaded maps or Workers Logs ingestion.
See [Cloudflare source maps and stack traces](https://developers.cloudflare.com/workers/observability/source-maps/).
