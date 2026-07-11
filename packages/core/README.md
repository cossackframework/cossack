# Cossack Framework

This is the core package of the Cossack Framework, a modern, stateful, real-time web framework built on Cloudflare Workers, Durable Objects, and Hono.

It's recommended to use this package via `cossack` CLI for a seamless development experience, but it can also be used standalone in any project that needs a lightweight framework for building serverless applications on Cloudflare Workers or traditional server environments.

## Cloudflare Types

Cloudflare runtime types (e.g. `DurableObjectNamespace`, `DurableObjectState`, `WebSocketPair`) are provided as ambient globals via the checked-in [`worker-configuration.d.ts`](./worker-configuration.d.ts) — no import is needed in source code. The deprecated `@cloudflare/workers-types` package is no longer a dependency.

> **Note:** This is a library package, so it intentionally does not declare `wrangler` or a `cf-typegen` script. Application packages (e.g. `@cossackframework/framework`) generate their own bindings via `pnpm run cf-typegen` (`wrangler types`).