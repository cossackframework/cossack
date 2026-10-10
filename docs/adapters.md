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

To use the Node.js adapter, start a Node.js HTTP server and attach `CossackNodeAdapter` in your application entry point.

```typescript
import { serve } from '@hono/node-server';
import { CossackNodeAdapter, nodeRuntimeAdapter } from '@cossackframework/node-adapter';
import { createApp } from './router';
// Import your pages/components registry logic here

const app = createApp({ runtimeAdapter: nodeRuntimeAdapter });
// Keys must match Cossack route paths, e.g. '/account/:id'.
const componentRegistry = ...; // Map<RoutePath, ComponentClass>

const server = serve({
    fetch: app.fetch,
    port: 3000,
});

new CossackNodeAdapter({
    server,
    componentRegistry,
});
```

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
