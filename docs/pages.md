---
title: "Pages"
description: "The @Page decorator marks a class as a Cossack component and configures its routing, behavior, and transport."
---

# Pages

The `@Page` decorator is used to mark a class as a Cossack component and configure its behavior, routing, and transport.

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
The `@Page` decorator accepts an optional configuration object with the following properties:

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

The `scope` option controls which state backend (SSE store entry or Durable Object instance) a request connects to. It receives the Hono `Context` (with access to the user, route params, query params, and env bindings) and returns a scope key string.

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

The scope function is evaluated **once during SSR** with the full page request context (including query params). The computed `scopeKey` is embedded in the page's initial state and passed by the client to the SSE endpoint and `/crpc` handler. This ensures all three contexts use the same scope — even when scope depends on query params that aren't present in SSE or `/crpc` requests.

## Layouts and Nested Pages

Refer to the [Layouts documentation](./layouts.md) for how to create and use layouts in Cossack.

## Markdown Pages

Cossack also supports creating pages using Markdown with embedded components. This allows you to write content in Markdown while still leveraging the power of Cossack's component system.

Refer to the [Markdown Pages documentation](./mdx.md) for how to create pages using Markdown with embedded components.

## Middlewares

Cossack integrates directly with Hono's middleware system. Refer to the [Middlewares documentation](./middlewares.md) for how to apply middlewares to pages and layouts, as well as how to define server-only middleware.


## Transport Modes

### `http` (Default)
Stateless request/response mode. Good for traditional forms, APIs, or pages that don't need real-time synchronization. Server actions are called via HTTP POST.

### `durable-object`
Uses Cloudflare Durable Objects as a WebSocket hub. By default, the DO is **stateless** — it acts as a real-time message broker without persisting state to DO storage. State is ephemeral and resets when the DO is evicted. Add `stateful: true` to persist state across connections and DO evictions.

```typescript
// Stateless (default) — state is ephemeral, ideal for DB-backed apps
@Page({ transport: 'durable-object' })

// Stateful — state persists in DO storage
@Page({ transport: 'durable-object', stateful: true })
```

### `websocket`
Uses standard WebSockets. On Node.js, this uses an in-memory runtime. On Cloudflare, it also typically points to a Durable Object but is a more generic flag.

### `sse`
Uses Server-Sent Events for real-time server-to-client pushes without Durable Objects. Client actions are sent via HTTP POST (`/crpc`), and state updates are pushed to all connected clients via an SSE stream. Works on plain Workers — no DO binding required. Multi-tab sync is supported via SSE broadcast. Note: connection tracking is in-memory (single Worker instance only).

```typescript
@Page({ transport: 'sse' })
```
