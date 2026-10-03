import { html, classMap, live, PreventDefaultResult, preventDefault, type nothing } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState } from "@cossackframework/core";
import type { InputAttributes, GlobalAttributes, ControlEvent } from "../native-attributes";

type OTPAttributes = Pick<InputAttributes, keyof GlobalAttributes<HTMLInputElement> |
    'name' | 'form' | 'required' | '?required' | 'disabled' | '?disabled' | 'readonly' | '?readonly' | 'enterkeyhint'>;
export type InputOTPProps = OTPAttributes & {
    /** Number of digit slots, from 1 to 32. Default 6. */
    length?: number;
    /** Controlled code. Update this in onChange to accept edits. */
    value?: string;
    /** Initial code when value is omitted. */
    defaultValue?: string;
    /** Called for a changed code with the native input event. */
    onChange?: (value: string, event: ControlEvent<HTMLInputElement>) => unknown;
    /** Called for a changed, complete code after onChange. Not called for initial/parent values. */
    onComplete?: (value: string, event: ControlEvent<HTMLInputElement>) => unknown;
    size?: "sm" | "default" | "lg";
    autocomplete?: 'one-time-code' | 'off';
};

const SIZES = { sm: 'size-9 text-base', default: 'size-11 text-lg', lg: 'size-12 text-xl' };
const digits = (value: string, length: number) => value.replace(/[^0-9]/g, '').slice(0, length);
type Listener<E extends Event> = ((event: E) => unknown) | PreventDefaultResult | null | typeof nothing | undefined;

function compose<E extends Event>(own: (event: E) => unknown, supplied: Listener<E>, suppliedFirst = false) {
    const runSupplied = (event: E) => {
        if (typeof supplied === 'function') supplied(event);
        else if (supplied instanceof PreventDefaultResult) supplied.handler.call(event.currentTarget, event);
    };
    const listener: EventListener = event => {
        if (suppliedFirst) runSupplied(event as E);
        own(event as E);
        if (!suppliedFirst) runSupplied(event as E);
    };
    return supplied instanceof PreventDefaultResult ? preventDefault(listener, { novalidate: supplied.novalidate }) : listener;
}

/** One native one-time-code input with decorative digit slots. Label the input through id/for or aria-label. */
@Component()
export class InputOTP extends Cossack {
    declare props: InputOTPProps;
    @ClientState() private draft: string | undefined;
    private initialValue: string | undefined;
    private boundInput?: HTMLInputElement;
    private resetCleanup?: () => void;
    private composingInput: HTMLInputElement | null = null;
    @ClientState() private focused = false;
    @ClientState() private start = 0;
    @ClientState() private end = 0;

    private get digitCount() {
        const length = this.props.length ?? 6;
        if (!Number.isInteger(length) || length < 1 || length > 32) throw new RangeError('InputOTP length must be an integer from 1 to 32.');
        return length;
    }
    private get code() {
        this.initialValue ??= this.props.defaultValue ?? '';
        return digits(this.props.value ?? this.draft ?? this.initialValue, this.digitCount);
    }

    render() {
        const { length: _length, value: _value, defaultValue: _default, onChange: _change, onComplete: _complete,
            size = 'default', autocomplete = 'one-time-code', ...rest } = this.props;
        const length = this.digitCount, nativeValue = this.composingInput?.value ?? this.code;
        const code = digits(nativeValue, length);
        const events = {
            '@input': compose<ControlEvent<HTMLInputElement, InputEvent>>(event => {
                if (event.isComposing) { this.composingInput = event.currentTarget; this.selection(event); void this.requestUpdate(); }
                else this.commit(event);
            }, rest['@input']),
            '@compositionstart': compose<ControlEvent<HTMLInputElement, CompositionEvent>>(event => { this.composingInput = event.currentTarget; }, rest['@compositionstart']),
            '@compositionend': compose<ControlEvent<HTMLInputElement, CompositionEvent>>(event => { this.composingInput = null; this.commit(event); }, rest['@compositionend']),
            '@paste': compose<ControlEvent<HTMLInputElement, ClipboardEvent>>(event => this.paste(event), rest['@paste'], true),
            '@focus': compose<ControlEvent<HTMLInputElement, FocusEvent>>(event => { this.focused = true; this.selection(event); }, rest['@focus']),
            '@blur': compose<ControlEvent<HTMLInputElement, FocusEvent>>(() => { this.composingInput = null; this.focused = false; }, rest['@blur']),
            '@select': compose<ControlEvent<HTMLInputElement>>(event => this.selection(event), rest['@select']),
            '@keyup': compose<ControlEvent<HTMLInputElement, KeyboardEvent>>(event => this.selection(event), rest['@keyup']),
            '@click': compose<ControlEvent<HTMLInputElement, PointerEvent>>(event => this.click(event), rest['@click']),
        };
        return html`<div class="cs-input-otp group/otp relative inline-flex items-center gap-2">
            <input ref=${(input: Element) => this.connectInput(input as HTMLInputElement)} type="text" inputmode="numeric" autocomplete=${autocomplete} maxlength=${length} minlength=${length}
                pattern=${`[0-9]{${length}}`} .value=${live(nativeValue)}
                class="cs-input-otp__input absolute inset-0 z-10 h-full w-full min-w-0 opacity-0 cursor-text disabled:cursor-not-allowed read-only:cursor-default"
                ...=${{ ...rest, ...events }} />
            ${Array.from({ length }, (_, index) => html`<span aria-hidden="true" class=${classMap({
                'cs-input-otp__box pointer-events-none relative inline-flex items-center justify-center shrink-0 rounded-md border border-input text-center font-medium shadow-xs': true,
                'group-has-[>input:disabled]/otp:opacity-50 group-has-[>input[aria-invalid=true]]/otp:border-destructive': true,
                'border-ring ring-ring/50 ring-[3px]': this.focused && this.start === this.end && index === Math.min(this.start, length - 1),
                'bg-background text-foreground': !(this.focused && index >= this.start && index < this.end),
                'bg-accent text-accent-foreground': this.focused && index >= this.start && index < this.end,
                [SIZES[size]]: true,
            })}>${code[index] ?? ''}${this.focused && this.start === this.end && this.start === index && !code[index]
                ? html`<span class="h-5 w-px bg-current"></span>` : null}</span>`)}
        </div>`;
    }

    @Client()
    private connectInput(input: HTMLInputElement) {
        if (this.boundInput === input) return;
        this.resetCleanup?.();
        this.boundInput = input;
        let active = true;
        const reset = (event: Event) => {
            if (event.target !== input.form) return;
            // Reset defaults run after event listeners and can be canceled by the app.
            queueMicrotask(() => {
                if (!active || event.defaultPrevented) return;
                this.composingInput = null;
                this.draft = undefined;
                input.value = this.code;
                this.start = input.selectionStart ?? 0;
                this.end = input.selectionEnd ?? this.start;
                void this.requestUpdate();
            });
        };
        const document = input.ownerDocument;
        document.addEventListener('reset', reset, true);
        this.resetCleanup = () => { active = false; document.removeEventListener('reset', reset, true); };
    }

    onCleanup() {
        this.resetCleanup?.();
        this.resetCleanup = undefined;
        this.boundInput = undefined;
        this.composingInput = null;
    }

    @Client()
    private selection(event: ControlEvent<HTMLInputElement>) {
        this.start = event.currentTarget.selectionStart ?? 0;
        this.end = event.currentTarget.selectionEnd ?? this.start;
    }

    @Client()
    private commit(event: ControlEvent<HTMLInputElement>) {
        const input = event.currentTarget;
        const previous = this.code, length = this.digitCount;
        if (input.matches(':disabled') || input.readOnly) { input.value = previous; return; }
        const next = digits(input.value, length);
        const caret = digits(input.value.slice(0, input.selectionStart ?? input.value.length), length).length;
        input.value = next;
        input.setSelectionRange(caret, caret);
        this.selection(event);
        this.draft = next;
        if (next !== previous) {
            this.props.onChange?.(next, event);
            if (next.length === length) this.props.onComplete?.(next, event);
        }
        // Controlled parents can reject an edit; restore their value after callbacks.
        void this.requestUpdate();
    }

    @Client()
    private paste(event: ControlEvent<HTMLInputElement, ClipboardEvent>) {
        const input = event.currentTarget;
        if (event.defaultPrevented || input.matches(':disabled') || input.readOnly) return;
        const text = event.clipboardData?.getData('text');
        if (text === undefined) return;
        event.preventDefault();
        const clean = digits(text, this.digitCount);
        if (!clean) return;
        const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
        const available = this.digitCount - (input.value.length - (end - start));
        const insertion = clean.slice(0, Math.max(0, available));
        const previous = input.value;
        input.setRangeText(insertion, start, end, 'end');
        if (input.value !== previous) input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: insertion }));
    }

    @Client()
    private click(event: ControlEvent<HTMLInputElement, PointerEvent>) {
        const input = event.currentTarget;
        if (event.detail === 1 && !event.shiftKey && input.selectionStart === input.selectionEnd) {
            const slots = input.parentElement?.querySelectorAll<HTMLElement>('.cs-input-otp__box');
            if (slots?.length) {
                const index = [...slots].findIndex(slot => event.clientX < slot.getBoundingClientRect().right);
                const caret = Math.min(index < 0 ? slots.length : index, input.value.length);
                input.setSelectionRange(caret, caret);
            }
        }
        this.selection(event);
    }
}
