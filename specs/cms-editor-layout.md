# Editor layout: tabs, sections and boxes of the entry editor

Status: implemented on branch `cms-foundation`, 2026-10-30. Follows [the collection
manager](cms-collection-manager.md) and [field groups](cms-meta-boxes.md). The proposal and
the feedback it answers are in the gitignored `plan-cms-improvements.md` ("Organizer").

The entry editor was one fixed composition: the title, tabs Edit / Settings (forms) / JSON,
a main column (content, excerpt, main field groups, the SEO box) and a sidebar (Publish,
Attributes, Languages, Template, taxonomies, Details, sidebar groups, Discussion,
Revisions). A collection with many fields buried what mattered, a group's place was the
group's (`placement`) rather than the collection's, and a plugin could add nothing to the
screen. This spec makes the arrangement data.

## Decisions

- **Name.** "Editor layout", not "Organizer": the manager's tab is **Editor**, the field
  `CollectionDefinition.editor`. "Layout" alone is the site's. On screen a box is a **meta
  box**, WordPress's word for exactly these panels; the code and the stored type keep the
  shorter `box` (`editor/box`, `EDITOR_BOX`).
- **Boxes have stable IDs** (`EDITOR_BOX`): `field:<name>` (a feature such as the content
  or the featured image, or a declared field), `group:<id>`, `taxonomy:<name>`, and the
  editor's own `seo`, `attributes`, `languages`, `template`, `discussion`, `revisions`.
  `editorBoxes({ collection, fields, groups, taxonomies, special })` lists a collection's,
  in the order the editor showed them, main column first; each carries a default
  `placement` and, for the editor's own, a `note` saying when it shows. The title with its
  permalink and the Publish box are pinned, not boxes. Blocks fields such as the content
  render bare; every other field is a card titled by its label, so "Details" is gone and
  each sidebar field is its own box.
- **A layout is a block tree**, edited with `BlockTree` in a third role and validated with
  `validateBlocks`: `EditorLayout = { tabs, sidebar }`. `tabs` holds `editor/tab` blocks
  (label, an icon from the dashboard's set), the first with the ID `edit` (its label may
  change, it cannot move or go). A tab's block ID is its ID in the editor's address
  (`?tab=pricing`): a slug of at most 40 characters (`EDITOR_TAB_ID`), never `json` or
  `sidebar` (`EDITOR_TAB_RESERVED`); the manager's panel fills it from the label
  (`editorTabId`) until it is typed by hand;
  the sidebar is shared by every tab, so the Publish box never leaves the screen. Inside a
  tab or the sidebar: `editor/section` (title, description), `editor/box` (`box`: an ID),
  `core/columns`, `core/grid` and `core/paragraph` as a note. Tabs do not nest: the
  containers' `children.allowed` (`EDITOR_LAYOUT_INSIDE`) refuse them.
  `editorLayoutProblems(layout, { partial?, types? })` checks a layout; `editorLayoutTypes
  (boxes?, keep?)` gives the types, with the Box block's `box` as a choice among the boxes
  (and the IDs a stored layout names that are gone, marked "not available") so an editor
  offers a list.
- **The default is code, and the editor always renders from a layout.**
  `defaultEditorLayout(boxes)` is one Edit tab with the main boxes and the sidebar's boxes.
  `resolveEditorLayout(stored, boxes, additions, { editLabel?, keep? })` is what the editor
  renders: the stored layout or the default, the plugins' additions merged, every box the
  layout does not name appended (main boxes to the first tab, sidebar boxes to the
  sidebar) and boxes that are not available left out (`missing` names them; `keep` keeps
  them for the manager). The forms module declares its Settings tab as a layout instead of
  a special case in the editor.
- **Placement moved to the collection.** `FieldGroup.placement` is the default the groups
  page calls "Default placement" and `defaultEditorLayout` reads; a saved layout wins.
  Terms, users and menu items keep one column and no tabs.
- **Plugins declare; they do not filter.** Two manifest keys: `fieldGroups`, groups the
  plugin ships with IDs starting with `<plugin>-`, stored with the other groups when the
  plugin is granted (`#seedFieldGroups`), tagged `plugin`, read-only in the dashboard and
  not detachable from the manager, kept with their values while the plugin is inactive; and
  `editor: [{ collection, tabs?, sidebar? }]`, partial layouts the host merges while the
  plugin is active (`cms.editorLayoutAdditions(name)`), tab IDs prefixed with the plugin's
  name, a stored layout keeping a tab or box it already placed. No `cms.dashboard.editor-
  layout` filter: a layout is structure, lints with the manifest and costs nothing per
  request. Plugin components inside boxes are a later step; a plugin's box is a field group.
- **Errors find their tab.** The editor badges each tab with the count of errors on its own
  boxes (`boxFields(id, groups)` names the fields a box edits; sidebar boxes show on every
  tab) and, after a refused save, opens the tab that holds the first error when the open
  tab has none. The open tab stays in the address (`?tab=`); hidden tabs stay in the DOM, so
  block editors keep their state and `#group-<id>-title` anchors keep working.
- **The manager** has three tabs: General (Features, Field groups, Content template,
  Settings and Delete aside), Search engines (structured data, robots, title templates; a
  note when entries are not on the site) and Editor (`EditorLayoutEditor`). The Editor tab
  shows the tabs and the sidebar as one tree whose last row is the sidebar, pinned like the
  Edit tab, so a meta box drags between a tab and the sidebar with the tree's own drag; the
  tree starts expanded, and a move that would put a meta box at the top level or a block
  above the Edit tab or below the sidebar is refused while dragging. Beside it: the panel
  (a tab's label, ID and icon), the Meta boxes card with where each sits, Reset to default.
  The layout is sent with the collection only once stored or changed, so saving the General
  tab of an untouched collection stores no layout.

## Out of scope now

Per-user collapse and hide (WordPress's Screen Options), conditions on tabs and sections,
layouts for the user, term and menu item screens (a store keyed by target when needed),
plugin components inside boxes with a two-way API to the editor's values.

## Done when

- Products get a Pricing tab holding the Details group; the product editor shows Product,
  Pricing and JSON; saving with an empty required price while on the Product tab opens
  Pricing on the error. (`generated-runtime-cms-fields.test.js`)
- The manager's Editor tab adds an Inventory tab in the browser, its ID `inventory` from
  its label, drags a meta box from a tab into the sidebar and on into Inventory, and the
  editor shows it, with `?tab=inventory` in the address and the Pricing tab's icon.
  (`generated-runtime-cms-fields.test.js`)
- A shop plugin's manifest ships a Shipping group and a Shipping tab on products; granting
  it stores the group, attached and read-only; disabling it drops the tab and keeps the
  group and its values. (`field-groups.test.ts`)
- Posts, pages and forms with no stored layout look as before, forms' Settings tab included.
  (`editor-layout-unit.test.ts`)

## Outcome

Implemented 2026-10-30. Two findings on the way: a helper reached only through a class-field
arrow function is stripped from the client bundle (the summary callback is a method called
from `tree()` now), and `BlockTree`'s first Expand click on a loaded container did nothing
(`!undefined`); both fixed. The Box panel offers only boxes not placed yet.

Follow-up 2026-10-31, from trying it: meta boxes could not move between the Tabs and Sidebar
trees, a tab's ID was its random block ID (so `?tab=3f9a…`), its icon field took any name
while the dashboard draws only its own set, and nothing drew the icon. Now the two trees are
one, a tab has an ID field and an icon picker, the entry editor's tabs show their icons, and
Search engines left General for a tab of its own. `BlockTree` gained `expanded`, top-level
`allowed` and pinned places enforced while dragging, containers that open under a dragged
block, and window listeners for a drag: lists render by position, so the handle that started
a drag may leave the page when its block changes container. Every tab panel's DOM ID is
`entry-<tab>` (the first was `entry-fields`).

| Area | Delivered | Verified by |
| --- | --- | --- |
| Model (`packages/cms`) | `editor-layout.ts`: `EDITOR_BOX`, `EDITOR_OWN_BOXES`, `fieldPlacement`, `editorBoxes`, `EDITOR_LAYOUT_BLOCKS` (`editor/tab`, `editor/section`, `editor/box`), `EDITOR_LAYOUT_CORE`, `EDITOR_LAYOUT_INSIDE`, `editorLayoutTypes`, `boxBlock`, `layoutBoxes`, `defaultEditorLayout`, `editorLayoutShapeProblem`, `editorLayoutProblems`, `resolveEditorLayout`, `boxFields`; `CollectionDefinition.editor` (checked by `collectionProblems`, kept by `extendCollection`); `FieldGroup.plugin`; forms' declared layout; manifest `fieldGroups` and `editor` | `editor-layout-unit.test.ts` |
| Host | `saveCollection` stores `editor`; plugin groups are never detached by the manager; `saveFieldGroup` and `deleteFieldGroup` refuse a plugin's group; `grantPlugin` seeds the manifest's groups and plans their targets; `editorLayoutAdditions(collection)` | `field-groups.test.ts` (live RomeDB) |
| Dashboard (`packages/cms/app`) | `editorView` resolves the layout; the entry editor renders tabs and the sidebar from it (`editor-layout-view.ts`), with tab error badges and `revealErrorTab`; the manager's General and Editor tabs with `editor-layout-editor.ts`; `BlockTree` `pinned` and `summary`; the groups page's "Default placement" and read-only plugin groups | `generated-runtime-cms-fields.test.js` (HTTP and Chromium) |
| Docs | `docs/cms/manifest.md` (`fieldGroups`, `editor`), README, `agent-docs.json` (`cms-collections`, `cms-field-groups`, `cms-plugins`) | `romedb-cms-guide-coverage.test.js` |
