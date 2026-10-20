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
  and meta win. Theme stylesheets and fonts ship under `assets/`, served like logos, and the
  head template links them by their registry URLs.
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
- **Per-entry template.** Collections get an optional `template` field; the editor offers
  the active theme's template names and saving validates against them; `entryTemplate`
  tries the stored name before `entry-<collection>`. A name the active theme lacks, as
  after a theme switch, falls back silently.
- **Site collections from plugins.** A plugin resource may set `site: true`: it gets URLs,
  an archive, path resolution and a dashboard section like posts. A theme can then ship the
  collections it is designed for, migrated and granted with the plugin.
- **Child themes.** Manifest `extends: "<parent>"`. The host resolves the parent
  registration and `assembleSiteTheme` layers the child's templates, options and locations
  over the parent's, slot by slot, as it already layers `ui.ts` over files. A child stores
  its option values under its own name (`<child>.<option>`), so switching between parent
  and child stays a settings write; a child starts from its defaults.
- **Widget areas.** A location whose items are blocks, edited under Appearance and exposed
  on `SiteView.areas`. Blocks and patterns already cover what shortcodes and widgets did.
- **No render-time hooks.** Plugins add data through loaders and markup through blocks.
  Nothing rewrites a theme's output.

## Front-end block editor

- **Why it is possible.** Blocks are stored as JSON with ids and arrive on the page as
  `RenderedBlock` with `id`, `type`, `data` and rendered `html`; bodies are ProseMirror JSON.
  Edits write JSON back and the same template re-renders. There is no second representation.
- **Edit mode is page state.** A signed-in user with write access to the entry sees a
  toolbar component in the site layout. The toolbar is a lazily imported chunk behind that
  check: a static import from the site layout would land in every visitor's bundle.
  Visitors get no extra markup or script.
- **Marking blocks.** `helpers.block` and `helpers.content` wrap each block in edit mode with
  a `display: contents` marker carrying the block id. Themes never learn about editing; a
  theme that renders blocks through the helpers is editable. Core block renderers go
  through `helpers.block`, so they are covered.
- **Editing.** Click a block to edit its fields in place (rich text through the dashboard's
  TipTap setup, other fields in a popover). A rich text body is one ProseMirror document
  that `helpers.content` splits into HTML runs and embedded blocks, so the editor opens the
  body as one document and the site re-splits it on save, rather than editing run by run.
  The blocks field is a true array: drag or use the keyboard to reorder; it is a splice,
  reusing the menu editor's drag and move code. Title, slug, terms and custom fields open
  in a side panel reusing dashboard forms.
- **Saving.** Through the existing content API with the revision check; a stale page gets
  a conflict notice and reloads. Edit mode renders the draft like a preview, so previews,
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
  compares both with and without the editor present.
