---
title: "Framework Context API"
description: "Access environment bindings, the authenticated user, and request context from any component."
---

# Framework Context API

The Framework Context API gives every component access to `env` (environment bindings), `user` (the authenticated user), and `c` (the request context). You do not need to pass these values through component properties. Pages and reusable components can use them.

> This is different from [Request Context](./context.md). That page covers the Hono request object for route parameters and query strings.

---

## Overview

| Property | Type | Description |
|----------|------|-------------|
| `this.env` | `Env` | Cloudflare environment bindings (for example D1, R2, KV, and DOs) |
| `this.user` | `User \| undefined` | Currently authenticated user (if any) |
| `this.c` | `Context` | Hono request context (params, queries, and headers) |

---

## How It Works

The root `App` component sets up these contexts. Descendant components can read them as properties.

On the server, these are the values from the current request. On the client, the framework restores these values from the initial server render.

---

## `this.env` - Environment Bindings

Read Cloudflare bindings from any component.

```typescript
import { Cossack, Component, Server, State } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component()
export class DatabaseViewer extends Cossack<CloudflareBindings> {
    @State()
    users: any[] = [];

    @Server()
    async loadUsers() {
        // Bindings exist only on the server: access D1 directly
        const stmt = this.env.DB.prepare("SELECT * FROM users");
        const result = await stmt.all();
        this.users = result.results;
    }

    render() {
        return html`
            <button @click="${this.loadUsers}">Load Users</button>
            <ul>
                ${this.users.map(u => html`<li>${u.name}</li>`)}
            </ul>
        `;
    }
}
```

### Available Bindings

`this.env` has the type of the component's first type parameter,
`Cossack<Env>`, and is `any` without one. On Cloudflare, `pnpm cf-typegen`
runs `wrangler types --env-interface CloudflareBindings` and writes the global
`CloudflareBindings` interface to `worker-configuration.d.ts` from
`wrangler.jsonc` (`cossack typecheck` writes it too):

```typescript
// worker-configuration.d.ts (generated)
interface CloudflareBindings {
    DB: D1Database;
    COSSACK_OBJECT: DurableObjectNamespace;
    // ... other bindings
}
```

Pass it to the component: `class DatabaseViewer extends Cossack<CloudflareBindings>`.

---

## `this.user` - Authenticated User

Access the authenticated user from any component.

```typescript
import { Cossack, Component } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component()
export class UserGreeting extends Cossack {
    render() {
        if (!this.user) {
            return html`<p>Please log in</p>`;
        }

        return html`
            <div>
                <p>Welcome, ${this.user.name}!</p>
                <p>Your ID: ${this.user.id}</p>
            </div>
        `;
    }
}
```

### User Interface

The `User` interface defaults to a minimal shape. Augment it from `src/models/User.ts` through declaration merging. Then `this.user` reflects the real user columns of your app:

```typescript
interface User {
    id: string;
}
```

```typescript
// src/models/User.ts
declare module '@cossackframework/core' {
    interface User {
        email: string;
        name: string;
    }
}
```

### Setting the User

A global middleware sets the user on the Hono context. The generated auth
middleware does this. A custom one looks like this:

```typescript
// src/middlewares/user.ts, listed in src/bootstrap/middlewares.ts
import { defineServerMiddleware } from '@cossackframework/core';

export const userMiddleware = defineServerMiddleware(async (c, next) => {
    // Set user from session/JWT/etc.
    c.set('user', { id: 'user-123', name: 'Alice' });
    await next();
});
```

### The User in the Browser

The browser receives only `{ id }` by default, so `this.user.name` is
`undefined` in client code. Opt fields in with `createApp({ publicUser })` in
`src/index.ts`. `id` always comes from the real user:

```typescript
createApp({ AppComponent: App, publicUser: (user) => ({ name: user.name }) });
```

`toPublicUser(user)` from `@cossackframework/core` returns that projection.

---

## `this.c` - Request Context

Access the Hono request context for route parameters, query strings, and more.

```typescript
import { Cossack, Page, State } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Page()
export default class UserProfilePage extends Cossack {
    @State()
    profile: any = null;

    async loadProfile() {
        // Get route parameter
        const username = this.c.req.param('username');

        // Get query parameter
        const tab = this.c.req.query('tab') || 'overview';

        // Load profile data
        this.profile = { username, tab };
    }

    render() {
        return html`
            <h1>${this.profile?.username}</h1>
            <p>Tab: ${this.profile?.tab}</p>
        `;
    }
}
```

### Request Context API

| Method | Description |
|--------|-------------|
| `this.c.req.param('name')` | Get route parameter |
| `this.c.req.query('key')` | Get query string value |
| `this.c.req.header('name')` | Get request header |
| `this.c.req.path` | Get current path |
| `this.c.redirect(url, status)` | Redirect to URL |

On the client, `this.c` holds only `req.param()`, `req.query()`, `req.path` and
`req.url` from the initial render. Headers and response helpers are server-only.

> See [Request Context](./context.md) for more details on Hono's context object.

---

## Context Availability

| Context | Server | Client | Notes |
|---------|--------|--------|-------|
| `this.env` | ✅ | ❌ | Bindings only exist on server |
| `this.user` | ✅ | ✅ | Hydrated from initial state: `{ id }` plus `publicUser` fields |
| `this.c` | ✅ | ✅ | Lightweight hydration on client: params, query, path, URL |

### Server vs Client Behavior

On the server, all contexts have full access with real runtime values.

```typescript
@Server()
async serverMethod() {
    // All available
    const db = this.env.DB;
    const userId = this.user?.id;
    const path = this.c.req.path;
}
```

On the client, `this.env` is `undefined`. `this.user` and `this.c` use values restored from the initial render.

```typescript
@Client()
async clientMethod() {
    // this.env is undefined on client
    // this.user and this.c work with hydrated values
    const userId = this.user?.id;  // ✅ Works (other fields need publicUser)
    const path = this.c.req.path;  // ✅ Works
    const db = this.env.DB;        // ❌ Undefined
}
```

---

## Best Practices

### 1. Type Safety

Pass the bindings type to the component so `this.env` is typed:

```typescript
export class Reports extends Cossack<CloudflareBindings> {}
```

### 2. No Prop Drilling

Never pass `env`, `user`, or `c` as props. They are available on the component:

```typescript
// ❌ DON'T do this
<${Child} env=${this.env} user=${this.user} />

// ✅ DO this - child can access them directly
<${Child} />
```

---

## Advanced: Custom Contexts

Create your own context providers with the `createContext` API:

```typescript
import { createContext } from "@cossackframework/renderer";

// Create a context
interface ThemeContext {
    mode: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContext>({ mode: 'light' }); // the default value

// Provide it in a parent
class App extends Cossack {
    connectedCallback() {
        this.provide(ThemeContext, { mode: 'dark' });
        super.connectedCallback();
    }
}

// Consume it in a descendant
class ThemedButton extends Cossack {
    render() {
        const theme = this.consume(ThemeContext);
        return html`<button class="${theme?.mode}">Click</button>`;
    }
}
```
