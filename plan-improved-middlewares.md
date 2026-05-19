# Plan - Improve Middleware

Currently, we have middleware support, it can be colocated in the page file, or in a separate file and imported. However, there is no clear documentation or examples on how to create reusable middleware that can be shared across multiple pages.

We can put middleware in anywhere in the project, however, for organizational purposes. I have created `src/middlewares` folder to hold reusable middleware. 

We have two things to do:
1. Documentation. Please create `docs/middleware.md` that explains how to create reusable middleware and how to use it in pages. A simple example of logging middleware that logs every request to the console would be great.
2. Here is our example middleware:

```typescript
import { isServer } from "@cossackframework/core";
import { MiddlewareHandler } from "hono/types";

// Example middleware
export const loggingMiddleware: MiddlewareHandler = async (c, next) => {
    if (isServer) {
        console.log('Example of shared middleware running on the server.');
    }
    await next();
};
```

However, checking `isServer` in every middleware can be tedious. We should consider adding a helper function in the core framework, or any suggestions on how to make this more ergonomic?