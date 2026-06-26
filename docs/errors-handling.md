---
title: "Error Handling"
description: "Built-in support for graceful error handling and custom 404 pages via file system conventions in the src/pages directory."
---

# Error Handling

Cossack provides built-in support for graceful error handling and custom 404 pages via the file system. By following specific naming conventions in your `src/pages` directory, you can provide a polished experience when things go wrong.

## 404 - Not Found

To create a custom "Not Found" page, create a component at `src/pages/404/index.ts`. 

The framework's router will automatically render this page whenever a request doesn't match any existing file-based routes.

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

If an error occurs during Server-Side Rendering (SSR) — for example, if a database query in your `init()` method fails — Cossack will attempt to render a component at `src/pages/error/index.ts`.

When an error is caught:
1.  The framework identifies the `error` page component.
2.  It renders the error page with a `500 Internal Server Error` status code.
3.  The error details are logged to the server console.

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

Both the `404` and `error` pages are integrated into the standard component stack:
*   **Global App**: They are always wrapped in the `src/App.ts` component, preserving your theme, global navigation, and persistent state.
*   **Root Layout**: They will use the root `src/pages/layout.ts` if it exists.
*   **Metadata**: They participate in the nested `head()` merging system, so they will automatically receive your root branding (e.g., `Cossack Framework - Page Not Found`).

## Default Fallbacks

If these custom components are not present in your project:
*   **404**: The framework returns a plain text `404 Not Found` response.
*   **Error**: The framework returns a basic HTML response containing the error stack trace (useful for debugging during development).
