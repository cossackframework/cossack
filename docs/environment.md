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

This creates or updates `worker-configuration.d.ts` in your project root.

### 2. Use in Components

The generated file is an ambient declaration in `tsconfig.json`. The `CloudflareBindings` type is available throughout your project. Pass it to the base class without importing it:

```typescript
import { Cossack, Page, html } from '@cossackframework/core';

@Page()
export default class DataPage extends Cossack<CloudflareBindings> {
    
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
export class MyApi extends Cossack<CloudflareBindings> {
    async get() {
        const results = await this.env.DB.prepare('SELECT * FROM users').all();
        return this.c.json(results);
    }
}
```
