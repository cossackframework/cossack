import { html, classMap, live, repeat, PreventDefaultResult, preventDefault, type nothing } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState } from "@cossackframework/core";
import type { GlobalAttributes, ControlEvent } from "../native-attributes";
import { ControlledValue } from "../native-attributes";

export type ComboboxOption = { value: string; label: string; disabled?: boolean };
export type ComboboxProps = Omit<GlobalAttributes<HTMLInputElement>, 'id' | 'role' | 'aria-expanded' | 'aria-controls' | 'aria-activedescendant' | 'aria-autocomplete' | 'aria-haspopup'> & {
    /** Stable, page-unique input ID. Use a label with for=id or aria-label. */
    id: string;
    /** Unique, nonempty values and labels. Disabled options cannot be selected. */
    options?: readonly ComboboxOption[];
    /** Controlled selected value. Accept changes in onValueChange to retain a selection. */
    value?: string;
    /** Initial uncontrolled selection. */
    defaultValue?: string;
    /** Receives a changed option value. Typing only filters; it does not select. */
    onValueChange?: (value: string) => unknown;
    /** Submitted option value, not its display label or search text. */
    name?: string;
    form?: string;
    disabled?: boolean;
    readonly?: boolean;
    required?: boolean;
    placeholder?: string;
    /** Localizable empty-results text. */
    emptyLabel?: string;
    /** Localizable validation message when a required option is not selected. */
    requiredMessage?: string;
};

type Listener<E extends Event> = ((event: E) => unknown) | PreventDefaultResult | null | typeof nothing | undefined;
function compose<E extends Event>(own: (event: E) => void, supplied: Listener<E>) {
    const listener: EventListener = event => {
        if (typeof supplied === 'function') supplied(event as E);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) own(event as E);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** Editable, restricted-choice combobox. Search is transient; only selected options enter form data. */
@Component()
export class Combobox extends Cossack {
    declare props: ComboboxProps;
    @ClientState() private draft: string | undefined;
    @ClientState() private query: string | undefined;
    @ClientState() private open = false;
    @ClientState() private activeValue: string | undefined;
    private initialValue: string | undefined;
    private queryOwner: string | undefined;
    private input?: HTMLInputElement;
    private popup?: HTMLElement;
    private cleanup?: () => void;
    private controlled = new ControlledValue<string | undefined>();

    private get selectedValue() {
        this.initialValue ??= this.props.defaultValue ?? '';
        return this.props.value ?? this.draft ?? this.initialValue;
    }
    private get selected() { return this.props.options?.find(option => option.value === this.selectedValue && !option.disabled); }
    private get search() { return this.queryOwner === this.selectedValue ? this.query : undefined; }
    private get filtered() {
        const query = this.search?.toLocaleLowerCase() ?? '';
        return (this.props.options ?? []).filter(option => option.label.toLocaleLowerCase().includes(query));
    }
    private get expanded() {
        return this.open && this.queryOwner === this.selectedValue && !this.props.disabled && !this.props.readonly;
    }

    render() {
        const { id, options = [], value: _value, defaultValue: _default, onValueChange: _change, name, form,
            disabled = false, readonly = false, required = false, placeholder = 'Search...',
            emptyLabel = 'No results.', requiredMessage: _message, ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('Combobox requires a nonempty, whitespace-free id.');
        const values = new Set<string>();
        for (const option of options) {
            if (typeof option.value !== 'string' || !option.value || values.has(option.value) || typeof option.label !== 'string' || !option.label.trim()) {
                throw new Error('Combobox options require unique nonempty values and nonempty labels.');
            }
            values.add(option.value);
        }
        const listId = `${id}-listbox`, filtered = this.filtered;
        const active = this.expanded ? filtered.find(option => option.value === this.activeValue && !option.disabled) : undefined;
        const optionId = (option: ComboboxOption) => `${listId}-${options.indexOf(option)}`;
        const events = {
            '@input': compose<ControlEvent<HTMLInputElement, InputEvent>>(event => {
                if (!this.editable()) return;
                this.queryOwner = this.selectedValue;
                this.query = event.currentTarget.value;
                this.activeValue = undefined;
                this.open = true;
                this.syncValidity();
            }, rest['@input']),
            '@click': compose<ControlEvent<HTMLInputElement, PointerEvent>>(() => this.show(), rest['@click']),
            '@keydown': compose<ControlEvent<HTMLInputElement, KeyboardEvent>>(event => this.keydown(event), rest['@keydown']),
            '@blur': compose<ControlEvent<HTMLInputElement, FocusEvent>>(() => this.close(), rest['@blur']),
        };
        return html`<div class="cs-combobox relative inline-block w-full">
            <input ref=${(element: Element) => this.connect(element as HTMLInputElement)}
                id=${id} type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
                aria-expanded=${String(this.expanded)} aria-controls=${listId}
                aria-activedescendant=${active ? optionId(active) : undefined}
                autocomplete="off" .value=${live(this.search ?? this.selected?.label ?? '')}
                placeholder=${placeholder} ?disabled=${disabled} ?readonly=${readonly} ?required=${required} form=${form}
                class="cs-combobox__input w-full rounded-md border border-input bg-background text-foreground text-sm px-3 py-2 outline-none transition-colors shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50 disabled:cursor-not-allowed"
                ...=${{ ...rest, ...events }} />
            <input type="hidden" name=${name} form=${form} ?disabled=${disabled} .value=${this.selected?.value ?? ''} />
            <div ref=${(element: Element) => { this.popup = element as HTMLElement; }} id=${listId} role="listbox" popover="auto"
                class="cs-combobox__list bg-popover text-popover-foreground border rounded-md shadow-lg p-1 overflow-y-auto"
                style="position:fixed;margin:0;max-height:200px;"
                @toggle=${(event: Event) => {
                    if ((event as ToggleEvent).newState === 'closed' && this.popup && !this.popup.matches(':popover-open')) this.close();
                }}>
                ${filtered.length ? repeat(filtered, option => option.value, option => html`<div
                    id=${optionId(option)} role="option" aria-selected=${String(active ? option.value === active.value : option.value === this.selected?.value)}
                    aria-disabled=${String(!!option.disabled)}
                    class=${classMap({
                        'cs-combobox__option w-full text-left px-3 py-1.5 text-sm rounded-sm transition-colors': true,
                        'bg-accent text-accent-foreground': option.value === active?.value,
                        'hover:bg-accent hover:text-accent-foreground cursor-pointer': !option.disabled,
                        'opacity-50 cursor-not-allowed': !!option.disabled,
                    })}
                    @mousedown=${(event: MouseEvent) => event.preventDefault()}
                    @click=${() => this.select(option.value)}
                    @mouseenter=${() => { if (!option.disabled) this.activeValue = option.value; }}
                >${option.label}</div>`) : html`<div role="status" class="px-3 py-2 text-sm text-muted-foreground">${emptyLabel}</div>`}
            </div>
        </div>`;
    }

    @Client()
    private editable() { return !!this.input && !this.input.matches(':disabled') && !this.input.readOnly; }

    @Client()
    private show() {
        if (!this.editable()) return;
        if (!this.expanded) { this.query = undefined; this.activeValue = undefined; }
        this.queryOwner = this.selectedValue;
        this.open = true;
        void this.requestUpdate();
    }

    @Client()
    private close() {
        this.open = false;
        this.query = undefined;
        this.activeValue = undefined;
        if (this.popup?.matches(':popover-open')) this.popup.hidePopover();
        void this.requestUpdate();
    }

    @Client()
    private keydown(event: ControlEvent<HTMLInputElement, KeyboardEvent>) {
        if (!this.editable() || event.isComposing || event.keyCode === 229) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (event.altKey && event.key === 'ArrowUp') { this.close(); return; }
            this.show();
            if (event.altKey) return;
            const enabled = this.filtered.filter(option => !option.disabled);
            const index = enabled.findIndex(option => option.value === this.activeValue);
            const next = event.key === 'ArrowDown' ? Math.min(index + 1, enabled.length - 1) : index < 0 ? enabled.length - 1 : Math.max(0, index - 1);
            this.activeValue = enabled[next]?.value;
        } else if (event.key === 'Enter' && this.expanded) {
            event.preventDefault();
            if (this.activeValue) this.select(this.activeValue);
        } else if (event.key === 'Escape' && this.expanded) {
            event.preventDefault();
            this.close();
        } else if (event.key === 'Tab') this.close();
    }

    @Client()
    private select(value: string) {
        if (!this.editable() || !this.filtered.some(option => option.value === value && !option.disabled)) return;
        const changed = this.controlled.changed(this.props, this.selected?.value, value);
        this.draft = value;
        this.close();
        if (changed) this.props.onValueChange?.(this.controlled.emit(this.props, value));
        void this.requestUpdate();
    }

    @Client()
    private syncValidity() {
        this.input?.setCustomValidity(this.props.required && !this.selected ? this.props.requiredMessage ?? 'Select an option.' : '');
    }

    @Client()
    private connect(input: HTMLInputElement) {
        if (this.input !== input) {
            this.cleanup?.();
            this.input = input;
            const document = input.ownerDocument, window = document.defaultView;
            let active = true;
            const reset = (event: Event) => {
                if (event.target !== input.form) return;
                queueMicrotask(() => {
                    if (!active || event.defaultPrevented) return;
                    this.draft = undefined;
                    this.controlled.reset();
                    this.close();
                    this.syncValidity();
                });
            };
            const position = () => this.position();
            document.addEventListener('reset', reset, true);
            document.addEventListener('scroll', position, true);
            window?.addEventListener('resize', position);
            const disabledObserver = new MutationObserver(() => {
                if (!this.editable() && (this.open || this.query !== undefined)) this.close();
            });
            disabledObserver.observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
            // Refs run before a client render adopts its nodes; walk ancestors once connected.
            queueMicrotask(() => {
                if (!active) return;
                for (let ancestor = input.parentElement; ancestor; ancestor = ancestor.parentElement) {
                    if (ancestor.tagName === 'FIELDSET') disabledObserver.observe(ancestor, { attributes: true, attributeFilter: ['disabled'] });
                }
            });
            const resizeObserver = new ResizeObserver(position);
            resizeObserver.observe(input);
            this.cleanup = () => {
                active = false;
                disabledObserver.disconnect();
                resizeObserver.disconnect();
                document.removeEventListener('reset', reset, true);
                document.removeEventListener('scroll', position, true);
                window?.removeEventListener('resize', position);
            };
        }
        queueMicrotask(() => {
            if (this.input !== input || !input.isConnected) return;
            this.syncValidity();
            if (this.expanded && this.editable() && this.popup?.isConnected) {
                if (!this.popup.matches(':popover-open')) this.popup.showPopover();
                this.position();
                this.popup.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
            } else if (this.popup?.matches(':popover-open')) this.popup.hidePopover();
        });
    }

    @Client()
    private position() {
        const input = this.input, popup = this.popup, window = input?.ownerDocument.defaultView;
        if (!input || !popup?.matches(':popover-open') || !window) return;
        const rect = input.getBoundingClientRect(), gap = 4;
        const below = window.innerHeight - rect.bottom - gap, above = rect.top - gap;
        const upwards = below < Math.min(200, popup.scrollHeight) && above > below;
        popup.style.width = `${Math.min(rect.width, window.innerWidth)}px`;
        popup.style.maxHeight = `${Math.max(0, Math.min(200, upwards ? above : below))}px`;
        popup.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - rect.width))}px`;
        popup.style.top = upwards ? `${Math.max(0, rect.top - gap - popup.getBoundingClientRect().height)}px` : `${rect.bottom + gap}px`;
    }

    onCleanup() {
        this.cleanup?.();
        this.cleanup = undefined;
        this.input = undefined;
        this.popup = undefined;
    }
}
