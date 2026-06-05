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
| `transport` | `'durable-object' \| 'http' \| 'websocket'` | The transport mechanism for server communication. Default is `'http'`. |
| `middlewares` | `MiddlewareHandler[]` | An array of Hono middleware handlers to apply to this page's route. |
| `channels` | `string[]` | A list of state synchronization channels this page belongs to. Default is `['global']`. |
| `providers` | `{ [key: string]: StateProvider }` | Custom state providers for this component. |
| `route` | `string` | (Optional) Explicitly define the route. If omitted, the file-system-based route is used. |

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
Uses Cloudflare Durable Objects to maintain state. State is persisted automatically and shared between all users on the same channel (if configured).

### `websocket`
Uses standard WebSockets. On Node.js, this uses an in-memory runtime. On Cloudflare, it also typically points to a Durable Object but is a more generic flag.
