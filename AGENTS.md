# Cossack Framework
You are TypeScript developer working on Cloudflare Workers and Node.js runtime.

## Rules
- Run type checks after code changes: `pnpm tsc --noEmit`
- Create/run tests for new features and bug fixes.
- This project is a pnpm monorepo, all packages located at `packages` directory.
- Check `/specs/architecture.md` and other specs for architectural guidelines before making significant changes.
- Project is in alpha stage, prefer to break things than to maintain backward compatibility.

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
-   **`database`**: Active Record entities, migrations, seeders, and D1/Turso/PostgreSQL/MySQL adapters. The framework remains ORM-agnostic; use `cossack add database`.
-   **`test-utils`**: Test helpers
-   **`scaffold`**: Node-only recipe engine for creation and feature composition. Use this repository as example/template for new projects.
-   **`cossack`**: The Cossack CLI. It consumes `scaffold` directly.
-   **`ui`**: UI components package. shadcn-ui inspired components.
-   **`romedb`**: RomeDB service-protocol client on Web APIs, request bindings with exact write recovery, typed values.
-   **`cms`**: The open-source CMS on RomeDB: collections (schemaless, defined in the dashboard), blocks, rich text (ProseMirror JSON), taxonomies, media with resized variants, settings, themes (plugins), menus, scheduling, previews, revisions, redirects, SEO, comments, patterns, translations, API tokens, webhooks, two-step sign-in and passkeys, resources and schema planner, repositories, auth storage, stores, outbox, plugin hosting. `cossack add cms` renders it into the shared `auth` and `dashboard` pages, with a default theme in `src/plugins/default-theme/`. The package is also an application: `packages/cms/app` holds the CMS pages, components and API routes that `cossack add cms` renders (listed in its `cossack-recipe.json`), and `pnpm dev:cms` runs it against workspace sources; its shared shell is synced from the scaffold template (`specs/cms-package-app.md`). The app builder (Platform) is a separate private repository that uses it.

## 4. Development Workflow

1.  **Build Dependencies**: Build packages first `pnpm build`.
2.  **Run Application**: Use `pnpm run dev`.

## Security: Code Stripping

The framework includes a `vite-security-plugin` that automatically strips server-only code from client bundles. This ensures that server logic, such as database queries or secret handling, is never exposed to the client. 

## Running Tests

### Unit Tests
pnpm run test:unit

### E2E Tests
pnpm run test:e2e

### CLI Integration Tests
Run them through pnpm, for example `pnpm --filter cossack run test:integration tests/deploy-integration.test.js`.
Never run them with vitest directly: outside `pnpm run`, generated test apps can install packages through their linked folders and corrupt the repository's `node_modules`.

### Slow Suites: Run Locally Before a Release
CI skips these suites because they are slow or need Docker or a display. Run both locally before every release, and report the results in the release PR:

- `pnpm test:databases`: live PostgreSQL and MySQL suites, plus Studio introspection against both, and the RomeDB client and CMS suites. Needs Docker, or set `COSSACK_TEST_POSTGRES_URL` and `COSSACK_TEST_MYSQL_URL`; the RomeDB suites need a RomeDB 0.2.9+ executable through `COSSACK_TEST_ROMEDB_BIN` or `PATH`.
- `pnpm test:desktop`: packages and runs the Desktop app, including its dev restart check.

Also run them after changing `packages/database`, `packages/studio`, `packages/desktop`, `packages/romedb` or `packages/cms`.

## Docs References
Use Cloudflare skills and MCP server, however, if you still need to find docs for solutions, you can use the following links:

- https://developers.cloudflare.com/llms.txt — directory of every Cloudflare product.
- https://developers.cloudflare.com/workers/llms.txt - Workers related docs
- https://developers.cloudflare.com/agents/llms.txt - Agents related docs
- https://developers.cloudflare.com/r2/llms.txt - R2 related docs
- https://developers.cloudflare.com/d1/llms.txt - D1 related docs
