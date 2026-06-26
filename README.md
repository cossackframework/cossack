<br>
<p align="center">
  <a target="_blank" href="https://cossack.dev">
    <img src="https://raw.githubusercontent.com/cossackframework/cossack/master/docs/images/logo.svg" width="400" height="auto" alt="Cossack framework logo" style="max-width: 100%">
  </a>
</p>

<br>

<p align="center">
    <a href="https://github.com/cossackframework/cossack/actions/workflows/e2e-tests.yml">
        <img src="https://github.com/cossackframework/cossack/actions/workflows/e2e-tests.yml/badge.svg">
    </a>
</p>

<br>

<h1 align="center">The Borderless TypeScript Framework</h1>

A full-stack TypeScript framework for building edge first, real-time web applications, LLM friendly.

Write client and server logics like no boundaries exist. Cossack automatically handles state synchronization, server-side rendering, and real-time updates. Think of it like Phoenix LiveView, but for TypeScript and the edge.

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

No more `fetch()`, no more query libraries, no more client-server boilerplate, even no more client-server components. Cossack is a **full-stack borderless framework** where your server and client code glues together, with security and performance in mind. 

Your server methods are directly callable from the client, and vice-versa.

```typescript
import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class Counter extends Cossack {
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

## Key Features

Cossack has a rich set of features that every modern web application needs, plus maximum Developer Experience (DX) and performance optimizations out of the box. 

- **Borderless**: Secured client-server, server-client direct method calls
- **File based routing**: with nested layouts
- **Server-side rendering (SSR)**: for first load performance and SEO
- **Soft navigation**: with pre-fetching on hover, View Transitions API support
- **Real-time support**: out of the box with SSE, WebSockets or Cloudflare Durable Objects
- **Optimistic UI**: for instant client feedback
- **Loading UI and error handling**: baked in
- **Built-in validation**: with decorators
- **Automatic code security**: server-only code is stripped from client bundles
- **Smart re-rendering**: only re-render the parts of the page that changed
- **Markdown pages**: that support layouts and frontmatter
- **Static site generation (SSG)**: for pre-rendering pages at build time
- **Runtime adapters**: for Cloudflare Workers, Node.js, or any other serverless platform
- **Authentication**: built-in with session management
- **R2 or S3 file storage integration**
- **Enterprise ready**: using Middleware, Service classes, and Dependency Injection (DI) for complex applications
- **Dev tools**: Ctrl+Click to jump to component definition, hot reload, and more
- **Customizing headers, scripts, and meta tags**: for SEO and social sharing
- **Image optimization**: with automatic resizing and format conversion
- **Tailwind support**
- **Latest Vite 8 and Hono version**
- **First class Cloudflare Workers support**
- **LLM friendly**: use less tokens, native TypeScript syntax, easy for LLMs to understand, type check, and generate code
- *and a lot more features to discover in the [documentation](https://cossack.dev/docs).*

### Per-component Transport Modes

Traditional frameworks rely on a single transport mode, usually HTTP. So in order to write real time applications, you usually to write websockets client and server yourself. Cossack supports multiple transport modes, allowing you to choose the best one for each component. You can even mix and match transport modes within the same application:

- **HTTP** *(default)* — Traditional HTTP requests for server communication. Stateless, one-way communication from client to server. Best for non-real-time applications or when real-time updates are not required.
- **SSE** — Server-Sent Events for real-time updates. Real-time, one-way communication from server to all connected clients. Best for applications that require live updates but do not need bi-directional communication.
- **Durable Object** — Bi-directional WebSocket connection to a Cloudflare Durable Object. Real-time, all connected clients receive live updates. Best for applications that require bi-directional communication with server-rendered state.
- **Websocket** — Bi-directional WebSocket connection to a Node.js server. Real-time, all connected clients receive live updates. Best for applications that require bi-directional communication with server-rendered state.

## Learning Cossack

Full documentation is available in the [Cossack Documentation](https://cossack.dev/docs).:

## Contributing

This is a pnpm monorepo. To get started:

```sh
pnpm install
# Build all packages, use --filter to build a single package
pnpm run build

# Run the `framework` package, which includes demo pages and a dev server
pnpm run dev
```

### Running Tests

```sh
## Unit tests
pnpm run test

## E2E tests
pnpm run test:e2e
```

## Credits

Cossack cannot exist without the following open source projects:

- [Vite](https://vite.dev/) (For bundling, HMR, and dev server)
- [Hono](https://hono.dev/) (For routing, middleware)
- [Lit](https://lit.dev/) (Cossack renderer is heavily inspired by Lit)
- [TypeScript](https://www.typescriptlang.org/) (For type safety and DX)
- [Cloudflare Workers](https://workers.cloudflare.com/) (For edge deployment and Durable Objects)

## License

MIT
