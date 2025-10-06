# Architectural Plan: Pluggable Transport Layer

This document outlines the architectural plan for abstracting the framework's transport layer. The goal is to evolve Cossack from being tightly coupled to Cloudflare Durable Objects into a more flexible framework that can run on various backends, such as a standard Node.js server, while maintaining the same component-level API.

## 1. Core Problem: Tight Coupling

Currently, the framework's server-side logic is fundamentally tied to the Cloudflare ecosystem in two key areas:

1.  **The Server-Side Runtime:** The `CossackDurableObject` class is the concrete implementation of the server. It directly uses Cloudflare-specific APIs like `DurableObjectState`, `state.getWebSockets()`, and the Hibernatable WebSockets API.
2.  **The Connection Logic:** The `StateProvider`'s `getDurableObjectId()` method is designed to locate a specific Durable Object, making the connection logic specific to Cloudflare.

## 2. Proposed Architecture: The `CossackServerRuntime` Abstraction

To solve this, we will introduce a new core abstraction, the `CossackServerRuntime`. This will be an interface that defines a contract for any server environment that can host a Cossack component. This decouples the `Cossack` base class from the specifics of *how* messages are received or broadcasted.

The implementation will follow four main steps.

---

### Step 1: Define the `CossackServerRuntime` Interface

A new interface will be created in `@cossackframework/core` that defines the essential capabilities the framework needs from its server environment.

```typescript
// A new abstraction in @cossackframework/core
export interface CossackServerRuntime {
    // Method to handle an incoming message from a specific client
    onClientMessage(client: unknown, message: string): Promise<void>;

    // Method to broadcast a partial state update to all connected clients
    broadcastState(partialState: Record<string, any>): void;

    // Method to broadcast a named event to all connected clients
    broadcastEvent(eventName: string, payload: any[]): void;

    // Method to send a targeted action back to a single, specific client
    sendClientAction(client: unknown, action: string, payload: any[]): void;
}
```
*Note: The `client: unknown` type is intentionally generic to represent a client connection, which could be a WebSocket object, a user session ID, etc., depending on the transport.*

---

### Step 2: Refactor the Core `Cossack` Class

The `Cossack` base class will be modified to use the new runtime abstraction.

-   The internal property `_cossack_DO_instance` will be replaced with a generic `_runtime: CossackServerRuntime`.
-   All broadcasting and client-action calls will be delegated to the runtime. For example:
    -   `this._cossack_DO_instance?.broadcast(...)` becomes `this._runtime.broadcastState(...)`.
    -   `this._cossack_DO_instance?.broadcastEvent(...)` becomes `this._runtime.broadcastEvent(...)`.
    -   `this._cossack_DO_instance?.sendClientAction(...)` becomes `this._runtime.sendClientAction(...)`.

---

### Step 3: Create Concrete Runtime Implementations

This is where we will build the specific transport options.

#### a) The Cloudflare Durable Object Runtime (Default)

The logic from the current `CossackDurableObject` will be refactored into the first implementation of the new interface.

```typescript
// The new runtime, containing most of the old DO logic
class DurableObjectRuntime implements CossackServerRuntime {
    private component: Cossack;
    private state: DurableObjectState; // Cloudflare-specific API

    constructor(component: Cossack, durableObjectState: DurableObjectState) {
        this.component = component;
        this.state = durableObjectState;
        (this.component as any)._runtime = this; // Inject runtime into component
    }

    // Implement all interface methods using this.state.getWebSockets()
    broadcastState(partialState: Record<string, any>) {
        const message = JSON.stringify({ type: 'state-update', state: partialState });
        for (const ws of this.state.getWebSockets()) {
            ws.send(message);
        }
    }
    // ... other methods
}

// The AppDurableObject in the `framework` package becomes a thin wrapper
export class AppDurableObject extends CossackDurableObject {
    private runtime?: DurableObjectRuntime;

    constructor(state: DurableObjectState, env: any) {
        // On first connection, create the component and the runtime
        const myComponent = new MyPageComponent(); // Component logic
        this.runtime = new DurableObjectRuntime(myComponent, state);
    }

    // Delegate all WebSocket and fetch events to the runtime instance
    async fetch(request: Request) { /* ... delegate ... */ }
    async webSocketMessage(ws: WebSocket, message: string) { /* ... delegate ... */ }
}
```

#### b) A Node.js WebSocket Runtime (Future)

A new package (e.g., `@cossackframework/node-adapter`) would provide a runtime for a standard Node.js server using a library like `ws`.

```typescript
// In @cossackframework/node-adapter
import { WebSocketServer, WebSocket } from 'ws';

class NodeWebSocketRuntime implements CossackServerRuntime {
    private component: Cossack;
    private clients: Set<WebSocket> = new Set();

    constructor(component: Cossack) {
        this.component = component;
        (this.component as any)._runtime = this;
    }

    // Called by the server when a new client connects
    addClient(ws: WebSocket) {
        this.clients.add(ws);
        ws.on('message', (data) => this.onClientMessage(ws, data.toString()));
    }

    // Implement broadcast using the set of clients
    broadcastState(partialState: Record<string, any>) {
        const message = JSON.stringify({ type: 'state-update', state: partialState });
        for (const client of this.clients) {
            client.send(message);
        }
    }
    // ... other methods
}
```

---

### Step 4: Generalize the `StateProvider`

The `StateProvider`'s method signature needs to be made transport-agnostic.

-   The method `getDurableObjectId(): DurableObjectId` will be renamed to `getConnectionTarget(): unknown`.
-   The return value will be interpreted by the specific application host:
    -   In a Cloudflare Worker, the host will expect a `DurableObjectId`.
    -   In a Node.js server, the host might expect a URL path or a "room name" that the server uses to map requests to the correct `NodeWebSocketRuntime` instance.

## 3. Conclusion & Benefits

This architectural change is a significant but necessary step for the framework's long-term health. It will provide several key advantages:

-   **Flexibility:** Developers will be able to run Cossack applications on Cloudflare, in a standard Node.js environment, or anywhere else a runtime can be implemented.
-   **Testability:** Decoupling the component logic from the transport makes it vastly easier to test components in isolation by mocking the `CossackServerRuntime` interface.
-   **Future-Proofing:** The framework will be able to adopt new transport technologies (like WebTransport) simply by creating a new runtime implementation, without needing to change the core component model.
