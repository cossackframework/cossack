# UI Package (`@cossackframework/ui`)

A token-driven, themeable component library built on native HTML elements and the
browser's top-layer API. Styles are Tailwind v4 utility classes referencing
CSS-token-driven variables, so the whole library retints by overriding a handful
of `@theme` values. shadcn/ui-inspired.

## Install

In a Cossack project, use the CLI (wires the package + CSS imports + `@source`
lines automatically):

```sh
cossack add ui                 # wire the package + CSS imports + @source
cossack add ui --theme=blue    # same, but pre-tint to the blue palette
cossack add ui button          # (optional) eject a customizable copy of Button
```

Or install the package directly and wire the CSS by hand in `src/style.css`
(after `@import "tailwindcss";`):

```css
@import "@cossackframework/ui/theme/base.css";
@import "@cossackframework/ui/theme/theme.css";
@import "@cossackframework/ui/theme/themes/blue.css";   /* optional named palette */

/* Tailwind v4 excludes node_modules by default. These tell it to scan the
   package so every utility class referenced inside components is generated. */
@source "../node_modules/@cossackframework/ui/src/components";
@source "../node_modules/@cossackframework/ui/src/icons";
```

> Without the `@source` lines, only classes that also appear in your own source
> are emitted and most variants will render unstyled.

## Usage — consume with `component()`, not JSX

Components are Cossack components — consume them with the `component()` helper
from `@cossackframework/renderer`:

```ts
import { html, component } from "@cossackframework/renderer";
import { Button, Input, Icon, toast } from "@cossackframework/ui";

html`
  ${component(Button, { variant: "default", "@click": this.save }, "Save")}
  ${component(Input, { type: "email", placeholder: "you@ex.com" })}
  ${component(Icon, { name: "arrow-right", style: "duotone", size: 20 })}
`;
```

- **Button** — variants: `default`, `secondary`, `destructive`, `outline`,
  `ghost`, `link`; sizes: `default`, `sm`, `lg`, `icon`.
- **Icon** — Solar icon set (https://solar-icons.vercel.app/) in six styles:
  `line`, `bold`, `duotone`, `broken`, `outline`, `line-duotone`. Falls back to
  `line` when a requested style is missing for an icon.

## Components by category

- **Buttons & Actions:** Button, Spinner.
- **Forms & Inputs:** Input, Textarea, Select, NativeSelect, InputGroup,
  Checkbox, Switch, RadioGroup, Slider, InputOTP, Calendar, DatePicker, Label,
  PasswordInput, Field, Toggle, ToggleGroup.
- **Layout & Display:** Card, Separator, Table (+ sub-components), Avatar,
  AvatarGroup, Badge, Skeleton, Progress, Tooltip, Typography (h1–h4, p, lead,
  blockquote, code, ul, ol), ContextMenu, Sidebar, Drawer, Item, Kbd,
  AspectRatio, Empty.
- **Chat:** Bubble, Message, MessageScroller, Marker, Attachment.
- **Overlay & Interactive:** Modal (`<dialog>` + `@Task`), Popover,
  DropdownMenu, Sheet (`<dialog>`), Accordion (`<details>`, zero-JS), Tabs,
  AlertDialog, HoverCard, Collapsible, NavigationMenu, Menubar, Command,
  Combobox, MultiSelect, Carousel, Resizable, ScrollArea, Breadcrumb,
  Pagination, ButtonGroup, Toaster + `toast` (reactive store).

See `packages/ui/README.md` in the monorepo for the full table with native
elements.

## Theming — two-layer shadcn-style system

The theme lives in `src/theme/theme.css`:

1. **Raw values** — `:root { … }` (light) and `.dark { … }` (dark) define OKLCH
   values for semantic tokens (`--primary`, `--background`, `--card`,
   `--popover`, `--accent`, `--border`, `--ring`, `--chart-*`, `--sidebar-*`).
   Default palette is shadcn's **neutral**.
2. **Tailwind mapping** — `@theme inline { … }` maps each raw variable into a
   utility (`--color-primary: var(--primary)` → `bg-primary`, `text-primary`,
   `border-primary`, …) plus a radius scale from a single `--radius` knob.

### Dark mode

Opt-in: add `class="dark"` to `<html>` (or any ancestor of the UI). No extra
import — the `.dark` token overrides live in `theme.css`.

### Retinting

Override a token in your own `:root` / `.dark`, or import a named palette AFTER
`theme.css`. Neutral families (`zinc`, `stone`, `gray`, `slate`, `neutral`)
retint the whole surface scale; accent palettes (`blue`, `green`, `red`) retint
only `--primary` / `--ring` / `--chart-*` / `--sidebar-primary-*`:

```css
@import "@cossackframework/ui/theme/theme.css";
@import "@cossackframework/ui/theme/themes/zinc.css";   /* neutral family */
```

| Palette | Type | Description |
|---|---|---|
| `neutral` | neutral | Pure achromatic (the default) |
| `zinc` | neutral | Cool gray with a subtle blue tint |
| `stone` | neutral | Warm gray with a subtle brown/amber tint |
| `gray` | neutral | Balanced, barely-tinted gray |
| `slate` | neutral | Cool blue-gray |
| `blue` | accent | Blue primary |
| `green` | accent | Green primary |
| `red` | accent | Red primary |

All corner radii derive from a single `--radius` token (default `0.625rem`);
override it to rescale every `rounded-*` utility at once. Cossack extensions add
`success` / `success-foreground` and `warning` / `warning-foreground` semantic
colors (used by Badge, Alert, Toast).

## Ejecting components

`cossack add ui <component>` copies a single component into
`src/components/ui/<Component>.ts` for customization. The ejected copy is yours
— re-run with `--force` to overwrite. Full kebab-case names: `button`, `input`,
`textarea`, `select`, `native-select`, `input-group`, `label`, `checkbox`,
`switch`, `radio-group`, `slider`, `input-otp`, `password-input`, `field`,
`toggle`, `toggle-group`, `badge`, `kbd`, `card`, `separator`, `table`,
`avatar`, `avatar-group`, `skeleton`, `progress`, `spinner`, `aspect-ratio`,
`typography`, `empty`, `item`, `marker`, `modal`, `alert-dialog`, `popover`,
`dropdown-menu`, `context-menu`, `sheet`, `drawer`, `tooltip`, `hover-card`,
`accordion`, `collapsible`, `tabs`, `navigation-menu`, `menubar`, `command`,
`combobox`, `multi-select`, `calendar`, `date-picker`, `carousel`, `resizable`,
`scroll-area`, `sidebar`, `breadcrumb`, `pagination`, `button-group`, `toaster`,
`bubble`, `message`, `message-scroller`, `attachment`.

## Focus management

DOM-level focus utilities for accessible interactive components — dropdown
menus, command palettes, dialogs, comboboxes — that need to trap or cycle
keyboard focus. Exported from **`@cossackframework/core`** (framework-agnostic,
no Cossack dependency).

```typescript
import { focusTrap, focusFirst, focusLast, focusNext, getTabbable } from '@cossackframework/core';
```

### `getTabbable(root)`
Returns all keyboard-focusable elements within `root`, in DOM order. Excludes
hidden, disabled, and `tabindex="-1"` elements.

### `focusFirst(root)` / `focusLast(root)`
Move focus to the first/last tabbable element within `root`. If none exist,
focuses `root` itself (it should have `tabindex="-1"`).

### `focusNext(root, opts?)`
Move focus to the next (or previous) tabbable element within `root`, wrapping at
boundaries. Used for roving-tabindex / arrow-key navigation.
- `reverse: true` — focus the previous element.
- `from: HTMLElement` — start from a specific element.

```typescript
@On('keydown')
handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusNext(this.container); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusNext(this.container, { reverse: true }); }
}
```

### `focusTrap(root)`
Trap Tab / Shift+Tab focus within `root`. Returns a release function that
removes the trap and restores focus to the previously-focused element.

```typescript
import { focusTrap } from '@cossackframework/core';

class MyDialog extends Cossack {
    private releaseTrap?: () => void;
    onMount() { this.releaseTrap = focusTrap(this.container); }
    onCleanup() { this.releaseTrap?.(); }   // restores focus to the trigger
}
```

How it works: (1) on activation, focuses the first tabbable element; (2)
intercepts Tab / Shift+Tab on `root`, wrapping focus; (3) on release, removes
the interceptor and restores focus.

### Accessibility notes

- The native `<dialog>` element (used by the UI package's **`Modal`** and
  **`Sheet`**) handles focus trapping automatically — you **don't need
  `focusTrap`** for those.
- `focusTrap` is for custom overlays that DON'T use `<dialog>` — e.g. a
  `<div popover>` menu that needs to contain Tab.
- Always restore focus on close. The `focusTrap` release function does this
  automatically; if you use `focusFirst` manually, store `document.activeElement`
  before opening and restore it on close.

## Toaster + `toast` (built on reactive store)

The UI package ships a ready-made toast system built on `createStore` (see
`references/reactive-store.md`). Mount a single `Toaster`, then call the
imperative `toast` API from anywhere — including `@Server` methods:

```ts
import { Toaster, toast } from "@cossackframework/ui";

// render the host once (e.g. in App):
html`${component(Toaster, {})}`;

// fire a toast from anywhere:
@Server()
async save() {
    await db().updateTable('settings')...;
    toast.success('Settings saved!');
}
```
