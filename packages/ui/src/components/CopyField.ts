import type { GlobalAttributes } from '../native-attributes';
import { html, component, type TemplateResult } from "@cossackframework/renderer";
import { Cossack, Component, Client, ClientState, createRef, type RefObject } from "@cossackframework/core";
import { Button } from "./Button";

export type CopyFieldProps = GlobalAttributes<HTMLDivElement> & {
    /** The text to copy. It shows in a read-only field, so it can be selected by hand. */
    value: string;
    /** Accessible name of the field, such as "New API key". */
    label: string;
    /** Button text. Defaults to "Copy". */
    copyLabel?: string;
    /** Button text after a copy. Defaults to "Copied.". */
    copiedLabel?: string;
    /** Shown when the browser refuses the clipboard; the text is then selected. Defaults to "Copy it from the box.". */
    copyFailedLabel?: string;
    /** Monospace text, for keys and codes. Defaults to true. */
    mono?: boolean;
    /** Lines for a multi-line value, such as recovery codes. Defaults to one line, or the value's lines. */
    rows?: number;
    /** Called after the browser copied the value. */
    onCopy?: (value: string) => unknown;
};

/**
 * Cossack UI CopyField — a read-only value with a Copy button.
 *
 * The button copies through the Clipboard API. When the browser refuses (no permission, an
 * insecure page), the field selects the text and a message asks to copy it by hand.
 *
 *   <${CopyField} label="Invitation link" value=${link} />
 */
@Component()
export class CopyField extends Cossack {
    declare props: CopyFieldProps;
    /** The outcome of the last copy, for its message: shown briefly after a copy, kept after a failure. */
    @ClientState() private copied: 'yes' | 'no' | '' = '';
    /** The message in the status region; VoiceOver skips a repeat of the previous one, so a repeat gets a no-break space. */
    @ClientState() private announced = '';
    private copiedValue = '';
    private lastMessage = '';
    private clearTimer: ReturnType<typeof setTimeout> | undefined;
    private field: RefObject<HTMLInputElement | HTMLTextAreaElement> = createRef();

    @Client()
    async copy() {
        const value = this.props.value;
        let ok = true;
        try { await navigator.clipboard.writeText(value); }
        catch { ok = false; }
        this.report(ok, value);
        if (ok) await this.props.onCopy?.(value);
        else {
            this.field.value?.focus();
            this.field.value?.select();
        }
    }

    /** One status region tells sighted and screen reader users the same thing; a success clears itself, a failure stays until the next try. */
    @Client()
    private report(ok: boolean, value: string) {
        const { copiedLabel = 'Copied.', copyFailedLabel = 'Copy it from the box.' } = this.props;
        clearTimeout(this.clearTimer);
        const text = ok ? copiedLabel : copyFailedLabel;
        const message = text === this.lastMessage ? `${text}\u00A0` : text;
        this.lastMessage = message;
        this.copied = ok ? 'yes' : 'no';
        this.copiedValue = value;
        this.announced = message;
        if (ok) this.clearTimer = setTimeout(() => { this.copied = ''; this.announced = ''; }, 2000);
    }

    onCleanup() {
        clearTimeout(this.clearTimer);
    }

    render() {
        const { value, label, copyLabel = 'Copy', copiedLabel: _copied, copyFailedLabel: _failed, mono = true, rows, onCopy: _onCopy, ...rest } = this.props;
        if (typeof value !== 'string') throw new Error('CopyField requires a string value.');
        if (typeof label !== 'string' || !label.trim()) throw new Error('CopyField requires a label.');
        // A new value starts over: "Copied." belongs to the value that was copied.
        const state = this.copiedValue === value ? this.copied : '';
        const message = state ? this.announced : '';
        const lines = rows ?? value.split('\n').length;
        const fieldClass = `cs-copy-field__value w-full min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground ${mono ? 'font-mono text-xs' : ''}`;
        const field = lines > 1
            ? html`<textarea ref=${this.field} readonly rows=${lines} class=${`${fieldClass} resize-y`} aria-label=${label} .value=${value}></textarea>`
            : html`<input ref=${this.field} readonly class=${fieldClass} aria-label=${label} .value=${value}>`;
        return html`<div class="cs-copy-field space-y-1" ...=${rest}>
            <div class="flex items-start gap-2">${field}
                ${component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => this.copy() }, copyLabel)}</div>
            <p role="status" data-copy-state=${state} class=${`min-h-4 text-xs ${state === 'no' ? 'text-destructive' : 'text-muted-foreground'}`}>${message}</p>
        </div>`;
    }
}

export type SecretNoticeProps = Omit<CopyFieldProps, 'label' | 'title'> & {
    /** What the value is, such as "New API key": the field's accessible name. */
    label: string;
    /** A heading above the instruction, such as "Invitation for ada@example.com". */
    title?: string | TemplateResult;
    /** The instruction above the field. Defaults to "Copy it now. You will not see it again.". */
    message?: string | TemplateResult;
    /** A note under the field, such as when the invitation expires. */
    note?: string | TemplateResult;
    /** Shows a Done button that calls it; the caller then hides the notice. */
    onDone?: () => unknown;
    /** The Done button's text. Defaults to "Done". */
    doneLabel?: string;
};

/**
 * Cossack UI SecretNotice — a value shown once: an API key, a token, an invitation code.
 *
 *   ${this.newKey ? html`<${SecretNotice} label="New API key" value=${this.newKey} .onDone=${() => (this.newKey = '')} />` : null}
 *
 * The caller decides when it disappears; the server should not be able to show the value again.
 */
@Component()
export class SecretNotice extends Cossack {
    declare props: SecretNoticeProps;

    render() {
        const { title, message = 'Copy it now. You will not see it again.', note, onDone, doneLabel = 'Done', id, class: className, style, ...field } = this.props;
        return html`<div class="cs-secret-notice space-y-2 rounded-md border border-success/40 bg-success/5 p-3" ...=${{ id, class: className, style }} role="group" aria-label=${field.label}>
            ${title ? html`<p class="cs-secret-notice__title text-sm font-semibold text-foreground">${title}</p>` : null}
            <p class="text-sm ${title ? 'text-muted-foreground' : 'font-medium text-foreground'}">${message}</p>
            ${component(CopyField, field as CopyFieldProps)}
            ${note ? html`<p class="cs-secret-notice__note text-xs text-muted-foreground">${note}</p>` : null}
            ${onDone ? html`<div class="flex justify-end">${component(Button, { type: 'button', size: 'sm', '@click': () => onDone() }, doneLabel)}</div>` : null}
        </div>`;
    }
}
