# CMS appearance: themes, menus and the rich text editor

Status: implemented on branch `cms-foundation`. Follows the [CMS dashboard](cms-dashboard.md).
Updated 2026-10-16. See [Outcome](#outcome).

## Decisions

- **Themes are plugins.** As in VS Code, a theme is an extension: a plugin whose manifest has a
  `theme` field (label, description, menu locations, options) and whose `ui.ts` exports `theme`
  (the site templates). A package can be only a theme, or a plugin that also ships one. Theme
  templates are presentation and need no grant; a theme's resources, hooks or network access
  follow the plugin grant like any plugin's.
- **Artwork.** A plugin's `logo` and `cover` are images in its `assets/` (default
  `assets/logo.*` and `assets/cover.*`), served as build assets through the plugin
  registry. Without them, the dashboard draws initials and a gradient from the name.
  Plugins that only ship a theme have nothing to grant and count as active.
- **One active theme, switched at runtime.** `appearance.theme` names it. Every rendered theme is
  in the build, so activating one is a settings write, not a deployment. A missing or invalid
  theme falls back to the first valid one, then to minimal built-in templates.
- **Default theme.** `cossack add cms` renders `src/plugins/default-theme/` as application
  source, like the dashboard: edit it or copy it to start a theme. Its options (accent colour,
  content width, footer text, search box) are a settings group named after the plugin and
  shown under Appearance → Customize.
- **Theme contract.** `@cossackframework/cms` exports `SiteTheme`: `layout`, `home`, `entry`,
  `archive`, `search` and `notFound` templates over plain view data (`SiteView`, `EntryView`,
  `ArchiveView`, menus). Templates receive helpers that render blocks, so plugin block
  components work in every theme.
- **Menus.** `cms_menus` holds a menu's items as one JSON tree with a revision. Saving is one
  conditional `UPDATE` on the revision, so a stale editor writes nothing. A menu is small and
  edited as a whole; rows per item would turn a drag into dozens of statements. Items link to
  a URL, an entry, a collection archive or a term. Entries and terms are stored by ID and
  resolved when the site renders, so renames and new slugs keep working, and unpublished or
  deleted targets are hidden. At most 300 items and 5 levels.
- **Locations.** Themes declare menu locations (`primary`, `footer`). `cms_menu_locations`
  assigns a menu to each; assignments survive theme switches by name. Without one, `primary`
  lists the published top-level pages. Resolved menus are cached per isolate for 30 seconds and
  dropped on writes.
- **Menu editor.** WordPress's layout: item sources on the left (each collection with a URL,
  each taxonomy with archives, custom links), the structure on the right. The structure is a
  flat list with depths. Dragging uses pointer events, so mouse, touch and pen work; the
  horizontal offset sets the depth. Buttons move items up, down, in and out, and a live region
  announces each move.
- **Permissions.** `cms:appearance` covers themes, Customize and menus. Only administrators have
  it by default.
- **Rich text.** Posts and pages edit their body in a WYSIWYG editor that stores a JSON
  document, not HTML: the site, the content API and mobile apps render it their own way. The
  editor is TipTap 3 (ProseMirror), whose JSON is a widely supported format. It loads only in
  the browser from a `*.client.ts` module, so it never enters the Worker bundle.
- **Rich text contract.** A `richtext` field holds `{ type: 'doc', content }` with an allow-list
  of nodes (paragraphs, headings, lists, quotes, code, rules, line breaks, images), marks (bold,
  italic, underline, strike, code, links) and attributes. Link URLs are `http(s)`, `mailto`,
  `tel`, relative or fragments; images are media files or `https` URLs. The host validates every
  write and the HTML renderer escapes all text and attributes. Top-level `cmsBlock` nodes embed
  blocks (`{ id, type, data }`), validated like a blocks field and rendered by the theme.
- **Search.** A searchable rich text field also stores its plain text in `_text_<field>`, which
  the full-text index covers instead of the JSON.
- **Content API.** `GET /api/cms/content/<collection>` and `/api/cms/content/<collection>/<id or
  slug>` return published entries with rich text as JSON; `GET /api/cms/menus/<location>`
  returns a resolved menu. Requests read as the signed-in user when a session is present.
- **Permalinks.** Any collection can be served at the site root (`path: ''`), like WordPress's
  "Post name" structure. Root entries share one slug namespace with pages, other root
  collections, the application's routes (`reservedPaths`) and archive bases; a taken slug gets
  `-2`. Nested collections resolve first. Settings → Permalinks moves posts between the root and
  a base and edits term archive bases; Settings → Reading's posts page lists posts.
- **Breaking change.** Stored Markdown bodies of posts and pages are not converted. Markdown
  stays a text format for collections that choose it.

## Done when

A generated Node application and the same application on Workers pass, against `fastdb serve`:
a menu with nested entry, term and custom items is built by dragging in a browser and saved,
assigned to the primary location and shown on the site; a stale menu save is refused; the
active theme switches and its options apply; a post written in the rich text editor saves
JSON, renders on the site, is found by search and is returned by the content API.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | `richtext` fields (`field.richText`, `checkRichText`, `richTextHtml`, `richTextParts`, `richTextPlain`, `richTextExcerpt`, `richTextFromPlain`), `_text_<field>` search text, menus (`cms.menus`, `menuProblems`, row helpers for the editor), host step 3 (`cms_menus`, `cms_menu_locations`), repository `getMany`, `cms.entryUrls`, themes (`ThemeManifest`, `SiteTheme`, `cms.themes()`, `activeTheme`, `activateTheme`, `menuLocations`), per-group settings permissions, `cms:appearance` | 13 new tests (70 in the package): unit tests for the document contract, the HTML renderer, tree moves and theme validation; a live suite for theme switching and options, menu revisions, resolution and locations, rich text storage and search |
| Scaffold | Site pages render through the active theme; `src/plugins/default-theme/`; Appearance screens (Themes, Customize, Menus, the menu editor with pointer drag and drop); the rich text field (TipTap 3.32.0 from `rich-text.client.ts`) with media and embedded blocks; `/api/cms/content` and `/api/cms/menus`; Quick Draft writes rich text | Recipe tests (220 in the package) |
| Generated app | The flow in [Done when](#done-when) on Node and on Workers; in Chromium, bold text in the editor and a menu item nested by dragging and by the arrow keys; TipTap in the client bundle and not in the server bundle; the default theme passes the plugin policy lints | `generated-runtime-cms.test.js`, `generated-runtime-cms-plugins.test.js` |

Findings:

- A component's props type must be a type alias, not an interface: `component()` requires
  props assignable to `Record<string, unknown>`.
- `@Client()` methods are no-ops during SSR. Helpers that `render()` calls stay undecorated and
  are kept in the client bundle transitively.
- In an installed (not linked) application, Vite's SSR pre-bundling of `@cossackframework/ui`
  embedded a second renderer, so the server printed `repeat()` output as `[object Object]` in
  development. The template excludes core and the renderer from SSR pre-bundling. Linked test
  applications do not pre-bundle workspace packages, so only an installed app shows it.
- The same happened in the browser when Vite discovered page dependencies late (icons, `cms`,
  TipTap) and re-bundled mid-load. The scaffold now lists the browser dependencies that
  rendered source imports in `vite.config.ts`, so the first bundle has them all.
