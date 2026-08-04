---
title: Introduction
description: Understand the Cossack adapter for Deno, Deno Deploy, and Deno Desktop.
---

# Introduction

`@cossackframework/deno-adapter` lets a Cossack application run as a Deno HTTP
service, on Deno Deploy, or inside a native Deno Desktop window. A Desktop
target can also accompany a Cloudflare Workers or Node.js web target. The
adapter is deliberately narrow: Cossack still owns route resolution,
middleware, authentication, origin validation, server-computed scope keys,
SSR, hydration, and application RPC.

The adapter supplies the runtime-specific pieces:

- `Deno.serve()` integration for local and production HTTP serving.
- Static delivery of the Vite client build.
- An `ASSETS.fetch()`-compatible environment binding.
- Hono's Deno static-file and WebSocket primitives.
- Bounded, idle-evicted, process-local component instances for WebSockets.
- Runtime metadata used by typed Deno Desktop bindings.

## One page tree, independent targets

The server entry and page tree remain shared:

```text
src/
├── App.ts
├── index.ts                 # selected web adapter
├── pages/
│   └── index.ts
└── desktop/
    └── index.ts             # local Deno Desktop server
```

Keep shared UI, state, and routes in `src/pages/`. Reserve `src/desktop/` for
the Deno Desktop entry and optional window/menu integration. Desktop does not
introduce a second router; it creates another runtime target over the same
route modules.

Desktop is an optional Deno side target, not the web adapter:

```sh
cossack create my-app --adapter cloudflare --features ui,desktop
```

For an existing Cloudflare, Node.js, or Deno project:

```sh
cossack add desktop
```

Switching the web adapter does not remove or rewrite the independent Desktop
target. `src/index.ts` continues to represent the selected web runtime while
`src/desktop/index.ts` always uses `createDenoAdapter()`.

## Runtime adapter contract

Pass the adapter to `createApp()` and route requests through its `fetch()`
method:

```ts
const runtime = createDenoAdapter({ env: Deno.env.toObject() });
const app = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: runtime,
});

export default {
  fetch: (request: Request, requestEnv?: Record<string, unknown>) =>
    runtime.fetch(app, request, requestEnv),
};
```

The optional `runtimeAdapter` contract may contribute client metadata and
perform a process-specific WebSocket upgrade. It does not receive authority to
choose routes, users, origins, or client-provided scope keys.

## Automatic local Desktop RPC

Use ordinary undecorated or `@Server()` methods for application behavior and
machine-local Desktop work. Cossack strips their bodies from the client and
automatically calls `/crpc` or WebSockets. In a Desktop window, that request is
handled by the packaged local Deno server, so native code can stay in the same
component class:

```ts
@State() count = 0;

async init() {
  if (this.isDesktop) {
    this.count = Number(localStorage.getItem('count') ?? 0);
  }
}

increment() {
  this.count += 1;
  if (this.isDesktop) localStorage.setItem('count', String(this.count));
}
```

Use `this.isDesktop` for the common condition or inspect
`this.runtime.platform` (`'web' | 'desktop'`) and `this.runtime.adapter`.

The low-level typed binding API remains available when a per-window operation
must bypass component RPC. It is an escape hatch, not the default application
model.

## Persistence and scaling

Deno WebSocket state lives only in the current process. The adapter limits the
number of component instances and evicts idle instances, but it does not provide
durable or cross-instance coordination. Consequently, the framework rejects
`stateful: true` with the Deno adapter.

Persist important state in a database supported by every target that executes
the relevant method. Deno Desktop can use SQLite, PostgreSQL, MySQL, or Turso
through `@cossackframework/database`. The current
embedded/Desktop Turso driver is `@tursodatabase/database`; do not add the
outdated libSQL client.

## Continue reading

- [Installation](./installation.md)
- [Deno web and Deno Deploy](./web.md)
- [Deno Desktop](./desktop.md)
