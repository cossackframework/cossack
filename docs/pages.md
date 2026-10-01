---
title: "Pages"
description: "The @Page decorator marks a class as a Cossack component and configures its routing, behavior, and transport."
---

# Pages

Use the `@Page` decorator to mark a class as a Cossack page and set its behavior, route, and transport.

## Usage

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class MyPage extends Cossack {
    render() {
        return html`<h1>Hello World</h1>`;
    }
}
```

## Options
The `@Page` decorator accepts an optional object with these properties:

| Option | Type | Description |
| :--- | :--- | :--- |
| `transport` | `'durable-object' \| 'http' \| 'websocket' \| 'sse'` | The transport mechanism for server communication. Default is `'http'`. |
| `middlewares` | `MiddlewareHandler[]` | An array of Hono middleware handlers to apply to this page's route. |
| `channels` | `string[]` | A list of state synchronization channels this page belongs to. Default is `['global']`. |
| `providers` | `{ [key: string]: StateProvider }` | Custom state providers for this component. |
| `route` | `string` | (Optional) Explicitly define the route. If omitted, the file-system-based route is used. |
| `stateful` | `boolean` | When using `transport: 'durable-object'`, set to `true` to persist state in DO storage. Default is `false` (stateless). |
| `scope` | `(c: Context) => string \| Promise<string>` | Determines which state backend (SSE store entry or DO instance) a request connects to. Default is per-user for SSE, per-URL for DO. |

## Scope

The `scope` option selects the state backend that handles a request. It receives the Hono `Context`, which includes the user, route parameters, query parameters, and environment bindings. It returns a scope key.

### Default Behavior

- **SSE**: Per-user (`user:${user?.id || 'anonymous'}`). Each user gets isolated state.
- **Durable Object**: Per-URL. Each URL gets its own DO instance (unchanged from existing behavior).

### Per-Team

```typescript
@Page({
    transport: 'sse',
    scope: (c) => `team:${c.get('user').teamId}`
})
```

All users with the same `teamId` share the same state.

### Per-Room

```typescript
@Page({
    transport: 'sse',
    scope: (c) => `room:${c.req.query('room') || 'lobby'}`
})
```

### Shared (Broadcast to All Users)

```typescript
@Page({
    transport: 'sse',
    scope: () => 'shared'
})
```

Every user on this page shares the same state.

### How scope works

The scope function is evaluated **once during SSR** with the full page request context (including query params). The computed `scopeKey` is embedded in the page's initial state and passed by the client to the SSE endpoint and `/crpc` handler. This makes sure that all three contexts use the same scope : even when scope depends on query params that are not present in SSE or `/crpc` requests.

## Layouts and Nested Pages

See [Layouts](./layouts.md) to create and use layouts in Cossack.

## Markdown Pages

Cossack can also create pages from Markdown files that include components.

See [Markdown Pages](./mdx.md) to create these pages.

## Middlewares

Cossack uses Hono's middleware system. See [Middlewares](./middlewares.md) to apply middleware to pages and layouts or define server-only middleware.


## Transport Modes

### `http` (Default)
This mode sends one request and returns one response. Use it for forms, APIs, or pages that do not need real-time updates. Server actions use HTTP POST.

### `durable-object`
This mode uses a Cloudflare Durable Object as a WebSocket hub. By default, the Durable Object does not store state. State can reset when Cloudflare evicts the object. Set `stateful: true` to store state across connections and evictions.

```typescript
// Stateless (default) — state is ephemeral, ideal for DB-backed apps
@Page({ transport: 'durable-object' })

// Stateful — state persists in DO storage
@Page({ transport: 'durable-object', stateful: true })
```

### `websocket`
Uses standard WebSockets. On Node.js, this uses an in-memory runtime. On Cloudflare, it also typically points to a Durable Object but is a more generic flag.

### `sse`
Uses Server-Sent Events for real-time server-to-client pushes without Durable Objects. Client actions are sent via HTTP POST (`/crpc`), and state updates are pushed to all connected clients via an SSE stream. Works on plain Workers : no DO binding required. Multi-tab sync is supported via SSE broadcast. Note: connection tracking is in-memory (single Worker instance only).

```typescript
@Page({ transport: 'sse' })
```
