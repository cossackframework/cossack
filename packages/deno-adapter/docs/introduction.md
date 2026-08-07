---
title: Introduction
description: Understand the Cossack adapter for Deno and Deno Deploy.
---

# Introduction

`@cossackframework/deno-adapter` runs a Cossack web application as a Deno HTTP
service or on Deno Deploy. Cossack retains ownership of routes, middleware,
authentication, origin validation, SSR, hydration, scope keys, and RPC.

The adapter supplies `Deno.serve()`, Vite asset delivery, an
`ASSETS.fetch()`-compatible binding, Hono Deno WebSockets, and bounded,
idle-evicted process-local component instances. Pass it as `runtimeAdapter` to
`createApp()` and route requests through `runtime.fetch()`.

Deno WebSocket state is not durable or cross-instance. The framework rejects
`stateful: true`; use a database for important data.

- [Installation](./installation.md)
- [Deno web and Deno Deploy](./web.md)
