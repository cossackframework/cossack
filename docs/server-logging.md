# Server failure events

Native `defineApi` handlers and class API methods emit `cossack.api.failure`
for unexpected failures. SSR rendering and its router cleanup catches emit
`cossack.ssr.failure`. Unhandled request middleware and configuration failures
emit `cossack.request.failure` instead of Hono's raw exception logger.

These events contain a UUID request ID, authored route template, action, runtime,
fixed stage/code and bounded nonnegative duration. They omit exception messages,
stacks, causes, custom properties, headers, payloads, concrete path parameters
and query strings. An unknown HTTP method is logged as `unknown`.

In development (`import.meta.env.DEV`), the request, SSR, API and RPC failure
lines are followed by a second line, `[cossack] caused by:`, with the thrown
error, its message and its stack. Production logs never carry it.

## A function for failures

The framework cannot know what an application may log, so its production lines hold
nothing of the error. An application can decide that for itself. Give `createApp` a
function, and the framework calls it for every failure it answers itself:

```ts
import { createApp, type ServerFailure } from '@cossackframework/framework/router';

const app = createApp({
  onServerFailure(failure: ServerFailure, error: unknown, c) {
    // `failure` is the framework's own line. Log what your rules allow of `error`.
    console.error(JSON.stringify({ event: 'app.failure', requestId: failure.requestId, route: failure.route,
      name: error instanceof Error ? error.name : 'unknown' }));
  },
});
```

- **When it runs.** For a page that fails while it loads or draws (`cossack.ssr.failure`),
  a server method (`cossack.rpc.failure`), a `defineApi` handler or class API method
  (`cossack.api.failure`), a middleware (`cossack.request.failure`), and a cleanup that fails
  after the response. It does not run for answers that are not failures of the server: a
  denial, a validation error, a client-visible error, a cancelled call, an `HTTPException`.
- **What it gets.** The line the framework logged (`event`, `requestId`, `route`, `action`,
  `runtime`, `durationMs`, `stage`, `code`), the thrown value as it was thrown, and the Hono
  context of the request. The context is absent only where the framework has none.
- **What it cannot do.** It cannot change the answer: the framework decided it before the
  function ran. What it throws is dropped, and a promise it returns that rejects is too.
- **Async work.** Return a promise to send the failure somewhere. On Cloudflare the
  framework gives it to `waitUntil`, so it finishes after the response.

The framework's own lines stay as they are, with or without the function. One application
runs in a process: the function of the last `createApp` is the one in use.

Use the response's `X-Cossack-Request-Id` to find the event. Internal API/request
JSON failures include the same `requestId` and a generic error code. The framework
replaces invalid existing response IDs with UUIDs and restores its managed ID
when a failing API method changes the header. Controlled authorization failures
and `HTTPException` responses keep their public behavior.

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
keep their current behavior.

Development SSR fallback pages show a fixed code, request ID and authored route.
They do not publish exception text. Authored error boundary pages remain under
application control. The optional access-logging middleware emits
`cossack.request` with the matched route template and allowlisted HTTP method,
omitting concrete paths and queries. It is not a package export: copy
`packages/framework/src/middlewares/logging.ts` into `src/middlewares/` and list
it in `src/bootstrap/middlewares.ts`. SSG loader/render/cleanup diagnostics use fixed events and failed-page
messages. Controlled public-route failures retain `COSSACK_SSG_NOT_PUBLIC`.

CLI Cloudflare upload size budgets are described in [Build budgets](./build-budgets.md).


## Production server source maps

Generated web projects emit server maps through the generated
`environments.ssr.build.sourcemap` setting. Cloudflare artifacts use `dist/ssr`.
Standalone Node builds use `dist/server`. Client maps remain opt-in. Cloudflare
projects also set `upload_source_maps: true`. Deploy the built Wrangler artifact
so this setting and the matching server maps stay together. Add these settings
to an existing application configuration explicitly.
Server JavaScript references its matching map with `sourceMappingURL`, which
Wrangler needs when uploading a prebuilt Worker. Keep server maps outside
`dist/client` and other publicly served asset roots.

These maps resolve generated JavaScript locations to authored TypeScript during
private diagnosis. They do not change the fixed failure events or add stack
traces, source paths or caught exception values to public responses. Cloudflare's
remote remapping handles uncaught exception stacks after invocation. A framework
catch that emits only a fixed code does not supply an exception stack to remap.
Local map validation does not cover uploaded maps or Workers Logs ingestion.
See [Cloudflare source maps and stack traces](https://developers.cloudflare.com/workers/observability/source-maps/).
