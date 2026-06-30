// src/shared/i18n.ts
//
// Localization runtime for Cossack. Provides translation lookup (`__`),
// locale management (`setLocale` / `getLocale` / `isLocale`), placeholder
// replacement, and pluralization driven by `Intl.PluralRules`.
//
// Design notes
// ------------
// * **Server** requests are isolated with AsyncLocalStorage (wired by the
//   framework via {@link setLocaleStoreGetter}) so a single Worker isolate
//   can serve many concurrent locales without races.
// * **Client** uses module-level state — there is only one user per browser
//   tab, so a single current locale is safe. `setLocale` writes a cookie so
//   the next SSR request picks up the user's choice.
// * Locale catalogs are registered lazily; the framework hydrates the active
//   + default catalogs from `window.__INITIAL_STATE__` and dynamic-imports
//   the rest on demand (`setLocale('es')` fetches the `es` chunk, registers
//   it, then swaps).

import { isServer } from './environment';

/** Sentinel passed to {@link setLocale} to resolve from the browser. */
export const AUTO_BROWSER = 'AUTO:BROWSER';

/** Default locale when no other signal is present. */
export const DEFAULT_LOCALE = 'en';

/** A flat JSON catalog of `{ key: "translation" }`. */
export type TranslationCatalog = Record<string, string>;

/** Parameter map for placeholder replacement. */
export type TranslationParams = Record<string, string | number>;

/** Per-request store shape used by the framework's AsyncLocalStorage. */
export interface LocaleStore {
    locale: string;
    messages: TranslationCatalog;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** All registered catalogs keyed by locale code. */
const catalogs = new Map<string, TranslationCatalog>();

/** Locales the app supports (populated by the framework from the build). */
let supportedLocales: string[] = [DEFAULT_LOCALE];

/** Default fallback locale (used for missing keys). */
let defaultLocale = DEFAULT_LOCALE;

/**
 * Client-side current locale. On the server, the per-request store
 * (via {@link localeStoreGetter}) takes precedence.
 */
let currentLocale = DEFAULT_LOCALE;

/** Injected by the framework: returns the active per-request store, if any. */
let localeStoreGetter: (() => LocaleStore | undefined) | null = null;

/**
 * Injected by the framework: loads a locale catalog on demand (used for
 * code-splitting). Resolves with the catalog, which is then registered.
 */
let localeLoader: ((locale: string) => Promise<TranslationCatalog>) | null = null;

/** Memoizes in-flight loads so concurrent `setLocale('es')` calls share work. */
const loading = new Map<string, Promise<TranslationCatalog>>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns the active per-request store on the server, otherwise undefined. */
function requestStore(): LocaleStore | undefined {
    if (isServer && localeStoreGetter) return localeStoreGetter();
    return undefined;
}

/** Reads the catalog for a locale, or undefined if not registered. */
function catalogFor(locale: string): TranslationCatalog | undefined {
    return catalogs.get(locale);
}

/**
 * Case-aware placeholder value transform.
 *
 * - `:NAME` (all caps)        → value uppercased.
 * - `:Name` (Title-case)      → value with first letter upper, rest lower.
 * - `:name` / anything else   → value as-is.
 *
 * Matches Laravel's behavior.
 */
function transformPlaceholder(name: string, value: string): string {
    const isAllUpper = name === name.toUpperCase() && name !== name.toLowerCase();
    if (isAllUpper) return value.toUpperCase();
    const isTitle =
        name.length > 1 &&
        name[0] === name[0].toUpperCase() &&
        name.slice(1) === name.slice(1).toLowerCase();
    if (isTitle) {
        return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    }
    return value;
}

const PLACEHOLDER_RE = /:([A-Za-z][A-Za-z0-9_]*)/g;

/** Replaces `:name` placeholders using `params`, applying case rules. */
export function replacePlaceholders(
    template: string,
    params: TranslationParams,
): string {
    if (!params) return template;
    return template.replace(PLACEHOLDER_RE, (match, name: string) => {
        if (Object.prototype.hasOwnProperty.call(params, name)) {
            return transformPlaceholder(name, String(params[name]));
        }
        // Case-insensitive fallback so `:NAME` still resolves `{ name }`.
        const key = Object.keys(params).find(
            (k) => k.toLowerCase() === name.toLowerCase(),
        );
        if (key !== undefined) {
            return transformPlaceholder(name, String(params[key]));
        }
        return match;
    });
}

/**
 * Canonical CLDR plural category order. The position of a form in a `|`
 * separated string maps to its slot in this list (see {@link pluralCategoriesFor}).
 */
const CLDR_FULL: Intl.LDMLPluralRule[] = [
    'zero',
    'one',
    'two',
    'few',
    'many',
    'other',
];

/**
 * Maps a form count to the ordered CLDR categories it represents.
 *
 * | forms | categories                          | example locales     |
 * |-------|-------------------------------------|---------------------|
 * | 1     | other                               | (no pluralization)  |
 * | 2     | one, other                          | English, French     |
 * | 3     | one, few, other                     | Polish              |
 * | 4     | one, few, many, other               | Russian, Ukrainian  |
 * | 5     | zero, one, few, many, other         | (rare)              |
 * | 6     | zero, one, two, few, many, other    | Arabic              |
 */
function pluralCategoriesFor(count: number): Intl.LDMLPluralRule[] {
    if (count <= 1) return ['other'];
    if (count === 2) return ['one', 'other'];
    if (count === 3) return ['one', 'few', 'other'];
    if (count === 4) return ['one', 'few', 'many', 'other'];
    if (count === 5) return ['zero', 'one', 'few', 'many', 'other'];
    return CLDR_FULL;
}

/**
 * Selects the right form from a `|`-separated plural template using
 * `Intl.PluralRules` for the given locale.
 */
export function selectPluralForm(
    template: string,
    count: number,
    locale: string,
): string {
    const forms = template.split('|').map((f) => f.trim());
    if (forms.length <= 1) return template;
    const categories = pluralCategoriesFor(forms.length);
    let rule: Intl.LDMLPluralRule;
    try {
        rule = new Intl.PluralRules(locale).select(count);
    } catch {
        // Locale data missing — fall back to English semantics.
        rule = new Intl.PluralRules(DEFAULT_LOCALE).select(count);
    }
    const idx = categories.indexOf(rule);
    if (idx >= 0 && idx < forms.length) return forms[idx];
    // Unknown category → last form is always the "other"/fallback.
    return forms[forms.length - 1];
}

/**
 * Parses an `Accept-Language` header and picks the best match from
 * `supported`, honoring q-values and `*`. Returns `fallback`
 * (or the first supported) when nothing matches.
 *
 * Used by the framework's locale middleware on the server; exposed for
 * testing and advanced usage.
 *
 * @example
 * detectBrowserLocale('fr-FR,fr;q=0.9,en;q=0.8', ['en', 'es', 'fr'], 'en')
 * // → 'fr'
 */
export function detectBrowserLocale(
    acceptLanguage: string | null | undefined,
    supported: string[],
    fallback: string = DEFAULT_LOCALE,
): string {
    if (!acceptLanguage || supported.length === 0) return fallback;

    const lowerSupported = supported.map((s) => s.toLowerCase());
    const baseOfSupported = lowerSupported.map((s) => s.split('-')[0]);

    /** Exact tag → base-language match against the supported list. */
    const matchAgainst = (tag: string): string | undefined => {
        let i = lowerSupported.indexOf(tag);
        if (i >= 0) return supported[i];
        const base = tag.split('-')[0];
        i = baseOfSupported.indexOf(base);
        if (i >= 0) return supported[i];
        return undefined;
    };

    const entries = acceptLanguage
        .split(',')
        .map((part) => {
            const [tag, q] = part.trim().split(';q=');
            const quality = q ? parseFloat(q) : 1;
            return {
                tag: tag.trim().toLowerCase(),
                quality: Number.isFinite(quality) ? quality : 1,
            };
        })
        .filter((e) => e.tag.length > 0)
        .sort((a, b) => b.quality - a.quality);

    let star = false;
    for (const { tag } of entries) {
        if (tag === '*') {
            star = true;
            continue;
        }
        // Exact match (e.g. "en-us" → "en-us") then base match ("en-us" → "en").
        const exact = matchAgainst(tag);
        if (exact) return exact;
    }
    // `*` (or no preference at all) → first supported locale.
    if (star || entries.length === 0) return supported[0];
    return fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers a catalog for a locale. The framework calls this during
 * bootstrap (hydrating the active + default catalogs) and after a dynamic
 * import (when `setLocale('es')` loads the `es` chunk).
 *
 * Safe to call multiple times for the same locale — later writes merge.
 */
export function registerLocale(
    locale: string,
    messages: TranslationCatalog,
): void {
    const existing = catalogs.get(locale) ?? {};
    catalogs.set(locale, { ...existing, ...messages });
}

/** Returns the catalog for a locale (or the current one if omitted). */
export function getLocaleCatalog(locale?: string): TranslationCatalog | undefined {
    return catalogFor(locale ?? getLocale());
}

/** Returns the list of locales the app has catalogs for. */
export function getSupportedLocales(): string[] {
    return [...supportedLocales];
}

/** @internal Framework wires the supported locales from the build. */
export function setSupportedLocales(locales: string[]): void {
    supportedLocales = locales.length > 0 ? [...locales] : [DEFAULT_LOCALE];
}

/** Returns the configured default (fallback) locale. */
export function getDefaultLocale(): string {
    return defaultLocale;
}

/** Overrides the default (fallback) locale. Call once at startup. */
export function setDefaultLocale(locale: string): void {
    if (locale) defaultLocale = locale;
}

/**
 * @internal Framework injects a per-request store getter backed by
 * AsyncLocalStorage so server-side `__()` reads the right locale per request.
 */
export function setLocaleStoreGetter(
    getter: (() => LocaleStore | undefined) | null,
): void {
    localeStoreGetter = getter;
}

/**
 * @internal Framework injects a loader that dynamic-imports a locale chunk
 * on demand. Enables code-splitting: only the active + default catalogs ship
 * in the initial bundle; the rest are fetched lazily by {@link setLocale}.
 */
export function setLocaleLoader(
    loader: ((locale: string) => Promise<TranslationCatalog>) | null,
): void {
    localeLoader = loader;
}

/**
 * Returns the active locale.
 *
 * Resolution order:
 * 1. Per-request store (server only, via AsyncLocalStorage).
 * 2. Current client-side locale.
 * 3. Default locale.
 */
export function getLocale(): string {
    const store = requestStore();
    if (store) return store.locale;
    return currentLocale;
}

/** True if `locale` is a supported locale code. */
export function isLocale(locale: string): boolean {
    return supportedLocales.some((s) => s.toLowerCase() === locale.toLowerCase());
}

/**
 * Resolves a sentinel like {@link AUTO_BROWSER} to a concrete locale.
 *
 * - On the client, `AUTO:BROWSER` reads `navigator.languages` and picks the
 *   best supported match.
 * - On the server, returns `undefined` — auto-detection must happen in the
 *   framework's locale middleware (where the `Accept-Language` header lives).
 */
export function resolveAutoLocale(locale: string): string | undefined {
    if (locale !== AUTO_BROWSER) return locale;
    if (isServer) return undefined;
    if (typeof navigator !== 'undefined' && Array.isArray(navigator.languages)) {
        return detectBrowserLocale(
            navigator.languages.join(','),
            supportedLocales,
            defaultLocale,
        );
    }
    return undefined;
}

/**
 * Ensures a locale's catalog is registered, loading it on demand via the
 * injected loader (if any). Memoized so concurrent calls share one import.
 */
async function ensureCatalog(locale: string): Promise<void> {
    if (catalogFor(locale)) return;
    if (!localeLoader) return;
    if (!supportedLocales.some((s) => s.toLowerCase() === locale.toLowerCase())) {
        return;
    }
    let inflight = loading.get(locale);
    if (!inflight) {
        inflight = localeLoader(locale)
            .then((messages) => {
                registerLocale(locale, messages);
                loading.delete(locale);
                return messages;
            })
            .catch((err) => {
                loading.delete(locale);
                throw err;
            });
        loading.set(locale, inflight);
    }
    await inflight;
}

const LOCALE_COOKIE = 'cossack_locale';
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function writeLocaleCookie(locale: string): void {
    if (isServer) return;
    if (typeof document === 'undefined') return;
    try {
        document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(
            locale,
        )}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {
        // Restricted environments (SSR previews, etc.) — ignore.
    }
}

/** Reads a previously persisted locale from the cookie (client only). */
export function readLocaleCookie(): string | undefined {
    if (isServer || typeof document === 'undefined') return undefined;
    const match = document.cookie.match(
        new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`),
    );
    return match ? decodeURIComponent(match[1]) : undefined;
}

/** @internal Cookie name (exported for the server middleware to read). */
export const LOCALE_COOKIE_NAME = LOCALE_COOKIE;

function dispatchLocaleEvent(locale: string): void {
    if (isServer) return;
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent('localechange', { detail: { locale } }));
}

function dispatchLocaleError(error: unknown): void {
    if (isServer) return;
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(
        new CustomEvent('localeerror', { detail: { error: String(error) } }),
    );
}

/**
 * Switches the active locale.
 *
 * Behavior:
 * - On the **client**: persists the choice to a cookie, dynamically loads the
 *   catalog if needed (via the framework-provided loader), registers it, swaps
 *   the current locale, and dispatches a `localechange` event. Returns a
 *   Promise that resolves once the new catalog is active. Optimistic: while
 *   loading, the previous locale keeps rendering (no flicker to raw keys).
 * - On the **server**: throws. Per-request locale is owned by the framework's
 *   locale middleware (resolved from `APP_LOCALE`, the `cossack_locale` cookie,
 *   and `Accept-Language`). Use middleware configuration to change server-side
 *   locale resolution.
 *
 * Pass {@link AUTO_BROWSER} to resolve from the user's browser preferences
 * (client only).
 *
 * @example
 * ```ts
 * await setLocale('es');                 // fetch es chunk, swap
 * await setLocale(AUTO_BROWSER);         // follow navigator.languages
 * ```
 */
export async function setLocale(locale: string): Promise<void> {
    if (isServer) {
        throw new Error(
            '[Cossack] setLocale() cannot be called on the server. Per-request ' +
                'locale is resolved from APP_LOCALE / the cossack_locale cookie / ' +
                "the Accept-Language header by the framework's locale middleware. " +
                'To change the default, set the APP_LOCALE env var.',
        );
    }

    const resolved = resolveAutoLocale(locale);
    if (!resolved) {
        throw new Error(
            `[Cossack] Could not resolve locale "${locale}" on the client. ` +
                'Pass a concrete locale code (e.g. "es") instead.',
        );
    }

    // Load the catalog on demand. If the load fails, keep the previous
    // locale and surface a `localeerror` event so the UI can recover.
    try {
        await ensureCatalog(resolved);
    } catch (err) {
        dispatchLocaleError(err);
        throw err;
    }

    currentLocale = resolved;
    writeLocaleCookie(resolved);
    dispatchLocaleEvent(resolved);
}

/**
 * Translates a key for the current locale.
 *
 * - Looks up `key` in the current locale's catalog; on miss, falls back to the
 *   default locale's catalog; on a second miss, returns `key` unchanged.
 * - Supports **translation strings as keys** — pass the default-language text
 *   directly (e.g. `__('I love programming.')`).
 * - **Placeholders** prefixed with `:` are replaced from `params`, with
 *   case-aware transforms (`:Name` → Title, `:NAME` → UPPER).
 * - **Pluralization**: if the resolved template contains `|` and `params.count`
 *   is a number, the right form is picked with `Intl.PluralRules`.
 *
 * @example
 * ```ts
 * __('greeting')                              // "Hello"
 * __('welcome', { name: 'John' })             // "Welcome, John"
 * __('apples', { count: 1 })                  // "You have 1 apple"
 * __('I love programming.')                   // "Me encanta programar." (es)
 * ```
 */
export function __(
    key: string,
    params?: TranslationParams,
): string {
    if (!key) return '';

    const activeLocale = getLocale();
    const store = requestStore();

    // 1. Active locale lookup (per-request store on server, catalog map on client).
    let template: string | undefined;
    if (store && Object.prototype.hasOwnProperty.call(store.messages, key)) {
        template = store.messages[key];
    } else {
        const activeCat = catalogFor(activeLocale);
        if (activeCat && Object.prototype.hasOwnProperty.call(activeCat, key)) {
            template = activeCat[key];
        }
    }

    // 2. Fallback to the default locale's catalog (for missing keys).
    if (template === undefined && activeLocale !== defaultLocale) {
        const defaultCat = catalogFor(defaultLocale);
        if (defaultCat && Object.prototype.hasOwnProperty.call(defaultCat, key)) {
            template = defaultCat[key];
        }
    }

    // 3. Final fallback: the key itself (default-language text by convention).
    if (template === undefined) template = key;

    // Pluralization: triggered by `|` in the template AND a numeric count.
    if (template.indexOf('|') !== -1 && params && typeof params.count === 'number') {
        template = selectPluralForm(template, params.count, activeLocale);
    }

    if (params) template = replacePlaceholders(template, params);
    return template;
}

/** @internal Reset all module state — tests only. */
export function __resetI18nForTests(): void {
    catalogs.clear();
    supportedLocales = [DEFAULT_LOCALE];
    defaultLocale = DEFAULT_LOCALE;
    currentLocale = DEFAULT_LOCALE;
    localeStoreGetter = null;
    localeLoader = null;
    loading.clear();
}

/**
 * @internal Sets the client-side current locale directly, bypassing the
 * loader/cookie machinery. Used by the framework during hydration.
 */
export function __hydrateLocale(locale: string, messages?: TranslationCatalog): void {
    if (messages) registerLocale(locale, messages);
    if (locale) currentLocale = locale;
}
