# State Isolations

Each component in a page manages its state independently. The framework
synchronizes this state with the server. A component keeps its own server-side
state, and the page does not need to hold that state.

## State Structure

The initial state structure includes nested component states under the `_children` property:

```typescript
interface InitialState {
  // Page-level state
  count: number;
  user: any;

  // Nested component states
  _children: {
    "root:0": {
      count: number;
      // ... component state
    },
    "root:1": {
      // ... another component's state
    }
  };
}
```

## Component ID Generation

Each component instance receives a unique ID based on its position in the render tree:

- Page component: `"root"`
- First nested component: `"root:0"`
- Second nested component: `"root:1"`
- Deeply nested: `"root:0:0"`, and so on.

## Server Action Flow

When a nested component's `@Server` method is called:

1. Client to server: the client dispatches the action with the component's ID (`target`) and current state.
2. Server processing: the framework rebuilds the component tree and finds the target component.
3. State restoration: the target component's state is restored from the request payload.
4. Action execution: the `@Server` method runs with the restored state.
5. Response to client: the updated state is returned and applied to the component.

## Example: Independent Counters

```typescript
// src/components/Counter.ts
@Component()
export class Counter extends Cossack {
    @State() count = 0;

    increment() {
        this.count++;
    }

    render() {
        return html`
            <button @click="${this.increment}">
                Count: ${this.count}
            </button>
        `;
    }
}

// src/pages/index.ts
@Page()
export class Dashboard extends Cossack {
    render() {
        return html`
            <div>
                <h1>Dashboard</h1>
                ${component(Counter)}
                ${component(Counter)}
                ${component(Counter)}
            </div>
        `;
    }
}
```

Each counter maintains independent state:
- First click on counter 1: Sends `{count: 0}`, receives `{count: 1}`
- First click on counter 2: Sends `{count: 0}`, receives `{count: 1}`
- Second click on counter 1: Sends `{count: 1}`, receives `{count: 2}`

## State Persistence

The framework handles nested component state automatically:

- It serializes the state during SSR and includes it in `window.__INITIAL_STATE__`.
- It restores the state on client hydration.
- It synchronizes the state after each `@Server` action.
