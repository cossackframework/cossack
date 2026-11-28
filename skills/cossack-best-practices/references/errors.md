# Error & 404 Handling

Cossack provides **file-based** error boundaries. **Do not wrap `render()` in try/catch** — drop a file in the route tree and the framework handles discovery, status codes, and integration with your layout/App shell.

## 404 — Not Found

Create `src/pages/404/index.ts`. The router renders this automatically whenever no route matches.

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
                <p>The page you're looking for doesn't exist.</p>
                <a href="/">Return Home</a>
            </div>
        `;
    }
}
```

## Global Error Handler (500)

Create `src/pages/error/index.ts`. When an error is thrown during SSR (e.g., a DB query in `init()` fails), the framework renders this component with a `500` status code and logs the error to the server console.

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
                <p>An unexpected error occurred.</p>
                <a href="/">&larr; Back to Home</a>
            </div>
        `;
    }
}
```

A middleware that throws renders the same page with status 500 for a browser navigation; other clients get JSON with the code `COSSACK_REQUEST_INTERNAL`.

## What the page is told: `this.boundary`

A `404` or `error` page (and its layouts and the App) reads `this.boundary`: `{ type: '404' | 'error', status, requestId? }`. `status` is 404, 500, or the 401/403 of a denial. `requestId` is the response's `X-Cossack-Request-Id`. It is the same on the server and after hydration, and `undefined` on every other page. **Do not read the response header or invent an ID** to show a reference:

```typescript
render() {
    const failure = this.boundary;
    return html`
        <h1>${failure?.status === 403 ? 'No access' : 'Something went wrong'}</h1>
        ${failure?.requestId ? html`<p>Reference: <code>${failure.requestId}</code></p>` : ''}
    `;
}
```

The error itself never reaches the page. To log it, give `createApp` an `onServerFailure(failure, error, c)` function.

## Hierarchical boundaries

The router searches for the **nearest** `error/index.ts` or `404/index.ts` **up the directory tree** relative to the current route. This means you can place scoped error pages:

```
src/pages/
  error/index.ts            ← global fallback
  dashboard/
    error/index.ts          ← dashboard-specific error page
    analytics/index.ts
```

A failure on `/dashboard/analytics` uses `dashboard/error/index.ts` if present, otherwise falls back to the global `error/index.ts`.

## Layout & shell integration

Both the 404 and error pages are integrated into the normal component stack:
- Wrapped in the global `src/App.ts` component (preserves theme, nav, persistent state).
- Use the root `src/pages/layout.ts` if it exists.
- Participate in nested `head()` merging — they receive your root branding (e.g., `MyApp - Page Not Found`).

## Default fallbacks

If these files are absent:
- **404** → plain text `404 Not Found` response.
- **Error** → `<h1>Internal Server Error</h1>` with status 500. In development it also shows a fixed code, the request ID and the route, never the error message or the stack.
