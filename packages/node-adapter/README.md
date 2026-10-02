# Cossack Framework Node Adapter

This package runs Cossack applications on Node.js. It handles HTTP requests,
WebSocket upgrades, and static files. It also provides runtime polyfills so
application code can work on Cloudflare Workers and Node.js.

## Installation
See the [Installation Guide](https://cossack.dev/docs/installation) to set up
Cossack and its packages.

## Exports

- `createNodeAdapter` : connects framework-guarded WebSocket upgrades to a Node server, shares process-local scope instances, and manages cleanup.
- `CossackNodeAdapter` and `nodeRuntimeAdapter` : legacy registry adapter and metadata-only adapter; generated apps use `createNodeAdapter`.
- `serveStatic` : Node `fs`-based Hono middleware for serving static assets.
- `NodeWebSocketRuntime` : the WebSocket runtime used by the adapter.
- `createNodeEmailSender` : Node.js polyfill for Cloudflare's `send_email` binding (`env.EMAIL`).

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
Build the sender from SMTP env vars and inject it into `env`, then pass `env` `app.fetch` for both HTTP requests and WebSocket authorization:

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
Configure via `.dev.vars` (Cloudflare dev) or your shell/`.env` (Node):

| Variable | Description | Default |
| -------------- | -------------------------------------------- | ------------------ |
| `SMTP_HOST` | SMTP server host (e.g. `smtp.gmail.com`) | : |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Use TLS (`"true"` for port 465) | `port === 465` |
| `SMTP_USER` | SMTP username | : |
| `SMTP_PASS` | SMTP password | : |
| `MAIL_FROM` | Default `from` address when omitted | `no-reply@example.com` |

Now `await this.env.EMAIL.send(...)` works identically in `@Server` methods on both Cloudflare Workers and Node.js.

## WebSocket lifetime

`runtime.attach(server, fetch)` handles `/ws/` upgrade requests. Other upgrade
paths remain available to the host. Authentication, origin checks, route lookup,
and scope authorization run through the framework before the handshake. Response
cookies and application headers reach the handshake. Components for the same
route/provider/scope share one initialization and process-local state.

`maxInstances` defaults to 512 and includes pending initialization.
`idleTimeoutMs` defaults to 15 minutes; pruning runs on socket activity.
Call `await runtime.dispose()` before closing an embedded server. It detaches
upgrade listeners, ends sockets, waits for pending initialization and active
actions, and destroys components/services. Repeated calls share the same result.
A native server `close` event also triggers disposal. Actions must settle for
cleanup to finish. Disposed adapters cannot be attached again.

The request scheme follows the actual Node socket (HTTP or TLS); the adapter does
not trust forwarded scheme headers. Configure origin policy for a trusted proxy
in the application. Generated production and development entries attach the adapter automatically.
The dev server disposes the previous runtime on source reload while Vite retains
its HMR connection; clients reconnect to a fresh process-local scope.
