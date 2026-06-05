# Optimistic UI Updates (Instant Feedback)

For interactions where latency matters (like "liking" a post or incrementing a counter), you can use the `@Optimistic` decorator to update the UI *instantly* on the client, before the server has even processed the request.

**How it works:**
1.  You define a method that updates local state.
2.  You decorate it with `@Optimistic('serverActionName')`.
3.  When the client calls `this.serverActionName()`, the framework *immediately* runs the optimistic handler.
4.  The request is sent to the server.
5.  If the server responds with a state update (Scenario 1), the "true" server state overwrites your optimistic guess.
6.  If the server throws an error (Scenario 2), the state remains (for now) unless you handle the rollback or re-fetch manually.

**Example:**

```typescript
import { Page, Server, State, Optimistic } from '@cossackframework/core';

@Page({ transport: 'durable-object' })
class Counter extends Cossack {
    @State() count = 0;

    @Server()
    async increment() {
        // Simulate slow network/DB
        await new Promise(r => setTimeout(r, 500));
        this.count++;
    }

    // This runs immediately on the client when this.increment() is called
    @Optimistic('increment') 
    applyOptimisticIncrement() {
        this.count++; 
    }
}
```

## Advanced: Stable Optimistic UI Pattern

When users perform actions rapidly (e.g., clicking a button multiple times), naive optimistic updates can cause "flapping" in the UI. This happens because the server processes requests sequentially, sending state updates in between your local optimistic changes.

**The Problem (Flapping):**
1. User clicks twice. Local count: 0 -> 1 -> 2.
2. Server processes 1st click. Returns count: 1. UI resets to 1.
3. Server processes 2nd click. Returns count: 2. UI jumps to 2.
   Result: 0 -> 1 -> 2 -> 1 -> 2.

**The Solution:**
Use `this.loading[methodName]` (which is a counter of pending requests) combined with a separate `@ClientState` for the optimistic value and a `@Computed` property for the display value.

```typescript
@Page({ transport: 'durable-object' })
export class OptimisticCounter extends Cossack {
    @State() count = 0;           // True server state
    @ClientState() optCount = 0;  // Local optimistic state

    @Computed()
    get displayCount() {
        // If we have pending requests, show our local guess.
        // Otherwise, show the authoritative server state.
        return (this.loading['increment'] > 0) ? this.optCount : this.count;
    }

    async increment() {
        await new Promise(r => setTimeout(r, 500));
        this.count++;
    }

    @Optimistic('increment')
    applyOptimistic() {
        // If starting a new chain of requests, sync with server state first
        if (!this.loading['increment']) {
            this.optCount = this.count;
        }
        this.optCount++;
    }

    render() {
        return html`Count: ${this.displayCount}`;
    }
}
```
