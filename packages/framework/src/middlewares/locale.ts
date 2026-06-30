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

function readCookie(c: Context, name: string): string | undefined {
    const header = c.req.header('cookie');
    if (!header) return undefined;
    const re = new RegExp(`(?:^|; )${name}=([^;]*)`);
    const match = header.match(re);
    return match ? decodeURIComponent(match[1]) : undefined;
}

function isSupported(locale: string | undefined): locale is string {
    return !!locale && supportedLocales.some((s: string) => s.toLowerCase() === locale!.toLowerCase());
}

function normalizeSupported(target: string): string | undefined {
    const lower = target.toLowerCase();
    const found = supportedLocales.find((s: string) => s.toLowerCase() === lower);
    return found;
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

        // No `src/lang/` folder → feature is inactive; pass through with the
        // default locale so `getLocale()` still returns something sensible.
        if (supportedLocales.length === 0) {
            const fallback = (c.env as any)?.APP_LOCALE || DEFAULT_LOCALE;
            return runWithLocale({ locale: fallback, messages: {} }, () => next());
        }

        let locale: string | undefined;

        // 1. Explicit user choice via cookie.
        const cookieLocale = readCookie(c, LOCALE_COOKIE_NAME);
        if (isSupported(cookieLocale)) {
            locale = normalizeSupported(cookieLocale);
        }

        // 2. Accept-Language (opt-in).
        if (!locale && autoDetect) {
            const detected = detectBrowserLocale(
                c.req.header('accept-language'),
                supportedLocales,
                buildDefaultLocale,
            );
            if (isSupported(detected)) locale = normalizeSupported(detected);
        }

        // 3. env.APP_LOCALE (deployment default).
        if (!locale) {
            const envLocale = (c.env as any)?.APP_LOCALE;
            if (isSupported(envLocale)) locale = normalizeSupported(envLocale);
        }

        // 4. Build default or hard-coded fallback.
        if (!locale) {
            locale = isSupported(buildDefaultLocale) ? normalizeSupported(buildDefaultLocale)! : DEFAULT_LOCALE;
        }

        const messages = (await loadCatalog(locale)) || {};
        // Register in the catalog Map so getLocaleCatalog() / the hydration
        // payload can read it (the ALS store is only used by __()/getLocale()).
        registerLocale(locale, messages);
        return runWithLocale({ locale, messages }, () => next());
    };
}

/** Default locale middleware (no auto-detection). */
export const localeMiddleware = createLocaleMiddleware();
