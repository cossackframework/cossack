# Configuration System

This document describes how Cossack loads, evaluates, and scopes configuration files. It also describes how the framework keeps those files on the server.

## Design Principles

1. Worker bindings. Cloudflare Workers expose environment bindings (`c.env`) inside a request handler, not when a module loads. Evaluate configuration for each request.
2. Request isolation. One Worker isolate can serve many requests at the same time. AsyncLocalStorage (ALS) stores configuration for the current request. The framework also uses this pattern for `__()` (locale), ORM scopes, `flash()`, and `getRequestContext()`.
3. Server-only files. Configuration files call `env()` to read secrets and bindings. Keep them out of the client bundle. Two enforcement layers do this. See [Client-side exclusion](#client-side-exclusion).
4. Library/application separation. The configuration system (ALS store + `config()` / `env()` accessors) lives in `@cossackframework/framework` and is exported from `@cossackframework/framework/config`.

## Package Responsibilities

| Package | Role |
|---------|------|
| `@cossackframework/framework` | Owns the entire config system: the `AsyncLocalStorage` instance, the `config()` / `env()` accessors, the `runWithConfig()` scope function, the config-building middleware (in `router.ts`), the `cossackConfig()` Vite plugin, the type inference machinery (`CossackConfigRegistry`, `DottedPaths`, `GetByPath`), and the SSG config wiring (`ssg-renderer.ts`, `ssg-entry.ts`). All exported from `@cossackframework/framework/config`. |

The framework owns the configuration system. Locale (`__()`) and the ORM use different ownership. The `config()` helper reads the store with `configAls.getStore()`.

## Config File Format

Each file in `src/config/*.ts` default-exports a factory function, not a plain object:

```typescript
// src/config/app.ts
export default ({ env }) => ({
    name: env('APP_NAME', 'My App'),
    env: env('APP_ENV', 'production'),
    key: env('APP_SECRET'),
});
```

### Why factory functions (not plain objects)

ESM modules load once per isolate. Cloudflare Workers load them before request bindings exist. With a plain object, `env()` runs at module load and reads `undefined` for every binding.

Factory functions defer evaluation. The framework calls each factory for every request and passes an `env` function that reads that request's `c.env`. The framework also uses this pattern in `getR2ConfigFromEnv(env)` and `configureRateLimitFromEnv(env)`.

The `EnvFunction` type is the signature `(key: string, defaultValue?: string) => string`. Values are always stringified. Unset bindings fall back to the default.

## Request Lifecycle

### 1. Config middleware (SSR)

The configuration middleware is registered first in `createApp()` (before user middleware from `src/bootstrap/middlewares.ts`, the locale middleware, and the flash middleware):

```typescript
app.use('*', async (c, next) => {
    const store = prepareConfigStore(configFactories, c.env);
    return runWithConfig(store, () => next());
});
```

Steps:
1. Enter a fresh preparation scope containing `c.env` and an empty config tree.
2. Evaluate every config factory inside that scope, building a `Record<fileName, configObject>` tree. Files without a factory are skipped with a named warning. Required accessors inside valid factories fail with a named error before downstream application code.
3. Wrap the remainder of the request (`next()`) inside `runWithConfig`, which enters the `AsyncLocalStorage` scope.

Because the scope wraps `next()`, all downstream middleware, route handlers, component `bootstrap()` / `init()` / `render()` / `head()` calls, and their async descendants resolve `config()` and `env()` against this request's values.

### 2. SSG (static site generation)

SSG runs inside `vite build` via the `cossackSsg()` Vite plugin (`vite-ssg-plugin.ts`), which uses Vite's `runnerImport()` to load `ssg-entry.ts` through an ephemeral Vite environment. Because SSG loads through Vite, the `virtual:cossack-config` module (and the `virtual:cossack-pages` / `virtual:cossack-lang` modules) resolve the same way as they do in SSR. No disk-based reimplementation is needed.

- `ssg-entry.ts` imports `virtual:cossack-config` directly, so config factories are available during static generation without reading `src/config/*.ts` from disk.
- `ssg-renderer.ts` injects the resolved site URL (from `getSiteUrl()`) as `APP_URL` into the SSG env bindings, so `config('app.url')` returns the correct value during static generation. Other bindings are empty. Configuration factories use their fallback values.
- The config store is built before locale initialization, so `ensureSsgLocaleInitialized()` can read `config('app.locale')`. Locale catalogs are resolved from `virtual:cossack-lang` (not read from disk).

### 3. Client-side

`config()` and `env()` always return their defaults on the client (no ALS store is active). Components that need config values in their render must read them server-side and store the results in `@State`.

## The Vite Plugin: `cossackConfig()`

The `cossackConfig()` plugin in `vite-plugin.ts` emits a `virtual:cossack-config` module:

- SSR environment: eagerly globs `/src/config/*.ts`, re-exports each file's default export keyed by file name (sans extension).
- Client environment: returns `export default {};`, an empty object. Config factories never ship to the browser.

The plugin follows the same shape as `cossackMiddlewares()` and `cossackPages()`: a `resolveId` / `load` pair with a `\0`-prefixed resolved ID.

## Client-side Exclusion

Two independent layers prevent config files from reaching the client bundle:

### Layer 1: Virtual module stub

The `cossackConfig()` plugin's `load` hook returns `export default {};` when `this.environment?.name === 'client'`. Since config files are only accessed through `virtual:cossack-config`, this is the primary exclusion path.

### Layer 2: Security plugin guard

The `cossackSecurityPlugin` includes a `load` hook that intercepts any file matching `/(^|\/)config\/[^/]+\.m?ts$/` on the client environment and returns `export default {};`. This is a defense-in-depth guard against accidental direct imports (for example, `import { dbConfig } from '../config/database'` in a component). Such an import resolves to an empty default export rather than leaking the file's contents.

## Built-in Config Consumers

| Consumer | Config key | Resolves | Defined in |
|----------|-----------|----------|------------|
| Locale middleware | `config('app.locale')` | Default locale for `__()` | `middlewares/locale.ts` |
| SSG renderer | `config('app.url')` | Site URL for sitemap/canonical | `ssg-renderer.ts` (via injected `APP_URL`) |
| SSG locale init | `config('app.locale')` | Default locale for static pages | `ssg-renderer.ts` |
| Flash middleware | `c.env.APP_SECRET` | HMAC signing secret | `middlewares/flash.ts` |

The flash middleware reads `c.env.APP_SECRET` directly (with fallbacks to `COSSACK_SECRET` and bare `SECRET`) rather than going through `config()`, because it needs the raw binding and must avoid a hard dependency on a `src/config/app.ts` file existing.

## ALS Architecture

The config system owns its `AsyncLocalStorage` instance directly in `src/config.ts`. Config is consumed only within Framework, so an application injection point is unnecessary.

- `runWithConfig(store, fn)` enters the ALS scope. The configuration middleware in `createApp()` and the SSG renderer call it.
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

- `DottedPaths<T>` recursively produces all valid dotted paths: `'app.name'`, `'app.nested.sub.value'`, and others.
- `GetByPath<T, Path>` extracts the value type at a path: `GetByPath<Registry, 'app.name'>` → `string`.

### 3. Overload resolution

`config()` has two overloads:

1. Typed overload: `config<Path extends DottedPaths<ConfigTree>>(key: Path, ...)` matches when the key is a known path. It infers the return type via `GetByPath`.
2. Untyped fallback: accepts any string only while `CossackConfigRegistry` is empty. It returns the type of the supplied default, or `unknown` when no default is supplied. Once an app augments the registry, this fallback accepts no keys. A misspelled path cannot bypass the typed overload.

When `CossackConfigRegistry` is empty (no augmentation), `DottedPaths<{}>` is `never`, so overload 1 never matches. Calls use the string fallback. An app can add the registry augmentation in steps. After that, the framework checks configuration paths and defaults against the registered types.

### Generated factory types

`cossackConfig()` generates `.cossack/config.d.ts` when Vite resolves the project,
and refreshes it when development config files change. New scaffold projects
include this file in `tsconfig.json` and ignore it in Git. Existing apps must
add `.cossack/config.d.ts` to their TypeScript `include` list.

The generator discovers direct `src/config/*.ts` files, excluding declarations,
tests and specs, matching the server virtual module. It references each default
factory with type-only imports. It never executes factories or copies values.
Factory return types populate `CossackGeneratedConfigRegistry`. Explicit
`CossackConfigRegistry` entries replace the generated shape for the same key.
The effective tree controls typed paths and disables arbitrary string fallback
once either registry has entries.

For typechecking before starting Vite, call the Node-only tooling export:

```js
import { generateConfigTypes } from '@cossackframework/framework/config-codegen';
generateConfigTypes(process.cwd());
// Preview without writing: generateConfigTypes(process.cwd(), { write: false });
```

Generation is deterministic and does not replace authored files or symlinked
output destinations. This tooling is not a runtime API. Generated types do not prove a selected environment supplies the declared values.

### CLI discovery and generation

`cossack config` lists the discovered factory keys, source files, and return-type
origins without evaluating modules. `--json` uses the versioned CLI envelope.
It exposes names and origins rather than computed values or source text.

Run `cossack config --generate` before a standalone `pnpm tsc --noEmit` check.
Use `--generate --dry-run --json` to preview the generated file status without
writing. Repeated generation writes only when content changes. An authored
`.cossack/config.d.ts` prevents generation with
`COSSACK_CONFIG_GENERATION_CONFLICT`. Read-only discovery still works.

The catalog reports filename-based type origins, not expanded inferred types,
factory exports, or runtime values. Literal requirement metadata is described below. Existing apps must include `.cossack/config.d.ts` in
TypeScript before its augmentation is visible.

`prepareConfigStore(factories, bindings)` creates a fresh scope for synchronous
factory evaluation. Injected `env` and imported `env`, `binding`, `requireEnv`, and
`requireBinding` all use the supplied bindings. An enclosing request's bindings
are not inherited. The completed tree is published after every factory succeeds.
`config()` inside a factory sees the empty preparation tree. Enter the returned
store with `runWithConfig` for downstream code. Both preparation success and
failure restore an enclosing scope. Async factory functions remain unsupported.

SSR supplies the current request bindings. SSG supplies only `APP_URL` from the
resolved base URL. A required live binding fails before locale initialization,
user middleware, or page lifecycle begins. SSG does not invent bindings or waive
required accessors. Legacy required helpers apply their rules when invoked. Independent declarations apply
before the first factory, as described below.
`buildConfig` remains a low-level evaluator with an injected reader. It does not
establish an accessor scope. Integrations that need scoped imported helpers
must use `prepareConfigStore`.


### Declared requirements

Export a literal `requirements` object beside a synchronous factory:

```ts
import { requireConfigVariable, requireBinding, type ConfigRequirements }
  from '@cossackframework/framework/config';

export const requirements = {
  variables: {
    PORT: { type: 'number', coerce: true },
    TOKEN: { type: 'string', secret: true },
    LABEL: { type: 'string', required: false },
  },
  bindings: { DB: { kind: 'd1', runtimes: ['cloudflare'] } },
} as const satisfies ConfigRequirements;
export default () => ({ port: requireConfigVariable('PORT', 'number') });
```

The virtual server module collects declarations. `prepareConfigStore` makes sure
that all active metadata and values are valid before any factory runs. Integrations pass
`{ requirements: { app: requirements }, context: { runtime: 'node' } }` as its
third argument. SSR derives runtime from its adapter, with Cloudflare as the
adapter-free default. Unknown adapters retain unknown runtime. Its selected
environment comes from `cossackConfig({ environment })` or `CLOUDFLARE_ENV`.
Realtime authorization snapshots preserve the originating runtime/environment.
Replay uses the same fresh preparation before middleware, authorization checks
or operations. Configuration failure denies replay without exposing values.
SSG uses runtime `ssg`. It supplies only APP_URL. A live binding can be explicitly
Cloudflare-only. Omitting runtimes makes the rule apply in every runtime.

Variable types are `string`, `number`, and `boolean`. Required defaults to true,
coerce and secret to false. Numeric coercion accepts finite decimal/exponent
strings after trimming, and rejects hex, empty values, NaN and Infinity.
Boolean coercion accepts booleans, 1/0 and the strings true/false/1/0 after
trimming. It rejects yes/no, uppercase aliases and object conversion. Strict
rules accept only values of the declared type. Optional absent values stay
undefined. Duplicate active declarations must agree on type/coercion or binding
kind. Required and secret classification are promoted if any declaration needs
them. Accessors report a mismatch if the caller requests the wrong type.

Binding kinds are object, d1, kv, r2, durable-object and service. Specific kinds
make sure that the value has a minimal public method shape at runtime, and tooling inspects
the selected binding category. They require Cloudflare. Object accepts a non-null object/function
in other runtimes. This is structural validation, not resource connectivity or
complete platform branding. Binding methods are never invoked by validation.

`configVariable(name, type)` returns a typed optional scalar, and
`requireConfigVariable` requires it. They read server-only values that passed
the requirement checks.
`env()` keeps its string behavior and `binding()` preserves raw identity.
Secret classification does not stop application code from deliberately exposing
a value through public props, factories or responses. Nothing automatically
serializes the requirement store.

`cossack config --check --env staging --json`, `cossack check cloudflare` and
`cossack deploy` reuse the checker with privately parsed selected Wrangler facts.
Deployment failures stop before types, build, artifact deletion or upload.
Checks do not read process/development values, evaluate factories, or contact
remote resources. Secret existence and values stay unchecked, even if a
required secret name is declared. Node declaration preflight is explicitly
unavailable. Runtime checks work with their supplied bindings. Direct Vite builds
perform Cloudflare declaration preflight through `cossackConfig()` before
configuration type generation, transforms and output cleanup. Explicit runtime and
environment options override project metadata and `CLOUDFLARE_ENV`. Runtime
inference prefers scaffold metadata, then package metadata, adapter dependencies,
and Cloudflare tooling/configuration. Every build and watch cycle repeats the
declaration checks.
Node/unknown targets cover static metadata, conflicts and runtime
compatibility only. Their supplied values stay unchecked. Development startup
allows incomplete declarations. Failed build/render hooks suppress SSG cleanup
publication for that environment. The next build cycle clears its failure state.

The Node-only `framework/config-preflight` module shares Wrangler normalization
between Vite, CLI inspection, build capability checks and deployment. Its raw
reader is a private tooling value boundary and must never be serialized. Public
inspection/build results contain only metadata, names and safe diagnostics.

Static inspection accepts literal named exports (and simple local const aliases),
including TypeScript as/satisfies wrappers. Dynamic expressions, imported exports,
mutations, computed keys, getters, spreads, unsupported exported forms and
ambiguous top-level effects are unknown. Invalid schemas and parser failures
have value-free diagnostics. Source text and scalar values never enter catalogs.
The inspector is conservative: unrelated dynamic top-level const initializers can
also make declared metadata unknown. It is Node-only tooling. The shared
`framework/config-requirements` runtime checker imports no Node APIs.
