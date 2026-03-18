[![E2E Tests](https://github.com/cossackframework/core/actions/workflows/e2e-tests.yml/badge.svg)](https://github.com/cossackframework/core/actions/workflows/e2e-tests.yml)

# Cossack Framework

Cossack is a modern, full-stack TypeScript framework designed for the edge computing and AI era. It enables developers to write code once that runs on both the server (Cloudflare Workers) and the client, simplifying the complexities of client-server interaction.

Inspired by frameworks like Phoenix Liveview and .NET Blazor, Cossack uses WebSockets and Cloudflare Durable Objects to create stateful, real-time web applications with a unified and intuitive syntax.

## Project Architecture

This project is a monorepo managed by `pnpm`. It is divided into several distinct packages, each with a specific responsibility. This separation of concerns is key to the framework's design.

### Core Packages

-   **`@cossackframework/core`**: The heart of the framework. It provides the `Cossack` base class, decorators (`@Page`, `@State`, `@Server`, `@Client`), the base `CossackDurableObject`, and other essential utilities. This package is a pure library and contains no application-specific logic.
-   **`@cossackframework/renderer`**: A dual-environment rendering engine inspired by `lit-html`. It has separate entry points for the server (`@cossackframework/renderer/server`) and the client, allowing the same `html` template syntax to be used for both initial server-side rendering and client-side hydration.
-   **`@cossackframework/node-adapter`**: Provides the runtime adapter for running Cossack applications on a standard Node.js server using `ws`.

### Application & Tooling

-   **`@cossackframework/framework`**: A complete, runnable application that serves as the primary example and template for a Cossack project. It consumes the `core` and `renderer` packages and contains all the application-specific logic, including the Cloudflare Worker entrypoint, the Hono router, page components, and the application-specific Durable Object.
-   **`@cossackframework/auth`**: (In Development) A package dedicated to handling authentication logic, including user sessions, database interactions, and middleware.
-   **`create-cossack-app`**: A command-line tool for scaffolding new Cossack Framework projects, providing a clean starting point for developers.

## Development

The development workflow requires building the library dependencies before starting the application's development server.

1.  **Install Dependencies:**
    ```sh
    pnpm install
    ```

2.  **Build Libraries:**
    Build the `core` and `renderer` packages. This only needs to be done once, or whenever you make changes to them.
    ```sh
    pnpm --filter @cossackframework/core --filter @cossackframework/renderer --filter @cossackframework/node-adapter run build
    ```

3.  **Run the Development Server:**
    Start the development server for the main application. `wrangler` will automatically rebuild the application when you make changes to its source code.
    ```sh
    pnpm --filter @cossackframework/framework run dev
    ```

## Testing

This project uses both unit tests (vitest) and end-to-end tests (Playwright).

### Unit Tests

Run unit tests for the core package:
```sh
cd packages/core && pnpm vitest --run
```

Run unit tests for the framework package:
```sh
cd packages/framework && pnpm vitest --run tests/
```

### End-to-End Tests

Run e2e tests using Playwright:
```sh
cd packages/framework && pnpm exec playwright test
```

Run e2e tests for a specific file:
```sh
cd packages/framework && pnpm exec playwright test e2e/pages/nested-state.spec.ts
```

Run e2e tests with UI mode:
```sh
cd packages/framework && pnpm exec playwright test --ui
```

Note: The `pnpm test` command in the framework package has a configuration issue where it attempts to run both vitest and playwright tests together. Use the specific commands above instead.

## Deployment

To deploy the application to Cloudflare Workers, run the deploy script from the `framework` package.

```sh
pnpm --filter @cossackframework/framework run deploy
```