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

- [Introduction](./docs/introduction.md)
- [Installation](./docs/installation.md)
- [Web and Deno Deploy](./docs/web.md)
