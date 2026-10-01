---
title: "Accessing Request Context"
description: "Read route parameters and query strings from the request context in a page component."
---

# Accessing Request Context

Each Cossack page can read the request context. It contains details about the HTTP request, such as route parameters, query strings, and headers.

## The `this.c` Property

Read the request context through `this.c` on a component. The property works on the server and the client.

- **On the Server:** `this.c` is the full [Hono `Context`](https://hono.dev/api/context) object. You can read its methods and properties, including middleware values.
- **On the Client:** `this.c` contains request parameters from the initial page load. A client component can use these values after hydration.

---

### Accessing Route Parameters

To read a URL parameter, use `this.c.req.param()`. For a page at `/pages/hello/[name]/index.ts`, read the `name` parameter like this.

**API:**
```typescript
this.c.req.param('name')
```

**Example:**

```typescript
import { Cossack, Page, Server, State } from '@cossackframework/core';

@Page()
export class Greeting extends Cossack {

    @State()
    private greeting: string = '';

    async init() {
        // Access the 'name' parameter from the URL
        const name = this.c.req.param('name');
        this.greeting = `Hello, ${name}!`;
    }

    // ...
}
```

**Behavior:**
1. A user opens `/hello/Cossack`.
2. The server runs `init()`. `this.c.req.param('name')` returns `"Cossack"`, and the method sets the initial value of `greeting`.
3. The server renders the page and sends it to the client.
4. The client hydrates the `Cossack` class and restores the same parameter. A client method can also read `"Cossack"` from `this.c.req.param('name')`.
