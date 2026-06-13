---
name: create-page
description: Create a new Cossack page component
disable-model-invocation: true
user-invocable: true
---

# Create a Cossack Page

You are creating a new page for a Cossack Framework application. Follow these instructions carefully.

## Step 1: Determine the Route

Ask the user:
1. What is the route/path for this page? (e.g., `/about`, `/users/[id]`, `/dashboard/settings`)
2. Should it use directory-based routing (`index.ts` inside a folder) or flat file routing?

Default to directory-based routing unless the user prefers flat files.

## Step 2: Determine Transport Mode

Ask or infer the transport mode:

| Transport | Use Case |
|-----------|----------|
| `http` (default) | Standard request/response pages. No real-time sync. |
| `durable-object` | Real-time pages with WebSocket state sync. Stateless by default — state is ephemeral. Add `stateful: true` to persist state in DO storage. |
| `websocket` | WebSocket-based without Durable Object persistence. |
| `sse` | Real-time server push via Server-Sent Events without Durable Objects. Actions via HTTP POST, state updates via SSE stream. Multi-tab sync. |

If the page needs real-time collaboration or live state sync across users, use `durable-object`. Otherwise, use `http`.

### Stateless vs Stateful Durable Objects

- **Stateless** (default): `@Page({ transport: 'durable-object' })` — DO acts as a WebSocket hub. State is ephemeral. Ideal for DB-backed apps.
- **Stateful**: `@Page({ transport: 'durable-object', stateful: true })` — State persists in DO storage. Use when the DO itself is the source of truth.

## Step 3: Create the File

### File Placement

Directory-based (recommended):
```
src/pages/<route>/index.ts
```

Flat file:
```
src/pages/<route>.ts
```

### Dynamic Routes

Use `[param]` syntax for dynamic segments:
- `/users/[id]` → `src/pages/users/[id]/index.ts`
- `/blog/[category]/[slug]` → `src/pages/blog/[category]/[slug]/index.ts`

### Route Groups

Use `(group)` syntax for layout grouping without affecting the URL:
- `src/pages/(auth)/login/index.ts` → URL is `/login`
- `src/pages/(auth)/register/index.ts` → URL is `/register`
- `src/pages/(auth)/layout.ts` → Shared layout for auth pages

## Step 4: Generate the Page Class

Use this template:

```typescript
import { Cossack, Page, Server, State, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page({
    transport: 'http', // or 'durable-object' for real-time
})
export default class PageName extends Cossack {
    // @State() properties for server-synced state
    // @ClientState() properties for client-only state

    @Server()
    async init() {
        // Server-side data loading
        // Access route params: this.c.req.param('name')
        // Access query params: this.c.req.query('search')
        // Access request context: this.c, this.env, this.user
    }

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Page Title',
            // description: 'Optional description (auto-expanded to OG/Twitter tags)',
            // image: 'Optional image URL',
        };
    }

    render(): TemplateResult {
        return html`
            <div>
                <h1>Page Title</h1>
            </div>
        `;
    }
}
```

### With Layout Wrapping

If the page should use a specific layout component, refer to the create-layout skill

### With Dynamic Params

```typescript
@Server()
async init() {
    const name = this.c.req.param('name');
    this.greeting = `Hello, ${name}!`;
}
```

### With HTTP Method Handlers (HTTP transport only)

Pages can handle POST/PUT/DELETE requests by defining corresponding methods:

```typescript
@Page({ transport: 'http' })
export class ContactPage extends Cossack {
    async post() {
        const body = await this.c.req.formData();
        // Process form data
        return this.c.redirect('/success');
    }

    render(): TemplateResult {
        return html`
            <form method="post" action="/contact">
                <!-- form fields -->
                <button type="submit">Submit</button>
            </form>
        `;
    }
}
```

### With Client-Side Loading Pattern

For pages that should show a loading skeleton immediately instead of waiting for server-side `init()`:

```typescript
@Page()
export default class DataPage extends Cossack {
    @State() data: string[] = [];

    async init() {
        // Runs on server when called via RPC
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.data = ['Item 1', 'Item 2'];
    }

    async clientInit() {
        // Runs on client after hydration — calls init() via RPC
        await this.init();
    }

    loadingTemplate() {
        return html`<div class="skeleton">Loading...</div>`;
    }

    render() {
        if (this.loading.init) {
            return this.loadingTemplate();
        }
        return html`<ul>${this.data.map(item => html`<li>${item}</li>`)}</ul>`;
    }
}
```

## Step 5: Verify

1. Ensure the file is in the correct location under `src/pages/`
2. Ensure the class extends `Cossack` and has the `@Page()` decorator
3. Ensure `render()` returns a `TemplateResult` using the `html` tagged template
4. If using `durable-object` transport, ensure the `COSSACK_OBJECT` binding is configured in `wrangler.jsonc`
5. Run type checks: `pnpm tsc --noEmit`
