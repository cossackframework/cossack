import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    On,
    createRef,
    focusFirst,
    focusNext,
    getTabbable,
    type RefObject,
} from "@cossackframework/core";

export interface DropdownMenuProps {
    /** Trigger content (a label or icon). */
    trigger?: unknown;
    /** Preferred side for the menu to open. */
    side?: "bottom" | "top";
    /** Menu items: [{ label, onClick, disabled }]. */
    items?: Array<{ label: unknown; onClick?: () => void; disabled?: boolean; separator?: boolean }>;
    /** Allow arbitrary HTML attributes. */
    [key: string]: any;
}

/**
 * Cossack UI Dropdown Menu — native `popover` + keyboard navigation.
 *
 * Uses the browser's `popover` API for top-layer rendering + light dismiss.
 * Keyboard: Arrow Up/Down to move between items, Escape to close, Enter to
 * activate. Focus is managed via the framework's `focusFirst` / `focusNext`
 * utilities.
 *
 *   ${component(DropdownMenu, {
 *       trigger: 'Actions',
 *       items: [
 *           { label: 'Edit', onClick: () => this.edit() },
 *           { label: 'Delete', onClick: () => this.del() },
 *       ],
 *   })}
 */
@Component()
export class DropdownMenu extends Cossack {
    declare props: DropdownMenuProps;

    menuRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();
    private popoverId = `cs-menu-${Math.random().toString(36).slice(2, 9)}`;
    private releaseFocusTrap?: () => void;

    render() {
        const { trigger, side = "bottom", items = [] } = this.props;

        const menuClasses = classMap({
            "cs-dropdown-menu": true,
            "bg-background border border-border rounded-md shadow-lg p-1 min-w-[180px]": true,
        });

        return html`
            <span class="cs-dropdown-menu__wrapper relative inline-flex">
                <button
                    type="button"
                    popovertarget=${this.popoverId}
                    class="cs-dropdown-menu__trigger inline-flex items-center justify-center cursor-pointer"
                    @click=${() => this.handleOpen()}
                >
                    ${trigger}
                </button>
                <div
                    ref=${this.menuRef}
                    id=${this.popoverId}
                    popover="auto"
                    class=${menuClasses}
                    @toggle=${(e: Event) => this.handleToggleEvent(e)}
                    @keydown=${(e: KeyboardEvent) => this.handleKeydown(e)}
                >
                    ${items.map(
                        (item) =>
                            item.separator
                                ? html`<hr class="cs-dropdown-menu__separator border-t border-border my-1" />`
                                : html`
                                    <button
                                        type="button"
                                        class=${classMap({
                                            "cs-dropdown-menu__item": true,
                                            "w-full text-left px-3 py-2 text-sm rounded-sm cursor-pointer border-none": true,
                                            "hover:bg-muted focus:bg-muted focus:outline-none": !item.disabled,
                                            "opacity-50 cursor-not-allowed": !!item.disabled,
                                        })}
                                        ?disabled=${!!item.disabled}
                                        @click=${() => {
                                            if (item.disabled) return;
                                            item.onClick?.();
                                            this.closeMenu();
                                        }}
                                    >
                                        ${item.label}
                                    </button>
                                `,
                    )}
                    ${this.children}
                </div>
            </span>
        `;
    }

    private handleOpen() {
        requestAnimationFrame(() => this.position());
    }

    private handleToggleEvent(e: Event) {
        const el = e.target as HTMLElement;
        if (el === this.menuRef.value && el.matches(":popover-open")) {
            this.position();
            // Focus the first menu item for keyboard navigation.
            const menu = this.menuRef.value;
            if (menu) focusFirst(menu);
        } else if (el === this.menuRef.value) {
            // Menu closed (ESC or light dismiss) — release focus.
            this.releaseFocusTrap?.();
        }
    }

    private handleKeydown(e: KeyboardEvent) {
        const menu = this.menuRef.value;
        if (!menu) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            focusNext(menu, { from: document.activeElement as HTMLElement });
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            focusNext(menu, { reverse: true, from: document.activeElement as HTMLElement });
        } else if (e.key === "Escape") {
            e.preventDefault();
            this.closeMenu();
        }
    }

    @Client()
    showMenu() {
        const el = this.menuRef.value as any;
        el?.showPopover?.();
        requestAnimationFrame(() => this.position());
    }

    @Client()
    closeMenu() {
        const el = this.menuRef.value as any;
        el?.hidePopover?.();
    }

    /** Position the menu relative to the trigger button. */
    private position() {
        const menu = this.menuRef.value;
        if (!menu || !menu.matches(":popover-open")) return;
        const trigger = menu
            .closest(".cs-dropdown-menu__wrapper")
            ?.querySelector<HTMLElement>(".cs-dropdown-menu__trigger");
        if (!trigger) return;

        const rect = trigger.getBoundingClientRect();
        const mw = menu.offsetWidth;
        const side = this.props.side || "bottom";
        const gap = 4;

        let top = side === "bottom" ? rect.bottom + gap : rect.top - menu.offsetHeight - gap;
        let left = rect.left;

        // Collision: flip vertically if overflowing bottom.
        if (top + menu.offsetHeight > window.innerHeight - gap && side === "bottom") {
            top = rect.top - menu.offsetHeight - gap;
        }

        // Collision: keep in viewport horizontally.
        if (left + mw > window.innerWidth - gap) {
            left = window.innerWidth - mw - gap;
        }
        if (left < gap) left = gap;

        menu.style.position = "fixed";
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.style.margin = "0";
    }
}
