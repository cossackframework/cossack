# Navigation: mega menus, item panels and the navigation block

Builds on `specs/cms-appearance.md` (menus, locations, the menu editor), `specs/cms-layout.md`
(containers) and `specs/cms-themes.md` (helpers, widget areas). Companion to
`specs/cms-site-editing.md`, which makes the header and footer blocks and edits them in place.

The user's decisions (2026-11-06): the menu builder stays simple and gains no second system; mega
menus reuse blocks and patterns; templates stay code, so the theme lays a menu out and the model
only supplies the data. Not built yet.

Today a menu is one JSON tree per menu whose items point at a URL, an entry, an archive or a
term and carry `meta` from field groups. Two things make a mega menu expensive: the server
copies `meta` into the view raw (a media field is a file ID, a blocks field is unrendered), so
every theme resolves it itself; and every item needs a URL, so a column heading is a `#` link
the theme cannot tell from an anchor. Every theme also writes its own dropdown and mobile menu.

## Decisions

- **Items grow three fields, no new tabs.** `kind: 'heading'`: a label without a URL that groups
  the links under it; the sources sidebar gets a Heading box beside Custom link; it resolves with
  `url: null`, so `MenuItemView.url` becomes `string | null`. `description` (≤ 300 characters),
  WordPress's menu item description: the one decoration every theme and the API can rely on,
  shown under a link in a mega panel. `panel`: a pattern's ID. `menuProblems` checks them,
  `normalizeMenu` keeps them, the General tab edits them (a description input for every kind, a
  Panel select of the site's synced patterns with Edit and New pattern links). The limits of
  `MENU_LIMITS` otherwise stand.
- **A panel is a pattern, and it is extra content.** The item's children stay the links; the
  panel is what a dropdown cannot say: a featured card, a CTA, latest posts, an image. The
  pattern is rendered like a widget area (expanded one level, media resolved, latest entries
  filled, `$site` and `$user` bindings, no entry scope) and arrives as `MenuItemView.panel:
  RenderedBlock[] | null`; a deleted pattern is null and the theme falls back to a dropdown.
  Not inline blocks on the item: that puts a second block editor inside menu rows, grows the
  menu document, and loses the pattern editor's revisions, autosave, collaboration and media
  chooser; one pattern also serves every menu and locale. Not "the panel replaces the whole
  dropdown" either: that needs a navigation block that reads the item it opens from, so a
  render scope for the current item; it stays a later upgrade if the ceiling is hit.
- **Meta becomes typed fields.** `MenuItemView.fields: { [name]: FieldView }` replaces `meta`:
  media as `MediaView`, references, terms, blocks rendered, as `EntryView.fields` does. The entry
  view's field conversion (the `fieldView` closure of `entryViews` in `cms/site.ts`) is extracted
  into a shared function both use. The stored item keeps `meta`, as records keep raw values.
- **The host resolves targets, the app renders.** `CmsMenus.forLocation` returns
  `ResolvedMenuItem[]`: titles and URLs resolved, `meta` raw, `panel` an ID. The app's
  `menuViews(cms, items, scopes)` in `cms/site.ts` finishes them into `MenuItemView[]` (typed
  fields, rendered panels); `siteView` and `GET /api/cms/menus/<location>` both call it. Panels
  share the resolved menus' cache (per isolate, 30 seconds, by location and locale).
- **Mega or dropdown is inferred.** A top-level item renders as a mega panel when it has a panel
  or a heading child, and as a dropdown otherwise. No display control to explain; the Advanced
  tab's class names stay the escape hatch.
- **The menu renderer moves into core.** `helpers.menu(location | items, { style, class })`, the
  twin of `helpers.languages()`, with three styles: `dropdowns` (the default theme's desktop
  dropdowns and mobile disclosure from `parts/menu.ts`, which move into `cms/site-view.ts`, plus
  mega panels: one column per heading child, links with their description, icon and badge, the
  panel beside them), `inline` (one row, for footers) and `list` (a column, for sidebars). The
  `core/navigation` block (`location` with a new `locations` choice source, `style`) renders
  through it, so editors place a menu in any area or page. Items' `className` and `attributes`
  keep landing on the link; the active item comes from `helpers.isActive`. A theme overrides the
  block through its `blocks` map or draws its own from the view, as today.
- **Decoration beyond the description is a field group.** The default theme ships
  `default-theme-menu` through its manifest `fieldGroups`, targeting menus: `icon` (an image or
  SVG from the media library, not a Solar name: the icon set would otherwise ship to every
  visitor) and `badge` (≤ 20 characters). The core renderer reads `fields.icon` and
  `fields.badge` when present; other themes ship their own group or none. Nothing else joins the
  core item. A theme needs no grant, so the host stores the active theme's groups itself, on
  activation and as the site loads (`#seedThemeGroups`).
- **Where links are.** Headless clients get the same view from the API: `kind`, `description`,
  typed `fields` and the rendered `panel`. A selected block inside a panel in Live Edit keeps its
  dropdown open (`specs/cms-site-editing.md`).
- **Out of scope.** Editing a menu on the site (a menu document, a follow-up of site editing);
  an item scope for bindings; a per-item display control; icons as a core field.

## Order

1. Model and resolution: `heading`, `description`, `panel`, `url: null`; `ResolvedMenuItem` from
   the host; `menuViews` with the shared field conversion and panel rendering; the API route.
2. Renderer: `helpers.menu`, `core/navigation` and the `locations` choice source; `parts/menu.ts`
   into core with the mega layout; the default theme calls the helper; the shipped field group.
3. Editor: the Heading source, the description input and the Panel select. Docs: a new
   `docs/cms/menus.md` (the builder, headings, panels, the field group, the API shape),
   `docs/cms/themes.md` (the helper, the view) and `docs/cms/api.md`.

## Done when

- A menu whose "Products" item holds two heading children with described links and a panel
  pattern with a card renders a mega panel on the site: columns under the headings, descriptions
  under the links, the card beside them. Deleting the pattern leaves a plain dropdown.
- A theme with no menu code shows dropdowns on desktop and a disclosure on phones through
  `helpers.menu('primary')`.
- A navigation block in a widget area renders the footer menu in one row.
- `GET /api/cms/menus/primary` returns `description`, typed fields (an image as a URL with its
  variants) and the rendered panel.
- Unit: `menuProblems` accepts a heading without a URL, refuses a panel that is not an ID and a
  description over 300 characters; `normalizeMenu` keeps the three fields.

## Delivery

Built 2026-11-06 on `cms-foundation`.

| Where | What | Tests |
| --- | --- | --- |
| CMS package | `MenuItemKind` `heading`, `MenuItem.description` and `panel`, `MENU_LIMITS.description`, `menuProblems` and `normalizeMenu` for them; `ResolvedMenuItem` (the host's output: targets resolved, `url: null` for a heading, raw `meta`, `panel` an ID) and `MenuItemView` (typed `fields`, rendered `panel`); `#resolveMenu`; `MenuOptions`, `MenuStyle` and `ThemeHelpers.menu`; `core/navigation`; the `locations` choice source; the active theme's shipped field groups stored without a grant (`#seedThemeGroups`, from `#refreshPlugins` and `activateTheme`) | `appearance-unit.test.ts`, live `appearance.test.ts` and `themes.test.ts` |
| CMS app | `menuViews` and the shared `fieldViewOf` in `cms/site.ts`, `siteMenus` and `contentMenus`; `menuNav` (dropdowns with mega panels and the small-screen disclosure, inline, list) in `cms/site-view.ts` with `helpers.menu` and the Navigation block; `cms-nav-*` and `cms-mega-*` styles in `blocks.css`; the menu editor's Headings box, Description input and Mega menu panel select; `GET /api/cms/menus/<location>` with typed fields and panels; the default theme renders its menus through the helper and ships the *Menu item details* field group (icon as media, badge) | `generated-runtime-cms.test.js` (a mega menu with a heading column, a described link and a pattern panel on the site and in the API) |
| Docs | `docs/cms/menus.md` (new), `docs/cms/themes.md`, `docs/cms/index.md`, the package README | |
