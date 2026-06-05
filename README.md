<div align="center">
  <a target="_blank" href="https://cossack.dev">
    <img src="https://raw.githubusercontent.com/cossackframework/cossack/master/docs/images/logo.svg" width="400" height="auto" alt="Cossack framework logo" style="max-width: 100%" />
  </a>
</div>

[![E2E Tests](https://github.com/cossackframework/cossack/actions/workflows/e2e-tests.yml/badge.svg)](https://github.com/cossackframework/cossack/actions/workflows/e2e-tests.yml)

# Cossack

A full-stack TypeScript framework for building stateful, real-time web applications with server-side rendering.

Write your UI and server logic in a single class — Cossack handles the rest.

## Quick Start

```sh
npx create-cossack-app@latest my-app
cd my-app
pnpm install
pnpm dev
```

The CLI will prompt you to choose a runtime adapter:
- **Cloudflare Workers** (default) — edge deployment with Durable Objects for stateful WebSocket connections
- **Node.js** — traditional server deployment via `@hono/node-server`

## Why Cossack?

**No API boilerplate.** Your server methods are directly callable from the client. No REST routes, no fetch wrappers, no loading state plumbing.

```typescript
import { Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class CounterPage extends Cossack {
    @State() count = 0;

    increment() {
        // This runs secured on the server. 
        // The updated state is sent back to the client automatically.
        this.count++;
    }

    render() {
        return html`
            <p>Count: ${this.count}</p>
            <button @click=${this.increment}>+</button>
        `;
    }
}
```

When the button is clicked, `increment()` runs secured **on the server**. The framework sends the updated state back to the client and re-renders automatically. The button is disabled while the request is in flight via `this.loading.increment`.

**Key features:**

| Feature | Description |
|---------|-------------|
| **File-based routing** | `src/pages/about/index.ts` → `/about` |
| **Server-side rendering** | First load is fully rendered HTML |
| **Soft navigation** | Client-side routing with pre-fetching on hover |
| **Real-time state sync** | WebSocket transport with Durable Objects |
| **Optimistic UI** | Instant client feedback before server confirms |
| **Code security** | Server-only code is automatically stripped from client bundles |
| **Light DOM components** | Easy global styling, no Shadow DOM complexity |
| **Nested layouts** | File-based layout inheritance |
| **MDX pages** | `.mdx` files as first-class routes with layout support |
| **Input validation** | Built-in validators with `@Validate` decorator |
| **Static site generation** | Pre-render pages at build time |
| **Runtime adapters** | Cloudflare Workers or Node.js |

## How It Works

Cossack uses a **decorator-based component model** where each class is both your UI template and your server controller.

```typescript
@Page({ transport: 'http' })       // Stateless HTTP (default)
@Page({ transport: 'durable-object' }) // Stateful WebSocket + Durable Object
```

### Transport Modes

- **HTTP** — Each `@Server` call sends state to the server, runs the method, and returns updated state as JSON. Simple, scalable, no persistent connection. Works everywhere.
- **Durable Object** — Bi-directional WebSocket connection to a Cloudflare Durable Object. Stateful, real-time, all connected clients receive live updates.

### Security Model

By default, all methods are **server-only**. Only explicitly marked code reaches the browser:

```typescript
@Server()     // Server-only, stubbed on client
@Client()     // Client-only, no-op on server
@Shared()     // Runs on both
@Optimistic() // Client-side preview before server confirms
```

Database queries, API keys, and business logic never leave the server.

## Project Structure

```
src/
├── App.ts                    # Global app shell (persists across navigation)
├── pages/
│   ├── index.ts              # → /
│   ├── about/index.ts        # → /about
│   ├── blog/
│   │   ├── layout.ts         # Layout wrapping all /blog/* routes
│   │   ├── index.ts          # → /blog
│   │   ├── [slug]/index.ts   # → /blog/:slug
│   │   └── index.mdx         # MDX support
│   └── api/
│       └── users/index.ts    # JSON API endpoint
└── client/
    └── entry-client.ts       # Client-side hydration entry
```

## Documentation

Full documentation is available in the [`docs/`](./docs/index.md):

- [Routing](./docs/routing.md) — File-based routing, dynamic routes, layouts
- [State Management](./docs/states.md) — `@State`, `@ClientState`, real-time sync
- [Components](./docs/components.md) — Reusable class-based components
- [HTTP Transport](./docs/http.md) — Interactive UIs, APIs, and form handling
- [Loading UI](./docs/loading.md) — Built-in loading states
- [Context](./docs/context.md) — Accessing request params, query strings
- [Framework Context](./docs/framework-context.md) — `this.env`, `this.user`, `this.c`
- [Validation](./docs/validation.md) — Input validation with decorators
- [MDX Support](./docs/page.md) — Markdown pages with frontmatter
- [Static Site Generation](./docs/static-site-generation.md) — Pre-rendering at build time

## Contributing

This is a pnpm monorepo. To get started:

```sh
pnpm install
pnpm --filter @cossackframework/core --filter @cossackframework/renderer --filter @cossackframework/node-adapter run build
pnpm --filter @cossackframework/framework run dev
```

### Running Tests

```sh
# Core unit tests
cd packages/core && pnpm vitest --run

# Renderer unit tests
cd packages/renderer && pnpm vitest --run

# Framework unit tests
cd packages/framework && pnpm vitest --run tests/

# E2E tests
cd packages/framework && pnpm exec playwright test
```

## License

MIT
