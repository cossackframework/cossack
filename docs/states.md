---
title: "States Management"
description: "Shared state between client and server using the @State decorator with automatic synchronization and simple property definitions."
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

That's it! When you change the state value, for example, `this.count++`, it automagically synchronize between servers and clients. The UI also reactive without complex hooks.

## Client-Only States (`@ClientState`)

Not all state needs to be synchronized with the server. Cosmetic UI state—like whether a dropdown is open, which tab is active, or the current value of an unsubmitted input—shouldn't require a network round-trip. 

For these cases, use the `@ClientState` decorator.

**How it works:**
1.  You decorate a property with `@ClientState`.
2.  When you change this property on the client, it **automatically** triggers a re-render.
3.  The property is **ignored** during Server-Side Rendering (initial state) and is **never** sent over the WebSocket.

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
1. Decorate an object property with `@Store()` (isomorphic, synchronized with the server — like `@State`) or `@ClientStore()` (client-only, never serialized — like `@ClientState`).
2. The framework wraps the value in a **recursive reactive Proxy**. Mutating any nested field or array element triggers a re-render (and a server broadcast on `@Store` when mutated server-side).
3. The store is serialized as a whole; nested objects/arrays are preserved across the SSR → client hydration round-trip and over broadcasts.

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
Stores compose with `@Validate` and the **type-safe `storeRules<T>()` helper**. Keys are written relative to the store and compile-time checked against the store type — typos fail to compile. See [Form Validation → Validating Stores](/docs/validation.md#validating-stores) for details.

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
            'address.zip': { required: true, pattern: /^\d{4,10}$/, message: 'Invalid ZIP' },
            tags: { required: true, minLength: 1, message: 'Add at least one tag' },
        }),
        config: { trigger: 'all', runOn: 'both' },
    })
    form: FormState = { email: '', address: { zip: '', country: '' }, tags: [] };

    @Client()
    onZipInput(event: Event) {
        this.form.address.zip = (event.target as HTMLInputElement).value;
        // At runtime, validate by the full prefixed path:
        this.validateProperty('form.address.zip', 'input');
        this.hasError('form.address.zip');
    }
}
```

`storeRules<T>()` is optional — omit `<T>` for an untyped map, or write full-path keys (`'form.email'`) directly to skip the helper entirely.

> Note: `@Store` / `@ClientStore` fully interoperate with `@State` / `@ClientState` and `@Computed` — mix and match whichever best fits each piece of state.

### Advanced: Why stores?

In React (and immutable-state models generally), you must never mutate state directly — every update produces a **new reference at each level** of the tree. For a deeply nested form this gets verbose and error-prone: you re-derive the whole update path by hand, or reach for `immer`/reducers to do it for you.

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
| **Update style** | Immutable — spread/cloning required at each level | Direct mutation (`store.field = x`) |
| **Deep nested update** | Re-derive full path or use `immer`/reducer | `store.address.zip = x` — reactive at any depth |
| **Array mutation** | Forbidden (`push`/`splice` mutate); must `map`/`filter`/spread | `store.tags.push(x)`, `splice`, `pop` — all reactive |
| **Change detection** | Reference inequality (`prev !== next`) | Trigger-based (Proxy `set` trap) — same model as `@State` |
| **Equality after nested mutation** | New top-level reference (`prev !== next`) | Same proxy reference (`prev === next`) — by design |
| **Reassignment** | Required (only way to update) | Optional — `this.store = {...}` also works |
| **Snapshot / undo** | Trivial (keep the old reference) | Roll your own (`structuredClone`), no built-in history |
| **Cyclic structures** | Works (references are plain) | `JSON.stringify` throws — same as a cyclic plain object |
| **Server sync** | Manual (`fetch`, optimistic UI, the whole RPC layer) | Automatic broadcast on `@Store` server-side mutations |
| **Boilerplate** | Reducer/action creators, or `immer`, or prop-drilling | None — declare `@Store()`, mutate |

**When immutability-style snapshots matter:** if you need undo/redo, time-travel debugging, or shallow-compare memoization, React's immutable references give you those for free. Cossack stores trade that for direct-mutation ergonomics. You can still snapshot (`structuredClone(this.form)`) when you need to — it's just not the default.

**Both idioms available:** you're never locked in. Whole-store reassignment (`this.form = {...}`) is reactive too, so you can mix mutation and replacement as the situation demands.


## Computed State (`@Computed`)

For values that can be derived from existing state, use the `@Computed` decorator on a getter.

**How it works:**
1. You define a getter method that calculates a value based on other properties.
2. You decorate it with `@Computed`.
3. The value is automatically re-calculated whenever the underlying state changes (because the template re-renders).
4. Computed properties are **not** serialized or sent over the network; they are always calculated locally.

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

By default, Durable Object transport is **stateless** — state is ephemeral and not persisted to DO storage. Add `stateful: true` to `@Page()` if state needs to persist across connections and DO evictions.
