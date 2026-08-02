# Cossack Framework
You are TypeScript developer working on Cloudflare Workers and Node.js runtime.

## Rules
- Run type checks after code changes: `pnpm tsc --noEmit`
- Create/run tests for new features and bug fixes.
- This project is a pnpm monorepo, all packages located at `packages` directory.
- Check `/specs/architecture.md` and other specs for architectural guidelines before making significant changes.
- Project is in alpha stage, so breaking changes are expected.

## Overview

Cossack is a modern, full-stack TypeScript framework. The core goal is to enable developers to write applications with a unified syntax on only one component that runs on both the server (Cloudflare Workers, Node.js) and the client. Client and server methods can call each other directly without complex `fetch()`, instead, the framework setups proxy between them.

## 2. Core Principles

-   **Web Standard APIs Preferred**: Code intended for the core library or shared components should avoid Node.js-specific APIs (`fs`, `path`, etc.) to maintain edge compatibility. However, the framework now supports a Node.js runtime adapter, so Node.js APIs can be used within that specific context or in user applications targeting Node.js.
-   **Cloudflare-First Ecosystem**: Prioritize Cloudflare products for infrastructure needs (Durable Objects for state/WebSockets, D1 for database, R2 for storage, etc.), but the framework is architected to be runtime-agnostic via adapters.
-   **Strict Separation of Concerns**: The project is a monorepo with a clear distinction between the reusable **library** packages (`core`, `renderer`, `node-adapter`, `database`, `auth`) and the **application** package (`framework`). The libraries must *never* depend on the application.

## 3. Monorepo Package Architecture

The project is a `pnpm` workspace. All packages are located in the `packages` directory.

-   **`core`**: The core library.
-   **`renderer`**: The rendering engine. Inspired by Lit.
-   **`node-adapter`**: The Node.js runtime adapter.
-   **`framework`**: The meta framework package
-   **`auth`**: Auth package
-   **`database`**: The `@cossackframework/database` workspace package provides decorated Active Record entities, migrations, seeders, and D1/libSQL/PostgreSQL/MySQL adapters. The framework remains ORM-agnostic; use `cossack add database`.
-   **`test-utils`**: Test helpers
-   **`scaffold`**: Node-only recipe engine for creation and feature composition.
-   **`cossack`**: The Cossack CLI. It consumes `scaffold` directly.
-   **`ui`**: UI components package. shadcn-ui inspired components.

## 4. Development Workflow

1.  **Build Dependencies**: Build `core`, `renderer`, `node-adapter`, `database`, and `auth` first.
2.  **Run Application**: Use `pnpm run dev`.

## 5. Key Architectural Decisions & "Gotchas"

-   **`isServer` Check**: `typeof window === 'undefined' || typeof window.document === 'undefined'`.
-   **Metadata Merging**: Always use `head(context: HeadContext): HeadValue`. The framework automatically handles category preservation and auto-expands SEO shortcuts (`description`, `image`) into OG/Twitter tags.
-   **Client-Side Persistence**: The Global `App` component is bootstrapped once and persists across all navigations.
-   **Auto-Binding**: All component methods are automatically bound to the instance during `bootstrap`. Standard class methods can be used as event handlers without manual binding or arrow functions.
-   **Hierarchical Error Boundaries**: The router searches for the nearest `error/index.ts` or `404/index.ts` up the directory tree relative to the current route.

## Security: Code Stripping

The framework includes a `vite-security-plugin` that automatically strips server-only code from client bundles. This ensures that server logic, such as database queries or secret handling, is never exposed to the client. 

## Running Tests

### Unit Tests
pnpm run test:unit

### E2E Tests
pnpm run test:e2e

## Docs References
Use Cloudflare skills and MCP server, however, if you still need to find docs for solutions, you can use the following links:

- https://developers.cloudflare.com/llms.txt — directory of every Cloudflare product.
- https://developers.cloudflare.com/workers/llms.txt - Workers related docs
- https://developers.cloudflare.com/agents/llms.txt - Agents related docs
- https://developers.cloudflare.com/r2/llms.txt - R2 related docs
- https://developers.cloudflare.com/d1/llms.txt - D1 related docs
