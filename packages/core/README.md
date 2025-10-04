# Cossack Framework

A modern, stateful, real-time web framework built on Cloudflare Workers, Durable Objects, and Hono.

## Development

Install dependencies:
```sh
pnpm install
```

Run the local development server:
```sh
pnpm --filter @cossackframework/core run dev:wrangler
```

## Deployment

```sh
pnpm --filter @cossackframework/core run deploy
```

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

# Roadmap

Here are the next features and improvements planned for the framework.

---

### 1. Immediate Priorities: Core Application Needs

These are the features required to turn this from a framework into a real, production-ready application.

#### **a. Database Persistence with Cloudflare D1**

-   **Description:** Currently, component state is only stored in the Durable Object's memory and resets when the last user leaves a channel. We need to connect our Durable Objects to a database to persist this data permanently.
-   **Implementation:**
    1.  Create a Cloudflare D1 database and add the binding to `wrangler.jsonc`.
    2.  In the `CossackDurableObject`, access the database via `this.state.env.DB`.
    3.  Modify the component's `init()` method to fetch its initial state from D1.
    4.  Modify server-side actions (e.g., `increment()`) to write the new state back to the database after updating it in memory.

---

### 2. Developer Experience (DX) & Tooling

These features would make the framework safer, easier, and more pleasant to work with.

#### **a. Client-Side State & Actions**

-   **Description:** Not all state needs to be synced with the server. A purely cosmetic UI state (like whether a dropdown is open) shouldn't require a WebSocket round trip. This would dramatically improve performance and responsiveness for UI-heavy components.
-   **Implementation:**
    1.  Create a `@ClientState` decorator that works like `@State` but is ignored by `getInitialState`.
    2.  Modify the `proxyServerMethods` logic to *only* proxy methods explicitly marked with `@Server`. Any other method would just run directly in the browser.

#### **b. Type-Safe Environment Bindings**

-   **Description:** Use Wrangler's built-in type generation to create strongly-typed interfaces for our environment bindings (like `c.env.COSSACK_OBJECT`).
-   **Implementation:**
    1.  Run the `pnpm cf-typegen` script.
    2.  Ensure the generated `worker-configuration.d.ts` file is included in our `tsconfig.json`.
    3.  Update Hono's generic type to use the generated `Env` interface: `new Hono<{ Bindings: Env }>()`.

---

### 3. Advanced Framework Capabilities

These are longer-term ideas to make the framework even more powerful.

#### **a. Enhanced Component Lifecycle Hooks**

-   **Description:** Add more lifecycle methods to the `Cossack` base class that are called by the Durable Object to give developers fine-grained control over what happens when users join or leave a channel.
-   **Implementation:**
    -   `onConnect(user)`: Called in the DO when a new WebSocket is accepted. Useful for broadcasting "user has joined" messages.
    -   `onDisconnect(user)`: Called in `webSocketClose`. Useful for broadcasting "user has left" messages or cleaning up user-specific data.