# Service Providers — Decision Record (Not Adopted)

Status: **Accepted — do not adopt for now.** Revisit if a trigger in [When to revisit](#when-to-revisit) occurs.

This records the decision to **not** introduce Laravel-style Service Providers to Cossack, and explains how the framework's existing primitives cover the same responsibilities. Intended for contributors and LLM-assisted development so the rationale isn't lost.

---

## What a Service Provider is

In Laravel, a Service Provider is the central bootstrap unit. Each provider class has two lifecycle hooks:

- `register()` — bind things into the DI container (`bind`, `singleton`, `extend`).
- `boot()` — run startup logic once all providers are registered: publish routes, register middleware/commands, attach event listeners, load config, register validators/serializers, warm caches.

Their defining strength is **third-party package self-registration**: `composer require foo/bar` auto-wires the package (routes, middleware, commands, migrations, container bindings) with zero manual editing.

So a Service Provider bundles four jobs: **DI registration + middleware/route registration + one-time boot logic + package-integration contract.**

---

## Decision

**Do not add a Service Provider layer.** The responsibilities are already covered by Cossack's existing primitives, and those primitives fit the edge/Vite runtime model better than a runtime provider registry.

---

## How Cossack covers each Service Provider job

| Laravel SP job | Cossack equivalent | Where |
|---|---|---|
| DI container bindings | `@Service()` decorator + `DIContainer` (singleton cache, ctor injection) | `packages/core/src/shared/container.ts` — see [service.md](./service.md) |
| Register global request middleware | `src/bootstrap/middlewares.ts` registry, auto-loaded via `virtual:cossack-middlewares` | `packages/framework/src/vite-plugin.ts`, `router.ts` |
| Register routes | File-based `src/pages/` (auto-discovered via `import.meta.glob`) | `packages/framework/src/vite-plugin.ts` (`cossackPages`) |
| One-time boot/lifecycle logic | Vite plugins (build-time) + request middleware + `src/index.ts` module top-level (once per isolate) | `vite.config.ts`, `src/index.ts` |
| Package / feature integration | `cossack add <feature>` CLI scaffolds files + registry entries | `packages/cossack/src/commands/add.js` |
| Migrations / config publishing | CLI generators (`cossack generate migration|seeder|model`) | `packages/cossack/src/commands/` |
| Type augmentation | `declare module '@cossackframework/...'` (Database, User) | user `src/models/*.ts` |

---

## Why Service Providers are a poor fit for Cossack

### 1. Edge runtime vs. process boot

Laravel scans installed packages and boots their providers on every process start. Cloudflare Workers cold-start constantly and there is **no cheap "scan + boot" phase** — scanning packages at request time would devastate cold-start latency. The Cossack-native equivalent of Laravel's runtime scan is **Vite's static `import.meta.glob` + file conventions, resolved at build time**. That is already how pages, lang catalogs, and the middleware registry are discovered.

### 2. Parallel-mechanism risk

A provider layer would overlap with three existing registration systems:

- `@Service` / `DIContainer` (DI)
- `src/bootstrap/middlewares.ts` (request middleware)
- Vite plugins (build-time discovery/generation)

Adding a fourth — a `register()`/`boot()` registry — increases conceptual surface area with marginal payoff and forces a "which mechanism do I use?" decision on every integration. The existing three have clear, non-overlapping roles.

### 3. No third-party package ecosystem

SPs earn their keep when installable packages self-register. Cossack has no installable-package ecosystem yet, so there is no concrete consumer of a provider contract. Adding the contract first and hoping packages arrive is speculative abstraction.

---

## The one genuine gap (small)

There is no dedicated home for **"run once per worker isolate, not per-request, not at build"** logic other than `src/index.ts` module top-level. Examples: warming a cache, registering a custom validator/serializer, hooking a framework default.

This is actually the **idiomatic Workers pattern** — top-level module code runs once per isolate and is cached across requests in the same isolate. It is not a deficiency that needs abstracting away. If it ever becomes cluttered, see the escape hatch below.

### Escape hatch (if needed later)

A lightweight `src/config/providers.ts` could centralize one-time setup without adopting the full SP pattern:

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

This would be auto-loaded the same way as `src/bootstrap/middlewares.ts`. It is deliberately smaller than Laravel's SPs (no per-package auto-discovery, no deferred providers, no event system) and should only be added when the triggers below fire.

---

## When to revisit

Reopen this decision if **either** of these becomes true:

1. **Boot logic sprawl.** Imperative one-time setup (caches, validators, serializers, framework hooks) accumulates beyond what `src/index.ts` top-level + request middleware handle cleanly, and contributors start asking for a centralized boot hook.
2. **Third-party package ecosystem.** Real installable Cossack packages exist and need a self-registration contract (a package must wire its own DI bindings + middleware + types without manual edits).

Until then, a Service Provider system would add abstraction without solving a concrete problem.

---

## Related

- [service.md](./service.md) — the DI / `@Service()` system that replaces `register()` bindings.
- [middleware.md](./middleware.md) — global request middleware registry (`src/bootstrap/middlewares.ts`) + route-level `@Page({ middlewares })`.
- [architecture.md](./architecture.md) — package separation and request lifecycle.
