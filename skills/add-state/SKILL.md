---
name: add-state
description: Add state management to a Cossack component
disable-model-invocation: true
user-invocable: true
---

# Add State to a Cossack Component

You are adding state management to an existing Cossack component (page, layout, or reusable component). Read the target file first to understand its current structure.

## Step 1: Read the Target File

Read the file the user wants to modify. Understand the existing class, its decorators, and its current state.

## Step 2: Determine the State Type

Ask or infer which type of state is needed:

### `@State()` — Server-Synced State

Use for data that must be synchronized between server and client. The framework automatically detects changes made in `@Server()` methods and broadcasts updates to all connected clients.

```typescript
import { State, Server } from '@cossackframework/core';

@State()
private count: number = 0;

@State()
private items: Item[] = [];

@State()
private message: string = '';
```

**Behavior:**
- Initialized on the server (e.g., in `init()`)
- Automatically synced to the client during SSR via `window.__INITIAL_STATE__`
- Changes in `@Server()` methods trigger re-renders on all connected clients (when using `durable-object` transport)
- Changes on client trigger an RPC call to the server method, then the server broadcasts the update

### `@ClientState()` — Client-Only State

Use for UI state that never needs to sync with the server. Triggers re-renders locally only.

```typescript
import { ClientState } from '@cossackframework/core';

@ClientState()
private isOpen: boolean = false;

@ClientState()
private searchText: string = '';
```

**Behavior:**
- Only exists on the client
- Triggers local re-render when changed
- Never sent to the server
- Reset on navigation

### `@Computed()` — Derived State

Use for values computed from other state. Memoized automatically.

```typescript
import { Computed } from '@cossackframework/core';

@State()
private items: Item[] = [];

@Computed()
get itemCount() {
    return this.items.length;
}

@Computed()
get hasItems() {
    return this.items.length > 0;
}
```

**Behavior:**
- Must be a getter
- Recomputed when dependent state changes
- Memoized (cached until dependencies change)

### `@Prop()` — Component Input

Semantically equivalent to `@ClientState()` but signals that the value is an input from a parent component. Use in reusable components (`@Component()`).

```typescript
import { Prop } from '@cossackframework/core';

@Prop()
variant: 'primary' | 'secondary' = 'primary';
```

### `@Validate()` — Validated State

Adds validation rules to `@State` or `@ClientState` properties.

```typescript
import { State, Validate } from '@cossackframework/core';

@State()
@Validate({
    rules: { required: true, email: true, message: 'Please enter a valid email' },
    config: { trigger: 'all', runOn: 'both' }
})
email: string = '';

@State()
@Validate({
    rules: { required: true, minLength: 8, message: 'At least 8 characters' },
    config: { trigger: 'all', runOn: 'both' }
})
password: string = '';
```

Built-in validation rules:
- `required`, `minLength`, `maxLength`, `min`, `max`
- `pattern` (RegExp), `email`, `url`
- `custom: (value) => boolean`
- `customAsync: (value, component) => Promise<boolean>`

Validation config options:
- `trigger`: `'input'` | `'blur'` | `'submit'` | `'all'`
- `runOn`: `'client'` | `'server'` | `'both'`
- `debounce`: number (ms)

Built-in validation methods: `this.validateProperty('fieldName')`, `this.validateAll()`, `this.getError('fieldName')`, `this.hasError('fieldName')`, `this.clearErrors()`.

## Step 3: Multi-Channel State (Real-Time)

For components with `transport: 'durable-object'`, state can be partitioned into channels for fine-grained updates:

```typescript
@Page({
    transport: 'durable-object',
    channels: ['feeds', 'notifications'],
})
export class Dashboard extends Cossack {
    @State({ channel: 'feeds' })
    private feedCount: number = 0;

    @State({ channel: 'notifications' })
    private notificationCount: number = 0;

    @Server({ channel: 'feeds' })
    incrementFeeds() {
        this.feedCount++;
    }

    @Server({ channel: 'notifications' })
    incrementNotifications() {
        this.notificationCount++;
    }
}
```

When `incrementFeeds` runs, only `feedCount` is broadcast to clients — not `notificationCount`.

**Note:** By default, Durable Object transport is stateless — state is ephemeral. Add `stateful: true` to `@Page()` if state needs to persist in DO storage across connections and evictions.

## Step 4: Optimistic UI

For instant client feedback while a server action is processing:

```typescript
import { Optimistic, ClientState } from '@cossackframework/core';

@State()
private count: number = 0;

@ClientState()
private optimisticCount: number = 0;

@Computed()
get displayCount() {
    return (this.loading['increment'] > 0)
        ? this.optimisticCount
        : this.count;
}

@Server()
async increment() {
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate latency
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

`@Optimistic('methodName')` links the handler to a `@Server()` method. It runs immediately on the client before the server responds.

## Step 5: Loading State

The framework provides `this.loading` — a counter of pending server method calls:

```typescript
render() {
    const isLoading = this.loading['fetchData'] > 0;
    return html`
        ${isLoading ? html`<div>Loading...</div>` : html`<div>${this.data}</div>`}
    `;
}
```

For `init()`, if the component defines `loadingTemplate()`, SSR is skipped and the loading UI shows immediately:

```typescript
loadingTemplate() {
    return html`<div class="skeleton">Loading...</div>`;
}

async clientInit() {
    await this.init(); // Called via RPC, triggers loadingTemplate during wait
}
```

In development mode, state changes are automatically logged to the browser console:
```
[Cossack] State change: count 0 -> 5
[Cossack] State change suppressed (same value): theme light
```
This helps debug reactivity issues. These logs are stripped from production builds.

## Step 6: Verify

1. Import the correct decorators from `@cossackframework/core`
2. State properties have default values
3. `@Validate()` is stacked on top of `@State()` or `@ClientState()` (not standalone)
4. For multi-channel state, ensure channels are declared in `@Page({ channels: [...] })`
5. For `@Optimistic()`, the referenced `@Server()` method exists
6. Run type checks: `pnpm tsc --noEmit`
