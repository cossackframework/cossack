# Plan - No WebSockets
Cossack's core architecture is built around real-time, stateful components using WebSockets. However, some applications may not require this level of interactivity and can benefit from a simpler, stateless approach. This document outlines a plan to support such use cases by leveraging traditional HTTP requests and server-side rendering.

## Goals
- Provide a way to build Cossack components that do not rely on WebSockets.
- Ensure that these components can still benefit from Cossack's state management and server-side rendering
- Maintain a clear separation between WebSocket-based and non-WebSocket-based components.

## Proposed Changes
May be refer to @docs/plan-transport-layer.md, for transport layer abstraction. We'll use REST over HTTP for non-WebSocket components.

By default, components will use `durable-object` (a special kind of WebSockets) for real-time communication. To create a non-WebSocket component, developers can specify a `transport` option in the `@Page` decorator.

Here is an example of a simple counter component that does not use WebSockets:

```typescript
import { Page, Server, State } from '@cossackframework/core';

@Page({
    transport: 'http' // New option to specify no WebSockets, default transport is now `durable-object`
})
export class Counter extends Cossack {
    // Init method still runs on the server during the initial page load
    // same as before
    // It's equivalent to others frameworks' getServerSideProps, loader, etc.
    // and equivalent to GET request
    init() {
        this.count = 0; // Initialize state in the init method
    }

    @State() // Uses the default 'global' channel
    private count: number = 0;

    @Server()
    private increment() {
        // This one line is enough to trigger a UI update for all clients.
        this.count++;
    }

    protected template() {
        return html`
            <p>Count: ${this.count}</p>
            <button @click=${this.increment}>Increment</button>
        `;
    }
}
```

As you can see, the component structure remains largely unchanged. The key difference is the `transport: 'http'` option in the `@Page` decorator, which indicates that this component should not use WebSockets.

How it works:
1. The initial page load still triggers the `init()` method on the server, allowing the component to set up its initial state.
2. When the user clicks the "Increment" button, the `@Server` method `increment()` is called via a standard HTTP POST request.
3. The server processes the request, updates the state, and returns the new state to the client.
4. The client receives the updated state and re-renders the component.

### State Management
State management will work similarly to the WebSocket-based approach, but without real-time updates. When a `@Server` method modifies a `@State` property, the server will send the updated state back to the client as part of the HTTP response. The client will then re-render the component with the new state.

### Limitations
- No real-time updates: Since this approach does not use WebSockets, components will not receive real-time updates. State changes will only be reflected after a user action that triggers a server request.
- No update to other clients: State changes will not be broadcast to other clients viewing the same component. Each client will only see updates resulting from their own actions. Other clients will need to refresh the page to see the latest state. As it is. And this is a good thing for many use cases, as it simplifies the architecture and reduces server load.

### Where is the GET and POST request handlers?
- GET request is equal to `init()` method
- POST request is equal to `@Server` method, any method decorated with `@Server` is callable from the client, and it will be called via POST request.