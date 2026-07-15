# Decorators API Reference

All decorators are imported from `@cossackframework/core` unless otherwise noted.

## Class Decorators

### `@Page(options?)`

Marks a class as a page component. Applied to route pages and layouts.

```typescript
@Page({
    transport: 'http',          // 'http' | 'durable-object' | 'websocket' | 'sse'
    stateful: false,            // boolean — persist state in DO storage (only with 'durable-object')
    middlewares: [],            // MiddlewareHandler[] — server middleware
    channels: ['global'],       // string[] — state channels for real-time
    providers: {},              // { [key: string]: StateProvider }
    route?: '',                 // Override the file-based route
    ssg?: false,                // boolean | SsgOptions — static generation
})
export class MyPage extends Cossack { ... }
```

### `@Component(options?)`

Marks a class as a reusable component. Semantically distinct from `@Page` for future tooling; same options.

```typescript
@Component({ transport: 'http' })
export class Button extends Cossack { ... }
```

### `@Service(options?)`

Marks a class as an injectable service for dependency injection.

```typescript
@Service({ scope: 'singleton' })  // 'singleton' | 'transient'
export class PaymentService { ... }
```

## Property Decorators

### `@State(options?)`

Server-synced state. Initialized on the server, automatically synced to the client. Changes in `@Server()` methods trigger re-renders on all connected clients.

```typescript
@State()
count: number = 0;

@State({ channel: 'feeds' })
feedCount: number = 0;

@State({ provider: 'user-session' })
userPrefs: Record<string, string> = {};
```

Options:
- `channel?: string` — Channel for partial updates (default: `'global'`)
- `provider?: string` — State provider name (default: `'page'`)

### `@ClientState()`

Client-only reactive state. Triggers re-renders locally. Never sent to the server.

```typescript
@ClientState()
isOpen: boolean = false;
```

### `@Store(options?)`

Deep reactive state for objects and arrays. Like `@State`, it is server-synced and isomorphic (serialized into initial state, hydrated on the client, broadcast when mutated on the server) — but it wraps the value in a deep `Proxy` so **nested mutations** trigger the same broadcast / re-render path as a top-level setter:

```typescript
@Store()
form = {
    email: '',
    address: { zip: '', country: '' },
    tags: [] as string[],
};

// All of these are reactive — no manual reassignment needed:
this.form.email = 'a@b.com';
this.form.address.zip = '12345';
this.form.tags.push('new-tag');     // array mutation
this.form.tags.splice(0, 1);
```

Use `@Store` when you mutate nested fields in place. For a single scalar value, `@State` is the right choice. Options are identical to `@State`:

- `channel?: string` — Channel for partial updates (default: `'global'`)
- `provider?: string` — State provider name (default: `'page'`)

`@Validate` can be stacked on a `@Store` with a **rule map** (keys are paths relative to the store). See `validation.md`.

### `@ClientStore()`

Client-only deep reactive state. Like `@ClientState` but with the same deep-`Proxy` reactivity as `@Store`. Nested mutations trigger client re-renders, but the value is **never serialized or sent over the wire**. Use for ephemeral grouped UI state (multi-step form drafts, collapsible panel trees, transient filters).

```typescript
@ClientStore()
ui = { panel: { open: false, tab: 'details' } };

togglePanel() { this.ui.panel.open = !this.ui.panel.open; }
```

### `@Prop()`

Semantic equivalent to `@ClientState()`. Indicates a component input from a parent. Use in reusable components.

```typescript
@Prop()
variant: 'primary' | 'secondary' = 'primary';
```

### `@Validate(options?)`

Adds validation rules to a `@State`, `@ClientState`, `@Store`, or `@ClientStore` property. Must be stacked on top of the state/store decorator. For `@State`/`@ClientState` pass a single rule; for `@Store`/`@ClientStore` pass a map of rules keyed by path (or use `storeRules<T>()` for compile-time-checked keys). See `validation.md` for the full guide.

```typescript
@State()
@Validate({
    rules: { required: true, email: true, message: 'Invalid email' },
    config: { trigger: 'all', runOn: 'both' }
})
email: string = '';
```

Validation rules:
| Rule | Type | Description |
|------|------|-------------|
| `required` | `boolean` | Field must not be empty |
| `minLength` | `number` | Minimum string/array length |
| `maxLength` | `number` | Maximum string/array length |
| `min` | `number` | Minimum numeric value |
| `max` | `number` | Maximum numeric value |
| `pattern` | `RegExp` | Must match regex |
| `email` | `boolean` | Must be a valid email |
| `url` | `boolean` | Must be a valid URL |
| `custom` | `(value) => boolean` | Custom sync validator |
| `customAsync` | `(value, component?) => Promise<boolean>` | Custom async validator |
| `message` | `string` | Error message (applies to first failing rule) |

Config options:
| Option | Values | Default |
|--------|--------|---------|
| `trigger` | `'input' \| 'blur' \| 'submit' \| 'all'` | `'all'` |
| `runOn` | `'client' \| 'server' \| 'both'` | `'both'` |
| `errorProperty` | `string` | `'errors'` |
| `debounce` | `number` (ms) | `0` |

### `@Ref()`

Creates a ref object for direct DOM element access.

```typescript
@Ref()
inputRef: Ref<HTMLInputElement>;

onMount() {
    this.inputRef.value?.focus();
}
```

## Method Decorators

### `@Server(options?)`

Marks a method as server-only. On the client, the method body is replaced with a proxy that calls the server via WebSocket or HTTP.

```typescript
@Server()
async fetchData() {
    // This code only runs on the server
    this.data = await db.query();
}

@Server({ channel: 'feeds' })
async updateFeeds() {
    this.feedCount++;
}
```

Options:
- `channel?: string` — Channel for the action (default: `'global'`)
- `provider?: string` — State provider (default: `'page'`)

### `@Client(options?)`

Marks a method as client-only. On the server, the method body is replaced with a no-op. Can be called from `@Server()` methods to invoke on all connected clients.

```typescript
@Client()
toggleMenu() {
    this.isOpen = !this.isOpen;
}

@Client({ channel: 'tasks' })
showAlert(message: string) {
    alert(message);
}
```

Options:
- `channel?: string` — Channel (default: `'global'`)

### `@Shared()`

Marks a method as safe for both client and server. Full implementation is retained in both bundles. Use for pure functions, validation logic, and data transformation.

```typescript
@Shared()
formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
}
```

### `@Computed()`

Marks a getter as a computed property. Memoized — recomputed only when dependent state changes.

```typescript
@Computed()
get fullName() {
    return `${this.firstName} ${this.lastName}`;
}
```

### `@Optimistic(actionName)`

Links a client-side handler to a `@Server()` method for instant UI feedback. Runs immediately on the client before the server responds.

```typescript
@Server()
async increment() {
    await new Promise(r => setTimeout(r, 500));
    this.count++;
}

@Optimistic('increment')
applyOptimisticIncrement() {
    if (!this.loading['increment']) {
        this.optimisticCount = this.count;
    }
    this.optimisticCount++;
}
```

### `@OnEvent(eventName)`

Registers a method as a handler for a broadcast event. Used with real-time transport.

```typescript
@OnEvent('tasks:changed')
async onTasksChanged() {
    await this.init();
}
```

### `@On(eventName)`

Registers a method as a handler for a DOM event on the component's root element.

```typescript
@On('click')
handleRootClick(event: MouseEvent) {
    // ...
}
```

### `@OnDocument(eventName, options?)`

Registers a method as a handler for a document-level event. Automatically cleaned up on component destruction.

Options:
- `throttle?: number` — Minimum interval (ms) between handler calls
- `debounce?: number` — Delay (ms) before handler fires after last event

```typescript
@OnDocument('keydown')
handleGlobalKeydown(event: KeyboardEvent) { /* ... */ }

@OnDocument('mousemove', { throttle: 100 })
handleMouseThrottled(event: MouseEvent) { /* fires at most once every 100ms */ }
```

### `@OnWindow(eventName, options?)`

Registers a method as a handler for a window-level event. Automatically cleaned up on component destruction.

Options:
- `throttle?: number` — Minimum interval (ms) between handler calls
- `debounce?: number` — Delay (ms) before handler fires after last event

```typescript
@OnWindow('resize')
handleResize() {
    this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
}

@OnWindow('scroll', { throttle: 200 })
handleScrollThrottled() { /* at most once every 200ms */ }

@OnWindow('resize', { debounce: 150 })
handleResizeDebounced() { /* 150ms after user stops resizing */ }
```

### `@Task(options?)`

Registers a method to run on component mount **and** every time the component's state updates. Runs on **both server and client**.

`@Task` accepts an optional options object. Pass `{ track: [...] }` to run the task only when specific state fields change (useEffect-style dependency array), and `return` a cleanup function for automatic teardown.

```typescript
@State() count = 0;

// Runs on mount + every state update, on both server and client.
@Task()
logUpdate() {
    console.log(`Count is: ${this.count}`);
}

// Tracked: runs on mount + ONLY when `user` or `posts` change.
@Task({ track: ['user', 'posts'] })
async reloadFeed() {
    this.feed = await fetch(`/api/feed?u=${this.user.id}`).then(r => r.json());
}

// Cleanup: the returned function runs before the next re-run and on destroy().
@Task({ track: ['symbol'] })
subscribe() {
    const ws = new WebSocket(`/quotes/${this.symbol}`);
    return () => ws.close();
}
```

Options:
- `track?: (string | symbol)[]` — restrict which state changes re-run the task. Supports dot-paths for nested `@Store` fields (e.g. `track: ['form.email']`). Omit (or pass `[]`) to run on every state change (legacy default). See `references/tasks.md` for the full path-matching table.

### `@ServerTask(options?)`

Like `@Task`, but the method runs **only on the server**. Its body is stripped from the client bundle by the security plugin (like `@Server` methods), so no manual `if (this.isServer) return;` guard is needed. Use for server-only side effects (data normalization, analytics, env-driven state seeding). Accepts the same `{ track }` option.

### `@ClientTask(options?)`

Like `@Task`, but the method runs **only on the client**. Its body is preserved in the client bundle; the server skips it. Use for logic that touches the DOM or browser APIs and needs to re-run on every render — this replaces the manual `if (this.isServer) return;` guard. Accepts the same `{ track }` option.

```typescript
@ClientTask()
syncDialogState() {
    const dlg = this.dialogRef.value;
    if (!dlg) return;
    if (this.props.open && !dlg.open) dlg.showModal();
    else if (!this.props.open && dlg.open) dlg.close();
}
```

### Task decorator comparison

| Decorator | Server | Client | Use for |
|---|---|---|---|
| `@Task` | ✅ Runs | ✅ Runs | Logic safe on both sides (logging, derived state) |
| `@ServerTask` | ✅ Runs | ❌ Body stripped | Server-only side effects (no `if (isServer)` guard needed) |
| `@ClientTask` | ❌ Skipped | ✅ Runs | DOM/browser logic (no `if (!isServer)` guard needed) |
| `@VisibleTask` | ❌ Skipped | ✅ Runs | Deferred until the element enters the viewport |

See `references/tasks.md` for the lifecycle/track deep dive and "choosing the right tool" guidance.

### `@VisibleTask(options?)`

Registers a method to run **only on the client** when the component (or a specific element within it) becomes visible in the viewport (via `IntersectionObserver`). Use for expensive work that should be deferred until the user actually sees the content.

Options:
- `strategy?: 'intersection-observer' | 'document-ready'` (default `'intersection-observer'`)
- `threshold?: number` — visibility fraction 0–1 (default `0`)
- `selector?: string` — CSS selector to target a specific element within the component (default: the root container). When set, new matching elements are auto-observed after each SPA navigation.

### `@PreventNavigation()`

Prevents browser navigation while the method's condition is true.

## Helper Functions

### `defineServerMiddleware(handler)`

Semantic wrapper for server middleware. From `@cossackframework/core`.

```typescript
const myMiddleware = defineServerMiddleware(async (c, next) => {
    console.log(c.req.path);
    await next();
});
```

### `createTypedDecorators<T>()`

Creates typed versions of `@State` and `@Server` with channel name autocomplete.

```typescript
const { State, Server } = createTypedDecorators<{ Channels: 'feeds' | 'notifications' }>();
```

### `storeRules<T>(rules)`

Type-safe rule map for `@Validate` on a `@Store` / `@ClientStore`. Keys are checked against the store type `T` at compile time, so a typo like `emial` fails to compile. Keys are **relative** to the store property — the decorator auto-prefixes them with the property name at runtime. See `validation.md`.

```typescript
@Store()
@Validate({
    rules: storeRules<SubmitFormState>({
        email: { required: true, email: true, message: 'Enter a valid email' },
        'address.zip': { required: true, pattern: /^\d{4,10}$/, message: 'Invalid ZIP' },
        tags: { required: true, minLength: 1, message: 'Add at least one tag' },
    }),
})
form: SubmitFormState = { email: '', address: { zip: '' }, tags: [] };
```

### `createStore<T>(initial)` / `connectStore(...)`

A lightweight signal/subscriber primitive for **global** state shared across unrelated components (toast queues, theme, command palette open/close) — re-renders on change. From `@cossackframework/core`. Use `provide`/`consume` for one-time-injected values; use `createStore` only when consumers must re-render on change.

```typescript
import { createStore, connectStore } from '@cossackframework/core';

export const themeStore = createStore<'light' | 'dark'>('light');
themeStore.get();                       // → 'light'
themeStore.set('dark');                 // notifies all subscribers
themeStore.update(v => v === 'light' ? 'dark' : 'light');

@Component()
export class ThemeBadge extends Cossack {
    @ClientState() theme: 'light' | 'dark' = 'light';
    private _unsub?: () => void;
    onMount() { this._unsub = connectStore(themeStore, this as any, 'theme'); }
    onCleanup() { this._unsub?.(); }   // always unsubscribe
}
```

See `references/reactive-store.md` for the full API and the global imperative-API pattern (e.g. `toast.success()`).

### `focusTrap()` / `focusFirst()` / `focusLast()` / `focusNext()` / `getTabbable()`

DOM-level focus utilities for accessible interactive components (custom menus, command palettes, comboboxes, roving-tabindex lists). From `@cossackframework/core`. Framework-agnostic — no Cossack dependency.

```typescript
import { focusTrap, focusNext } from '@cossackframework/core';

class MyDialog extends Cossack {
    private releaseTrap?: () => void;
    onMount() { this.releaseTrap = focusTrap(this.container); }
    onCleanup() { this.releaseTrap?.(); }   // restores focus to the trigger
}
```

> The native `<dialog>` element (used by the UI package's `Modal` and `Sheet`) traps focus automatically — you don't need `focusTrap` for those. Use `focusTrap` only for custom overlays that DON'T use `<dialog>`. See `references/ui.md#focus-management`.

### `createAuth<User>(provider)`

Creates an auth kit with middleware and login handler. From `@cossackframework/auth`.

### `Image(props)`

Image optimization helper. From `@cossackframework/core`.

```typescript
Image({
    src: '/photo.jpg',
    width: 600,
    height: 400,
    fit: 'cover',
    quality: 80,
    format: 'webp',
    alt: 'Description',
    loading: 'lazy',
})
```

### `component(clazz, props?, children?)`

Component instantiation helper. From `@cossackframework/renderer`.

```typescript
component(Button, { variant: 'primary', '@click': handler }, 'Click Me')
```
