---
title: "Server Adapters"
description: "Cossack is designed to be runtime-agnostic, with core framework logic decoupled from the server environment via the CossackServerRuntime interface."
---

# Server Adapters

Cossack is designed to be runtime-agnostic. The core framework logic is decoupled from the underlying server environment using the `CossackServerRuntime` interface.

We currently support two official adapters:

## 1. Cloudflare Workers (Default)

This is the primary and most feature-complete adapter, leveraging Cloudflare's unique capabilities.

-   **Runtime:** Cloudflare Workers
-   **Transport:** Cloudflare Durable Objects (WebSockets)
-   **State Persistence:** Automatic via Durable Object Storage.
-   **Scalability:** Durable Objects provide strong consistency and global uniqueness for component instances.

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

This adapter allows you to run Cossack applications on a standard Node.js server (e.g., in a container, on a VPS, or locally).

-   **Runtime:** Node.js (>= 20)
-   **Transport:** `ws` library (WebSockets)
-   **State Persistence:** **Memory Only**. State is lost when the server process restarts.
-   **Scalability:** Suitable for single-instance deployments or sticky-session clusters.

### Usage

To use the Node.js adapter, your application entry point must initialize a Node.js HTTP server and attach the `CossackNodeAdapter`.

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
