import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState, createRef, type RefObject } from "@cossackframework/core";

export interface NavigationMenuProps {
    sections?: Array<{
        label: string;
        items?: Array<{ label: string; href: string; description?: string }>;
    }>;
    /** How to trigger the submenu: hover (default) or click. */
    trigger?: "hover" | "click";
    /** Hover delay in ms. Default 100 (short, just to bridge the gap). */
    hoverDelay?: number;
    [key: string]: any;
}

/**
 * Cossack UI NavigationMenu — horizontal nav with dropdown panels.
 *
 * Hover or click a section to reveal its links. Uses native `popover` + JS
 * positioning. A short hover delay bridges the gap between trigger and panel
 * so the submenu doesn't close when moving the mouse to it.
 *
 *   ${component(NavigationMenu, {
 *       trigger: 'hover',
 *       sections: [{ label: 'Products', items: [...] }],
 *   })}
 */
@Component()
export class NavigationMenu extends Cossack {
    declare props: NavigationMenuProps;

    @ClientState() activeSection: number = -1;
    private sectionRefs: RefObject<HTMLButtonElement>[] = [];
    private hoverTimer: ReturnType<typeof setTimeout> | undefined;

    render() {
        const { sections = [], trigger = "hover" } = this.props;

        while (this.sectionRefs.length < sections.length) {
            this.sectionRefs.push(createRef<HTMLButtonElement>());
        }

        return html`
            <nav class="cs-navigation-menu relative z-10 flex items-center gap-1" aria-label="Navigation menu">
                ${sections.map((section, i) => {
                    const popoverId = `cs-nav-menu-${i}`;
                    const isActive = this.activeSection === i;

                    const hoverEvents = trigger === "hover" ? {
                        "onMouseenter": () => this.scheduleOpen(i, popoverId),
                        "onMouseleave": () => this.scheduleClose(popoverId),
                    } : {};

                    return html`
                        <div
                            class="cs-navigation-menu__section relative inline-flex"
                            ...=${hoverEvents}
                        >
                            <button
                                type="button"
                                ref=${this.sectionRefs[i]}
                                class=${classMap({
                                    "cs-navigation-menu__trigger": true,
                                    "px-3 py-2 text-sm font-medium rounded-md cursor-pointer border-none transition-colors": true,
                                    "text-foreground bg-muted": isActive,
                                    "text-muted-foreground hover:text-foreground": !isActive,
                                })}
                                @click=${trigger === "click" ? () => this.handleClickSection(i, popoverId) : undefined}
                                @mouseenter=${trigger === "hover" ? () => this.scheduleOpen(i, popoverId) : undefined}
                                @mouseleave=${trigger === "hover" ? () => this.scheduleClose(popoverId) : undefined}
                            >${section.label}</button>
                            <div
                                id=${popoverId}
                                popover="manual"
                                class="cs-navigation-menu__panel cs-nav-popover bg-background border border-border rounded-lg shadow-lg p-2 min-w-[200px]"
                                @mouseenter=${() => { this.clearHoverTimer(); this.activeSection = i; }}
                                @mouseleave=${() => { this.scheduleClose(`cs-nav-menu-${i}`); }}
                            >
                                ${(section.items || []).map((item) => html`
                                    <a
                                        href=${item.href}
                                        class="cs-navigation-menu__link block px-3 py-2 rounded-md hover:bg-muted transition-colors"
                                    >
                                        <span class="text-sm font-medium text-foreground">${item.label}</span>
                                        ${item.description ? html`<span class="block text-xs text-muted-foreground mt-0.5">${item.description}</span>` : null}
                                    </a>
                                `)}
                            </div>
                        </div>
                    `;
                })}
            </nav>
        `;
    }

    @Client()
    private handleClickSection(index: number, _popoverId: string) {
        // Close all panels first
        this.closeAllPanels();
        if (this.activeSection === index) {
            this.activeSection = -1;
            return;
        }
        this.activeSection = index;
        const popoverId = `cs-nav-menu-${index}`;
        requestAnimationFrame(() => this.openPanel(index, popoverId));
    }

    @Client()
    private scheduleOpen(index: number, _popoverId: string) {
        this.clearHoverTimer();
        const delay = this.props.hoverDelay ?? 100;
        this.hoverTimer = setTimeout(() => {
            this.activeSection = index;
            this.openPanel(index, `cs-nav-menu-${index}`);
        }, delay);
    }

    @Client()
    private scheduleClose(popoverId: string) {
        this.clearHoverTimer();
        this.hoverTimer = setTimeout(() => {
            this.activeSection = -1;
            this.closePanel(popoverId);
        }, 150);
    }

    @Client()
    private clearHoverTimer() {
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = undefined;
        }
    }

    @Client()
    private openPanel(index: number, popoverId: string) {
        // Close other panels
        this.closeAllPanels();
        const popover = document.getElementById(popoverId) as any;
        const trigger = this.sectionRefs[index]?.value;
        if (!popover || !trigger) return;
        popover.showPopover?.();
        requestAnimationFrame(() => this.positionPanel(popover, trigger));
    }

    @Client()
    private closePanel(popoverId: string) {
        const popover = document.getElementById(popoverId) as any;
        popover?.hidePopover?.();
    }

    @Client()
    private closeAllPanels() {
        const { sections = [] } = this.props;
        sections.forEach((_, i) => {
            const el = document.getElementById(`cs-nav-menu-${i}`) as any;
            el?.hidePopover?.();
        });
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
