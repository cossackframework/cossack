/**
 * Focus management utilities for accessible interactive components
 * (Dropdown Menu, Command Palette, Combobox, Dialog, etc.).
 *
 * These are framework-agnostic DOM helpers — no Cossack dependencies.
 */

// Elements that receive keyboard focus by default and are not disabled/hidden.
const TABBABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
    '[contenteditable="true"]',
    'audio[controls]',
    'video[controls]',
    'details > summary:first-child',
]
    .join(",");

/**
 * Return all tabbable (keyboard-focusable) elements within `root`, in DOM order.
 * Hidden elements (display:none, visibility:hidden, or zero-size) are excluded.
 */
export function getTabbable(root: HTMLElement): HTMLElement[] {
    const elements = Array.from(
        root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
    );
    return elements.filter((el) => {
        if (el.hasAttribute("disabled")) return false;
        if (el.getAttribute("aria-hidden") === "true") return false;
        // Check visibility: offsetParent is null for display:none in most browsers.
        // For fixed elements, offsetParent may be null even when visible, so also
        // check getClientRects.
        if (!el.offsetParent && el.getClientRects().length === 0) return false;
        return true;
    });
}

/**
 * Move focus to the first tabbable element within `root`.
 */
export function focusFirst(root: HTMLElement): void {
    const tabbable = getTabbable(root);
    if (tabbable.length > 0) {
        tabbable[0].focus();
    } else {
        // No tabbable children — focus the root itself if it's focusable.
        root.focus();
    }
}

/**
 * Move focus to the last tabbable element within `root`.
 */
export function focusLast(root: HTMLElement): void {
    const tabbable = getTabbable(root);
    if (tabbable.length > 0) {
        tabbable[tabbable.length - 1].focus();
    } else {
        root.focus();
    }
}

/**
 * Move focus to the next (or previous) tabbable element within `root`,
 * wrapping around at the boundaries. Used for roving-tabindex patterns
 * (e.g. Arrow key navigation in a menu list).
 *
 * @param root The container to search within.
 * @param opts.reverse When true, focus the previous element instead of next.
 * @param opts.from Optional element to start from; defaults to the currently
 *   focused element within `root`.
 */
export function focusNext(
    root: HTMLElement,
    opts?: { reverse?: boolean; from?: HTMLElement | null },
): void {
    const tabbable = getTabbable(root);
    if (tabbable.length === 0) return;

    const reverse = opts?.reverse ?? false;
    const current =
        opts?.from ?? (document.activeElement as HTMLElement | null);

    if (!current || !root.contains(current)) {
        // Not inside root — start from the first/last element.
        if (reverse) tabbable[tabbable.length - 1].focus();
        else tabbable[0].focus();
        return;
    }

    const currentIndex = tabbable.indexOf(current);
    if (currentIndex === -1) {
        // Current element isn't tabbable — start from the beginning/end.
        if (reverse) tabbable[tabbable.length - 1].focus();
        else tabbable[0].focus();
        return;
    }

    let nextIndex: number;
    if (reverse) {
        nextIndex = currentIndex <= 0 ? tabbable.length - 1 : currentIndex - 1;
    } else {
        nextIndex = currentIndex >= tabbable.length - 1 ? 0 : currentIndex + 1;
    }
    tabbable[nextIndex].focus();
}

/**
 * Trap keyboard focus (Tab / Shift+Tab) within `root`. Returns a release
 * function that removes the trap and restores focus to the previously-focused
 * element.
 *
 * While active, Tab and Shift+Tab cycle through tabbable elements inside
 * `root` only. The trap is automatically released if `root` is removed from
 * the DOM.
 *
 * @returns A cleanup function. Call it when the trap is no longer needed
 *   (e.g. when a Dialog/Menu closes).
 */
export function focusTrap(root: HTMLElement): () => void {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function handleKeydown(e: KeyboardEvent) {
        if (e.key !== "Tab") return;
        const tabbable = getTabbable(root);
        if (tabbable.length === 0) {
            e.preventDefault();
            root.focus();
            return;
        }

        const first = tabbable[0];
        const last = tabbable[tabbable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
            // Shift+Tab: if on first element, wrap to last
            if (active === first || !root.contains(active)) {
                e.preventDefault();
                last.focus();
            }
        } else {
            // Tab: if on last element, wrap to first
            if (active === last || !root.contains(active)) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    root.addEventListener("keydown", handleKeydown);

    // Focus the first element to begin the trap.
    focusFirst(root);

    return () => {
        root.removeEventListener("keydown", handleKeydown);
        // Restore focus to the element that had it before the trap.
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
            try {
                previouslyFocused.focus();
            } catch {
                // Element may have been removed.
            }
        }
    };
}
