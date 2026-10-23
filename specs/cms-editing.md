# Editing: content as blocks, templates, lists and the dashboard's polish

Builds on `specs/cms-dashboard.md`, `cms-essentials.md` and `cms-layout.md`. Status:
implemented on branch `cms-foundation`, 2026-10-22. See [Outcome](#outcome).

The second dashboard pass, from the UI review in `ui-fix.md`: content becomes blocks with a
rich text block inside it (as WordPress), collections start entries from a block template,
block settings open in a side panel, entry lists get selection, sorting and bulk actions,
and plugins get hooks on terms, comments, menus and the lists.

## Decisions

- **Content is blocks.** Posts, pages and patterns have a `content` blocks field instead of a
  rich text `body`. The `core/richtext` block is the word processor: a rich text field inside
  a block, written in place in the block tree (never in the panel). Blocks fields can be
  searched: their plain text (string, text and rich text fields of non-data blocks) is kept
  beside the document, as rich text fields' was. Entries saved with a rich text `body` still
  render it; the feed and `?format=html` render blocks to plain HTML.
- **Templates.** A collection's `template` is the blocks a new entry starts with, checked
  like an entry's blocks; `templateLock` is `insert` (keep the blocks, reorder them) or `all`
  (fill them in only). Posts and pages start with one Rich text block. The builder edits the
  template with the same tree and panel as entries. Starter patterns still replace the content.
- **Data blocks.** The `data` category: a block stores values (`core/meta`, custom fields as
  `name: value` lines) and the site renders nothing for it. Data blocks have no Style tab,
  show "Data only" in the tree and are left out of excerpts and search text. Themes read them
  from `entry.blocks`; the API returns them with the content.
- **Patterns are blocks.** A synced pattern is a `core/pattern` block in the content (or in
  rich text); the site expands it one level, with prefixed block IDs. An unsynced pattern is a
  copy of its blocks. Patterns are offered beside the top-level inserter.
- **Panel editing.** Block settings open in a sheet at the side (`block-panel.ts`): General
  and Style tabs. Every change applies to the block at once, as editing in place does, and
  Done closes the panel; saving the entry checks what is required. A validation message that
  names a block (`block <id>.<field>`) is shown with the block's label and the field's
  (`cms/block-errors.ts`), and the tree opens to that block, flashes it and scrolls to it.
  The tree shows a summary, the rich text in place, and
  icon buttons with tooltips; removing a block asks first. Block icons are coloured by
  category. Widgets, the builder and forms use the same panel; the tree has no inline
  mode, so a form's conditional logic is in the panel too. Only containers collapse, and
  they start collapsed with a count of what they hold; a new container, or one a block is
  moved into, opens. Blocks with nothing to edit in place have a header alone.
- **Dynamic content.** A block's text field may bind to a field of the entry it renders on:
  `$.price` as the whole value, or `{{ $.price }}` inside text (`bindings.ts`; dotted paths
  walk into rows, `$.specs.0.name`). The site resolves bindings when it renders an entry's
  blocks, the entry's own fields and its field groups' alike; a database button beside text
  controls in the block panel picks the field. Widget areas have no entry, so they keep the
  text as written.
- **New blocks.** Rich text, Card (image, title, Markdown, link, image position), Carousel
  (scroll-snapping track; `carousel.client.ts` adds arrows, dots, keys and autoplay), Latest
  entries (collection, count, term, order, list/grid/titles; resolved on the server like
  forms, as list views), Custom fields (data); the Divider gains orientation, thickness,
  length, colour (palette slug or CSS) and centred text.
- **Entry lists.** "Add new" sits beside the title; the filter row sits under the status
  tabs with a Filter icon button; checkboxes with bulk actions (publish, unpublish, trash,
  restore, delete, plus plugins'); Title and Date sort through `?sort=&dir=`; a featured
  image thumbnail with a hover preview; a Duplicate action (a draft copy, "(Copy)" after the
  title, slug derived again, owned by the copier).
- **Hooks.** `cms.term.before-save`, `cms.comment.before-save` (return `status: 'spam'` to
  hold, throw to refuse) and `cms.menu.before-save` filter writes; `cms.dashboard.entry-actions`,
  `entry-columns` and `bulk-actions` add links or plugin commands (`{ resource, id }` or
  `{ resource, ids }` as the command's input) and columns to lists. Plugins declare them in
  the manifest's `hooks` like the others.
- **Terms** have an `icon` (host schema step 9); the dashboard generates slugs from names
  until they are edited. **Menu items** take `className` and `attributes` (an Advanced tab;
  `href`, `class`, `target`, `style` and event handlers cannot be set), show their kind's
  icon and use icon buttons. **Plugins and themes** name an `author` and `authorUrl`.
- **Dashboard home.** A Waiting for review card (entries pending, across collections), the
  newest published entries of every collection, and Recent sign-ins (active sessions, newest
  first) for user managers. The brand links to the site; the theme toggle shows the current
  mode's icon. Tab counts are badges. Media screens show where a file is used, from the
  newest 400 entries of each collection and the widget areas.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | `content` on posts, pages and patterns; `template`/`templateLock`; the `data` category, `blockIsData`; `core/richtext`, `core/card`, `core/carousel`, `core/latest-entries`, `core/meta`, the divider's options; rich text in block fields (`blockMedia`, `blockDocuments`, `blocksPlain`, `cloneBlocks`); searchable blocks fields; term `icon`; menu `className`/`attributes`; `author`; the six new extension points; `listRecent` sessions | `essentials-unit.test.ts`, `unit.test.ts`, `schema.test.ts`; live: `appearance.test.ts` (content blocks, search, template checks), `themes.test.ts`, `essentials.test.ts`, `collections.test.ts`, `content.test.ts` |
| Scaffold | Entries list (selection, bulk, sort, thumbnails, duplicate, plugin actions and columns); dashboard cards; `block-panel.ts`, `block-tree.ts` (panel mode, confirmations, lock, patterns button), `block-inserter.ts` colours; `carousel.client.ts`, `blocks.css`; site rendering of rich text in blocks, data blocks, pattern expansion and latest entries; builder template card; term icons and auto slugs; menu editor tabs; media usage; plugin and theme cards; `dark` custom variant in `style.css` | Recipe tests; `generated-runtime-cms*.test.js` |

Findings:

- `dark:` utilities need `@custom-variant dark (&:where(.dark, .dark *))` in the app's
  stylesheet; the UI theme sets `.dark` on `<html>`, and Tailwind's default `dark:` follows
  the system preference instead.
- A collection with several blocks fields renders all of them into `entry.blocks`, in
  declared order; `entry.fields` keeps them apart for themes that place them differently.
