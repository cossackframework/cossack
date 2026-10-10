import { html } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';

/** Spread these onto the actual input, select or textarea, not an outer wrapper. */
export type FieldControlAttributes = Readonly<{
    id: string;
    required: boolean;
    'aria-describedby': string | undefined;
    'aria-invalid': 'true' | undefined;
}>;
export type FieldProps = GlobalAttributes<HTMLDivElement> & {
    /** Visible label for one native, labelable control. */
    label: string;
    /** Unique control ID. Hint/error IDs derive from this value. */
    for: string;
    hint?: string;
    error?: string;
    required?: boolean;
    /** Render the control with its shared accessibility attributes. */
    control: (attributes: FieldControlAttributes) => unknown;
};

/** Field owns label/description relationships; its caller owns the actual control. */
@Component()
export class Field extends Cossack {
    declare props: FieldProps;
    render() {
        const { label, hint, error, for: htmlFor, required = false, control, ...rest } = this.props;
        if (typeof htmlFor !== 'string' || !htmlFor || /\s/.test(htmlFor)) throw new Error('Field requires a nonempty control ID without whitespace in for.');
        if (typeof label !== 'string' || !label.trim()) throw new Error('Field requires a nonempty label.');
        if (typeof control !== 'function') throw new Error('Field requires a control callback; move control children into that callback.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('Field renders its control callback; separate children are not supported.');
        for (const [name, value] of [['hint', hint], ['error', error]] as const) {
            if (value !== undefined && typeof value !== 'string') throw new Error(`Field ${name} must be a string when supplied.`);
        }
        if (typeof required !== 'boolean') throw new Error('Field required must be boolean.');
        const hasHint = !!hint?.trim(), hasError = !!error?.trim();
        const hintId = `${htmlFor}-hint`, errorId = `${htmlFor}-error`;
        const description = [hasHint ? hintId : '', hasError ? errorId : ''].filter(Boolean).join(' ') || undefined;
        const content = control({ id: htmlFor, required, 'aria-describedby': description, 'aria-invalid': hasError ? 'true' : undefined });
        return html`<div class="cs-field flex flex-col gap-1.5" ...=${rest}>
            <label class="text-sm font-medium leading-none text-foreground" for=${htmlFor}>
                ${label}${required ? html`<span aria-hidden="true" class="text-destructive ml-0.5">*</span>` : null}
            </label>
            ${content}
            ${hasHint ? html`<span id=${hintId} class="cs-field__hint text-xs text-muted-foreground">${hint}</span>` : null}
            ${hasError ? html`<span id=${errorId} class="cs-field__error text-xs text-destructive">${error}</span>` : null}
        </div>`;
    }
}
