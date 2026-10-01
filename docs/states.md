---
title: "States Management"
description: "Shared state between client and server using the @State and @Store decorators with automatic synchronization, flash/old auto-binding, and simple property definitions."
---

# States Management

Managing states in traditional frameworks used to be hard. You'll need to init state, fetch the data from the server, mutate it and synchronize everytime state change on both server and client. However, not anymore with Cossack.

## Defining States (`@State`)

To define a state, in your pages or components, just define a property with a `@State()` decorator. This will create a shared state between client and server, and they are synced automatically!

```ts
export class Counter extends Cossack {
    @State()
    private count: number = 0;

    increment() {
        this.count++;
    }

    render() {
        return html`
            <div>
                <p>Count: ${this.count}</p>
                <button @click=${this.increment}>+</button>
            </div>
        `;
    }
}
```

When you change a state value, such as with `this.count++`, Cossack syncs it between the server and client. The UI updates without extra hooks.

## `@State` / `@Store` Options

Both `@State()` and `@Store()` accept an options object. The `flash` and `old` options bind flashed values and old form input during bootstrap. Use them for the POST → redirect → GET form flow.

```ts
@State({ flash: true }) success: string | undefined;          // binds flashed('success')
@State({ flash: true }) errors: NestedErrors<MyForm> | undefined;
@State({ old: true })   name = '';                            // binds old('name'), falls back to ''
@Store({ old: true })   address = { street: '', city: '' };   // binds old('address'), whole object
```

| Option | Type | Default | Description |
|---|---|---|---|
| `flash` | `boolean \| string` | | Auto-bind from a flashed value (`flashed()`). `true` uses the property name as the key. A string sets the key. |
| `old` | `boolean \| string` | | Auto-bind from old input (`old()`). `true` uses the property name. A string sets the key and supports dot paths such as `'address.street'`. |
| `channel` | `string` | `'global'` | A logical grouping tag (realtime transport). See [WebSockets](/docs/websockets.md). |
| `provider` | `string` | `'page'` | Which `StateProvider` (Durable Object) a `@Server` action is dispatched over. See [Providers](/docs/providers.md). |

**`flash` / `old` rules:**

- The flashed or old value **wins over the class-field initializer**. This matches `old('name') ?? ''`. If no value was flashed, Cossack keeps the initializer.
- **Server-only.** On the client `flashed()`/`old()` return `undefined`, so the initializer is kept and the SSR-bound value arrives via normal state hydration.
- `flash` and `old` cannot be used together. If you set both, the property uses `flash`.
- No `init()` is needed for repopulation. Keep `init()` only when you need to *compute or transform* a value.

This removes the repetitive `init()` boilerplate. Instead of:

```ts
async init() {
    this.success = flashed('success');
    this.errors = flashed('errors');
    this.name = old('name') ?? '';
    this.address = old('address') ?? { street: '', city: '' };
}
```

just declare the bindings inline. See [Session & Flash → Auto-binding](/docs/session.md#auto-binding-flash--old-input-into-state) for the full reference, and [Forms](/docs/forms.md) for the complete POST → redirect → GET example.

## Client-Only States (`@ClientState`)

Not all state needs server synchronization. For example, a dropdown's open state, the selected tab, and an unsubmitted input value are client-only. These values do not need a network request.

For these cases, use the `@ClientState` decorator.

**How it works:**
1. You decorate a property with `@ClientState`.
2. When you change this property on the client, it **automatically** triggers a re-render.
3. The property is **ignored** during Server-Side Rendering (initial state) and is **never** sent over the WebSocket.

### Example: A Toggle Switch

```typescript
import { Page, ClientState } from '@cossackframework/core';

@Page()
export class ToggleDemo extends Cossack {
    
    @ClientState() 
    private isExpanded: boolean = false;

    @Client()
    toggle() {
        this.isExpanded = !this.isExpanded;
    }

    protected render() {
         return html`
            <button @click=${this.toggle}>
                ${this.isExpanded ? 'Hide' : 'Show'} Details
            </button>

            ${this.isExpanded ? html`<div>Secret details here...</div>` : ''}
        `;
    }
}
```


## Stores (`@Store` / `@ClientStore`)

For complex forms and grouped UI state, defining many individual `@State` fields becomes repetitive. The `@Store` and `@ClientStore` decorators let you group multiple related fields in **one object** while keeping full reactivity at **any depth**.

### How it works
1. Decorate an object property with `@Store()` (isomorphic, synchronized with the server : like `@State`) or `@ClientStore()` (client-only, never serialized : like `@ClientState`).
2. The framework wraps the value in a **recursive reactive Proxy**. Mutating any nested field or array element triggers a re-render (and a server broadcast on `@Store` when mutated server-side).
3. The store is serialized as a whole. Nested objects and arrays stay intact during client hydration and broadcasts.

### Deep nested mutation
Reactivity works for **objects** and **arrays** at any depth, including array methods:

```typescript
import { Page, Store, ClientState } from '@cossackframework/core';

interface FormState {
    email: string;
    address: { zip: string; country: string };
    tags: string[];
}

@Page({ transport: 'http' })
export class ComplexForm extends Cossack {
    @Store()
    form: FormState = {
        email: '',
        address: { zip: '', country: '' },
        tags: [],
    };

    @ClientState()
    draftTag = '';

    @Client()
    onEmail(e: Event) {
        // Top-level mutation — reactive.
        this.form.email = (e.target as HTMLInputElement).value;
    }

    @Client()
    onZip(e: Event) {
        // Deep nested mutation — reactive (multi-level).
        this.form.address.zip = (e.target as HTMLInputElement).value;
    }

    @Client()
    addTag() {
        // Array mutation — reactive (push/splice/pop/sort/length all work).
        if (this.draftTag) this.form.tags.push(this.draftTag);
        this.draftTag = '';
    }

    protected render() {
        return html`
            <p>Email: ${this.form.email}</p>
            <p>ZIP: ${this.form.address.zip}</p>
            <ul>${this.form.tags.map(t => html`<li>${t}</li>`)}</ul>
        `;
    }
}
```

### Identity & serialization
- Repeated reads of the same store (or nested object) return the **same proxy** (stable identity), so `this.form.address === this.form.address`.
- The proxy is transparent to `JSON.stringify`, so stores serialize identically to plain objects for SSR hydration and broadcasts.
- Whole-store reassignment (`this.form = {...}`) is also reactive and invalidates the cached proxy.

### Client-only stores
`@ClientStore` mirrors `@ClientState`: nested mutations re-render the client UI, but the store is **never** serialized or sent over the wire. Use it for ephemeral grouped state (multi-step form drafts, transient filters, panel state).

### Validating store fields
Stores work with `@Validate` and the **type-safe `storeRules<T>()` helper**. Write keys relative to the store. TypeScript checks them against the store type and reports typos. See [Form Validation → Validating Stores](/docs/validation.md#validating-stores).

```typescript
import { Cossack, Page, Store, Validate, Client, storeRules } from '@cossackframework/core';

interface FormState {
    email: string;
    address: { zip: string; country: string };
    tags: string[];
}

@Page({ transport: 'http' })
export class StoreFormDemo extends Cossack {
    @Store()
    @Validate({
        rules: storeRules<FormState>({
            email: { required: true, email: true, message: 'Enter a valid email' },
            address: { zip: { required: true, pattern: /^\d{4,10}$/, message: 'Invalid ZIP' } },
            tags: { required: true, minLength: 1, message: 'Add at least one tag' },
        }),
        config: { trigger: 'all', runOn: 'both' },
    })
    form: FormState = { email: '', address: { zip: '', country: '' }, tags: [] };

    @Client()
    onZipInput(event: Event) {
        this.form.address.zip = (event.target as HTMLInputElement).value;
        // At runtime, validate by the full prefixed dot-path:
        this.validateProperty('form.address.zip', 'input');
        this.hasError('form.address.zip');
    }
}
```

`storeRules<T>()` is optional. Omit `<T>` to use a nested map without compile-time path checks.

> `@Store` and `@ClientStore` work with `@State`, `@ClientState`, and `@Computed`. Choose the decorator for each state value.

### Advanced: Why stores?

In React (and immutable-state models generally), you must never mutate state directly : every update produces a **new reference at each level** of the tree. For a deeply nested form this gets verbose and error-prone: you re-derive the whole update path by hand, or reach for `immer`/reducers to do it for you.

Cossack stores use a recursive reactive Proxy, so **you mutate the object directly** and the framework observes the change at any depth. The code reads exactly like the data shape.

```typescript
// React — must spread at every level to produce new references
setForm(prev => ({
    ...prev,
    address: { ...prev.address, zip: '12345' },   // nested object
}));
setForm(prev => ({ ...prev, tags: [...prev.tags, 'new'] })); // array

// Cossack — direct structural mutation, reactive at any depth
this.form.address.zip = '12345';
this.form.tags.push('new');
```

The win compounds with depth: a 3-level immutable spread (`...prev.a.b.c`) is genuinely hard to write correctly, while `this.form.section.group.field = x` is self-evident.

#### Tradeoffs vs. React state

| Aspect | React (`useState` / `useReducer`) | Cossack `@Store` |
| :--- | :--- | :--- |
| **Update style** | Create a new value with spread or cloning at each level. | Change the value directly with `store.field = x`. |
| **Deep nested update** | Rebuild the path or use `immer` or a reducer. | `store.address.zip = x` updates the state at any depth. |
| **Array mutation** | Do not use `push` or `splice`. Use `map`, `filter`, or spread. | `store.tags.push(x)`, `splice`, and `pop` update the state. |
| **Change detection** | Compare references with `prev !== next`. | A Proxy `set` trap detects the change, as with `@State`. |
| **Equality after nested mutation** | A nested update creates a new top-level reference. | The proxy reference stays the same. |
| **Reassignment** | Reassign the value to trigger an update. | Reassignment such as `this.store = {...}` also works. |
| **Snapshot / undo** | Trivial (keep the old reference) | Roll your own (`structuredClone`), no built-in history |
| **Cyclic structures** | Supported because references stay plain. | `JSON.stringify` throws on a cyclic object. |
| **Server sync** | Manual (`fetch`, optimistic UI, the whole RPC layer) | Automatic broadcast on `@Store` server-side mutations |
| **Boilerplate** | Add reducers, action creators, `immer`, or props. | Declare `@Store()` and change its value. |

**When immutable snapshots matter:** React-style immutable references support undo/redo, time-travel debugging, and shallow-compare memoization. Cossack stores use direct mutations by default. Create a snapshot with `structuredClone(this.form)` when you need one.

**Both idioms available:** you are never locked in. Whole-store reassignment (`this.form = {...}`) is reactive too, so you can mix mutation and replacement as the situation demands.


## Computed State (`@Computed`)

For values that can be derived from existing state, use the `@Computed` decorator on a getter.

**How it works:**
1. You define a getter method that calculates a value based on other properties.
2. You decorate it with `@Computed`.
3. The value is automatically re-calculated whenever the underlying state changes (because the template re-renders).
4. Computed properties are **not** serialized or sent over the network. Cossack calculates them locally.

### Example: Derived Calculation

```typescript
import { Page, State, Computed } from '@cossackframework/core';

@Page()
export class Counter extends Cossack {
    @State()
    private count: number = 0;

    // Derived state
    @Computed()
    get doubleCount() {
        return this.count * 2;
    }

    protected render() {
        return html`
            <p>Count: ${this.count}</p>
            <p>Doubled: ${this.doubleCount}</p>
        `;
    }
}
```

## Advanced: Realtime State with WebSockets

Refer to [Websockets](/docs/websockets.md) documentation about how to make realtime application with websockets.

By default, Durable Object transport is **stateless**. It does not persist state to DO storage. Add `stateful: true` to `@Page()` to persist state across connections and DO evictions.
