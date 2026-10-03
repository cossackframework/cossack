import { html, classMap, PreventDefaultResult, preventDefault, type nothing } from '@cossackframework/renderer';
import type { ControlEvent, GlobalAttributes } from '../native-attributes';

/** A separator has no action. Action labels also supply accessible/typeahead text. */
export type MenuItem = { separator: true; label?: never; onClick?: never; disabled?: never; destructive?: never } | {
    separator?: false;
    label: string;
    onClick?: (event: ControlEvent<HTMLButtonElement, MouseEvent>) => unknown;
    disabled?: boolean;
    destructive?: boolean;
};
export type MenuPanelProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'tabindex' | 'aria-modal'>;
type Listener<E extends Event> = ((event: E) => unknown) | PreventDefaultResult | null | typeof nothing | undefined;
export function menuEvent<E extends Event>(supplied: Listener<E>, own: (event: E) => void) {
    const handler: EventListener = event => {
        if (typeof supplied === 'function') supplied(event as E);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) own(event as E);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(handler, { novalidate: supplied.novalidate }) : handler;
}
export function menuIdentity(id: string) {
    if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('Menus require a nonempty, whitespace-free id.');
}
export function renderMenuItems(items: readonly MenuItem[], prefix: string) {
    return items.map(item => {
        if (item.separator) return html`<hr role="separator" class=${`${prefix}__separator -mx-1 my-1 border-t`} />`;
        if (typeof item.label !== 'string' || !item.label.trim()) throw new Error('Menu action labels must be nonempty strings.');
        return html`<button type="button" role="menuitem" tabindex="-1" aria-disabled=${item.disabled ? 'true' : undefined}
            class=${classMap({ [`${prefix}__item w-full text-left px-3 py-2 text-sm rounded-sm cursor-pointer outline-none focus:bg-accent hover:bg-accent`]: true,
                'opacity-50 cursor-not-allowed': !!item.disabled, 'text-destructive': !!item.destructive })}
            @click=${(event: MouseEvent) => { if (item.disabled) { event.preventDefault(); return; } item.onClick?.(event as ControlEvent<HTMLButtonElement, MouseEvent>); }}>${item.label}</button>`;
    });
}
type Settings = { disabled?: boolean; context?: boolean; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end' };
/** Native popover lifecycle and single-level menu keyboard behavior. */
export class MenuController {
    private panel?: HTMLDivElement;
    private source?: HTMLElement;
    private returnTo?: HTMLElement;
    private cleanup?: () => void;
    private point?: { x: number; y: number };
    private search = '';
    private searchAt = 0;
    private generation = 0;
    constructor(private read: () => Settings) {}
    get expanded() { return !!this.panel?.matches(':popover-open'); }
    private unavailable() { return !!this.read().disabled || !!this.source?.matches(':disabled'); }
    private items() {
        const panel = this.panel;
        return panel ? Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(item => item.closest('[role="menu"]') === panel && !item.matches(':disabled') && item.getClientRects().length > 0 && !item.closest('[hidden],[inert]')) : [];
    }
    private focus(item?: HTMLElement) { (item ?? this.panel)?.focus({ preventScroll: true }); item?.scrollIntoView({ block: 'nearest' }); }
    attach(panel: HTMLDivElement, source: HTMLElement) {
        if (!panel.isConnected || !source.isConnected) {
            const generation = this.generation;
            queueMicrotask(() => { if (generation === this.generation && panel.isConnected && source.isConnected) this.attach(panel, source); });
            return;
        }
        if (this.panel !== panel || this.source !== source) {
            this.disconnect(); this.panel = panel; this.source = source;
            const document = panel.ownerDocument, window = document.defaultView;
            const position = () => this.position();
            const toggle = () => {
                source.setAttribute('aria-expanded', String(this.expanded));
                if (this.expanded) {
                    this.position();
                    if (document.activeElement === source || document.activeElement === panel) this.focus(this.items()[0]);
                } else this.search = '';
            };
            const guard = (event: Event) => {
                const item = (event.target as Element).closest<HTMLElement>('[role="menuitem"]');
                if (item?.closest('[role="menu"]') === panel && item.getAttribute('aria-disabled') === 'true') { event.preventDefault(); event.stopImmediatePropagation(); }
            };
            const scroll = (event: Event) => {
                if (this.read().context && event.target instanceof Node && !panel.contains(event.target)) this.close(false);
                else this.position();
            };
            const outside = (event: PointerEvent) => {
                if (!this.read().context || event.defaultPrevented || panel.contains(event.target as Node)) return;
                if (event.button === 2 && source.contains(event.target as Node)) return;
                this.close(false);
            };
            const escape = (event: KeyboardEvent) => {
                if (this.read().context && !event.defaultPrevented && event.key === 'Escape' && !panel.contains(event.target as Node)) this.close(false);
            };
            document.addEventListener('pointerdown', outside);
            document.addEventListener('keydown', escape);
            const disabled = new MutationObserver(() => { if (this.unavailable()) this.close(false); });
            disabled.observe(source, { attributes: true, attributeFilter: ['disabled'] });
            for (let parent = source.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'FIELDSET') disabled.observe(parent, { attributes: true, attributeFilter: ['disabled'] });
            const resize = new ResizeObserver(position); resize.observe(panel); resize.observe(source);
            panel.addEventListener('toggle', toggle); panel.addEventListener('click', guard, true);
            document.addEventListener('scroll', scroll, true); window?.addEventListener('resize', position);
            window?.visualViewport?.addEventListener('resize', position); window?.visualViewport?.addEventListener('scroll', position);
            this.cleanup = () => {
                panel.removeEventListener('toggle', toggle); panel.removeEventListener('click', guard, true);
                document.removeEventListener('scroll', scroll, true); window?.removeEventListener('resize', position);
                window?.visualViewport?.removeEventListener('resize', position); window?.visualViewport?.removeEventListener('scroll', position);
                document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
                disabled.disconnect(); resize.disconnect();
                if (panel.isConnected && panel.matches(':popover-open')) panel.hidePopover();
            };
        }
        const active = panel.ownerDocument.activeElement;
        const ownedFocus = !!active && panel.contains(active);
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || this.panel !== panel || !panel.isConnected) return;
            if (this.unavailable()) this.close(false);
            else {
                this.position();
                if (this.expanded && ownedFocus && !panel.contains(active) && panel.ownerDocument.activeElement === panel.ownerDocument.body) this.focus(this.items()[0]);
            }
        });
    }
    open(last = false, point?: { x: number; y: number }, returnTo?: HTMLElement) {
        const panel = this.panel, source = this.source;
        if (!panel?.isConnected || !source?.isConnected || this.unavailable()) return;
        this.point = point; this.returnTo = returnTo ?? source; this.search = '';
        if (!this.expanded) panel.showPopover({ source });
        if (!this.expanded) return; // beforetoggle can veto opening.
        source.setAttribute('aria-expanded', 'true'); this.position();
        const items = this.items(); this.focus(last ? items.at(-1) : items[0]);
    }
    close(restore = true) {
        const panel = this.panel, source = this.returnTo ?? this.source;
        const ownsFocus = !!panel?.contains(panel.ownerDocument.activeElement);
        if (panel?.isConnected && this.expanded) panel.hidePopover();
        this.source?.setAttribute('aria-expanded', 'false'); this.search = '';
        if (restore && ownsFocus && source?.isConnected) source.focus({ preventScroll: true });
    }
    triggerKey(event: KeyboardEvent) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.open(event.key === 'ArrowUp'); }
    }
    click(event: MouseEvent) {
        const item = (event.target as Element).closest<HTMLElement>('[role="menuitem"]');
        if (item && item.closest('[role="menu"]') === this.panel && item.getAttribute('aria-disabled') !== 'true') this.close();
    }
    key(event: KeyboardEvent) {
        if (!this.expanded || (event.target as Element).closest('[role="menu"]') !== this.panel || event.isComposing) return;
        const items = this.items(), active = this.panel!.ownerDocument.activeElement as HTMLElement, index = items.indexOf(active);
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
        else if (event.key === 'Tab') {
            // Let native Tab continue from the invoker after removing the menu.
            this.close();
        } else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
            event.preventDefault();
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            this.focus(items[target]);
        } else if (event.key === ' ' && active.tagName === 'A') { event.preventDefault(); active.click(); }
        else if (event.key.length === 1 && event.key !== ' ' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            const now = Date.now(); this.search = now - this.searchAt > 700 ? event.key : this.search + event.key; this.searchAt = now;
            const text = this.search.toLocaleLowerCase(), query = [...text].every(char => char === text[0]) ? text[0] : text;
            const candidates = [...items.slice(index + 1), ...items.slice(0, index + 1)];
            const found = candidates.find(item => (item.getAttribute('aria-label') ?? item.textContent ?? '').trim().toLocaleLowerCase().startsWith(query));
            if (found) this.focus(found);
        }
    }
    position() {
        const panel = this.panel, source = this.source, window = panel?.ownerDocument.defaultView;
        if (!panel?.isConnected || !source?.isConnected || !window || !this.expanded) return;
        const viewport = window.visualViewport, gap = 8, x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
        const vw = viewport?.width ?? window.innerWidth, vh = viewport?.height ?? window.innerHeight;
        Object.assign(panel.style, { position: 'fixed', margin: '0', inset: 'auto', boxSizing: 'border-box', maxWidth: `${Math.max(0, vw-gap*2)}px`, maxHeight: `${Math.max(0, vh-gap*2)}px`, overflow: 'auto' });
        const width = panel.offsetWidth, height = panel.offsetHeight, rect = source.getBoundingClientRect();
        let left = this.point?.x ?? rect.left, top = this.point?.y ?? rect.bottom + gap;
        if (!this.point) {
            let side = this.read().side ?? 'bottom'; const align = this.read().align ?? 'start';
            const room = { top: rect.top-y-gap, bottom: y+vh-rect.bottom-gap, left: rect.left-x-gap, right: x+vw-rect.right-gap };
            const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
            if (room[side] < (side === 'top' || side === 'bottom' ? height : width) && room[opposite[side]] > room[side]) side = opposite[side];
            if (side === 'top' || side === 'bottom') {
                const rtl = window.getComputedStyle(source).direction === 'rtl';
                left = align === 'center' ? rect.left+(rect.width-width)/2 : (align === 'start') !== rtl ? rect.left : rect.right-width;
                top = side === 'top' ? rect.top-height-gap : rect.bottom+gap;
            } else {
                left = side === 'left' ? rect.left-width-gap : rect.right+gap;
                top = align === 'center' ? rect.top+(rect.height-height)/2 : align === 'start' ? rect.top : rect.bottom-height;
            }
            panel.dataset.side = side;
        }
        panel.style.left = `${Math.max(x+gap,Math.min(left,x+vw-width-gap))}px`;
        panel.style.top = `${Math.max(y+gap,Math.min(top,y+vh-height-gap))}px`;
    }
    disconnect() { this.generation++; this.cleanup?.(); this.cleanup = undefined; this.panel = undefined; this.source = undefined; this.returnTo = undefined; this.point = undefined; this.search = ''; }
}
