---
title: 'CMS Languages'
description: 'Publish entries in several languages, choose how URLs show the language, see translations in the entries list, share fields between translations, and translate the interface with language packs.'
---

# CMS Languages

The CMS translates content as entries. Each entry has one language, its `locale`. The
translations of an entry are separate entries in the same translation group, its
`translationGroup`: the ID of the group's first entry, which keeps no group of its own.
Each translation has its own status, schedule, slug, SEO, authors, revisions and comments,
so a French draft can wait beside the published English page.

Interface text, such as the dashboard's buttons and a theme's "Read more", is separate. It
comes from `__()` catalogs and [language packs](#language-packs).

## Set up languages

Settings → Languages has three settings:

| Setting | Key | Value |
| --- | --- | --- |
| Default language | `languages.default` | A code such as `en`, `fr`, `pt-br` or `zh-hans`. |
| Other languages | `languages.others` | Up to 19 other codes, separated by commas. |
| Language in URLs | `languages.urls` | `hide-default` (the default) or `all`. See [URLs](#urls). |

Saving the languages gives the default language to every entry that has none. New entries
take the default language unless they name another one.

On the server:

```ts
const cms = c.get('cms');
await cms.saveLanguages({ default: 'en', others: ['fr', 'vi'], urls: 'all' }, principal);
const languages = await cms.languages();
// { default: 'en', others: ['fr', 'vi'], all: ['en', 'fr', 'vi'], multilingual: true, prefixDefault: true }
```

`saveLanguages` keeps the current `urls` value when the input leaves it out.

## URLs

| Language in URLs | Default language | Other languages | `/` |
| --- | --- | --- | --- |
| Hide the default language's code (`hide-default`) | `/about` | `/fr/a-propos` | The default language's home page |
| Every language has its code (`all`) | `/en/about` | `/fr/a-propos` | Redirects to `/en` |

These rules apply on a site with more than one language. A site with one language has no
language codes in its URLs.

- Both modes accept the default language's code as a prefix, so links made in the other mode
  redirect. A redirect that only changes the language prefix is a 302, for entries, home pages,
  archives, term archives, author pages and search: the default language and the URL mode can
  change, and browsers keep a 301 for good. Other paths to an entry, such as an old parent's,
  redirect to its URL with a 301. The query string is kept.
- Each language has its own slugs: `/about` and `/fr/about` can be translations of each
  other. The slug is unique per language (`uniqueBy: ['locale']`), and language codes are
  reserved as slugs of entries at the site root. A path whose slug only another language
  has, such as `/a-propos`, redirects to that entry's own URL, `/fr/a-propos`.
- `cms.entryUrls(collection, records)`, `cms.archiveUrl(collection, locale)` and
  `cms.localePrefix(locale, languages)` build URLs for the current mode.
- A domain or subdomain per language (`example.fr`, `fr.example.com`) is not supported:
  absolute URLs come from one `APP_URL`, and sessions and passkeys belong to one host.
  Query strings such as `?lang=fr` are not offered either, because search engines advise
  against them.

## Translate entries

The entry editor's Languages box shows the entry's language and links its translations.
**+ Translate** starts a translation as a draft copy. The copy takes every field except the
slug, status, publication date, language and translation group. A nested entry's parent
becomes the parent's translation in that language, when one exists.

```ts
const french = await cms.translateEntry('pages', about.id, 'fr', principal);
const byLanguage = await cms.translations(cms.collection('pages'), about, { principal });
byLanguage.get('fr')?.id; // the French translation
```

`translateEntry` returns the existing translation when there is one. When the translation
exists but the user cannot open it, it refuses with `CMS_CONFLICT` instead of starting a
second one.

`cms.translationsOf(collection, records, context)` loads the translations of a list of
entries at once, by translation group and then language. `translationGroupOf(record)`, from
`@cossackframework/cms`, names an entry's group.

## The entries list

On a site with several languages, the entries list shows one language at a time, the
default language first. The language filter switches it. `?lang=fr` lists French entries and
`?lang=all` lists every entry. Status counts and search follow the language.

The Languages column has one code for each site language:

- The filled code is the entry itself.
- A linked code opens the entry's translation. It is solid when the translation is published,
  and dashed otherwise.
- `+FR` starts a French translation and opens it. Users who cannot create entries see the
  code without a link.

Screen options can hide the column.

## Fields that are the same in every language

Some values belong to the thing an entry describes, not to its language: a price, an SKU,
a product photo. Mark such a field as the same in every language:

- In a field group, turn on **Same in every language** in the field's settings. Text,
  number, integer, checkbox, date, choice, media, reference and JSON fields have it.
- In code, declare the field with `translatable: false`:

```ts
fields: {
    price: field.integer({ nullable: true, translatable: false, label: 'Price' }),
}
```

When an entry is saved with a new value for such a field, the same write copies the value to
every translation of the entry. The write also moves each translation's revision on, so an
editor that has an older revision open must reload before saving. An unchanged value copies
nothing. The copies are not revisions of the translations, and they send no events.

A user who cannot update every translation cannot change the value. The editor shows the
field as read-only, and the server refuses the change with `CMS_FORBIDDEN`.

Long text, rich text, blocks, rows, vectors, slugs, unique fields and searched lists of text
are always translated.

## Menus, terms and settings

- A menu location has one menu for every language. In a language, an entry item links the
  entry's translation and shows its title unless the item has its own label; archive and term
  items link that language's pages. `cms.menus.forLocation(location, locale)` reads it.
- A term has one name in every language. Its archive exists in each language, such as
  `/fr/category/news`, and lists that language's entries.
- Site settings, such as the site title and tagline, have one value for every language.

## Search engines and themes

- Each page's head links its translations with `hreflang` alternates. The sitemaps list
  them too, with the default language's page as `x-default`.
- `<html lang>` is the page's content language.
- A theme reads `SiteView.locale`, `SiteView.languages` (each `code`, `label`, `url` and
  `current`, for a language switcher), `homeUrl`, `searchUrl` and `EntryView.locale`.
  Theme loaders receive the `locale`. See [Themes](/docs/cms/themes.md).

## Interface languages

The dashboard and the themes write their text in English with `__('…')`. The English text is
the key, so English needs no catalog. See [Localization](/docs/localization.md).

- A site page renders its interface text in the page's content language when a catalog has
  that language. Otherwise the text stays English, and `<html lang>` still names the
  content language. Client navigation between pages in different languages switches too.
- The dashboard uses the language chosen in Profile → Dashboard language. The browser keeps
  the choice in the `cossack_locale` cookie. Until a user chooses, the dashboard uses the
  site's default language when a catalog has it, and English otherwise.

## Language packs

A language pack is a plugin that ships catalogs. It translates the application's text and
other plugins' text:

```
cms-lang-vi/
├── package.json
├── cossack-plugin.json
└── plugin/
    └── translations/
        ├── vi.json                  (the dashboard's and themes' text)
        └── vi/
            └── support-desk.json    (the support-desk plugin's `support-desk::` keys)
```

```json
{
  "schemaVersion": 1,
  "name": "cms-lang-vi",
  "version": "1.0.0",
  "description": "Vietnamese for the CMS dashboard and the default theme.",
  "translations": ["vi"]
}
```

- `translations/<code>.json` maps the application's keys, which are the English text, to
  translations: `{ "Save changes": "Lưu thay đổi" }`.
- `translations/<code>/<plugin>.json` translates another plugin's catalog, whose keys the
  plugin reads as `<plugin>::<key>`.
- A pack adds its languages to the application. When the application has no catalog for its
  default language, an empty one is added, so English stays the default.
- The application's own `src/lang/<code>.json` overrides a pack, and a pack overrides a
  plugin's own `lang/<code>.json`.
- A pack needs no grants. Install it with `pnpm exec cossack add plugin <package>`.

To start a pack, run `pnpm exec cossack lang add vi` in a CMS application. Without a default
catalog, the command writes `src/lang/vi.json` with every literal `__()` key under `src`,
leaving out plugin keys. Translate the values, then move the file to the pack's
`plugin/translations/vi.json`.

The active language's catalog ships inline with each page, like any `__()` catalog. Text
from the CMS library, such as error messages and labels declared in collections and settings,
stays English.

## Limits

- Terms and site settings are not translated.
- A domain or subdomain per language is not supported.
- On a site with several languages, entries in a language that was removed from the settings
  are not served.
