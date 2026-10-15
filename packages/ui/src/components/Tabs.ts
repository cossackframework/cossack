import { html, classMap, repeat, PreventDefaultResult, preventDefault } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client, createRef, type RefObject } from '@cossackframework/core';
import type { GlobalAttributes, ControlEvent } from '../native-attributes';
import { ControlledValue } from '../native-attributes';

export type TabsItem = { value: string; icon?: unknown; content?: unknown; disabled?: boolean } &
    ({ label: string; ariaLabel?: string } | { label: unknown; ariaLabel: string });
export type TabsListProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'role' | 'aria-label' | 'aria-labelledby' | 'aria-orientation' | 'tabindex'>;
export type TabsProps = Omit<GlobalAttributes<HTMLDivElement>, 'id'> & {
    id: string;
    /** Accessible name of the tab list. */
    label: string;
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => unknown;
    items?: readonly TabsItem[];
    orientation?: 'horizontal' | 'vertical';
    variant?: 'pill' | 'underline';
    activation?: 'automatic' | 'manual';
    listProps?: TabsListProps;
};
function tabsKeydown(supplied: TabsListProps['@keydown'], own: (event: KeyboardEvent) => void) {
    const listener: EventListener = event => {
        if (typeof supplied === 'function') supplied(event as ControlEvent<HTMLDivElement, KeyboardEvent>);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) own(event as KeyboardEvent);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** Named tab list with controlled selection, keyed panels and automatic or manual activation. */
@Component()
export class Tabs extends Cossack {
    declare props: TabsProps;
    @ClientState() private localValue: string | undefined;
    @ClientState() private focusedValue: string | undefined;
    private initialValue?: string;
    private initialized = false;
    private root?: HTMLDivElement;
    private indicator?: HTMLSpanElement;
    private resize?: ResizeObserver;
    private focusRepair?: Element;
    private pointerTrigger?: HTMLButtonElement;
    private generation = 0;
    private controlled = new ControlledValue<string | undefined>();
    tablistRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    private current() {
        if (!this.initialized) { this.initialValue = this.props.defaultValue; this.initialized = true; }
        const items = this.props.items ?? [], desired = this.props.value ?? this.localValue ?? this.initialValue;
        return items.find(item => !item.disabled && item.value === desired)?.value ?? items.find(item => !item.disabled)?.value;
    }
    private tabId(value: string) { return `${this.props.id}-tab-${encodeURIComponent(value)}`; }
    private panelId(value: string) { return `${this.props.id}-panel-${encodeURIComponent(value)}`; }
    private buttons() { return Array.from(this.tablistRef.value?.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]') ?? []); }
    @Client() private select(value: string) {
        if (!this.props.items?.some(item => item.value === value && !item.disabled) || this.buttons().find(button => button.dataset.value === value)?.matches(':disabled')) return;
        if (!this.controlled.changed(this.props, this.current(), value)) return;
        if (this.props.value === undefined) this.localValue = value;
        this.props.onValueChange?.(this.controlled.emit(this.props, value));
    }
    @Client() private keydown(event: KeyboardEvent) {
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        const list = this.tablistRef.value;
        const buttons = this.buttons().filter(button => !button.matches(':disabled'));
        const current = buttons.indexOf(event.target as HTMLButtonElement);
        if (current < 0 || !list) return;
        const vertical = this.props.orientation === 'vertical';
        const rtl = list.ownerDocument.defaultView?.getComputedStyle(list).direction === 'rtl';
        const next = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
        const previous = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
        let index: number;
        if (event.key === next) index = (current + 1) % buttons.length;
        else if (event.key === previous) index = (current - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else return;
        event.preventDefault(); buttons[index].focus();
    }
    private connect(root: HTMLDivElement) {
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || !root.isConnected) return;
            this.root = root;
            this.resize ??= new ResizeObserver(() => this.updateIndicator());
            this.resize.disconnect();
            if (this.tablistRef.value) this.resize.observe(this.tablistRef.value);
            for (const button of this.buttons()) this.resize.observe(button);
            const previous = this.focusRepair; this.focusRepair = undefined;
            if (previous && (root.ownerDocument.activeElement === previous || root.ownerDocument.activeElement === root.ownerDocument.body)) {
                const buttons = this.buttons();
                const panel = Array.from(root.children).find(child => child.getAttribute('role') === 'tabpanel' && child.contains(previous));
                const retained = buttons.find(button => button === previous && !button.matches(':disabled'))
                    ?? (previous instanceof HTMLElement && previous.isConnected && panel?.id === (this.current() ? this.panelId(this.current()!) : undefined) && !previous.closest('[hidden],[inert]') && !previous.matches(':disabled') ? previous : undefined);
                const button = retained ?? buttons.find(button => button.dataset.value === this.current() && !button.matches(':disabled'));
                (button ?? this.tablistRef.value)?.focus({ preventScroll: true });
            }
            this.updateIndicator();
        });
    }
    private updateIndicator() {
        const list = this.tablistRef.value, indicator = this.indicator;
        if (!list?.isConnected || !indicator?.isConnected) return;
        const active = this.buttons().find(button => button.dataset.value === this.current());
        indicator.hidden = !active;
        if (!active) return;
        const underline = this.props.variant === 'underline', vertical = this.props.orientation === 'vertical';
        const paint = underline ? 'background:var(--color-primary, #2563eb);border-radius:1px;' : 'background:var(--color-background, #fff);border-radius:0.25rem;box-shadow:0 1px 2px rgb(0 0 0 / 0.06);';
        if (vertical) {
            const edge = list.ownerDocument.defaultView?.getComputedStyle(list).direction === 'rtl' ? 'left' : 'right';
            indicator.style.cssText = `top:${active.offsetTop}px;height:${active.offsetHeight}px;` + (underline ? `${edge}:0;width:2px;` : 'left:4px;right:4px;') + paint;
        } else indicator.style.cssText = `left:${active.offsetLeft}px;width:${active.offsetWidth}px;` + (underline ? 'bottom:0;height:2px;' : 'top:4px;bottom:4px;') + paint;
    }
    render() {
        const { id, label, items = [], orientation = 'horizontal', variant = 'pill', activation = 'automatic', listProps = {},
            value: _value, defaultValue: _default, onValueChange: _change, ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('Tabs requires a nonempty, whitespace-free id.');
        if (typeof label !== 'string' || !label.trim()) throw new Error('Tabs requires a nonempty label.');
        if (!['horizontal','vertical'].includes(orientation) || !['pill','underline'].includes(variant) || !['automatic','manual'].includes(activation)) throw new Error('Invalid Tabs orientation, variant or activation.');
        const values = new Set<string>();
        for (const item of items) {
            const name = item.ariaLabel ?? item.label;
            if (typeof item.value !== 'string' || !item.value || values.has(item.value)) throw new Error('Tabs items require unique nonempty values.');
            if (typeof name !== 'string' || !name.trim()) throw new Error('Tabs items require text labels or a nonempty ariaLabel.');
            values.add(item.value);
        }
        const current = this.current(), vertical = orientation === 'vertical';
        const roving = items.some(item => !item.disabled && item.value === this.focusedValue) ? this.focusedValue : current;
        const active = this.root?.ownerDocument.activeElement;
        if (active && this.root?.contains(active)) {
            const tab = this.buttons().find(button => button === active);
            const panel = Array.from(this.root.children).find(child => child.getAttribute('role') === 'tabpanel' && child.contains(active));
            if (tab || panel) this.focusRepair = active;
        }
        return html`<div ref=${(element: Element) => this.connect(element as HTMLDivElement)} id=${id} class=${classMap({ 'cs-tabs w-full': true, 'flex gap-4': vertical })} ...=${rest}>
            <div ref=${this.tablistRef} id=${`${id}-list`} role="tablist" aria-label=${label} aria-orientation=${orientation} tabindex="-1"
                class=${classMap({ 'cs-tabs__list relative inline-flex rounded-md bg-muted p-1': true, 'items-center gap-1': !vertical, 'flex-col gap-0.5 self-start': vertical })}
                ...=${{ ...listProps, '@keydown': tabsKeydown(listProps['@keydown'], event => this.keydown(event)) }}>
                ${repeat(items, item => item.value, item => html`<button type="button" role="tab" data-value=${item.value} id=${this.tabId(item.value)}
                    aria-selected=${current === item.value} aria-controls=${this.panelId(item.value)} aria-label=${item.ariaLabel} ?disabled=${item.disabled}
                    tabindex=${roving === item.value ? 0 : -1}
                    class=${classMap({ 'cs-tabs__trigger relative z-10 text-sm font-medium transition-colors rounded-sm disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-ring/50 focus-visible:ring-[3px]': true, 'inline-flex items-center gap-2': !!item.icon, 'px-3 py-1.5': !vertical, 'px-3 py-2 w-full text-left': vertical, 'text-foreground': current === item.value, 'text-muted-foreground hover:text-foreground': current !== item.value })}
                    @pointerdown=${(event: PointerEvent) => { this.pointerTrigger = event.currentTarget as HTMLButtonElement; }}
                    @pointerup=${() => { this.pointerTrigger = undefined; }} @pointercancel=${() => { this.pointerTrigger = undefined; }}
                    @focus=${(event: FocusEvent) => { const pointer = this.pointerTrigger === event.currentTarget; this.pointerTrigger = undefined; this.focusedValue = item.value; if (activation === 'automatic' && !pointer) this.select(item.value); }}
                    @blur=${() => { this.pointerTrigger = undefined; const generation = this.generation; queueMicrotask(() => { if (generation === this.generation && !this.tablistRef.value?.contains(this.tablistRef.value.ownerDocument.activeElement)) this.focusedValue = undefined; }); }}
                    @click=${() => this.select(item.value)}>
                    ${item.icon ? html`<span aria-hidden="true" class="cs-tabs__icon inline-flex items-center justify-center w-4 h-4 shrink-0">${item.icon}</span>` : null}${item.label}
                </button>`)}
                <span ref=${(element: Element) => { this.indicator = element as HTMLSpanElement; }} aria-hidden="true" class="cs-tabs__indicator absolute z-0 transition-all duration-300 ease-in-out motion-reduce:transition-none"></span>
            </div>
            ${repeat(items, item => item.value, item => html`<div role="tabpanel" id=${this.panelId(item.value)} aria-labelledby=${this.tabId(item.value)}
                class=${classMap({ 'cs-tabs__panel focus:outline-none': true, 'mt-4': !vertical, 'flex-1': vertical })}
                tabindex=${current === item.value ? 0 : -1} aria-hidden=${current !== item.value} ?hidden=${current !== item.value}>
                ${item.content ?? this.children}
            </div>`)}
        </div>`;
    }
    onCleanup() { this.generation++; this.resize?.disconnect(); this.resize = undefined; this.root = undefined; this.indicator = undefined; this.focusRepair = undefined; this.pointerTrigger = undefined; this.tablistRef.value = undefined; }
}
