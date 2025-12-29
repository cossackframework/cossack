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
    render() {
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

## MDX Components

Cossack supports `.mdx` files as first-class page components. Any `index.mdx` file in your `src/pages` directory will be automatically transformed into a Cossack component.

### Metadata via Frontmatter

MDX components use frontmatter to define their metadata, which is automatically fed into the framework's `head()` merging system.

```markdown
---
title: "Documentation"
description: "Learn how to use Cossack"
image: "/assets/og-image.png"
---

# Welcome

Cossack is fast!
```

The fields `title`, `description`, and `image` are automatically mapped to the corresponding properties in the component's `head()` method, allowing them to be correctly merged with layouts and the global app shell.

### Layout Support

MDX components fully support the nested layout system. If an MDX file is placed in a folder with a `layout.ts`, it will be wrapped by that layout just like a standard TypeScript component.

## Layouts

Layouts in Cossack are simply components decorated with `@Page` that are named `layout.ts` in the file system. The key difference is that a layout's `template` method receives a `children` argument, which contains the rendered content of the nested page (or nested layout).

```typescript
@Page({ transport: 'http' })
export default class MyLayout extends Cossack {
    render(children: TemplateResult) {
        return html`
            <div class="wrapper">
                <header>My Header</header>
                <main>${children}</main>
            </div>
        `;
    }
}
```

Layouts can have their own state, transport, and middleware, just like regular pages.

## Middlewares

Cossack integrates directly with Hono's middleware system. You can pass any standard Hono middleware to the `@Page` decorator. These will be executed on the server before the page is rendered or an action is handled.

If a page is nested within layouts, the middlewares from all parent layouts are applied first, in order from root to leaf.

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
