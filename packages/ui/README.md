# @cossackframework/ui

UI component library for the Cossack Framework — token-driven, themeable
components and a Solar-based icon system. Styles are written as Tailwind v4
utility classes that reference CSS-token-driven variables, so the whole library
retints by overriding a handful of `@theme` values.

## Install

In a Cossack project:

```sh
cossack add ui                 # wire the package + CSS imports
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

## Usage

Components are Cossack components — consume them with the `component()` helper,
not JSX:

```ts
import { html } from "@cossackframework/renderer";
import { component } from "@cossackframework/renderer";
import { Button, Input, Icon } from "@cossackframework/ui";

html`
  ${component(Button, { variant: "primary", "@click": this.save }, "Save")}
  ${component(Input, { type: "email", placeholder: "you@ex.com" })}
  ${component(Icon, { name: "arrow-right", style: "duotone", size: 20 })}
`;
```

## Theming

Tokens live in `src/theme/theme.css` inside a Tailwind v4 `@theme { ... }`
block. Override any token in your own `@theme` block — both the CSS variable
and the generated utility (e.g. `bg-primary`) update together:

```css
@import "@cossackframework/ui/theme/theme.css";

@theme {
  --color-primary: oklch(0.5 0.18 30);   /* warm orange */
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

The script emits one module per icon in `src/icons/generated/` and regenerates
`src/icons/registry.ts`.
