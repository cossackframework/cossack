# Themes: parity with WordPress and front-end block editing

Builds on `specs/cms-appearance.md`. Themes own templates, never routes; templates are
pure functions over view data and never read the database. Every item below keeps that.

## Decisions

- **Typed fields on entries.** `EntryView.fields` holds each field's value by name, with
  media as `MediaView` and references as `{ id, title, url }`. Built in `entryViews` from the
  collection's declarations. `details` stays for themes that only want a label list and is
  derived from `fields`, so a theme never sees two values for one field.
- **Head contributions.** An optional `templates/head.ts` returns a `HeadValue` for
  `(site, helpers)`; the site layout merges it under the page's own head, so a page's title
  and meta win. Theme stylesheets and fonts ship under `assets/` (`.css`, `.woff2`, `.woff`,
  `.ttf`, `.otf` besides images), served like logos, and the head template links them with
  `helpers.asset('assets/<file>')`.
- **Loaders, not database access in templates.** A theme's `server.ts` exports `loaders`,
  keyed like templates (`layout`, `home`, `entry`, `entry-<collection>`, `archive`, `term`,
  `term-<taxonomy>`, `search`). Each receives the resolved view and the plugin's
  `context.cms` and returns plain JSON. Which loaders run follows the template hierarchy:
  the site runs `layout` plus the one loader the hierarchy picks for the page, never every
  matching key, so a post does not pay for `entry` and `entry-posts`. The site pages run
  them in `init()` on the server, with the plugin's grants, the visitor principal and a
  timeout; a failure yields `{}`, not a 500. Results are page state (`@State`), because
  templates re-render on the client after a server method call; so a result is plain JSON
  with a documented size limit. Templates read it as `helpers.data.layout` and
  `helpers.data.page`. No bypass flag: reads a theme needs are `permissions.resources`
  grants an administrator sees. A theme with loaders that request grants is no longer
  theme-only; its templates still render before the grant, with `helpers.data` empty. A
  declarative form (named queries in `plugin.json`) can follow.
- **Per-entry template.** Collections on the site (those with a `path`) get a core `template`
  field; the editor offers the active theme's `entry-*` templates except those named after a
  collection (`cms.entryTemplates()`), and a write that changes the value validates against
  them; `entryTemplate` tries the stored name before `entry-<collection>`. A name the active
  theme lacks, as after a theme switch, falls back silently and survives other edits.
- **Site collections from plugins.** A plugin manifest declares `collections`, definitions
  like a module's: each is stored as `cms/<name>` and gets URLs, an archive, path resolution
  and a dashboard section like posts, because every site and dashboard path already keys
  collections that way (a `site: true` flag on generic plugin resources would need all of
  them generalized). A theme can then ship the collections it is designed for, migrated and
  granted with the plugin: they are hidden from the site and the dashboard until the plugin
  is active, count as the plugin's own resources for its repositories and the policy lints,
  and make it more than theme-only. A name another module or plugin declares makes the plugin invalid.
- **Child themes.** `theme.extends: "<parent>"` in the manifest. The host resolves the parent
  registration and `assembleSiteTheme` layers the child's templates, loaders, assets,
  options, locations and areas over the parent's, slot by slot, as it already layers `ui.ts`
  over files. Themes extend one level; a missing or invalid parent makes the child unusable.
  A child stores its option values under its own name (`<child>.<option>`), so switching
  between parent and child stays a settings write; a child starts from its defaults. Pages
  carry the parent's name in their theme state so the browser assembles the same theme.
- **Widget areas.** `theme.areas` names them, like locations. Each area's blocks are one
  `cms_areas` row (host step 7) saved with a revision check and validated like a blocks
  field; areas keep their blocks across theme switches. Appearance → Widgets edits them;
  `SiteView.areas` carries them rendered. Blocks and patterns already cover what shortcodes
  and widgets did.
- **No render-time hooks.** Plugins add data through loaders and markup through blocks.
  Nothing rewrites a theme's output.

## Front-end block editor

- **Why it is possible.** Blocks are stored as JSON with ids and arrive on the page as
  `RenderedBlock` with `id`, `type`, `data` and rendered `html`; bodies are ProseMirror JSON.
  Edits write JSON back and the same template re-renders. There is no second representation.
- **Edit mode is page state.** A signed-in user with write access to the entry sees a small
  bar on the entry's page (fixed to the viewport, rendered by the page, which knows the
  entry); `?edit` or its button enters edit mode. The editor is `site-editor.client.ts`,
  imported only on entering edit mode: a static import would land in every visitor's
  bundle. Visitors get no extra markup or script, and editors' pages are `private, no-store`.
- **One content list.** `entry.content` is every blocks field of the entry, and each rich
  text or Markdown field as one `core/richtext` block carrying `field`, in field order;
  `helpers.block(entry.content)` renders it. `entry.fields` keeps the fields apart.
- **Marking blocks.** `helpers.block` wraps each block in edit mode with a `display:
  contents` marker carrying the block id, or the field's name for a field's rich text.
  Themes never learn about editing; a theme that renders blocks through the helper is
  editable. Core block renderers go through `helpers.block`, so they are covered.
- **Editing.** Click a block to edit its fields in place (rich text through the dashboard's
  TipTap setup, other fields in a popover). A rich text field is one ProseMirror document
  that the site splits into HTML runs and embedded blocks, so the editor opens the field
  as one document and the site re-splits it on save, rather than editing run by run.
  The blocks field is a true array: drag or use the keyboard to reorder; it is a splice,
  reusing the menu editor's drag and move code. Title, slug, terms and custom fields open
  in a side panel reusing dashboard forms.
- **Saving.** Through the dashboard editor's save (`saveEntry`, the same repository update
  with the revision check that the content API makes, plus typed tags becoming terms); a
  stale page gets a conflict notice and reloads. Every server call checks again that the
  user may update the entry. Edit mode renders the draft like a preview, so previews,
  revisions and scheduling apply unchanged.
- **Out of scope.** Options and menus stay in Customize. Loader data is read-only on the
  page. Blocks a theme renders outside the helpers are not editable in place.

## Order

1. Typed fields, head contributions and loaders: a non-blog theme needs its stylesheet and
   its data before anything else.
2. Site collections from plugins.
3. Per-entry templates.
4. Front-end block editor.
5. Child themes and widget areas, once a second theme needs them.

## Done when

- A portfolio theme ships its `projects` collection, lists related projects on an entry
  through a loader under a granted read, and renders its own stylesheet from `assets/`.
- Before the grant, the same theme renders with empty loader data and no error.
- An editor picks a template for one page and sees it on the site.
- A signed-in editor reorders and edits blocks on the public page and the change shows in
  the dashboard's revision history.
- Visitors' HTML and client bundle are unchanged by edit mode, checked by a test that
  compares a visitor's page before and during an unsaved edit, and the scripts a visitor's
  page and an editor's page load; the editor's chunk loads only on entering edit mode.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | `EntryView.fields` (`FieldView`, `EntryReference`), `EntryView.template`; `ThemeHelpers.data` and `asset()`; `SiteTheme.head`; `templateCandidates`, `pickTemplate`, `entryTemplate` with a chosen template, `entryTemplateChoices`; `cms.themeData()` and `cms.themeLoaders()` (`ThemeLoaders`, `ThemeLoaderContext`, `themeLoaderTimeoutMs`, `themeDataLimit`); manifest `collections` (`CollectionDefinition.plugin`, shown only while the plugin is active, own resources of its plugin); the core `template` field (`ENTRY_TEMPLATE`, `cms.entryTemplates()`, checked on change); `theme.extends` (`layerSiteThemes`, `ThemeInfo.parent`); `theme.areas`, `cms.areas` (`CmsAreas`, host step 7 `cms_areas`), `cms.areaLocations()`, `SiteView.areas` | `tests/themes.test.ts` (live: loaders under grants, failures, timeouts and limits; plugin collections; chosen templates across a theme switch; child themes; widget areas) and unit tests for candidates, layering and manifest checks; 108 tests in the package |
| Framework | The plugin registry carries `templates/*.ts` modules and serves `.css` and font files from `assets/` | `plugin-composition.test.ts` |
| CLI | Plugin policy lints treat a plugin's collections as its own resources | `plugin-policy.test.js` |
| Scaffold | Entry views with typed fields and references; site pages run loaders and merge theme heads; the Template box in the entry editor; Appearance → Widgets; the default theme's footer area; the site editor (`site-editor.ts`, `site-editing.ts`, `site-editor.client.ts`) with shared field controls and media chooser; the SSR build names assets like the client build, so theme stylesheets resolve | Recipe tests; `generated-runtime-cms-themes.test.js` |
| Generated app | The flow in [Done when](#done-when): a portfolio child theme ships `projects`, lists related projects through its loader once granted and links its stylesheet; a page uses `entry-wide`; a footer widget shows; in Chromium an editor reorders a block with the keyboard, edits another in place, saves (revision 2 by them in the dashboard) and gets a conflict notice after a save elsewhere; visitors' HTML has no edit markup and the editor chunk loads only in edit mode | `generated-runtime-cms-themes.test.js` |
