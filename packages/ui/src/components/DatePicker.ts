import { html, component, live, PreventDefaultResult, preventDefault, type nothing } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState } from "@cossackframework/core";
import type { GlobalAttributes, ControlEvent } from "../native-attributes";
import { Calendar } from "./Calendar";
import { parseDate, dateRange, dateLabel } from "../internal/date";

export type DatePickerProps = Omit<GlobalAttributes<HTMLInputElement>, 'id' | 'role'> & {
    /** Stable page-unique input ID. Label with for=id or aria-label. */
    id: string;
    /** Controlled Gregorian date, yyyy-mm-dd or empty. Accept onChange to retain edits. */
    value?: string;
    defaultValue?: string;
    min?: string;
    max?: string;
    name?: string;
    form?: string;
    required?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    /** Called for a changed native input or calendar selection, including empty after clearing. */
    onChange?: (iso: string) => unknown;
    /** Locale for the custom calendar; the native date field follows browser settings. */
    locale?: string;
    weekStartsOn?: number;
    today?: string;
    openLabel?: string;
    calendarLabel?: string;
    previousLabel?: string;
    nextLabel?: string;
};
type InputListener = ((event: ControlEvent<HTMLInputElement, InputEvent>) => unknown) | PreventDefaultResult | null | typeof nothing | undefined;

/** Native date field with a shared Calendar in a nonmodal popover. */
@Component()
export class DatePicker extends Cossack {
    declare props: DatePickerProps;
    @ClientState() private draft: string | undefined;
    @ClientState() private open = false;
    private initialValue?: string;
    private input?: HTMLInputElement;
    private trigger?: HTMLButtonElement;
    private popup?: HTMLElement;
    private cleanup?: () => void;
    private get currentValue() { this.initialValue ??= this.props.defaultValue ?? ''; return this.props.value ?? this.draft ?? this.initialValue; }

    render() {
        const { id, value: _value, defaultValue: _default, min, max, name, form, required = false, disabled = false, readonly = false,
            onChange: _change, locale = 'en-US', weekStartsOn, today, openLabel = 'Choose date', calendarLabel = 'Choose date',
            previousLabel, nextLabel, ...rest } = this.props;
        if (typeof id !== 'string' || !id || /\s/.test(id)) throw new Error('DatePicker requires a nonempty, whitespace-free id.');
        parseDate(this.currentValue, 'value'); parseDate(today, 'today'); dateRange(min, max);
        if (weekStartsOn !== undefined && (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6)) throw new RangeError('DatePicker weekStartsOn must be an integer from 0 to 6.');
        const supplied: InputListener = rest['@input'];
        const inputListener: EventListener = event => {
            const inputEvent = event as ControlEvent<HTMLInputElement, InputEvent>;
            if (typeof supplied === 'function') supplied(inputEvent);
            else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
            if (!event.defaultPrevented) this.commit(inputEvent);
        };
        const events = { '@input': supplied instanceof PreventDefaultResult ? preventDefault(inputListener, { novalidate: supplied.novalidate }) : inputListener };
        const expanded = this.open && !disabled && !readonly;
        return html`<div class="cs-datepicker relative inline-flex w-full items-center gap-1">
            <input ref=${(element: Element) => this.connect(element as HTMLInputElement)} id=${id} type="date" name=${name} form=${form}
                min=${min} max=${max} ?required=${required} ?disabled=${disabled} ?readonly=${readonly} .value=${live(this.currentValue)}
                class="cs-datepicker__input min-w-0 flex-1 rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm shadow-xs focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 disabled:cursor-not-allowed"
                ...=${{ ...rest, ...events }} />
            <button ref=${(element: Element) => { this.trigger = element as HTMLButtonElement; }} type="button" ?disabled=${disabled || readonly}
                aria-label=${this.currentValue ? `${openLabel}: ${dateLabel(this.currentValue, locale)}` : openLabel} aria-haspopup="dialog" aria-controls=${`${id}-popup`} aria-expanded=${String(expanded)}
                class="cs-datepicker__trigger shrink-0 rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm shadow-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 disabled:cursor-not-allowed"
                @click=${() => this.toggle()}>${openLabel}</button>
            <div ref=${(element: Element) => { this.popup = element as HTMLElement; }} id=${`${id}-popup`} role="dialog" aria-label=${calendarLabel} popover="auto"
                class="cs-datepicker__panel bg-popover text-popover-foreground rounded-lg border shadow-lg max-h-[90vh] overflow-auto"
                style="position:fixed;margin:0;padding:0;"
                @keydown=${(event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void this.close(true); } }}
                @focusout=${(event: FocusEvent) => { const target = event.relatedTarget as Node | null; if (target && !this.popup?.contains(target) && target !== this.trigger) void this.close(false); }}
                @toggle=${(event: Event) => { if ((event as ToggleEvent).newState === 'closed' && this.popup && !this.popup.matches(':popover-open')) { this.open = false; } }}>
                ${expanded ? component(Calendar, { id: `${id}-calendar`, value: this.currentValue, min, max, locale, weekStartsOn, today, previousLabel, nextLabel,
                    disabled, readonly, onSelect: iso => this.pick(iso) }) : null}
            </div>
        </div>`;
    }

    @Client()
    private editable() { return !!this.input && !this.input.matches(':disabled') && !this.input.readOnly; }
    @Client()
    private commit(event: ControlEvent<HTMLInputElement, InputEvent>) {
        if (!this.editable()) { event.currentTarget.value = this.currentValue; return; }
        const value = event.currentTarget.value, previous = this.currentValue;
        // Native date inputs provide either a real date or empty while incomplete.
        parseDate(value, 'value');
        this.draft = value;
        if (value !== previous) this.props.onChange?.(value);
        void this.requestUpdate();
    }
    @Client()
    private pick(iso: string) {
        const range = dateRange(this.props.min, this.props.max);
        if (!this.editable() || iso < range.first || iso > range.last) return;
        this.input!.value = iso;
        this.input!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
        void this.close(true);
    }
    @Client()
    private async toggle() {
        if (!this.editable()) return;
        if (this.open) { await this.close(false); return; }
        this.open = true;
        const trigger = this.trigger;
        await this.requestUpdate();
        if (!this.open || !this.editable() || !trigger?.isConnected || !this.popup?.isConnected) return;
        const document = trigger.ownerDocument;
        if (document.activeElement !== trigger && document.activeElement !== this.input) { this.open = false; return; }
        if (!this.popup.matches(':popover-open')) this.popup.showPopover();
        this.position();
        this.popup.querySelector<HTMLButtonElement>('button[data-date][tabindex="0"]:not(:disabled)')?.focus();
    }
    @Client()
    private async close(restoreFocus: boolean) {
        const popup = this.popup, trigger = this.trigger;
        const document = trigger?.ownerDocument;
        const ownedFocus = !!document && (document.activeElement === trigger || !!popup?.contains(document.activeElement));
        this.open = false;
        if (popup?.matches(':popover-open')) popup.hidePopover();
        await this.requestUpdate();
        if (restoreFocus && ownedFocus && trigger?.isConnected && trigger === this.trigger && this.editable()
            && (document!.activeElement === document!.body || document!.activeElement === trigger || !!popup?.contains(document!.activeElement))) trigger.focus();
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
                queueMicrotask(() => { if (active && !event.defaultPrevented) { this.draft = undefined; void this.close(false); } });
            };
            const position = () => this.position();
            document.addEventListener('reset', reset, true);
            document.addEventListener('scroll', position, true);
            window?.addEventListener('resize', position);
            const observer = new MutationObserver(() => { if (this.open && !this.editable()) void this.close(false); });
            observer.observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
            queueMicrotask(() => {
                if (!active) return;
                for (let parent = input.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'FIELDSET') observer.observe(parent, { attributes: true, attributeFilter: ['disabled'] });
            });
            const resizeObserver = new ResizeObserver(position);
            resizeObserver.observe(input);
            this.cleanup = () => {
                active = false; observer.disconnect(); resizeObserver.disconnect();
                document.removeEventListener('reset', reset, true);
                document.removeEventListener('scroll', position, true);
                window?.removeEventListener('resize', position);
            };
        }
        queueMicrotask(() => {
            if (this.input !== input || !input.isConnected) return;
            if (!this.editable() && this.popup?.matches(':popover-open')) void this.close(false);
            else this.position();
        });
    }
    @Client()
    private position() {
        const input = this.input, popup = this.popup, window = input?.ownerDocument.defaultView;
        if (!input || !popup?.matches(':popover-open') || !window) return;
        const rect = (input.parentElement ?? input).getBoundingClientRect(), gap = 4;
        const bounds = popup.getBoundingClientRect(), below = window.innerHeight - rect.bottom - gap;
        popup.style.maxWidth = `${window.innerWidth}px`;
        popup.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - bounds.width))}px`;
        popup.style.top = below < bounds.height && rect.top > below ? `${Math.max(0, rect.top - gap - bounds.height)}px` : `${rect.bottom + gap}px`;
    }
    onCleanup() { this.cleanup?.(); this.cleanup = undefined; this.input = undefined; this.trigger = undefined; this.popup = undefined; }
}
