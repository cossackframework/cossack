# Layout: nested blocks, containers and responsive display

Builds on `specs/cms-essentials.md` (blocks) and `specs/cms-themes.md` (templates, helpers,
front-end editing). Layouts are blocks: one tree is one storage format, one editor, one
revision diff and one pattern library. A layout layer beside the block list would be the
second representation the themes spec forbids.

## Decisions

- **Blocks nest.** `Block` gains an optional `children: Block[]`. A type that holds
  children declares `children: { allowed?: string[]; max?: number }`; a type without it
  rejects children. Limits stay global: 200 blocks per field counted across the tree,
  depth 4, ids distinct within the whole tree. Validation, media collection, the revision
  diff, patterns and the pattern renderer walk the tree. A rich-text body keeps embedding
  one block node, and that node may be a container, so bodies change nothing.
- **Three core containers.** `core/group` (a vertical stack: `align` of `left`, `center`,
  `right`, `wide`, `full`); `core/columns` holding only `core/column` (`gap`, `stack` at
  `mobile`, `tablet` or `never`), where a column has `span` 1–12 and `verticalAlign`;
  `core/grid` (`columns` for `base`, `md` and `lg`, plus `gap`). All three render as CSS
  grid, twelve tracks for columns. Row and Stack are a one-row grid and a group, so they
  are not added. No freeform canvas: absolute placement fights responsiveness and
  semantics, and its output cannot be re-split by a theme.
- **Responsive through container queries.** The site's content root carries
  `container-type: inline-size` and the core block stylesheet uses `@container` ranges
  (`sm` below 640px, `md` below 1024px) instead of media queries. Columns inside a narrow
  column stack on their own, and the editor's device toggle narrows that root, so a phone
  preview in front-end edit mode needs no iframe.
- **Show/hide is a common block attribute.** Every block takes an optional `layout` object
  validated by core, outside its type's `data`: `{ hide?: ('sm' | 'md' | 'lg')[] }` to
  start, `anchor` and `className` later. A hidden block still renders, with `data-hide`,
  so the editor can show it dimmed; the stylesheet drops it in those ranges. There are no
  per-breakpoint overrides of arbitrary fields: responsive behaviour is what the containers
  do plus `hide`.
- **Rendering stays in the helpers.** `helpers.block` renders a container and recurses
  into its children, so edit markers wrap nested blocks and themes stay unaware of editing.
  The layout CSS ships in the scaffold as `cms/blocks.css` with plain class names
  (`cms-group`, `cms-columns`, `cms-column`, `cms-grid`) and custom properties for gaps,
  which a theme overrides in its stylesheet. A theme overrides a container's renderer as it
  overrides any block.
- **Editors edit the tree.** The dashboard block editor and the site editor show nested
  rows (the menu editor's row model has `depth`, so moves between containers reuse it),
  insert into a container, a span control on columns, a hide control on every block and a
  device toggle. Clicking a child on the site selects it; Escape selects its container.
  Patterns hold columns, so they become section templates.
- **Templates stay code.** User layout is blocks inside a template's slots; a theme's
  template is not editable on the site.

## Order

1. Nesting in the model: `children`, type declarations, `layout`, validation, media, diff,
   patterns.
2. Core containers, the stylesheet with container queries, the recursive renderer.
3. Dashboard block editor: tree, insert into, moves between containers, spans, hide.
4. Site editor: nested selection, device toggle, the same move code.
5. The grid block last; it needs the least and proves the model.

## Done when

- A page holds two columns with a heading and an image in each, inside a group, and renders
  them in a twelve-track grid that stacks below 640px of container width.
- A block hidden on `sm` is in the HTML with `data-hide` and invisible in a 400px container.
- The dashboard editor inserts a block into a column, moves it to the other column and
  changes a span.
- The site editor selects a nested block, moves it between columns, and the device toggle
  stacks the columns without a reload.
- A pattern with columns renders inside a page.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | `Block.children` and `Block.layout` (`BlockLayout`, `BREAKPOINTS`, `BLOCK_LIMITS`); `BlockDeclaration.children` and `parent`; `core/group`, `core/columns`, `core/column`, `core/grid`; `blocksShapeProblem` and `validateBlocks` over the tree (`blockAllowedIn`); `blockMedia` over the tree; rich text `cmsBlock` nodes with `layout` and `children`; `EmbeddedBlock` and `RenderedBlock` carry them; tree helpers `flattenBlocks`, `placeBlocks`, `findBlock`, `updateBlock`, `insertBlock`, `moveBlock`, `shiftBlock`, `blockTreeProblem`; enum `choices` labels | `essentials-unit.test.ts` (rules, shape, limits, helpers, rich text); `themes.test.ts` (an area saves columns with a hidden column and rejects a stray column) |
| Scaffold | `cms/blocks.css` (grid layouts, `@container` ranges, `data-hide`, the device toggle) imported by `style.css`; `siteContent` wraps every site page's content in the container root, the default theme's footer cells too; `helpers.block` recurses and marks hidden blocks; `coreBlock` renders the containers (`columnSpans`); `BlockTree` (`cms/block-tree.ts`) edits nested blocks in the entry editor and Widgets, with hide toggles and in/out moves; `EditorBlock`, `blocksInput`, `editorBlocks`, `newBlock` (columns start with two); the site editor's panel shows depths, drags sideways to change containers, moves with the arrow keys, selects a container with Escape, toggles hiding and switches the preview width | Recipe tests; `generated-runtime-cms-themes.test.js` |
| Generated app | A project with columns renders `cms-columns` with spans 4 and 8 and a `data-hide="sm"` column; in Chromium an editor adds a group, moves a paragraph into it with the right arrow, narrows the content root to a phone and saves; visitors see the group | `generated-runtime-cms-themes.test.js` |
