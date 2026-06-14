# Loading UI

Cossack has **four** built-in loading mechanisms. **Do not hand-roll `isLoading` booleans** — use whichever built-in fits the case.

| Mechanism | Scope | When it triggers |
|---|---|---|
| `loading.ts` file | Route | Auto-rendered during navigation while the page is fetched |
| `loadingTemplate()` | Component | Shown while `this.loading.init > 0` |
| `this.loading['methodName']` | Per server method | Auto-tracked for every `@Server()` call |
| `clientInit()` + `loadingTemplate()` | Initial page load | Defers `init()` to client so SSR shows the skeleton |

## 1. Route-level skeleton (`loading.ts`)

Create a `loading.ts` (or `loading.tsx`) in any route directory. The router renders it **instantly** on navigation while the main page's `init()` runs.

```
src/pages/dashboard/
  ├── index.ts       ← Dashboard Page
  └── loading.ts     ← Dashboard Skeleton (auto-discovered)
```

```typescript
import { Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

export default class DashboardSkeleton extends Cossack {
    render() { return html`<div class="skeleton">Loading dashboard…</div>`; }
}
```

This is the recommended way to do page transitions and high-fidelity skeletons.

## 2. Component-level `loadingTemplate()`

Define `loadingTemplate()` on a component. The framework renders it automatically while `this.loading.init` is truthy:

```typescript
@Page()
export default class UserProfile extends Cossack {
    async init() {
        this.user = await fetchUser(); // takes ~1s
    }

    loadingTemplate() {
        return html`<div class="skeleton-profile"><div class="skeleton-avatar"></div></div>`;
    }

    render() {
        return html`<h1>Welcome, ${this.user.name}</h1>`;
    }
}
```

## 3. Per-action loading (`this.loading`)

The framework tracks every pending `@Server()` call by method name in the `this.loading` object. Use it in `render()`:

```typescript
async save() { await this.performSave(); }

render() {
    return html`
        <button @click=${this.save} ?disabled=${this.loading.save}>
            ${this.loading.save ? 'Saving…' : 'Save Changes'}
        </button>
    `;
}
```

`this.loading['save'] > 0` means the call is pending. Also works for `init` and `get`.

## 4. Client-side loading on initial page load (`clientInit`)

By default, SSR waits for `init()` to complete before sending HTML — so loading state is usually only visible during client-side interactions. To show a skeleton on the **very first page load** instead, define `clientInit()` alongside `loadingTemplate()`:

```typescript
@Page()
export default class DataPage extends Cossack {
    @State() data: string[] = [];

    async init() {
        await new Promise(r => setTimeout(r, 2000));
        this.data = ['Item 1', 'Item 2'];
    }

    // Runs on client after hydration — calls init() via RPC
    async clientInit() { await this.init(); }

    loadingTemplate() {
        return html`<div class="skeleton">Loading…</div>`;
    }

    render() {
        if (this.loading.init) return this.loadingTemplate();
        return html`<ul>${this.data.map(i => html`<li>${i}</li>`)}</ul>`;
    }
}
```

Flow when `loadingTemplate()` is present:
1. **SSR** renders `loadingTemplate()` immediately (skips waiting for `init()`).
2. **Hydration** hydrates with the skeleton visible.
3. **`clientInit()`** calls `init()` via RPC.
4. On resolve, loading clears and the component re-renders with real data.

## Dev-mode state logging

In development, state changes log to the browser console:
```
[Cossack] State change: count 0 -> 5
[Cossack] State change suppressed (same value): theme light
```
Stripped from production builds.
