# State and Action Management

One of the core goals of the Cossack Framework is to eliminate the complexity of client-server communication. In a traditional web application, you would need to write API endpoints, fetch data on the client, manage loading states, and handle RPC calls manually. Cossack streamlines this into a single, unified model where methods can be called across the client-server boundary as if they were local.

This is achieved through a WebSocket-based proxy system powered by decorators.

---

## Calling the Server from the Client

Any method in your component decorated with `@Server` will only ever run on the server. On the client, this method is replaced by a proxy that automatically sends a WebSocket message to the server to execute the real implementation.

This is ideal for database operations, authentication checks, or any logic that requires a secure server environment.

### Example: Deleting a Task

Let's look at the `Tasks` component. We have a client-side confirmation dialog that, when approved, calls a server-side method to delete a task.

```typescript
// src/pages/tasks/index.ts

import { Client, Page, Server, State } from '@/shared/decorators';

// ...

@Page({
    channels: ['tasks'],
})
export class Tasks extends Cossack {
    @State({ channel: 'tasks' })
    private tasks: Task[] = [];

    /**
     * This method ONLY runs on the server.
     * It's decorated with @Server, so the framework ensures its code
     * is never included in the client bundle.
     */
    @Server({ channel: 'tasks' })
    private async deleteTask(user: any, taskId: number) {
        console.log(`[Server] Deleting task ${taskId}...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate DB latency
        this.tasks = this.tasks.filter(task => task.id !== taskId);
        
        // After deleting, we can seamlessly call a client method
        this.showAlert('Task was deleted successfully!');
    }

    /**
     * This is a client-side method. It can freely call the `deleteTask`
     * server method. The framework handles the WebSocket communication
     * automatically.
     */
    private confirmDelete = (taskId: number) => {
        if (window.confirm('Are you sure?')) {
            // This looks like a normal method call, but it's actually an RPC call!
            this.deleteTask({ id: 'user-from-client' }, taskId);
        }
    }

    // ... template and other methods
}
```

When `this.deleteTask()` is called from `confirmDelete`, the client-side proxy intercepts it and sends a message like this over the WebSocket:

```json
{
  "type": "action",
  "action": "deleteTask",
  "payload": [{ "id": "user-from-client" }, 1]
}
```

The Durable Object receives this, executes the real `deleteTask` method, and the UI updates automatically.

---

## Calling the Client from the Server

The reverse is also true. Any method decorated with `@Client` can be called from the server. On the server, this method is replaced by a proxy that sends a WebSocket message to the client, instructing it to execute the real implementation.

This is perfect for triggering client-side effects like showing notifications, alerts, or triggering browser-specific APIs after a server action completes.

### Example: Showing a Confirmation Alert

Continuing with the `deleteTask` example, once the task is deleted on the server, we want to show an alert to the user.

```typescript
// src/pages/tasks/index.ts

// ...

export class Tasks extends Cossack {
    // ... deleteTask method from above

    /**
     * This method ONLY runs on the client.
     * It's decorated with @Client, so on the server, it becomes a proxy.
     */
    @Client({ channel: 'tasks' })
    private showAlert(message: string) {
        alert(message);
    }

    // ...
}
```

Inside `deleteTask`, the line `this.showAlert('Task was deleted successfully!')` is intercepted by the server-side proxy. It sends a message like this back to the client over the WebSocket:

```json
{
  "type": "client-action",
  "action": "showAlert",
  "payload": ["Task was deleted successfully!"]
}
```

The client's WebSocket handler receives this, validates that `showAlert` is a registered `@Client` method, and executes it, causing the alert to appear.
