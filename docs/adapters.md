---
title: "Server Adapters"
description: "Cossack is designed to be runtime-agnostic, with core framework logic decoupled from the server environment via the CossackServerRuntime interface."
---

# Server Adapters

The `CossackServerRuntime` interface separates the framework core from the server environment.

The framework supports two adapters:

## 1. Cloudflare Workers (Default)

This is the default adapter. It uses Cloudflare Workers and Durable Objects.

- **Runtime:** Cloudflare Workers
- **Transport:** Cloudflare Durable Objects (WebSockets)
- **State Persistence:** Automatic via Durable Object Storage.
- **Scalability:** Durable Objects provide strong consistency and global uniqueness for component instances.

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

- **Runtime:** Node.js (>= 20)
- **Transport:** `ws` library (WebSockets)
- **State Persistence:** **Memory Only**. State is lost when the server process restarts.
- **Scalability:** Suitable for single-instance deployments or sticky-session clusters.

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
