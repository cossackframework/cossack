---
title: 'Localization'
description: 'Translate your app into multiple languages with the __() helper, runtime locale switching, placeholder replacement, and CLDR pluralization.'
---

# Localization

Cossack ships with a Laravel-inspired localization system: JSON translation files, a global `__()` helper, case-aware placeholders, CLDR pluralization, and per-request locale isolation on the server.

## Quick start

Generate the default catalog:

```sh
pnpm exec cossack lang publish
```

This creates `src/lang/en.json` and wires everything else automatically:

- The framework injects `{{ cossackLang }}` into `<html lang="...">` in your `src/root.ts` (if you have one).
- The framework adds `APP_LOCALE` to the `vars` block in `wrangler.jsonc`.
- The locale middleware, the `__()` global, and the `<html lang>` attribute are wired by the framework. No manual imports or middleware registration are needed.

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

The framework detects `src/lang/*.json`, loads the active locale on the client, and updates `<html lang>`.

## Configuration

Set the deployment-wide default locale with the `APP_LOCALE` environment variable in `wrangler.jsonc`:

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

This is off by default. It can affect caching and SEO, because every visitor with a different `Accept-Language` gets a different response. The `cossack_locale` cookie (set by client-side `setLocale()`) always takes precedence.

## Adding locales

```sh
pnpm exec cossack lang add es    # creates src/lang/es.json with empty values
pnpm exec cossack lang add fr    # creates src/lang/fr.json
```

Fill in the translations, then switch at runtime:

```ts
import { setLocale } from '@cossackframework/core';

await setLocale('es');
```

`setLocale` is client-only. On the server, the framework resolves the locale per request (see [How it works](#how-it-works)). A call from server code throws.

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
| `localeerror`   | The dynamic import failed (offline, for example) | `{ error: '...' }`     |

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

Short keys for every string are cumbersome in large apps. Use the default-language text as the key:

```json
{
  "I love programming.": "Me encanta programar."
}
```

```ts
__('I love programming.')  // "Me encanta programar." (es), "I love programming." (en fallback)
```

If a key does not exist in the active locale, `__()` uses the default locale. If the key is also missing there, the helper returns the key. Use English text as the key to show English when a translation is missing.

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

Pass `count` as a parameter. The framework selects the correct form automatically:

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

Russian is commonly authored with 3 forms (`one|few|many`). When only 3 forms are provided, categories like `many`/`other` fall back to the last form.

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

1. The locale middleware runs before SSR and resolves the locale (cookie → `Accept-Language` → `config('app.locale')` → `en`).
2. It loads the catalog and runs the rest of the request inside the ALS scope.
3. `__()` and `getLocale()` read from the scope, so every visitor gets the right locale.

This is the same pattern Next.js uses for `headers()` / `cookies()` and Nuxt uses for `useRequestEvent()`.

### Client-side: code splitting

Each locale's JSON catalog is a separate chunk. The initial bundle includes only the active and default catalogs through `window.__INITIAL_STATE__.__cossackLang`. Cossack loads other catalogs when `setLocale()` runs.

For predicted non-default locales (for example, when the `cossack_locale` cookie is set), the framework injects a `<link rel="modulepreload">` hint so the chunk is already cached when the user switches.

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
| `setLocale(locale)` | Switch the active locale in the browser. The method is async and saves the locale in a cookie. It accepts `'AUTO:BROWSER'`. |
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


## Check translations before building

Use the same default locale that your app uses. The default is `en`:

```sh
pnpm exec cossack lang extract --locale=en --json
pnpm exec cossack lang check --locale=en --json
pnpm exec cossack lang types --locale=en
```

`extract` reads source files under `src` and catalogs under `src/lang`. It reports
literal `__()` keys with a project-relative file, line and column. It recognizes
the framework global, imports from core/framework (including named aliases),
namespace calls, and local named or star reexports. It skips unrelated object
methods and shadowed helpers. The command parses source code. It never executes it.

Dynamic keys such as `__(key)` and interpolated template keys remain explicit
unresolved calls. Dynamic parameter objects produce a separate warning. `extract`
returns the inventory even when catalog errors exist. Use `check` to enforce
validation in CI. Each JSON command emits the standard versioned result envelope.
Catalog text and parser exception text are omitted from the result.

`check` fails for missing default/locale keys, empty translations, invalid JSON,
missing call parameters, renamed placeholders, inconsistent plural variants, and
invalid source syntax. A missing locale key reports the default fallback locale.
It remains an error even though the runtime can display the fallback. Extra keys
and keys with no static use produce warnings. When dynamic keys exist, unused-key
warnings are marked uncertain. Different languages can use different numbers of
plural forms (one to six). Every variant must preserve the same placeholders,
and plural entries require a numeric `count`. Placeholder casing is normalized
because the runtime supports `:Name` and `:NAME` with a `name` parameter.

Analysis is bounded to 4,096 source/catalog files, 1 MiB per file, 16 MiB total,
and 16,384 directory entries. Symlinks are refused. Unsupported dynamic calls
need an explicit review. The checker cannot prove which keys they use.

## Generate translation types

`types` checks the catalogs, then writes `.cossack/translations.d.ts`. Include
that file in the application's TypeScript project alongside the existing inputs:

```json
{
  "include": ["src", ".cossack/**/*.d.ts"]
}
```

The generated declaration augments `CossackTranslationRegistry` from
`@cossackframework/core`. Imported and framework-global `__()` calls then reject
unknown keys and missing required parameters. Keys that contain full sentences
remain valid literal keys. An app without a registered catalog keeps arbitrary
string keys and optional parameter maps.

```ts
// Catalog: { "welcome": "Hello :name", "apples": ":count apple|:count apples" }
__('welcome', { name: 'Sam' });
__('apples', { count: 2 });
// Type errors after generation:
__('welcome');
__('unknown');
__('apples', { count: '2' });
```

Rerun `types` when catalog contracts change. Generated files with the command's
ownership header can be updated. An existing file without that header requires
`--force`. Symlink output is refused. `--dry-run` checks and reports the target
without writing it. The `check` and `extract` commands always remain read-only.
Use `--locale=fr` when `fr` is the app's default and fallback language.

Local agents can call MCP `inspect_project` with `scope: "localization"`,
`locale: "en"`, and `check: true`. It uses the same extraction and diagnostics
as `lang check`, without running project modules or writing generated files.
Catalog text is omitted from both JSON reports. Dynamic keys remain warnings
that require an explicit application check.
