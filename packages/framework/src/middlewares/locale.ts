// src/middlewares/locale.ts
//
// Server-side locale resolution. Runs once per request, before SSR, and
// wraps `next()` in an AsyncLocalStorage scope (see ../i18n-context.ts) so
// `__()` resolves the right locale for the current request.
//
// Resolution order (first match wins):
//   1. `cossack_locale` cookie  — the user's explicit choice (set client-side
//      by `setLocale()`).
//   2. `Accept-Language` header — only when `autoDetectBrowser` is enabled
//      (opt-in; can affect caching/SEO so it's off by default).
//   3. `env.APP_LOCALE`         — the deployment-wide default from wrangler vars.
//   4. `'en'`                    — hard-coded last-resort fallback.
//
// When the project has no `src/lang/` folder, the middleware is a no-op:
// supported locales is empty and `__()` returns keys unchanged.

import type { Context, MiddlewareHandler } from 'hono';
import {
    detectBrowserLocale,
    registerLocale,
    getLocaleCatalog,
    setSupportedLocales,
    setDefaultLocale,
    normalizeLocale,
    LOCALE_COOKIE_NAME,
    DEFAULT_LOCALE,
} from '@cossackframework/core';
import {
    supportedLocales,
    defaultLocale as buildDefaultLocale,
    loadCatalog,
} from 'virtual:cossack-lang';
import { ensureLocaleAlsWired, runWithLocale } from '../i18n-context';

export interface LocaleMiddlewareOptions {
    /** Resolve from `Accept-Language` when no cookie is set. Default: false. */
    autoDetectBrowser?: boolean;
}

/**
 * One-time synchronization of the build-time locale config into core's i18n
 * runtime. Without this, server-side `getSupportedLocales()` / `getDefaultLocale()`
 * (used by the hydration payload builder and the `__()` fallback chain) would
 * return the hardcoded defaults instead of the real values.
 *
 * Also resolves a **guaranteed-supported** default: the build default is only
 * used when it actually has a catalog; otherwise the first supported locale
 * wins. This prevents scenarios like `cossack lang publish --locale=es` (only
 * `es.json`) from anchoring the fallback chain to a catalog-less `'en'`.
 */
let coreSeeded = false;
let resolvedDefaultLocale = DEFAULT_LOCALE;
function seedCoreI18n(requestedDefault?: string): void {
    if (coreSeeded) return;
    coreSeeded = true;
    setSupportedLocales(supportedLocales);

    const envDefault = requestedDefault ? normalizeLocale(requestedDefault) : undefined;
    const preferred = envDefault || buildDefaultLocale;
    resolvedDefaultLocale =
        supportedLocales.includes(preferred)
            ? preferred
            : supportedLocales[0] || DEFAULT_LOCALE;
    setDefaultLocale(resolvedDefaultLocale);
}

function readCookie(c: Context, name: string): string | undefined {
    const header = c.req.header('cookie');
    if (!header) return undefined;
    const re = new RegExp(`(?:^|; )${name}=([^;]*)`);
    const match = header.match(re);
    if (!match) return undefined;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        // Malformed cookie value (e.g. a stray `%`). Treat as no cookie so
        // the request falls back to the normal resolution chain instead of
        // crashing.
        return undefined;
    }
}

function isSupported(locale: string | undefined): locale is string {
    return !!locale && supportedLocales.some((s: string) => s.toLowerCase() === locale!.toLowerCase());
}

/**
 * Loads and registers a locale catalog into core's catalog Map, skipping the
 * work if the catalog is already registered. This avoids re-merging the same
 * object on every request while ensuring the `__()` fallback chain can reach
 * both the active and the default locale's translations.
 */
async function ensureCatalogRegistered(locale: string): Promise<void> {
    if (getLocaleCatalog(locale)) return;
    const messages = await loadCatalog(locale);
    if (messages) registerLocale(locale, messages);
}

/**
 * Builds a Hono middleware that resolves the request locale and wraps the
 * remainder of the request in a per-request ALS scope.
 */
export function createLocaleMiddleware(
    options: LocaleMiddlewareOptions = {},
): MiddlewareHandler {
    const autoDetect = options.autoDetectBrowser === true;
    return async (c, next) => {
        ensureLocaleAlsWired();
        seedCoreI18n((c.env as any)?.APP_LOCALE);

        // No `src/lang/` folder → feature is inactive; pass through with the
        // default locale so `getLocale()` still returns something sensible.
        if (supportedLocales.length === 0) {
            const fallback = (c.env as any)?.APP_LOCALE || DEFAULT_LOCALE;
            return runWithLocale({ locale: fallback, messages: {} }, () => next());
        }

        let locale: string | undefined;

        // 1. Explicit user choice via cookie.
        const cookieLocale = readCookie(c, LOCALE_COOKIE_NAME);
        if (cookieLocale) {
            locale = normalizeLocale(cookieLocale);
        }

        // 2. Accept-Language (opt-in).
        if (!locale && autoDetect) {
            const detected = detectBrowserLocale(
                c.req.header('accept-language'),
                supportedLocales,
                resolvedDefaultLocale,
            );
            if (isSupported(detected)) locale = detected;
        }

        // 3. env.APP_LOCALE (deployment default).
        if (!locale) {
            const envLocale = (c.env as any)?.APP_LOCALE;
            if (envLocale) locale = normalizeLocale(envLocale);
        }

        // 4. Guaranteed-supported fallback: the resolved default (which is
        //    always a locale with a catalog), never a hardcoded 'en' that
        //    might not exist in src/lang/.
        if (!locale) {
            locale = resolvedDefaultLocale;
        }

        // Ensure both the active and the default locale's catalogs are
        // registered in core's Map so `__()` can fall back from active →
        // default when a key is missing. `ensureCatalogRegistered` skips the
        // work when the catalog is already loaded (common on hot paths).
        await ensureCatalogRegistered(locale);
        if (resolvedDefaultLocale !== locale) {
            await ensureCatalogRegistered(resolvedDefaultLocale);
        }

        const messages = getLocaleCatalog(locale) || {};
        return runWithLocale({ locale, messages }, () => next());
    };
}

/** Default locale middleware (no auto-detection). */
export const localeMiddleware = createLocaleMiddleware();
