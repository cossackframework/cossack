---
title: "Reactive Store"
description: "A lightweight signal/subscriber pattern for cross-component state that triggers re-renders when changed — for global state like toast queues, theme, or command palette open/close."
---

# Reactive Store

Cossack's `provide`/`consume` context API does a **one-time read** — it doesn't
notify consumers when the value changes. For global state that needs to trigger
re-renders across unrelated components (toast queues, theme switching, command
palette open/close), use `createStore`.

A reactive store is a tiny signal/subscriber primitive: a value + a list of
listeners. When the value changes, all listeners fire. Components subscribe in
`onMount()` (or via `connectStore`) and update a `@ClientState` field to trigger
re-render.

## Import

```typescript
import { createStore, connectStore, type ReactiveStore } from '@cossackframework/core';
```

## Browser-only store modules

Name stores that initialize browser libraries or access browser globals at the
top level with the `.client.ts` (or `.client.mts`) suffix:

```typescript
// stores.client.ts
import { createStore } from '@cossackframework/core';

const savedTheme = window.localStorage.getItem('theme');
export const themeStore = createStore(savedTheme ?? 'light');
```

Shared components can statically import the module using its `.client`
basename. Client builds load the original module; SSR substitutes lazy
placeholders, so merely importing it on the server is safe:

```typescript
import { themeStore } from './stores.client';

onMount() {
    themeStore.set(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}
```

Do not read, call, construct, or access properties on client-only exports in an
SSR path. This includes `render()`, `init()`, server-side field initializers,
and module top-level code. Use them from `onMount()`, `clientInit()`, or an
`@Client()` method instead. Client-only modules must use explicit runtime
exports; runtime `export *` is rejected because the SSR placeholder interface
cannot be determined from the local file.

## `createStore<T>(initial)`

Creates a reactive store with an initial value. Returns a `ReactiveStore<T>`
with `get()`, `set()`, `update()`, and `subscribe()`.

```typescript
import { createStore } from '@cossackframework/core';

// Create a module-level singleton — any code in the app can import and use it.
export const themeStore = createStore<'light' | 'dark'>('light');

// Anywhere: read the current value.
console.log(themeStore.get()); // 'light'

// Anywhere: replace the value (notifies all subscribers).
themeStore.set('dark');

// Anywhere: update via a function.
themeStore.update((current) => (current === 'light' ? 'dark' : 'light'));
```

## `store.subscribe(listener)`

Subscribe to value changes. The listener is called immediately with the current
value (so the consumer is in sync from the start), then on every change.
Returns an unsubscribe function.

```typescript
const unsub = themeStore.subscribe((value) => {
    console.log('Theme changed to:', value);
});

// Later:
unsub(); // stop listening
```

## `connectStore(store, target, key)`

Convenience: auto-wire a reactive store to a component's `@ClientState` field.
The field is updated whenever the store changes. Returns an unsubscribe
function (call it in `onCleanup`).

```typescript
import { Cossack, ClientState, createStore, connectStore } from '@cossackframework/core';

// Global toast queue singleton.
export const toastStore = createStore<ToastItem[]>([]);

@Component()
export class Toaster extends Cossack {
    @ClientState() toasts: ToastItem[] = [];
    private _unsub?: () => void;

    onMount() {
        this._unsub = connectStore(toastStore, this as any, 'toasts');
    }

    onCleanup() {
        this._unsub?.();
    }

    render() {
        return html`<div>${this.toasts.map(t => html`<div>${t.message}</div>`)}</div>`;
    }
}
```

## Global imperative API pattern

A common use case is a global imperative API like `toast.success("Saved!")` —
callable from anywhere (server methods, event handlers, services). The pattern:

1. Create a module-level store.
2. Export an imperative API that calls `store.set()` / `store.update()`.
3. Mount a single component (e.g. `<Toaster />`) that subscribes and renders.

```typescript
// toast.client.ts
import { createStore } from '@cossackframework/core';

export interface ToastItem {
    id: string;
    message: string;
    variant?: 'default' | 'success' | 'warning' | 'destructive';
}

export const toastStore = createStore<ToastItem[]>([]);

function push(message: string, variant?: ToastItem['variant']) {
    const id = `toast-${Date.now()}`;
    toastStore.update((queue) => [...queue, { id, message, variant }]);
    setTimeout(() => {
        toastStore.update((queue) => queue.filter(t => t.id !== id));
    }, 4000);
}

export const toast = {
    show: (msg: string) => push(msg),
    success: (msg: string) => push(msg, 'success'),
    warning: (msg: string) => push(msg, 'warning'),
    error: (msg: string) => push(msg, 'destructive'),
    dismiss: (id: string) => toastStore.update(q => q.filter(t => t.id !== id)),
};
```

```typescript
// Anywhere in the app:
import { toast } from './toast';

@Server()
async saveSettings() {
    await Setting.update({ id }, patch);
    toast.success('Settings saved!');
}
```

## When to use `createStore` vs `provide`/`consume` vs `@State`

| Pattern | Use case |
|---|---|
| `@State` / `@ClientState` | Component-local reactive state |
| `provide` / `consume` | Static values injected from ancestor (env, user, request context) — one-time read |
| `createStore` | Global mutable state shared across unrelated components — re-renders on change |
| `@Service({ scope })` | Dependency-injected business logic shared across components |

Use `createStore` sparingly — it's for genuinely global cross-tree state.
For parent→child data flow, props and `provide`/`consume` are usually enough.
