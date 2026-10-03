---
title: "Optimistic UI Updates"
description: "Preview a synchronous edit and keep each pending call's state under separate ownership."
---

# Optimistic UI Updates

An optimistic handler shows an expected result before a server action replies.
Use `@Optimistic('actionName')` on a synchronous client method.
The handler can change State, Store, ClientState, and ClientStore fields.
The server action still validates and authorizes the actual mutation.

## Preview an assignment

This example saves an absolute value.
The preview runs once, and the action receives an argument that describes the edit.
HTTP request state contains confirmed or user-authored public values, without pending optimistic previews.
A preview must not become an extra server increment.

```ts
import { Cossack, State, ClientState, Optimistic, Server, Client, input } from '@cossackframework/core';

class Counter extends Cossack {
    @State() count = 0;
    @ClientState() error = '';

    @Optimistic('save')
    preview(value: { count: number }) {
        this.count = value.count;
    }

    @Server({ input: input.object({ count: input.number({ min: 0 }) }) })
    save(value: { count: number }) {
        this.count = value.count;
        return this.count;
    }

    @Client()
    async increase() {
        try {
            await this.save({ count: this.count + 1 });
            this.error = '';
        } catch {
            this.error = 'The result could not be confirmed.';
        }
    }
}
```

Component state alone does not persist a record or make a database update atomic.
Use a server-owned record and its concurrency policy when multiple callers edit shared data.
For a durable counter, the server owns the increment and returns its authoritative value.

## Keep handlers synchronous

Change reactive fields directly in the handler.
Do not fetch, navigate, subscribe, start asynchronous work, or call another server action from it.
The framework captures the handler's before and after values once.
It does not rerun the handler to reconstruct state.

Declared async handlers are rejected before execution.
A handler that returns a promise is rejected after its synchronous work, and that work is restored.
The framework cannot stop asynchronous effects already started by application code.
A throwing handler restores its captured field changes and logs the failure; the server action can still run.

## Record relative operations

Use `optimistic<YourClass>(this)` inside a synchronous optimistic handler.
The helper records each increment, append, or removal as a separate data operation.
If an older call fails, later operations apply again to the remaining base.
Application handlers still run once.

This complete example keeps an acknowledged list in client-only fields.
The server checks the input and returns its ID.
It does not persist a record.

```ts
import { Cossack, ClientState, ClientStore, Optimistic, Server, input, optimistic } from '@cossackframework/core';

export class Editor extends Cossack {
    @ClientState() accepted = 0;
    @ClientStore() items: { id: number; label: string }[] = [];

    @Optimistic('save')
    preview(value: { id: number; label: string }) {
        const edits = optimistic<Editor>(this);
        edits.increment('accepted', 1);
        edits.append('items', value);
    }

    @Server({ input: input.object({ id: input.number({ min: 0 }), label: input.string() }) })
    save(value: { id: number; label: string }) {
        return value.id;
    }
}
```

Suppose two calls append `old` and `next` and increase `accepted` from zero to two.
If the older call fails, the list contains only `next`, and `accepted` becomes one.
This holds when the newer call is pending or already succeeded.
The helper also supports public State and Store fields.
An authoritative reply supplies their base and replaces operations that it confirms.

| Operation | Behavior |
| --- | --- |
| `increment(field, amount)` | Add a finite amount to a finite numeric field |
| `append(field, item)` | Append one detached data item to an array field |
| `remove(field, item)` | Remove the first structurally equal item, preserving duplicate order |

Removal records its intent even when the item is currently absent.
If an older removal fails, a later removal still applies to the restored item.
Multiple operations in a handler keep their authored order.
Operation values copy enumerable data properties.
That data must be finite and plain, without cycles, accessors, symbols, functions, or native objects.
The helper copies items before previewing them and does not call serialization hooks.
Number results must stay finite.

Use the concrete class as the type argument within a class method.
TypeScript cannot fully resolve mapped field types through polymorphic `this`.
Outside class methods, an ordinary concrete object supplies the inferred type.
Types check writable field names and array item shapes.
Runtime metadata still determines which fields are reactive.

Do not mix operations and direct assignments on the same field in one handler.
That handler fails, restores its captured edits, and logs `OptimisticEditError`.
Direct assignments on other fields remain supported.
A saved helper cannot write after its handler ends or during another handler.

Direct assignments retain absolute, whole-field semantics.
For a later local replacement, the replacement becomes the base for newer relative operations.
An arbitrary local nested edit still protects its complete field.
Use explicit operations when removing only an arithmetic or array contribution is required.

## Separate pending calls

Each invocation owns its preview separately, including two calls to the same method.
A rejected call removes its own preview.
Another pending preview or a newer successful result remains visible.
Responses from older calls cannot replace an already accepted newer response on an owned field.
An unrelated response that only echoes its input does not confirm another field's preview.
The action's loading count decreases once for each completed, rejected, canceled, or timed-out call.
Uncorrelated realtime completion broadcasts cannot settle a request-scoped call.

Ownership is at the top-level reactive field.
Plain object and array trees are copied, so nested Store edits can roll back.
Snapshots have a maximum depth of 256. A preview beyond that limit is restored and logged.
If a later local value cannot be detached, the setter retains its reference and reports the limit.
That value does not gain deep rollback guarantees, and it cannot prevent other fields or loading from settling.
Two independent fields remain independent.
A later user edit to an owned field takes priority during the pending call, including nested writes through Store.

A direct-assignment preview records the resulting field value.
Use the explicit helper for arithmetic and array operations.
Neither representation provides a database transaction.
A newer preview can include data it read from an older preview.
The framework does not infer subtraction, array element ownership, or a safe replay of application code.
A later nested user edit protects that whole field, so it can also retain earlier preview data in that tree.
Use separate fields for independent drafts, or wait for an authoritative read to reconcile them.
Native values such as Map and class instances remain scalar references; mutate a plain tree or replace the field.

A successful server snapshot supplies public values.
Client-only previews remain local and never enter the public request state.
A successful action without a state value keeps its local edit.
Committed operations remain ordered until other calls settle, so a later rejection can remove an earlier contribution.
A background realtime snapshot can update the confirmed base while a preview remains visible.
If a later user edit survives settlement, a duplicate snapshot of that call's confirmed value preserves the edit.
A changed snapshot or explicit RPC read restores server authority.
Reconnect and resync clear duplicate history, then apply authoritative public snapshots.
Duplicate history is a value comparison, not a server revision or an ordering guarantee for different late snapshots.
Use ClientState or ClientStore for drafts that must survive later authoritative snapshots.

## Handle an uncertain result

A validation or authorization rejection confirms that the guarded mutation was denied.
A network failure, deadline, cancellation, or lost socket may happen after the server changed data.
Restoring a preview does not prove that the server rolled back its mutation.

| Outcome | Client behavior |
| --- | --- |
| Confirmed rejection | Remove that call's preview and expose the structured error |
| `COSSACK_RPC_NETWORK_FAILED` | Settle the call; the server result is unknown |
| `COSSACK_RPC_TRANSPORT_CLOSED` | Settle socket calls; reconnect does not replay them |
| `COSSACK_RPC_TIMEOUT` | Settle once and stop waiting; the server result is unknown |
| `COSSACK_RPC_CANCELLED` | Release client ownership; application I/O may still finish |

Do not retry an uncertain mutation automatically.
When the connection is available, obtain an authoritative read.
For a server resource, refresh its declared field with `refresh$`.
For a persisted record, call an application-owned read action that reads the record again.
WebSocket reconnect and SSE recovery can also deliver authoritative public snapshots.
Read [Realtime Recovery](./websockets.md) and [Server Resources](./server-functions.md) for those mechanisms.

The current implementation does not provide a universal HTTP read action or an automatic record refetch for every uncertain mutation.
An application must choose the authoritative read for its data.
