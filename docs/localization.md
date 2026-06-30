---
title: 'Localization'
description: 'Translate your app into multiple languages with the __() helper, runtime locale switching, placeholder replacement, and CLDR pluralization.'
---

# Localization

Cossack ships with a Laravel-inspired localization system: JSON translation files, a global `__()` helper, case-aware placeholders, CLDR pluralization, and per-request locale isolation on the server.

## Quick start

Generate the default catalog:

```sh
npx cossack lang publish
```

This creates `src/lang/en.json` and **automatically wires** everything else:

- `{{ cossackLang }}` is injected into `<html lang="...">` in your `src/root.ts` (if you have one).
- `APP_LOCALE` is added to the `vars` block in `wrangler.jsonc`.
- The locale middleware, `__()` global, and `<html lang>` attribute are already wired by the framework — no manual imports or middleware registration needed.

```json
{
  "welcome": "Welcome to :name",
  "goodbye": "Goodbye, :Name",
  "apples": "You have :count apple|You have :count apples",
  "I love programming.": "I love programming."
}
```

Use `__()` in any `render()`:

```ts
render() {
  return html`<h1>${__('welcome', { name: 'Cossack' })}</h1>`;
}
```

That's it — the framework auto-detects `src/lang/*.json`, hydrates the active locale on the client, and keeps `<html lang>` in sync.

## Configuration

Set the deployment-wide default locale via the `APP_LOCALE` environment variable in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "APP_LOCALE": "es"  // defaults to "en"
  }
}
```

To opt into automatic browser-language detection (based on the `Accept-Language` header), enable it in `createApp`:

```ts
// src/index.ts
import { createApp } from '@cossackframework/framework';

const app = createApp({
  i18n: { autoDetectBrowser: true },
});
```

This is **off by default** because it can affect caching and SEO (every visitor with a different `Accept-Language` gets a different response). The `cossack_locale` cookie (set by client-side `setLocale()`) always takes precedence.

## Adding locales

```sh
npx cossack lang add es    # creates src/lang/es.json with empty values
npx cossack lang add fr    # creates src/lang/fr.json
```

Fill in the translations, then switch at runtime:

```ts
import { setLocale } from '@cossackframework/core';

await setLocale('es');
```

`setLocale` is **client-only** — on the server, locale is resolved per-request (see [How it works](#how-it-works)). Calling it from server code throws.

## Runtime locale switching

The `setLocale`, `getLocale`, and `isLocale` functions are available both as imports and as globals:

```ts
import { setLocale, getLocale, isLocale } from '@cossackframework/core';

await setLocale('es');          // fetch the es chunk, register it, swap
console.log(getLocale());       // 'es'
console.log(isLocale('es'));    // true
```

Or as bare globals (registered automatically by the framework):

```ts
await setLocale('es');
const current = getLocale();
```

### `AUTO:BROWSER`

Pass `'AUTO:BROWSER'` to resolve from the user's `navigator.languages`:

```ts
await setLocale('AUTO:BROWSER');
```

This is a client-only sentinel. On the server, the equivalent (Accept-Language detection) is handled by the locale middleware when `autoDetectBrowser` is enabled.

### Events

`setLocale` dispatches two events on `window`:

| Event           | Fires when                                     | `event.detail`         |
|-----------------|------------------------------------------------|------------------------|
| `localechange`  | The new locale's catalog loaded and is active  | `{ locale: 'es' }`     |
| `localeerror`   | The dynamic import failed (offline, etc.)      | `{ error: '...' }`     |

```ts
window.addEventListener('localechange', (e) => {
  console.log('Now rendering in', (e as CustomEvent).detail.locale);
});
```

## Translation files

Catalogs are JSON files in `src/lang/`. Each file maps keys to translated strings.

### Short keys

```json
{
  "welcome": "Welcome to Cossack",
  "greeting": "Hello, :name"
}
```

```ts
__('welcome')              // "Welcome to Cossack"
__('greeting', { name: 'Sam' })  // "Hello, Sam"
```

### Translation strings as keys

For apps with many strings, inventing short keys for everything is cumbersome. Use the default-language text **as the key**:

```json
{
  "I love programming.": "Me encanta programar."
}
```

```ts
__('I love programming.')  // "Me encanta programar." (es), "I love programming." (en fallback)
```

If a key doesn't exist in the active locale, `__()` falls back to the default locale, then to the key itself — so using the English text as the key means missing translations gracefully degrade to English.

## Placeholders

Define placeholders prefixed with `:` in your translation strings:

```json
{
  "welcome": "Welcome, :name"
}
```

Pass replacements as the second argument:

```ts
__('welcome', { name: 'John' })  // "Welcome, John"
```

### Case-aware transforms

The placeholder's casing controls the replacement value's casing:

| Placeholder | Input value  | Output       |
|-------------|--------------|--------------|
| `:name`     | `john`       | `john`       |
| `:Name`     | `john`       | `John`       |
| `:NAME`     | `john`       | `JOHN`       |

```json
{
  "welcome": "Welcome, :NAME",
  "goodbye": "Goodbye, :Name"
}
```

```ts
__('welcome', { name: 'dayle' })   // "Welcome, DAYLE"
__('goodbye', { name: 'dayle' })   // "Goodbye, Dayle"
```

## Pluralization

Separate plural forms with `|`:

```json
{
  "apples": "You have :count apple|You have :count apples"
}
```

Pass `count` as a parameter — the correct form is selected automatically:

```ts
__('apples', { count: 1 })  // "You have 1 apple"
__('apples', { count: 5 })  // "You have 5 apples"
```

### Non-English pluralization

Cossack uses `Intl.PluralRules` for CLDR-correct pluralization. The number of `|`-separated forms determines which categories are used:

| Forms | Categories               | Examples             |
|-------|--------------------------|----------------------|
| 1     | other                    | (no pluralization)   |
| 2     | one, other               | English, Spanish     |
| 3     | one, few, other          | Polish               |
| 4     | one, few, many, other    | Russian, Ukrainian   |
| 6     | zero, one, two, few, many, other | Arabic       |

Note: Russian is commonly authored with **3 forms** (`one|few|many`). When only 3 forms are provided, categories like `many`/`other` fall back to the last form.

Russian (`src/lang/ru.json`):

```ts
__('apples', { count: 1 })  // "У вас 1 яблоко"   (one)
__('apples', { count: 2 })  // "У вас 2 яблока"   (few)
__('apples', { count: 5 })  // "У вас 5 яблок"    (many)
```

Pluralization also works with translation-strings-as-keys.

## How it works

### Server-side: per-request isolation

On Cloudflare Workers, a single isolate serves many concurrent requests. To prevent locale races, the framework wraps each request in an `AsyncLocalStorage` scope:

1. The **locale middleware** runs before SSR and resolves the locale (cookie → `Accept-Language` → `APP_LOCALE` → `en`).
2. It loads the catalog and runs the rest of the request inside the ALS scope.
3. `__()` and `getLocale()` read from the scope, so every visitor gets the right locale.

This is the same pattern Next.js uses for `headers()` / `cookies()` and Nuxt uses for `useRequestEvent()`.

### Client-side: code splitting

Each locale's JSON catalog is a separate chunk. Only the **active** and **default** catalogs ship in the initial bundle (via `window.__INITIAL_STATE__.__cossackLang`); the rest are dynamic-imported on demand when `setLocale()` is called. This keeps the initial payload small regardless of how many locales your app supports.

For predicted non-default locales (e.g., when the `cossack_locale` cookie is set), the framework injects a `<link rel="modulepreload">` hint so the chunk is already cached when the user switches.

### `<html lang>`

The `<html lang>` attribute is set automatically from the resolved locale for accessibility (screen-reader pronunciation) and SEO. It updates at runtime when `setLocale()` fires `localechange`.

If you use a custom [template](/docs/template.md), use the `{{ cossackLang }}` placeholder:

```ts
export const template = `
<!DOCTYPE html>
<html lang="{{ cossackLang }}">
  <head>...</head>
  <body>{{ cossackBody }}</body>
</html>
`;
```

## API reference

| Function / constant | Description |
|---|---|
| `__(key, params?)` | Translate `key` for the current locale, with optional placeholder/pluralization params. Falls back to the default locale, then the key itself. |
| `setLocale(locale)` | Switch the active locale (client-side; async). Persists to a cookie. Accepts `'AUTO:BROWSER'`. |
| `getLocale()` | Returns the current locale code. |
| `isLocale(locale)` | Returns `true` if `locale` is a supported locale. |
| `registerLocale(locale, messages)` | Registers a catalog programmatically (used internally for hydration). |
| `detectBrowserLocale(header, supported, fallback?)` | Parses an `Accept-Language` header and picks the best match. |
| `AUTO_BROWSER` | Sentinel constant for `setLocale`. |
| `DEFAULT_LOCALE` | `'en'`. |

## CLI commands

| Command | Description |
|---|---|
| `cossack lang publish` | Create `src/lang/en.json` with starter keys. Use `--locale=<code>` for a different default. |
| `cossack lang add <locale>` | Create `src/lang/<locale>.json` with empty values, mirroring existing keys. |
| `cossack lang publish --locale=es` | Create `src/lang/es.json`, seeded from `en.json`'s keys. |

Both honor `--force` (overwrite) and `--dry-run` (preview without writing).
