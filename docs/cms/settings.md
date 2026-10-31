---
title: 'CMS Settings'
description: 'Reading and writing site settings, declaring settings groups, subpages, and the site logo.'
---

# CMS Settings

Site settings are typed values in groups, such as General, Reading or SEO. Each setting
has a key `<group>.<field>`, such as `general.siteTitle`. The host stores one row per key,
checks every write against the group's declaration and fills in defaults when it reads.

## Reading settings

`cms.settings.all()` returns every declared setting with defaults applied, as a
`SiteSettings` object. `cms.settings.get(key)` returns one value. Reads are cached per
isolate and the cache is cleared on every write.

```ts
const cms = c.get('cms');
const title = await cms.settings.get('general.siteTitle');
const settings = await cms.settings.all();
if (settings['discussion.enabled']) { /* ... */ }
```

Before setup, reads return the defaults.

## Writing settings

`cms.settings.update(group, values, { principal })` writes some or all fields of one group.
Fields that the input leaves out keep their value.

```ts
await cms.settings.update('general', { siteTitle: 'Acme', logo: '/media/abc/logo.svg' }, { principal });
```

- The principal needs the group's `permission`: `cms:settings` by default, and
  `cms:appearance` for the Appearance groups.
- A field the group does not declare, or a value its declaration refuses, fails with
  `CMS_VALIDATION`. `error.fields` names each field and its problem. Nothing is written then.
- The result is the new `SiteSettings`.

## Declaring a group

A module or the host options declare groups with `settings`. A group is data: an `id`
(lowercase letters, digits and hyphens), a `label`, an optional `description` and `fields`.
The fields are field declarations, such as `field.boolean()` or `field.enum()`.

```ts
import { field, type SettingsGroup } from '@cossackframework/cms';

export const shop: SettingsGroup = {
  id: 'shop',
  label: 'Shop',
  fields: {
    currency: { ...field.enum(['usd', 'eur'], { default: 'usd', label: 'Currency' }), choices: { usd: 'US dollar', eur: 'Euro' } },
    logo: { ...field.string({ max: 2000, default: '', label: 'Invoice logo' }), source: 'media' },
  },
};

createCMS({ /* ... */ settings: [shop] });
```

- `choices` gives labels for enum values.
- `source` fills a field's choices when the form renders: `roles`, `pages`, `categories`,
  `timezones`, or `media`, which picks an image from the library and stores its URL.
- `permission` sets who may change the group.
- `parent` shows the group as a subpage of another group. Its keys keep the group's own ID.
  For example, Crawlers (`crawlers.*`) and IndexNow (`indexnow.*`) have `parent: 'seo'`. They
  show as tabs on the SEO page and not in the settings list.

Theme options are a separate group, `<plugin>.<option>`, which Appearance → Customize edits.
See [Themes](/docs/cms/themes.md).

## The Settings screens

Settings → `<group>` shows the groups behind `cms:settings` in a list at the side. A group
with subpages shows them as tabs above its form. Permalinks and Languages have screens of
their own in the same frame. In the application, `settingsLinks(cms)` and
`settingsFrame(links, current, body)` in `src/cms/settings-nav.ts` build that frame for a new
settings screen.

## Discussions

`discussion.enabled` ("Allow discussions") turns comments off for the whole site. When it
is off:

- The site shows no comments and no comment forms: `EntryView.comments` is null.
- `cms.postComment()` and `POST /api/cms/comments` refuse new comments with
  `CMS_FORBIDDEN`.
- The entry editor hides the entry's "Allow comments" switch.
- Stored comments are kept. The Comments screen shows a notice and still moderates them.

`cms.discussions(settings)` tells whether discussions are on, and
`cms.commentsOpen(collection, record, settings)` tells whether one entry takes comments.

## Site icon, app icon and logo

General has three images, each chosen from the media library:

| Key | Use |
| --- | --- |
| `general.favicon` | Site icon: browser tabs and bookmarks. An SVG or a square PNG. |
| `general.appIcon` | App icon: home screens and the web app manifest. A square PNG of at least 512 pixels. |
| `general.logo` | Logo, in any shape: the site header, the sign-in pages and the dashboard sidebar. |

`seo.logo` stays separate. Search engines want a square image in structured data, while a
header logo is usually wide.

Themes get the logo as `site.logo` (a URL or null). They render it with `helpers.logo(site)`,
which returns an image with the site title as its alternative text, or null when no logo is
set:

```ts
export default function layout(site: SiteView, content: TemplateResult, helpers: ThemeHelpers) {
  return html`<header>
    <a href=${site.homeUrl}>${helpers.logo(site, { class: 'h-10 w-auto' }) ?? site.title}</a>
  </header>${content}`;
}
```

The dashboard and the sign-in pages read the logo through `siteLogo()` in `src/brand.ts`.
They show the bundled `/logo.svg` until a logo is set.
