---
title: "Error Handling"
description: "Handle errors and add custom 404 pages in the src/pages directory."
---

# Error Handling

Cossack can render custom 404 and error pages from files in `src/pages`. Use the file paths in this guide.

## 404 - Not Found

To add a custom "Not Found" page, create a component at `src/pages/404/index.ts`.

The router renders this page when a request does not match a route.

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
1. Finds the `error` page component.
2. Renders the page with a `500 Internal Server Error` status code.
3. Writes the error details to the server console.

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
* **Global App**: `src/App.ts` wraps each page. It can provide the theme, navigation, and persistent state.
* **Root Layout**: Each page uses `src/pages/layout.ts` if that file exists.
* **Metadata**: Each page uses the nested `head()` merge. The root can add branding, such as `Cossack Framework - Page Not Found`.

## Default Fallbacks

If your project does not include these components:
* **404**: The framework returns a plain-text `404 Not Found` response.
* **Error**: The framework returns basic HTML with the error stack trace. Use this response to debug during development.
