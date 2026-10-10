---
title: "Loading UI"
description: "Built-in support for handling asynchronous operations with spinners or skeleton screens using the file-based loading.ts convention."
---

# Loading UI

Cossack can show a spinner or skeleton while it fetches data or processes an action.

## File-based Loading Convention (`loading.ts`)

You can create a `loading.ts` file in any route directory. Cossack renders this component immediately when a user navigates to that route. The main Page component is fetched and its `init()` method runs at the same time.

Use this convention for global page transitions and skeleton screens.

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

When the framework initializes a component through `init()` or `get()`, it sets `this.loading.init` to `1`.

### The `loadingTemplate()` Convention

If you define a `loadingTemplate()` method in your component, Cossack renders it while `this.loading.init` is true. Use it for component-level loading states or during a refresh.

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

When a method decorated with `@Server` is called on the client, Cossack tracks its progress in the `this.loading` object under the method name.

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

1. File convention: the Vite plugin discovers `loading.ts` files and registers them. During navigation, the client router swaps the current page with the nearest matching loading component before starting the network request.
2. Automatic tracking: the `Cossack` base class wraps `init()`, `get()`, and `clientInit()` calls. It increments `this.loading.init` before the call and decrements it after.
3. SSR behavior: during server-side rendering, Cossack waits for `init()` to complete before it sends the final HTML. The loading state is therefore visible only during client-side interactions.

## Client-Only Initialization (`clientInit`)

To show a loading skeleton on the first page load instead of waiting for server-side `init()`, define `clientInit()` and `loadingTemplate()`:

```typescript
import { Cossack, Page, State, html } from '@cossackframework/core';

@Page()
export default class DataPage extends Cossack {
    @State() data: string[] = [];

    // Runs on server during SSR and when called via RPC
    async init() {
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.data = ['Item 1', 'Item 2', 'Item 3'];
    }

    // Runs on client after hydration — calls init() via RPC
    async clientInit() {
        await this.init();
    }

    loadingTemplate() {
        return html`
            <div class="skeleton">Loading...</div>
        `;
    }

    render() {
        if (this.loading.init) {
            return this.loadingTemplate();
        }
        return html`
            <ul>
                ${this.data.map(item => html`<li>${item}</li>`)}
            </ul>
        `;
    }
}
```

The flow:
1. SSR: the server renders `loadingTemplate()` immediately. It skips `init()` when `loadingTemplate()` exists.
2. Client hydration: the client hydrates with the loading UI visible.
3. `clientInit()`: it calls `init()` through RPC. The RPC call fetches data from the server.
4. Data loaded: the loading state clears and the component re-renders with the actual content.

## Dev-Mode State Logging

In development mode, Cossack automatically logs state changes to the browser console:

```
[Cossack] State change: count 0 -> 5
[Cossack] State change suppressed (same value): theme light
```

This helps debug reactivity issues. These logs are stripped from production builds.
