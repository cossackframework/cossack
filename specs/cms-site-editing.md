# Site editing: areas with defaults, site blocks, and Live Edit across documents

Builds on `specs/cms-themes.md` (widget areas, the front-end block editor), `specs/cms-layout.md`
(containers), `specs/cms-taskbar.md` (where Live Edit starts) and `specs/cms-navigation.md` (the
navigation block and `helpers.menu`). Built 2026-11-07 on `cms-foundation`; the guide is
`docs/cms/site-editing.md`. See [Delivery](#delivery) for what was left out.

The user's decisions (2026-11-06): **templates stay code**; the editable regions of a site are
its widget areas, and a theme makes more of its layout editable by declaring more areas. The
header and footer become blocks so Live Edit reaches them from the first day. Live Edit grows
from one entry to the documents on the page: the entry and the areas first, synced patterns
second; menus and settings are follow-ups.

Today Live Edit is state of the catch-all page: one draft, one blocks field, one body field, and
markers only on the blocks the page renders with `editing` on. The layout renders the frame and
the areas with its own helpers and never marks them; the default theme's header and the footer's
bottom line are template HTML, so there is nothing to select.

## Decisions

- **Areas carry defaults.** `theme.areas.<name>` is a label, as today, or `{ label, blocks }`:
  blocks with IDs, checked against the core block types when the manifest is checked (plugin
  types are left out at render when their plugin is inactive, as saved areas do). The site renders
  the defaults until the area has a row in `cms_areas`; the first save persists the blocks as
  they are then, defaults included (`expectedRevision: 0` takes the insert path). `ThemeInfo.areas`
  and `cms.areaLocations()` carry `defaults`; a child theme replaces a parent's area entry by
  name. `$site.year` joins the site binding scope for the footer line. An area without defaults
  renders nothing while empty, as today. Appearance → Widgets shows the defaults for an area
  without a row and offers *Reset to the theme's default*, which deletes the row
  (`cms.areas.reset`).
- **The default theme's header and footer bar are blocks.** Two new areas with defaults: `header`
  (a row group: site logo, navigation of `primary` as dropdowns, search hidden on phones,
  languages) and `footer-bar` (a row group: navigation of `footer` inline, languages, a paragraph
  `© {{ $site.year }} {{ $site.title }} · [RSS](/feed) · [Log in](/auth/login)`). The existing
  `footer` area keeps its meaning (the widgets grid above the bar) and its rows, so nothing
  migrates. The layout template keeps the frame around them: the border, the content width, the
  skip link. The theme options `showSearch`, `languages`, `languageStyle` and `footerText` go:
  the blocks' own fields and presence say the same, and an option that stops applying once an
  area is customized would mislead. `docs/cms/languages.md` and the themes tests follow.
- **Site blocks, twins of helpers.** `core/site-logo` (`image` override, `showTitle`,
  `showTagline`, `size`; the site's logo from Settings when `image` is empty), `core/navigation`
  (from `specs/cms-navigation.md`), `core/search` (`placeholder`, `style` box or icon, through a
  new `helpers.search()`), beside the existing `core/button` and `core/languages`. Category
  `widgets`, offered in areas and content alike. `core/group` gains `direction` (column or row)
  and `justify` (start, center, end, between): a row group is a flex row of auto-width children
  (`.cms-group[data-direction=row]` in `cms/blocks.css`), and the button renderer gets a
  `cms-button` wrapper whose margins a row group zeroes. Changing the site's logo file itself
  stays a setting until a settings document exists.
- **Live Edit edits documents.** A `SiteDocument` is `{ key, kind: 'entry' | 'area', id,
  revision, blocks, editable, label }`. The draft carries `documents`; the entry's other fields
  stay in `values`, its blocks field is the `entry` document. The render state's `editing` names
  the document (`{ doc: 'entry' }` on the page, `{ doc: 'area:header' }` in the layout), and the
  marker carries `data-cms-doc` beside `data-block-id`. The Blocks panel groups the tree by
  document (Header, Content, Footer widgets, Footer bar); the inserter offers what each allows
  (areas take no `core/pattern`, as Widgets does, until patterns are documents); selection, moves,
  forms, hide and device toggle work the same. Save writes every changed document: the entry
  through `saveDraft`, each area through `cms.areas.save` with its revision; a conflict is per
  document, with its own Reload, and the others still save. `editable` is false for an area
  without `cms:appearance` and for an entry the user may not update: a locked document keeps its
  markers with a lock outline and a hint, and nothing in it selects.
- **One session, two owners.** The frame is the layout's and the entry is the page's, and a
  page's server method re-renders the page alone. A client store `siteEditing` (as
  `stores.client.ts` does) holds the documents and the dirty state: the page contributes `entry`
  and previews it as now; the layout contributes its areas and previews them through its own
  server method (`previewArea(name, blocks)`, re-rendering `site.areas[name]` from the draft's
  blocks); the editor component reads the store. The first step is a scratch prototype of this
  loop in a generated app, as the collaboration work probed sync bugs, before the rest is built.
- **Entering.** Live Edit shows in the taskbar on every catch-all page with an editable document:
  an entry the user may update, or any area for a user with `cms:appearance`, so an archive or
  the home list is editable for its header and footer. The search route and the auth pages stay
  out. A selected block inside a mega menu panel forces its dropdown open while selected.
- **Patterns second.** Document kind `pattern`: a block inside a synced pattern, in content, an
  area or a menu panel, selects the pattern document, labelled "Changes apply everywhere this
  pattern is used"; it saves through the patterns repository with its revision. Then
  `core/pattern` is offered on the site. Menus (editing the navigation block's tree in place with
  the row model the menu editor and block tree share) and settings (title, tagline, logo) are
  follow-ups; meanwhile the navigation block's panel links to the menu editor.
- **Visitors.** No new markup or script: defaults render on the server like rows, the editor
  loads only in edit mode, caching is unchanged.
- **Out of scope.** Editable templates; a freeform canvas; a Styles panel (options and presets
  in place: cheap later, both are settings); menu and settings documents; a mobile drawer block.

## Order

1. Area defaults, site blocks, the row group, `$site.year`; the default theme's `header` and
   `footer-bar` with their defaults and the four options removed; Widgets shows defaults and
   resets. Needs step 2 of `specs/cms-navigation.md` for the navigation block.
2. The session prototype, then documents: the draft shape, markers with documents, layout
   previews, the grouped Blocks panel, per-document save and conflicts, locked documents, the
   taskbar entry on every catch-all page.
3. Patterns as documents.
4. Docs: `docs/cms/themes.md` (areas with defaults, site blocks, the helpers) and a Live Edit
   guide `docs/cms/site-editing.md`; the themes and languages tests; a generated-runtime suite
   for site editing.

## Done when

- A fresh site shows the default theme's header (logo, menu, search, languages) and footer bar
  with no rows in `cms_areas`; a visitor's HTML carries no edit markup.
- An administrator opens Live Edit on a post, sees Header, Content, Footer widgets and Footer
  bar in the Blocks panel, removes the search block, adds a button, edits a heading of the post
  and saves once: the header row exists with revision 1, the post has a new revision, a visitor
  sees both.
- An author without the appearance permission sees the header locked and edits the post alone.
- An area saved elsewhere meanwhile shows a conflict with Reload on that document while the post
  saves.
- A theme that declares `header` without defaults renders nothing there until Widgets or Live
  Edit fills it; a child theme's own `header` defaults replace the parent's.
- In Chromium, clicking a block inside a synced pattern in the footer selects the pattern
  document, and saving changes it on another page too.

## Delivery

| Where | What | Tests |
| --- | --- | --- |
| CMS package | `ThemeAreaManifest` and `themeArea` (areas as `label` or `{ label, blocks }`, default blocks checked against the core types in `manifestProblems`), `ThemeInfo.areas[].defaults`, `cms.areaLocations()` with defaults, `cms.areas.reset`; `core/site-logo`, `core/search`, `core/group` `direction` and `justify`; `SearchOptions` and `ThemeHelpers.search`; `RenderedBlock.pattern`, `sourceId`, `document` and `locked` | `appearance-unit.test.ts`, live `themes.test.ts` |
| CMS app | `areaViews` renders defaults, drafts and pattern drafts; `siteInfo`, `$site.year`; `searchForm`, `tagDocument` and markers with `data-cms-doc` and `data-cms-locked` in `cms/site-view.ts`; row groups, the logo and the search in `blocks.css`; Widgets shows defaults and resets; the default theme's `header` and `footer-bar` areas with their default blocks, four options removed; `SiteDocument` (areas and patterns) in the draft, `pageDocuments`, `saveDocuments`, `areaDraftBlocks`, `patternDraftBlocks`, `draftEntry` with pattern drafts; the shared `siteSession` store; the layout's `editing` context, `previewAreas` and markers at render; the editor's documents in the Blocks panel, locked documents, per-document conflicts | `menu-nav.test.ts`, `edit-markers.test.ts`, `generated-runtime-cms.test.js` (the default header and footer bar), `generated-runtime-cms-themes.test.js` (the header edited and saved in place; a pattern placed, edited in place and saved as the pattern) |
| Docs | `docs/cms/site-editing.md` (new), `docs/cms/themes.md` (areas with defaults, site blocks, `helpers.search`), `docs/cms/languages.md`, `docs/cms/block-references.md`, the docs index | |

Left out, as follow-ups: the Styles panel; menu and settings documents. The layout's previews
bind to the site and the user, not to the entry shown, and place no forms. On a list page the
frame is edited alone (`frameDraft`): no Entry or Text panel, no notes.
