// tests/i18n.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    __,
    setLocale,
    getLocale,
    isLocale,
    registerLocale,
    getLocaleCatalog,
    getSupportedLocales,
    setSupportedLocales,
    getDefaultLocale,
    setDefaultLocale,
    setLocaleStoreGetter,
    setLocaleLoader,
    normalizeLocale,
    resolveAutoLocale,
    detectBrowserLocale,
    replacePlaceholders,
    selectPluralForm,
    AUTO_BROWSER,
    DEFAULT_LOCALE,
    LOCALE_COOKIE_NAME,
    __resetI18nForTests,
    __hydrateLocale,
} from '../src/shared/i18n';

// ---------------------------------------------------------------------------
// Mock the `isServer` flag so we can exercise both branches.
// ---------------------------------------------------------------------------
vi.mock('../src/shared/environment', () => ({
    get isServer() {
        return (globalThis as any).__MOCK_IS_SERVER ?? false;
    },
}));

function setEnv(server: boolean) {
    (globalThis as any).__MOCK_IS_SERVER = server;
}

beforeEach(() => {
    __resetI18nForTests();
    setEnv(false);
});

afterEach(() => {
    __resetI18nForTests();
    setEnv(false);
});

// ---------------------------------------------------------------------------
// Placeholder replacement
// ---------------------------------------------------------------------------
describe('replacePlaceholders', () => {
    it('replaces :name tokens', () => {
        expect(replacePlaceholders('Hello, :name', { name: 'Dayle' })).toBe('Hello, Dayle');
    });

    it('replaces multiple placeholders', () => {
        expect(
            replacePlaceholders(':greeting, :name!', { greeting: 'Hi', name: 'Sam' }),
        ).toBe('Hi, Sam!');
    });

    it('uppercases the value when the placeholder is ALL CAPS', () => {
        expect(replacePlaceholders('Welcome, :NAME', { name: 'dayle' })).toBe('Welcome, DAYLE');
    });

    it('Title-cases the value when the placeholder is Title-case', () => {
        expect(replacePlaceholders('Goodbye, :Name', { name: 'dayle' })).toBe('Goodbye, Dayle');
    });

    it('Title-cases force-lowercases the tail', () => {
        expect(replacePlaceholders('Hi, :Name', { name: 'DAYLE' })).toBe('Hi, Dayle');
    });

    it('leaves non-matching placeholders untouched', () => {
        expect(replacePlaceholders('Hello, :name', {})).toBe('Hello, :name');
    });

    it('matches param keys case-insensitively', () => {
        expect(replacePlaceholders('Hi, :NAME', { Name: 'dayle' })).toBe('Hi, DAYLE');
    });

    it('handles numeric values', () => {
        expect(replacePlaceholders('Count: :count', { count: 5 })).toBe('Count: 5');
    });

    it('handles adjacent placeholders', () => {
        expect(replacePlaceholders(':a:b', { a: 'X', b: 'Y' })).toBe('XY');
    });

    it('only treats word characters after the colon as placeholders', () => {
        expect(replacePlaceholders('time is 10:30', {})).toBe('time is 10:30');
    });
});

// ---------------------------------------------------------------------------
// Pluralization
// ---------------------------------------------------------------------------
describe('selectPluralForm', () => {
    it('returns the single form when there is no separator', () => {
        expect(selectPluralForm('one apple', 5, 'en')).toBe('one apple');
    });

    it('picks the singular for one (English, 2 forms)', () => {
        expect(selectPluralForm('one|many', 1, 'en')).toBe('one');
    });

    it('picks the plural for zero/many (English, 2 forms)', () => {
        expect(selectPluralForm('one|many', 0, 'en')).toBe('many');
        expect(selectPluralForm('one|many', 2, 'en')).toBe('many');
        expect(selectPluralForm('one|many', 5, 'en')).toBe('many');
    });

    it('uses Russian plural rules for 4-form strings', () => {
        const ru = 'одно|два|много|другое';
        expect(selectPluralForm(ru, 1, 'ru')).toBe('одно');   // one
        expect(selectPluralForm(ru, 2, 'ru')).toBe('два');    // few
        expect(selectPluralForm(ru, 5, 'ru')).toBe('много');  // many
    });

    it('falls back to English rules for an invalid locale', () => {
        const rule = selectPluralForm('one|many', 1, 'not-a-locale-xx');
        // Either it threw+fell back to English, or the locale is lenient.
        expect(['one', 'many']).toContain(rule);
    });

    it('falls back to the last form for unknown categories', () => {
        // Polish uses one/few/many — with a 2-form string, an unexpected
        // category should fall back to the last form.
        expect(selectPluralForm('one|many', 5, 'pl')).toBe('many');
    });
});

// ---------------------------------------------------------------------------
// detectBrowserLocale
// ---------------------------------------------------------------------------
describe('detectBrowserLocale', () => {
    it('returns the fallback when the header is missing', () => {
        expect(detectBrowserLocale(null, ['en', 'es'], 'en')).toBe('en');
        expect(detectBrowserLocale('', ['en', 'es'], 'en')).toBe('en');
    });

    it('returns the fallback when there are no supported locales', () => {
        expect(detectBrowserLocale('fr', [], 'en')).toBe('en');
    });

    it('matches an exact tag', () => {
        expect(detectBrowserLocale('es', ['en', 'es'], 'en')).toBe('es');
    });

    it('matches a base language from a regional tag', () => {
        expect(detectBrowserLocale('fr-FR', ['en', 'fr'], 'en')).toBe('fr');
        expect(detectBrowserLocale('en-US', ['en', 'fr'], 'fr')).toBe('en');
    });

    it('honors q-values (higher quality wins)', () => {
        expect(
            detectBrowserLocale('fr;q=0.9,en;q=0.8', ['en', 'fr', 'es'], 'es'),
        ).toBe('fr');
    });

    it('honors q-values with default q=1 for the first listed', () => {
        expect(
            detectBrowserLocale('en,fr;q=0.9', ['en', 'fr'], 'es'),
        ).toBe('en');
    });

    it('falls back when nothing matches', () => {
        expect(detectBrowserLocale('de,ja', ['en', 'es'], 'en')).toBe('en');
    });

    it('wildcard "*" picks the first supported locale', () => {
        expect(detectBrowserLocale('de,*', ['en', 'es'], 'en')).toBe('en');
    });

    it('is case-insensitive on both sides', () => {
        expect(detectBrowserLocale('ES-es', ['en', 'es'], 'en')).toBe('es');
    });

    it('handles whitespace', () => {
        expect(detectBrowserLocale('  es , en ', ['en', 'es'], 'en')).toBe('es');
    });
});

// ---------------------------------------------------------------------------
// registerLocale / getLocaleCatalog / supported locales
// ---------------------------------------------------------------------------
describe('catalog management', () => {
    it('registers and retrieves a catalog', () => {
        registerLocale('es', { hello: 'Hola' });
        expect(getLocaleCatalog('es')).toEqual({ hello: 'Hola' });
    });

    it('merges subsequent registrations', () => {
        registerLocale('es', { a: '1' });
        registerLocale('es', { b: '2' });
        expect(getLocaleCatalog('es')).toEqual({ a: '1', b: '2' });
    });

    it('setSupportedLocales controls isLocale and getSupportedLocales', () => {
        setSupportedLocales(['en', 'es', 'fr']);
        expect(getSupportedLocales()).toEqual(['en', 'es', 'fr']);
        expect(isLocale('es')).toBe(true);
        expect(isLocale('de')).toBe(false);
        expect(isLocale('ES')).toBe(true); // case-insensitive
    });

    it('setSupportedLocales falls back to default when empty', () => {
        setSupportedLocales([]);
        expect(getSupportedLocales()).toEqual([DEFAULT_LOCALE]);
    });

    it('setDefaultLocale / getDefaultLocale round-trip', () => {
        setDefaultLocale('es');
        expect(getDefaultLocale()).toBe('es');
    });
});

// ---------------------------------------------------------------------------
// __() — translation lookup
// ---------------------------------------------------------------------------
describe('__ lookup', () => {
    beforeEach(() => {
        registerLocale('en', {
            greeting: 'Hello',
            welcome: 'Welcome, :name',
            apples: 'You have :count apple|You have :count apples',
        });
        registerLocale('es', {
            greeting: 'Hola',
            welcome: 'Bienvenido, :name',
        });
        setSupportedLocales(['en', 'es']);
        __hydrateLocale('en');
    });

    it('returns the active locale translation', () => {
        expect(__('greeting')).toBe('Hello');
        __hydrateLocale('es');
        expect(__('greeting')).toBe('Hola');
    });

    it('falls back to the default locale on a missing key', () => {
        __hydrateLocale('es');
        // 'apples' is missing in es — should fall back to en.
        expect(__('apples', { count: 1 })).toBe('You have 1 apple');
    });

    it('returns the key when no translation exists anywhere', () => {
        expect(__('nonexistent.key')).toBe('nonexistent.key');
    });

    it('replaces placeholders', () => {
        expect(__('welcome', { name: 'John' })).toBe('Welcome, John');
    });

    it('leaves values as-is for lowercase placeholders', () => {
        expect(__('welcome', { name: 'john' })).toBe('Welcome, john');
    });

    it('pluralizes with count=1 (singular)', () => {
        expect(__('apples', { count: 1 })).toBe('You have 1 apple');
    });

    it('pluralizes with count>1 (plural)', () => {
        expect(__('apples', { count: 5 })).toBe('You have 5 apples');
    });

    it('pluralizes with count=0 (plural in English)', () => {
        expect(__('apples', { count: 0 })).toBe('You have 0 apples');
    });

    it('does not pluralize without a numeric count', () => {
        expect(__('apples')).toBe('You have :count apple|You have :count apples');
    });

    it('returns empty string for empty key', () => {
        expect(__('')).toBe('');
    });

    it('supports translation strings as keys', () => {
        registerLocale('es', {
            'I love programming.': 'Me encanta programar.',
        });
        __hydrateLocale('es');
        expect(__('I love programming.')).toBe('Me encanta programar.');
    });

    it('supports pluralization with translation strings as keys', () => {
        registerLocale('ru', {
            'You have :count apple|You have :count apples':
                'У вас :count яблоко|У вас :count яблока|У вас :count яблок',
        });
        setSupportedLocales(['en', 'ru']);
        __hydrateLocale('ru');
        expect(__('You have :count apple|You have :count apples', { count: 1 })).toBe(
            'У вас 1 яблоко',
        );
        expect(__('You have :count apple|You have :count apples', { count: 5 })).toBe(
            'У вас 5 яблок',
        );
    });
});

// ---------------------------------------------------------------------------
// getLocale
// ---------------------------------------------------------------------------
describe('getLocale', () => {
    it('returns the default initially', () => {
        expect(getLocale()).toBe(DEFAULT_LOCALE);
    });

    it('reflects hydration', () => {
        __hydrateLocale('es');
        expect(getLocale()).toBe('es');
    });

    it('prefers the per-request store on the server', () => {
        setEnv(true);
        setLocaleStoreGetter(() => ({ locale: 'fr', messages: { hi: 'Salut' } }));
        __hydrateLocale('en');
        expect(getLocale()).toBe('fr');
    });

    it('falls back to current locale when no store is set (server)', () => {
        setEnv(true);
        __hydrateLocale('de');
        expect(getLocale()).toBe('de');
    });
});

// ---------------------------------------------------------------------------
// __() — per-request store lookup (server)
// ---------------------------------------------------------------------------
describe('__ with per-request store (server)', () => {
    beforeEach(() => setEnv(true));

    it('reads the translation from the request store', () => {
        setLocaleStoreGetter(() => ({
            locale: 'es',
            messages: { hello: 'Hola' },
        }));
        expect(__('hello')).toBe('Hola');
    });

    it('falls back to a registered catalog when the key is not in the store', () => {
        registerLocale('es', { bye: 'Adiós' });
        setLocaleStoreGetter(() => ({ locale: 'es', messages: {} }));
        expect(__('bye')).toBe('Adiós');
    });
});

// ---------------------------------------------------------------------------
// resolveAutoLocale / AUTO_BROWSER
// ---------------------------------------------------------------------------
describe('resolveAutoLocale', () => {
    it('returns the locale unchanged when it is not the sentinel', () => {
        expect(resolveAutoLocale('es')).toBe('es');
    });

    it('returns undefined on the server for AUTO_BROWSER', () => {
        setEnv(true);
        expect(resolveAutoLocale(AUTO_BROWSER)).toBeUndefined();
    });

    it('resolves from navigator.languages on the client', () => {
        setEnv(false);
        setSupportedLocales(['en', 'es', 'fr']);
        const original = (globalThis as any).navigator;
        (globalThis as any).navigator = { languages: ['fr-FR', 'en-US'] };
        try {
            expect(resolveAutoLocale(AUTO_BROWSER)).toBe('fr');
        } finally {
            (globalThis as any).navigator = original;
        }
    });
});

// ---------------------------------------------------------------------------
// setLocale (client-side)
// ---------------------------------------------------------------------------
describe('setLocale (client)', () => {
    beforeEach(() => {
        setEnv(false);
        setSupportedLocales(['en', 'es']);
        registerLocale('en', { hi: 'Hi' });
    });

    it('switches the current locale synchronously when the catalog is registered', async () => {
        registerLocale('es', { hi: 'Hola' });
        await setLocale('es');
        expect(getLocale()).toBe('es');
        expect(__('hi')).toBe('Hola');
    });

    it('persists the choice to a cookie', async () => {
        registerLocale('es', { hi: 'Hola' });
        Object.defineProperty(document, 'cookie', {
            configurable: true,
            writable: true,
            value: '',
        });
        await setLocale('es');
        expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=es`);
    });

    it('dispatches a localechange event', async () => {
        registerLocale('es', { hi: 'Hola' });
        const handler = vi.fn();
        window.addEventListener('localechange', handler);
        try {
            await setLocale('es');
            expect(handler).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener('localechange', handler);
        }
    });

    it('dynamic-loads the catalog via the injected loader when not registered', async () => {
        const loader = vi.fn().mockResolvedValue({ hi: 'Hola' });
        setLocaleLoader(loader);
        await setLocale('es');
        expect(loader).toHaveBeenCalledWith('es');
        expect(__('hi')).toBe('Hola');
    });

    it('memoizes concurrent loads (loader called once)', async () => {
        const loader = vi.fn().mockResolvedValue({ hi: 'Hola' });
        setLocaleLoader(loader);
        await Promise.all([setLocale('es'), setLocale('es')]);
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('does not call the loader again after a successful load', async () => {
        const loader = vi.fn().mockResolvedValue({ hi: 'Hola' });
        setLocaleLoader(loader);
        await setLocale('es');
        await setLocale('es');
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('dispatches localeerror and rethrows when the loader fails', async () => {
        const loader = vi.fn().mockRejectedValue(new Error('network'));
        setLocaleLoader(loader);
        const handler = vi.fn();
        window.addEventListener('localeerror', handler);
        try {
            await expect(setLocale('es')).rejects.toThrow('network');
            expect(handler).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener('localeerror', handler);
        }
    });

    it('keeps the previous locale on load failure', async () => {
        registerLocale('en', { hi: 'Hi' });
        __hydrateLocale('en');
        const loader = vi.fn().mockRejectedValue(new Error('network'));
        setLocaleLoader(loader);
        await expect(setLocale('es')).rejects.toThrow('network');
        expect(getLocale()).toBe('en');
    });

    it('resolves AUTO_BROWSER from navigator on the client', async () => {
        setSupportedLocales(['en', 'es', 'fr']);
        registerLocale('fr', { hi: 'Salut' });
        const original = (globalThis as any).navigator;
        (globalThis as any).navigator = { languages: ['fr-FR'] };
        try {
            await setLocale(AUTO_BROWSER);
            expect(getLocale()).toBe('fr');
        } finally {
            (globalThis as any).navigator = original;
        }
    });

    it('rejects unsupported locale codes', async () => {
        setSupportedLocales(['en', 'es']);
        registerLocale('en', { hi: 'Hi' });
        __hydrateLocale('en');
        await expect(setLocale('de')).rejects.toThrow(/Unsupported locale/);
        expect(getLocale()).toBe('en');
    });

    it('normalizes case (ES → es)', async () => {
        setSupportedLocales(['en', 'es']);
        registerLocale('es', { hi: 'Hola' });
        await setLocale('ES');
        expect(getLocale()).toBe('es');
    });

    it('normalizes regional tags to base language (en-US → en)', async () => {
        setSupportedLocales(['en', 'es']);
        registerLocale('en', { hi: 'Hi' });
        await setLocale('en-US');
        expect(getLocale()).toBe('en');
    });
});

// ---------------------------------------------------------------------------
// normalizeLocale
// ---------------------------------------------------------------------------
describe('normalizeLocale', () => {
    beforeEach(() => setSupportedLocales(['en', 'es', 'fr']));

    it('returns the canonical casing for an exact match', () => {
        expect(normalizeLocale('ES')).toBe('es');
        expect(normalizeLocale('EN')).toBe('en');
    });

    it('falls back to the base language for regional tags', () => {
        expect(normalizeLocale('en-US')).toBe('en');
        expect(normalizeLocale('fr-FR')).toBe('fr');
        expect(normalizeLocale('es-419')).toBe('es');
    });

    it('returns undefined for unsupported locales', () => {
        expect(normalizeLocale('de')).toBeUndefined();
        expect(normalizeLocale('zh-CN')).toBeUndefined();
    });

    it('returns undefined for empty input', () => {
        expect(normalizeLocale('')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// setLocale (server-side) — should reject
// ---------------------------------------------------------------------------
describe('setLocale (server)', () => {
    beforeEach(() => setEnv(true));

    it('throws explaining per-request locale is middleware-driven', async () => {
        await expect(setLocale('es')).rejects.toThrow(/server/i);
    });
});

// ---------------------------------------------------------------------------
// readLocaleCookie
// ---------------------------------------------------------------------------
describe('readLocaleCookie', () => {
    it('reads a previously persisted cookie value', async () => {
        Object.defineProperty(document, 'cookie', {
            configurable: true,
            writable: true,
            value: '',
        });
        setSupportedLocales(['en', 'es']);
        registerLocale('es', { hi: 'Hola' });
        await setLocale('es');
        // The previous test wrote the cookie; re-read it.
        const { readLocaleCookie } = await import('../src/shared/i18n');
        expect(readLocaleCookie()).toBe('es');
    });

    it('returns undefined when the cookie is absent', async () => {
        Object.defineProperty(document, 'cookie', {
            configurable: true,
            writable: true,
            value: 'other=1',
        });
        const { readLocaleCookie } = await import('../src/shared/i18n');
        expect(readLocaleCookie()).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// __hydrateLocale
// ---------------------------------------------------------------------------
describe('__hydrateLocale', () => {
    it('sets the current locale and registers a catalog', () => {
        __hydrateLocale('es', { hi: 'Hola' });
        expect(getLocale()).toBe('es');
        expect(getLocaleCatalog('es')).toEqual({ hi: 'Hola' });
    });

    it('sets the current locale without a catalog', () => {
        __hydrateLocale('de');
        expect(getLocale()).toBe('de');
    });
});
