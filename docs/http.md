# Building APIs & Forms with the HTTP Transport

Cossack is not just for real-time UIs. It includes a powerful, stateless HTTP transport layer that allows you to build traditional server-side applications using the exact same component model. This is ideal for two primary use cases:

1.  **Pure JSON APIs**: Creating RESTful endpoints for other applications.
2.  **Hybrid Components**: Handling simple, stateless UI actions like form submissions that render HTML.

## 1. Pure JSON APIs

This is the simplest way to expose data and services to other applications (web clients, mobile apps, etc.).

### Getting Started: Your First API Route

Creating an API route is as simple as creating a component without a `template()` method. The framework's file-based router will automatically detect and serve it.

**File:** `src/pages/api/greeting.ts`

```typescript
import { Page, State, Cossack } from '@cossackframework/core';

@Page({
    transport: 'http' // This is the magic key!
})
export default class extends Cossack {
    @State()
    private message: string = '';

    // This method handles GET requests to /api/greeting
    async get() {
        this.message = 'Hello from your first Cossack API!';
    }
}
```

If you run your development server and navigate to `/api/greeting`, you will see the following JSON response with a `200 OK` status:

```json
{
  "message": "Hello from your first Cossack API!"
}
```

---

## 2. Hybrid Components & Form Handling

This powerful pattern allows you to handle traditional HTML form submissions. A hybrid component uses `transport: 'http'` but also **includes a `template()` method**.

The router intelligently handles this:
-   A `GET` request will render the HTML template.
-   `POST`, `PUT`, etc., requests will be handled as form submissions or actions.

### Example: A Contact Form

**File:** `src/pages/contact.ts`

```typescript
import { Page, State, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class extends Cossack {
    @State()
    private successMessage: string = '';

    /**
     * Handles the initial GET request to load data and render the page.
     * The router will also fall back to using `init()` if `get()` is not found.
     */
    async get() {
        const status = this.c.req.query('status');
        if (status === 'success') {
            this.successMessage = 'We have received your submission!';
        }
    }

    /**
     * Handles the POST request from the form submission.
     */
    async post() {
        const body = await this.c.req.parseBody();
        console.log('New submission:', body.message);
        // Redirect back to the same page with a success flag
        return this.c.redirect('/contact?status=success');
    }

    protected template() {
        return html`
            <h1>Contact Us</h1>
            ${this.successMessage
                ? html`<p style="color: green;">${this.successMessage}</p>`
                : html`
                    <form method="POST" action="/contact">
                        <textarea name="message"></textarea>
                        <button type="submit">Submit</button>
                    </form>
                `
            }
        `;
    }
}
```

---

## Core Concepts

### 1. The `@Page({ transport: 'http' })` Decorator

This is the explicit signal that tells the framework to treat a component as a stateless HTTP handler, bypassing all WebSocket and real-time logic.

### 2. File-Based Routing

Routes are mapped directly from the file system. The router is flexible, supporting both named files and `index.ts` files.

-   `src/pages/api/users.ts` -> `/api/users`
-   `src/pages/api/tasks/index.ts` -> `/api/tasks`
-   `src/pages/api/tasks/[id].ts` -> `/api/tasks/:id`

### 3. HTTP Method Mapping

The framework automatically maps your class method names to the corresponding HTTP verbs: `get()`, `post()`, `put()`, `patch()`, and `delete()`.

## Handling Requests

### Accessing the Request Context (`this.c`)

Inside any API or form handler method, you have access to `this.c`, a powerful, unified context object. It provides the full API of the Hono `Context` on the server.

```typescript
async get() {
    // Get a URL parameter (e.g., /api/tasks/:id)
    const { id } = this.c.req.param();
    // Get a query parameter (e.g., ?include=details)
    const includeDetails = this.c.req.query('include');
    // Get a request header
    const userAgent = this.c.req.header('User-Agent');
}
```

### Reading the Request Body

For `POST`, `PUT`, and `PATCH` methods, you can easily parse the incoming body.

```typescript
// For JSON APIs
async post() {
    const newTask = await this.c.req.json();
    console.log('Creating new task:', newTask.title);
}

// For HTML Forms
async post() {
    const formData = await this.c.req.formData();
    const message = formData.get('message');
}
```

## Sending Responses

### Automatic JSON Responses

If a method in a **pure JSON API** (a component without a `template()`) doesn't explicitly return a value, the framework automatically calls the component's `getPublicState()` method, which serializes only the `@State` properties into a clean JSON object and sends a `200 OK` response.

### Custom Responses

For full control, you can return a `Response` object directly using the methods on `this.c`. This allows you to set custom status codes, headers, and body content. **If you return a value, the automatic response behavior is skipped.**

```typescript
async post() {
    const newUser = await this.c.req.json();
    // ... save to DB and get the new ID ...
    const newId = 'user-789';

    // Return a 201 Created status with a custom body and header
    return this.c.json(
        { success: true, id: newId },
        201,
        { 'Location': `/api/users/${newId}` }
    );
}
```

## Advanced Topics

### Error Handling

To send a specific HTTP error response (like 400 or 404), import and throw an `HTTPException` from `hono/http-exception`.

```typescript
import { HTTPException } from 'hono/http-exception';

async get() {
    const { id } = this.c.req.param();
    const task = await this.c.env.DB.getTask(id);

    if (!task) {
        // This will send a 404 Not Found response
        throw new HTTPException(404, { message: `Task with ID ${id} not found` });
    }
    this.task = task;
}
```

### Middleware

Apply Hono middleware to your routes by exporting a `middleware` array from the route file.

**File:** `src/pages/api/me.ts`

```typescript
import { Page, Cossack } from '@cossackframework/core';
import { authMiddleware } from '@/middleware/auth'; // Your custom auth middleware

export const middleware = [authMiddleware];

@Page({ transport: 'http' })
export default class extends Cossack {
    async get() {
        // The authMiddleware has already run and attached the user
        const user = this.c.get('user');
        return this.c.json({ user });
    }
}
```
