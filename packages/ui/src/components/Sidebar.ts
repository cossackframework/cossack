import { html, classMap, component } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientState,
    createRef,
    type RefObject,
} from "@cossackframework/core";
import { Icon } from "../icons/Icon";

export interface SidebarItem {
    label: string;
    href?: string;
    icon?: string;
    active?: boolean;
    /** Nested children (renders a collapsible group). */
    children?: SidebarItem[];
}

export interface SidebarProps {
    /** Top-level nav items. */
    items?: SidebarItem[];
    /** Optional brand/title at the top. */
    title?: string;
    /** Default collapsed state (icon-only rail). */
    defaultCollapsed?: boolean;
    /** Collapsible behavior. "icon" = collapse to icon rail, "offcanvas" = hide entirely. */
    collapsible?: "icon" | "offcanvas";
    /** Width when expanded. Default "260px". */
    width?: string;
    /** Called when an item is clicked (for SPA routing). */
    onNavigate?: (item: SidebarItem) => void;
    /** Arbitrary content rendered in the footer slot (user menu, version, etc.). */
    footer?: unknown;
    [key: string]: any;
}

/**
 * Cossack UI Sidebar — collapsible navigation rail.
 *
 * Layout (top → bottom):
 *   ┌─────────────────────┐
 *   │ Header (brand/menu) │  ← title + collapse toggle
 *   ├─────────────────────┤
 *   │ Nav items (scroll)  │  ← items, with nested groups
 *   │                     │
 *   ├─────────────────────┤
 *   │ Footer slot         │  ← `footer` prop: any content (user menu, version, …)
 *   └─────────────────────┘
 *
 * The footer is intentionally agnostic — pass any content via the `footer`
 * prop (a user-menu trigger, version string, action buttons, …). The header,
 * nav, and footer each have a `cs-sidebar__*` hook class for styling.
 *
 * Collapse modes:
 *   - "icon" (default): shrinks to a narrow rail showing only icons.
 *   - "offcanvas": hides entirely, toggled by the menu button.
 *
 * Items may have nested `children` which render as collapsible groups with a
 * chevron. Each item uses a real `<a>` link (works without JS) plus a JS
 * `onNavigate` hook for SPA routing.
 *
 *   ${component(Sidebar, {
 *       title: 'My App',
 *       items: [{ label: 'Home', href: '/', icon: 'home' }, ...],
 *       footer: html`<button>...</button>`,
 *       collapsible: 'icon',
 *   })}
 */
@Component()
export class Sidebar extends Cossack {
    declare props: SidebarProps;

    @ClientState() private collapsed = false;
    /** Indexes of expanded nested groups. */
    @ClientState() private expandedGroups: Record<string, boolean> = {};
    @ClientState() private initialized = false;

    sidebarRef: RefObject<HTMLElement> = createRef<HTMLElement>();

    onMount() {
        if (!this.initialized) {
            this.collapsed = this.props.defaultCollapsed ?? false;
            this.initialized = true;
        }
    }

    render() {
        const {
            items = [],
            title = "",
            defaultCollapsed: _dc = false,
            collapsible = "icon",
            width = "260px",
            footer,
        } = this.props;

        const railWidth = this.collapsed && collapsible === "icon" ? "72px" : width;
        const isHidden = this.collapsed && collapsible === "offcanvas";
        const isCollapsed = this.collapsed && collapsible === "icon";

        return html`
            <aside
                ref=${this.sidebarRef}
                class=${classMap({
                    "cs-sidebar": true,
                    "flex flex-col h-full bg-sidebar border-r border transition-all duration-300 ease-in-out": true,
                    "cs-sidebar--collapsed": this.collapsed,
                    "cs-sidebar--icon-rail": isCollapsed,
                    "-translate-x-full": isHidden,
                })}
                style="width:${railWidth};min-width:${railWidth};"
            >
                <!-- Header / brand -->
                <div class=${classMap({
                    "cs-sidebar__header flex items-center gap-2 border-b border shrink-0": true,
                    "flex-col py-3 px-0 h-auto": isCollapsed,
                    "px-4 h-14": !isCollapsed,
                })}>
                    ${isCollapsed
                        ? html`<span class="w-8 h-8 rounded-md bg-primary text-primary-foreground inline-flex items-center justify-center text-sm font-bold shrink-0">${(title || "M").charAt(0)}</span>`
                        : html`<span class="text-sm font-semibold text-foreground truncate flex-1">${title}</span>`}
                    <button
                        type="button"
                        class="cs-sidebar__toggle w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer border-none bg-transparent text-muted-foreground shrink-0"
                        aria-label=${this.collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        @click=${() => this.toggleCollapse()}
                    >
                        <span class="inline-flex items-center justify-center [&_svg]:size-4">${component(Icon, { name: "hamburger-menu", size: 16 })}</span>
                    </button>
                </div>

                <!-- Nav -->
                <nav class="cs-sidebar__nav flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
                    ${items.map((item, i) => this.renderItem(item, i))}
                </nav>

                <!-- Footer slot: agnostic. The group + is-collapsed class lets
                     slotted content adapt to the icon rail via Tailwind group variants. -->
                ${footer != null
                    ? html`<div class=${classMap({
                          "cs-sidebar__footer group border-t border p-2 shrink-0": true,
                          "is-collapsed": isCollapsed,
                      })}>${footer}</div>`
                    : null}
            </aside>
        `;
    }

    private renderItem(item: SidebarItem, index: number) {
        const { collapsible = "icon" } = this.props;
        const isCollapsed = this.collapsed && collapsible === "icon";
        const hasChildren = !!(item.children && item.children.length);
        const expanded = !!this.expandedGroups[String(index)];

        // Leaf link.
        const linkClasses = classMap({
            "cs-sidebar__link": true,
            "flex items-center gap-2.5 rounded-md text-sm transition-colors cursor-pointer": true,
            "bg-primary/10 text-primary font-medium": !!item.active,
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground": !item.active,
            "px-3 py-2": !isCollapsed,
            "justify-center px-0 py-2": isCollapsed,
        });

        const iconMarkup = item.icon
            ? html`<span class="cs-sidebar__icon w-4 h-4 shrink-0 inline-flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" stroke-width="1.5"/>
                  </svg>
              </span>`
            : html`<span class="w-4 h-4 shrink-0"></span>`;

        if (isCollapsed) {
            // Icon-only rail: show just the icon, no labels/groups.
            return html`
                <a
                    href=${item.href || "#"}
                    class=${linkClasses}
                    title=${item.label}
                    @click=${(e: MouseEvent) => this.handleClick(e, item)}
                >${iconMarkup}</a>
            `;
        }

        if (hasChildren) {
            return html`
                <div class="cs-sidebar__group">
                    <button
                        type="button"
                        class=${classMap({
                            "cs-sidebar__group-trigger": true,
                            "w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors cursor-pointer border-none": true,
                            "text-muted-foreground hover:bg-accent hover:text-accent-foreground": true,
                            "text-foreground": expanded,
                        })}
                        @click=${() => this.toggleGroup(index)}
                    >
                        ${iconMarkup}
                        <span class="flex-1 text-left truncate">${item.label}</span>
                        <span
                            class=${classMap({
                                "cs-sidebar__chevron w-3.5 h-3.5 text-muted-foreground transition-transform inline-flex items-center justify-center [&_svg]:size-3.5": true,
                                "rotate-90": expanded,
                            })}
                        >${component(Icon, { name: "alt-arrow-right", size: 16 })}</span>
                    </button>
                    ${expanded
                        ? html`<div class="cs-sidebar__group-items ml-4 mt-0.5 space-y-0.5 border-l pl-2">
                              ${item.children!.map((child) => html`
                                  <a
                                      href=${child.href || "#"}
                                      class=${classMap({
                                          "cs-sidebar__sublink": true,
                                          "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors cursor-pointer": true,
                                          "bg-primary/10 text-primary font-medium": !!child.active,
                                          "text-muted-foreground hover:bg-accent hover:text-accent-foreground": !child.active,
                                      })}
                                      @click=${(e: MouseEvent) => this.handleClick(e, child)}
                                  >${child.label}</a>
                              `)}
                          </div>`
                        : null}
                </div>
            `;
        }

        return html`
            <a
                href=${item.href || "#"}
                class=${linkClasses}
                @click=${(e: MouseEvent) => this.handleClick(e, item)}
            >
                ${iconMarkup}
                <span class="flex-1 truncate">${item.label}</span>
            </a>
        `;
    }

    @Client()
    private toggleCollapse() {
        this.collapsed = !this.collapsed;
    }

    @Client()
    private toggleGroup(index: number) {
        const key = String(index);
        const next = { ...this.expandedGroups };
        next[key] = !next[key];
        this.expandedGroups = next;
    }

    @Client()
    private handleClick(e: MouseEvent, item: SidebarItem) {
        // Let the native link work for accessibility; only intercept if onNavigate.
        if (this.props.onNavigate) {
            e.preventDefault();
            this.props.onNavigate(item);
        }
    }
}
