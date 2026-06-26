---
title: "Optimistic UI Updates (Instant Feedback)"
description: "Instant UI updates using the @Optimistic decorator that runs on the client before the server processes the request."
---

# Optimistic UI Updates (Instant Feedback)

For interactions where latency matters (like "liking" a post or incrementing a counter), you can use the `@Optimistic` decorator to update the UI *instantly* on the client, before the server has even processed the request.

**How it works:**
1.  You define a method that updates local state.
2.  You decorate it with `@Optimistic('serverActionName')`.
3.  When the client calls `this.serverActionName()`, the framework *immediately* runs the optimistic handler.
4.  The request is sent to the server.
5.  The framework automatically detects which `@State` properties the optimistic handler modifies and **buffers** incoming server state updates for those properties while the action is pending.
6.  When the action completes, the buffered server state is applied — no UI flapping.

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

The simple pattern above is automatically stable even under rapid clicks — no extra boilerplate needed. The framework detects that `count` is modified by the optimistic handler and buffers the server's `count` updates until the entire chain of pending actions completes.

## How Auto-Stable Works

When you write an optimistic handler that modifies `@State` properties directly:

1. **Auto-detect**: Before running the optimistic handler, the framework snapshots all `@State` values. After the handler runs, it diffs to find which keys changed.
2. **Buffer**: While the action is pending, any server state updates for those locked keys are buffered instead of applied immediately.
3. **Apply**: When the action chain completes (all pending requests for that action finish), the final buffered server state is applied in one step.

This means rapid clicks produce a smooth progression: `0 → 1 → 2 → 3 → 4 → 5` instead of flapping like `0 → 1 → 2 → 1 → 2 → 3 → 2 → 3`.

## Advanced: Separate Optimistic State

In some cases you may want full manual control over the optimistic display — for example, showing a different value while pending than what the server will return. In that case, use `@ClientState` for the display value and a `@Computed` property:

```typescript
@Page({ transport: 'durable-object' })
export class OptimisticCounter extends Cossack {
    @State() count = 0;           // True server state
    @ClientState() optCount = 0;  // Local optimistic state

    @Computed()
    get displayCount() {
        return (this.loading['increment'] > 0) ? this.optCount : this.count;
    }

    @Server()
    async increment() {
        await new Promise(r => setTimeout(r, 500));
        this.count++;
    }

    @Optimistic('increment')
    applyOptimistic() {
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
