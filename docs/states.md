---
title: "State Management"
description: "Choose shallow state, deep stores, client-only fields, computed values, and server resources."
---

# State Management

A reactive field asks Cossack to update the UI when its value changes.
Public fields also cross the server/browser boundary.
Client-only fields belong to the component in the browser.
Choose the mechanism for each field before you write mutation code.

## Choose a mechanism

A store proxy observes writes through the component property.
A computed getter calculates a value when code reads it.
A server resource loads data on the server and exposes its loading status.
These mechanisms use different rules:

| Mechanism | What requests a render | What crosses the boundary |
| --- | --- | --- |
| `@State()` | Assign a different value to the field | Public snapshots for hydration, RPC, and realtime |
| `@Store()` | Replace the field, or change a nested plain object/array through its proxy | The complete public value |
| `@ClientState()` | Assign a different value to the field in the browser | No field snapshot |
| `@ClientStore()` | Replace the field, or change a nested plain object/array in the browser | No field snapshot |
| `@Computed()` | Reads calculate the value. Its reactive inputs request renders | No computed field snapshot |
| `server$()` | A read starts a load when dependencies change. Completion requests a render | Dependency identity and resolved data for hydration, explicit loader arguments for RPC |
| `createStore()` | `set` or `update` returns a different value. A subscribed component requests its render | No automatic serialization or server synchronization |

Use public state for values that server actions read or update.
Use client-only state for browser-owned filters, draft input, selected tabs, and panel visibility.
An authoritative realtime snapshot can replace public state.
Declare a browser-owned selection with `@ClientState` to retain it through that snapshot.

Public state from a client request is untrusted input.
A decorator does not provide authorization, database persistence, or a shared quota.
Use validated server actions and resource policies for those boundaries.
TypeScript `private` does not hide a decorated public field from serialization.

## Run the example

[StateMechanisms](./examples/state-mechanisms.ts) is a complete HTTP page.
Copy it to `src/pages/state-example/index.ts` in a generated Cossack app.
Its buttons demonstrate shallow replacement, nested store writes, local drafts, computed totals, and server resources.

These fields use the same declarations as the example:

```ts
@State() profile = { name: 'Ada' };
@Store() cart = { lines: [{ quantity: 1, price: 3 }], tags: [] as string[] };
@ClientState() panelOpen = false;
@ClientStore() draft = { tags: ['first'] };

@Computed()
get total() {
    return this.cart.lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
}
```

Computed getters run on each read.
They do not maintain a separate cache or a dependency graph.
If a shallow mutation does not request a render, the displayed computed value can remain stale until another render.
Keep computed getters free of writes and side effects.

## Replace shallow state

Assign a new value to an object or array field declared with `@State` or `@ClientState`.
A nested write changes the underlying data, but that write does not request a render.
An unrelated later render can display the changed data.
These operations therefore have different update behavior:

```ts
// Does not request a render through this field.
this.profile.name = 'Grace';

// Requests a render through this field.
this.profile = { ...this.profile, name: 'Grace' };
```

For arrays, use a replacement such as `this.rows = [...this.rows, row]`.
Calling `push` on a shallow array does not request a render through that field.
Assigning the same reference also does not request a render.
Use `@Store` or `@ClientStore` when the application needs nested mutation.

## Mutate a deep store

Read and mutate the value through its component property.
Nested plain objects, array elements, `push`, `splice`, and deletion request updates.
Cossack batches synchronous notifications into its normal render or broadcast cycle.
Whole-field replacement also requests an update.

```ts
this.cart.lines[0].quantity++;
this.cart.tags.push('edited');
this.draft.tags.splice(0, 1, 'replacement');
```

Repeated reads return stable proxies within a field.
A replacement starts a new proxy tree.
An alias to the original raw object bypasses the proxy and cannot notify the component.
Built-in objects and class instances remain raw to preserve their native methods.

A `Date`, `Map`, `Set`, or typed array inside a store does not gain deep reactivity.
Replace the enclosing field to notify the component after changing such a value.
Public serialization still follows the JSON contract below.
Client-only stores can retain browser-local native values.

Keep stores as trees for tracked tasks.
If two paths refer to the same object, its stable proxy reports the first observed path.
A task that tracks the other alias can miss that nested write.
Cycles also cannot cross the JSON boundary.

Do not pass a store proxy directly to `structuredClone`.
For JSON-compatible public data, create a detached snapshot with `JSON.parse(JSON.stringify(this.cart))`.
This also converts Dates to strings and drops undefined object fields.
Use an application-owned conversion for other values.

## Keep client-only fields out of snapshots

Cossack omits `@ClientState` and `@ClientStore` from initial state, component RPC state, and shared realtime state.
A child declaration can replace an inherited public field with a client-only field.
Request sanitization also rejects that field from a forged public overlay.
Inherited fields retain their declarations unless the child decorates a replacement.

Client-only fields still exist during server rendering with their authored initial values.
A template that reads one can include that initial value in HTML.
The decorator does not make a value secret or prevent an application from explicitly passing it as an RPC argument.
Use server-only code for secrets.

Initialize browser API values in `onMount` or `clientInit`.
Field initializers and shared rendering can run on the server.
For browser-only modules, use the `.client.ts` naming rule described in [Reactive Store](./reactive-store.md).

## Follow the public JSON contract

Public state follows the RPC value rules when it crosses an RPC boundary.
Use strings, finite numbers, booleans, null, arrays, and objects with serializable fields.
Model instances cross as own enumerable fields, without prototype methods.
Custom `toJSON` hooks define their representation at the real serializer.

Valid Dates cross as ISO strings.
Declare a public date field as an ISO string when both server and browser code need the same field type.
Undefined object fields disappear, and undefined or sparse array entries become null.
Null remains null.

Functions, symbols, bigints, cycles, non-finite numbers, invalid Dates, Maps, Sets, weak collections, binary values, and opaque native objects fail RPC serialization.
Do not use a public field for a `File`, DOM object, callback, or connection handle.
Pass upload files through a validated action argument instead.
`server$` resources use a stricter JSON-preserving contract that also rejects Dates, class instances, and custom hooks.

The initial HTML serializer keeps its JSON behavior.
Development diagnostics identify known values that cannot round-trip through RPC before that snapshot hides or loses them.
They do not change production serialization or reject a write.
Keep public state valid for both hydration and RPC.

## Read development diagnostics

A shallow mutation warning names the component, field, nested path, and the replacement or deep-store fix.
It covers `@State` and `@ClientState`.
No-op assignments, missing deletes, and rejected writes do not produce a warning.
The warning fires once per field for that component instance.

A public-state warning names the component, field, snapshot boundary, value path, and unsupported type.
For example, a cycle can report `state.cart.lines[0].owner (cyclic reference)`.
The warning prints no field values.
Identical issues remain quiet until the field becomes valid or the issue changes.

Diagnostic reads inspect data properties without calling getters or serialization hooks.
Those representations remain unknown until the real serializer runs.
Inspection stops after its depth or visit budget, so silence does not prove that every value is valid.
The consuming Vite application's development mode enables these diagnostics.
Production builds and direct Node imports without Vite do not run them.

## Bind flash and old input

`@State` and `@Store` accept `flash` and `old` options.
The server reads them during bootstrap.
A found value replaces the field initializer, then public hydration carries it to the browser.
Missing values retain the initializer.

| Option | Meaning |
| --- | --- |
| `flash: true` | Read the flashed value under the field name |
| `flash: 'message'` | Read the flashed value under that key |
| `old: true` | Read old form input under the field name |
| `old: 'address.street'` | Read old form input using that path |
| `channel`, `provider` | Select the logical grouping and provider for realtime dispatch |

If both `flash` and `old` are present, `flash` takes precedence.
A client-only decorator does not accept these public binding options.
Read [Session and Flash](./session.md) and [Validation](./validation.md) for the complete form flow.
State persistence depends on the selected runtime and transport.
Read [WebSockets](./websockets.md) before enabling durable state.
