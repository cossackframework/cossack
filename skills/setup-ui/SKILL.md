---
name: setup-ui
description: Set up the UI package (@cossackframework/ui) in a Cossack application
disable-model-invocation: true
user-invocable: true
---

# Set Up the UI Package in Cossack

You are setting up `@cossackframework/ui` — a token-driven, themeable component
library (shadcn/ui-inspired, Solar icons) — in a Cossack Framework application.
Components are Cossack components consumed with the `component()` helper, not JSX.

Work through these steps in order. Ask the user which theme they want before
running the install command.

## Step 1: Install & wire the package

Use the CLI, which wires the package + CSS imports + Tailwind `@source` lines
automatically:

```bash
cossack add ui
```

If the user picked a palette in Step 2, pass `--theme`:

```bash
cossack add ui --theme blue     # or zinc, stone, gray, slate, green, red
```

Verify `src/style.css` now contains (after `@import "tailwindcss";`):

```css
@import "@cossackframework/ui/theme/base.css";
@import "@cossackframework/ui/theme/theme.css";
@import "@cossackframework/ui/theme/themes/blue.css";   /* only if --theme was an accent/neutral palette */

@source "../node_modules/@cossackframework/ui/src/components";
@source "../node_modules/@cossackframework/ui/src/icons";
```

> The `@source` lines are **required** — Tailwind v4 excludes `node_modules` by
> default, so without them most component variants render unstyled. If they are
> missing, add them by hand.

## Step 2: Choose a theme

Ask the user which palette they want (default `neutral`):

| Palette | Type | When |
|---|---|---|
| `neutral` | neutral | Pure achromatic (default, shadcn-style) |
| `zinc` / `stone` / `gray` / `slate` | neutral family | Retints the whole surface scale |
| `blue` / `green` / `red` | accent | Retints only `--primary`/`--ring`/`--chart-*` |

If unsure, recommend `neutral` (the default) or `zinc` for a cool gray.

## Step 3: Use components

Components are imported from `@cossackframework/ui` and rendered with
`component()` from `@cossackframework/renderer`. Show the user a small example:

```ts
import { html, component } from "@cossackframework/renderer";
import { Button, Input, Label, Card, Icon, toast } from "@cossackframework/ui";

@Page()
export default class DemoPage extends Cossack {
    @Client() save() { toast.success("Saved!"); }

    render() {
        return html`
            ${component(Card, {},
                html`
                    ${component(Label, { for: "email" }, "Email")}
                    ${component(Input, { id: "email", type: "email", placeholder: "you@ex.com" })}
                    ${component(Button, { variant: "default", "@click": this.save }, "Save")}
                    ${component(Icon, { name: "arrow-right", style: "duotone", size: 20 })}
                `
            )}
        `;
    }
}
```

Key facts to convey:
- **Button** variants: `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`; sizes: `default`, `sm`, `lg`, `icon`.
- **Icon** uses the **Solar** icon set (https://solar-icons.vercel.app/) in six styles: `line`, `bold`, `duotone`, `broken`, `outline`, `line-duotone`. It falls back to `line` when a requested style is missing.
- Event handlers pass through props with an `@` prefix, e.g. `"@click": this.save` (methods are auto-bound).

Available component groups: Buttons & Actions, Forms & Inputs (Input, Textarea, Select, Checkbox, Switch, Slider, InputOTP, Calendar, DatePicker, …), Layout & Display (Card, Table, Avatar, Badge, Skeleton, Progress, Tooltip, Typography, Sidebar, …), Chat (Bubble, Message, MessageScroller, …), Overlay & Interactive (Modal, Popover, DropdownMenu, Sheet, Accordion, Tabs, Toaster, …).

## Step 4: (Optional) Eject a component for customization

If the user wants to customize a component, eject a copy into their project:

```bash
cossack add ui button      # copies src/components/ui/Button.ts
```

The ejected copy is theirs to edit. Re-run with `--force` to overwrite. Full
kebab-case names: `button`, `input`, `modal`, `alert-dialog`, `popover`,
`dropdown-menu`, `sheet`, `command`, `combobox`, `toaster`, … (see
`packages/ui/README.md` for the full list).

## Step 5: (Optional) Build accessible custom overlays with focus helpers

For **custom** overlays (a `<div popover>` menu, a command palette) that need to
trap or cycle focus, use the focus utilities from `@cossackframework/core`:

```ts
import { focusTrap, focusNext, focusFirst } from '@cossackframework/core';

class CommandPalette extends Cossack {
    private releaseTrap?: () => void;

    @Client() open() {
        this.releaseTrap = focusTrap(this.container);
        focusFirst(this.container);
    }
    onCleanup() { this.releaseTrap?.(); }   // restores focus to the trigger

    @On('keydown')
    onKeydown(e: KeyboardEvent) {
        if (e.key === 'ArrowDown') { e.preventDefault(); focusNext(this.container); }
        if (e.key === 'ArrowUp') { e.preventDefault(); focusNext(this.container, { reverse: true }); }
    }
}
```

> **Do NOT add `focusTrap` to a native `<dialog>`.** The UI package's **`Modal`**
> and **`Sheet`** are built on `<dialog>`, which traps focus automatically.
> `focusTrap` is only for custom overlays that DON'T use `<dialog>`.

## Step 6: (Optional) Wire the global Toaster

The UI package ships a toast system built on `createStore`. Mount a single
`Toaster` host, then call the imperative `toast` API from anywhere — including
`@Server` methods:

```ts
import { Toaster, toast } from "@cossackframework/ui";
import { component } from "@cossackframework/renderer";

// In your App component (mounted once, persists across navigations):
render() {
    return html`<main>${this.children}</main>${component(Toaster, {})}`;
}
```

```ts
@Server()
async saveSettings() {
    await Setting.update({ id }, patch);
    toast.success("Settings saved!");   // fires on the client
}
```

## Step 7: Dark mode (opt-in)

Dark mode is opt-in via `class="dark"` on `<html>` (or any ancestor of the UI).
The `.dark` token overrides live in `theme.css` — no extra import needed. If the
user wants a toggle, toggle the class on `document.documentElement`.

## Step 8: Verify

1. Run `pnpm tsc --noEmit` — no type errors.
2. Run `pnpm run dev` and confirm components render styled (if they look
   unstyled, the `@source` lines in Step 1 are missing).
3. Toggle `class="dark"` to confirm dark mode.
4. Click a `Button` with a `toast` handler to confirm the Toaster works.

## Checklist

- [ ] `cossack add ui` ran (or package installed + CSS wired by hand)
- [ ] `src/style.css` has the `base.css` + `theme.css` imports and the two `@source` lines
- [ ] `--theme=<palette>` applied if the user chose a non-default palette
- [ ] A demo page renders `Button` / `Input` / `Icon` styled
- [ ] (If used) custom overlay uses `focusTrap` from `@cossackframework/core`; Modal/Sheet left to native `<dialog>`
- [ ] (If used) `Toaster` mounted once in App; `toast.success(...)` callable from a `@Server` method
- [ ] `pnpm tsc --noEmit` passes
