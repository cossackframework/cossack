# Service Providers : Decision Record (Not Adopted)

Status: Accepted. Do not add this feature. Revisit this decision if a trigger in [When to revisit](#when-to-revisit) occurs.

This document records why Cossack does not use Laravel-style Service Providers. It explains how existing Cossack features handle the same work. Use it when you work on the framework.

---

## What a Service Provider is

In Laravel, a Service Provider is a central startup unit. Each provider class has two lifecycle hooks:

- `register()`: binds things into the DI container (`bind`, `singleton`, `extend`).
- `boot()`: runs startup logic once all providers are registered. It publishes routes, registers middleware and commands, attaches event listeners, loads configuration, registers validators and serializers, and warms caches.

Their main purpose is third-party package registration. The command `composer require foo/bar` connects the package's routes, middleware, commands, migrations, and container bindings without manual edits.

A Service Provider handles four jobs: dependency injection (DI), middleware and route registration, one-time startup logic, and package integration.

---

## Decision

Do not add a Service Provider layer. Cossack features handle these jobs. They also fit the edge and Vite runtime model.

---

## How Cossack covers each Service Provider job

| Laravel SP job | Cossack equivalent | Where |
|---|---|---|
| DI container bindings | `@Service()` decorator + `DIContainer` (singleton cache, ctor injection) | `packages/core/src/shared/container.ts`. See [service.md](./service.md). |
| Register global request middleware | `src/bootstrap/middlewares.ts` registry, auto-loaded via `virtual:cossack-middlewares` | `packages/framework/src/vite-plugin.ts`, `router.ts` |
| Register routes | File-based `src/pages/` (auto-discovered via `import.meta.glob`) | `packages/framework/src/vite-plugin.ts` (`cossackPages`) |
| One-time boot/lifecycle logic | Vite plugins (build-time) + request middleware + `src/index.ts` module top-level (once per isolate) | `vite.config.ts`, `src/index.ts` |
| Package / feature integration | `cossack add <feature>` CLI scaffolds files + registry entries | `packages/cossack/src/commands/add.js` |
| Migrations / config publishing | CLI generators (`cossack generate migration|seeder|model`) | `packages/cossack/src/commands/` |
| Type augmentation | `declare module '@cossackframework/...'` (Database, User) | user `src/models/*.ts` |

---

## Why Service Providers are a poor fit for Cossack

### 1. Edge runtime vs. process boot

Laravel scans installed packages and boots their providers on every process start. Cloudflare Workers cold-start often, and there is no cheap "scan + boot" phase. A scan at request time destroys cold-start latency. The Cossack-native equivalent of Laravel's runtime scan is Vite's static `import.meta.glob` + file conventions, resolved at build time. Pages, lang catalogs, and the middleware registry are discovered this way.

### 2. Parallel-mechanism risk

A provider layer overlaps with three registration systems:

- `@Service` / `DIContainer` (DI)
- `src/bootstrap/middlewares.ts` (request middleware)
- Vite plugins (build-time discovery/generation)

A fourth mechanism, a `register()`/`boot()` registry, increases the conceptual surface with little payoff. It forces a "which mechanism do I use?" decision on every integration. The three existing systems have clear, non-overlapping roles.

### 3. No third-party package ecosystem

Service Providers pay off when installable packages self-register. Cossack has no installable-package ecosystem, so a provider contract has no concrete consumer. Adding the contract first and hoping packages arrive is speculative abstraction.

---

## The one genuine gap (small)

There is no dedicated home for "run once per worker isolate, not per-request, not at build" logic other than `src/index.ts` module top-level. Examples: warming a cache, registering a custom validator/serializer, hooking a framework default.

This is the idiomatic Workers pattern. Top-level module code runs once per isolate and is cached across requests in the same isolate. It does not need an abstraction. If `src/index.ts` becomes cluttered, see the escape hatch below.

### Escape hatch (if needed later)

A lightweight `src/config/providers.ts` can centralize one-time setup without adopting the full Service Provider pattern:

```ts
// Hypothetical — NOT implemented today.
import type { DIContainer } from '@cossackframework/core';

export const providers = [
  {
    register(container: DIContainer) { /* bind singletons */ },
    boot() { /* one-time isolate setup */ },
  },
];
```

Auto-load it the same way as `src/bootstrap/middlewares.ts`. It is smaller than Laravel's Service Providers by design. There is no per-package auto-discovery, no deferred providers, and no event system. Add it only when a trigger below fires.

---

## When to revisit

Reopen this decision if either of these becomes true:

1. Boot logic sprawl. Imperative one-time setup (caches, validators, serializers, framework hooks) grows beyond what `src/index.ts` top-level + request middleware handle cleanly, and contributors start asking for a centralized boot hook.
2. Third-party package ecosystem. Real installable Cossack packages exist and need a self-registration contract. A package must wire its own DI bindings, middleware, and types without manual edits.

Until then, a Service Provider system adds abstraction without solving a concrete problem.

---

## Related

- [service.md](./service.md): the DI / `@Service()` system that replaces `register()` bindings.
- [middleware.md](./middleware.md): global request middleware registry (`src/bootstrap/middlewares.ts`) + route-level `@Page({ middlewares })`.
- [architecture.md](./architecture.md): package separation and request lifecycle.
