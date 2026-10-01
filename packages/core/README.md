# Cossack Framework

This is the core package for Cossack. It provides the framework's component and
runtime features.

Use this package through the `cossack` CLI, or use it on its own in an
application that runs on Cloudflare Workers or a server environment.

## Cloudflare Types

Cloudflare runtime types, such as `DurableObjectNamespace`,
`DurableObjectState`, and `WebSocketPair`, are global types in
[`worker-configuration.d.ts`](./worker-configuration.d.ts). You do not need to
import them. The deprecated `@cloudflare/workers-types` package is not a
dependency.

> **Note:** This is a library package, so it intentionally does not declare `wrangler` or a `cf-typegen` script. Application packages (e.g. `@cossackframework/framework`) generate their own bindings via `pnpm run cf-typegen` (`wrangler types`).
