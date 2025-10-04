# Cossack Framework

A modern, stateful, real-time web framework built on Cloudflare Workers, Durable Objects, and Hono.

This is a pnpm monorepo containing the following packages:

-   `@cossackframework/core`: The core of the framework.
-   `@cossackframework/auth`: Authentication tools for the framework.
-   `@cossackframework/renderer`: The client-side rendering engine.
-   `@cossackframework/framework`: The public-facing meta-package.
-   `create-cossack-app`: A CLI tool to create new Cossack projects.

## Development

Install dependencies:
```sh
pnpm install
```

Run the local development server:
```sh
pnpm dev
```

This will start the development server for the `@cossackframework/core` package.
