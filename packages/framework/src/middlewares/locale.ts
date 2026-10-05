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
//   3. config('app.locale')    — the deployment-wide default (from `src/config/app.ts`,
//                               which reads the `APP_LOCALE` env var).
//   4. 'en'                     — hard-coded last-resort fallback.
//
// When the project has no `src/lang/` folder, the middleware is a no-op:
// supported locales is empty and `__()` returns keys unchanged.

import type { Context, MiddlewareHandler } from 'hono';
import {
    detectBrowserLocale,
    type TranslationCatalog,
    LOCALE_COOKIE_NAME,
    DEFAULT_LOCALE,
} from '@cossackframework/core';
import {
    supportedLocales,
    defaultLocale as buildDefaultLocale,
    loadCatalog,
} from 'virtual:cossack-lang';
import { ensureLocaleAlsWired, runWithLocale } from '../i18n-context.js';
import { config } from '../config.js';

export interface LocaleMiddlewareOptions {
    /** Resolve from `Accept-Language` when no cookie is set. Default: false. */
    autoDetectBrowser?: boolean;
    /** Authored URL/content identity takes precedence over visitor preferences. */
    resolveLocale?: (context: Context) => string | undefined;
}

/** A request's fallback follows its own environment, never the first request. */
function resolveDefaultLocale(requested?: string): string {
    const preferred = normalizeRequestLocale(requested || buildDefaultLocale);
    return preferred && supportedLocales.includes(preferred) ? preferred : supportedLocales[0] || DEFAULT_LOCALE;
}

function normalizeRequestLocale(locale: string): string | undefined {
    const lower = locale.toLowerCase();
    return supportedLocales.find(value => value.toLowerCase() === lower)
        ?? supportedLocales.find(value => value.toLowerCase() === lower.split('-')[0]);
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

/** Keep catalog references inside the request, including its default fallback. */
async function requestCatalogs(): Promise<Record<string, TranslationCatalog>> {
    const result: Record<string, TranslationCatalog> = {};
    await Promise.all(supportedLocales.map(async locale => {
        const messages = await loadCatalog(locale);
        if (messages) result[locale] = messages;
    }));
    return result;
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
        const resolvedDefaultLocale = resolveDefaultLocale(config('app.locale', DEFAULT_LOCALE));

        const explicitLocale = options.resolveLocale?.(c);

        // No `src/lang/` folder → feature is inactive; pass through with the
        // default locale so `getLocale()` still returns something sensible.
        if (supportedLocales.length === 0) {
            const fallback = explicitLocale || config('app.locale', DEFAULT_LOCALE);
            return runWithLocale({ locale: fallback, messages: {}, defaultLocale: fallback, catalogs: {} }, () => next());
        }

        let locale: string | undefined;
        if (explicitLocale) {
            locale = supportedLocales.find(value => value.toLowerCase() === explicitLocale.toLowerCase());
            if (!locale) throw Object.assign(new Error('Content locale has no application catalog.'), { code: 'COSSACK_MARKDOWN_LOCALE_UNAVAILABLE' });
        }

        // 1. Explicit user choice via cookie.
        const cookieLocale = readCookie(c, LOCALE_COOKIE_NAME);
        if (!locale && cookieLocale) {
            const normalized = normalizeRequestLocale(cookieLocale);
            if (isSupported(normalized)) locale = normalized;
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

        // 3. config('app.locale') — the deployment default (reads APP_LOCALE
        //    via src/config/app.ts, but config values can be overridden there).
        if (!locale) {
            const envLocale = config('app.locale', '');
            if (envLocale) locale = normalizeRequestLocale(envLocale);
        }

        // 4. Guaranteed-supported fallback: the resolved default (which is
        //    always a locale with a catalog), never a hardcoded 'en' that
        //    might not exist in src/lang/.
        if (!locale) {
            locale = resolvedDefaultLocale;
        }

        const catalogs = await requestCatalogs();
        const messages = catalogs[locale] || {};
        return runWithLocale({ locale, messages, defaultLocale: resolvedDefaultLocale, catalogs }, () => next());
    };
}

/** Default locale middleware (no auto-detection). */
export const localeMiddleware = createLocaleMiddleware();
