---
title: "Optimistic UI Updates (Instant Feedback)"
description: "Update the UI on the client before the server processes a request with @Optimistic."
---

# Optimistic UI Updates (Instant Feedback)

Use the `@Optimistic` decorator to update the UI before the server processes a request. For example, update a counter as soon as a user clicks a button.

When a client calls an action with an optimistic handler, Cossack:
1. Runs the handler on the client.
2. Sends the request to the server.
3. Finds the `@State` properties that the handler changed.
4. Holds server updates for those properties while the action runs.
5. Applies the server updates when the action completes.

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

The example handles rapid clicks without extra code. Cossack detects that the handler changed `count` and holds server updates until all pending actions finish.

## How Auto-Stable Works

When you write an optimistic handler that modifies `@State` properties directly:

1. **Auto-detect**: Before running the optimistic handler, the framework snapshots all `@State` values. After the handler runs, it diffs to find which keys changed.
2. **Buffer**: While the action is pending, any server state updates for those locked keys are buffered instead of applied immediately.
3. **Apply**: When the action chain completes (all pending requests for that action finish), the final buffered server state is applied in one step.

This means rapid clicks produce a smooth progression: `0 → 1 → 2 → 3 → 4 → 5` instead of flapping like `0 → 1 → 2 → 1 → 2 → 3 → 2 → 3`.

## Advanced: Separate Optimistic State

To show a temporary value that differs from the expected server value, use `@ClientState` for the display value and a `@Computed` property:

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
