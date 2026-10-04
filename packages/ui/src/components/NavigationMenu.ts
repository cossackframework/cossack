import { html, component, repeat, PreventDefaultResult, preventDefault, type nothing } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes, ButtonAttributes, AnchorAttributes, ControlEvent } from '../native-attributes';
import { Icon } from '../icons/Icon';
import { AltArrowDownIcon as altArrowDownIcon } from '@cossackframework/solar-icons/alt-arrow-down';

export type NavigationMenuTriggerProps = Omit<ButtonAttributes, 'id' | 'type' | 'role' | 'tabindex' | 'disabled' | '?disabled' | 'aria-label' | 'aria-labelledby' | 'aria-expanded' | 'aria-controls' | 'aria-haspopup' | 'popovertarget' | 'popovertargetaction'>;
export type NavigationMenuPanelProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'tabindex' | 'hidden' | '?hidden' | 'inert' | '?inert' | 'aria-hidden' | 'aria-modal'>;
export type NavigationMenuLinkProps = Omit<AnchorAttributes, 'href' | 'role' | 'tabindex'>;
export type NavigationMenuLink = {
    value: string;
    label: string;
    href: string;
    description?: string;
    linkProps?: NavigationMenuLinkProps;
};
export type NavigationMenuSection = {
    value: string;
    label: string;
    disabled?: boolean;
    items?: readonly NavigationMenuLink[];
    triggerProps?: NavigationMenuTriggerProps;
    panelProps?: NavigationMenuPanelProps;
};
export type NavigationMenuProps = Omit<GlobalAttributes<HTMLElement>, 'id' | 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby'> & {
    id: string;
    label: string;
    sections?: readonly NavigationMenuSection[];
    disabled?: boolean;
    trigger?: 'hover' | 'click';
    hoverDelay?: number;
    closeDelay?: number;
};
type NavigationEntry = {
    button?: HTMLButtonElement; panel?: HTMLDivElement; wrapper?: HTMLLIElement;
    links: Map<string, HTMLAnchorElement>; overButton: boolean; overPanel: boolean; dismissed: boolean;
};
type NavigationTimer = { value: string; timer: ReturnType<typeof setTimeout> };
type NavigationListener<E extends Event> = ((event: E) => unknown) | PreventDefaultResult | null | typeof nothing | undefined;
function navigationEvent<E extends Event>(supplied: NavigationListener<E>, own: (event: E) => void) {
    const listener: EventListener = event => {
        if (typeof supplied === 'function') supplied(event as E);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) own(event as E);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** Named navigation with disclosure buttons and native links. Hover never takes keyboard focus. */
@Component()
export class NavigationMenu extends Cossack {
    declare props: NavigationMenuProps;
    private root?: HTMLElement;
    private connectedRoot?: HTMLElement;
    private entries = new Map<string, NavigationEntry>();
    private opening?: NavigationTimer;
    private closing?: NavigationTimer;
    private cleanup?: () => void;
    private resize?: ResizeObserver;
    private disabledObserver?: MutationObserver;
    private generation = 0;
    private changingFocus = false;
    private repairFocus?: { element: HTMLElement; value?: string; panel: boolean };

    private entry(value: string) {
        let entry = this.entries.get(value);
        if (!entry) { entry = { links: new Map(), overButton: false, overPanel: false, dismissed: false }; this.entries.set(value, entry); }
        return entry;
    }
    private expanded(entry?: NavigationEntry) { return !!entry?.panel?.matches(':popover-open'); }
    private unavailable(value: string) {
        const section = this.props.sections?.find(item => item.value === value), entry = this.entries.get(value);
        return !section || !!this.props.disabled || !!section.disabled || !!entry?.button?.matches(':disabled');
    }
    private triggers() { return (this.props.sections ?? []).map(section => this.entries.get(section.value)?.button).filter((button): button is HTMLButtonElement => !!button?.isConnected && !button.matches(':disabled')); }
    private links(value: string) {
        const entry = this.entries.get(value), section = this.props.sections?.find(item => item.value === value);
        return (section?.items ?? []).map(item => entry?.links.get(item.value)).filter((link): link is HTMLAnchorElement => !!link?.isConnected && link.getClientRects().length > 0 && !link.closest('[hidden],[inert]'));
    }
    private owner(target: Node | null) { return [...this.entries].find(([,entry]) => !!target && !!entry.wrapper?.contains(target)); }
    private cancelOpening(value?: string) { if (this.opening && (value === undefined || value === this.opening.value)) { clearTimeout(this.opening.timer); this.opening = undefined; } }
    private cancelClosing(value?: string) { if (this.closing && (value === undefined || value === this.closing.value)) { clearTimeout(this.closing.timer); this.closing = undefined; } }
    private close(value: string, restore = true, dismiss = false) {
        const entry = this.entries.get(value); if (!entry) return;
        this.cancelOpening(value); this.cancelClosing(value);
        if (dismiss) entry.dismissed = entry.overButton || entry.overPanel;
        const owned = !!entry.panel?.contains(entry.panel.ownerDocument.activeElement);
        if (entry.panel?.isConnected && this.expanded(entry)) entry.panel.hidePopover();
        entry.button?.setAttribute('aria-expanded', 'false');
        if (restore && owned) (entry.button?.isConnected && !entry.button.matches(':disabled') ? entry.button : this.triggers()[0] ?? this.root)?.focus({ preventScroll: true });
    }
    private closeAll(restore = false, dismiss = false) { this.cancelOpening(); this.cancelClosing(); for (const value of this.entries.keys()) this.close(value, restore, dismiss); }
    private pointerBlocked(entry: NavigationEntry) {
        const active = this.root?.ownerDocument.activeElement;
        const popup = active instanceof Element ? active.closest('[popover]:popover-open,dialog:modal') : null;
        return !!popup && popup !== entry.panel && !popup.contains(entry.button ?? null);
    }
    private show(value: string, pointer = false) {
        const entry = this.entries.get(value), document = this.root?.ownerDocument;
        if (!entry?.button?.isConnected || !entry.panel?.isConnected || this.unavailable(value) || !document) return;
        if (pointer && (entry.dismissed || this.pointerBlocked(entry))) return;
        this.cancelOpening(); this.cancelClosing(value);
        for (const key of this.entries.keys()) if (key !== value) this.close(key, false);
        if (!pointer) entry.dismissed = false;
        const previous = document.activeElement;
        this.changingFocus = true;
        try {
            if (!this.expanded(entry)) entry.panel.showPopover({ source: entry.button });
            entry.button.setAttribute('aria-expanded', String(this.expanded(entry)));
            // Authored autofocus must not turn opening into a focus move or blur dismissal.
            if (previous instanceof HTMLElement && entry.panel.contains(document.activeElement) && !entry.panel.contains(previous)) {
                if (previous === document.body) (document.activeElement as HTMLElement).blur();
                else previous.focus({ preventScroll: true });
            }
        } finally { this.changingFocus = false; }
        this.position();
    }
    private enter(value: string, panel: boolean, event: PointerEvent) {
        if (event.pointerType === 'touch') return;
        const entry = this.entry(value);
        if (panel) entry.overPanel = true; else entry.overButton = true;
        this.cancelClosing(value);
        if (panel || this.props.trigger === 'click' || entry.dismissed || this.unavailable(value) || this.pointerBlocked(entry)) return;
        this.cancelOpening();
        this.opening = { value, timer: setTimeout(() => { this.opening = undefined; if (entry.overButton && this.props.trigger !== 'click') this.show(value, true); }, this.props.hoverDelay ?? 100) };
    }
    private leave(value: string, panel: boolean) {
        const entry = this.entries.get(value); if (!entry) return;
        if (panel) entry.overPanel = false; else entry.overButton = false;
        if (entry.overButton || entry.overPanel) return;
        entry.dismissed = false; this.cancelOpening(value);
        if (this.props.trigger === 'click') return;
        this.cancelClosing();
        this.closing = { value, timer: setTimeout(() => {
            this.closing = undefined;
            if (!entry.overButton && !entry.overPanel && !entry.wrapper?.contains(entry.panel?.ownerDocument.activeElement ?? null)) this.close(value, false);
        }, this.props.closeDelay ?? 150) };
    }
    private keydown(event: KeyboardEvent) {
        if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'Escape') {
            if (this.opening || [...this.entries.values()].some(entry => this.expanded(entry))) { event.preventDefault(); this.closeAll(true, true); }
            return;
        }
        const owned = this.owner(event.target as Node); if (!owned) return;
        const [value, entry] = owned, target = event.target as HTMLElement;
        if (target === entry.button) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); this.show(value);
                if (this.expanded(entry)) ((event.key === 'ArrowDown' ? this.links(value)[0] : this.links(value).at(-1)) ?? entry.panel)?.focus();
            } else if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
                event.preventDefault(); const buttons = this.triggers(), index = buttons.indexOf(target as HTMLButtonElement);
                const rtl = this.root?.ownerDocument.defaultView?.getComputedStyle(this.root).direction === 'rtl';
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + ((event.key === 'ArrowRight') !== !!rtl ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
            }
        } else if (entry.panel?.contains(target) && ['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
            event.preventDefault(); const links = this.links(value), index = links.indexOf(target as HTMLAnchorElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
            (links[next] ?? entry.panel).focus();
        }
    }
    private reconcile() {
        for (const [value] of this.entries) if (this.unavailable(value)) this.close(value);
        this.position();
    }
    private connect(root: HTMLElement) {
        this.root = root; const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || !root.isConnected) return;
            if (this.connectedRoot !== root) {
                this.cleanup?.(); this.connectedRoot = root;
                const document = root.ownerDocument, window = document.defaultView;
                const position = () => this.position(), escape = (event: KeyboardEvent) => { if (event.key === 'Escape') this.keydown(event); };
                const outside = (event: PointerEvent) => { if (!event.defaultPrevented && !root.contains(event.target as Node)) this.closeAll(false, true); };
                this.resize = new ResizeObserver(position); this.disabledObserver = new MutationObserver(() => this.reconcile());
                document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside); document.addEventListener('scroll', position, true);
                window?.addEventListener('resize', position); window?.visualViewport?.addEventListener('resize', position); window?.visualViewport?.addEventListener('scroll', position);
                this.cleanup = () => {
                    document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', position, true);
                    window?.removeEventListener('resize', position); window?.visualViewport?.removeEventListener('resize', position); window?.visualViewport?.removeEventListener('scroll', position);
                    this.resize?.disconnect(); this.disabledObserver?.disconnect();
                };
            }
            this.resize?.disconnect(); this.disabledObserver?.disconnect(); this.resize?.observe(root);
            for (const entry of this.entries.values()) {
                if (entry.button) { this.resize?.observe(entry.button); this.disabledObserver?.observe(entry.button, { attributes: true, attributeFilter: ['disabled'] }); }
                if (entry.panel) this.resize?.observe(entry.panel);
            }
            for (let parent = root.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'FIELDSET') this.disabledObserver?.observe(parent, { attributes: true, attributeFilter: ['disabled'] });
            this.reconcile();
            const previous = this.repairFocus; this.repairFocus = undefined;
            if (!previous || (root.ownerDocument.activeElement !== previous.element && root.ownerDocument.activeElement !== root.ownerDocument.body)) return;
            const entry = this.entries.get(previous.value ?? '');
            if (previous.element.isConnected && !previous.element.matches(':disabled') && (!previous.panel || this.expanded(entry))) previous.element.focus({ preventScroll: true });
            else if (previous.panel && this.expanded(entry)) (this.links(previous.value!)[0] ?? entry?.panel)?.focus({ preventScroll: true });
            else (entry?.button?.isConnected && !entry.button.matches(':disabled') ? entry.button : this.triggers()[0] ?? root).focus({ preventScroll: true });
        });
    }
    private position() {
        for (const entry of this.entries.values()) {
            const panel = entry.panel, button = entry.button, window = panel?.ownerDocument.defaultView;
            if (!panel?.isConnected || !button?.isConnected || !window || !this.expanded(entry)) continue;
            const viewport = window.visualViewport, gap = 8, x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
            const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
            Object.assign(panel.style, { position: 'fixed', inset: 'auto', margin: '0', boxSizing: 'border-box', maxWidth: `${Math.max(0,width-gap*2)}px`, maxHeight: `${Math.max(0,height-gap*2)}px`, overflow: 'auto' });
            const rect = button.getBoundingClientRect(), rtl = window.getComputedStyle(button).direction === 'rtl';
            const above = y+height-rect.bottom-gap < panel.offsetHeight && rect.top-y > y+height-rect.bottom;
            const left = rtl ? rect.right-panel.offsetWidth : rect.left, top = above ? rect.top-panel.offsetHeight-gap : rect.bottom+gap;
            panel.style.left = `${Math.max(x+gap,Math.min(left,x+width-panel.offsetWidth-gap))}px`;
            panel.style.top = `${Math.max(y+gap,Math.min(top,y+height-panel.offsetHeight-gap))}px`;
            panel.dataset.side = above ? 'top' : 'bottom';
        }
    }
    render() {
        const { id, label, sections = [], disabled: _disabled, trigger = 'hover', hoverDelay = 100, closeDelay = 150, '@keydown': suppliedKey, '@focusin': suppliedFocus, '@focusout': suppliedBlur, ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id) || typeof label !== 'string' || !label.trim()) throw new Error('NavigationMenu requires a stable id and nonempty label.');
        if (!['hover','click'].includes(trigger) || [hoverDelay,closeDelay].some(value => !Number.isInteger(value) || value < 0 || value > 60000)) throw new Error('NavigationMenu requires hover/click mode and integer delays from 0 to 60000.');
        const values = new Set<string>();
        for (const section of sections) {
            if (typeof section.value !== 'string' || !section.value || values.has(section.value) || typeof section.label !== 'string' || !section.label.trim()) throw new Error('NavigationMenu sections require unique values and nonempty text labels.');
            values.add(section.value); const links = new Set<string>();
            for (const link of section.items ?? []) {
                if (typeof link.value !== 'string' || !link.value || links.has(link.value) || typeof link.label !== 'string' || !link.label.trim() || typeof link.href !== 'string' || !link.href.trim() || link.description !== undefined && typeof link.description !== 'string') throw new Error('NavigationMenu links require unique values, text labels and nonempty hrefs.');
                links.add(link.value);
            }
            const entry = this.entry(section.value);
            for (const key of entry.links.keys()) if (!links.has(key)) entry.links.delete(key);
        }
        const active = this.root?.ownerDocument.activeElement;
        if (active && this.root?.contains(active)) { const owned = this.owner(active); this.repairFocus = { element: active as HTMLElement, value: owned?.[0], panel: !!owned?.[1].panel?.contains(active) }; }
        for (const key of this.entries.keys()) if (!values.has(key)) { this.close(key, false); this.entries.delete(key); }
        if (trigger === 'click') { this.cancelOpening(); this.cancelClosing(); }
        return html`<nav ref=${(element: Element) => this.connect(element as HTMLElement)} id=${id} aria-label=${label} tabindex="-1" class="cs-navigation-menu relative z-10" ...=${{ ...rest,
            '@keydown': navigationEvent<ControlEvent<HTMLElement,KeyboardEvent>>(suppliedKey, event => this.keydown(event)),
            '@focusin': navigationEvent<ControlEvent<HTMLElement,FocusEvent>>(suppliedFocus, event => { if (this.changingFocus) return; const owned = this.owner(event.target as Node); if (owned) { this.cancelOpening(); this.cancelClosing(owned[0]); for (const value of this.entries.keys()) if (value !== owned[0]) this.close(value, false); } }),
            '@focusout': navigationEvent<ControlEvent<HTMLElement,FocusEvent>>(suppliedBlur, event => {
                // Native Tab can checkpoint microtasks before focusin. Do not hide its destination.
                if (this.changingFocus || (event.relatedTarget instanceof Node && this.root?.contains(event.relatedTarget))) return;
                const generation = this.generation;
                queueMicrotask(() => { if (generation === this.generation && this.root && !this.root.contains(this.root.ownerDocument.activeElement)) this.closeAll(); });
            }),
        }}><ul class="flex items-center gap-1 list-none m-0 p-0">
            ${repeat(sections, section => section.value, section => {
                const entry = this.entry(section.value), buttonProps = section.triggerProps ?? {}, panelProps = section.panelProps ?? {};
                const buttonId = `${id}-trigger-${encodeURIComponent(section.value)}`, panelId = `${id}-panel-${encodeURIComponent(section.value)}`;
                return html`<li ref=${(element: Element) => { entry.wrapper = element as HTMLLIElement; }} class="cs-navigation-menu__section relative inline-flex">
                    <button ref=${(element: Element) => { entry.button = element as HTMLButtonElement; }} id=${buttonId} type="button" aria-expanded=${String(this.expanded(entry))} aria-controls=${panelId} popovertarget=${panelId} popovertargetaction="toggle" ?disabled=${!!this.props.disabled || !!section.disabled}
                        class="cs-navigation-menu__trigger group px-3 py-2 text-sm font-medium rounded-md cursor-pointer border-none inline-flex items-center bg-transparent text-muted-foreground hover:bg-accent aria-expanded:bg-accent aria-expanded:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        ...=${{ ...buttonProps,
                            '@click': navigationEvent<ControlEvent<HTMLButtonElement,PointerEvent>>(buttonProps['@click'], event => { event.preventDefault(); if (this.expanded(entry)) this.close(section.value,true,true); else this.show(section.value); }),
                            '@pointerenter': navigationEvent<ControlEvent<HTMLButtonElement,PointerEvent>>(buttonProps['@pointerenter'], event => this.enter(section.value,false,event)),
                            '@pointerleave': navigationEvent<ControlEvent<HTMLButtonElement,PointerEvent>>(buttonProps['@pointerleave'], () => this.leave(section.value,false)),
                        }}>${section.label}<span aria-hidden="true" class="ml-1 inline-flex transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none">${component(Icon,{entry:altArrowDownIcon,size:16})}</span></button>
                    <div ref=${(element: Element) => { entry.panel = element as HTMLDivElement; }} id=${panelId} popover="auto" tabindex="-1" class="cs-navigation-menu__panel cs-nav-popover bg-popover text-popover-foreground border rounded-lg shadow-lg p-2 min-w-[200px] outline-none"
                        ...=${{ ...panelProps,
                            '@toggle': navigationEvent<ControlEvent<HTMLDivElement,ToggleEvent>>(panelProps['@toggle'], () => { entry.button?.setAttribute('aria-expanded',String(this.expanded(entry))); if (this.expanded(entry)) this.position(); else this.cancelClosing(section.value); }),
                            '@pointerenter': navigationEvent<ControlEvent<HTMLDivElement,PointerEvent>>(panelProps['@pointerenter'], event => this.enter(section.value,true,event)),
                            '@pointerleave': navigationEvent<ControlEvent<HTMLDivElement,PointerEvent>>(panelProps['@pointerleave'], () => this.leave(section.value,true)),
                        }}><ul class="list-none m-0 p-0">${repeat(section.items ?? [], item => item.value, item => html`<li><a
                            ref=${(element: Element) => { entry.links.set(item.value,element as HTMLAnchorElement); }} href=${item.href}
                            class="cs-navigation-menu__link block px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                            ...=${{ ...item.linkProps, '@click': navigationEvent<ControlEvent<HTMLAnchorElement,PointerEvent>>(item.linkProps?.['@click'], event => { if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) this.close(section.value); }) }}>
                            <span class="text-sm font-medium text-popover-foreground">${item.label}</span>${item.description ? html`<span class="block text-xs text-muted-foreground mt-0.5">${item.description}</span>` : null}</a></li>`)}</ul></div>
                </li>`;
            })}
        </ul></nav>`;
    }
    onCleanup() { this.generation++; this.closeAll(); this.cleanup?.(); this.cleanup = undefined; this.resize = undefined; this.disabledObserver = undefined; this.connectedRoot = undefined; this.root = undefined; this.repairFocus = undefined; this.entries.clear(); }
}
