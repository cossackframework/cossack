---
title: "Focus Management"
description: "Utilities for trapping and navigating keyboard focus in accessible interactive components like menus, dialogs, and command palettes."
---

# Focus Management

Cossack provides DOM-level focus utilities for building accessible interactive
components that need to trap or cycle keyboard focus. Examples are dropdown
menus, command palettes, dialogs, and comboboxes.

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
order. Hidden, disabled, `aria-hidden="true"` and `tabindex="-1"` elements are excluded.

```typescript
const buttons = getTabbable(menuElement);
// → [<button>, <button>, <a>, ...]
```

## `focusFirst(root)` / `focusLast(root)`

Move focus to the first or last tabbable element within `root`. If no tabbable
children exist, the helper focuses `root` itself. Add `tabindex="-1"` to `root` in this case.

```typescript
// Focus the first menu item when a dropdown opens.
focusFirst(menuElement);
```

## `focusNext(root, opts?)`

Move focus to the next or previous tabbable element within `root`. Focus wraps
around at the boundaries. Use this for roving-tabindex or arrow-key navigation.

```typescript
// Arrow Down → next item. `listRef` is a `@Ref()` on the list element.
@On('keydown')
handleKeydown(e: KeyboardEvent) {
    const list = this.listRef.value;
    if (!list) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusNext(list);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusNext(list, { reverse: true });
    }
}
```

Pass the element through a [`@Ref`](./refs.md). `this.container` is not set for `component()` children or for pages rendered inside the App.

Options:

- `reverse: true` focuses the previous element instead of the next one.
- `from: HTMLElement` starts from a specific element instead of the focused
 element.

## `focusTrap(root)`

Trap keyboard focus (Tab / Shift+Tab) within `root`. While active, Tab and
Shift+Tab cycle through tabbable elements inside `root` only. The helper returns a release
function that removes the trap and restores focus to the previously-focused
element.

```typescript
import { Cossack, Ref, focusTrap, type RefObject } from '@cossackframework/core';

class MyDialog extends Cossack {
    @Ref() declare panelRef: RefObject<HTMLDivElement>;
    private releaseTrap?: () => void;

    onMount() {
        // Trap focus when the dialog opens.
        if (this.panelRef.value) this.releaseTrap = focusTrap(this.panelRef.value);
    }

    onCleanup() {
        // Release the trap and restore focus to the trigger.
        this.releaseTrap?.();
    }
}
```

How it works:

1. On activation, the helper focuses the first tabbable element inside `root`.
2. It intercepts Tab / Shift+Tab keydown events on `root` and wraps focus between
 the first and last tabbable elements.
3. On release (call the returned function), it removes the interceptor and
 restores focus to whichever element had it before the trap was activated.

## Practical example: Dropdown Menu

```typescript
import { Cossack, Component, Client, On, Ref, focusFirst, focusNext, type RefObject } from '@cossackframework/core';

@Component()
export class DropdownMenu extends Cossack {
    @Ref() declare menuRef: RefObject<HTMLElement>;

    @Client()
    openMenu() {
        const menu = this.menuRef.value;
        if (!menu) return;
        menu.showPopover();
        // Focus the first item for keyboard users.
        focusFirst(menu);
    }

    @On('keydown')
    onKeydown(e: KeyboardEvent) {
        const menu = this.menuRef.value;
        if (!menu || !menu.matches(':popover-open')) return;

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
 handles focus trapping automatically. You do not need `focusTrap` for those.
- `focusTrap` is for custom overlays that do not use `<dialog>`, such as a
 `<div popover>` menu that needs to contain Tab.
- Always restore focus on close. The `focusTrap` release function does this
 automatically. If you use `focusFirst` manually, store `document.activeElement`
 before you open the overlay, and restore it on close.
