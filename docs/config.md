---
title: 'Configuration'
description: 'Manage app settings with a Laravel-style config folder, per-request config() and env() helpers, and factory-based config files that stay server-only.'
---

# Configuration

Cossack ships with a Laravel-inspired configuration system: a `config/` folder of plain TypeScript files, a `config()` helper for dotted-path lookups, and an `env()` helper for reading request-scoped environment bindings. All values resolve per-request via AsyncLocalStorage, so a single Worker isolate safely serves many concurrent users with different bindings.

Config files are **server-only** — they are never bundled into the client. On the client or outside a request, `config()` and `env()` return their defaults.

## Quick start

The `cossack` template ships with `src/config/app.ts`:

```ts
// src/config/app.ts
export default ({ env }) => ({
    name: env('APP_NAME', 'My App'),
    env: env('APP_ENV', 'production'),
    debug: env('APP_DEBUG', 'false') === 'true' || env('APP_DEBUG') === '1',
    url: env('APP_URL', 'http://localhost'),
    timezone: 'UTC',
    locale: env('APP_LOCALE', 'en'),
    fallback_locale: env('APP_FALLBACK_LOCALE', 'en'),
    key: env('APP_SECRET'),
});
```

Read any value with `config()`:

```ts
import { config } from '@cossackframework/framework/config';

const appName = config('app.name');           // 'My App'
const appEnv = config('app.env', 'production'); // 'production' (with fallback)
const debug = config('app.debug');             // false (type inferred)
```

Or read a raw binding with `env()`:

```ts
import { env } from '@cossackframework/framework/config';

const secret = env('APP_SECRET');              // the raw binding value
const region = env('AWS_REGION', 'us-east-1'); // 'us-east-1' (with fallback)
```

That's it — the framework auto-detects `src/config/*.ts`, evaluates each file per request, and scopes the resulting tree into AsyncLocalStorage so `config()` / `env()` resolve the right values everywhere.

## How config files work

Each file in `src/config/` default-exports a **factory function** — not a plain object. The factory receives `{ env }` and returns a config object:

```ts
export default ({ env }) => ({
    // ...
});
```

### Why factory functions?

On Cloudflare Workers, environment bindings (`c.env`) are only available **inside the request handler**, not at module-load time. If config files exported plain objects, the `env()` calls inside them would run once at startup — before any bindings exist — and return defaults for every request.

Factory functions solve this: the framework calls each factory **per request**, passing an `env` function bound to that request's bindings. This means `env('APP_SECRET')` reads the actual secret for the current request, every time.

### Adding config files

Create a new `.ts` file in `src/config/`. The file name (without extension) becomes the top-level key:

```ts
// src/config/database.ts
export default ({ env }) => ({
    driver: env('DB_CONNECTION', 'd1'),

    connections: {
        d1: {
            binding: env('DB_D1_BINDING', 'DB'),
        },
        turso: {
            url: env('DB_TURSO_URL'),
            token: env('DB_TURSO_TOKEN'),
        },
    },
});
```

```ts
config('database.driver');                          // 'd1'
config('database.connections.turso.url', 'fallback'); // nested path
```

### Nested values

`config()` walks dotted paths through the config tree. The first segment is always the file name; subsequent segments descend into the returned object:

```ts
config('app.name')                    // src/config/app.ts → { name }
config('database.connections.d1.binding') // deeply nested
```

If any intermediate segment is missing or not an object, `config()` returns the default value.

## Environment variables

Define bindings in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "APP_NAME": "My App",
    "APP_ENV": "production",
    "APP_URL": "https://example.com",
    "APP_LOCALE": "en",
    "APP_SECRET": "your-long-random-secret-here"
  }
}
```

Secrets (values you don't want in source control) should use `wrangler secret put` instead of `vars`:

```sh
npx wrangler secret put APP_SECRET
```

The `env()` helper reads from the same per-request bindings object, so both `vars` and secrets resolve identically at runtime.

## CORS

New projects include `src/config/cors.ts`. Existing projects that do not have
that file receive the same secure defaults: API CORS is enabled, with no trusted
cross-origin origins.

| Variable | Default | Meaning |
|---|---|---|
| `CORS_ENABLED` | `true` | Enable built-in CORS on `/api` and `/api/*` |
| `CORS_ORIGINS` | empty | Comma-separated origin allowlist |
| `CORS_METHODS` | `GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS` | Allowed preflight methods |
| `CORS_HEADERS` | empty | Allowed headers; empty reflects requested headers |
| `CORS_EXPOSE_HEADERS` | empty | Response headers exposed to browser code |
| `CORS_CREDENTIALS` | `false` | Permit credentialed browser requests |
| `CORS_MAX_AGE` | `86400` | Browser preflight cache duration in seconds |

CSV values are trimmed and empty entries discarded. Methods are normalized to
uppercase, and trailing slashes on exact origins are ignored. Supported origins
are exact HTTP(S) origins, global `*`, `https://*.example.com` (scheme-specific),
and `*.example.com` (HTTP or HTTPS). Subdomain patterns exclude the apex.
Malformed entries never match. `CORS_CREDENTIALS=true` with global `*` is
rejected because credentialed CORS requires an explicit origin.

For Node, put values in `.env`; for local Wrangler development, use `.dev.vars`:

```dotenv
CORS_ENABLED=true
CORS_ORIGINS=https://app.example.com,*.preview.example.com
CORS_METHODS=GET,POST,OPTIONS
CORS_HEADERS=Authorization,Content-Type
CORS_EXPOSE_HEADERS=X-Request-Id
CORS_CREDENTIALS=true
CORS_MAX_AGE=3600
```

For a deployed Worker, use Wrangler variables:

```jsonc
{
  "vars": {
    "CORS_ORIGINS": "https://app.example.com",
    "CORS_CREDENTIALS": "true"
  }
}
```

CORS controls which responses browsers expose to cross-origin JavaScript. It
does not replace authentication, authorization, CSRF protection, or rate limits.

### `env()` vs `config()`

| Helper | What it reads | Return type | When to use |
|--------|--------------|-------------|-------------|
| `config('app.name')` | The evaluated config tree (from `src/config/*.ts`) | Any (generic) | Reading structured config values with dotted paths |
| `env('APP_SECRET')` | A flat binding from `c.env` | Always `string` | Reading a raw binding directly, without a config file |

## Accessing config in components

`config()` and `env()` work anywhere server-side: in `@Server` methods, `init()`, middleware, and `head()`. They are **server-only** — on the client they return defaults.

To surface config values in a component's render, read them server-side and store in `@State`:

```ts
import { Cossack, Page, State, Server, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';
import { config } from '@cossackframework/framework/config';

@Page({ transport: 'http' })
export default class extends Cossack {
    @State() appName: string = '';
    @State() appEnv: string = '';
    @State() appUrl: string = '';
    @State() locale: string = '';

    @Server()
    async init() {
        this.appName = config('app.name');
        this.appEnv = config('app.env');
        this.appUrl = config('app.url');
        this.locale = config('app.locale');
    }

    head(_ctx: HeadContext): HeadValue {
        return { title: `Config Demo — ${config('app.name')}` };
    }

    render(): TemplateResult {
        return html`
            <h1>${this.appName}</h1>
            <p>Environment: ${this.appEnv}</p>
            <p>URL: ${this.appUrl}</p>
            <p>Locale: ${this.locale}</p>
        `;
    }
}
```

## Accessing config in middleware

Config is available in any registered middleware because the config scope is established **before** user middleware runs:

```ts
// src/middlewares/logging.ts
import { defineServerMiddleware } from '@cossackframework/core';
import { config } from '@cossackframework/framework/config';

export const loggingMiddleware = defineServerMiddleware(async (c, next) => {
    const appName = config('app.name');
    console.log(`[${appName}] ${c.req.method} ${c.req.path}`);
    await next();
});
```

Register it in `src/bootstrap/middlewares.ts`:

```ts
import { loggingMiddleware } from '../middlewares/logging';

const middlewares = [loggingMiddleware];
export default middlewares;
```

## Built-in config consumers

Several framework features read from the config system:

| Feature | Config key | Env var |
|---------|-----------|---------|
| Localization (default locale) | `config('app.locale')` | `APP_LOCALE` |
| SSG (site URL) | `config('app.url')` | `APP_URL` |
| Flash data (signing secret) | `config('app.key')` | `APP_SECRET` |

For example, the locale middleware resolves the default locale from `config('app.locale')` (which reads `APP_LOCALE` via `src/config/app.ts`). The SSG build injects the resolved site URL as `APP_URL` so `config('app.url')` works during static generation.

## Type safety

`config()` can infer return types and auto-complete valid dotted paths when you register your config file's shape. This is **optional** — without it, `config()` works but returns `unknown`.

### Registering types

Export an interface from your config file and augment the `CossackConfigRegistry` interface via `declare module`. This is the same declaration-merging pattern used by the `User` model:

```ts
// src/config/app.ts
import type { EnvFunction } from '@cossackframework/framework/config';

export interface AppConfig {
    name: string;
    env: 'production' | 'development' | 'staging';
    debug: boolean;
    url: string;
    timezone: string;
    locale: string;
    fallback_locale: string;
    key: string;
}

declare module '@cossackframework/framework/config' {
    interface CossackConfigRegistry {
        app: AppConfig;
    }
}

export default ({ env }: { env: EnvFunction }): AppConfig => ({
    // ... values matching AppConfig
});
```

### What you get

Once registered, `config()` infers the exact type at each path:

```ts
config('app.name');   // string
config('app.debug');  // boolean
config('app.env');    // 'production' | 'development' | 'staging'
```

Auto-completion offers valid paths when you type `config('app.')`. Nested objects work too:

```ts
// src/config/database.ts
export interface DatabaseConfig {
    driver: string;
    connections: {
        mysql: { host: string; port: number };
    };
}

declare module '@cossackframework/framework/config' {
    interface CossackConfigRegistry {
        database: DatabaseConfig;
    }
}

// Usage:
config('database.connections.mysql.port'); // number (inferred + auto-completed)
```

### Without registration

If you don't augment `CossackConfigRegistry`, `config()` still works — it returns `unknown` for every key. You can provide a generic explicitly:

```ts
const name = config<string>('app.name'); // explicit type
```

## Client-side security

Config files are **never bundled into the client** — they call `env()` to read secrets and bindings, so shipping them would leak sensitive data. Two layers enforce this:

1. The `virtual:cossack-config` Vite plugin stubs to `{}` on the client environment.
2. The security plugin intercepts any direct import of `src/config/*.ts` on the client and replaces it with an empty module.

This means accidentally importing a config file from a component (e.g. `import { dbConfig } from '../config/database'`) is safe — it resolves to `{}` on the client rather than leaking the file's contents.

## How it works

### Per-request isolation

On Cloudflare Workers, a single isolate serves many concurrent requests. To prevent config races, the framework wraps each request in an `AsyncLocalStorage` scope:

1. A **config middleware** (registered first in `createApp()`) evaluates every `src/config/*.ts` factory with the request's env bindings.
2. It stores the resulting tree in an ALS scope.
3. `config()` and `env()` read from the scope, so every request gets its own values.

This mirrors the same ALS pattern used by `__()` (locale), `db()` (database client), `flash()` (flash data), and `getRequestContext()`.

### SSG

During static generation (`cossack ssg`), there are no live request bindings. The SSG build resolves the site URL from `wrangler.jsonc` / `.env` / shell env (see [Sitemap](./sitemap.md#base-url)) and injects it as `APP_URL` into the config env. Other bindings default to empty — config factories use their fallback values.

## API reference

All exports come from `@cossackframework/framework/config`.

| Function / type | Description |
|---|---|
| `config(key, defaultValue?)` | Reads a value from the config tree via dotted notation (`'app.name'`). When `CossackConfigRegistry` is augmented, infers the return type and auto-completes paths. Returns `defaultValue` when the key is missing or no request scope is active. |
| `env(key, defaultValue?)` | Reads a flat binding from the per-request env (`c.env`), coerced to a string. Returns `defaultValue` (or `''`) when the binding is unset or no request scope is active. |
| `ConfigFactory` | Type of a config file's default export: `({ env }) => Record<string, unknown>`. |
| `EnvFunction` | Type of the `env` function passed to config factories: `(key, defaultValue?) => string`. |
| `ConfigStore` | Internal: the per-request store (`{ env, config }`) held in ALS. |
| `CossackConfigRegistry` | Interface users augment via `declare module` to register typed config shapes for inference. Empty by default. |
| `runWithConfig(store, fn)` | Internal: runs `fn` inside a config ALS scope. Used by the framework's middleware and SSG renderer. |
