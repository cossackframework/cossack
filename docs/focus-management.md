---
title: "Focus Management"
description: "Utilities for trapping and navigating keyboard focus in accessible interactive components like menus, dialogs, and command palettes."
---

# Focus Management

Cossack provides DOM-level focus utilities for building accessible interactive
components — dropdown menus, command palettes, dialogs, comboboxes — that need
to trap or cycle keyboard focus.

These are framework-agnostic helpers exported from `@cossackframework/core`.
They work with any DOM tree and have no Cossack dependencies.

## Import

```typescript
import {
    focusTrap,
    focusFirst,
    focusLast,
    focusNext,
    getTabbable,
} from '@cossackframework/core';
```

## `getTabbable(root)`

Returns all keyboard-focusable (`tabbable`) elements within `root`, in DOM
order. Hidden, disabled, and `tabindex="-1"` elements are excluded.

```typescript
const buttons = getTabbable(menuElement);
// → [<button>, <button>, <a>, ...]
```

## `focusFirst(root)` / `focusLast(root)`

Move focus to the first or last tabbable element within `root`. If no tabbable
children exist, focuses `root` itself (it should have `tabindex="-1"`).

```typescript
// Focus the first menu item when a dropdown opens.
focusFirst(menuElement);
```

## `focusNext(root, opts?)`

Move focus to the next (or previous) tabbable element within `root`, wrapping
around at the boundaries. Used for roving-tabindex / arrow-key navigation.

```typescript
// Arrow Down → next item
@On('keydown')
handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusNext(this.container);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusNext(this.container, { reverse: true });
    }
}
```

**Options:**
- `reverse: true` — focus the previous element instead of next.
- `from: HTMLElement` — start from a specific element instead of the currently
  focused one.

## `focusTrap(root)`

Trap keyboard focus (Tab / Shift+Tab) within `root`. While active, Tab and
Shift+Tab cycle through tabbable elements inside `root` only. Returns a release
function that removes the trap and restores focus to the previously-focused
element.

```typescript
import { focusTrap, OnDocument } from '@cossackframework/core';

class MyDialog extends Cossack {
    private releaseTrap?: () => void;

    onMount() {
        // Trap focus when the dialog opens.
        this.releaseTrap = focusTrap(this.container);
    }

    onCleanup() {
        // Release the trap and restore focus to the trigger.
        this.releaseTrap?.();
    }
}
```

**How it works:**
1. On activation, focuses the first tabbable element inside `root`.
2. Intercepts Tab / Shift+Tab keydown events on `root`, wrapping focus between
   the first and last tabbable elements.
3. On release (call the returned function), removes the interceptor and
   restores focus to whichever element had it before the trap was activated.

## Practical example: Dropdown Menu

```typescript
import { Cossack, Component, Client, focusFirst, focusNext } from '@cossackframework/core';

@Component()
export class DropdownMenu extends Cossack {
    @Client()
    openMenu() {
        const menu = this.container.querySelector('[role="menu"]');
        menu.showPopover();
        // Focus the first item for keyboard users.
        focusFirst(menu);
    }

    @On('keydown')
    onKeydown(e: KeyboardEvent) {
        const menu = this.container.querySelector('[role="menu"]');
        if (!menu.matches(':popover-open')) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusNext(menu);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusNext(menu, { reverse: true });
        } else if (e.key === 'Escape') {
            menu.hidePopover();
        }
    }
}
```

## Accessibility notes

- The native `<dialog>` element (used by the UI package's `Modal` and `Sheet`)
  handles focus trapping automatically — you don't need `focusTrap` for those.
- `focusTrap` is for custom overlays that DON'T use `<dialog>` — e.g. a
  `<div popover>` menu that needs to contain Tab.
- Always restore focus on close (the `focusTrap` release function does this
  automatically; if you use `focusFirst` manually, store `document.activeElement`
  before opening and restore it on close).
