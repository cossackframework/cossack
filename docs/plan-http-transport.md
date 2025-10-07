# Architectural Plan: The HTTP Transport Layer

This document outlines the plan to introduce a stateless, HTTP-based transport layer to the Cossack Framework. This will enable developers to build traditional server-side APIs and handle simple UI actions without the need for WebSockets, transforming Cossack into a unified framework for creating both real-time UIs and backend APIs using a single, consistent component model.

## 1. High-Level Goal & Philosophy

The primary goal is to provide a first-class mechanism for handling stateless request-response cycles. This is ideal for:

1.  **Creating RESTful or RPC-style APIs**: Exposing data and services to other applications (web clients, mobile apps, etc.).
2.  **Simple UI Actions**: Handling form submissions or actions where real-time, multi-client state synchronization is unnecessary overhead.

This feature allows developers to choose the right tool for the job on a component-by-component basis, all within the same familiar Cossack architecture.

## 2. Relationship to the Pluggable Transport Layer

It is critical to understand that the **HTTP Transport is NOT an implementation of the `CossackServerRuntime` interface** proposed in `@docs/plan-transport-layer.md`.

The `CossackServerRuntime` is designed for a **stateful, persistent connection paradigm** (like WebSockets), with methods like `broadcastState` and `onClientMessage`. HTTP is fundamentally **stateless and transactional**. Forcing the HTTP model into the stateful runtime interface would be architecturally unsound.

Instead, the HTTP transport will be a parallel, separate mechanism handled directly by the Hono router, designed specifically for the stateless request-response lifecycle.

## 3. The Developer Experience

The developer workflow is designed to be intuitive and consistent with existing Cossack patterns.

### a. The `@Page` Decorator

A component is designated as an HTTP handler by adding `transport: 'http'` to its `@Page` decorator. This is the explicit signal to the framework to treat it as a stateless handler.

```typescript
import { Page, State, Cossack } from '@cossackframework/core';

@Page({
    transport: 'http'
})
export default class extends Cossack {
    // ...
}
```

### b. API Method Conventions

The framework will automatically map class methods to HTTP verbs.

-   `async get()` -> `GET`
-   `async post()` -> `POST`
-   `async patch()` -> `PATCH`
-   `async put()` -> `PUT`
-   `async delete()` -> `DELETE`

### c. Accessing Request Context

API methods will be parameter-less. All request information is accessed via the existing `this.c` property, which holds the Hono `Context` object.

```typescript
async get() {
    const { id } = this.c.req.param();
    const user = await this.c.env.DB.prepare("...").bind(id).first();
    // ...
}
```

### d. Response Handling

The framework provides two ways to send a response:

1.  **Automatic Response (Default)**: If an API method has a `void` return (i.e., it doesn't return anything), the framework will automatically collect all properties marked with `@State`, serialize them into a JSON object, and send a `200 OK` response.

    ```typescript
    @State() private tasks: Task[] = [];

    async get() {
        this.tasks = await this.c.env.DB.query(...);
        // Returns void, so framework responds with: { "tasks": [...] }
    }
    ```

2.  **Custom Response (Full Control)**: If the API method returns a `Response` object, the framework will bypass the automatic behavior and send the response directly. This allows for custom status codes, headers, and bodies.

    ```typescript
    async post() {
        const newUser = await this.c.req.json();
        // ... save to DB ...
        return this.c.json({ id: newUser.id }, 201); // 201 Created
    }
    ```

### e. Middleware, Validation, and Error Handling

These are handled using standard Hono patterns for maximum power and familiarity.

-   **Middleware**: A route file can export a `middleware` array. The file-based router will apply this middleware to all methods in the component.

    ```typescript
    // src/pages/api/me/profile.ts
    export const middleware = [authMiddleware];

    @Page({ transport: 'http' })
    export default class extends Cossack {
        async get() {
            const user = this.c.get('user'); // Set by authMiddleware
            // ...
        }
    }
    ```

-   **Validation**: We recommend using a library like **Zod** inside the API method for robust input validation.

-   **Error Handling**: Developers should use Hono's `HTTPException` for controlled error responses (e.g., 404 Not Found). Any other uncaught exceptions will be handled by the global error handler, returning a generic `500` JSON error.

## 4. Routing

To provide both convention and flexibility, we will support two routing strategies.

1.  **File-Based Routing (Default)**: The existing file-based router will be enhanced to detect components in the `src/pages` directory decorated with `@Page({ transport: 'http' })`. It will automatically register their `get`, `post`, etc., methods as API endpoints.

2.  **Manual Registration (Optional)**: A static method, `CossackApi.register(app, [Component1, Component2])`, will be provided. This allows developers to register API components programmatically, offering flexibility for different project structures.

## 5. Step-by-Step Implementation Plan

### Step 1: Update Core Decorator

-   **Package**: `@cossackframework/core`
-   **File**: `src/shared/decorators.ts`
-   **Action**: Modify the `@Page` decorator's interface to accept an optional `transport` property, which can be `'durable-object'` (the default) or `'http'`. Store this metadata using `reflect-metadata`.

### Step 2: Create the API Handler Factory

-   **Package**: `@cossackframework/framework`
-   **File**: `src/router.ts` (or a new `src/api-handler.ts`)
-   **Action**: Create a function `createApiHandler(ComponentClass, methodName)`. This factory will return a Hono handler function that performs the core logic:
    1.  Instantiates the component: `const instance = new ComponentClass()`.
    2.  Injects the Hono context: `instance.c = c`.
    3.  Calls the appropriate method: `const result = await instance[methodName]()`.
    4.  Checks the `result`:
        -   If `result instanceof Response`, return it directly.
        -   If `result` is `undefined`, extract the `@State` properties from the instance, and return `c.json(stateObject)`.
    5.  Wrap the execution in a `try...catch` block to handle errors gracefully.

### Step 3: Enhance the File-Based Router

-   **Package**: `@cossackframework/framework`
-   **File**: `src/vite-plugin.ts`
-   **Action**: Modify the Vite plugin that handles file-based routing.
    1.  When processing a file, check the metadata of its default export for `@Page({ transport: 'http' })`.
    2.  If found, iterate through the component's prototype methods (`get`, `post`, etc.).
    3.  For each method, use the `createApiHandler` from Step 2 to generate the Hono handler.
    4.  Register the handler with the router: `app.get(route, handler)`.
    5.  Check if the file exports a `middleware` array and apply it to the registered routes for that component.

### Step 4: Implement Manual Registration

-   **Package**: `@cossackframework/framework`
-   **File**: `src/index.ts` (or a new `src/api.ts`)
-   **Action**: Create a static class or object `CossackApi` with a `register(app, components)` method.
    1.  This method will loop through the `components` array.
    2.  For each component, it will perform the same logic as the file-based router in Step 3: inspect its metadata and methods, create handlers, and register them with the provided `app` instance.

### Step 5: Documentation and Examples

-   **Action**: Create comprehensive documentation for this feature.
-   **Action**: Build at least one clear example in the `framework` package, perhaps a simple "Todo" API, to demonstrate best practices for validation, data access, and middleware.
