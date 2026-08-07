# Cossack Framework Node Adapter

This package provides a Node.js adapter for the Cossack Framework, allowing you to run your Cossack applications in a Node.js environment. It includes utilities for handling HTTP requests and responses, WebSocket upgrades, static file serving, and runtime polyfills that keep application code identical across Cloudflare Workers and Node.js.

## Installation
Refer to our [Installation Guide](https://cossack.dev/docs/installation) for detailed instructions on how to set up the Cossack Framework and its packages.

## Exports

- `CossackNodeAdapter` — handles WebSocket upgrades and component bootstrapping on a Node `http.Server`.
- `nodeRuntimeAdapter` — pass to `createApp()` so SSR emits Node process-local WebSocket targets.
- `serveStatic` — Node `fs`-based Hono middleware for serving static assets.
- `NodeWebSocketRuntime` — the WebSocket runtime used by the adapter.
- `createNodeEmailSender` — Node.js polyfill for Cloudflare's `send_email` binding (`env.EMAIL`).

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
Build the sender from SMTP env vars and inject it into `env`, then pass `env` both to `app.fetch` (HTTP transport) and to `CossackNodeAdapter` (WebSocket transport):

```ts
import { serve } from '@hono/node-server';
import { createApp } from '@cossackframework/framework/router';
import {
  CossackNodeAdapter,
  createNodeEmailSender,
  nodeRuntimeAdapter,
} from '@cossackframework/node-adapter';
import { App } from './App';
import { template } from './root';

const app = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: nodeRuntimeAdapter,
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

// WebSocket: pass the same env so `@Server` methods over WS see `this.env.EMAIL`.
new CossackNodeAdapter({
  server,
  // Keys match the routePath metadata emitted by Cossack, for example
  // new Map([['/account/:id', AccountPage]]).
  componentRegistry,
  env,
});
```

### Environment variables
Configure via `.dev.vars` (Cloudflare dev) or your shell/`.env` (Node):

| Variable       | Description                                  | Default            |
| -------------- | -------------------------------------------- | ------------------ |
| `SMTP_HOST`    | SMTP server host (e.g. `smtp.gmail.com`)     | —                  |
| `SMTP_PORT`    | SMTP server port                             | `587`              |
| `SMTP_SECURE`  | Use TLS (`"true"` for port 465)              | `port === 465`     |
| `SMTP_USER`    | SMTP username                                | —                  |
| `SMTP_PASS`    | SMTP password                                | —                  |
| `MAIL_FROM`    | Default `from` address when omitted          | `no-reply@example.com` |

Now `await this.env.EMAIL.send(...)` works identically in `@Server` methods on both Cloudflare Workers and Node.js.
