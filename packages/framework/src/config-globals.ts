// src/config-globals.ts
//
// Registers the config accessors (`config`, `env`, `binding`) on `globalThis`
// so they can be called as bare names — in `render()`, page `@Server` methods,
// middlewares, and the auth module — without an explicit import. This mirrors
// `i18n-globals.ts`, which does the same for the `__` / `setLocale` helpers.
//
// Imported for its side effects from the framework's server (index, router)
// and client (createClientApp) entry points. The underlying implementations
// live in `./config`; this file only wires them as globals once.
//
// On the client or outside a request scope, all three return safe defaults
// (`config`/`env` → their default arg or `''`/`undefined`; `binding` →
// `undefined`) — matching the behavior of the imported versions.

import { config, env, binding } from './config';

let installed = false;

/** Assigns the config accessors to `globalThis`. Idempotent. */
export function installConfigGlobals(): void {
    if (installed) return;
    installed = true;
    const g = globalThis as any;
    g.config = config;
    g.env = env;
    g.binding = binding;
}

// Install immediately on import in both server and client environments.
installConfigGlobals();

// Type the bare globals so user code (and the framework's own templates) can
// call `config(...)`, `env(...)`, `binding(...)` without an import. We reuse
// the fully-typed overloads from `./config` (via `typeof`) so callers get the
// same dotted-path inference and return types as the imported versions.
declare global {
    const config: typeof import('./config').config;
    const env: typeof import('./config').env;
    const binding: typeof import('./config').binding;
}
