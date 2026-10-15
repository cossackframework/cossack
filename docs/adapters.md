---
title: "Server Adapters"
description: "createApp() runs on Cloudflare Workers by default. A runtime adapter, such as the Node.js adapter, runs the same application on another server runtime."
---

# Server Adapters

`createApp()` runs on Cloudflare Workers by default. To run on another server
runtime, pass a runtime adapter: `createApp({ runtimeAdapter })`. The adapter
implements `CossackRuntimeAdapter`. It names the transports it supports and
handles WebSocket upgrades after the router has authorized them.

The framework supports two runtimes:

## 1. Cloudflare Workers (Default)

Cloudflare Workers is the default runtime. It uses Workers and Durable Objects.

- Runtime: Cloudflare Workers
- WebSocket transport: one Durable Object per page instance (the page plus its
  route params) or per scope key. See [scope](./websockets.md#scope--controlling-which-durable-object-instance-a-page-connects-to).
- SSE transport: the `SseDurableObject` coordinator (`COSSACK_SSE` binding)
- State persistence: Durable Object storage for `stateful: true` pages. Other
  pages keep state in memory while clients are connected.

### Usage

New Cossack apps use this runtime. The application entry point
(`src/index.ts`) exports a Worker module and the Durable Object classes that
`wrangler.jsonc` binds:

```typescript
import { createApp } from '@cossackframework/framework/router';
import { AppDurableObject } from '@cossackframework/framework/DurableObject';
import { SseDurableObject } from '@cossackframework/framework/SseDurableObject';
import { App } from './App';
import { template } from './root';

const app = createApp({ AppComponent: App, htmlTemplate: template });

export { AppDurableObject, SseDurableObject };
export default {
  fetch: app.fetch,
};
```

## 2. Node.js Adapter

Use this adapter to run a Cossack application on Node.js, such as in a container, on a VPS, or on your computer.

- Runtime: Node.js 22 or later
- WebSocket transport: the `ws` library. A `durable-object` page has one
  in-memory instance per page instance (the page plus its route params) or per
  scope key, the same identity as on Cloudflare.
- SSE transport: a store in the server process
- State persistence: memory only. State is lost when the server process
  restarts. This runtime does not support `durable-object` pages with
  `stateful: true`: their requests fail with an error.
- Scaling: one server process. Instances and SSE state are not shared between
  processes, so a cluster needs sticky sessions.

### Usage

Create the runtime with `createNodeAdapter()` and pass it to `createApp` as the
`runtimeAdapter`. Serve HTTP with the framework's `fetch` handler, then call
`runtime.attach(server, fetch)` with the same handler. The adapter sends every
`/ws/` upgrade through that handler, so middleware, origin checks,
authentication, route lookup and scope authorization all run before the adapter
accepts the socket.

```typescript
import { serve } from '@hono/node-server';
import { createApp } from '@cossackframework/framework/router';
import { createNodeAdapter, installNodeShutdown } from '@cossackframework/node-adapter';
import { App } from './App';
import { template } from './root';

const runtime = createNodeAdapter();
const app = createApp({ AppComponent: App, htmlTemplate: template, runtimeAdapter: runtime });
const env = { ...process.env };
const fetch = (request: Request) => app.fetch(request, env);

const server = serve({ fetch, port: Number(process.env.PORT) || 3000 });
runtime.attach(server, fetch);
installNodeShutdown(server, { dispose: () => runtime.dispose() });
```

`createNodeAdapter(options)` accepts:

| Option | Default | Description |
| --- | --- | --- |
| `maxInstances` | `512` | Largest number of process-local component instances, including instances that are still initializing. |
| `idleTimeoutMs` | 15 minutes | Time after the last client disconnects before an instance can be removed. |
| `maxPayload` | 1 MiB | Largest accepted WebSocket message. A larger message closes the socket with code 1009. |
| `destroyUnmatchedUpgrades` | automatic | What to do with an upgrade request whose path does not start with `/ws/`. See below. |

The request scheme follows the real Node socket. An upgrade on a TLS socket
(`node:https`) produces an `https://` request URL, so the default same-origin
check accepts `https://` pages. The adapter does not trust forwarded scheme
headers such as `x-forwarded-proto`. If a reverse proxy ends TLS in front of the
server, set `allowedOrigins` (see below).

Call `await runtime.dispose()` before you close an embedded server. Disposal
removes the upgrade listener, closes sockets, waits for active actions and
destroys components. `installNodeShutdown` does this for SIGTERM and SIGINT.

### Upgrade requests outside `/ws/`

The adapter handles only `/ws/` upgrades. By default it also rejects other
upgrade requests, but only when it is the only `upgrade` listener on the server
at the time the request arrives. It writes `HTTP/1.1 404 Not Found` and closes
the socket. Without this, an unmatched upgrade would keep its socket open until
the client gave up. When another listener is present (for example Vite's HMR
server or your own WebSocket server), the adapter leaves the request to that
listener.

Set `destroyUnmatchedUpgrades: true` to always reject unmatched upgrades, or
`false` to never touch them. With `false`, your own listener must end every
unmatched socket.

### Development with Vite

Add `cossackNode()` from `@cossackframework/node-adapter/vite` to the Vite
plugins. It serves the exported `app` from `/src/index.ts` and passes only `/ws/`
upgrades to the exported runtime. Vite keeps its own HMR WebSocket, and the
runtime never sees HMR upgrades, whatever `destroyUnmatchedUpgrades` is set to.

You can generate a project pre-configured with this adapter using the `cossack` CLI.

## Node static files

The generated Node entry routes built files the same way as the generated
Cloudflare configuration:

- It mounts `serveStatic` for `/assets/*` only, in front of the framework.
  Vite's hashed build output there skips global and page middleware. Hashed
  names get `Cache-Control: public, max-age=31536000, immutable`. A missing
  file under `/assets/` continues to the framework and its 404 handling.
- Every other request goes to the framework, including files from `public/`.
  The framework's assets middleware serves them from the `ASSETS` binding
  (`createStaticAssets`) after global and owning page/layout policies run.
  These responses get `Cache-Control: public, max-age=0, must-revalidate`.
  Known `index.html` and `.html` page aliases redirect to the canonical route
  after the page's policies run. The entry sets `index: false`, so a directory
  URL continues to SSR instead of serving its `index.html`. Missing files
  continue to SSR or API handlers.

The `/assets/` namespace is reserved for build output. The build fails if
`public/assets/` exists or a route resolves under `/assets`. See
[Static assets and authentication](./deployment.md#static-assets-and-authentication).
The build also fails for a route at a framework transport path, on every
runtime. See [Reserved paths](./routing.md#reserved-paths).
Projects generated before this layout mount `serveStatic` for every path, so
page and global policies do not protect their `public/` files. Change that
mount to `app.use('/assets/*', ...)` as in a newly generated `src/index.ts`.
`cossack upgrade --apply-template` updates the entry if you have not edited it.
Node does not read `public/_headers`. The entry sets the `/assets/*` cache
header itself. Set headers for `public/` files in middleware.

Both paths use `serveStatic` from `@cossackframework/node-adapter`, which
streams files from disk. It does not read a whole file into memory. Each
response has `Content-Length`, a weak `ETag`, `Last-Modified`, and
`Accept-Ranges: bytes`.

- Conditional requests: a matching `If-None-Match` returns `304 Not Modified`.
  If the request has no `If-None-Match`, an `If-Modified-Since` date at or after
  the file's `Last-Modified` time also returns `304`.
- Range requests: one `Range: bytes=...` on a GET request returns
  `206 Partial Content` with `Content-Range`. A range that starts past the end of
  the file returns `416 Range Not Satisfiable`. A request with several ranges, or
  an invalid range, gets the whole file with `200`. `If-Range` accepts only the
  file's unchanged `Last-Modified` date, because the `ETag` is weak.
- HEAD returns the same headers as GET without a body. It ignores `Range`.

The `cacheControl` option sets `Cache-Control` on `200`, `206`, and `304`
responses. It does not set it on `416` responses.

## Static asset boundaries

The Node and Desktop asset servers resolve symlinks before reading a file.
They reject files outside the configured asset directory, including symlinked
directory indexes. Keep the asset directory writable only by trusted build and
deployment processes.

The Desktop asset server answers every existing file in its asset directory
before the framework runs, so page and global policies do not apply to those
files. A packaged Desktop application contains these files, so policies could
not keep them from its user anyway. Do not ship private data in `public/`.

If a trusted reverse proxy terminates HTTPS before a Node server, configure
`createApp({ allowedOrigins: ['https://your-public-host'] })` for transport
requests. The default compares Origin against the request URL seen by the
framework. The proxy must control any forwarded headers used to reconstruct
that URL.
