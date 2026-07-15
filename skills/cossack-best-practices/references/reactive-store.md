# Reactive Store

A lightweight signal/subscriber primitive for **global** state shared across
unrelated components — state that triggers re-renders when it changes, like toast
queues, theme switching, or command-palette open/close.

## Why `createStore` exists

Cossack's `provide`/`consume` context API does a **one-time read** — it doesn't
notify consumers when the value changes. For static values injected from an
ancestor (env, user, request context), that's correct. For global state that
must re-render consumers on change, use `createStore`.

```typescript
import { createStore, connectStore, type ReactiveStore } from '@cossackframework/core';
```

## `createStore<T>(initial)`

Creates a reactive store with an initial value. Returns a `ReactiveStore<T>`
with `get()`, `set()`, `update()`, and `subscribe()`. Create it at **module
level** so any code in the app can import it.

```typescript
import { createStore } from '@cossackframework/core';

export const themeStore = createStore<'light' | 'dark'>('light');

console.log(themeStore.get());              // 'light'
themeStore.set('dark');                     // replaces value, notifies subscribers
themeStore.update(v => v === 'light' ? 'dark' : 'light');   // functional update
```

## `store.subscribe(listener)`

Subscribe to value changes. The listener is called **immediately** with the
current value (so the consumer is in sync from the start), then on every change.
Returns an unsubscribe function.

```typescript
const unsub = themeStore.subscribe((value) => {
    console.log('Theme changed to:', value);
});
unsub();   // stop listening
```

## `connectStore(store, target, key)`

Convenience: auto-wire a reactive store to a component's `@ClientState` field.
The field is updated whenever the store changes (triggering a re-render).
Returns an unsubscribe function — **call it in `onCleanup`**.

```typescript
import { Cossack, ClientState, createStore, connectStore } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

export const toastStore = createStore<ToastItem[]>([]);

@Component()
export class Toaster extends Cossack {
    @ClientState() toasts: ToastItem[] = [];
    private _unsub?: () => void;

    onMount() {
        this._unsub = connectStore(toastStore, this as any, 'toasts');
    }
    onCleanup() {
        this._unsub?.();   // always unsubscribe
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
3. Mount a single component (e.g. `Toaster`) that subscribes and renders.

```typescript
// toast.ts
import { createStore } from '@cossackframework/core';

export interface ToastItem {
    id: string;
    message: string;
    variant?: 'default' | 'success' | 'warning' | 'destructive';
}

export const toastStore = createStore<ToastItem[]>([]);

function push(message: string, variant?: ToastItem['variant']) {
    const id = `toast-${Date.now()}`;
    toastStore.update(queue => [...queue, { id, message, variant }]);
    setTimeout(() => {
        toastStore.update(queue => queue.filter(t => t.id !== id));
    }, 4000);
}

export const toast = {
    show:    (msg: string) => push(msg),
    success: (msg: string) => push(msg, 'success'),
    warning: (msg: string) => push(msg, 'warning'),
    error:   (msg: string) => push(msg, 'destructive'),
    dismiss: (id: string)  => toastStore.update(q => q.filter(t => t.id !== id)),
};
```

```typescript
// Anywhere in the app — even inside a @Server method:
import { toast } from './toast';

@Server()
async saveSettings() {
    await db().updateTable('settings')...;
    toast.success('Settings saved!');
}
```

> The UI package ships a ready-made `Toaster` component and `toast` API built on
> exactly this pattern — see `references/ui.md`.

## When to use `createStore` vs `provide`/`consume` vs `@State`

| Pattern | Use case |
|---|---|
| `@State` / `@ClientState` | Component-local reactive state |
| `provide` / `consume` | Static values injected from ancestor (env, user, request context) — one-time read |
| `createStore` | Global mutable state shared across unrelated components — re-renders on change |
| `@Service({ scope })` | Dependency-injected business logic shared across components |

Use `createStore` **sparingly** — only for genuinely global cross-tree state.
For parent→child data flow, props and `provide`/`consume` are usually enough.
