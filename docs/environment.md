---
title: "Environment Bindings"
description: "Direct, type-safe access to Cloudflare environment bindings including D1, KV, R2, and secrets through the this.env property."
---

# Environment Bindings

Cossack provides direct, type-safe access to your Cloudflare environment bindings (for example D1, KV, R2, and secrets) through the `this.env` property within any component.

## Typed Bindings

For full TypeScript autocompletion for your environment, pass your bindings interface as the first generic parameter to the `Cossack` class.

### 1. Generate Types
Run the Wrangler type generation script first:

```bash
pnpm run cf-typegen
```

This creates or updates `worker-configuration.d.ts` in your project root. `pnpm run typecheck` runs it first.

### 2. Use in Components

The generated file is an ambient declaration in `tsconfig.json`. The `CloudflareBindings` type is available throughout your project. Pass it to the base class without importing it:

```typescript
import { Cossack, Page, State, html } from '@cossackframework/core';

@Page()
export default class DataPage extends Cossack<CloudflareBindings> {
    @State()
    data: string | null = null;

    async init() {
        // Full autocompletion for your bindings!
        const value = await this.env.MY_KV_NAMESPACE.get('some-key');
        this.data = value;
    }

    render() {
        return html`<div>Data: ${this.data}</div>`;
    }
}
```

## How it Works

* On the server, the framework injects the environment object from Cloudflare into the component instance during SSR or Action execution.
* On the client, the `this.env` property is `undefined`. Cloudflare resources are only available on the server. Read `this.env` in server methods such as `init()`, `get()`, or a method decorated with `@Server()`.

## Accessing from API Routes

API routes also benefit from typed environment bindings. You can build backends with them:

```typescript
@Page({ transport: 'http' })
export default class MyApi extends Cossack<CloudflareBindings> {
    async get() {
        const results = await this.env.DB.prepare('SELECT * FROM users').all();
        return this.c.json(results);
    }
}
```

## Local values on Workers: `.dev.vars` and `secrets.required`

A generated Workers app declares its secrets in `wrangler.jsonc` under
`secrets.required`. When that list exists, Wrangler and the Vite dev server load
only the names it lists from `.dev.vars` (or `.env`). Every other name in the
file never reaches the Worker, without a warning: a `ROMEDB_URL` or a
development `APP_URL` written there is `undefined` in `this.env`, and the first
sign is often a failure in middleware.

- A secret the app needs in production too: add its name to
  `secrets.required`, then set it with `wrangler secret put` before you deploy.
- A value only development needs: set it in the Worker's configuration while
  the dev server runs, through the Vite preset. The preset adds it to the
  development values that mounted packages (such as the CMS or RomeDB) supply;
  `vite build` leaves it out.

```ts
// vite.config.ts
import { cossackApp } from 'cossack/vite';

export default (env: { mode: string; command: 'serve' | 'build' }) => cossackApp({
  cloudflare: {
    config: env.command === 'serve' ? { vars: { APP_URL: 'http://localhost:5173' } } : {},
  },
})(env);
```

A value that is not secret and is the same everywhere goes under `vars` in
`wrangler.jsonc`.
