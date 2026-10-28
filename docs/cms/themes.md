---
title: 'CMS Themes'
description: 'Build a site theme: templates, helpers, loaders, options, presets, child themes and widget areas.'
---

# CMS Themes

A theme is a plugin whose manifest has a `theme` field. Its `templates/` files are the
site's templates: pure functions from view data to HTML that never read the database.
Themes own templates, not routes; the site's pages, URLs, feeds and API belong to the
host, and the active theme is a per-request setting an administrator changes under
Appearance → Themes.

`cossack add cms` renders the default theme into `src/plugins/default-theme/`. The fastest
way to a theme of your own is to copy that directory, rename it in `plugin.json`, edit the
templates and activate it.

```
src/plugins/my-theme/
├── plugin.json
├── templates/
│   ├── layout.ts        the frame around every page
│   ├── entry.ts         one entry
│   ├── archive.ts       a list of entries
│   ├── home.ts          the front page (optional)
│   ├── search.ts        search results (optional)
│   ├── not-found.ts     404 (optional)
│   ├── password.ts      the password form of a protected entry (optional)
│   ├── head.ts          stylesheets, fonts, meta (optional)
│   ├── entry-posts.ts   a narrower template, by collection
│   └── term-category.ts a narrower template, by taxonomy
├── parts/               shared pieces the templates import
├── server.ts            loaders (optional)
└── assets/              logo, cover, stylesheets, fonts
```

## The manifest

```json
{
  "schemaVersion": 1,
  "name": "my-theme",
  "version": "1.0.0",
  "compatibility": { "@cossackframework/cms": ">=0.9.0" },
  "logo": "assets/logo.svg",
  "cover": "assets/cover.svg",
  "theme": {
    "label": "My Theme",
    "description": "A clean, readable theme.",
    "locations": { "primary": "Primary menu", "footer": "Footer menu" },
    "areas": { "footer": "Footer widgets" },
    "options": {
      "accent": { "kind": "enum", "values": ["blue", "rose"], "default": "blue", "label": "Accent colour", "choices": { "blue": "Blue", "rose": "Rose" } },
      "showSearch": { "kind": "boolean", "default": true, "label": "Show a search box" }
    },
    "presets": {
      "colors": [{ "slug": "primary", "name": "Primary", "value": "#2563eb" }]
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `label`, `description` | Shown under Appearance → Themes; 60 and 300 characters at most. |
| `locations` | Up to 8 menu locations, `name: label`. Administrators assign menus to them; templates read `site.menus[location]`. |
| `areas` | Up to 8 widget areas, `name: label`. Their blocks are edited under Appearance → Widgets and arrive as `site.areas[area]`. |
| `options` | Up to 16 settings shown under Appearance → Customize, of kind `string`, `text`, `enum` (`values`, `choices` for labels), `boolean`, `integer` or `number`, with `default`, `label`, `description` and the usual limits. Stored as settings `<plugin>.<option>`; templates read them as `helpers.options.<option>`, defaults applied. |
| `presets` | The palette, font sizes and spacing steps blocks pick from: `colors` (up to 24), `fontSizes` (8) and `spacing` (8), each `{ slug, name, value }`. Missing kinds get defaults; the site adjusts colours under Customize. |
| `extends` | A parent theme's plugin name. See [Child themes](#child-themes). |

A manifest with a `theme` field and nothing that needs a grant (no resources, hooks,
network or resource permissions) is "theme only": it needs no activation under Plugins.
A theme that declares `collections` or whose loaders need `permissions.resources` is a
plugin as well, granted under Plugins like any other; its templates render before the
grant with empty loader data.

## Templates

Each file in `templates/` default-exports one function. The file name is the template's
name.

| File | Signature | Used for |
| --- | --- | --- |
| `layout.ts` | `(site: SiteView, content, helpers) => TemplateResult` | The frame around every page. Required. |
| `entry.ts` | `(entry: EntryView, helpers) => TemplateResult` | One entry. Required. |
| `archive.ts` | `(view: ArchiveView, helpers) => TemplateResult` | A list: a collection's archive, a term, and the front page and search when those are absent. Required. |
| `home.ts`, `search.ts` | `(view: ArchiveView, helpers)` | The front page's latest posts; search results. |
| `not-found.ts` | `(helpers) => TemplateResult` | 404. |
| `password.ts` | `(view: LockedView, helpers)` | The form asking for a protected entry's password; the host draws a plain one otherwise. |
| `head.ts` | `(site: SiteView, helpers) => HeadValue` | Tags for the document head. The page's own title and meta win. |
| `entry-<collection>.ts`, `archive-<collection>.ts`, `term.ts`, `term-<taxonomy>.ts` | as above | Narrower templates. Any other `entry-*` name is a template editors can choose per entry. |

The site picks the most specific template it has for each page:

- An entry: the template the editor chose, then `entry-<collection>`, then `entry`.
- The front page: `home`, then `archive-posts`, then `archive`.
- A term: `term-<taxonomy>`, then `term`, then `archive-<collection>`, then `archive`.
- A collection's archive: `archive-<collection>`, then `archive`.
- Search: `search`, then `archive`.

A small entry template:

```ts
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { EntryView, ThemeHelpers } from '@cossackframework/cms';

export default function entry(entry: EntryView, helpers: ThemeHelpers): TemplateResult {
  return html`<article>
    <h1>${entry.title}</h1>
    ${entry.date ? html`<p>${entry.date}${entry.author ? html` · ${entry.author}` : null}</p>` : null}
    ${entry.image ? html`<img src=${entry.image.url} srcset=${entry.image.srcset} alt=${entry.image.alt}>` : null}
    ${helpers.block(entry.content)}
  </article>`;
}
```

`entry.content` is the entry's whole content as one list of blocks: its blocks fields,
the `content` feature first of all, and its rich text and Markdown fields, each of those
one `core/richtext` block (one per item of a multiple field), in the collection's field order. A theme that lays a
collection's fields out itself takes them from `entry.fields` instead, where a blocks,
rich text or Markdown field is a `RenderedBlock[]` of its own:

```ts
${helpers.block((entry.fields.sections as readonly RenderedBlock[] | null) ?? [])}
```

Templates use `html` from `@cossackframework/renderer` and `__()` for their own strings.
They run on the server and again in the browser after a server method call, so they stay
pure: no database, no request, no randomness.

Instead of files, `ui.ts` may export a `theme` object with the same slots (`layout`,
`entry`, `archive`, ..., `templates: { 'entry-posts': ... }`, `blocks`). The host layers
that export over the files, slot by slot.

## Views

| View | What it carries |
| --- | --- |
| `SiteView` | `title`, `tagline`, `blog` (the posts page URL), `menus` by location (items with `label`, `url`, `newTab`, `children`, `className`, `attributes`, `meta`), `locale`, `languages` (the page in each language), `searchUrl`, `homeUrl`, `areas` (rendered blocks by widget area), and `template`, the entry's template name so a layout can leave out its frame, as the default theme does for `entry-blank`. |
| `EntryView` | `id`, `title`, `url`, `collection`, `kind` (the singular label), `date`, `author`, `excerpt`, `content` (`RenderedBlock[]`), `image` (`MediaView`), `terms` by taxonomy, `fields` (every field by name as a typed `FieldView`: a scalar, a `MediaView`, an `EntryReference`, `TermLink[]`, `RenderedBlock[]` for blocks, rich text and Markdown, or, for a multiple field, the list of its kind's views), `details` (scalar fields as labelled text), `template`, `locale`, `comments` (`CommentsView`, or null) and `locked`. In lists, `content` is empty. A locked entry withholds its excerpt, content and fields. |
| `ArchiveView` | `kind` (`home`, `archive`, `term`, `search`), `collection`, `taxonomy`, `title`, `description`, `entries`, `paging` (`page`, `pages`, `base`) and `query`. |
| `LockedView` | `entry`, `action` (where the password form posts) and `error` after a wrong password. |
| `MediaView` | `url`, `alt`, `width`, `height`, `contentType`, `caption`, `srcset` and `wideSrcset` (16:9 variants around the focal point). |
| `RenderedBlock` | `id`, `type`, `data`, `html` (Markdown fields rendered), `media` by file ID, `content` (rich text fields as `BodyPart[]`), `children`, `layout`, `style`, and `field` on a block that stands for one of the entry's rich text or Markdown fields. |

## Helpers

Every template receives `helpers`:

| Helper | Use |
| --- | --- |
| `options` | The theme's option values, defaults applied. |
| `presets` | The resolved presets; `presetStyle(helpers.presets)` from `@cossackframework/cms` renders them as CSS custom properties for the content root. |
| `data.layout`, `data.page` | What the theme's loaders returned for the layout and for the page. Empty when there is no loader, or it failed. |
| `asset(path)` | The URL of a file in the theme's `assets/`, such as `helpers.asset('assets/theme.css')`. Empty when the theme has none. |
| `block(blocks)` | Renders a block, or a list of blocks, through the theme's own renderer, a plugin's component or the core one. |
| `content(parts)` | For block renderers: renders a block's rich text field (`block.content.<field>`), HTML runs and the blocks embedded in them. |
| `isActive(url)` | Whether a URL is the current page or one of its ancestors, for menu styling. |

Render content through `helpers.block`. Besides the core renderers and plugin blocks, that
is what makes an entry editable on the public page for signed-in editors: the helper marks
each block in edit mode, and a theme never learns about editing. A theme can replace core block renderers with a `blocks` map in its
`ui.ts` `theme` export, keyed by block type.

## Stylesheets and the head

Ship stylesheets and fonts under `assets/` and link them from `templates/head.ts`:

```ts
import type { HeadValue } from '@cossackframework/core';
import type { SiteView, ThemeHelpers } from '@cossackframework/cms';

export default function head(site: SiteView, helpers: ThemeHelpers): HeadValue {
  return { link: [{ rel: 'stylesheet', href: helpers.asset('assets/theme.css') }] };
}
```

The site layout merges this under the page's own head, so an entry's title, description
and social tags win. The default theme uses Tailwind classes from the application's own
stylesheet instead, plus a `<style>` for its typography options, so a child theme with
its own head keeps them.

## Loaders

Templates never read the database. When a template needs data beyond its view, such as
related projects on a project page, the theme's `server.ts` exports `loaders`, keyed like
templates:

```ts
import type { EntryView } from '@cossackframework/cms';
import type { ThemeLoaders } from '@cossackframework/cms/server';

export const loaders: ThemeLoaders = {
  async 'entry-projects'(view, { cms, principal, signal }) {
    const entry = view as EntryView;
    const projects = cms.resource('cms/projects');
    const page = await projects.list({ where: { status: 'published', id: { ne: entry.id } }, limit: 3 }, { principal });
    return { related: page.records.map(record => ({ id: record.id, title: record.title })) };
  },
};
```

- The site runs `layout` plus the one loader the template hierarchy picks for the page,
  never every matching key. `layout` receives the `SiteView`, entry loaders the
  `EntryView`, list loaders the `ArchiveView`.
- The context carries the plugin's `cms` repositories, the visitor `principal` to pass to
  every read, a `signal`, the theme `options`, the `locale` and the `template` key.
- Reads go through the plugin's grants as the visitor. A theme reading a collection it
  does not ship requests it in `permissions.resources` and needs the grant under Plugins;
  before the grant, templates render with `helpers.data` empty.
- A loader returns plain JSON, at most 64 KiB by default, within 1.5 seconds by default
  (`themeDataLimit` and `themeLoaderTimeoutMs` on `createCMS`). A failure or timeout
  yields `{}`, never an error page. Templates read the result as `helpers.data.layout`
  and `helpers.data.page`.

## Child themes

`"theme": { "extends": "default-theme", ... }` makes a child theme. The child's
templates, loaders, assets, options, menu locations and widget areas are layered over
the parent's slot by slot, so a child that ships only `templates/entry-posts.ts` and a
stylesheet gets everything else from the parent. Themes extend one level; a missing or
invalid parent makes the child unusable. A child's option values are stored under its
own name, so switching between parent and child is a settings write and a child starts
from its defaults.

## Site collections

A theme designed around a content type can ship it: `collections` in the manifest
declares definitions like a module's, stored as `cms/<name>`, with URLs, an archive and
a dashboard section. They are migrated and granted with the plugin and hidden until it is
active. The themes test in `packages/cossack/tests/generated-runtime-cms-themes.test.js`
shows a portfolio child theme shipping `projects` and listing related projects through a
loader.

## Activating

Appearance → Themes lists every rendered theme with its logo and cover and activates one;
`cms.activateTheme(name, principal)` does the same from code. Appearance → Customize
edits the options and presets, Appearance → Menus assigns menus to the theme's
locations, and Appearance → Widgets fills its areas. Editors choose an entry's template
under Template in the editor's sidebar, from the theme's `entry-*` templates.
