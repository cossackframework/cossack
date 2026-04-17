# Accessing Request Context

In Cossack, every page component has access to the underlying request context, which provides information about the incoming HTTP request, such as route parameters, query strings, and headers. This is essential for building dynamic, data-driven pages.

## The `this.c` Property

The request context is exposed through the `this.c` property on your component class. This property provides a consistent API whether your code is running on the server or on the client.

-   **On the Server:** `this.c` is the full, powerful [Hono `Context`](https://hono.dev/api/context) object. You can access all of its methods and properties, including middleware variables, database connections, and more.
-   **On the Client:** `this.c` is a lightweight, "hydrated" object that specifically provides access to the request parameters, ensuring your component can behave consistently after the initial page load.

---

### Accessing Route Parameters

The most common use case is to get dynamic parameters from the URL. For a page defined by the file path `/pages/hello/[name]/index.ts`, you can access the `name` parameter as follows.

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

    @Server()
    async init() {
        // Access the 'name' parameter from the URL
        const name = this.c.req.param('name');
        this.greeting = `Hello, ${name}!`;
    }

    // ...
}
```

**Behavior:**
1.  A user navigates to `/hello/Cossack`.
2.  On the server, the `init()` method runs. `this.c.req.param('name')` returns `"Cossack"`, and the initial state of `greeting` is set.
3.  The page is rendered and sent to the client.
4.  On the client, the `Cossack` class is hydrated. `this.c` is reconstructed with the same parameter information, so if you were to access `this.c.req.param('name')` in a client-side method, it would also correctly return `"Cossack"`.
