import { html, classMap, component } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState, createRef, type RefObject } from "@cossackframework/core";
import { Icon } from "../icons/Icon";
import { AltArrowDownIcon as altArrowDownIcon } from "@cossackframework/solar-icons/alt-arrow-down";

export interface MenubarProps {
    menus?: Array<{
        label: string;
        items?: Array<{ label?: unknown; onClick?: () => void; separator?: boolean; disabled?: boolean }>;
    }>;
    /** Show a rotating chevron indicator on each trigger (default false). */
    chevron?: boolean;
    [key: string]: any;
}

/**
 * Cossack UI Menubar — horizontal bar of dropdown menus (File/Edit/View style).
 * Click a menu label to open its dropdown below it. Uses native `popover` +
 * JS positioning.
 */
@Component()
export class Menubar extends Cossack {
    declare props: MenubarProps;

    @ClientState() openMenu: number = -1;
    private triggerRefs: RefObject<HTMLButtonElement>[] = [];

    render() {
        const { menus = [], chevron = false } = this.props;
        while (this.triggerRefs.length < menus.length) {
            this.triggerRefs.push(createRef<HTMLButtonElement>());
        }

        return html`
            <div class="cs-menubar inline-flex items-center gap-1 rounded-md bg-muted p-1" role="menubar">
                ${menus.map((menu, i) => {
                    const popoverId = `cs-menubar-${i}`;
                    return html`
                        <div class="cs-menubar__item relative" role="none">
                            <button
                                type="button"
                                role="menuitem"
                                ref=${this.triggerRefs[i]}
                                class=${classMap({
                                    "cs-menubar__trigger group": true,
                                    "px-3 py-1.5 text-sm font-medium rounded-sm cursor-pointer border-none transition-colors inline-flex items-center": true,
                                    "bg-accent text-accent-foreground shadow-xs": this.openMenu === i,
                                    "text-muted-foreground hover:bg-accent hover:text-foreground bg-transparent": this.openMenu !== i,
                                })}
                                @click=${() => { this.openMenu = this.openMenu === i ? -1 : i; this.togglePanel(i, popoverId); }}
                            >${menu.label}${chevron ? html`<span class="relative top-[1px] ml-1 w-3 h-3 inline-flex items-center justify-center transition-transform duration-300 ${this.openMenu === i ? "rotate-180" : ""} [&_svg]:size-3">${component(Icon, { entry: altArrowDownIcon, size: 16 })}</span>` : null}</button>
                            <div
                                id=${popoverId}
                                popover="auto"
                                class="cs-menubar__dropdown cs-menu-popover bg-popover text-popover-foreground border rounded-md shadow-lg p-1 min-w-[160px]"
                                @toggle=${(e: Event) => this.handleToggle(e, i)}
                            >
                                ${(menu.items || []).map((item) =>
                                    item.separator
                                        ? html`<hr class="border-t my-1" />`
                                        : html`<button
                                            type="button"
                                            role="menuitem"
                                            ?disabled=${!!item.disabled}
                                            class=${classMap({
                                                "cs-menubar__dropdown-item": true,
                                                "w-full text-left px-3 py-1.5 text-sm rounded-sm cursor-pointer border-none transition-colors": true,
                                                "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none": !item.disabled,
                                                "opacity-50 cursor-not-allowed": !!item.disabled,
                                            })}
                                            @click=${() => {
                                                if (item.disabled) return;
                                                item.onClick?.();
                                                this.openMenu = -1;
                                                this.closePanel(popoverId);
                                            }}
                                        >${item.label}</button>`
                                )}
                            </div>
                        </div>
                    `;
                })}
            </div>
        `;
    }

    @Client()
    private togglePanel(index: number, popoverId: string) {
        // Close all other panels
        const { menus = [] } = this.props;
        menus.forEach((_, i) => {
            if (i !== index) {
                const el = document.getElementById(`cs-menubar-${i}`) as any;
                el?.hidePopover?.();
            }
        });
        const popover = document.getElementById(popoverId) as any;
        const trigger = this.triggerRefs[index]?.value;
        if (!popover || !trigger) return;
        if (this.openMenu === index) {
            popover.showPopover?.();
            requestAnimationFrame(() => this.positionPanel(popover, trigger));
        }
    }

    @Client()
    private closePanel(popoverId: string) {
        const popover = document.getElementById(popoverId) as any;
        popover?.hidePopover?.();
    }

    @Client()
    private handleToggle(e: Event, index: number) {
        const el = e.target as HTMLElement;
        if (!el.matches(":popover-open")) {
            if (this.openMenu === index) this.openMenu = -1;
            return;
        }
        const trigger = this.triggerRefs[index]?.value;
        if (trigger) this.positionPanel(el, trigger);
    }

    @Client()
    private positionPanel(popover: HTMLElement, trigger: HTMLElement) {
        if (!popover.matches(":popover-open")) return;
        const rect = trigger.getBoundingClientRect();
        const gap = 4;
        popover.style.position = "fixed";
        popover.style.top = `${rect.bottom + gap}px`;
        popover.style.left = `${rect.left}px`;
        popover.style.margin = "0";
    }
}
