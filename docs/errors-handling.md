---
title: "Error Handling"
description: "Handle errors and add custom 404 pages in the src/pages directory."
---

# Error Handling

Cossack can render custom 404 and error pages from files in `src/pages`. Use the file paths in this guide.

## 404 - Not Found

To add a custom "Not Found" page, create a component at `src/pages/404/index.ts`.

The router renders this page with status 404 when a browser request does not
match a route. A `404/index.ts` in a subdirectory, such as
`src/pages/docs/404/index.ts`, handles unmatched paths below that directory.
The nearest one in the source tree wins, including route group directories.
API paths (`/api/...`) and requests that accept JSON but not HTML receive
`{ "error": "Not Found", "code": "COSSACK_NOT_FOUND" }` with status 404
instead.

```typescript
import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class NotFoundPage extends Cossack {
    public head(context: HeadContext): HeadValue {
        return { title: 'Page Not Found' };
    }

    render() {
        return html`
            <div style="text-align: center; padding: 5rem;">
                <h1>404</h1>
                <p>Oops! The page you're looking for doesn't exist.</p>
                <a href="/">Return Home</a>
            </div>
        `;
    }
}
```

## Global Error Handler (500)

If an error occurs during server-side rendering (SSR), Cossack tries to render `src/pages/error/index.ts`. For example, a database query in `init()` can fail.

When Cossack catches an error, it:
1. Writes a structured failure record to `console.error`: the event name, the
   request ID, the route template, the action, the runtime, the duration, the
   stage and the code `COSSACK_SSR_INTERNAL`. The record does not contain the
   error message, the stack trace or the request URL.
2. Sets the `X-Cossack-Request-Id` response header to the same request ID.
3. Finds the nearest `error` page component in the source tree, like the 404
   page.
4. Renders that page with a `500 Internal Server Error` status code.

Browser navigations that middleware or a guard deny with 401 or 403 also render
the nearest `error` page, with the denial status.

An error that application middleware throws before the page renders does not
render the `error` page. The response is
`{ "error": "Internal Server Error", "code": "COSSACK_REQUEST_INTERNAL", "requestId": "..." }`
with status 500, and the failure record uses the code `COSSACK_REQUEST_INTERNAL`.

To see the error itself, catch it in your own code (for example in `init()`)
and log it, or use the request ID to find the failure record.

```typescript
import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class ErrorPage extends Cossack {
    public head(context: HeadContext): HeadValue {
        return { title: 'Server Error' };
    }

    render() {
        return html`
            <div style="text-align: center; padding: 5rem; color: #d32f2f;">
                <h1>Something went wrong</h1>
                <p>An unexpected error occurred. Our team has been notified.</p>
                <a href="/" style="color: #333;">&larr; Back to Home</a>
            </div>
        `;
    }
}
```

## Layout & Shell Integration

The `404` and `error` pages use the normal component stack:
* Global App: `src/App.ts` wraps each page. It can provide the theme, navigation, and persistent state.
* Layouts: Each page uses the `layout.ts` files of its source directories, like any other page. `src/pages/404/index.ts` uses `src/pages/layout.ts` if that file exists.
* Metadata: Each page uses the nested `head()` merge. The root can add branding, such as `Cossack Framework - Page Not Found`.

## Default Fallbacks

If your project does not include these components, or the `error` page itself
fails:
* 404: The framework returns a plain-text `404 Not Found` response.
* Error: The framework returns `<h1>Internal Server Error</h1>` with status 500.
  In Vite development it also shows the code `COSSACK_SSR_INTERNAL`, the request
  ID and the route template. It never shows the error message or the stack
  trace, in development or in production.
