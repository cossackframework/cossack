---
title: "Server Adapters"
description: "The CossackServerRuntime interface separates the framework core from the server environment. The framework runs on Cloudflare Workers and Node.js."
---

# Server Adapters

The `CossackServerRuntime` interface separates the framework core from the server environment.

The framework supports two adapters:

## 1. Cloudflare Workers (Default)

This is the default adapter. It uses Cloudflare Workers and Durable Objects.

- Runtime: Cloudflare Workers
- Transport: Cloudflare Durable Objects with WebSockets
- State persistence: automatic through Durable Object storage
- Scaling: Durable Objects give each component instance strong consistency and a globally unique identity

### Usage

This adapter is used by default when creating a new Cossack app. The application entry point (`src/index.ts`) exports a standard Worker module:

```typescript
import { createApp, AppDurableObject } from '@cossackframework/framework';

const app = createApp();

export { AppDurableObject };
export default {
  fetch: app.fetch,
};
```

## 2. Node.js Adapter

Use this adapter to run a Cossack application on Node.js, such as in a container, on a VPS, or on your computer.

- Runtime: Node.js 20 or later
- Transport: the `ws` library with WebSockets
- State persistence: memory only. State is lost when the server process restarts.
- Scaling: single-instance deployments or sticky-session clusters

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
upgrade requests, ted `app` from `/src/index.ts` and passes only `/ws/`
upgrades to the exported runtime. Vite keeps its own HMR WebSocket.

You can generate a project pre-configured with this adapter using the `cossack` CLI.

## Static asset boundaries

The Node and Desktop asset servers resolve symlinks before reading a file.
They reject files outside the configured asset directory, including symlinked
directory indexes. Keep the asset directory writable only by trusted build and
deployment processes.

If a trusted reverse proxy terminates HTTPS before a Node server, configure
`createApp({ allowedOrigins: ['https://your-public-host'] })` for transport
requests. The default compares Origin against the request URL seen by the
framework. The proxy must control any forwarded headers used to reconstruct
that URL.
