# Framework Context API

The Framework Context API provides universal access to global resources—`env` (environment bindings), `user` (authenticated user), and `c` (request context)—from **any component** without prop drilling. This works for both Pages and reusable Components.

> **Note:** This is different from [Request Context](./context.md) which specifically covers Hono's request object for route parameters and query strings.

---

## Overview

| Property | Type | Description |
|----------|------|-------------|
| `this.env` | `Env` | Cloudflare environment bindings (D1, R2, KV, DOs, etc.) |
| `this.user` | `AuthenticatedUser \| undefined` | Currently authenticated user (if any) |
| `this.c` | `Context` | Hono request context (params, queries, headers, etc.) |

---

## How It Works

The framework automatically provides these contexts through a provider pattern. The root `App` component sets up the contexts, and any descendant component can consume them using simple property access.

**On the Server:** These are the actual runtime values from the request.

**On the Client:** The values are "hydrated" from the initial server render, ensuring consistency.

---

## `this.env` - Environment Bindings

Access your Cloudflare bindings directly from any component.

```typescript
import { Cossack, Component } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Component()
export class DatabaseViewer extends Cossack {
    @State()
    users: any[] = [];

    @Server()
    async loadUsers() {
        // Access D1 database directly
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

Your `Env` interface should be defined in your project's type declarations:

```typescript
// src/env.d.ts
interface CloudflareBindings {
    DB: D1Database;
    BUCKET: R2Bucket;
    KV: KVNamespace;
    SESSION_DO: DurableObjectNamespace;
    // ... other bindings
}

interface Env extends CloudflareBindings {}
```

---

## `this.user` - Authenticated User

Access the currently authenticated user from any component.

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

The `AuthenticatedUser` interface is defined as:

```typescript
interface AuthenticatedUser {
    id: string;
    [key: string]: any; // Additional user properties
}
```

### Setting the User

Users are typically set by middleware in your router:

```typescript
// packages/framework/src/router.ts
app.use('*', (c, next) => {
    // Set user from session/JWT/etc.
    c.set('user', { id: 'user-123', name: 'Alice' });
    return next();
});
```

---

## `this.c` - Request Context

Access the Hono request context for route parameters, query strings, and more.

```typescript
import { Cossack, Page, State } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Page()
export class UserProfilePage extends Cossack {
    @State()
    profile: any = null;

    @Server()
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

> See [Request Context](./context.md) for more details on Hono's context object.

---

## Context Availability

| Context | Server | Client | Notes |
|---------|--------|--------|-------|
| `this.env` | ✅ | ❌ | Bindings only exist on server |
| `this.user` | ✅ | ✅ | Hydrated from initial state |
| `this.c` | ✅ | ✅ | Lightweight hydration on client |

### Server vs Client Behavior

**Server-side:** Full access to all contexts with real runtime values.

```typescript
@Server()
async serverMethod() {
    // All available
    const db = this.env.DB;
    const userId = this.user?.id;
    const path = this.c.req.path;
}
```

**Client-side:** Limited access; `this.env` is `undefined`, `this.user` and `this.c` use hydrated values from the initial render.

```typescript
@Client()
async clientMethod() {
    // this.env is undefined on client
    // this.user and this.c work with hydrated values
    const userId = this.user?.id;  // ✅ Works
    const path = this.c.req.path;  // ✅ Works
    const db = this.env.DB;        // ❌ Undefined
}
```

---

## Best Practices

### 1. Type Safety

Define your `Env` interface globally for type safety:

```typescript
// src/env.d.ts
interface CloudflareBindings {
    DB: D1Database;
    // ...
}

interface Env extends CloudflareBindings {}
```

### 2. Defensive Coding

Always check for `undefined` on client:

```typescript
@Component()
export class MyComponent extends Cossack {
    @Server()
    async serverAction() {
        // Safe to use this.env here
        if (this.env.DB) {
            // ... database operations
        }
    }
}
```

### 3. No Prop Drilling

Never pass `env`, `user`, or `c` as props—they're automatically available:

```typescript
// ❌ DON'T do this
${component(Child, { env: this.env, user: this.user })}

// ✅ DO this - child can access them directly
${component(Child, {})}
```

---

## Advanced: Custom Contexts

You can create your own context providers using the `createContext` API:

```typescript
import { createContext } from "@cossackframework/core";

// Create a context
interface ThemeContext {
    mode: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContext>('theme');

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
