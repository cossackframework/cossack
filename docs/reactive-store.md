---
title: "Reactive Store"
description: "Share browser state with createStore and disconnect subscriptions with component cleanup."
---

# Reactive Store

`createStore` holds a value and notifies its subscribers when that value changes.
It can connect unrelated components such as a message list or theme selector.
It does not add the deep proxy behavior of the `@Store` decorator.
It does not serialize values or synchronize them with a server.

## Replace the stored value

Use `set` to replace a value or `update` to calculate a replacement.
Both methods compare the result with the current value using `Object.is`.
If the result is the same value or reference, subscribers receive no notification.
Return a new object or array when you change a collection.

```ts
import { createStore } from '@cossackframework/core';

const messages = createStore<string[]>([]);
messages.set(['Saved']);
messages.update(current => [...current, 'Published']);

// These mutate data without notifying subscribers.
messages.get().push('Unobserved');
messages.update(current => { current.push('Also unobserved'); return current; });
```

A subscriber receives the current value immediately.
It then receives each distinct replacement.
Call the returned unsubscribe function when the consumer no longer needs updates.
Repeated subscriptions and retained callbacks otherwise keep their consumers alive.

```ts
const disconnect = messages.subscribe(value => console.log(value));
messages.set(['Updated']);
disconnect();
```

## Connect a component

Declare the component field with `@ClientState`.
Connect it during `onMount`, then disconnect it during `onCleanup`.
`connectStore` assigns each published value to that field.
The field's normal reactivity requests the render.

[Messages](./examples/reactive-store.client.ts) is a complete example compiled by the release tests.
Its module contains the store, the `showMessage` function, and the component.
The following lifecycle methods own the subscription:

```ts
onMount() {
    this.disconnect = connectStore(messages, this, 'items');
}
onCleanup() {
    this.disconnect?.();
}
```

Do not call a browser store from a server method.
After a server action succeeds, call `showMessage` from the client handler that awaited it.
A native server call to that module has no browser subscriber.
Separate server state from browser UI messages.

## Use browser-only modules

Name a module `messages.client.ts` when it owns browser state or accesses browser APIs at module initialization.
A shared component can statically import `./messages.client`.
The server build substitutes lazy placeholders for explicit runtime exports.
Importing those placeholders is safe, but reading or calling them during SSR fails.

Use such exports from `onMount`, `clientInit`, or a client method.
Do not read them in `render`, `init`, a server field initializer, or module initialization on the server.
Runtime `export *` is rejected because the compiler cannot determine the local placeholder interface.
Explicit value exports and type-only exports are supported.

A module-level store shares one value within its JavaScript runtime.
On the server, that can share request data between users.
Cloudflare also documents this risk for [request data in global scope](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#do-not-store-request-scoped-state-in-global-scope).
If server code needs a store, create it for the request or its owned service scope.
A browser-only module avoids server initialization of its UI singleton.

## Choose between state APIs

These APIs have separate ownership and notification rules.
Use component fields for local rendering state.
Use a declared layout service when components share business logic during that layout's lifetime.
A context value supplies data from an ancestor without subscribing to changes.

| API | Ownership and update behavior |
| --- | --- |
| `@State` / `@Store` | Public component state, with shallow/deep updates |
| `@ClientState` / `@ClientStore` | Browser component state, with shallow/deep updates |
| `createStore` | Application-owned value and explicit subscribers |
| `provide` / `consume` | Ancestor context lookup without reactive subscription |
| Layout-scoped `@Service` | Declared service state and methods owned by a layout scope |

Read [State Management](./states.md) for mutation examples, JSON rules, and diagnostics.
Read [Tasks](./tasks.md) before starting asynchronous work that can outlive a component.
A subscription can also return its disconnect function from a client task.
Use tracked inputs for that task so it reconnects only when its dependencies change.
