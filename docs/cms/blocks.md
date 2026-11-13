---
title: 'CMS Blocks'
description: 'The core block library, the sections built from it, icons and their style, and blocks a theme or plugin adds.'
---

# CMS Blocks

Content is blocks: an ordered tree of typed sections stored as `{ _id, type, data }`, with
`children` under a container. Entries, widget areas, patterns and the blocks embedded in rich
text all hold the same kind of tree, edited with the same inserter in the dashboard and in
[Live Edit](/docs/cms/site-editing.md), validated by the host on every write and drawn on the
site by the theme through `helpers.block()`.

Every block has a Style tab (colors, spacing, font size and alignment from the theme's
presets; containers also take an [advanced background](/docs/cms/themes.md#backgrounds)) and
Advanced settings (an HTML id, class names, hiding at a container width). Layout and media
blocks have a Width field: content width, wide, or full width; see
[Widths and full-width sections](/docs/cms/themes.md#widths-and-full-width-sections).

## The core library

| Category | Blocks |
| --- | --- |
| Text | *Rich text* (a word-processor body, with tables), *Paragraph* (Markdown, with [block references](/docs/cms/block-references.md)), *Heading*, *Quote*, *List*, *Table* (rows of `|`-separated cells, a header row, a caption), *Code* (highlighted on the server for the common languages, no script), *Icon list* (items with an icon, text and a link, in one to three columns), *Notice* (a tip, a success, a warning or an error, with its icon), *Table of contents* (links to the entry's headings, which the server anchors; down to a level, numbered if you like), *Quick answer*, *Questions and answers* (an accordion with optional FAQPage data), *Steps*, *Claim with source*, *Definition*. |
| Media | *Image*, *Gallery* (square tiles, or a wall of logos at one height), *Carousel* (images, or *Slides* of blocks over a background from the slide's Style tab: the hero slider), *Video* (a file from the library), *Audio*, *File* (a library file as a download link with its type and size). |
| Design | *Group* (a stack or a row; full width with a height and a background makes a hero or a band), *Columns* and *Column*, *Grid*, *Tabs* and *Tab*, *Accordion* and *Section* (any blocks inside; "open one at a time" shares a `name` between the sections), *Card* (an image or a site icon with a title, text and a link; boxed or plain: the icon box, image box, feature and team member of page builders), *Button*, *Divider*, *Spacer*, *Pattern* (a synced pattern). |
| Widgets | *Latest entries* (a collection's newest, by term or author, so many, skipping some, sticky first, leaving out the entry being shown), *Form* (one of the site's forms), *Testimonial* (quote, name, role, photo, stars), *Stat* (a number that counts up as it scrolls into view, in the digits it was written with), *Pricing plan* (one plan; plans sit side by side in Columns), *Social links* (profile URLs drawn as the networks' icons), *Share buttons* (the page on Facebook, X, LinkedIn, WhatsApp, Telegram, Reddit, Pinterest, Bluesky or Threads, by email, or its address copied), *Countdown* (days, hours, minutes and seconds to a moment, then what you say), *Breadcrumbs* (the way to the page: home, the section, the parents), *Site logo*, *Navigation*, *Search*, *Language switcher*. |
| Embeds | *Embed* (a page address on YouTube, Vimeo, X, Instagram, TikTok, Spotify, SoundCloud, CodePen, Figma or Loom becomes the provider's player or card, loaded from their servers in a sandboxed frame; no request is made to the provider when the page renders), *Map* (an address Google Maps looks up, or an embed URL from Google Maps or OpenStreetMap; the map loads from their servers), *Custom HTML*. |
| Data | *Custom fields*: values stored with the entry for themes and the API; nothing shows. |

Page builders sell heroes, calls to action, feature grids, pricing tables, team sections and
testimonial rows as widgets. Here they are compositions: a full-width *Group* with a height, a
vertical alignment and a background holds the heading, text and button of a hero or a call to
action; *Columns* or a *Grid* of *Cards*, *Pricing plans* or *Testimonials* make the rows.
Save a composition as a pattern to reuse it.

Tabs and the accordion need no script: without one, every tab panel shows under its title and
the accordion is native `<details>`. A page's script adds the tab switching, the arrow keys
and opening the tab a `#panel` link points at, and counts a stat up.

## Icons

Any of the 1,246 Solar icons can be chosen wherever the dashboard asks for one: a block field
declared with `field.icon()` (the *Card*, the *Icon list* and the *Tab* have one), a
collection, a taxonomy term, a dashboard menu link. The picker searches by name and browses by
Solar's 38 categories, with the icons picked last first; `ICON_CATEGORIES` in
`@cossackframework/cms` is that catalog, and a value is checked against it on write. Settings →
Interface → *Icon style* picks the style every icon is drawn in, on the site and in the
dashboard: line (the default), bold, bold duotone, broken, outline or line duotone.

Templates and block renderers draw an icon with `helpers.icon(name, { class, label })`: an SVG
colored by `currentColor`, sized by `class` (default `size-5`), decorative unless `label` names
it, and null for a name outside the catalog. The artwork is not in the HTML: the icon is
`<svg><use href="/assets/icons/<style>/<group>.<version>.svg#name">`, a reference into one of
the sprites the `cossackCmsIcons()` Vite plugin (`@cossackframework/cms/vite`, in every
generated application's `vite.config.ts`) serves in development and emits into the client
build. There is one sprite per style and category, plus one of the hot set (the site's
`SITE_ICON_NAMES` and the dashboard's `DASHBOARD_ICON_NAMES`), so a dashboard page loads its
icons in one request, and an icon outside that set costs one more request for its category.
The browser caches each sprite for a year; its name carries the icon package's version and the
hot set, so a new package or a changed list is a new file. The dashboard's own `icon(name)` gives
the same reference. `pnpm --filter @cossackframework/cms icons` regenerates the catalog after
updating `@cossackframework/solar-icons`; a test fails while it is stale.

Brands are different: the *Social links* block declares its URLs with `brand: true`, and the
server resolves each URL's network (X, Facebook, Instagram, LinkedIn, YouTube, TikTok, GitHub,
Mastodon, Bluesky, WhatsApp, Telegram and some forty more, by host) into the rendered block's
`icons`, with the brand's path and color from Simple Icons. A page ships the icons it shows and
nothing else; URLs of no known network get the site's link, letter or phone icon.

## Blocks from a theme or plugin

A theme is a plugin, so both add block types the same way: the manifest's `blocks` declares
them (see [the manifest](/docs/cms/manifest.md#blocks)), and `ui.ts` exports `blocks`, a map
from the part of the name after the slash to the component that renders it.

```json
"blocks": [{
  "name": "acme/team-member", "label": "Team member", "icon": "user-id", "category": "widgets",
  "keywords": ["staff", "people"],
  "fields": {
    "name": { "kind": "string", "required": true, "max": 120, "label": "Name" },
    "role": { "kind": "string", "max": 120, "label": "Role" },
    "photo": { "kind": "string", "max": 80, "media": true, "label": "Photo" },
    "bio": { "kind": "text", "format": "markdown", "max": 2000, "label": "Bio" },
    "profile": { "kind": "string", "max": 2048, "brand": true, "label": "Profile URL" },
    "badge": { "kind": "string", "max": 60, "icon": true, "label": "Badge icon" }
  }
}]
```

```ts
import { Client, Component, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { RenderedBlock, ThemeHelpers } from '@cossackframework/cms';

@Component()
export class TeamMember extends Cossack {
  declare props: { block: RenderedBlock; helpers: ThemeHelpers };
  render() {
    const { block, helpers } = this.props;
    const photo = block.media[String(block.data.photo ?? '')];
    const profile = String(block.data.profile ?? '');
    const brand = block.icons?.[profile];
    return html`<div class="acme-member rounded-lg border border-border p-4" ref=${(el: Element) => this.reveal(el)}>
      ${photo ? html`<img src=${photo.url} srcset=${photo.srcset} alt=${photo.alt} class="size-20 rounded-full object-cover">` : null}
      <h3 class="mt-3 font-semibold">${String(block.data.name ?? '')} ${helpers.icon(String(block.data.badge ?? ''), { class: 'size-4' })}</h3>
      <div class="cms-prose text-sm">${html([block.html.bio ?? ''] as unknown as TemplateStringsArray)}</div>
      ${brand ? html`<a href=${profile} rel="me"><svg viewBox="0 0 24 24" class="size-5" fill="currentColor"><path d=${brand.path}></path></svg></a>` : null}
    </div>`;
  }
  @Client() reveal(el: Element) { el.classList.add('acme-member-shown'); }
}

export const blocks = { 'team-member': TeamMember };
```

What the host does for the block:

- **Validation.** Up to 16 fields of kinds `string`, `text`, `enum`, `integer`, `number`,
  `boolean`, `datetime`, `json` (groups of fields) and `richtext`; `media: true` on a string
  makes it a file, `multiple: true` a list, `icon: true` a site icon, `brand: true` a profile
  URL. Each value is checked on every write, in the dashboard and through the API.
- **Repeated items** are child blocks, not list fields: declare `children: { allowed: ['acme/item'], max }`
  on the container and `parent: ['acme/list']` on the item, as the *Icon list* and the
  *Accordion* do. Each item is then its own block in Live Edit and in patterns.
- **The rendered block.** Markdown fields arrive rendered in `block.html`, rich text in
  `block.content` (draw it with `helpers.content()`), media in `block.media` by file ID with
  `srcset`, sizes and a focal point, brand icons in `block.icons` by URL, and `block.children`
  rendered through `helpers.block(child)` so edit markers wrap them.
- **The Style tab** follows the category's defaults; `supports` picks what to offer, and
  `supports: { background: true }` adds the advanced background a container gets.
- **References.** `inline: true` lets `{{ block acme/team-member name="Ada" /}}` place the
  block inside text; `body` names the field a reference's body fills.
- **Behaviour.** The component hydrates on the site like any Cossack component: a `@Client()`
  method, a `ref` or `onMount()` adds what a script must do. Keep the page useful without it.
- **Styles.** Tailwind classes in `ui.ts` are built with the application; a plugin links a
  stylesheet of its own through a `head` export of `ui.ts` (`(site, helpers, plugin) => HeadValue`,
  with `plugin.asset('assets/blocks.css')` for its URL), a theme through `templates/head.ts`;
  `layout.className` reaches every block's wrapper.
- **Variations.** `variations` on a declaration offers preset shapes of the block in the
  inserter, each with its own label, icon and `data` over the defaults: the core Group offers
  Hero and Row, the Card an Icon box, the Gallery a Logo wall, Latest entries Entry cards.
- **Patterns.** The manifest's `patterns` ship sections built from core blocks and the plugin's
  own, stored in the patterns collection when the plugin is granted or the theme activated and
  offered in the pattern picker, with `starter` as starting layouts. That is where a hero, a
  call to action, a pricing row or a team grid belongs: a composition, not a block type. See
  [the manifest](/docs/cms/manifest.md#patterns).
- **The editor** offers the type in every inserter while the plugin is active, with the generic
  field form in the dashboard and in the Live Edit panel; a theme may instead replace a core
  renderer through the `blocks` map of its `theme` export.

Test a plugin block the way the CMS tests its own: render the block through `themeHelpers`
from a unit test, and through a generated application in an integration test (see
[Testing a plugin](/docs/cms/plugins.md#testing-a-plugin)).
