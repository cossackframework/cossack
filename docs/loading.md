# Loading UI

Cossack provides built-in support for handling asynchronous operations, allowing you to easily show spinners or skeleton screens while data is being fetched or actions are processing.

## Initialization Loading (`init` / `get`)

When a component is being initialized (via `init()` or `get()` methods), Cossack automatically sets `this.loading.init` to `1`.

### The `loadingTemplate()` Convention

If you define a `loadingTemplate()` method in your component, Cossack will automatically render it while `this.loading.init` is true. This is the preferred way to implement **Skeleton Screens**.

```typescript
import { Cossack, Page, html } from '@cossackframework/core';

@Page()
export default class UserProfile extends Cossack {
    async init() {
        this.user = await fetchUser(); // Takes 1s
    }

    // This is rendered automatically while init() is running
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

### Manual Check in `render()`

If you don't want to use the `loadingTemplate()` method convention, you can manually check `this.loading.init` inside your `render()` method:

```typescript
render() {
    if (this.loading.init) {
        return html`<p>Loading data...</p>`;
    }
    return html`<div>Data: ${this.data}</div>`;
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

1.  **Automatic Tracking**: The `Cossack` base class wraps `init()` and `get()` calls. It increments `this.loading.init` before the call and decrements it after.
2.  **Reactive Re-rendering**: On the client, changing any value in `this.loading` automatically triggers a re-render of the component.
3.  **SSR Behavior**: During Server-Side Rendering, Cossack waits for `init()` to complete before sending the final HTML. Therefore, the loading state is typically only visible during client-side interactions or manual calls to `init()`.
