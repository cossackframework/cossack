import { html, classMap, repeat, PreventDefaultResult, preventDefault } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client, createRef, type RefObject } from '@cossackframework/core';
import type { GlobalAttributes, ControlEvent } from '../native-attributes';
import { ControlledValue } from '../native-attributes';

export type ToggleGroupItem = { value: string; disabled?: boolean } &
    ({ label?: string; ariaLabel?: string } | { label: unknown; ariaLabel: string });
type ToggleGroupBase = Omit<GlobalAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'aria-labelledby' | 'tabindex'> & {
    label: string;
    items?: readonly ToggleGroupItem[];
    disabled?: boolean;
    orientation?: 'horizontal' | 'vertical';
};
export type ToggleGroupProps = ToggleGroupBase & (
    { type?: 'single'; value?: string; defaultValue?: string; onValueChange?: (value: string) => unknown } |
    { type: 'multiple'; value?: readonly string[]; defaultValue?: readonly string[]; onValueChange?: (value: string[]) => unknown }
);

/** Named group of native toggle buttons; single selection can be cleared. */
@Component()
export class ToggleGroup extends Cossack {
    declare props: ToggleGroupProps;
    @ClientState() private localSelected: readonly string[] | undefined;
    @ClientState() private focusedValue: string | undefined;
    private initialSelected?: readonly string[];
    private indicator?: HTMLSpanElement;
    private resize?: ResizeObserver;
    private repairFocus?: HTMLButtonElement;
    private generation = 0;
    private controlled = new ControlledValue<readonly string[]>();
    groupRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    private selection() {
        const normalize = (value: string | readonly string[] | undefined) => typeof value === 'string' ? value ? [value] : [] : value ? [...value] : [];
        this.initialSelected ??= normalize(this.props.defaultValue);
        const values = this.props.value !== undefined ? normalize(this.props.value) : this.localSelected ?? this.initialSelected;
        return this.props.type === 'multiple' ? values : values.slice(0, 1);
    }
    isSelected(value: string) { return this.selection().includes(value); }
    private buttons() { return Array.from(this.groupRef.value?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? []); }
    @Client() toggle(value: string) {
        const item = this.props.items?.find(item => item.value === value);
        if (!item || item.disabled || this.props.disabled || this.buttons().find(button => button.dataset.value === value)?.matches(':disabled')) return;
        const current = this.controlled.base(this.props, this.selection());
        const next = this.props.type === 'multiple' ? current.includes(value) ? current.filter(item => item !== value) : [...current, value] : current.includes(value) ? [] : [value];
        if (this.props.value === undefined) this.localSelected = next;
        this.controlled.emit(this.props, next);
        if (this.props.type === 'multiple') this.props.onValueChange?.([...next]);
        else this.props.onValueChange?.(next[0] ?? '');
    }
    @Client() private keydown(event: KeyboardEvent) {
        if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        const group = this.groupRef.value, buttons = this.buttons().filter(button => !button.matches(':disabled'));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (!group || index < 0) return;
        const vertical = this.props.orientation === 'vertical', rtl = group.ownerDocument.defaultView?.getComputedStyle(group).direction === 'rtl';
        const next = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
        const previous = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
        let target: number;
        if (event.key === next) target = (index + 1) % buttons.length;
        else if (event.key === previous) target = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = buttons.length - 1;
        else return;
        event.preventDefault(); buttons[target].focus();
    }
    private connect(group: HTMLDivElement) {
        this.groupRef.value = group;
        const generation = this.generation;
        queueMicrotask(() => {
            if (generation !== this.generation || !group.isConnected) return;
            this.resize ??= new ResizeObserver(() => this.updateIndicator());
            this.resize.disconnect(); this.resize.observe(group);
            const buttons = this.buttons(); for (const button of buttons) this.resize.observe(button);
            const previous = this.repairFocus; this.repairFocus = undefined;
            if (previous && (group.ownerDocument.activeElement === previous || group.ownerDocument.activeElement === group.ownerDocument.body)) {
                const enabled = buttons.filter(button => !button.matches(':disabled'));
                (enabled.find(button => button === previous) ?? enabled.find(button => this.isSelected(button.dataset.value!)) ?? enabled[0] ?? group).focus({ preventScroll: true });
            }
            this.updateIndicator();
        });
    }
    private updateIndicator() {
        const group = this.groupRef.value, indicator = this.indicator;
        if (!group?.isConnected || !indicator?.isConnected) return;
        const active = this.buttons().find(button => this.isSelected(button.dataset.value!));
        indicator.hidden = !active;
        if (!active) return;
        indicator.style.cssText = (this.props.orientation === 'vertical'
            ? `top:${active.offsetTop}px;height:${active.offsetHeight}px;left:4px;right:4px;`
            : `left:${active.offsetLeft}px;width:${active.offsetWidth}px;top:4px;bottom:4px;`)
            + 'background:var(--color-background, #fff);border-radius:0.25rem;box-shadow:0 1px 2px rgb(0 0 0 / 0.06);';
    }
    render() {
        const { items = [], type = 'single', label, orientation = 'horizontal', disabled, value: _value, defaultValue: _default, onValueChange: _change, '@keydown': supplied, ...rest } = this.props;
        if (typeof label !== 'string' || !label.trim()) throw new Error('ToggleGroup requires a nonempty label.');
        if (!['single','multiple'].includes(type) || !['horizontal','vertical'].includes(orientation)) throw new Error('Invalid ToggleGroup type or orientation.');
        for (const value of [this.props.value, this.props.defaultValue]) {
            if (value === undefined) continue;
            if (type === 'single' ? typeof value !== 'string' : !Array.isArray(value) || value.some(item => typeof item !== 'string' || !item) || new Set(value).size !== value.length) throw new Error('ToggleGroup selection must match its type and contain unique nonempty values.');
        }
        const values = new Set<string>();
        for (const item of items) {
            if (typeof item.value !== 'string' || !item.value || values.has(item.value)) throw new Error('ToggleGroup items require unique nonempty values.');
            const name = item.ariaLabel ?? item.label ?? item.value;
            if (typeof name !== 'string' || !name.trim()) throw new Error('ToggleGroup rich labels require a nonempty ariaLabel.');
            values.add(item.value);
        }
        // Capture defaults even when the initial render has no items.
        const selected = this.selection();
        const enabled = disabled ? [] : items.filter(item => !item.disabled);
        const roving = enabled.find(item => item.value === this.focusedValue)?.value ?? enabled.find(item => selected.includes(item.value))?.value ?? enabled[0]?.value;
        const focused = this.buttons().find(button => button === this.groupRef.value?.ownerDocument.activeElement);
        if (focused) this.repairFocus = focused;
        const keydown: EventListener = event => {
            if (typeof supplied === 'function') supplied(event as ControlEvent<HTMLDivElement, KeyboardEvent>);
            else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
            if (!event.defaultPrevented) this.keydown(event as KeyboardEvent);
        };
        return html`<div ref=${(element: Element) => this.connect(element as HTMLDivElement)} role="group" aria-label=${label} tabindex="-1"
            class=${classMap({ 'cs-toggle-group relative inline-flex gap-1 rounded-md bg-muted p-1': true, 'items-center': orientation === 'horizontal', 'flex-col items-stretch': orientation === 'vertical' })}
            ...=${{ ...rest, '@keydown': supplied instanceof PreventDefaultResult ? preventDefault(keydown, { novalidate: supplied.novalidate }) : keydown }}>
            ${repeat(items, item => item.value, item => html`<button type="button" data-value=${item.value} ?disabled=${!!disabled || !!item.disabled}
                aria-pressed=${selected.includes(item.value)} aria-label=${item.ariaLabel} tabindex=${roving === item.value ? 0 : -1}
                class=${classMap({ 'cs-toggle-group__item relative z-10 text-sm font-medium transition-colors border-none cursor-pointer outline-none px-3 py-1.5 rounded-sm focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50 disabled:cursor-not-allowed': true, 'text-foreground': selected.includes(item.value), 'text-muted-foreground hover:text-foreground': !selected.includes(item.value), 'bg-background shadow-sm': selected.includes(item.value) && type === 'multiple', 'bg-transparent': !selected.includes(item.value) || type === 'single' })}
                @focus=${() => { this.focusedValue = item.value; }}
                @blur=${() => { const generation = this.generation; queueMicrotask(() => { if (generation === this.generation && !this.groupRef.value?.contains(this.groupRef.value.ownerDocument.activeElement)) this.focusedValue = undefined; }); }}
                @click=${() => this.toggle(item.value)}>${item.label ?? item.value}</button>`)}
            ${type === 'single' ? html`<span ref=${(element: Element) => { this.indicator = element as HTMLSpanElement; }} aria-hidden="true" class="cs-toggle-group__indicator absolute z-0 rounded-sm transition-all duration-300 ease-in-out motion-reduce:transition-none"></span>` : null}
        </div>`;
    }
    onCleanup() { this.generation++; this.resize?.disconnect(); this.resize = undefined; this.groupRef.value = undefined; this.indicator = undefined; this.repairFocus = undefined; }
}
