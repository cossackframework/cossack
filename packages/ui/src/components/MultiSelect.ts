import { html, classMap, live, repeat, PreventDefaultResult, preventDefault, type nothing } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState } from "@cossackframework/core";
import type { GlobalAttributes, ControlEvent } from "../native-attributes";
import { ControlledValue } from "../native-attributes";

export type MultiSelectProps = Omit<GlobalAttributes<HTMLInputElement>, 'id' | 'role' | 'aria-expanded' | 'aria-controls' | 'aria-activedescendant' | 'aria-autocomplete' | 'aria-haspopup' | 'aria-required' | 'aria-invalid' | 'aria-describedby'> & {
    /** Stable page-unique input ID. Associate a label with for=id or aria-label. */
    id: string;
    options?: readonly string[];
    /** Controlled selection. Accept the fresh array in onChange to retain an edit. */
    value?: readonly string[];
    /** Initial uncontrolled selection. */
    defaultValue?: readonly string[];
    /** Each selected value is submitted under this name. Read with FormData.getAll(). */
    name?: string;
    form?: string;
    disabled?: boolean;
    readonly?: boolean;
    required?: boolean;
    placeholder?: string;
    /** Allow adding trimmed values outside options. Default true. */
    allowCreate?: boolean;
    /** Maximum number of selections. Integer >= 0; zero means unlimited. */
    max?: number;
    onChange?: (value: string[]) => unknown;
    /** Validate every proposed addition, predefined or custom. Return a displayed error or null. */
    validate?: (value: string) => string | null;
    /** Parent-owned validation error. Blocks submission until the parent clears it. */
    error?: string;
    'aria-describedby'?: string;
    emptyLabel?: string;
    requiredMessage?: string;
    maxMessage?: string;
    createLabel?: (value: string) => string;
    removeLabel?: (value: string) => string;
};

type Candidate = { value: string; create: boolean; id: string };
type Listener<E extends Event> = ((event: E) => unknown) | PreventDefaultResult | null | typeof nothing | undefined;
function compose<E extends Event>(own: (event: E) => void, supplied: Listener<E>) {
    const listener: EventListener = event => {
        if (typeof supplied === 'function') supplied(event as E);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
        if (!event.defaultPrevented) own(event as E);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** Tag input with a single-choice suggestion popup and repeated native form values. */
@Component()
export class MultiSelect extends Cossack {
    declare props: MultiSelectProps;
    @ClientState() private draft: string[] | undefined;
    @ClientState() private query = '';
    @ClientState() private open = false;
    @ClientState() private activeValue: string | undefined;
    @ClientState() private errorText = '';
    private initialValue?: string[];
    private input?: HTMLInputElement;
    private popup?: HTMLElement;
    private cleanup?: () => void;
    private searchOwner?: string;
    // A parent applies onChange in a later render. Until it replaces props,
    // the next edit builds on the last emitted list, not the stale value prop.
    private controlled = new ControlledValue<readonly string[]>();

    private get selected(): readonly string[] {
        this.initialValue ??= [...(this.props.defaultValue ?? [])];
        return this.props.value ?? this.draft ?? this.initialValue;
    }
    private get base(): readonly string[] {
        return this.controlled.base(this.props, this.selected);
    }
    private get selectionKey() { return JSON.stringify(this.selected); }
    private get search() { return this.searchOwner === this.selectionKey ? this.query : ''; }
    private get expanded() { return this.open && this.searchOwner === this.selectionKey && !this.props.disabled && !this.props.readonly; }
    private get atMax() { return !!this.props.max && this.selected.length >= this.props.max; }
    private get limitMessage() { return this.props.maxMessage ?? `Choose no more than ${this.props.max} values.`; }
    private get shownError() { return this.props.error || (this.searchOwner === this.selectionKey ? this.errorText : '') || (this.props.max && this.selected.length > this.props.max ? this.limitMessage : ''); }
    private get validityMessage() { return this.shownError || (this.props.required && !this.selected.length ? this.props.requiredMessage ?? 'Select at least one value.' : ''); }
    private get candidates(): Candidate[] {
        const query = this.search.trim().toLowerCase(), options = this.props.options ?? [];
        const candidates = options.flatMap((value, index) => !this.selected.includes(value) && value.toLowerCase().includes(query)
            ? [{ value, create: false, id: `${this.props.id}-listbox-${index}` }] : []);
        if (query && this.props.allowCreate !== false && ![...options, ...this.selected].some(value => value.trim().toLowerCase() === query)) {
            candidates.push({ value: this.search.trim(), create: true, id: `${this.props.id}-listbox-create` });
        }
        return candidates;
    }

    render() {
        const { id, options = [], value: _value, defaultValue: _default, name, form, disabled = false, readonly = false,
            required = false, placeholder = 'Add tag...', allowCreate: _create, max = 0, onChange: _change, validate: _validate,
            error: _error, 'aria-describedby': description, emptyLabel = 'No options.', requiredMessage: _required,
            maxMessage: _max, createLabel = value => `Create "${value}"`, removeLabel = value => `Remove ${value}`, ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('MultiSelect requires a nonempty, whitespace-free id.');
        if (!Number.isInteger(max) || max < 0) throw new Error('MultiSelect max must be an integer greater than or equal to zero.');
        for (const values of [options, this.selected]) {
            if (values.some(value => typeof value !== 'string' || !value.trim()) || new Set(values).size !== values.length) {
                throw new Error('MultiSelect options and selected values must be unique nonempty strings.');
            }
        }
        const candidates = this.candidates, active = this.expanded && !this.atMax ? candidates.find(item => item.value === this.activeValue) : undefined;
        const errorId = `${id}-error`, describedBy = [description, this.shownError ? errorId : undefined].filter(Boolean).join(' ') || undefined;
        const events = {
            '@input': compose<ControlEvent<HTMLInputElement, InputEvent>>(event => {
                if (!this.editable()) return;
                this.searchOwner = this.selectionKey;
                this.query = event.currentTarget.value;
                this.activeValue = undefined;
                this.errorText = '';
                this.open = true;
                this.syncValidity();
            }, rest['@input']),
            '@focus': compose<ControlEvent<HTMLInputElement, FocusEvent>>(() => this.show(), rest['@focus']),
            '@click': compose<ControlEvent<HTMLInputElement, PointerEvent>>(() => this.show(), rest['@click']),
            '@keydown': compose<ControlEvent<HTMLInputElement, KeyboardEvent>>(event => this.keydown(event), rest['@keydown']),
            '@blur': compose<ControlEvent<HTMLInputElement, FocusEvent>>(() => this.close(), rest['@blur']),
            '@invalid': compose<ControlEvent<HTMLInputElement>>(event => {
                this.searchOwner = this.selectionKey;
                if (!this.shownError) this.errorText = event.currentTarget.validationMessage;
            }, rest['@invalid']),
        };
        return html`<div class="cs-multiselect relative w-full">
            <div class="cs-multiselect__field flex flex-wrap items-center gap-1.5 min-h-9 w-full rounded-md border border-input bg-background px-2 py-1 transition-[color,box-shadow] shadow-xs focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]">
                ${repeat(this.selected, value => value, value => html`<span class="cs-multiselect__tag inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-sm text-secondary-foreground">
                    ${value}<button type="button" ?disabled=${disabled || readonly} aria-label=${removeLabel(value)}
                        data-tag=${value} class="cs-multiselect__tag-remove inline-flex items-center justify-center size-5 rounded-sm hover:text-foreground text-muted-foreground cursor-pointer border-none bg-transparent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 disabled:cursor-not-allowed"
                        @click=${(event: ControlEvent<HTMLButtonElement, MouseEvent>) => this.remove(value, event)}><span aria-hidden="true">×</span></button>
                </span>`)}
                <input ref=${(element: Element) => this.connect(element as HTMLInputElement)} id=${id} type="text" role="combobox"
                    aria-autocomplete="list" aria-haspopup="listbox" aria-expanded=${String(this.expanded)} aria-controls=${`${id}-listbox`}
                    aria-activedescendant=${active?.id} aria-required=${String(required)} aria-invalid=${String(!!this.shownError)} aria-describedby=${describedBy}
                    autocomplete="off" .value=${live(this.search)} placeholder=${placeholder} ?disabled=${disabled} ?readonly=${readonly}
                    ?required=${required && this.selected.length === 0} form=${form}
                    class="cs-multiselect__input flex-1 min-w-[80px] rounded-sm border border-dashed border-input bg-transparent px-1 outline-none text-sm text-foreground placeholder:text-muted-foreground focus:border-solid focus:border-ring focus:ring-ring/50 focus:ring-[3px] py-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    ...=${{ ...rest, ...events }} />
            </div>
            ${repeat(this.selected, value => value, value => html`<input type="hidden" name=${name} form=${form} ?disabled=${disabled} .value=${value} />`)}
            ${this.shownError ? html`<div id=${errorId} role="alert" class="text-sm text-destructive">${this.shownError}</div>` : null}
            <div ref=${(element: Element) => { this.popup = element as HTMLElement; }} id=${`${id}-listbox`} role="listbox" popover="auto"
                class="cs-multiselect__dropdown bg-popover text-popover-foreground border rounded-md shadow-lg p-1 overflow-y-auto"
                style="position:fixed;margin:0;max-height:200px;"
                @toggle=${(event: Event) => {
                    // A programmatic close queues its toggle event. Do not let
                    // that older event clear validation set after the close.
                    if ((event as ToggleEvent).newState === 'closed' && this.open && this.popup && !this.popup.matches(':popover-open')) this.close();
                }}>
                ${!candidates.length || this.atMax ? html`<div role="status" class="px-3 py-2 text-sm text-muted-foreground">${this.atMax ? this.limitMessage : emptyLabel}</div>`
                : repeat(candidates, item => item.value, item => html`<div id=${item.id} role="option" aria-selected=${String(item.value === active?.value)}
                    class=${classMap({ 'cs-multiselect__option w-full text-left px-3 py-1.5 text-sm rounded-sm cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground': true,
                        'bg-accent text-accent-foreground': item.value === active?.value })}
                    @mousedown=${(event: MouseEvent) => event.preventDefault()} @click=${() => this.add(item.value)}
                    @mouseenter=${() => { this.activeValue = item.value; }}>${item.create ? createLabel(item.value) : item.value}</div>`)}
            </div>
        </div>`;
    }

    @Client()
    private editable() { return !!this.input && !this.input.matches(':disabled') && !this.input.readOnly; }
    @Client()
    private show() {
        if (!this.editable()) return;
        if (this.searchOwner !== this.selectionKey) { this.query = ''; this.activeValue = undefined; this.errorText = ''; }
        this.searchOwner = this.selectionKey;
        this.open = true;
        void this.requestUpdate();
    }
    @Client()
    private close() {
        this.open = false;
        this.query = '';
        this.activeValue = undefined;
        this.errorText = '';
        if (this.popup?.matches(':popover-open')) this.popup.hidePopover();
        void this.requestUpdate();
    }
    @Client()
    private keydown(event: ControlEvent<HTMLInputElement, KeyboardEvent>) {
        if (!this.editable() || event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Backspace' && !this.search && !event.ctrlKey && !event.metaKey && !event.altKey && this.selected.length) {
            event.preventDefault();
            void this.remove(this.selected[this.selected.length - 1]);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (event.altKey && event.key === 'ArrowUp') { this.close(); return; }
            this.show();
            if (event.altKey || this.atMax) return;
            const candidates = this.candidates, index = candidates.findIndex(item => item.value === this.activeValue);
            const next = event.key === 'ArrowDown' ? Math.min(index + 1, candidates.length - 1) : index < 0 ? candidates.length - 1 : Math.max(0, index - 1);
            this.activeValue = candidates[next]?.value;
        } else if (event.key === 'Enter' && (this.expanded || this.search)) {
            event.preventDefault();
            const candidate = this.candidates.find(item => item.value === this.activeValue)
                ?? this.candidates.find(item => this.search.trim() && (item.create || item.value.toLowerCase() === this.search.trim().toLowerCase()));
            if (candidate) this.add(candidate.value);
        } else if (event.key === 'Escape' && (this.expanded || this.search || this.errorText)) {
            event.preventDefault();
            this.close();
        } else if (event.key === 'Tab') this.close();
    }
    @Client()
    private add(value: string) {
        if (!this.editable() || !this.candidates.some(item => item.value === value) || this.selected.includes(value)) return;
        const base = this.base;
        if (this.atMax || (this.props.max && !base.includes(value) && base.length >= this.props.max)) { this.errorText = this.limitMessage; this.syncValidity(); return; }
        const error = this.props.validate?.(value);
        if (error) { this.errorText = error; this.syncValidity(); return; }
        const next = base.includes(value) ? [...base] : [...base, value];
        this.draft = next;
        this.controlled.emit(this.props, next);
        this.close();
        this.props.onChange?.([...next]);
        this.syncValidity();
        void this.requestUpdate();
    }
    @Client()
    private async remove(value: string, event?: ControlEvent<HTMLButtonElement, MouseEvent>) {
        if (!this.editable() || !this.selected.includes(value)) return;
        const input = this.input!, button = event?.currentTarget, index = this.selected.indexOf(value), keyboard = event?.detail === 0;
        const next = this.base.filter(item => item !== value);
        this.draft = next;
        this.controlled.emit(this.props, next);
        this.close();
        this.props.onChange?.([...next]);
        this.syncValidity();
        await this.requestUpdate();
        if (!input.isConnected || this.input !== input || !this.editable() || !button) return;
        const document = input.ownerDocument;
        if (document.activeElement !== button && document.activeElement !== document.body) return;
        const buttons = input.parentElement?.querySelectorAll<HTMLButtonElement>('.cs-multiselect__tag-remove');
        const target = keyboard && buttons?.length ? buttons[Math.min(index, buttons.length - 1)] : input;
        target?.focus();
    }
    @Client()
    private syncValidity() { this.input?.setCustomValidity(this.validityMessage); }
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
            const disabledObserver = new MutationObserver(() => { if (!this.editable() && (this.open || this.query)) this.close(); });
            disabledObserver.observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
            queueMicrotask(() => {
                if (!active) return;
                for (let ancestor = input.parentElement; ancestor; ancestor = ancestor.parentElement) {
                    if (ancestor.tagName === 'FIELDSET') disabledObserver.observe(ancestor, { attributes: true, attributeFilter: ['disabled'] });
                }
            });
            const resizeObserver = new ResizeObserver(position);
            resizeObserver.observe(input.parentElement ?? input);
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
        const rect = (input.parentElement ?? input).getBoundingClientRect(), gap = 4;
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
