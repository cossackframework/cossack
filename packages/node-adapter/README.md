# Cossack Framework Node Adapter

This package runs Cossack applications on Node.js. It handles HTTP requests,
WebSocket upgrades, and static files. It also provides runtime polyfills so
application code can work on Cloudflare Workers and Node.js.

## Installation
See the [Installation Guide](https://cossack.dev/docs/installation) to set up
Cossack and its packages.

## Exports

- `createNodeAdapter`: connects framework-guarded WebSocket upgrades to a Node server, shares process-local scope instances, and manages cleanup.
- `serveStatic`: Node `fs`-based Hono middleware for serving static assets. It streams files with `Content-Length`, a weak `ETag`, `Last-Modified` and `Accept-Ranges: bytes`. A matching `If-None-Match`, or an `If-Modified-Since` when no `If-None-Match` is sent, returns `304`. A single `Range` on GET returns `206` with `Content-Range`, or `416` when it starts past the end; several ranges return the whole file. `If-Range` accepts only an unchanged `Last-Modified` date. HEAD returns the GET headers without a body. `prefix` matches whole path segments (`/assets` does not match `/assets-x`).
- `createStaticAssets`: an `ASSETS`-style binding backed by `serveStatic`.
- `installNodeShutdown`: SIGTERM/SIGINT draining for a Node server and its runtime.
- `createNodeEmailSender`: Node.js polyfill for Cloudflare's `send_email` binding (`env.EMAIL`).
- `cossackNode` from `/vite`: standalone Vite HTTP development integration. See the lifecycle limits below.

## Unified `env.EMAIL` (Cloudflare email binding polyfill)

Cloudflare Workers expose `env.EMAIL.send({ to, from, subject, html, text })` when you declare a `send_email` binding in `wrangler.jsonc`. To keep the same call site working on Node.js, this package ships a nodemailer-backed sender with the identical shape.

### Cloudflare (`wrangler.jsonc`)
```jsonc
{
  "send_email": [{ "name": "EMAIL" }]
}
```
Then `await env.EMAIL.send({ to, from, subject, html, text })` works directly.

### Node.js
Build the sender from SMTP environment variables and inject it into `env`. Pass `env` to `app.fetch` for HTTP requests and WebSocket authorization:

```ts
import { serve } from '@hono/node-server';
import { createApp } from '@cossackframework/framework/router';
import {
  createNodeAdapter,
  createNodeEmailSender,
} from '@cossackframework/node-adapter';
import { App } from './App';
import { template } from './root';

const runtime = createNodeAdapter();
const app = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: runtime,
});

const env = {
  EMAIL: createNodeEmailSender({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    from: process.env.MAIL_FROM ?? 'no-reply@example.com',
  }),
};

// HTTP: pass env to app.fetch so `c.env` (and `this.env`) is populated.
const server = serve(
  { fetch: (req) => app.fetch(req, env), port: Number(process.env.PORT) || 3000 },
  (info) => console.log(`Listening on http://localhost:${info.port}`),
);

// Run upgrades through the same middleware, bindings, scope checks, and services.
runtime.attach(server, (request) => app.fetch(request, env));
```

### Environment variables
Configure through `.dev.vars` for Cloudflare development, or through your shell or an `.env` file for Node:

| Variable | Description | Default |
| -------------- | -------------------------------------------- | ------------------ |
| `SMTP_HOST` | SMTP server host (for example `smtp.gmail.com`) | : |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Use TLS (`"true"` for port 465) | `port === 465` |
| `SMTP_USER` | SMTP username | : |
| `SMTP_PASS` | SMTP password | : |
| `MAIL_FROM` | Default `from` address when omitted | `no-reply@example.com` |

Now `await this.env.EMAIL.send(...)` works identically in `@Server` methods on both Cloudflare Workers and Node.js.

## WebSocket lifetime

`runtime.attach(server, fetch)` handles `/ws/` upgrade requests. Other upgrade
paths are answered with `404` and closed when the adapter is the only `upgrade`
listener on the server; when another listener is attached they remain with the
host. Set `destroyUnmatchedUpgrades: true` or `false` to always or never reject them. Authentication, origin checks, route lookup,
and scope authorization run through the framework before the handshake. Response
cookies and application headers reach the handshake. Components for the same
page target (the page plus its route params, or its scope key) share one
initialization and process-local state.

`maxInstances` defaults to 512 and includes pending initialization.
`idleTimeoutMs` defaults to 15 minutes. Pruning runs on socket activity.
`maxPayload` caps one WebSocket message at 1 MiB by default. A larger message
closes the socket with code 1009 before the server parses it. Raise it only for
components that need bigger RPC payloads.
Call `await runtime.dispose()` before closing an embedded server. It detaches
upgrade listeners, ends sockets, waits for pending initialization and active
actions, and destroys components/services. Repeated calls share the same result.
A native server `close` event also triggers disposal. Actions must settle for
cleanup to finish. Disposed adapters cannot be attached again.

The request scheme follows the actual Node socket (HTTP or TLS). The adapter does
not trust forwarded scheme headers. Configure an origin policy for a trusted proxy
in the application. Generated production and development entries attach the adapter automatically.
The dev server disposes the previous runtime on source reload while Vite retains
its HMR connection. Clients reconnect to a fresh process-local scope.

## Vite development HTTP server

Generated Node Vite configurations include the separate tooling entry:

```ts
import { cossackNode } from '@cossackframework/node-adapter/vite';

// Add to the existing Vite plugins, alongside the Cossack framework plugins.
cossackNode();
```

This makes `cossack dev` and plain `vite dev` serve the exported `app` from
`/src/index.ts`. The entry can also export `env` and a runtime with `dispose()`
and `attach()`. The adapter imports no framework code. Vite remains an optional
peer dependency and is not imported by the main runtime entry.

The HTTP middleware runs after Vite's public asset and module handlers. A separate
`/ws/` listener loads the same application before the first WebSocket upgrade,
including when no application HTTP request has run. Other upgrade paths remain
with Vite. Server-source edits replace the server module graph, detach and dispose
the old runtime, and close its sockets. The browser HMR connection stays open.
Cleanup can continue while the replacement runtime starts. Source reload does
not undo in-flight application effects.
An edit during asynchronous initialization discards the stale entry before it can
accept a request. Initialization failures retry with a fresh entry.

Generated entries export `createEnv(variables)`. The plugin passes values from
Vite's environment files, with process variables taking precedence. The factory
preserves arbitrary bindings, supplies the `DB_PATH` default, and configures
`EMAIL` when `SMTP_HOST` is present. SMTP configuration requires `SMTP_USER` and
`SMTP_PASS`. The same factory supplies production bindings. Private bindings are
not added to Vite's client environment. The existing `VITE_` public-prefix rule
still applies. Custom entries without a factory retain their exported `env`.

The generated `scripts/dev.js` is a thin Vite launcher. It retains the optional
`COSSACK_LOCAL` overlay and its `PORT`/3000 default. Application routing, upgrades,
bindings, and cleanup all use the plugin. Plain `vite dev` and `cossack dev` use
Vite's usual port options. Both normal and JSON CLI development commands supervise
the child process and honor a requested shutdown.

Closing Vite waits up to five seconds for runtime cleanup. Use
`cossackNode({ entry: '/src/custom.ts', shutdownTimeoutMs: 2000 })` to change the
entry or the deadline. A deadline stops the wait. It cannot terminate application I/O.
Embedded Vite servers (`server.middlewareMode`) retain ownership of their listener
and lifecycle and are not installed by this plugin.

This plugin applies only to development. Production keeps the generated Node
server and static-file middleware. The plugin is omitted from Desktop mode.
