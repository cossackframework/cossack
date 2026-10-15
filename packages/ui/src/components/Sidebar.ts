import { html, component, repeat, IfDefinedResult, PreventDefaultResult, preventDefault } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client } from '@cossackframework/core';
import { Icon } from '../icons/Icon';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import { HamburgerMenuIcon } from '@cossackframework/solar-icons/hamburger-menu';
import type { GlobalAttributes, AnchorAttributes, ControlEvent } from '../native-attributes';
import { ControlledValue } from '../native-attributes';

export type SidebarLinkProps = Omit<AnchorAttributes, 'href' | 'role' | 'tabindex' | 'aria-current' | 'aria-label' | 'aria-labelledby'>;
type SidebarItemBase = { value: string; label: string; icon?: IconEntry; active?: boolean; linkProps?: SidebarLinkProps };
export type SidebarLinkItem = SidebarItemBase & { href: string; children?: never };
export type SidebarGroupItem = SidebarItemBase & { children: readonly SidebarItem[]; href?: string };
export type SidebarItem = SidebarLinkItem | SidebarGroupItem;
export type SidebarNavProps = Omit<GlobalAttributes<HTMLElement>, 'id' | 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby'>;
export type SidebarProps = Omit<GlobalAttributes<HTMLElement>, 'id' | 'role' | 'hidden' | '?hidden' | 'inert' | '?inert' | 'aria-hidden'> & {
    id: string;
    /** Accessible navigation name. */
    label: string;
    items?: readonly SidebarItem[];
    navProps?: SidebarNavProps;
    /** Visual brand text; brand replaces it when supplied. */
    title?: string;
    brand?: unknown;
    footer?: unknown;
    /** Caller-owned collapsed state. */
    collapsed?: boolean;
    width?: string;
    /** Handles ordinary same-origin HTTP(S) clicks after native link listeners. */
    onNavigate?: (item: SidebarItem, event: ControlEvent<HTMLAnchorElement, MouseEvent>) => unknown;
    /** Proposes the next collapsed state. Omit to hide the built-in toggle. */
    onCollapsedChange?: (collapsed: boolean) => unknown;
    expandLabel?: string;
    collapseLabel?: string;
} & ({ collapsible?: 'icon'; restoreFocusTo?: never } | {
    collapsible: 'offcanvas';
    /** ID of an external focusable opener. The caller owns its expanded state. */
    restoreFocusTo: string;
});

function sidebarListener(supplied: unknown, own: (event: Event) => void) {
    const listener: EventListener = event => {
        if (typeof supplied === 'function') supplied(event);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) own(event);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** Named navigation using native links and details/summary disclosures, not menu roles. */
@Component()
export class Sidebar extends Cossack {
    declare props: SidebarProps;
    @ClientState() private expandedGroups: Record<string, boolean> = {};
    private rootElement?: HTMLElement;
    private focusRepair?: { element: HTMLElement; value?: string };
    private generation = 0;
    private controlled = new ControlledValue<boolean>();

    private hasActive(item: SidebarItem): boolean { return !!item.active || !!item.children?.some(child => this.hasActive(child)); }
    private isExpanded(item: SidebarItem) {
        return Object.hasOwn(this.expandedGroups, item.value) ? this.expandedGroups[item.value] : this.hasActive(item);
    }
    /** Collapsed state the next toggle builds on, including a proposal the parent has not rendered yet. */
    private collapsedBase() { return this.controlled.base(this.props, !!this.props.collapsed); }
    private propose(collapsed: boolean) { this.props.onCollapsedChange?.(this.controlled.emit(this.props, collapsed)); }
    private validate() {
        const p = this.props;
        if (typeof p.id !== 'string' || !p.id || /\s/.test(p.id)) throw new Error('Sidebar requires a nonempty id without whitespace.');
        if (typeof p.label !== 'string' || !p.label.trim()) throw new Error('Sidebar requires a nonempty navigation label.');
        if (p.collapsible !== undefined && p.collapsible !== 'icon' && p.collapsible !== 'offcanvas') throw new Error('Sidebar collapsible must be icon or offcanvas.');
        if (p.collapsed !== undefined && typeof p.collapsed !== 'boolean') throw new Error('Sidebar collapsed must be boolean.');
        if (p.collapsible === 'offcanvas' && (typeof p.restoreFocusTo !== 'string' || !p.restoreFocusTo || /\s/.test(p.restoreFocusTo) || p.restoreFocusTo === p.id)) throw new Error('Sidebar offcanvas requires an external restoreFocusTo ID.');
        for (const name of ['width', 'expandLabel', 'collapseLabel'] as const) if (p[name] !== undefined && (typeof p[name] !== 'string' || !p[name]?.trim())) throw new Error(`Sidebar ${name} must be a nonempty string.`);
        for (const name of ['onCollapsedChange', 'onNavigate'] as const) if (p[name] !== undefined && typeof p[name] !== 'function') throw new Error(`Sidebar ${name} must be a function.`);
        const values = new Set<string>();
        const visit = (items: readonly SidebarItem[]) => {
            if (!Array.isArray(items)) throw new Error('Sidebar items and children must be arrays.');
            for (const item of items) {
                if (!item || typeof item.value !== 'string' || !item.value.trim() || values.has(item.value)) throw new Error('Sidebar item values must be nonempty and globally unique.');
                values.add(item.value);
                if (typeof item.label !== 'string' || !item.label.trim()) throw new Error('Sidebar items require nonempty labels.');
                if (item.active !== undefined && typeof item.active !== 'boolean') throw new Error('Sidebar active must be boolean.');
                if (item.href !== undefined && (typeof item.href !== 'string' || !item.href.trim())) throw new Error('Sidebar href must be a nonempty string.');
                if (item.children !== undefined) { if (!Array.isArray(item.children) || !item.children.length) throw new Error('Sidebar groups require children.'); visit(item.children); }
                else if (!item.href) throw new Error('Sidebar links require href.');
                if (item.linkProps && !item.href) throw new Error('Sidebar linkProps require href.');
            }
        };
        visit(p.items === undefined ? [] : p.items);
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('Sidebar uses items, brand and footer, not children.');
    }
    private connect(element: Element) {
        this.rootElement = element as HTMLElement;
        const generation = this.generation;
        queueMicrotask(() => {
            const root = this.rootElement, repair = this.focusRepair; this.focusRepair = undefined;
            if (generation !== this.generation || !root?.isConnected || !repair || root.hasAttribute('inert')) return;
            const active = root.ownerDocument.activeElement;
            if (active !== repair.element && active !== root.ownerDocument.body) return;
            const visible = (el: HTMLElement) => el.isConnected && !!el.getClientRects().length && !el.closest('[inert],[hidden]');
            const retained = visible(repair.element) ? repair.element : undefined;
            const row = Array.from(root.querySelectorAll<HTMLElement>('[data-sidebar-value]')).find(el => el.dataset.sidebarValue === repair.value);
            const replacement = row?.querySelector<HTMLElement>(':scope > a, :scope > details > summary');
            (retained ?? (replacement && visible(replacement) ? replacement : undefined) ?? root.querySelector<HTMLElement>('.cs-sidebar__toggle') ?? root.querySelector<HTMLElement>('nav'))?.focus({preventScroll:true});
        });
    }
    render() {
        this.validate();
        const { id, label, items = [], title = '', brand, footer, collapsed = false, collapsible = 'icon',
            restoreFocusTo, width = '260px', navProps, onCollapsedChange, onNavigate: _navigate,
            expandLabel = 'Expand navigation', collapseLabel = 'Collapse navigation', style, '@keydown': keydown, ...rest } = this.props;
        const rail = collapsed && collapsible === 'icon', hidden = collapsed && collapsible === 'offcanvas';
        const active = this.rootElement?.ownerDocument.activeElement as HTMLElement | null | undefined;
        if (active && this.rootElement?.contains(active)) {
            if (hidden) {
                const target = this.rootElement.ownerDocument.getElementById(restoreFocusTo!);
                if (!target || this.rootElement.contains(target)) throw new Error('Sidebar restoreFocusTo must identify a focusable external opener.');
                target.focus({preventScroll:true});
                if (this.rootElement.ownerDocument.activeElement !== target) throw new Error('Sidebar restoreFocusTo opener is not focusable.');
            } else this.focusRepair = {element:active,value:active.closest<HTMLElement>('[data-sidebar-value]')?.dataset.sidebarValue};
        }
        const suppliedStyle = style instanceof IfDefinedResult ? style.value : style;
        const dimensions = `width:${rail ? '72px' : width};min-width:${rail ? '72px' : width};${typeof suppliedStyle === 'string' ? suppliedStyle : ''}${hidden ? ';display:none!important;' : ''}`;
        return html`<aside id=${id} class=${`cs-sidebar group flex flex-col min-h-screen bg-sidebar border-e border transition-[width,min-width] motion-reduce:transition-none duration-300 ${collapsed ? 'cs-sidebar--collapsed' : ''} ${rail ? 'cs-sidebar--icon-rail is-collapsed' : ''}`}
            style=${dimensions} ...=${{...rest,'@keydown':sidebarListener(keydown,event=>this.keydown(event as KeyboardEvent))}}
            ?hidden=${hidden} ?inert=${hidden} aria-hidden=${hidden ? 'true' : 'false'} ref=${(el:Element)=>this.connect(el)}>
            <div class=${`cs-sidebar__header group flex items-center gap-2 border-b shrink-0 ${rail ? 'flex-col py-3 px-0' : 'px-4 h-14'}`}>
                ${brand != null ? html`<div class="cs-sidebar__brand flex-1 min-w-0">${brand}</div>` : html`<span class=${rail ? 'sr-only' : 'text-sm font-semibold truncate flex-1'}>${title}</span>`}
                ${onCollapsedChange ? html`<button type="button" class="cs-sidebar__toggle size-7 inline-flex items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label=${collapsed ? expandLabel : collapseLabel} aria-expanded=${!collapsed} aria-controls=${`${id}-nav`}
                    @click=${()=>this.propose(!this.collapsedBase())}><span aria-hidden="true">${component(Icon,{entry:HamburgerMenuIcon,size:16})}</span></button>` : null}
            </div>
            <nav ...=${navProps} id=${`${id}-nav`} aria-label=${label} tabindex="-1" class="cs-sidebar__nav flex-1 overflow-y-auto py-2 px-2"><ul class="space-y-0.5">${repeat(items,item=>item.value,item=>this.renderItem(item,rail))}</ul></nav>
            ${footer != null ? html`<div class=${`cs-sidebar__footer group border-t p-2 shrink-0 ${rail ? 'is-collapsed' : ''}`}>${footer}</div>` : null}
        </aside>`;
    }
    private icon(item: SidebarItem, rail: boolean) {
        return html`<span aria-hidden="true" class="cs-sidebar__icon w-4 h-4 shrink-0 inline-flex items-center justify-center">${item.icon ? component(Icon,{entry:item.icon,size:16}) : rail ? Array.from(item.label.trim())[0] : null}</span>`;
    }
    private link(item: SidebarItem, rail: boolean) {
        const { '@click': supplied, ...props } = item.linkProps ?? {};
        return html`<a ...=${{...props,'@click':sidebarListener(supplied,event=>this.handleLinkNavigation(event as MouseEvent,item))}} href=${item.href}
            aria-current=${item.active ? 'page' : undefined} title=${props.title ?? (rail ? item.label : undefined)}
            class=${`cs-sidebar__link flex items-center gap-2.5 rounded-md text-sm transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring ${item.active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent'} ${rail ? 'justify-center px-0 py-2' : 'px-3 py-2'}`}>
            ${this.icon(item,rail)}<span class=${rail ? 'sr-only' : 'flex-1 truncate'}>${item.label}</span></a>`;
    }
    private renderItem(item: SidebarItem, rail: boolean): unknown {
        const panelId = `${this.props.id}-group-${encodeURIComponent(item.value)}`;
        return html`<li data-sidebar-value=${item.value}>${item.children ? html`<details class="cs-sidebar__group" ?open=${this.isExpanded(item)}>
            <summary class=${`cs-sidebar__group-trigger list-none [&::-webkit-details-marker]:hidden flex items-center gap-2.5 rounded-md text-sm cursor-pointer hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${rail ? 'justify-center py-2' : 'px-3 py-2'}`}
                title=${rail ? item.label : undefined} aria-controls=${panelId} @click=${(event:MouseEvent)=>this.toggleGroup(event,item)}>
                ${this.icon(item,rail)}<span class=${rail ? 'sr-only' : 'flex-1 text-start truncate'}>${item.label}</span><span aria-hidden="true" class=${rail ? 'sr-only' : 'text-xs'}>${this.isExpanded(item) ? '−' : '+'}</span>
            </summary><div id=${panelId} class=${`cs-sidebar__group-items ${rail ? '' : 'ms-4 border-s ps-2'}`}>
                ${item.href ? this.link(item,rail) : null}<ul>${repeat(item.children,child=>child.value,child=>this.renderItem(child,rail))}</ul>
            </div></details>` : this.link(item,rail)}</li>`;
    }
    @Client()
    private toggleGroup(event: MouseEvent, item: SidebarItem) {
        if (event.defaultPrevented) return;
        event.preventDefault();
        const summary = event.currentTarget as HTMLElement, details = summary.parentElement as HTMLDetailsElement;
        const next = !details.open;
        if (!next && details.contains(details.ownerDocument.activeElement)) summary.focus();
        details.open = next;
        this.expandedGroups = {...this.expandedGroups,[item.value]:next};
    }
    @Client()
    private keydown(event: KeyboardEvent) {
        if (event.defaultPrevented || event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target as Element;
        const details = target.closest<HTMLDetailsElement>('details[open]');
        if (details && this.rootElement?.contains(details)) {
            const row = details.parentElement;
            const value = row?.dataset.sidebarValue;
            if (value !== undefined) { event.preventDefault(); details.querySelector<HTMLElement>(':scope > summary')?.focus(); details.open=false; this.expandedGroups={...this.expandedGroups,[value]:false}; }
        } else if (this.props.collapsible === 'offcanvas' && !this.collapsedBase() && this.props.onCollapsedChange) { event.preventDefault(); this.propose(true); }
    }
    @Client()
    private handleLinkNavigation(event: MouseEvent, item: SidebarItem) {
        if (!this.props.onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = event.currentTarget as HTMLAnchorElement;
        const target = anchor.target || anchor.ownerDocument.querySelector('base[target]')?.getAttribute('target') || '';
        if ((target && target.toLowerCase() !== '_self') || anchor.hasAttribute('download')) return;
        const url = new URL(anchor.href,anchor.ownerDocument.baseURI);
        if (!['http:','https:'].includes(url.protocol) || url.origin !== anchor.ownerDocument.location?.origin) return;
        event.preventDefault(); this.props.onNavigate(item,event as ControlEvent<HTMLAnchorElement,MouseEvent>);
    }
    onCleanup() { this.generation++; this.rootElement=undefined; this.focusRepair=undefined; }
}
