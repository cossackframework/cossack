---
title: "API Routes"
description: "Build backend endpoints directly in your project using functional or class-based API routes placed in the src/pages/api/ directory."
---

# API Routes

Cossack makes it easy to build backend endpoints directly within your project. You can choose between two styles: **Functional API Routes** for simplicity, or **Class-based API Routes** for shared state and advanced logic.

Place API routes under the public `/api` path. Route groups work here too:
`src/pages/(account)/api/items/[id].ts` serves `/api/items/:id`.

## Cross-origin requests (CORS)

CORS is built in for `/api` and `/api/*`. It is enabled by default, but the
default origin list is empty, so no cross-origin website is trusted until you
configure one. Same-origin requests and non-browser clients are unaffected.

Set `CORS_ORIGINS` to a comma-separated allowlist:

```dotenv
# .env (Node) or .dev.vars (Wrangler local development)
CORS_ORIGINS=https://app.example.com,https://*.example.org
CORS_CREDENTIALS=true
```

Exact HTTP(S) origins, `*`, scheme-specific subdomain patterns such as
`https://*.example.com`, and scheme-less patterns such as `*.example.com` are
supported. Wildcard subdomains do not include the apex (`example.com`). The
global `*` cannot be combined with credentials.

Preflight requests return `204` before project auth/database middleware runs.
CORS is intentionally not applied to pages or framework transport endpoints
such as `/crpc`, uploads, SSE, and WebSockets. See [Configuration](./config.md#cors).

## Functional API Routes (Zero-Config)

For most use cases, you can simply export a standard Hono handler.

### All Methods (`default` export)
If you export a function as the default, it will handle **all** HTTP methods for that route.

```typescript
// src/pages/api/echo.ts
export default (c) => {
  return c.json({ 
    message: 'Echo!',
    method: c.req.method 
  });
};
```

### Specific Methods (Named exports)
You can export functions named `GET`, `POST`, `PUT`, `DELETE`, or `PATCH` to handle specific HTTP methods.

```typescript
// src/pages/api/users.ts
export const GET = (c) => {
  return c.json([{ id: 1, name: 'Alice' }]);
};

export const POST = async (c) => {
  const data = await c.req.json();
  // save to DB
  return c.json({ success: true }, 201);
};
```

## Declared input and output

Use `defineApi` from `@cossackframework/framework/api` to add runtime contracts
to a native handler. Declare request locations explicitly. Only declared
locations appear in `input`. Core schemas infer their parsed types and reject
unknown object fields by default.

```typescript
// src/pages/api/items/[id].ts
import { input } from '@cossackframework/core';
import { defineApi } from '@cossackframework/framework/api';

export const POST = defineApi({
  input: {
    params: input.object({ id: input.string() }),
    query: input.object({ page: input.number({ coerce: true, min: 1 }) }),
    body: input.object({ amount: input.number({ min: 1 }) }),
  },
  output: input.object({ id: input.string(), total: input.number() }),
  authorize: ({ input, c }) => {
    // Install your authentication middleware first. This identity must come
    // from that trusted middleware, never from the incoming JSON body.
    return Boolean(c.get('user')) && input.body.amount < 10;
  },
  handler: ({ input, signal }) => {
    signal.throwIfAborted();
    return { id: input.params.id, total: input.query.page + input.body.amount };
  },
});
```

The order is input parsing, authorization, handler execution, then output
validation and JSON serialization. Invalid input causes no handler calls.
Authorization must return `true`; a false result returns 403. Schemas and
authorizers are trusted application callbacks. Keep them free of mutations.
Pass `signal` to their cancellable I/O.

Path values come from Hono's decoded parameters. Query values are strings.
Repeated scalar query keys reject. Declare array keys explicitly with
`queryArrays: ['tags']` and a query schema such as
`input.object({ tags: input.array(input.string()).optional() })`. One supplied
tag stays a one-element array. Missing optional tags remain absent. Query
input is limited to 1,024 pairs and 64 KiB of encoded text.

Body schemas read JSON, including `application/*+json` content types. Missing
bodies parse as `undefined`, so use an optional schema when absence is allowed.
The reader checks actual stream bytes, rejects invalid UTF-8, and releases its
lock on failure or cancellation. `maxBodyBytes` defaults to 1 MiB and accepts
1 through 16 MiB. Schemas also retain core depth, node and array bounds.
An undeclared body stays available for native request handling.

With `output`, return data of the schema's parsed type. Dates become ISO
strings on the wire. A `Response` cannot bypass output validation. Output
validation errors, unsupported serialized values and unexpected callback
exceptions return a private 500 error. The server logs the cause with a
request ID. Schema validation messages are public; do not include secrets in
them.

Omit `output` to return a native `Response`. This mode preserves cookies,
redirects, status codes and streaming bodies. It does not assert a JSON output
schema. A default handler takes precedence over named handlers and appears
as method `'*'` in generated types.

```typescript
import { defineApi } from '@cossackframework/framework/api';
export default defineApi({
  handler: ({ c }) => {
    c.header('Set-Cookie', 'seen=yes; HttpOnly; SameSite=Lax');
    return c.redirect('/home', 303);
  },
});
```

`timeoutMs` defaults to 10 seconds and accepts 1 through 300,000 milliseconds.
It covers asynchronous work until JSON or native response headers are ready.
Disconnect and timeout release the framework's wait even if a callback ignores
abort. Late response bodies are cancelled. This does not terminate application
I/O, interrupt synchronous code or roll back completed writes. After native
headers, the streaming handler owns body cancellation and lifetime; use the
original request signal for that lifetime.

Contract failures return `{ error, code, requestId }`. Expected schema failures
also include location-prefixed `fieldErrors`. The same ID appears in
`X-Cossack-Request-Id`.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `COSSACK_VALIDATION_FAILED` | A declared input schema rejected data. |
| 400 | `COSSACK_API_JSON_INVALID` | Malformed JSON or invalid UTF-8. |
| 400 | `COSSACK_API_QUERY_REPEATED` | Repeated scalar query key. |
| 401 | `COSSACK_AUTH_UNAUTHENTICATED` | An existing auth guard requires authentication. |
| 403 | `COSSACK_AUTH_FORBIDDEN` | Authorization denied access. |
| 413 | `COSSACK_API_INPUT_TOO_LARGE` | Body or query bound exceeded. |
| 415 | `COSSACK_API_MEDIA_TYPE` | A declared body needs a JSON media type. |
| 499 | `COSSACK_API_CANCELLED` | The incoming request was cancelled. |
| 500 | `COSSACK_API_INTERNAL` | A private callback or output failure. |
| 504 | `COSSACK_API_TIMEOUT` | The contract deadline elapsed. |

An authored `ClientVisibleError` from the handler returns 400 with
`COSSACK_API_REJECTED`. An authored Hono `HTTPException` preserves its response
and adds the correlation header. Treat those authored bodies as public.
Class API methods can call a declared wrapper explicitly with `this.c`.
Their ordinary native calls do not automatically execute `@Server` guards.

## Generated API types

Run `cossack routes --generate` and configure the
[typed route import](./routing.md#typed-urls). Vite also generates the file.
The same module exposes `ApiRoutes`, `ApiRequest` and `ApiResponse` types.

```typescript
import type { ApiRequest, ApiResponse } from 'virtual:cossack-routes';
type SaveInput = ApiRequest<'/api/items/[id]', 'POST'>;
type SaveResult = ApiResponse<'/api/items/[id]', 'POST'>;
```

`ApiRequest` uses each schema's raw input type. Coercing number schemas can
accept strings; strict number schemas require numbers. `ApiResponse` uses the
serialized output type, or `Response` in native mode. Plain handlers have
unknown contracts. Class endpoints do not invent native method contracts.
These declarations guide callers; they do not add a fetch client or replace
runtime validation. Type-only references follow actual source exports and
aliases. They disappear from the browser output.

`ApiInput`, `ApiRawInput` and `ApiOutput` at the `/api` package entry infer
contracts directly from a declared handler. `cossack routes --json` reports
effective methods, declared locations, authorization/output declarations and
source lines. Dynamic/spread declarations remain unknown. Inspection never
imports schemas or runs callbacks.

## Browser boundary for functional handlers

Functional HTTP route modules run on the server.
The client compiler identifies their default handler or named HTTP exports through the shared route classifier.
It replaces those exports with throwing stubs before loading imports or executing module code.
This also covers handlers that use Web APIs or bindings directly, without a database library import.
API source bodies and their private dependencies do not enter the browser route catalog.
SSR keeps the original module.
The classifier recognizes `defineApi` imports, local const aliases, namespace
imports, and default export aliases. Keep factory imports at the documented
`/api` entry and use explicit local exports for compiler inspection.

Call an API through its URL from browser code.
Do not import its handlers into a client method.
Move browser-shared data or pure utilities into a separate module outside the route tree.
Use explicit exports for native handler modules.
A runtime `export *` has an unknown stub interface and fails with a source-bearing compiler diagnostic.
Cossack page classes retain the usual method stripping and RPC behavior.

## Class-based API Routes

If you prefer an object-oriented approach, you can extend the `Cossack` base class.

A class **without** a `render()` method is treated as a pure API route: every HTTP
method it defines returns JSON (no HTML rendering). Use `get()` to handle `GET`
requests : it matches the HTTP method directly and is server-only, so no
`@Server()` decorator is required. `init()` is kept as a server-side alias.

```typescript
import { Cossack, Page } from '@cossackframework/core';

@Page()
export default class MyApi extends Cossack {
    async get() {
        return this.c.json({ message: 'Hello from class!' });
    }

    async post() {
        const body = await this.c.req.json();
        return this.c.json({ echo: body }, 201);
    }
}
```

### Pages that also expose endpoints

A class **with** a `render()` method is a regular page: `GET` renders HTML through
SSR, while `post()` / `put()` / `patch()` / `delete()` are still exposed as JSON
endpoints on the same route. This is handy for co-locating a form's view with its
submit handler.

### Server-only lifecycle methods

`get()` and `init()` are server-only : their bodies are stripped from client
bundles. For client-side initialization that runs after hydration, override
`clientInit()` instead.

## Rate Limiting

API routes and `@Server` methods can be protected from abuse with `RateLimit`, which enforces **server-side** request limits and responds `429 Too Many Requests` when a caller exceeds them. See the dedicated [Rate Limiting guide](/docs/rate-limiting.md) for options, the `RateLimit()` wrapper, the `@RateLimit()` decorator, and the storage backends (Durable Object, Redis/Upstash, KV).

```typescript
import { RateLimit } from '@cossackframework/core';

// 3 requests per 10 seconds per caller.
export const GET = RateLimit({ window: 10_000, max: 3 }, (c) => {
    return c.json([{ id: 1, name: 'Alice' }]);
});
```

## Routing Conventions

Cossack follows a standard file-based routing convention for API routes:

* `src/pages/api/hello.ts` → `/api/hello`
* `src/pages/api/users/index.ts` → `/api/users`
* `src/pages/api/users/[id].ts` → `/api/users/:id`

## Type Safety

You can use the `CloudflareBindings` type (generated by `cf-typegen`) to get full autocompletion for your environment bindings (D1, KV, etc.) inside your handlers.

```typescript
export const GET = async (c) => {
  const env = c.env as CloudflareBindings;
  const data = await env.MY_KV.get('some-key');
  return c.json({ data });
};
```
