# @cossackframework/ui

UI component library for the Cossack Framework. It provides token-driven,
themeable components built on native HTML elements and the browser's top-layer
API. Styles are Tailwind v4 utility classes that reference CSS token variables.
Override a few `@theme` values to retint the whole library.

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
| Button | Variant button (default, secondary, destructive, outline, ghost, link) with sizes (default, sm, lg, icon) |
| Spinner | CSS-animated loading spinner using `animate-spin` |

### Forms & Inputs
| Component | Native element | Description |
|---|---|---|
| Input | `<input>` | Token-driven text input with variant/size |
| Textarea | `<textarea>` | Multiline text input |
| NativeSelect | `<select>` | Styled native select with chevron overlay (no JS, no popover, mobile-friendly) |
| InputGroup | `<input>` + addons | Input with prefix/suffix adornments (@, $, icons) |
| Checkbox | `<input type="checkbox">` | Checkbox with label wrapper |
| Switch | `<input type="checkbox">` | Toggle switch (role="switch") |
| RadioGroup | `<input type="radio">` | Radio button group |
| Slider | `<input type="range">` | Range slider with token accent-color |
| InputOTP | `<input>` ×N | Segmented one-time-password input (paste, auto-advance, arrows) |
| Calendar | `<div>` grid | Month-grid date picker with min/max bounds and ISO `onValueChange` |
| DatePicker | `popover` + calendar | Calendar in a native popover. It emits an ISO date on pick |
| Label | `<label>` | Accessible form label |

### Layout & Display
| Component | Native element | Description |
|---|---|---|
| Card | `<div>` | Surface container with optional header/body/footer slots |
| Separator | `<hr>` / `<div>` | Horizontal or vertical divider |
| DataTable | `<table>` | Controlled server paging, filtering, sorting and stable row-ID selection |
| Table | `<table>` | Token-styled table with sub-components (TableHeader, TableBody, TableRow, TableHead, TableCell) |
| Avatar | `<img>` / `<span>` | Image with initials fallback, circle/square |
| AvatarGroup | `<div>` | Stacked avatar set with "+N" overflow counter |
| Badge | `<span>` | Status/label pill with semantic variants |
| Skeleton | `<div>` | Loading placeholder with `animate-pulse` |
| Progress | `<div role="progressbar">` | Progress bar with aria values |
| Tooltip | CSS `:hover` | Pure-CSS hover tooltip (no JS, no portal) |
| Typography | semantic tags | Typographic primitives (h1–h4, p, lead, blockquote, code, ul, ol) |
| ContextMenu | `popover` attribute | Right-click menu with separators and destructive items |
| Sidebar | `<aside>` | Collapsible nav rail (icon / offcanvas) with nested groups + agnostic footer slot |
| Drawer | `<dialog>` | Slide-in drawer panel with drag handle grip and backdrop |
| Item | `<div>` | Generic list-row primitive with media/content/trailing slots |

### Chat
| Component | Native element | Description |
|---|---|---|
| Bubble | `<div>` | Chat message bubble (sent/received variants, tail, timestamp) |
| Message | `<div>` | Chat message wrapper (avatar + name + bubble grouping) |
| MessageScroller | `<div>` | Named keyboard-scrollable viewport with history anchoring and a latest-message action |
| Marker | `<div>` | Date/section divider inside a message list ("Today", "New messages") |
| Attachment | `<div>` | Chat file-attachment card with auto-detected type icon + status |

### Overlay & Interactive
| Component | Native element | Description |
|---|---|---|
| Modal | `<dialog>` | Controlled modal via `dialog.showModal()` + `@Task` |
| Popover | `popover` attribute | Top-layer popover with JS positioning + light dismiss |
| DropdownMenu | `popover` attribute | Menu with keyboard navigation (Arrow/Escape), collision-aware side/align flip, scroll/resize repositioning |
| Sheet | `<dialog>` | Slide-in panel (drawer) from any edge |
| Accordion | `<button>` + `<div>` | One animated collapsible section. Stack several for a group |
| Tabs | conditional render | Accessible tabbed interface with ARIA tablist |
| Toaster + `toast` | reactive store | Global toast notification system |

### Icons
| Component | Description |
|---|---|
| Icon | Renders a Solar icon from a direct `entry` (tree-shakeable). Pass an icon entry imported from `@cossackframework/solar-icons/<name>`. 6 styles: line, bold, duotone, broken, outline, line-duotone. |

> The package provides only `Icon`. There is no name-based lookup component.
> Importing icons by name pulls the full ~1,200-icon registry (~9 MB of SVG
> paths) into the bundle. Always import the specific icon you need and pass its
> entry to `<Icon>`.

## Usage

Components are Cossack components. Consume them with the `component()` helper,
not JSX:

```ts
import { html, component } from "@cossackframework/renderer";
import { Button, Input, Icon, toast } from "@cossackframework/ui";
import { ArrowRightIcon } from "@cossackframework/solar-icons/arrow-right";

html`
  ${component(Button, { variant: "default", "@click": this.save }, "Save")}
  ${component(Input, { type: "email", placeholder: "you@ex.com" })}
  ${component(Icon, { entry: ArrowRightIcon, variant: "duotone", size: 20 })}
`;
```

## State props and callback names

All components use one naming rule, taken from shadcn/ui and Radix:

- State that the user can change, called `x` here, has up to three props:
  `x` for parent-controlled state, `defaultX` for an uncontrolled initial
  value, and `onXChange(next, ...)` to propose the next value. For example:
  `value`, `defaultValue` and `onValueChange`.
- The callback name repeats the state name. A component that only reports its
  state, such as Carousel, uses the same form.
- Callbacks for events that are not state use `on` and a verb: `onSelect`,
  `onAction`, `onSubmit`, `onComplete`, `onNavigate` and `onRetry`.
- No component prop is named `onChange`. Native controls (Input, Textarea,
  NativeSelect, Checkbox, Switch and Slider) report edits through native
  `@input` and `@change` listeners.
- Hover timing uses `openDelay` and `closeDelay`, in milliseconds.

| State | Callback | Components |
|---|---|---|
| `value` | `onValueChange` | Tabs, ToggleGroup, RadioGroup, Combobox, MultiSelect, Calendar, DatePicker, InputOTP, PasswordInput, Carousel |
| `open` | `onOpenChange` | Accordion, Collapsible, Modal, Sheet, Drawer, AlertDialog, Command, CommandPalette |
| `pressed` | `onPressedChange` | Toggle |
| `collapsed` | `onCollapsedChange` | Sidebar |
| `size` | `onSizeChange` | Resizable |
| `page` | `onPageChange` | Pagination |
| `state`, `selection` | `onStateChange`, `onSelectionChange` | DataTable |
| `mode` | `onModeChange` | AuthForm |
| `values` | `onValuesChange` | SettingsPanel |
| `token` (reported only) | `onTokenChange` | Turnstile |
| hover timing | `openDelay`, `closeDelay` | Tooltip, HoverCard, NavigationMenu |

A controlled component calls `onXChange` and keeps showing `x` until the
parent renders a new value. To accept the change, set `x` to the proposed
value. To reject it, render the old value again. The component then shows the
old value, and the same edit proposes the change again later. An edit made
before the parent renders builds on the last proposal, so a quick double click
on a Toggle proposes `true` and then `false`.

Modal, Sheet, Drawer and AlertDialog call `onOpenChange(false, event)` after a
user or browser dismissal. The `event` is the native `close` event. If `open`
stays `true`, the dialog opens again.

## Theming

The theme is a two-layer shadcn-style system in `src/theme/theme.css`:

1. Raw values: `:root { … }` (light) and `.dark { … }` (dark) define OKLCH
 color values for every semantic token (`--primary`, `--background`, `--card`,
 `--popover`, `--accent`, `--border`, `--ring`, `--chart-*`, `--sidebar-*`, …).
 The default palette is shadcn's neutral palette (black primary on light,
 near-white on dark).
2. Tailwind mapping: `@theme inline { … }` maps each raw variable into a
 Tailwind utility (`--color-primary: var(--primary)` → `bg-primary`,
 `text-primary`, `border-primary`, `ring-primary`, …) plus a radius scale
 derived from a single `--radius` knob.

### Dark mode

Dark mode is opt-in. Add `class="dark"` to `<html>` (or any ancestor of the
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

Or import a named palette after `theme.css`. Neutral families retint the whole
surface scale. Accent palettes retint only `--primary` / `--ring` / `--chart-*`
/ `--sidebar-primary-*` and keep neutral surfaces:

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
and `Toast`.

## Icons

Icons are split across two packages:

- `@cossackframework/solar-icons`: the icon dataset. It is a zero-dependency,
 framework-agnostic package. It ships 1,246 Solar icons across six styles as
 tree-shakeable data entries. Install it to get the icon data:

  ```sh
  pnpm add @cossackframework/solar-icons
  ```

- `@cossackframework/ui`: provides the `Icon` component that renders
 the data. It lives in `ui` (not in the data package), so it shares your app's
 single renderer/core module instance.

### Usage : fixed icon (tree-shakeable)

Import the icon entry directly from the data package and pass it to `Icon`:

```ts
import { Icon } from "@cossackframework/ui";
import { component } from "@cossackframework/renderer";
import { ArrowRightIcon } from "@cossackframework/solar-icons/arrow-right";

html`${component(Icon, { entry: ArrowRightIcon, variant: "duotone", size: 20 })}`;
```

For maximum tree-shaking, import a single style instead of the full entry:

```ts
import { ArrowRightIcon } from "@cossackframework/solar-icons/arrow-right/bold";
// ArrowRightIcon is now a string (the bold SVG markup only), wrapped by Icon.
```

Each icon export is suffixed with `Icon` (for example `ArrowRightIcon`,
`SettingsIcon`)
to avoid collisions with common identifiers. Icon names are kebab-case in the
import path (`arrow-right`, `eye-closed`, `alt-arrow-down`).

> Do not look up icons by name. If the icon is determined by runtime data, map it
> to a direct entry yourself (a small `Record<string, IconEntry>` of the icons
> you ship). Importing the full registry to resolve names by string pulls all
> 1,246 icons (~9 MB) into the bundle.

### Styles

Solar ships six styles. The `style` prop selects one style. Missing styles fall
back to `line`:

| key           | Solar source folder |
|---------------|---------------------|
| `line`        | Linear              |
| `bold`        | Bold                |
| `duotone`     | BoldDuotone         |
| `broken`      | Broken              |
| `outline`     | Outline             |
| `line-duotone`| LineDuotone         |

## Accordion and Collapsible

Both components accept `open` for parent-controlled state, or `defaultOpen`
for local state, and call `onOpenChange(open)` when the trigger is used.
`Accordion` uses a button summary. `Collapsible` accepts custom trigger content.

Open content has automatic height and visible overflow, including during SSR.
Async rows, validation messages, and absolutely positioned dropdowns can grow
or extend beyond the panel. Height is measured on each toggle and clipped only
while animating or closed. Closed panels are inert and hidden from assistive
technology. Reduced-motion preferences disable the height animation.

## Progress values

`Progress` clamps its value to `0..max` for both the visible bar and its ARIA
attributes. A non-finite value becomes `0`. A zero, negative, or non-finite
maximum falls back to `100`.

## Ejecting components

`cossack add ui <component>` copies a single component into your project at
`src/components/ui/<Component>.ts` so you can customize it. The ejected copy is
yours. Run the command again with `--force` to overwrite it. Shared private animation helpers
are included in ejected Accordion and Collapsible source. Toaster is ejected
from the package's Toast module.

Available component names (kebab-case, passed to `cossack add ui <name>`):

`button`, `input`, `textarea`, `native-select`, `input-group`,
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


## Controlled DataTable

Import `DataTable`, `DataTableProps<Row>` and `DataTableColumn<Row>` from
`@cossackframework/ui`. Compose with `component(DataTable<Row>, props)`.
Provide a unique `id` to preserve query-control focus across same-page URL navigation.
Provide a caption, typed columns, a stable `getRowId`, current-page rows,
`rowCount`, query `state` and `onStateChange`. Columns use either a row `key` or
an `accessor` function. A `cell` callback can render custom content from the row.

The parent fetches each requested state and rejects stale responses. The table
does not fetch or transform rows. Sort, filter and page-size changes reset page
to 1. Selection is controlled through `selection` and `onSelectionChange` and
preserves off-page IDs. Reconcile selection and out-of-range pages in the parent
when filters, permissions or the underlying records change.

Use `loading`, `error` and `onRetry` for request states. Native controls provide
keyboard behavior. Headers expose sort state. Row labels name checkboxes.
Paging uses focusable `aria-disabled` buttons that ignore inactive actions.
Retry returns focus to the filter before its callback. The table accepts only
its declared props, with no general HTML-attribute forwarding.

Run `pnpm exec cossack docs --package @cossackframework/ui --symbols --json` for
the installed prop contracts and package-owned DataTable guide. The guide also
explains selection policy, labels and status behavior.

## Typed native controls

Button, Input, Label, Checkbox, Switch and Form use typed native attributes and
`@event` listeners. Unknown props, string boolean values and React-style `onClick`
are rejected. Pass children as the third argument to `component()`. Listener
`currentTarget` is typed as the native control. `target` can be a descendant.
Capture the control before awaiting, because native events clear currentTarget after dispatch.
Use `disabled: !!loading` for loading counts and an explicit Button `type` in forms.
Input's visual `size` is `default`, `sm` or `lg`, not a numeric HTML size.

Use `Label` with matching `for`/`id`, or provide `aria-label`. Checkbox's `label`
prop takes precedence over children. Switch renders children inside its label.
Both accept controlled `checked` and emit native `@change` events. Update the
parent from `event.currentTarget.checked`. Their input type, role and checked
property are component-owned. Input supports `.value`, `.checked`, `bind()` and
`live()` for direct property binding. Choose names and values for native FormData.
Form's `submit` callback prevents navigation and defaults to `novalidate`.
Set `novalidate: false` to keep browser validation, or omit `submit` for native POST.

The installed `native-controls` guide documents attributes, event types and
labeling requirements.

## Radio groups and sliders

RadioGroup uses a distinct nonempty `name` per logical group and unique string item
values. Provide `aria-label` or `aria-labelledby` for the group. `onValueChange(value,
event)` receives an input event with `HTMLInputElement` currentTarget. A native
`@change` listener receives the bubbled event on the root div. Update parent `value`
from the callback. Items retain DOM identity by value when reordered. `disabled`,
`required` and `form` apply to the inputs. Other global attributes apply to the div.

Slider owns a finite numeric `value`, `min`, `max` and positive `step`. The browser
clamps and rounds values. Constraints apply before value, and widened bounds restore
a previously clamped requested value. Read `event.currentTarget.valueAsNumber` in
`@input` to update parent state. Supply `label`, an external Label, or ARIA naming.
Use Input with `type: 'range'` for direct native property-binding behavior.

Checkbox, Switch and RadioGroup wrappers follow the child's native disabled state.
Slider styles its own native disabled state. This includes disabled fieldsets.
The installed `radio-and-range` guide describes attributes, events and accessibility.

### AuthForm block

```ts
import { component } from '@cossackframework/renderer';
import { AuthForm } from '@cossackframework/ui/blocks';

component(AuthForm, {
  id: 'account-login',
  defaultMode: 'login',
  onSubmit: async (data, { signal }) => {
    // Call your authentication service. Validate credentials on the server.
    // Return safe { error, fieldErrors } text when needed.
  },
});
```

Use `mode` with `onModeChange` for controlled state. Native credentials remain in
fields. Submission reads current FormData, including autofill. Provider actions
require explicit `providers` and `onSocial`. Localize text with `labels`.
The block owns UI behavior, not authentication or session creation. Actions need
JavaScript. Fields remain editable before hydration. `cossack add ui auth-form`
ejects the block using public UI imports.

### CommandPalette block

```ts
import { component } from '@cossackframework/renderer';
import { CommandPalette } from '@cossackframework/ui/blocks';

component(CommandPalette, {
  id: 'app-commands',
  label: 'Application commands',
  shortcut: true,
  commands: [{ id: 'home', label: 'Go home', group: 'Navigation' }],
  onSelect: id => { /* Run the application action for this ID. */ },
});
```

Use `open` with `onOpenChange` for parent ownership, or `defaultOpen` for local
state. `setOpen()` and `toggle()` request changes. Native props target the dialog.
Command owns search, grouping, active options, focus and shortcut arbitration.
Global shortcuts are opt-in and ignore unrelated editable controls by default.
Item `shortcut` strings are hints, not registered bindings. `icon` accepts trusted
Solar artwork. `cossack add ui command-palette` ejects the composed block.
