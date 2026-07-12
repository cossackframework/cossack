# @cossackframework/ui

UI component library for the Cossack Framework — token-driven, themeable
components built on native HTML elements and the browser's top-layer API.
Styles are written as Tailwind v4 utility classes that reference CSS-token-driven
variables, so the whole library retints by overriding a handful of `@theme` values.

## Install

In a Cossack project:

```sh
cossack add ui                 # wire the package + CSS imports + @source
cossack add ui button          # (optional) eject a customizable copy of Button
```

Or install the package directly and wire the CSS by hand:

```sh
pnpm add @cossackframework/ui
```

Then add to `src/style.css` (after `@import "tailwindcss";`):

```css
@import "@cossackframework/ui/theme/base.css";
@import "@cossackframework/ui/theme/theme.css";

/* Tailwind v4 excludes node_modules by default. These @source lines tell it to
   scan the package's component/icon source so every utility class referenced
   inside the components (bg-secondary, bg-destructive, bg-success, ...) is
   generated. Without them, only classes that also appear in your own source
   will be emitted and most variants will render unstyled. */
@source "../node_modules/@cossackframework/ui/src/components";
@source "../node_modules/@cossackframework/ui/src/icons";
```

`cossack add ui` wires all of the above automatically.

## Components

### Buttons & Actions
| Component | Description |
|---|---|
| **Button** | Variant button (primary, secondary, destructive, outline, ghost) with sizes |
| **Spinner** | CSS-animated loading spinner using `animate-spin` |

### Forms & Inputs
| Component | Native element | Description |
|---|---|---|
| **Input** | `<input>` | Token-driven text input with variant/size |
| **Textarea** | `<textarea>` | Multiline text input |
| **Select** | `<select>` | Native select with chevron overlay |
| **Checkbox** | `<input type="checkbox">` | Checkbox with label wrapper |
| **Switch** | `<input type="checkbox">` | Toggle switch (role="switch") |
| **RadioGroup** | `<input type="radio">` | Radio button group |
| **Slider** | `<input type="range">` | Range slider with token accent-color |
| **Label** | `<label>` | Accessible form label |

### Layout & Display
| Component | Native element | Description |
|---|---|---|
| **Card** | `<div>` | Surface container with optional header/body/footer slots |
| **Separator** | `<hr>` / `<div>` | Horizontal or vertical divider |
| **Table** | `<table>` | Token-styled table with sub-components (TableHeader, TableBody, TableRow, TableHead, TableCell) |
| **Avatar** | `<img>` / `<span>` | Image with initials fallback, circle/square |
| **Badge** | `<span>` | Status/label pill with semantic variants |
| **Skeleton** | `<div>` | Loading placeholder with `animate-pulse` |
| **Progress** | `<div role="progressbar">` | Progress bar with aria values |
| **Tooltip** | CSS `:hover` | Pure-CSS hover tooltip (no JS, no portal) |

### Overlay & Interactive
| Component | Native element | Description |
|---|---|---|
| **Modal** | `<dialog>` | Controlled modal via `dialog.showModal()` + `@Task` |
| **Popover** | `popover` attribute | Top-layer popover with JS positioning + light dismiss |
| **DropdownMenu** | `popover` attribute | Menu with keyboard navigation (Arrow/Escape) + focus management |
| **Sheet** | `<dialog>` | Slide-in panel (drawer) from any edge |
| **Accordion** | `<details>` | Zero-JS collapsible sections |
| **Tabs** | conditional render | Accessible tabbed interface with ARIA tablist |
| **Toaster** + `toast` | reactive store | Global toast notification system |

### Icons
| Component | Description |
|---|---|
| **Icon** | Solar icon set (4 styles: line, bold, duotone, broken) via `<Icon name="arrow-right" />` |

## Usage

Components are Cossack components — consume them with the `component()` helper,
not JSX:

```ts
import { html, component } from "@cossackframework/renderer";
import { Button, Input, Icon, toast } from "@cossackframework/ui";

html`
  ${component(Button, { variant: "primary", "@click": this.save }, "Save")}
  ${component(Input, { type: "email", placeholder: "you@ex.com" })}
  ${component(Icon, { name: "arrow-right", style: "duotone", size: 20 })}
`;
```

## Theming

Tokens live in `src/theme/theme.css` inside a Tailwind v4 `@theme { ... }`
block. The semantic tokens (primary, secondary, destructive, …) map to
Tailwind v4's default palette (`var(--color-blue-600)`, …) — they are NOT
custom colors. Override any token in your own `@theme` block:

```css
@import "@cossackframework/ui/theme/theme.css";

@theme {
  --color-primary: var(--color-violet-600);   /* retint to violet */
}
```

Named palettes ship under `theme/themes/`:

```css
@import "@cossackframework/ui/theme/themes/dark.css";
```

## Icons

Solar icons (https://solar-icons.vercel.app/) across four styles: `line`,
`bold`, `duotone`, `broken`.

The set is generated from SVG source under `vendor/solar-icons/`:

```
vendor/solar-icons/
  Line/<Name>.svg
  Bold/<Name>.svg
  Duotone/<Name>.svg
  Broken/<Name>.svg
```

Regenerate the full set:

```sh
pnpm run build:icons
# or point at a custom source:
SRC_DIR=/path/to/solar pnpm run build:icons
```

## Ejecting components

`cossack add ui <component>` copies a single component into your project at
`src/components/ui/<Component>.ts` so you can customize it. The ejected copy is
yours — re-run with `--force` to overwrite.

Available component names: `button`, `input`, `card`, `badge`, `label`,
`alert`, `modal`, `accordion`, `textarea`, `checkbox`, `switch`, `select`,
`spinner`, `avatar`, `separator`, `skeleton`, `progress`, `tabs`, `tooltip`,
`popover`, `radio-group`, `slider`, `table`, `toaster`, `dropdown-menu`,
`sheet`.
