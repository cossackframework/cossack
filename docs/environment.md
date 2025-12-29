# Environment Bindings

Cossack provides direct, type-safe access to your Cloudflare environment bindings (D1, KV, R2, Secrets, etc.) through the `this.env` property within any component.

## Typed Bindings

To get full TypeScript autocompletion for your environment, pass your bindings interface as the first generic parameter to the `Cossack` class.

### 1. Generate Types
First, ensure you have run the Wrangler type generation script:

```bash
pnpm run cf-typegen
```

This creates or updates `worker-configuration.d.ts` in your project root.

### 2. Use in Components

Since the generated file is an ambient declaration (included in your `tsconfig.json`), the `CloudflareBindings` type is available globally within your project. You don't need to import it; just pass it to the base class:

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

*   **Server-Side**: During SSR or Action execution, the environment object provided by Cloudflare is automatically injected into the component instance.
*   **Client-Side**: The `this.env` property is `undefined` on the client. Since Cloudflare resources are only accessible on the server, you should only access `this.env` inside methods that run on the server, such as `init()`, `get()`, or any method decorated with `@Server()`.

## Accessing from API Routes

API routes also benefit from typed environment bindings, allowing you to build robust backends:

```typescript
@Page({ transport: 'http' })
export class MyApi extends Cossack<CloudflareBindings> {
    async get() {
        const results = await this.env.DB.prepare('SELECT * FROM users').all();
        return this.c.json(results);
    }
}
```
