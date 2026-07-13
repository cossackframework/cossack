import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    OnWindow,
    createRef,
    focusFirst,
    focusNext,
    getTabbable,
    type RefObject,
} from "@cossackframework/core";

export interface DropdownMenuProps {
    /** Trigger content (a label or icon). */
    trigger?: unknown;
    /** Preferred side for the menu to open. Default "bottom".
     *  - "top"/"bottom": menu opens above/below the trigger (align = start/center/end).
     *  - "left"/"right": menu opens to the side of the trigger (align = start/center/end on the vertical axis). */
    side?: "bottom" | "top" | "left" | "right";
    /** Alignment on the cross axis. For top/bottom side this is horizontal;
     *  for left/right side this is vertical. Default "start". */
    align?: "start" | "center" | "end";
    /** Menu items. Use { separator: true } for a divider (label not required). */
    items?: Array<{ label?: unknown; onClick?: () => void; disabled?: boolean; separator?: boolean }>;
    /** When true, the trigger stretches to fill its container (block layout). */
    block?: boolean;
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
 * Positioning is collision-aware: if the menu would overflow the viewport on
 * the preferred `side`, it flips to the opposite side; if it overflows on the
 * cross axis, it shifts into view. Repositions on scroll and resize while open.
 *
 *   ${component(DropdownMenu, {
 *       trigger: 'Actions',
 *       side: 'bottom',
 *       align: 'start',
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

        const { block = false } = this.props;

        return html`
            <span class=${classMap({
                "cs-dropdown-menu__wrapper": true,
                "relative inline-flex": !block,
                "relative flex w-full": block,
            })}>
                <button
                    type="button"
                    popovertarget=${this.popoverId}
                    class="cs-dropdown-menu__trigger flex items-center cursor-pointer w-full text-left"
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
                    @click=${(e: MouseEvent) => this.handleContentClick(e)}
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

    @Client()
    private handleOpen() {
        requestAnimationFrame(() => this.position());
    }

    @Client()
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

    /** Close the menu when any button inside the popover content is clicked,
     *  so children-slot items (not just the `items` prop) dismiss on select. */
    @Client()
    private handleContentClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        const btn = target.closest("button,[data-menu-close]");
        if (btn) this.closeMenu();
    }

    @Client()
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

    /** Reposition on scroll/resize while open. */
    @OnWindow("scroll", { throttle: 100 })
    @OnWindow("resize")
    onViewportChange() {
        const menu = this.menuRef.value;
        if (menu && menu.matches(":popover-open")) {
            this.position();
        }
    }

    /**
     * Position the menu relative to the trigger, collision-aware.
     *
     * The `side`/`align` props are *preferences*: if the menu would overflow
     * the viewport, it flips side and/or shifts on the cross axis. Supports all
     * four sides — for "left"/"right" the menu opens beside the trigger (handy
     * for sidebar user-menus) and the `align` prop controls vertical placement.
     */
    @Client()
    private position() {
        const menu = this.menuRef.value;
        if (!menu || !menu.matches(":popover-open")) return;
        const trigger = menu
            .closest(".cs-dropdown-menu__wrapper")
            ?.querySelector<HTMLElement>(".cs-dropdown-menu__trigger");
        if (!trigger) return;

        const rect = trigger.getBoundingClientRect();
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const gap = 4;
        const side = this.props.side || "bottom";
        const align = this.props.align || "start";

        let top: number;
        let left: number;

        if (side === "top" || side === "bottom") {
            // --- Vertical side: position on Y, align on X ---
            const spaceBelow = vh - rect.bottom - gap;
            const spaceAbove = rect.top - gap;
            let actualSide = side;
            if (side === "bottom" && mh > spaceBelow && mh <= spaceAbove) actualSide = "top";
            else if (side === "top" && mh > spaceAbove && mh <= spaceBelow) actualSide = "bottom";

            top = actualSide === "bottom" ? rect.bottom + gap : rect.top - mh - gap;

            if (align === "center") left = rect.left + rect.width / 2 - mw / 2;
            else if (align === "end") left = rect.right - mw;
            else left = rect.left;
        } else {
            // --- Horizontal side: position on X, align on Y ---
            const spaceRight = vw - rect.right - gap;
            const spaceLeft = rect.left - gap;
            let actualSide = side;
            if (side === "right" && mw > spaceRight && mw <= spaceLeft) actualSide = "left";
            else if (side === "left" && mw > spaceLeft && mw <= spaceRight) actualSide = "right";

            left = actualSide === "right" ? rect.right + gap : rect.left - mw - gap;

            if (align === "center") top = rect.top + rect.height / 2 - mh / 2;
            else if (align === "end") top = rect.bottom - mh;
            else top = rect.top;
        }

        // Clamp into viewport on both axes.
        if (left + mw > vw - gap) left = vw - mw - gap;
        if (left < gap) left = gap;
        if (top + mh > vh - gap) top = vh - mh - gap;
        if (top < gap) top = gap;

        menu.style.position = "fixed";
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.style.margin = "0";
    }
}
