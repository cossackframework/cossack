# The @Page Decorator

The `@Page` decorator is used to mark a class as a Cossack component and configure its behavior, routing, and transport.

## Usage

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({
    transport: 'durable-object', // or 'http', 'websocket'
    middlewares: [myMiddleware],
    channels: ['global', 'notifications'],
})
export default class MyPage extends Cossack {
    template() {
        return html`<h1>Hello World</h1>`;
    }
}
```

## Options

| Option | Type | Description |
| :--- | :--- | :--- |
| `transport` | `'durable-object' \| 'http' \| 'websocket'` | The transport mechanism for server communication. Default is `'http'`. |
| `middlewares` | `MiddlewareHandler[]` | An array of Hono middleware handlers to apply to this page's route. |
| `channels` | `string[]` | A list of state synchronization channels this page belongs to. Default is `['global']`. |
| `providers` | `{ [key: string]: StateProvider }` | Custom state providers for this component. |
| `route` | `string` | (Optional) Explicitly define the route. If omitted, the file-system-based route is used. |

## Middlewares

Cossack integrates directly with Hono's middleware system. You can pass any standard Hono middleware to the `@Page` decorator. These will be executed on the server before the page is rendered or an action is handled.

```typescript
const authGuard: MiddlewareHandler = async (c, next) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login');
    await next();
};

@Page({
    middlewares: [authGuard]
})
export default class Dashboard extends Cossack {
    // ...
}
```

## Transport Modes

### `durable-object` (Default for real-time)
Uses Cloudflare Durable Objects to maintain state. State is persisted automatically and shared between all users on the same channel (if configured).

### `websocket`
Uses standard WebSockets. On Node.js, this uses an in-memory runtime. On Cloudflare, it also typically points to a Durable Object but is a more generic flag.

### `http`
Stateless request/response mode. Good for traditional forms, APIs, or pages that don't need real-time synchronization. Server actions are called via HTTP POST.
