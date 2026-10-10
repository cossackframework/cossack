import { html, component, repeat } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes, ButtonAttributes, ControlEvent } from '../native-attributes';
import { MenuController, menuEvent, menuIdentity, renderMenuItems, type MenuItem, type MenuPanelProps } from '../internal/menu';
import { Icon } from '../icons/Icon';
import { AltArrowDownIcon as altArrowDownIcon } from '@cossackframework/solar-icons/alt-arrow-down';

export type MenubarTriggerProps = Omit<ButtonAttributes, 'id' | 'type' | 'role' | 'tabindex' | 'disabled' | '?disabled' | 'aria-disabled' | 'aria-label' | 'aria-labelledby' | 'aria-haspopup' | 'aria-expanded' | 'aria-controls' | 'popovertarget' | 'popovertargetaction'>;
export type MenubarMenu = {
    /** Stable identity within this menubar. Labels can change independently. */
    value: string;
    label: string;
    disabled?: boolean;
    items?: readonly MenuItem[];
    triggerProps?: MenubarTriggerProps;
    menuProps?: Omit<MenuPanelProps, 'aria-label' | 'aria-labelledby'>;
};
export type MenubarProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'tabindex' | 'aria-label' | 'aria-labelledby' | 'aria-orientation'> & {
    id: string;
    label: string;
    menus?: readonly MenubarMenu[];
    disabled?: boolean;
    chevron?: boolean;
};
type MenubarEntry = { menu: MenuController; trigger?: HTMLButtonElement; panel?: HTMLDivElement };

/** Horizontal application actions. Disabled actions remain focusable; navigation links belong in NavigationMenu. */
@Component()
export class Menubar extends Cossack {
    declare props: MenubarProps;
    private root?: HTMLDivElement;
    private entries = new Map<string, MenubarEntry>();
    private lastFocused?: string;
    private repairFocus?: { element: HTMLElement; value?: string; panel: boolean };
    private generation = 0;
    private search = '';
    private searchAt = 0;

    private entry(value: string) {
        let entry = this.entries.get(value);
        if (!entry) {
            entry = { menu: new MenuController(() => ({ disabled: !!this.props.disabled || !!this.props.menus?.find(menu => menu.value === value)?.disabled, side: 'bottom', align: 'start' })) };
            this.entries.set(value, entry);
        }
        return entry;
    }
    private triggers() {
        return (this.props.menus ?? []).map(menu => ({ value: menu.value, trigger: this.entries.get(menu.value)?.trigger }))
            .filter((item): item is { value: string; trigger: HTMLButtonElement } => !!item.trigger?.isConnected && !item.trigger.matches(':disabled'));
    }
    private owner(target: Node | null) {
        return [...this.entries].find(([,entry]) => target === entry.trigger || !!target && !!entry.panel?.contains(target));
    }
    private focusValue(value: string) {
        this.lastFocused = value;
        for (const item of this.triggers()) item.trigger.tabIndex = item.value === value ? 0 : -1;
    }
    private closeAll(restore = false) { for (const { menu } of this.entries.values()) menu.close(restore); }
    private open(value: string, last = false) {
        const entry = this.entries.get(value);
        if (!entry?.trigger?.isConnected || entry.trigger.matches(':disabled') || this.props.disabled || this.props.menus?.find(menu => menu.value === value)?.disabled) return;
        for (const [key, other] of this.entries) if (key !== value) other.menu.close(false);
        this.focusValue(value); entry.menu.open(last);
    }
    private keydown(event: KeyboardEvent) {
        if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        const owned = this.owner(event.target as Node);
        if (!owned) return;
        const [value, entry] = owned, inPanel = !!entry.panel?.contains(event.target as Node);
        const triggers = this.triggers(), index = triggers.findIndex(item => item.value === value);
        if (index < 0) return;
        const rtl = this.root?.ownerDocument.defaultView?.getComputedStyle(this.root).direction === 'rtl';
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const step = (event.key === 'ArrowRight') !== !!rtl ? 1 : -1;
            const next = triggers[(index + step + triggers.length) % triggers.length], wasOpen = entry.menu.expanded;
            this.closeAll(); this.focusValue(next.value); next.trigger.focus();
            if (wasOpen) this.open(next.value);
        } else if (inPanel) entry.menu.key(event);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); this.open(value, event.key === 'ArrowUp');
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault(); this.closeAll();
            const next = event.key === 'Home' ? triggers[0] : triggers.at(-1)!;
            this.focusValue(next.value); next.trigger.focus();
        } else if (event.key === 'Escape' || event.key === 'Tab') this.closeAll();
        else if (event.key.length === 1 && event.key !== ' ') {
            event.preventDefault();
            const now = Date.now(); this.search = now - this.searchAt > 700 ? event.key : this.search + event.key; this.searchAt = now;
            const text = this.search.toLocaleLowerCase(), query = [...text].every(char => char === text[0]) ? text[0] : text;
            const next = [...triggers.slice(index + 1), ...triggers.slice(0,index + 1)].find(item => this.props.menus?.find(menu => menu.value === item.value)?.label.toLocaleLowerCase().startsWith(query));
            if (next) { this.closeAll(); this.focusValue(next.value); next.trigger.focus(); }
        }
    }
    private connect(root: HTMLDivElement) {
        this.root = root;
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || !root.isConnected) return;
            const triggers = this.triggers();
            const value = triggers.find(item => item.value === this.lastFocused)?.value ?? triggers[0]?.value;
            if (value !== undefined) this.focusValue(value);
            const previous = this.repairFocus; this.repairFocus = undefined;
            if (!previous || (root.ownerDocument.activeElement !== previous.element && root.ownerDocument.activeElement !== root.ownerDocument.body)) return;
            const entry = this.entries.get(previous.value ?? '');
            if (previous.element.isConnected && !previous.element.matches(':disabled') && (!previous.panel || !!entry?.menu.expanded)) previous.element.focus({ preventScroll: true });
            else if (previous.panel && entry?.menu.expanded) entry.menu.open();
            else (triggers.find(item => item.value === previous.value)?.trigger ?? triggers[0]?.trigger ?? root).focus({ preventScroll: true });
        });
    }
    render() {
        const { id, label, menus = [], disabled: _disabled, chevron, '@keydown': suppliedKey, '@focusin': suppliedFocus, ...rest } = this.props;
        menuIdentity(id);
        if (typeof label !== 'string' || !label.trim()) throw new Error('Menubar requires a nonempty label.');
        const values = new Set<string>();
        for (const menu of menus) {
            if (typeof menu.value !== 'string' || !menu.value || values.has(menu.value)) throw new Error('Menubar menus require unique nonempty values.');
            if (typeof menu.label !== 'string' || !menu.label.trim()) throw new Error('Menubar menu labels must be nonempty.');
            values.add(menu.value);
        }
        const active = this.root?.ownerDocument.activeElement;
        if (active && this.root?.contains(active)) {
            const owned = this.owner(active);
            this.repairFocus = { element: active as HTMLElement, value: owned?.[0], panel: !!owned?.[1].panel?.contains(active) };
        }
        for (const [key, entry] of this.entries) if (!values.has(key)) { entry.menu.disconnect(); this.entries.delete(key); }
        const roving = menus.find(menu => menu.value === this.lastFocused)?.value ?? menus[0]?.value;
        return html`<div ref=${(element: Element) => this.connect(element as HTMLDivElement)} id=${id} role="menubar" aria-label=${label} tabindex="-1"
            class="cs-menubar inline-flex items-center gap-1 rounded-md bg-muted p-1" ...=${{ ...rest,
                '@keydown': menuEvent<ControlEvent<HTMLDivElement,KeyboardEvent>>(suppliedKey, event => this.keydown(event)),
                '@focusin': menuEvent<ControlEvent<HTMLDivElement,FocusEvent>>(suppliedFocus, event => { const owned = this.owner(event.target as Node); if (owned) this.focusValue(owned[0]); }),
            }}>
            ${repeat(menus, menu => menu.value, menu => {
                const entry = this.entry(menu.value), triggerProps = menu.triggerProps ?? {}, panelProps = menu.menuProps ?? {};
                const triggerId = `${id}-trigger-${encodeURIComponent(menu.value)}`, panelId = `${id}-menu-${encodeURIComponent(menu.value)}`;
                return html`<div role="none" class="cs-menubar__item relative">
                    <button ref=${(element: Element) => { entry.trigger = element as HTMLButtonElement; }} id=${triggerId} type="button" role="menuitem"
                        aria-haspopup="menu" aria-controls=${panelId} aria-expanded=${String(entry.menu.expanded)} aria-disabled=${String(!!this.props.disabled || !!menu.disabled)} tabindex=${roving === menu.value ? 0 : -1}
                        class="cs-menubar__trigger group px-3 py-1.5 text-sm font-medium rounded-sm cursor-pointer border-none inline-flex items-center bg-transparent text-muted-foreground hover:bg-accent aria-expanded:bg-accent aria-expanded:text-accent-foreground aria-disabled:opacity-50 aria-disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        ...=${{ ...triggerProps,
                            '@click': menuEvent<ControlEvent<HTMLButtonElement,PointerEvent>>(triggerProps['@click'], () => { if (entry.menu.expanded) entry.menu.close(); else this.open(menu.value); }),
                            '@pointerenter': menuEvent<ControlEvent<HTMLButtonElement,PointerEvent>>(triggerProps['@pointerenter'], event => { if (event.pointerType !== 'touch' && [...this.entries.values()].some(item => item.menu.expanded)) this.open(menu.value); }),
                        }}>${menu.label}${chevron ? html`<span aria-hidden="true" class="ml-1 inline-flex transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none">${component(Icon, { entry: altArrowDownIcon, size: 16 })}</span>` : null}</button>
                    <div ref=${(element: Element) => { entry.panel = element as HTMLDivElement; if (entry.trigger) entry.menu.attach(entry.panel, entry.trigger); }} id=${panelId} role="menu" aria-labelledby=${triggerId} tabindex="-1" popover="auto"
                        class="cs-menubar__dropdown cs-menu-popover bg-popover text-popover-foreground border rounded-md shadow-lg p-1 min-w-[160px] outline-none"
                        ...=${{ ...panelProps, '@click': menuEvent<ControlEvent<HTMLDivElement,PointerEvent>>(panelProps['@click'], event => entry.menu.click(event)) }}>${renderMenuItems(menu.items ?? [], 'cs-menubar__dropdown')}</div>
                </div>`;
            })}
        </div>`;
    }
    onCleanup() { this.generation++; for (const entry of this.entries.values()) entry.menu.disconnect(); this.entries.clear(); this.root = undefined; this.repairFocus = undefined; this.search = ''; this.lastFocused = undefined; }
}
