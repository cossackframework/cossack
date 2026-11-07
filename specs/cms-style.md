# Style: block style settings and theme presets

Builds on `specs/cms-layout.md` (nested blocks, `layout`) and `specs/cms-themes.md` (manifests,
Customize). Blocks get a Style tab beside their settings; the values come from presets the
theme declares and the site adjusts under Customize. The model is Gutenberg's block supports
and `theme.json` presets, trimmed: slugs are stored, never raw CSS, so a theme can restyle
every page and a palette change recolors stored content without a resave. Elementor-style
per-element CSS (borders, shadows, motion, custom CSS) is left out on purpose: it makes pages
a theme cannot restyle and is an injection surface in a multi-user dashboard.

## Decisions

- **Two tabs per block: General and Style.** General is the type's fields. Style is a fixed
  set of common controls held outside the type's `data`, next to `layout`:
  `style: { background?, text?, padding?, margin?, fontSize?, align? }`. The block's HTML
  anchor and extra class names (`layout.anchor`, `layout.className`) sit under a collapsed
  Advanced group at the bottom of Style. No third tab. The entry editor, Widgets and the site
  editor show the same tabs.
- **Values are preset slugs.** Colors, font sizes and spacing are slugs of the theme's
  presets; `align` is `left`, `center` or `right`. Core validates the shape and drops the
  properties a block does not support; it does not check that a slug is in the palette, since
  palettes change and a missing slug just falls back to the inherited value.
- **A color may also be the block's own** (2026-11-06): `background` and `text` take a hex
  color (`CUSTOM_COLOR`: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), rendered as it is with the
  class `cms-bg-custom` or `cms-text-custom`. Hex is the whole of what is allowed: it cannot
  carry a `url()` or a variable, so the injection argument against raw CSS does not apply. The
  Style tab shows each color as a box with the current color's name; it opens a picker with the
  palette (swatches, with None) and a custom color (the browser's picker, or a hex code).
- **A block's ID can be chosen** (2026-11-06): Advanced gets *Block ID*, editing `_id` within
  `BLOCK_ID` and unique in the field (`blockIdProblem`, with the field's other IDs passed as
  `taken`). It applies when the field is left, not on each keystroke, since a new ID re-keys the
  block; the panel follows the new ID. Themes and the API reach the block by it:
  `{{ $.content#hero.title }}` in bindings, `GET /api/cms/content/<collection>/<entry>/blocks/hero`
  in the management API. Notes anchored on the old ID stay with it.
- **Supports are opt-out.** Every block gets color and spacing in its Style tab; text blocks
  also get typography; media blocks get spacing alone. Those defaults come from the block's
  category. A declaration narrows or widens them with
  `supports: { color?: boolean | ('background' | 'text')[]; spacing?: boolean | ('padding' | 'margin')[]; typography?: boolean | ('fontSize' | 'align')[] }`.
- **Presets come from the theme, and Customize adjusts them.** The manifest gains
  `theme.presets: { colors?, fontSizes?, spacing? }`, each a list of `{ slug, name, value }`
  (a CSS color or length; no `url()`, no `var()` of the site's choosing). A theme without
  presets gets the core font size and spacing scales and no palette. A child theme's presets
  layer over its parent's by slug. Customize gets a Colors section: a swatch per palette
  color to change its value, a reset, and custom colors the site adds. Overrides live in the
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
- **Skipped on purpose.** Borders, shadows, font families, line height, and per-breakpoint
  style overrides. Each would be another preset kind over the same storage, added when a
  theme needs it.
- **Backgrounds beyond a color** (2026-11-07), for containers (`core/group`, `core/columns`,
  `core/column`, `core/grid`; a type opts in with `supports: { background: true }`). The
  Style tab's Background gains an *Advanced background* group: a gradient (a new preset kind,
  `gradients`, `--cms-gradient-<slug>`, six core defaults, adjustable and extendable under
  Customize like colors), an image from the library (`style.image`, a media ID; `imageSize`
  cover, contain or auto; `imageRepeat`; `imageFixed` for the fixed, parallax-like
  attachment), an overlay (`overlay`, a palette slug or hex, with `overlayOpacity` 0–100,
  drawn by a `::before` layer so it sits over a video too) and a video from the library
  (`style.video`, a muted looping `<video>` the renderer places behind the content, the image
  as its poster). The renderer builds `url()` from the media ID and the largest resized
  variant, positioned at the image's focal point, so no CSS is stored and the no-`url()` rule
  holds. Videos and fixed backgrounds cost bandwidth and are weak on phones (iOS ignores
  `background-attachment: fixed`); the controls say so and the site owner decides. Users who
  ask for reduced motion get the poster instead of the video. Media IDs in `style` count as
  block media (`blockMedia`), so existence checks, usage and exports see them. A separate
  Cover block was rejected: a group with a background, a height and a vertical alignment is
  one.

## Order

1. Model: `style`, `layout.anchor` and `layout.className` in the block shape, `supports` on
   declarations with category defaults, validation that drops unsupported properties, rich
   text block nodes carrying `style`.
2. Presets: the manifest field and its checks, core defaults, layering, the override setting
   and its checks, the Customize Colors and Additional CSS sections.
3. Rendering: the wrapper, custom properties on the root, the column placement change, the
   custom CSS in the head.
4. Editors: the shared style controls, tabs in the block tree, the Widgets dialog and the site
   editor popover.

## Done when

- A paragraph with `style.background: brand` renders in `div.cms-block.cms-bg-brand` with
  `background: var(--cms-color-brand)`, and the root carries `--cms-color-brand` with the
  theme's value.
- Changing the brand color under Customize recolors it without resaving the entry.
- A block type with `supports: { color: false }` shows no color controls, and a stored
  background on such a block is dropped on save.
- The site editor's popover edits Style and the page follows on Apply.
- Additional CSS with `@import` is rejected; valid CSS reaches the page.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| CMS package | `Block.style` (`BlockStyle`, `STYLE_PROPERTIES`, `TEXT_ALIGNMENTS`), `layout.anchor` and `layout.className` (`blockLayoutProblem`, `blockStyleProblem`); `BlockDeclaration.supports` with category defaults (`blockSupports`); `validateBlocks` keeps supported style properties and the layout extras; rich text `cmsBlock` nodes carry `style`; `ThemeManifest.presets` (`ThemePresets`, `Preset`, `presetProblems`, `DEFAULT_PRESETS`, `layerPresets`, `resolvePresets`, `presetOverridesProblem`); `blockStyleAttributes`, `presetStyle`, `customCssProblem`; `appearance.presets` and `appearance.customCss` settings; `ThemeInfo.presets` | `essentials-unit.test.ts` (shape, supports, validation, presets, attributes, CSS check); `themes.test.ts` (an area saves a styled block, drops an unsupported property, a child theme layers presets) |
| Scaffold | `cms/style-controls.ts` (color swatches, spacing and size selects, alignment, Advanced); `BlockTree` tabs; Widgets dialog and site editor popover tabs; `themeState.presets` and `customCss`; `siteContent` custom properties and `helpers.presets`; the wrapper in `site-view.ts`; `blocks.css` inherited stacking; Customize Colors and Additional CSS; Blocks screen lists supports; the default theme's palette | Recipe tests; `generated-runtime-cms-themes.test.js` |
| Generated app | A project with a styled column renders the wrapper, classes and custom properties; Customize overrides the palette; the site editor applies a background from the Style tab | `generated-runtime-cms-themes.test.js` |
| Backgrounds (2026-11-07) | `STYLE_PROPERTIES` gains the `background` kind (`gradient`, `image`, `imageSize`, `imageRepeat`, `imageFixed`, `overlay`, `overlayOpacity`, `video`), `BlockSupports.background`, `styleValueProblem`, `MEDIA_ID`, `BACKGROUND_SIZES`; `gradients` presets (`GRADIENT_VALUE`, defaults, layering, `PresetOverrides.gradients` and `customGradients`); `MediaView.focus`; `blockStyleAttributes` with media (layers, position, attachment, the overlay variable, the video); `blockMedia` and the app's media collection read `style`; the renderer's `<video class="cms-bg-video">`; `blocks.css` overlay and video layers; the Style tab's Advanced background with media choosing in the entry editor, Widgets and Live Edit; Customize Gradients | `essentials-unit.test.ts`; `layout.test.ts`; `generated-runtime-cms-themes.test.js` (a gradient band and an image background with an overlay) |
