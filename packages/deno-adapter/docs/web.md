---
title: Deno web and Deno Deploy
description: Serve Cossack over Deno HTTP and process-local WebSockets.
---

# Deno web and Deno Deploy

## Create and serve the adapter

`createDenoAdapter()` returns a Cossack runtime adapter plus `fetch()` and
`serve()` helpers:

```ts
const runtime = createDenoAdapter({
  env: Deno.env.toObject(),
  assetsRoot: './dist/client',
  hostname: '127.0.0.1',
  port: 3000,
  maxInstances: 512,
  idleTimeoutMs: 15 * 60_000,
});
```

| Option | Default | Purpose |
| --- | --- | --- |
| `env` | `{}` | Base values exposed through `c.env` and `this.env` |
| `assetsRoot` | `./dist/client` | Vite client output served before SSR routes |
| `hostname` | Deno default | Local `Deno.serve()` hostname |
| `port` | Deno default | Local `Deno.serve()` port |
| `maxInstances` | `512` | Maximum process-local WebSocket component instances |
| `idleTimeoutMs` | 15 minutes | Idle-instance eviction threshold |

Environment values passed to `runtime.fetch(app, request, requestEnv)` override
the adapter's configured base values for that request.

## Static assets and `ASSETS`

The adapter serves files from `assetsRoot` with Hono's Deno static middleware.
It also injects this compatible binding:

```ts
interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}
```

Application and middleware code can therefore read a static file with the same
`env.ASSETS.fetch(request)` shape used by other Cossack runtimes. Cossack retains
ownership of `/` and all document routes so SSR is not replaced by a generated
`index.html`.

## WebSockets

Pass the adapter to `createApp()` to enable its process-based upgrade handler.
The framework continues to resolve the component, authenticate the request,
check the origin, recompute the scope, and construct the component instance.

```ts
@Page({
  transport: 'durable-object',
  scope: (c) => `user:${c.get('user')?.id ?? 'anonymous'}`,
})
export default class CounterPage extends Cossack {
  @State() count = 0;

  @Server()
  increment() {
    this.count += 1;
  }
}
```

With a runtime adapter, this transport uses the adapter's in-memory WebSocket
engine rather than a Cloudflare Durable Object. Each component/provider/scope
target gets an isolated instance. Malformed client frames are isolated, action
calls retain the authenticated client identity, nested component targets are
supported, and instances with no clients are eligible for eviction.

Do not set `stateful: true` on Deno. There is no durable WebSocket persistence
or cross-process broadcast in this adapter. Store durable state in a database
and use the socket as a synchronization channel.

## Origin and secure protocol behavior

Cossack validates WebSocket origins before the adapter receives an upgrade.
Configure `allowedOrigins` through `createApp()` when additional origins are
intentional. The browser client selects `ws:` for an HTTP page and `wss:` for
an HTTPS page; do not hard-code a WebSocket scheme.

## Authentication and email

Normal Cossack web authentication works on Deno. Pass authentication middleware
and environment values in the same way as other runtimes. Auth projects reuse
the SMTP-compatible `env.EMAIL` contract:

```ts
await this.env.EMAIL.send({
  to: user.email,
  from: 'no-reply@example.com',
  subject: 'Reset your password',
  text: '...',
  html: '<p>...</p>',
});
```

Provide an implementation in `createDenoAdapter({ env })`; the adapter does not
select an SMTP provider.

## Local production serving

```sh
deno task build
deno task start
```

The generated start task grants only environment, network, and static-file read
permissions. Add permissions only when application-side Deno APIs require them.

## Deno Deploy

The exported default `fetch` handler is deployable without a separate Node
server. Build the Cossack client and SSR output before deploying:

```sh
deno task deploy
```

Remember that Deno Deploy may run multiple isolated instances. WebSocket state
and broadcasts do not span those instances. Use PostgreSQL, Turso, or another
shared datastore for durable application state.
