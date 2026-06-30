// src/i18n-globals.ts
//
// Registers the i18n helpers (`__`, `setLocale`, `getLocale`, `isLocale`) on
// `globalThis` so they can be called as bare names inside `render()` without
// an explicit import — matching the plan's `__('key')` ergonomics.
//
// Imported for its side effects from the framework's server (router) and
// client (createClientApp) entry points. The underlying implementations live
// in `@cossackframework/core`; this file only wires them as globals once.

import {
    __,
    setLocale,
    getLocale,
    isLocale,
} from '@cossackframework/core';

let installed = false;

/** Assigns the i18n helpers to `globalThis`. Idempotent. */
export function installI18nGlobals(): void {
    if (installed) return;
    installed = true;
    const g = globalThis as any;
    g.__ = __;
    g.setLocale = setLocale;
    g.getLocale = getLocale;
    g.isLocale = isLocale;
}

// Install immediately on import in both server and client environments.
installI18nGlobals();
