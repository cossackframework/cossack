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

A full-stack TypeScript framework for real-time web applications on edge and Node.js runtimes.

Write client and server logic in the same class. Deploy to Cloudflare Workers or a compatible Node.js runtime.

Think of it like Laravel + Next.js + Phoenix LiveView, but TypeScript native and edge deployment ready.

## Status

Cossack is in **alpha stage**. Breaking changes are expected. Do not use in production yet.

## Quick Start

```sh
npx cossack create my-app
cd my-app
pnpm install
pnpm dev
```

The CLI asks you to choose a runtime adapter:
- **Cloudflare Workers** (default): Deploy to Cloudflare and use Durable Objects for stateful WebSocket connections.
- **Node.js**: Run a server with `@hono/node-server`.

## Why Cossack?

Cossack lets client code call server methods through the same component model.

You do not need to write `fetch()` calls for these method calls. Client code can call server methods, and server code can call client methods.

```typescript
import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class Counter extends Cossack {
    @State() count = 0;

    increment() {
        // This runs secured on the server. 
        // The code is never exposed to the client
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

Cossack includes these framework features:

- File-based routing and nested layouts.
- Server-side rendering (SSR).
- Soft navigation with link prefetching and View Transitions API support.
- Real-time updates with SSE, WebSockets, or Cloudflare Durable Objects.
- Optimistic UI updates.
- Loading UI and error handling.
- Validation with decorators.
- Removal of server-only code from client bundles.
- Updates to only the changed parts of a page.
- Markdown pages with layouts and frontmatter.
- Static site generation (SSG).
- Runtime adapters for Cloudflare Workers and Node.js.
- Authentication with session management.
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

### Real-time support

Traditional frameworks rely on a single transport mode, usually HTTP. So to build real-time applications, you usually have to write WebSocket client and server code yourself. Cossack supports multiple transport modes, allowing you to choose the best one for each component. You can even mix and match transport modes in the same application. For example, you can use SSE for a live feed, WebSockets for a chat, and HTTP for a form submission.

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
pnpm run test:unit

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
