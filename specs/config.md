# Configuration System

This document specifies the architecture of Cossack's configuration system: how config files are structured, loaded, evaluated, scoped, and kept server-only.

## Design Principles

1. **Workers-correct by default.** Environment bindings (`c.env`) on Cloudflare Workers are only available inside the request handler, not at module-load time. Config must therefore be evaluated per request, not once at startup.
2. **Per-request isolation.** A single Worker isolate serves many concurrent requests. Config values are scoped to the current request via AsyncLocalStorage (ALS), the same pattern used by `__()` (locale), `db()` (database client), `flash()` (flash data), and `getRequestContext()`.
3. **Server-only.** Config files call `env()` to read secrets and bindings. They must never ship to the client bundle. Two enforcement layers guarantee this (see [Client-side exclusion](#client-side-exclusion)).
4. **Library/application separation.** The config system (ALS store + `config()` / `env()` accessors) lives in `@cossackframework/framework` and is exported from `@cossackframework/framework/config`.

## Package Responsibilities

| Package | Role |
|---------|------|
| `@cossackframework/framework` | Owns the entire config system: the `AsyncLocalStorage` instance, the `config()` / `env()` accessors, the `runWithConfig()` scope function, the config-building middleware (in `router.ts`), the `cossackConfig()` Vite plugin, the type inference machinery (`CossackConfigRegistry`, `DottedPaths`, `GetByPath`), and the SSG config wiring (`ssg-renderer.ts`, `ssg-entry.ts`). All exported from `@cossackframework/framework/config`. |

Unlike locale (`__()`) and the database client (`db()`), which use the injection-point pattern (leaf accessors in core, ALS in framework), config lives entirely in the framework. This eliminates the `setConfigStoreGetter` indirection — `config()` calls `configAls.getStore()` directly.

## Config File Format

Each file in `src/config/*.ts` default-exports a **factory function**, not a plain object:

```typescript
// src/config/app.ts
export default ({ env }) => ({
    name: env('APP_NAME', 'My App'),
    env: env('APP_ENV', 'production'),
    key: env('APP_SECRET'),
});
```

### Why factory functions (not plain objects)

ESM modules are singletons evaluated once at import. On Cloudflare Workers, the import happens at isolate startup — before any request bindings exist. If config files exported plain objects with `env()` calls, those calls would execute at startup and read `undefined` for every binding.

Factory functions defer evaluation: the framework calls each factory **per request**, passing an `env` function bound to that request's `c.env`. This is the same pattern as `getR2ConfigFromEnv(env)` and `configureRateLimitFromEnv(env)` elsewhere in the codebase.

The `EnvFunction` type guarantees a `(key: string, defaultValue?: string) => string` signature — values are always stringified, and unset bindings fall back to the default.

## Request Lifecycle

### 1. Config middleware (SSR)

The config middleware is registered **first** in `createApp()` (before user middleware from `src/bootstrap/middlewares.ts`, the locale middleware, and the flash middleware):

```typescript
app.use('*', async (c, next) => {
    const envBindings = c.env as unknown as Record<string, unknown>;
    const envFn = (key, def) => {
        const v = envBindings?.[key];
        return v !== undefined && v !== null ? String(v) : def ?? '';
    };
    const built = {};
    for (const [name, factory] of Object.entries(configFactories)) {
        if (typeof factory !== 'function') {
            throw new Error(`[Cossack] Config file "${name}" must default-export a factory function.`);
        }
        built[name] = factory({ env: envFn });
    }
    return runWithConfig({ env: envBindings, config: built }, () => next());
});
```

Steps:
1. Build an `env` function that reads from `c.env` (the request's Cloudflare bindings).
2. Evaluate every config factory, building a `Record<fileName, configObject>` tree. Each factory is validated to be a function — a misconfigured config file throws a clear error naming the offending file.
3. Wrap the remainder of the request (`next()`) inside `runWithConfig`, which enters the `AsyncLocalStorage` scope.

Because the scope wraps `next()`, all downstream middleware, route handlers, component `bootstrap()` / `init()` / `render()` / `head()` calls, and their async descendants resolve `config()` and `env()` against this request's values.

### 2. SSG (static site generation)

SSG runs inside `vite build` via the `cossackSsg()` Vite plugin (`vite-ssg-plugin.ts`), which uses Vite's `runnerImport()` to load `ssg-entry.ts` through an ephemeral Vite environment. Because SSG loads through Vite, the `virtual:cossack-config` module (and the `virtual:cossack-pages` / `virtual:cossack-lang` modules) resolve the same way they do in SSR — no disk-based reimplementation is needed.

- `ssg-entry.ts` imports `virtual:cossack-config` directly, so config factories are available during static generation without reading `src/config/*.ts` from disk.
- `ssg-renderer.ts` injects the resolved site URL (from `getSiteUrl()`) as `APP_URL` into the SSG env bindings, so `config('app.url')` returns the correct value during static generation. Other bindings are empty — config factories use their fallback values.
- The config store is built before locale initialization, so `ensureSsgLocaleInitialized()` can read `config('app.locale')`. Locale catalogs are resolved from `virtual:cossack-lang` (not read from disk).

### 3. Client-side

`config()` and `env()` always return their defaults on the client (no ALS store is active). Components that need config values in their render must read them server-side and store the results in `@State`.

## The Vite Plugin: `cossackConfig()`

The `cossackConfig()` plugin in `vite-plugin.ts` emits a `virtual:cossack-config` module:

- **SSR environment**: eagerly globs `/src/config/*.ts`, re-exports each file's default export keyed by file name (sans extension).
- **Client environment**: returns `export default {};` — an empty object. Config factories never ship to the browser.

The plugin follows the same shape as `cossackMiddlewares()` and `cossackPages()`: a `resolveId` / `load` pair with a `\0`-prefixed resolved ID.

## Client-side Exclusion

Two independent layers prevent config files from reaching the client bundle:

### Layer 1: Virtual module stub

The `cossackConfig()` plugin's `load` hook returns `export default {};` when `this.environment?.name === 'client'`. Since config files are only accessed through `virtual:cossack-config`, this is the primary exclusion path.

### Layer 2: Security plugin guard

The `cossackSecurityPlugin` includes a `load` hook that intercepts any file matching `/(^|\/)config\/[^/]+\.m?ts$/` on the client environment and returns `export default {};`. This is a defense-in-depth guard against accidental direct imports (e.g. `import { dbConfig } from '../config/database'` in a component). Such an import resolves to an empty default export rather than leaking the file's contents.

## Built-in Config Consumers

| Consumer | Config key | Resolves | Defined in |
|----------|-----------|----------|------------|
| Locale middleware | `config('app.locale')` | Default locale for `__()` | `middlewares/locale.ts` |
| SSG renderer | `config('app.url')` | Site URL for sitemap/canonical | `ssg-renderer.ts` (via injected `APP_URL`) |
| SSG locale init | `config('app.locale')` | Default locale for static pages | `ssg-renderer.ts` |
| Flash middleware | `c.env.APP_SECRET` | HMAC signing secret | `middlewares/flash.ts` |

The flash middleware reads `c.env.APP_SECRET` directly (with legacy fallbacks to `COSSACK_SECRET` and bare `SECRET`) rather than going through `config()`, because it needs the raw binding and must avoid a hard dependency on a `src/config/app.ts` file existing.

## ALS Architecture

The config system owns its `AsyncLocalStorage` instance directly in `src/config.ts` (not via an injection point). This differs from i18n (`__()`) and the database client (`db()`), which split the accessor and the ALS across core and framework. Config is consumed only within the framework, so the indirection was unnecessary.

- `runWithConfig(store, fn)` enters the ALS scope — called by the config middleware in `createApp()` and the SSG renderer.
- `config()` and `env()` call `configAls.getStore()` directly. When no scope is active (client-side, outside a request), they return defaults.

## Type System: Dotted-Path Inference

The config system provides optional compile-time type inference for dotted-path lookups. The mechanism has three layers:

### 1. The augmentation target: `CossackConfigRegistry`

`src/config.ts` exports an empty `interface CossackConfigRegistry {}`. Users augment it via `declare module` in their config files:

```typescript
declare module '@cossackframework/framework/config' {
    interface CossackConfigRegistry {
        app: AppConfig;
    }
}
```

TypeScript's declaration merging combines all augmentations into a single `CossackConfigRegistry` with every registered config file's shape. This mirrors the `User` interface pattern in `@cossackframework/core`.

### 2. Path and value extraction types

Two internal conditional types walk the registry tree:

- `DottedPaths<T>` — recursively produces all valid dotted paths: `'app.name'`, `'app.nested.sub.value'`, etc.
- `GetByPath<T, Path>` — extracts the value type at a path: `GetByPath<Registry, 'app.name'>` → `string`.

### 3. Overload resolution

`config()` has two overloads:

1. **Typed overload:** `config<Path extends DottedPaths<CossackConfigRegistry>>(key: Path, ...)` — matches when the key is a known path. Infers the return type via `GetByPath`.
2. **Untyped fallback:** `config<T = unknown>(key: string, ...)` — matches any string. Returns `T` (defaults to `unknown`).

When `CossackConfigRegistry` is empty (no augmentation), `DottedPaths<{}>` is `never`, so overload 1 never matches — all calls fall through to overload 2, returning `unknown`. This makes type registration fully backward-compatible.

