# Field groups: meta boxes built from blocks, with repeaters

Part of the [CMS and app builder plan](cms-app-builder.md). Written 2026-10-22.

The collection builder defines typed fields, but it cannot group them, lay them out, reuse
them across collections, or attach them to terms, users and menu items. The `core/meta`
block (name: value lines) is what people reach for instead, and it is not a data model.

This spec adds **field groups**: a group of typed fields with a layout, built in the block
tree from *field blocks* and the core layout blocks, attached to one or more targets, and
shown in each target's editor as a box. A **repeater** field block holds rows of fields,
nested without limit. Values are stored flat by field name, so queries, indexes, search,
the API and themes see fields, never layout. Index flags on repeater children keep a
derived array beside the document, so filters on rows seek through RomeDB's array indexes.

## Decisions

### Model (client-safe, `packages/cms`)

- **A new field kind, `rows`.** `{ kind: 'rows', fields: { … }, min?, max? }` is a list of
  objects, each shaped by `fields`, at most `max` rows (default 200, limit 1000). A row
  carries `_id` (1-40 of `[A-Za-z0-9_-]`, distinct in its list), which the editor assigns,
  so reorders and revisions work on identity. Subfields are any kind but `blocks`,
  `richtext`, `vector` and `bigint`, including `rows` again: nesting is unlimited.
  Storage type `array<object>`; `validateValue` and `publicValue` walk rows recursively.
  `json` fields keep their flat `fields` groups; they are not repeaters.
- **Field blocks.** `BlockDeclaration` gains `field?: { kind: FieldType }`, as `input`
  marks a form input. Core field blocks, category `field` (label "Fields"), one per
  builder type: `field/text`, `field/textarea`, `field/markdown`, `field/number`,
  `field/integer`, `field/boolean`, `field/date`, `field/choice`, `field/media`,
  `field/gallery`, `field/reference`, `field/list`, `field/blocks`, `field/json` and
  `field/repeater`. Their data is the builder's draft: `label` (required), `name`
  (follows the label through `fieldName`, as inputs follow theirs), `description`,
  `required`, `unique`, `search`, `index`, `max`, `min`, `choices`, `defaultValue`,
  `target`, `blocks`, `width` (`full`, `half`, `third`, for the box's grid). A repeater
  is a container whose children are field blocks and layout blocks; it has `min`, `max`
  and `summary` (the child whose value titles a collapsed row). Field blocks go only in
  a field group's blocks: `validateBlocks(…, { fieldGroup: true })` allows them, and
  rejects everything but field blocks and the layout blocks below. The builder's
  `FIELD_TYPES` moves to `packages/cms` as `FIELD_BLOCK_TYPES`, so the scaffold and the
  package share one list.
- **Layout blocks in a group** are the core design blocks that have no content of their
  own: `core/group`, `core/columns` with `core/column`, `core/grid`, `core/heading`,
  `core/paragraph` (a note, Markdown) and `core/divider`, plus new `core/tabs` with
  `core/tab` (label, icon), usable in content too. In a field group they render as
  dashboard UI, not as the site renders them. Widgets, media, embeds and data blocks are
  not offered.
- **A field group** is data: `{ id, title, description, placement: 'main' | 'sidebar',
  order, targets, blocks }`. `targets` lists where it shows:
  `{ kind: 'collection', name }`, `{ kind: 'taxonomy', name }`, `{ kind: 'users' }` or
  `{ kind: 'menus' }` (menu items). `fieldGroupProblems(group, types, scope)` checks the
  tree with `validateBlocks` and the compiled fields with `fieldProblems`; names are
  distinct across the group, rows included, and across the groups of one target, and never
  a target's own field (`scope`).
- **Groups compile to declarations.** `fieldGroupDeclarations(blocks, types)` walks the
  tree and returns `{ [name]: FieldDeclaration }`: a field block becomes the declaration
  its type and data describe (`declarationOf` moves to the package); a repeater becomes
  `rows` with its children as `fields`; layout blocks contribute their descendants. The
  result is what the target's resource declares, so a collection with groups is
  `extendCollection(definition, { fields: groups… })` and nothing downstream learns about
  groups. The declaration keeps `layout: { group, block }` so the editor can find each
  field's block; it is stripped before RomeDB.
- **A collection's own fields are its first group.** `CollectionDefinition.layout?: Block[]`
  holds the builder's tree; `fields` is compiled from it on save, and a definition with
  `fields` and no `layout` (plugins, modules, old rows) gets a layout of one field block
  per field in `fieldOrder`. Built-in collections' module fields appear as locked field
  blocks. The builder's flat field list is replaced by the tree.
- **Conditions on fields** reuse `Block.when` with the form builder's rules. Scope: a
  field block's rules name fields of the group and of the target (the collection's own
  fields and core fields `status`, `parent`, taxonomies as lists of term IDs); inside a
  repeater row they also name the row's fields and the fields of the rows above it; never
  sibling rows. `fieldVisibility(blocks, types, values, scope)` returns the hidden field
  names and clears their values, as `formVisibility` does; the server applies it on write
  so a hidden required field is not required and a hidden value is not stored.
- **Indexed repeater children.** A child with `index` or `unique` in a repeater compiles
  to a derived field: for the path `team.links.kind` the entry document carries
  `team__links__kind: string[]`, the distinct values across all rows at any depth, with a
  `USING ARRAY` index. The declaration gets `derived: ['team', 'links', 'kind']` and the
  repository maintains it on every write, next to the search text it already derives.
  `unique` inside a repeater means unique within the entry. A child with `search` adds its
  strings to the search text. Numbers index as `Float64` keys. Filters:
  `where: { 'team.links.kind': { contains: 'site' } }` (or `containsAny`, 1-50 values)
  rewrites to `array::contains(team__links__kind, $v)`; ranges and sorting on row fields
  are not offered. When RomeDB indexes array paths natively
  ([the proposal](../../romedb/plan-array-path-indexes.md)), the derived fields go and
  the index points at the path.
- **Targets without documents** get a `meta` object: `cms_terms.meta`, `cms_users.meta`
  (host step 10, `TEXT NOT NULL DEFAULT '{}'`) and `MenuItem.meta`. The same declarations
  validate it (`validateMeta(groups, values)`), the same `fieldVisibility` applies, and
  `TermShape`, `CmsUser` and `MenuItemView` carry `meta`. Reference and media fields are
  checked as in collections. Terms and users are relational, so their meta is not
  indexed; a list of terms filtered by meta is a scan and is not offered in the API.
- **`core/meta` stays** for developers and themes, as the one place for ad-hoc values. The
  builder's "Custom fields" wording moves to field groups; the block's picker description
  says it is for themes and integrations.

### Host

- **`cms.fieldGroups`** (`CmsFieldGroups`): `list()`, `get(id)`, `save(group, { principal })`,
  `delete(id, …)`, `forTarget(target)`, in `cms_field_groups` (id, definition, order,
  updated_at, updated_by; host step 10). Permission `cms:collections`. Saving a group
  whose targets include collections re-resolves those resources and plans the schema, as
  `saveCollection` does: added fields and indexes are additive, a removed field keeps its
  values in old documents (schemaless), a changed kind is reported by the planner as now.
  Groups are loaded with collections and taxonomies in `ready()`; `resourceById` sees the
  merged fields.
- **Repository.** `#derived(draft)` computes the derived arrays beside `#searchText`;
  `#filters` accepts dotted names that resolve to a derived field; `#shapeOf` returns
  rows with `_id`s and never the derived fields. `fieldVisibility` runs in `#prepare`
  before validation, with the stored record as the base for patches.
- **Terms, users, menus.** `taxonomies.create/update`, `users.create/update` and
  `menus.create/update` accept `meta`, validate it against the target's groups and store
  it; reads return it. Items of a menu validate per item.
- **Webhooks, revisions, autosaves, previews, exports and search text** need nothing: they
  see fields and documents.

### Dashboard (scaffold)

- **Field groups** under Collections in the navigation: `/dashboard/collections/groups`
  lists groups (title, targets, fields); `/dashboard/collections/groups/<id>` edits one:
  title, description, placement, targets (checkboxes per collection and taxonomy, users,
  menus), and the tree. The tree is `BlockTree` with `fieldGroup: true`: the inserter
  offers "Fields" and "Layout" groups, every block opens in the panel, and the panel's
  General tab holds the field block's settings and its condition. A field block's header
  shows `label`, `name` as code and the type badge; a repeater shows its rows' field count.
  Field names follow labels until edited, as the form builder does.
- **The collection builder** edits `layout` with the same tree in place of its field list
  and keeps its other sections. A built-in collection's module fields are locked blocks.
- **The entry editor** renders groups as boxes: the collection's own layout in the main
  column where the fields were, and each attached group as a box in its placement. A
  renderer `cms/field-group-view.ts` walks the tree: `core/group` is a section,
  `core/columns` and `core/grid` are grids, `core/tabs` is the `Tabs` component,
  `core/heading` and `core/paragraph` are text, `core/divider` a rule, and a field block is
  `fieldRow` with the existing `control()`, so media, references and blocks fields work
  unchanged. Hidden fields (`fieldVisibility` on the current values) are not rendered.
- **Repeater rows** render as the block tree does: each row a collapsible section titled
  by its summary field, drag and arrow keys to reorder, Add row and Remove row (asks when
  the row has values), collapsed by default beyond the first level, "N rows" when
  collapsed. Rows nest without limit; a note in the builder suggests a reference to a
  collection when a repeater sits three levels down.
- **Terms, users and menu items** show their groups as boxes under their own fields: the
  term editor and the user screen's profile tab, and the menu editor's item panel as a
  "Fields" tab after Advanced.

### Site and API

- `GET /api/cms/content/<collection>` returns fields flat, rows with `_id`; `where` accepts
  dotted names of indexed repeater children. Term and user responses carry `meta`;
  `MenuItemView.meta` reaches themes. The public terms API returns `meta` for fields
  without read access rules.
- Themes read `entry.<field>` as now and `term.meta.<field>`.

### Out of scope now

Ranges and sorting on row fields, per-row references from other entries, importing ACF
JSON, field groups shipped by plugins (manifests can declare collections' `layout`; a
`fieldGroups` manifest key fits later), a Tabs block renderer for the site beyond a
plain stacked fallback.

## Order

1. Model: `rows` kind, `field` on declarations, `FIELD_BLOCK_TYPES` and the field blocks,
   `core/tabs`, `fieldGroupDeclarations`, `fieldGroupProblems`, `fieldVisibility`,
   `derivedPath`, `layoutOf(definition)`. Unit tests.
2. Host: `cms_field_groups`, `meta` columns, `cms.fieldGroups`, merged resources, the
   repository's derived arrays, filters and visibility, meta on terms, users and menus.
   RomeDB tests.
3. Dashboard: the field group screens, the builder's tree, the entry editor's boxes and
   repeater rows, meta boxes on terms, users and menu items.
4. API and theme access, the generated-app test, README and `agent-docs.json`.

## Done when

- The builder lays out a product's fields in two columns with a Pricing tab and a
  Specifications repeater (name, value, a nested Notes repeater), saves, and the product
  editor shows that layout, adds three rows and a nested note, saves and reloads them.
- A "SEO extras" group attached to posts, pages and the categories taxonomy shows in all
  three editors and the category's values come back from the terms API as `meta`.
- A field shown only when `status` is `published`, and a row field shown only when the
  row's `kind` is `link`, hide and clear as the values change, in the editor and on write.
- `where: { 'specs.name': { contains: 'Weight' } }` on products returns the entry and
  `EXPLAIN` shows the array index seek on the derived field.
- A user's profile shows a "Social" group; saving it stores `meta` and the user API
  returns it.
- Removing a field block from a group keeps old entries readable and drops its index.

## Outcome

Implemented 2026-10-22. Users' dashboard profile box is the one piece of the plan left: the
users screen is shared with non-CMS apps and reads through `src/auth.ts`, so its box waits
for that abstraction to grow a meta hook. The host, API and `CmsUser.meta` already carry it.

| Area | Delivered | Verified by |
| --- | --- | --- |
| Model (`packages/cms`) | `rows` kind (`ROW_ID`, `ROW_LIMITS`, `field.rows`, recursive `validateValue`, `withRowIds`, `rowUniqueProblem`, `rowsPlain`, `rowsSearchable`); `BlockDeclaration.field`, `FIELD_BLOCK_KINDS`, `FIELD_BLOCKS`, `FIELD_BLOCK_TYPES`, `core/tabs` and `core/tab`, `FIELD_GROUP_LAYOUT`, `validateBlocks(…, { fieldGroup: { scope } })`; `FieldGroup`, `fieldGroupProblems`, `fieldGroupDeclarations`, `fieldBlockOf`, `layoutOf`, `derivedFields`, `derivedName`, `derivedValues`, `DERIVED_NAME`, `fieldVisibility`, `clearHidden`, `hiddenKey`, `metaProblems`; `CollectionDefinition.layout`, `ResourceDeclaration.layout`; `MenuItem.meta`, `TermShape.meta`, `CmsUser.meta` | `field-groups-unit.test.ts`, `unit.test.ts`, `forms-unit.test.ts` |
| Host | `cms_field_groups` and `meta` columns (step 10); `CmsFieldGroups`; `cms.fieldGroupsFor`, `saveFieldGroup`, `deleteFieldGroup` with schema planning; groups merged into collection resources with derived lists and the layout; `saveCollection` compiles `layout`; repository: rows storage and IDs, derived lists on write, dotted filters, visibility on write, derived fields hidden from readers; meta checks on terms, users and menu items | `field-groups.test.ts`, `collections.test.ts`, `schema.test.ts` (live RomeDB) |
| Dashboard (scaffold) | `/dashboard/field-groups` and `/dashboard/field-groups/<id>`; `FieldGroupEditor` (tree in field group mode, panel with conditions); the builder's layout tree in place of its field list; `FieldGroupView` (sections, columns, grids, tabs, headings, notes, repeater rows) in the entry editor, the term editor and the menu item's Fields tab; media inside rows; navigation entry | `generated-runtime-cms-fields.test.js` (HTTP and Chromium) |
| API | Rows with `_id` flat on entries; `?filter[field]=` and `?filter[rows.field]=` on the content list; `meta` on terms, users and menu views | `generated-runtime-cms-fields.test.js`, `field-groups.test.ts` |
| Docs | `cms-field-groups` guide in `agent-docs.json`; README | `romedb-cms-guide-coverage.test.js` |
| RomeDB | Proposal for array path indexes in the sibling repo (`plan-array-path-indexes.md`) | — |
