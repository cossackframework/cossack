# Installation & Setup

## Creating a New Project

The easiest way to start a new Cossack project is by using the `create-cossack-app` CLI tool.

### Usage

Run the following command in your terminal:

```sh
npx create-cossack-app@latest my-cossack-app
```

Replace `my-cossack-app` with your desired project name.

### Adapter Selection

During the setup process, you will be prompted to choose a server adapter:

1.  **Cloudflare Workers (Default):** Best for edge deployments, automatic state persistence, and scalability. Requires a Cloudflare account.
2.  **Node.js:** Best for traditional server deployments (Docker, VPS) or local development without Cloudflare dependencies. Note that component state is memory-only in this mode.

The CLI will automatically configure your `package.json`, `tsconfig.json`, and entry points based on your selection.

## Manual Installation

If you prefer to set up a project manually or integrate Cossack into an existing monorepo, follow these steps:

1.  **Install Core Dependencies:**
    ```sh
    pnpm add @cossackframework/core @cossackframework/renderer hono reflect-metadata
    ```

2.  **Install Adapter:**
    *   For Cloudflare: `pnpm add -D wrangler @cloudflare/workers-types`
    *   For Node.js: `pnpm add @cossackframework/node-adapter ws @hono/node-server` and `pnpm add -D @types/ws @types/node`

3.  **Configure Vite:**
    Cossack uses Vite for building both the client and server bundles. You will need separate configurations (`vite.client.config.ts` and `vite.ssr.config.ts`) to handle the dual-build process.

4.  **Create Entry Points:**
    *   `src/client/entry-client.ts`: Handles client-side hydration.
    *   `src/index.ts`: The server-side entry point (Worker or Node server).

Refer to the `packages/create-cossack-app/template` directory in the repository for a reference implementation.
