import { html, classMap } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientState,
} from "@cossackframework/core";

export interface ContextMenuItem {
    label?: string;
    onClick?: () => void;
    disabled?: boolean;
    /** Render a horizontal divider before this item. */
    separator?: boolean;
    /** Destructive styling (red text). */
    destructive?: boolean;
}

export interface ContextMenuProps {
    /** Menu items: [{ label, onClick, disabled?, separator? }]. */
    items?: ContextMenuItem[];
    [key: string]: any;
}

/**
 * Cossack UI ContextMenu — right-click menu using native `popover`.
 *
 * Wrap any content; right-clicking inside the wrapper opens the menu at the
 * cursor position. Uses `oncontextmenu` + the native popover API for top-layer
 * rendering and light dismiss.
 *
 *   ${component(ContextMenu, {
 *       items: [
 *           { label: 'Copy', onClick: () => copy() },
 *           { label: 'Delete', destructive: true, onClick: () => del() },
 *       ],
 *   }, html\`<p>Right-click me</p>\`)}
 */
@Component()
export class ContextMenu extends Cossack {
    declare props: ContextMenuProps;

    @ClientState() private x = 0;
    @ClientState() private y = 0;

    private popoverId = `cs-context-menu-${Math.random().toString(36).slice(2, 9)}`;

    render() {
        const { items = [] } = this.props;

        return html`
            <div
                class="cs-context-menu relative inline-block"
                @contextmenu=${(e: MouseEvent) => this.handleContext(e)}
            >
                ${this.children}
                <div
                    id=${this.popoverId}
                    popover="auto"
                    class="cs-context-menu__panel min-w-[160px] bg-background border border-border rounded-md shadow-lg p-1"
                    style="position:fixed;margin:0;"
                >
                    ${items.map((item) => html`
                        ${item.separator
                            ? html`<div class="cs-context-menu__separator h-px bg-border my-1"></div>`
                            : null}
                        <button
                            type="button"
                            ?disabled=${!!item.disabled}
                            class=${classMap({
                                "cs-context-menu__item": true,
                                "w-full text-left px-2.5 py-1.5 text-sm rounded-sm cursor-pointer border-none transition-colors bg-transparent": true,
                                "text-destructive hover:bg-destructive/10": !!item.destructive && !item.disabled,
                                "text-foreground hover:bg-muted": !item.destructive && !item.disabled,
                                "text-muted-foreground/40 cursor-not-allowed": !!item.disabled,
                            })}
                            @click=${() => this.handleClick(item)}
                        >${item.label}</button>
                    `)}
                </div>
            </div>
        `;
    }

    @Client()
    private handleContext(e: MouseEvent) {
        e.preventDefault();
        this.x = e.clientX;
        this.y = e.clientY;
        const el = document.getElementById(this.popoverId) as any;
        el?.showPopover?.();
        requestAnimationFrame(() => this.position());
    }

    @Client()
    private handleClick(item: ContextMenuItem) {
        if (item.disabled) return;
        const el = document.getElementById(this.popoverId) as any;
        el?.hidePopover?.();
        item.onClick?.();
    }

    @Client()
    private position() {
        const popover = document.getElementById(this.popoverId);
        if (!popover || !popover.matches(":popover-open")) return;
        const pw = popover.offsetWidth;
        const ph = popover.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = this.x;
        let top = this.y;
        if (left + pw > vw - 8) left = vw - pw - 8;
        if (top + ph > vh - 8) top = vh - ph - 8;
        popover.style.position = "fixed";
        popover.style.top = `${Math.max(8, top)}px`;
        popover.style.left = `${Math.max(8, left)}px`;
        popover.style.margin = "0";
    }
}
