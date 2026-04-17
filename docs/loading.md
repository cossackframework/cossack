# Loading UI

Cossack provides built-in support for handling asynchronous operations, allowing you to easily show spinners or skeleton screens while data is being fetched or actions are processing.

## File-based Loading Convention (`loading.ts`)

You can create a `loading.ts` (or `loading.tsx`) file in any route directory. Cossack will automatically render this component **instantly** when a user navigates to that route, while the main Page component is being fetched and its `init()` method is running.

This is the recommended way to implement global page transitions and high-fidelity skeleton screens.

### Example

Directory structure:
```text
src/pages/dashboard/
  ├── index.ts    <-- Dashboard Page
  └── loading.ts  <-- Dashboard Skeleton
```

`loading.ts`:
```typescript
import { Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

export default class DashboardSkeleton extends Cossack {
  render() {
    return html`<div class="skeleton">Loading dashboard...</div>`;
  }
}
```

## Initialization Loading (`init` / `get`)

When a component is being initialized (via `init()` or `get()` methods), Cossack automatically sets `this.loading.init` to `1`.

### The `loadingTemplate()` Convention

If you define a `loadingTemplate()` method in your component, Cossack will automatically render it while `this.loading.init` is true. This is useful for component-level loading states or when triggering a refresh.

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page()
export default class UserProfile extends Cossack {
    async init() {
        this.user = await fetchUser(); // Takes 1s
    }

    loadingTemplate() {
        return html`
            <div class="skeleton-profile">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-line"></div>
            </div>
        `;
    }

    render() {
        return html`<h1>Welcome, ${this.user.name}</h1>`;
    }
}
```

## Action Loading (`@Server`)

When a method decorated with `@Server` is called on the client, Cossack tracks its progress using the method name in the `this.loading` object.

```typescript
async save() {
    await this.performSave();
}

render() {
    return html`
        <button @click=${this.save} ?disabled=${this.loading.save}>
            ${this.loading.save ? 'Saving...' : 'Save Changes'}
        </button>
    `;
}
```

## How it Works

1.  **File Convention**: The Vite plugin discovers `loading.ts` files and registers them. During navigation, the client router swaps the current page with the nearest matching loading component before starting the network request.
2.  **Automatic Tracking**: The `Cossack` base class wraps `init()` and `get()` calls. It increments `this.loading.init` before the call and decrements it after.
3.  **SSR Behavior**: During Server-Side Rendering, Cossack waits for `init()` to complete before sending the final HTML. Therefore, the loading state is typically only visible during client-side interactions.
