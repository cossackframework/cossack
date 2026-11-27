---
title: "Pages"
description: "The @Page decorator marks a class as a Cossack component and configures its routing, behavior, and transport."
---

# Pages

Use the `@Page` decorator to mark a class as a Cossack page and set its behavior and transport. Its file under `src/pages` defines the URL.

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

The page class must be the file's default export. There is no `route` option: `@Page({ route })` throws `COSSACK_ROUTE_ALIAS_UNSUPPORTED`, because the file path defines the URL.

## Options
The `@Page` decorator accepts an optional object with these properties:

| Option | Type | Description |
| :--- | :--- | :--- |
| `transport` | `'durable-object' \| 'http' \| 'websocket' \| 'sse'` | The transport mechanism for server communication. Default is `'http'`. |
| `middlewares` | `MiddlewareHandler[]` | An array of Hono middleware handlers to apply to this page's route. |
| `channels` | `string[]` | A list of state synchronization channels this page belongs to. `'global'` is always added. Default is `['global']`. |
| `stateful` | `boolean` | When using `transport: 'durable-object'`, set to `true` to persist state in DO storage. Default is `false` (stateless). |
| `services` | `ServiceClass[]` | Services a layout owns and shares with its active subtree. See [Services](./services.md). |
| `ssg` | `boolean \| { enabled?: boolean; generateStaticParams?: () => Promise<Record<string, string>[]> }` | Pre-render this page at build time. See [Static Site Generation](./static-site-generation.md). |
| `allowCrossSiteForms` | `boolean` | Let forms on other sites post to this page's `post()`, for example an OAuth `form_post` callback. Default is `false`: a cross-site form post gets 403 `COSSACK_CROSS_SITE_REQUEST`. |
| `scope` | `(c: Context) => string \| Promise<string>` | Determines which state backend (SSE store entry, or Durable Object or Node instance) a request connects to. Default is per-user for SSE, per page instance (component + route params) for `durable-object`. A `durable-object` instance is always named by its page (or layout) plus the key, and the key must be a non-empty string. |

## Scope

The `scope` option selects the state backend that handles a request. It receives the Hono `Context`, which includes the user, route parameters, query parameters, and environment bindings. It returns a scope key.

### Default Behavior

- SSE: Per-user (`user:${user?.id || 'anonymous'}`). Each user gets isolated state.
- Durable Object: one instance per page plus its route params. The query string is not part of it.

To share one real-time instance per user, team or room with the
`durable-object` transport, see
[Share real-time state across pages with scope](./websockets.md#share-real-time-state-across-pages-with-scope).
A page's instance belongs to that page file. To share live state across
different page files, use a realtime layout or a realtime component: see
[Share live state across page files](./websockets.md#share-live-state-across-page-files).

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
// src/pages/rooms/[room]/index.ts
@Page({
    transport: 'sse',
    scope: (c) => `room:${c.req.param('room')}`
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

The server evaluates the scope function during SSR and embeds the computed `scopeKey` in the page's initial state. The client sends it back to the SSE endpoint and `/crpc`. The scope key is an identifier, not a credential: both endpoints evaluate the scope function again with the live authenticated user and the page's route params, and reject a different key with 403. The client forwards the page's query string to both, so a scope may read query params as well; a visitor who changes them only reaches another scope's state, so do not treat a query param as access control.

## Layouts and Nested Pages

See [Layouts](./layouts.md) to create and use layouts in Cossack.

## Markdown Pages

Cossack can also create pages from Markdown files that include components.

See [Markdown Pages](./markdown.md) to create these pages.

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
Uses standard WebSockets. On Node.js, this uses an in-memory runtime. On Cloudflare, it also points to a Durable Object. Only pages treat it as realtime: a realtime layout or component must use `transport: 'durable-object'`.

### `sse`
Uses Server-Sent Events for real-time server-to-client pushes. Client actions are sent via HTTP POST (`/crpc`), and state updates are pushed to all connected clients via an SSE stream. Multi-tab sync works through SSE broadcast. On Cloudflare, a SQLite-backed `SseDurableObject` (binding `COSSACK_SSE`) coordinates each scope; on Node, state lives in a process-local store. See [SSE](./sse.md).

```typescript
@Page({ transport: 'sse' })
```
