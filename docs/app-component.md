# The Global App Component

In Cossack, `src/App.ts` is a special component that acts as the root wrapper for your entire application. Unlike regular pages or layouts, the App component is **never destroyed** during client-side navigation.

## Purpose

Use the App component for:
1.  **Global State**: Store data that needs to persist across all pages (e.g., user session, theme preference, shopping cart).
2.  **Persistent UI**: Render elements that stay fixed while the page changes (e.g., a music player, global toast notifications, floating action buttons).
3.  **Providers**: Wrap your application in context providers if you are using libraries that require them.

## Usage

The App component is a standard Cossack component defined in `packages/framework/src/App.ts`. It must implement a `template` method that accepts `children`.

```typescript
import { Cossack, Page, State } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

@Page()
export class App extends Cossack {
    @State() theme: 'light' | 'dark' = 'light';

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
    }

    render() {
        return html`
            <div id="app-wrapper" class="${this.theme}">
                <nav>Global Nav</nav>
                
                <!-- The current page (and its layouts) are rendered here -->
                ${this.children}
                
                <GlobalFooter />
            </div>
        `;
    }
}
```

## Lifecycle

1.  **Server-Side Rendering (SSR)**:
    *   The `App` component is instantiated and bootstrapped for every request.
    *   It wraps the rendered HTML of the requested page.
    *   Its initial state is serialized into `window.__INITIAL_STATE__._app_state`.

2.  **Client-Side Hydration**:
    *   On the first load, the client creates a single instance of `App` and hydrates it with the server-sent state.

3.  **Navigation**:
    *   When the user navigates to a new page (e.g., via a link), the `App` instance **remains active**.
    *   Only the `children` (the page content) are swapped out.
    *   This preserves any state stored in the `App` component (like the `theme` variable in the example above).

## Styling

Since the App component wraps everything, it's the perfect place to apply global CSS classes or manage themes dynamically.

```typescript
if (!this.isServer) {
    document.body.className = this.theme;
}
```
