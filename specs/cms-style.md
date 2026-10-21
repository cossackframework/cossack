# Style: block style settings and theme presets

Builds on `specs/cms-layout.md` (nested blocks, `layout`) and `specs/cms-themes.md` (manifests,
Customize). Blocks get a Style tab beside their settings; the values come from presets the
theme declares and the site adjusts under Customize. The model is Gutenberg's block supports
and `theme.json` presets, trimmed: slugs are stored, never raw CSS, so a theme can restyle
every page and a palette change recolours stored content without a resave. Elementor-style
per-element CSS (borders, shadows, motion, custom CSS) is left out on purpose: it makes pages
a theme cannot restyle and is an injection surface in a multi-user dashboard.

## Decisions

- **Two tabs per block: General and Style.** General is the type's fields. Style is a fixed
  set of common controls held outside the type's `data`, next to `layout`:
  `style: { background?, text?, padding?, margin?, fontSize?, align? }`. The block's HTML
  anchor and extra class names (`layout.anchor`, `layout.className`) sit under a collapsed
  Advanced group at the bottom of Style. No third tab. The entry editor, Widgets and the site
  editor show the same tabs.
- **Values are preset slugs.** Colours, font sizes and spacing are slugs of the theme's
  presets; `align` is `left`, `center` or `right`. Core validates the shape and drops the
  properties a block does not support; it does not check that a slug is in the palette, since
  palettes change and a missing slug just falls back to the inherited value.
- **Supports are opt-out.** Every block gets colour and spacing in its Style tab; text blocks
  also get typography; media blocks get spacing alone. Those defaults come from the block's
  category. A declaration narrows or widens them with
  `supports: { color?: boolean | ('background' | 'text')[]; spacing?: boolean | ('padding' | 'margin')[]; typography?: boolean | ('fontSize' | 'align')[] }`.
- **Presets come from the theme, and Customize adjusts them.** The manifest gains
  `theme.presets: { colors?, fontSizes?, spacing? }`, each a list of `{ slug, name, value }`
  (a CSS colour or length; no `url()`, no `var()` of the site's choosing). A theme without
  presets gets the core font size and spacing scales and no palette. A child theme's presets
  layer over its parent's by slug. Customize gets a Colours section: a swatch per palette
  colour to change its value, a reset, and custom colours the site adds. Overrides live in the
  `appearance.presets` setting, keyed by theme, so switching themes keeps each one's changes.
- **Rendering is one wrapper.** A styled block renders inside `div.cms-block` with classes per
  property (`cms-bg-brand`, `cms-text-light`, `cms-p-large`, `cms-m-none`, `cms-size-large`,
  `cms-align-center`) and inline custom properties (`background: var(--cms-color-brand)`),
  plus its `id` and class names. An unstyled block renders as before. The resolved presets
  render as custom properties (`--cms-color-<slug>`, `--cms-size-<slug>`,
  `--cms-space-<slug>`) on the content root, and `helpers.presets` lets a theme put them
  elsewhere. A column keeps its grid placement through the wrapper. Stacking and spans move to
  inherited custom properties, so the edit markers and the wrapper never break them.
- **Custom CSS is site-level.** Customize gets an Additional CSS box, stored as
  `appearance.customCss` (20 KB) and checked: no `@import`, `url()`, `expression()`,
  `behavior`, `-moz-binding` or `</style`. It renders in the site's head. There is no
  per-block CSS; `className` and the theme's stylesheet cover those cases.
- **Skipped on purpose.** Borders, shadows, gradients, font families, line height, and
  per-breakpoint style overrides. Each would be another preset kind over the same storage,
  added when a theme needs it.

## Order

1. Model: `style`, `layout.anchor` and `layout.className` in the block shape, `supports` on
   declarations with category defaults, validation that drops unsupported properties, rich
   text block nodes carrying `style`.
2. Presets: the manifest field and its checks, core defaults, layering, the override setting
   and its checks, the Customize Colours and Additional CSS sections.
3. Rendering: the wrapper, custom properties on the root, the column placement change, the
   custom CSS in the head.
4. Editors: the shared style controls, tabs in the block tree, the Widgets dialog and the site
   editor popover.

## Done when

- A paragraph with `style.background: brand` renders in `div.cms-block.cms-bg-brand` with
  `background: var(--cms-color-brand)`, and the root carries `--cms-color-brand` with the
  theme's value.
- Changing the brand colour under Customize recolours it without resaving the entry.
- A block type with `supports: { color: false }` shows no colour controls, and a stored
  background on such a block is dropped on save.
- The site editor's popover edits Style and the page follows on Apply.
- Additional CSS with `@import` is rejected; valid CSS reaches the page.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | `Block.style` (`BlockStyle`, `STYLE_PROPERTIES`, `TEXT_ALIGNMENTS`), `layout.anchor` and `layout.className` (`blockLayoutProblem`, `blockStyleProblem`); `BlockDeclaration.supports` with category defaults (`blockSupports`); `validateBlocks` keeps supported style properties and the layout extras; rich text `cmsBlock` nodes carry `style`; `ThemeManifest.presets` (`ThemePresets`, `Preset`, `presetProblems`, `DEFAULT_PRESETS`, `layerPresets`, `resolvePresets`, `presetOverridesProblem`); `blockStyleAttributes`, `presetStyle`, `customCssProblem`; `appearance.presets` and `appearance.customCss` settings; `ThemeInfo.presets` | `essentials-unit.test.ts` (shape, supports, validation, presets, attributes, CSS check); `themes.test.ts` (an area saves a styled block, drops an unsupported property, a child theme layers presets) |
| Scaffold | `cms/style-controls.ts` (colour swatches, spacing and size selects, alignment, Advanced); `BlockTree` tabs; Widgets dialog and site editor popover tabs; `themeState.presets` and `customCss`; `siteContent` custom properties and `helpers.presets`; the wrapper in `site-view.ts`; `blocks.css` inherited stacking; Customize Colours and Additional CSS; Blocks screen lists supports; the default theme's palette | Recipe tests; `generated-runtime-cms-themes.test.js` |
| Generated app | A project with a styled column renders the wrapper, classes and custom properties; Customize overrides the palette; the site editor applies a background from the Style tab | `generated-runtime-cms-themes.test.js` |
