# @cossackframework/ui

UI component library for the Cossack Framework — token-driven, themeable
components built on native HTML elements and the browser's top-layer API.
Styles are written as Tailwind v4 utility classes that reference CSS-token-driven
variables, so the whole library retints by overriding a handful of `@theme` values.

## Install

In a Cossack project:

```sh
cossack add ui                 # wire the package + CSS imports + @source
cossack add ui --theme=blue    # same, but pre-tint to the blue palette
cossack add ui button          # (optional) eject a customizable copy of Button
```

The `--theme` flag selects a color palette (see [Theming](#theming)) and wires
the matching `themes/<name>.css` import into `src/style.css`. Available themes:
`neutral` (default), `zinc`, `stone`, `gray`, `slate`, `blue`, `green`, `red`.

Or install the package directly and wire the CSS by hand:

```sh
pnpm add @cossackframework/ui
```

Then add to `src/style.css` (after `@import "tailwindcss";`):

```css
@import "@cossackframework/ui/theme/base.css";
@import "@cossackframework/ui/theme/theme.css";
/* Optional: import a named palette AFTER theme.css to retint. */
@import "@cossackframework/ui/theme/themes/blue.css";

/* Tailwind v4 excludes node_modules by default. This @source line tells it to
   scan the package's published bundle (dist), which contains every utility
   class referenced inside the components (bg-card, bg-popover, bg-accent, ...).
   Without it, only classes that also appear in your own source will be
   emitted and most variants will render unstyled. Note the `files` field ships
   only `dist` and `src/theme`, so scan `dist` (not src/components). */
@source "../node_modules/@cossackframework/ui/dist";
```

`cossack add ui` wires all of the above automatically.

## Components

### Buttons & Actions
| Component | Description |
|---|---|
| **Button** | Variant button (default, secondary, destructive, outline, ghost, link) with sizes (default, sm, lg, icon) |
| **Spinner** | CSS-animated loading spinner using `animate-spin` |

### Forms & Inputs
| Component | Native element | Description |
|---|---|---|
| **Input** | `<input>` | Token-driven text input with variant/size |
| **Textarea** | `<textarea>` | Multiline text input |
| **Select** | `<select>` | Native select with chevron overlay |
| **NativeSelect** | `<select>` | Styled native select (no JS, no popover — mobile-friendly) |
| **InputGroup** | `<input>` + addons | Input with prefix/suffix adornments (@, $, icons) |
| **Checkbox** | `<input type="checkbox">` | Checkbox with label wrapper |
| **Switch** | `<input type="checkbox">` | Toggle switch (role="switch") |
| **RadioGroup** | `<input type="radio">` | Radio button group |
| **Slider** | `<input type="range">` | Range slider with token accent-color |
| **InputOTP** | `<input>` ×N | Segmented one-time-password input (paste, auto-advance, arrows) |
| **Calendar** | `<div>` grid | Month-grid date picker with min/max bounds and ISO onChange |
| **DatePicker** | `popover` + calendar | Calendar in a native popover; emits ISO date on pick |
| **Label** | `<label>` | Accessible form label |

### Layout & Display
| Component | Native element | Description |
|---|---|---|
| **Card** | `<div>` | Surface container with optional header/body/footer slots |
| **Separator** | `<hr>` / `<div>` | Horizontal or vertical divider |
| **Table** | `<table>` | Token-styled table with sub-components (TableHeader, TableBody, TableRow, TableHead, TableCell) |
| **Avatar** | `<img>` / `<span>` | Image with initials fallback, circle/square |
| **AvatarGroup** | `<div>` | Stacked avatar set with "+N" overflow counter |
| **Badge** | `<span>` | Status/label pill with semantic variants |
| **Skeleton** | `<div>` | Loading placeholder with `animate-pulse` |
| **Progress** | `<div role="progressbar">` | Progress bar with aria values |
| **Tooltip** | CSS `:hover` | Pure-CSS hover tooltip (no JS, no portal) |
| **Typography** | semantic tags | Typographic primitives (h1–h4, p, lead, blockquote, code, ul, ol) |
| **ContextMenu** | `popover` attribute | Right-click menu with separators and destructive items |
| **Sidebar** | `<aside>` | Collapsible nav rail (icon / offcanvas) with nested groups + agnostic footer slot |
| **Drawer** | `<dialog>` | Slide-in drawer panel with drag handle grip and backdrop |
| **Item** | `<div>` | Generic list-row primitive with media/content/trailing slots |

### Chat
| Component | Native element | Description |
|---|---|---|
| **Bubble** | `<div>` | Chat message bubble (sent/received variants, tail, timestamp) |
| **Message** | `<div>` | Chat message wrapper (avatar + name + bubble grouping) |
| **MessageScroller** | `<div>` | Auto-stick-to-bottom scroll container with "new messages" affordance |
| **Marker** | `<div>` | Date/section divider inside a message list ("Today", "New messages") |
| **Attachment** | `<div>` | Chat file-attachment card with auto-detected type icon + status |

### Overlay & Interactive
| Component | Native element | Description |
|---|---|---|
| **Modal** | `<dialog>` | Controlled modal via `dialog.showModal()` + `@Task` |
| **Popover** | `popover` attribute | Top-layer popover with JS positioning + light dismiss |
| **DropdownMenu** | `popover` attribute | Menu with keyboard navigation (Arrow/Escape), collision-aware side/align flip, scroll/resize repositioning |
| **Sheet** | `<dialog>` | Slide-in panel (drawer) from any edge |
| **Accordion** | `<details>` | Zero-JS collapsible sections |
| **Tabs** | conditional render | Accessible tabbed interface with ARIA tablist |
| **Toaster** + `toast` | reactive store | Global toast notification system |

### Icons
| Component | Description |
|---|---|
| **Icon** | Renders a Solar icon from a direct `entry` (tree-shakeable). Pass an icon entry imported from `@cossackframework/solar-icons/<name>`. 6 styles: line, bold, duotone, broken, outline, line-duotone. |

> **Only `Icon` is provided.** There is no name-based lookup component —
> importing icons by name pulls the full ~1,200-icon registry (~9 MB of SVG
> paths) into the bundle. Always import the specific icon you need and pass its
> entry to `<Icon>`.

## Usage

Components are Cossack components — consume them with the `component()` helper,
not JSX:

```ts
import { html, component } from "@cossackframework/renderer";
import { Button, Input, Icon, toast } from "@cossackframework/ui";
import { ArrowRightIcon } from "@cossackframework/solar-icons/arrow-right";

html`
  ${component(Button, { variant: "default", "@click": this.save }, "Save")}
  ${component(Input, { type: "email", placeholder: "you@ex.com" })}
  ${component(Icon, { entry: ArrowRightIcon, style: "duotone", size: 20 })}
`;
```

## Theming

The theme is a two-layer shadcn-style system in `src/theme/theme.css`:

1. **Raw values** — `:root { … }` (light) and `.dark { … }` (dark) define OKLCH
   color values for every semantic token (`--primary`, `--background`, `--card`,
   `--popover`, `--accent`, `--border`, `--ring`, `--chart-*`, `--sidebar-*`, …).
   The default palette is shadcn's **neutral** (black primary on light, near-white
   on dark).
2. **Tailwind mapping** — `@theme inline { … }` maps each raw variable into a
   Tailwind utility (`--color-primary: var(--primary)` → `bg-primary`,
   `text-primary`, `border-primary`, `ring-primary`, …) plus a radius scale
   derived from a single `--radius` knob.

### Dark mode

Dark mode is **opt-in**: add `class="dark"` to `<html>` (or any ancestor of the
UI). The `.dark` token overrides live in `theme.css`, so no extra import is
needed.

### Retinting

Override any single token in your own `:root` / `.dark` blocks:

```css
@import "@cossackframework/ui/theme/theme.css";

:root {
  --primary: oklch(0.488 0.243 264.376);   /* retint to blue */
  --ring: oklch(0.488 0.243 264.376);
}
```

Or import a named palette AFTER `theme.css`. Neutral families retint the whole
surface scale; accent palettes retint only `--primary` / `--ring` / `--chart-*`
/ `--sidebar-primary-*`, keeping neutral surfaces:

```css
@import "@cossackframework/ui/theme/theme.css";
@import "@cossackframework/ui/theme/themes/zinc.css";   /* neutral family */
/* or: stone, gray, slate, neutral */
/* accent palettes: blue, green, red */
```

When scaffolding with the CLI, pass `--theme` to do this automatically:

```sh
cossack add ui --theme=zinc     # wires themes/zinc.css into src/style.css
```

| Palette | Type | Description |
|---|---|---|
| `neutral` | neutral | Pure achromatic (the default) |
| `zinc` | neutral | Cool gray with a subtle blue tint |
| `stone` | neutral | Warm gray with a subtle brown/amber tint |
| `gray` | neutral | Balanced, barely-tinted gray |
| `slate` | neutral | Cool blue-gray |
| `blue` | accent | Blue primary (the pre-shadcn default) |
| `green` | accent | Green primary |
| `red` | accent | Red primary |

### Radius

All corner radii derive from a single `--radius` token (default `0.625rem`):
`--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`. Override `--radius`
to rescale every `rounded-*` utility at once.

### Cossack extensions

The token set extends shadcn's with `success` / `success-foreground` and
`warning` / `warning-foreground` semantic colors, used by `Badge`, `Alert`,
`Toast`, etc.

## Icons

Icons are split across two packages:

- **`@cossackframework/solar-icons`** — the icon **dataset**. A zero-dependency,
  framework-agnostic package shipping 1,246 Solar icons across six styles as
  tree-shakeable data entries. Install it to get the icon data:

  ```sh
  pnpm add @cossackframework/solar-icons
  ```

- **`@cossackframework/ui`** — provides the **`Icon`** component that renders
  the data. It lives in `ui` (not in the data package) so it shares your app's
  single renderer/core module instance.

### Usage — fixed icon (tree-shakeable)

Import the icon entry directly from the data package and pass it to `Icon`:

```ts
import { Icon } from "@cossackframework/ui";
import { component } from "@cossackframework/renderer";
import { ArrowRightIcon } from "@cossackframework/solar-icons/arrow-right";

html`${component(Icon, { entry: ArrowRightIcon, style: "duotone", size: 20 })}`;
```

For maximum tree-shaking, import a single style instead of the full entry:

```ts
import { ArrowRightIcon } from "@cossackframework/solar-icons/arrow-right/bold";
// ArrowRightIcon is now a string (the bold SVG markup only), wrapped by Icon.
```

Each icon export is suffixed with `Icon` (e.g. `ArrowRightIcon`, `SettingsIcon`)
to avoid collisions with common identifiers. Icon names are kebab-case in the
import path (`arrow-right`, `eye-closed`, `alt-arrow-down`).

> **No name-based lookup.** If the icon is determined by runtime data, map it
> to a direct entry yourself (a small `Record<string, IconEntry>` of the icons
> you ship). Importing the full registry to resolve names by string pulls all
> 1,246 icons (~9 MB) into the bundle.

### Styles

Solar ships six styles. The `style` prop selects one; missing styles fall back
to `line`:

| key           | Solar source folder |
|---------------|---------------------|
| `line`        | Linear              |
| `bold`        | Bold                |
| `duotone`     | BoldDuotone         |
| `broken`      | Broken              |
| `outline`     | Outline             |
| `line-duotone`| LineDuotone         |

## Ejecting components

`cossack add ui <component>` copies a single component into your project at
`src/components/ui/<Component>.ts` so you can customize it. The ejected copy is
yours — re-run with `--force` to overwrite.

Available component names (kebab-case, passed to `cossack add ui <name>`):

`button`, `input`, `textarea`, `select`, `native-select`, `input-group`,
`label`, `checkbox`, `switch`, `radio-group`, `slider`, `input-otp`,
`password-input`, `field`, `toggle`, `toggle-group`, `badge`, `kbd`, `card`,
`separator`, `table`, `avatar`, `avatar-group`, `skeleton`, `progress`,
`spinner`, `aspect-ratio`, `typography`, `empty`, `item`, `marker`, `modal`,
`alert-dialog`, `popover`, `dropdown-menu`, `context-menu`, `sheet`, `drawer`,
`tooltip`, `hover-card`, `accordion`, `collapsible`, `tabs`, `navigation-menu`,
`menubar`, `command`, `combobox`, `multi-select`, `calendar`, `date-picker`,
`carousel`, `resizable`, `scroll-area`, `sidebar`, `breadcrumb`, `pagination`,
`button-group`, `toaster`, `bubble`, `message`, `message-scroller`,
`attachment`.
