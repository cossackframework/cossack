# Cossack Framework

This is the core package of the Cossack Framework, a modern, stateful, real-time web framework built on Cloudflare Workers, Durable Objects, and Hono.

It's recommended to use this package via `cossack` CLI for a seamless development experience, but it can also be used standalone in any project that needs a lightweight framework for building serverless applications on Cloudflare Workers or traditional server environments.

## Type Generation

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```sh
pnpm --filter @cossackframework/core run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
import type { CloudflareBindings } from './worker-configuration.d.ts'

const app = new Hono<{ Bindings: CloudflareBindings }>()
```