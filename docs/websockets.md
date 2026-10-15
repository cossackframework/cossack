---
title: "States with Websockets"
description: "Real-time state management over WebSockets with the Durable Object transport."
---

# States with Websockets

Cossack syncs state over transports other than HTTP. With the WebSocket transport, connected clients receive state updates in real time.

Cossack unifies client and server state management. For real-time applications it supports two patterns: automatic state synchronization and event-driven re-fetch.

Both patterns belong to the real-time transport. They require a component decorated with `@Page({ transport: 'durable-object' })`.

## Calling actions over WebSockets

`@Server()` methods on WebSocket-transport components are request-scoped RPC
calls, not fire-and-forget messages. Every call dispatches one action frame
with a unique request id and follows the same contract as HTTP/SSE:

- `await this.myAction(...)` resolves the method's return value. Generator
  methods stream their yields through `for await`.
- Failures reject with `RpcError` (`code`, `requestId`). Client-visible errors
  keep their message (`COSSACK_RPC_CLIENT_ERROR`). Internal errors are redacted
  (`COSSACK_RPC_INTERNAL_ERROR`). Forbidden actions answer
  `COSSACK_RPC_FORBIDDEN`.
- `call.cancel()` sends a cancel frame, closes the generator server-side, and
  rejects with `COSSACK_RPC_CANCELLED`. Consuming the same call twice never
  dispatches a second mutation.
- `@Server({ timeout: ms })` adds a deadline. Exceeding it rejects with
  `COSSACK_RPC_TIMEOUT`. The server outcome stays unknown and is never
  retried automatically. `ms` must be an integer from 1 through 2,147,483,647.
- If the socket closes mid-call, the call rejects with
  `COSSACK_RPC_TRANSPORT_CLOSED` (uncertain outcome). The transport reconnects
  automatically with bounded exponential backoff (0.5 s doubling to 30 s) and
  resets after a successful open.

### Connection status

Each page has one WebSocket connection, to its real-time instance. Child
components use the page's connection. Connection health is exposed on every
component as `this.realtime`:

```typescript
render() {
    const status = this.realtime.websocket;
    return html`<span class=${status.state}>${status.state}</span>`; // connecting | open | reconnecting | closed
}
```

The status tracks `state`, `attempts` (reconnects since the last open),
`lastEventId`, `lastError`, and `resynced`. SSE pages expose the same fields on
`this.realtime.sse`. `resynced` becomes true when a reconnect had to replace
expired history with an authoritative snapshot.

Retiring a component or replacing its connection sets the old status to
`closed`, clears heartbeat/reconnect timers and rejects pending socket calls
with `COSSACK_RPC_TRANSPORT_CLOSED`. Queued callbacks from an old socket cannot
publish state, invoke actions/events or change its replacement's status. Destroyed
components cannot open new sockets. Closing an old socket never schedules a
second reconnect or replays a mutation.

## Application component registry and lost replies

The default AppDurableObject resolves pages and layouts through the compiler's
application registry. Its keys match the router's source paths, including route
groups and dynamic segments. Modules need a default Cossack component export.
Named helpers and native HTTP handler modules do not become socket targets.
The framework does not scan its bundled example pages for application targets.

A socket can close after the server commits a write but before its reply arrives.
The client removes that call's preview and releases its loading count once.
The error remains `COSSACK_RPC_TRANSPORT_CLOSED`, and reconnect does not retry the mutation.
Stateful connections receive persisted public state when the new socket opens.
ClientState and ClientStore drafts remain local.
Use a declared resource read when public component state does not describe the persisted record.
Read [optimistic recovery](./optimistic.md#handle-an-uncertain-result) for that contract.

Socket actions on one component execute in a queue.
Two pending browser calls do not mean that both server writes started.
Closing a socket cancels registered queued work before invocation.
An already committed write remains committed.
Stream failure or cancellation after a yield also cannot establish rollback of a prior write.
Keep application reads and write consistency explicit. See [SSE snapshot ordering](./sse.md#optimistic-confirmation-and-snapshot-order).

## Action identity and request context

Actions use the verified identity and request context of their originating
socket. Another connection sharing a component cannot replace that context.
`this.user`, `this.c.get('user')`, and custom rate keys use the same peer.
Client-supplied message identity is ignored. Anonymous Cloudflare sockets have
no synthetic user and their default rate key uses captured IP headers.

Cloudflare keeps the upgrade URL, page route params and selected headers in
native socket attachments. Each action reconstructs its own context, retaining
query/header access through generator completion and component restoration.
Cookie/Authorization, common credential headers and internal auth assertions
are excluded. Custom headers and query values are retained. They are not a
place for credentials. A snapshot is not the full original HTTP middleware
scope. Arbitrary middleware variables, request bodies, response cookies and
session revalidation are not reconstructed. The identity is a handshake snapshot.

Oversized metadata returns `COSSACK_WS_CONTEXT_TOO_LARGE` with status 413 before
accepting the socket. Malformed identity assertions return
`COSSACK_WS_CONTEXT_INVALID` (400). Connections without request metadata reject
actions and close with code 1012 to reconnect.
The Node adapter passes each connection's upgrade context into its shared
runtime. The framework includes decoded page route params. See
[rate limiting](./rate-limiting.md) for counter-store guarantees.

On Node, a `durable-object` page uses the same instance identity as on
Cloudflare: one in-memory instance per page plus route params, or one per scope
key when the page sets `scope`. Users who open `/room/1` share one instance on
both runtimes. Node instances live in one process, so they are not shared across
machines and do not survive a restart.

## Stateless vs Stateful Durable Objects

By default, `transport: 'durable-object'` creates a stateless DO that acts as a WebSocket hub only. State lives in memory during the session. The framework does not persist it to DO storage. This fits applications that use a database (D1, R2) as the source of truth.

To persist state in DO storage (survives reconnections and DO eviction), add `stateful: true`:

```typescript
// Stateless (default) — recommended for DB-backed apps
@Page({ transport: 'durable-object' })

// Stateful — state persists in DO storage
@Page({ transport: 'durable-object', stateful: true })
```

### When to use `stateful: true`
- In-memory state that needs to persist across connections (for example, counters or shared whiteboards)
- No external database: the DO itself is the source of truth
- State must survive DO eviction and reactivation

## Scope : controlling which Durable Object instance a page connects to

By default, each page instance gets its own Durable Object instance: the page component plus its route params. The host and query string are not part of the identity, so `/room/1?utm=x` and `/room/1` share one instance, and `/room/2` gets another. The WebSocket proxy recomputes this id from the route and params it receives and rejects a connection that names a different Durable Object. The `scope` option on `@Page` overrides this. It receives the Hono `Context` and returns a scope-key string, which becomes the Durable Object ID name. Users (and tabs) that resolve to the same scope key land on the same DO instance and share state. This is the mechanism behind multiplayer features (shared whiteboards, chat rooms, collaborative docs).

```typescript
// All members of a team share one DO instance for this page
@Page({
    transport: 'durable-object',
    stateful: true,
    scope: (c) => `team:${c.get('user').teamId}`,
})

// One DO instance per room (URL param)
@Page({
    transport: 'durable-object',
    stateful: true,
    scope: (c) => `room:${c.req.param('roomId')}`,
})
```

The framework evaluates the scope function more than once. SSR evaluates it to
name the instance in the page's initial state. The WebSocket upgrade evaluates
it again with the live request, and each action checks it again.
These later requests have the page's route params (`c.req.param()`) and the
authenticated user, but not the page URL or its query string, because their own
URL is `/ws/...`. Write scope functions that depend only on route params and
the user. When the key computed for the upgrade differs from the key in the
initial state, the proxy rejects the connection.

The same `scope` option also applies to the `sse` transport, where the default
is one scope per user instead of one per page instance. Each SSE subscription
and each SSE `/crpc` action evaluates the scope again in the same way. Without
`scope`, the default per-page-instance behavior is unchanged.

A Durable Object or Node instance hosts one page. Two different pages cannot
share an instance, even when their scope functions return the same key: on
Cloudflare the second page's connection is rejected with
`COSSACK_WS_SCOPE_MISMATCH`, and on Node each page gets its own instance.

## Share real-time state across pages with scope

`scope` selects the real-time instance that a page connects to. The server
computes the scope key from the request: the signed-in user and the page's
route params. The browser receives the computed target in the page's initial
state and opens one connection to `/ws/:id`. It cannot choose another
instance. The server computes the key again for the upgrade and checks it again
before each action. It rejects a connection whose target differs from the key.

Every URL of a page, and every tab or device, that computes the same key shares
one instance. An instance hosts one page file. Two different page files never
share an instance, even when their keys are equal (see [scope](#scope--controlling-which-durable-object-instance-a-page-connects-to)).

### Per-user state across pages

```typescript
// src/pages/inbox/[folder]/index.ts
import { Cossack, Page, Server, State } from '@cossackframework/core';
import { ResourceAuthorizationError } from '@cossackframework/auth';
import { html } from '@cossackframework/renderer';
import type { Context } from 'hono';
import { guard } from '../../../authorization';

// One instance per signed-in user. Never fall back to a shared key.
const perUser = (c: Context) => {
    const user = c.get('user');
    if (!user) throw new ResourceAuthorizationError('COSSACK_AUTH_UNAUTHENTICATED');
    return `user:${user.id}`;
};

@Page({
    transport: 'durable-object',
    middlewares: [guard.requireUser],
    scope: perUser,
})
export default class Inbox extends Cossack {
    @State() unread = 0;

    @Server()
    markAllRead() {
        this.unread = 0;
    }

    render() {
        return html`
            <p>${this.unread} unread</p>
            <button @click=${this.markAllRead}>Mark all read</button>
        `;
    }
}
```

For Alice, `/inbox/work` and `/inbox/home` compute the key `user:alice`. Both
URLs, in every tab, share one instance and one `unread` value. Bob computes
`user:bob` and gets his own instance. A connection from Bob that names Alice's
target is rejected.

The scope fails closed for anonymous users in two places:

- `guard.requireUser` (see [authorization](./authorization.md)) rejects the
  page request, the WebSocket upgrade and each action without a user.
- The scope function throws instead of returning a shared key such as
  `user:undefined`. `ResourceAuthorizationError` answers 401. Any other error
  answers 500. Neither error opens a connection.

### Per-team or per-room state

```typescript
// Every member of a team shares one instance.
@Page({
    transport: 'durable-object',
    stateful: true,
    middlewares: [guard.requireUser],
    scope: (c) => `team:${c.get('user').teamId}`,
})

// src/pages/rooms/[roomId]/index.ts: one instance per room.
@Page({
    transport: 'durable-object',
    stateful: true,
    middlewares: [requireRoomMember],
    scope: (c) => `room:${c.req.param('roomId')}`,
})
```

A scope key names an instance. It does not give access to it. A route param
such as `roomId` is client input. Check membership in page middleware, such as
`requireRoomMember` above. The server runs page middleware for the page
request, for the upgrade and again before each action. Check access to records
in each `@Server` method too.

### Route params and scope

- Without `scope`, the page's route params are part of the identity. `/room/1`
  and `/room/2` get different instances. `/room/1?tab=chat` uses the instance
  of `/room/1`.
- With `scope`, only the values that the function reads count. `perUser` above
  does not read `folder`, so all folders share one instance per user. To get
  one instance per user and folder, put the param in the key:
  `` (c) => `${perUser(c)}:folder:${c.req.param('folder')}` ``.
- The function gets the route params and the user for the page request, for
  the upgrade and for each action. It does not get the page's query string
  after the page request, because the upgrade has its own URL (`/ws/...`). Do
  not read `c.req.query()` in a scope function. If the keys differ, the server
  rejects the connection.

### Page-scoped and user-scoped state on one screen

A page has one real-time connection to one instance. Child components that you
render with `component()` run in the page's instance and use the page's
connection. A child component has no connection of its own, so it cannot have
its own scope: `scope` on a child component has no effect.

To combine page-scoped and user-scoped state on one screen:

- Put the state that everyone on the page shares in the page's `@State`. The
  page's scope selects who shares it.
- Keep one user's data out of `@State` in a shared instance, because every
  connected user receives `@State`. Return the data from a `@Server` method
  instead. The method runs with the identity of its caller. Keep the result in
  `@ClientState`.
- For per-user state that must stay live in all of the user's tabs, use a page
  with `scope: perUser`, like `Inbox` above. One screen cannot connect to a
  room's instance and to a user's instance at the same time.

```typescript
// src/components/MyDrafts.ts: a child of the room page.
@Component({ transport: 'durable-object' })
export class MyDrafts extends Cossack {
    @ClientState() drafts: Draft[] = [];

    @Server()
    async load() {
        // Runs in the room's instance, with the caller's identity.
        return listDrafts(this.user!.id);
    }

    @Client()
    async open() {
        this.drafts = await this.load();
    }

    render() {
        return html`
            <button @click=${this.open}>My drafts</button>
            ${this.drafts.map(draft => html`<p>${draft.title}</p>`)}
        `;
    }
}

// src/pages/rooms/[roomId]/index.ts: live messages for everyone in the room.
@Page({
    transport: 'durable-object',
    middlewares: [requireRoomMember],
    scope: (c) => `room:${c.req.param('roomId')}`,
})
export default class Room extends Cossack {
    @State() messages: Message[] = [];

    @Server()
    async send(text: string) {
        this.messages = [...this.messages, await saveMessage(this.user!.id, text)];
    }

    render() {
        return html`
            ${component(MyDrafts)}
            ${this.messages.map(message => html`<p>${message.text}</p>`)}
        `;
    }
}
```

`messages` is live for everyone in the room. Each user sees only their own
drafts, but the list does not update live when the user edits a draft on
another page. Call `load()` again, or use the
[event-driven re-fetch](#2-event-driven-re-fetch-the-liveview-way) pattern,
to refresh it.

### Migrate from custom providers

Custom state providers were removed: `StateProvider`, `PageStateProvider`,
`@Page({ providers })`, and the `provider` option of `@State`, `@Store` and
`@Server`. Move each provider to a component with a `scope` function. For
example, a `UserSessionProvider` becomes a page with `scope: perUser`.

Since the WebSocket proxy started to recompute every target on the server, it
rejected every custom provider target. Providers also returned Cloudflare-only
Durable Object ids, so they never worked on Node. Other changes:

- `@Page({ providers })` throws `COSSACK_PROVIDERS_REMOVED`.
- A component has one connection. `this.realtime.websocket` replaces
  `this.realtime.websockets[name]`.
- The WebSocket URL is `/ws/:id`. The server rejects `/ws/:provider/:id` with
  404 (`COSSACK_WS_ROUTE_NOT_FOUND`).
- The page's initial state carries `realtimeTarget` instead of
  `providerTargets`.

## Instances, channels, and events

This architecture has three parts: the instance, `Channel`, and `Event`.

- Instance (the where): the real-time instance that a page connects to: the page plus its route params, or its scope key. See [scope](#scope--controlling-which-durable-object-instance-a-page-connects-to).

- `Channel` (the what): A Channel is a logical partition within the page's connection. It groups related pieces of state. When an automatic update occurs, the framework sends a partial state object containing only the properties for the affected channel.

- `Event` (the when and how): An Event is a stateless message broadcast by the server. Components listen for these events to trigger actions, most notably the "Event-Driven Re-fetch" pattern.

---

## Two Core Patterns for Real-Time State

Cossack offers two primary patterns for managing real-time state. You can use either or both within the same component.

### 1. Automatic State Synchronization (The "Blazor" Way)

This is the most direct way to manage state. Use it for UI-specific state that is not persisted in a database and does not have complex security requirements.

How it works:
1. You decorate a property with `@State`.
2. You decorate a server-side method with `@Server`.
3. When the `@Server` method changes the value of the `@State` property, the framework detects the change automatically.
4. It then broadcasts a partial state update containing only the properties for the affected channel to all clients connected to that page.
5. The client-side component receives the update and re-renders automatically.

#### Example: A Simple Counter

```typescript
import { Cossack, Page, Server, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'durable-object' })
export class Counter extends Cossack {
    
    @State() // Uses the default 'global' channel
    private count: number = 0;

    @Server()
    private increment() {
        // This one line is enough to trigger a UI update for all clients.
        this.count++;
    }

    protected render() {
        return html`
            <p>Count: ${this.count}</p>
            <button @click=${this.increment}>Increment</button>
        `;
    }
}
```

In this example, `this.count++` is enough. The framework detects the change, serializes the new value, broadcasts it, and re-renders the component on all connected clients.

---

### 2. Event-Driven Re-fetch (The "Liveview" Way)

Use this pattern for any action that modifies a shared source of truth (like a database) or requires permission checks.

How it works:
1. A `@Server` method performs an action, such as writing to a database.
2. Instead of changing the component's state directly, it calls `this.broadcastEvent('event-name')`.
3. The server broadcasts this stateless event message to all connected clients.
4. A method on the component decorated with `@OnEvent('event-name')` is triggered on every client.
5. This handler calls `this.init()`, which re-runs the component's initial data-loading logic. This makes sure that each client re-fetches the data within its own permission context.

This pattern is secure by default and prevents race conditions or accidental data leaks.

#### Example: Deleting a Task

```typescript
import { Page, Server, State, OnEvent } from '@cossackframework/core';

@Page({ transport: 'durable-object' })
export class Tasks extends Cossack {
    @State()
    private tasks: Task[] = [];

    async init() {
        // In a real app, this would fetch tasks from a database,
        // applying user-specific permissions.
        // e.g., this.tasks = await db.getTasksForUser(this.user);
        if (this.tasks.length === 0) {
             this.tasks = [/* ... initial tasks ... */];
        }
    }

    private async deleteTask(taskId: number) {
        // 1. Modify the source of truth (the in-memory array here)
        this.tasks = this.tasks.filter(task => task.id !== taskId);
        
        // 2. Broadcast a simple event, NOT the new state
        this.broadcastEvent('tasks:changed');
    }

    // 3. The event handler triggers a re-fetch on all clients
    @OnEvent('tasks:changed')
    private async onTasksChanged() {
        await this.init();
    }

    //...
}
```

---

## Connections and Channels

Real-time communication in Cossack has two levels:

1. Connection: The framework opens one physical WebSocket connection for each page, to the page's instance. Child components use the page's connection.
2. Channel: A channel is a logical grouping of state within that connection. It lets the framework send partial state updates.

By default, all state and actions use the `global` channel.

```typescript
@Page({
    transport: 'durable-object'
})
export class LiveCounter extends Cossack {
    
    @State() // Uses the 'global' channel.
    private count: number = 0;

    private increment() {
        this.count++;
    }
    // ...
}
```

---

### Multi-Channel Components

Associate specific pieces of state and server-side actions with different channels. This controls which updates each channel carries.

#### 1. Channel-Specific State with `@State`

Use the `channel` property on the `@State` decorator to link a state variable to a specific channel. When this variable's value changes on the server, the automatic update contains only the state of properties in that channel.

```typescript
@Page({
    transport: 'durable-object',
    channels: ['feeds', 'notifications']
})
export class Dashboard extends Cossack {
    @State({ channel: 'feeds' })
    private feedCount: number = 0;

    @State({ channel: 'notifications' })
    private notificationCount: number = 0;
}
```

#### 2. Channel-Specific Actions with `@Server`

Similarly, use the `channel` property on the `@Server` decorator. This is primarily used for logical grouping. It has no effect on the connection: a page has one.

```typescript
@Server({ channel: 'feeds' })
private incrementFeed() {
    this.feedCount++;
}

@Server({ channel: 'notifications' })
private incrementNotifications() {
    this.notificationCount++;
}
```

---

### Complete Example

Here is how the concepts come together in a single component.

```typescript
import { Page, Server, State } from '@cossackframework/core';
import { Cossack } from '@cossackframework/core';
// ... other imports

@Page({
    transport: 'durable-object',
    channels: ['feeds', 'notifications'],
})
export class Greeting extends Cossack {
    // State for the 'feeds' channel
    @State({ channel: 'feeds' })
    private feedCount: number = 0;

    // State for the 'notifications' channel
    @State({ channel: 'notifications' })
    private notificationCount: number = 0;

    // State for the default 'global' channel
    @State()
    private name: string = 'World';

    // Action associated with the 'feeds' channel
    @Server({ channel: 'feeds' })
    private incrementFeed = async () => {
        this.feedCount++;
    };

    // Action associated with the 'notifications' channel
    @Server({ channel: 'notifications' })
    private incrementNotifications = async () => {
        this.notificationCount++;
    };

    protected render(): TemplateResult {
        return html`
            <div>
                <h1>Hello ${this.name}!</h1>
                <p>Feeds: ${this.feedCount}</p>
                <p>Notifications: ${this.notificationCount}</p>

                <button @click=${this.incrementFeed}>Increment Feeds</button>
                <button @click=${this.incrementNotifications}>Increment Notifications</button>
            </div>
        `;
    }
}
```

Behavior:
- The client opens one WebSocket connection to the page's instance.
- When "Increment Feeds" is clicked, `incrementFeed` is called on the server.
- The server automatically broadcasts a partial state update containing only `feedCount` to all clients connected to this page.
- The "Increment Notifications" button behaves identically but for the `notificationCount` state.
- If `this.name` changes, the partial update contains only the `name` property.

## Authentication on shared connections

The upgrade request runs the page and layout guards and requires an allowed
Origin. The Durable Object proxy discards client-supplied identity headers.
It forwards only the user from the authentication middleware.

Each serialized action exposes its caller through `this.user` and
`this.c.get('user')`, including an undefined user for a guest. Enforce resource
permissions in each server method. Revoke or disconnect existing connections
when your application changes permissions or ends a session.

WebSocket actions do not append the user as a positional argument. Use
`this.user` or `this.c.get('user')` for trusted identity. Treat every method
argument as client input. A longer payload can displace a positional user
argument, so that pattern cannot provide authentication.
