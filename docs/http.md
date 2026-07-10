---
title: "HTTP Transport"
description: "Build interactive UIs and JSON APIs using the default HTTP transport with automatic state updates and re-rendering."
---

# HTTP Transport

Cossack's default transport is a powerful, stateless HTTP layer that allows you to build both traditional server-side applications and modern, AJAX-driven interactive UIs using the exact same component model. This is ideal for three primary use cases:

1.  **Interactive Components**: Creating dynamic UIs that update without a full page reload (e.g., counters, filters, searches).
2.  **Pure JSON APIs**: Creating RESTful endpoints for other applications.
3.  **Classic Forms**: Handling simple, stateless UI actions like form submissions that render HTML.

## 1. Interactive Components (Default)

This is the most common pattern. By default, any `@Server` method in a component is automatically wired up to be called from the client via a `fetch` request. The framework handles the request, state updates, and re-rendering automatically.

### Example: An Interactive Counter

**File:** `src/pages/counter.ts`
```typescript
import { Page, State, Cossack, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class extends Cossack {
    @State()
    private count: number = 0;

    private increment() {
        this.count++;
    }

    private decrement() {
        this.count--;
    }

    protected render() {
        return html`
            <p>Count: ${this.count}</p>
            <button @click=${this.increment}>+</button>
            <button @click=${this.decrement}>-</button>
        `;
    }
}
```
When a button is clicked, the client sends the component's current state to a generic `/crpc` endpoint. The server re-hydrates the component, runs the method (e.g., `increment`), and returns the new state as JSON, which the client then uses to seamlessly update the DOM.

## 2. Pure JSON APIs

To create a pure API endpoint, simply create a component without a `render()` method.

### Getting Started: Your First API Route

**File:** `src/pages/api/greeting.ts`
```typescript
import { Page, State, Cossack } from '@cossackframework/core';

@Page()
export default class extends Cossack {
    @State()
    private message: string = '';

    // This method handles GET requests to /api/greeting
    async get() {
        this.message = 'Hello from your first Cossack API!';
    }
}
```
Navigating to `/api/greeting` will return a `200 OK` JSON response:
```json
{
  "message": "Hello from your first Cossack API!"
}
```

---

## 3. Classic Form Handling

This powerful pattern allows you to handle traditional HTML form submissions.

The router intelligently handles this:
-   A `GET` request will render the HTML template.
-   `POST`, `PUT`, etc., requests will be handled as form submissions or actions.

### Example: A Contact Form

**File:** `src/pages/contact.ts`
```typescript
import { Page, State, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class extends Cossack {
    @State()
    private successMessage: string = '';

    /**
     * Handles the initial GET request to load data and render the page.
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

    protected render() {
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

### 1. The `@Page()` Decorator

By default, all components use the `http` transport. You only need to specify the transport if you want to opt-in to real-time functionality: `@Page({ transport: 'durable-object' })`.

### 2. File-Based Routing

Routes are mapped directly from the file system. The router is flexible, supporting both named files and `index.ts` files.

-   `src/pages/api/users/index.ts` -> `/api/users`
-   `src/pages/api/tasks/index.ts` -> `/api/tasks`
-   `src/pages/api/tasks/[id]/index.ts` -> `/api/tasks/:id`

### 3. HTTP Method Mapping

For API routes and forms, the framework automatically maps your class method names to the corresponding HTTP verbs: `get()`, `post()`, `put()`, `patch()`, and `delete()`. For interactive components, `@Server` methods are handled by the generic `/crpc` endpoint.

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

### Nested Form Data (PHP-style brackets)

For complex forms with nested fields, name your inputs using bracket notation:

```html
<input name="address[street]" />
<input name="address[city]" />
<input name="tags[]" />   <!-- repeated -> array -->
```

The browser sends these as a flat `FormData` with literal keys like
`"address[street]"`. Cossack offers two ways to turn that into a nested object.

#### `getFormData<T>()` — typed, optionally validated (recommended)

The convenient server-side helper on `this.c`. Pass a type parameter for the
shape and (optionally) `rules` built with `storeRules<T>()` for built-in
validation — the same vocabulary used by `@Store`/`@Validate` components.

```typescript
import { storeRules } from '@cossackframework/core';

interface MyFormData {
    name: string;
    address: { street: string; city: string; state: string };
}

async post() {
    // 1) Simple DTO: parse + compile-time type only (no runtime validation)
    const data = await this.c.getFormData<MyFormData>();

    // 2) Typed AND validated: returns { data, errors, valid }
    const { data, errors, valid } = await this.c.getFormData<MyFormData>({
        rules: storeRules<MyFormData>({
            name: { required: true, minLength: 2 },
            'address.street': { required: true },
            'address.city': { required: true },
            'address.state': { required: true, minLength: 2 },
        }),
    });
    if (!valid) return this.c.json({ errors }, 400);
    // data: MyFormData — data.name, data.address.street fully typed
    // errors: Partial<Record<keyof dot-paths, string>>
}
```

- **No `rules`** → returns `Promise<T>` (parsed data, type-asserted).
- **With `rules`** → returns `{ data: T; errors: Partial<Record<...>>; valid: boolean }`.
- **Non-throwing.** You decide how to handle a failure (400 JSON, re-render with
  errors, etc.). The same `storeRules<T>()` syntax works in `@Store` components
  too — learn one validation vocabulary, use it everywhere.

**Cast, not coercion.** `<T>` is a compile-time assertion about the shape; it
does not convert values. `FormData` values are strings/`File`, so a field typed
`number` stays a string at runtime (`"30"`). Built-in validators like `min`/`max`
do validate numerically, but for a true `number` you still cast/transform at the
edge. Use `rules` for runtime validation; the `<T>` alone is just a type hint.

#### `parseFormData()` — the lower-level utility

If you're in a functional `pages/api/*` route (no `this.c`) or want full control:

```typescript
import { parseFormData } from '@cossackframework/core';

async post() {
    const data = parseFormData(await this.c.req.formData());
    // data.address.street, data.address.city, data.tags -> ['a', 'b', ...]
}
```

For `@Server` method flows, gather the form on the client, parse, then pass the
object as a normal argument:

```typescript
// client handler
const data = parseFormData(new FormData(formElement));
this.serverHandle(data);
```

#### Supported bracket syntax

| HTML `name` | Resulting shape |
|---|---|
| `address[street]` | `{ address: { street } }` |
| `tags[]` (repeated) | `{ tags: ['a', 'b'] }` |
| `address[street][]` | `{ address: { street: [...] } }` |
| `contacts[][email]` + `contacts[][name]` | `{ contacts: [{ email, name }] }` (one object) |
| `contacts[][email]` (twice) | `{ contacts: [{ email }, { email }] }` (two objects) |
| `name=a` then `name=b` (no `[]`) | `{ name: ['a', 'b'] }` |

#### Why a separate API (not overriding `formData()`)

`this.c.req.formData()` stays flat — the standard Hono surface, untouched and
backward compatible. The convenience is additive: `getFormData<T>()` is the
opt-in for nested + typed + validated data. Cossack intentionally does NOT
auto-nest every form body (matching Hono, Fastify, and Express 5), because
auto-nesting has been a recurring source of prototype-pollution CVEs and
ambiguity footguns across the Node ecosystem. Parsing is **prototype-pollution
safe by construction**: intermediate containers use `Object.create(null)` (no
`__proto__` setter), so a crafted field name like `__proto__[polluted]` just
becomes a normal own property and never reaches `Object.prototype`. Bracket-only
(no dot-path) also avoids the `api.version` ambiguity ("flat key or nested?").

### Preventing the default submit (and native validation)

When you submit to a `@Server` method via JavaScript instead of a traditional
`method="post"`, use the `preventDefault` directive instead of a manual
`e.preventDefault()` arrow. It also disables the browser's native (HTML5
constraint) validation by default, since Cossack encourages custom `@Validate`
validation:

```typescript
import { html, preventDefault } from '@cossackframework/renderer';

render() {
    return html`
        <form @submit="${preventDefault(this.serverHandle)}">
            <input .value="${bind(this, 'name')}" />
        </form>
    `;
}
```

Pass `{ novalidate: false }` if you want native validation restored:

```typescript
@submit="${preventDefault(this.serverHandle, { novalidate: false })}"
```

## Flash Data

Flash data carries values across exactly one redirect (POST → GET), then is
consumed — the classic Laravel `back()->with('success', 'Saved!')` pattern.
Use it for success messages, validation errors, or repopulating form fields
after a failed submission.

```typescript
import { flash, flashed, flashInput, old } from '@cossackframework/core';

@Page({ transport: 'http' })
export default class FormPage extends Cossack {
  async post() {
    const { data, errors, valid } = await this.c.getFormData<MyForm>({ rules });
    if (!valid) {
      flashInput(data);              // repopulate fields on next render
      flash('errors', errors);       // show what went wrong
      return this.back('/form');     // redirect back to Referer
    }
    flash('success', 'Saved!');      // one-shot success message
    return this.c.redirect('/form');
  }

  render() {
    const success = flashed<string>('success');
    const name = old<string>('name') ?? '';
    return html`
      ${success ? html`<p>${success}</p>` : ''}
      <form method="post">
        <input name="name" value="${name}" />
      </form>
    `;
  }
}
```

### API

| Function | Description |
|---|---|
| `flash(key, value)` / `flash({...})` | Write a flash value (or several) for the next request. |
| `flashed(key)` / `flashedAll()` / `hasFlashed(key)` | Read previously-flashed values during this request. |
| `flashInput(formData)` | Stash submitted form input for repopulation (namespaced — won't collide with message-style flash keys of the same name). |
| `old(key)` | Read a stashed input field for repopulating the form. |
| `this.back(fallback)` | Redirect to the request's `Referer` (falls back to `fallback`). |

### How it works

Flash data is carried in a **signed cookie** (`cossack_flash`) that survives the
redirect. The framework's flash middleware reads + consumes it on the next
request (read-once semantics) and seeds a per-request store so `flashed()` /
`old()` work context-free, like `__()` for i18n. Writes are signed and set on
the response after the handler returns.

**Signing secret required.** Because flash messages render into HTML, the
cookie is HMAC-signed to prevent tampering. Set `APP_SECRET` (min 16 chars)
in your wrangler env:

```jsonc
// wrangler.jsonc
{
  "vars": { "APP_SECRET": "your-long-random-secret-here" }
}
```

Apps that never use `flash()` need no secret — the middleware throws only when
flash is actually exercised.

### Limitations

- **~4KB cookie limit.** Fine for messages + small form input. For larger
  payloads, use a database-backed session (`session()`) instead.
- **Read-once.** Flash is consumed on the first GET that reads it. Refreshing
  the page clears it. (`flash().keep()` / `reflash()` aren't implemented yet.)
- **Traditional `method="post"` flows only.** The CRPC `/crpc` path returns
  JSON (no redirect), so flash isn't applicable there — and `@Server` reactive
  forms already show success inline via `@State`.

## Cookies

The `cookie()` helper reads and writes cookies on the active request without an
explicit `Context` argument — same context-free ergonomics as `db()`, `__()`,
and `flash()`. It delegates to Hono's `hono/cookie` under the hood.

```typescript
import { cookie } from '@cossackframework/core';

async get() {
    const theme = cookie().get('theme');              // string | undefined
    const sid = await cookie().getSigned(secret, 'session_id'); // signed/verified
}

async post() {
    cookie().set('theme', 'dark', { maxAge: 3600, httpOnly: true, path: '/' });
    cookie().delete('old_session');
    return this.c.redirect('/settings');
}
```

| Method | Description |
|---|---|
| `cookie().get(name)` | Read a cookie value. |
| `await cookie().getSigned(secret, name)` | Read + HMAC-verify a signed cookie. |
| `cookie().set(name, value, options?)` | Set a cookie on the response. |
| `cookie().delete(name, options?)` | Expire a cookie. |

`cookie()` works anywhere inside a request — handlers, services, and
middlewares. It's available out of the box (the request-context middleware
scopes the Hono `Context` into AsyncLocalStorage for every request, first in
the stack).

## Sessions (database-backed)

For data that outlives a single redirect — shopping carts, wizard state,
per-user preferences — use `session()`. Unlike flash (cookie-backed, ~4KB,
read-once), sessions are **database-backed** (D1/Turso via the `sessions`
table), long-lived, and keyed off a session ID cookie.

```typescript
import { session } from '@cossackframework/database';

async get() {
    const cart = await session().get('cart');         // any value
    const sid = session().id();                        // the session ID
}

async post() {
    await session().set('cart', { items: [1, 2, 3] });
    return this.c.redirect('/cart');
}
```

### Setup

Sessions require the database package and its middleware. Run `cossack add
database`, then register the session middleware in `src/config/middlewares.ts`:

```typescript
// src/middlewares/session.ts
import { createSessionMiddleware } from '@cossackframework/database';
export const sessionMiddleware = createSessionMiddleware();

// src/config/middlewares.ts
import { sessionMiddleware } from '../middlewares/session';
export const middlewares = [sessionMiddleware];
```

The migration shipped by `cossack add database` creates the `sessions` table
(`id`, nullable `user_id`, JSON `data`, `expires_at`) — no extra schema work.

### Anonymous vs. authenticated sessions

By default, `createSessionMiddleware()` issues an anonymous `cossack_sid`
cookie on first visit. To reuse the auth session ID when a user is logged in,
pass `authCookieReader`:

```typescript
import { createSessionMiddleware } from '@cossackframework/database';

export const sessionMiddleware = createSessionMiddleware({
    // When authenticated, reuse the auth session ID; otherwise fall back to
    // the anonymous cossack_sid cookie.
    authCookieReader: (c) => getAuthSessionId(c),
});
```

### API

| Method | Description |
|---|---|
| `session().id()` | The active session ID for this request. |
| `await session().get(key)` / `getAll()` | Read a key / the whole bag. |
| `await session().set(key, value)` | Merge a key into the bag (refreshes expiry). |
| `await session().unset(key)` | Remove a key. |
| `await session().destroy()` | Delete the session row (e.g. on logout). |

### Flash vs. session — when to use which

| | Flash | Session |
|---|---|---|
| **Lifetime** | One redirect (read-once) | Long-lived (until logout/expiry) |
| **Storage** | Signed cookie (~4KB limit) | Database (`sessions.data` JSON) |
| **Best for** | Success/error messages, old form input | Carts, wizards, prefs, A/B |
| **Requires** | `APP_SECRET` | `cossack add database` |

## Sending Responses

### Automatic JSON Responses

If a method in a **pure JSON API** (a component without a `render()`) doesn't explicitly return a value, the framework automatically calls the component's `getPublicState()` method, which serializes only the `@State` properties into a clean JSON object and sends a `200 OK` response.

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

Apply Hono middleware to your routes by exporting a `middleware` array from the page.

**File:** `src/pages/api/me.ts`

```typescript
import { Page, Cossack } from '@cossackframework/core';
import { authMiddleware } from '@/middleware/auth'; // Your custom auth middleware

export const middleware = [authMiddleware];

@Page()
export default class extends Cossack {
    async get() {
        // The authMiddleware has already run and attached the user
        const user = this.c.get('user');
        return this.c.json({ user });
    }
}
```

You can also implicitly apply middleware into the page by using the `middleware` property on the `@Page()` decorator:

```typescript
@Page({ middleware: [authMiddleware] })
export default class extends Cossack {
    async get() {
        // The authMiddleware has already run and attached the user
        const user = this.c.get('user');
        return this.c.json({ user });
    }
}
```