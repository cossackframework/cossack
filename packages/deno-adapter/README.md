# `@cossackframework/deno-adapter`

The Cossack web runtime adapter for local Deno and Deno Deploy. It connects the
runtime-neutral router to `Deno.serve()`, Hono's Deno static-file/WebSocket
helpers, an `ASSETS.fetch()` binding, and bounded process-local WebSocket
component instances.

```ts
import { createDenoAdapter } from '@cossackframework/deno-adapter';
import { createApp } from '@cossackframework/framework/router';

const runtime = createDenoAdapter({ env: Deno.env.toObject() });
const app = createApp({ runtimeAdapter: runtime });

export default {
  fetch: (request: Request, env?: Record<string, unknown>) =>
    runtime.fetch(app, request, env),
};

if (import.meta.main) runtime.serve(app);
```

Requirements: Deno 2.9+, Hono 4.12+, and ESM. `stateful: true` is rejected
because Deno WebSocket instances are process-local; persist durable state in a
database.

WebSocket connections to the same component/provider/scope share one pending
initialization and one runtime instance. `maxInstances` includes pending creation.
When socket activity triggers idle eviction, the adapter awaits component cleanup;
`idleTimeoutMs` does not install a periodic eviction timer. Cleanup waits for
active actions before destroying their component and services.

Call `await runtime.dispose()` when an embedded host stops using the adapter.
This closes its WebSocket clients, waits for pending initialization/actions, and
destroys cached components. Disposal is idempotent and rejects new upgrades;
HTTP fetch remains usable. Actions must eventually settle for cleanup to finish.
The server returned by `runtime.serve(app)` runs this cleanup when you await
`server.shutdown()` or when its native `finished` promise settles. Await
`server.finished` to observe completion and cleanup errors.

- [Introduction](./docs/introduction.md)
- [Installation](./docs/installation.md)
- [Web and Deno Deploy](./docs/web.md)
