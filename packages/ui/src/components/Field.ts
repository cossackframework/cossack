import { html } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface FieldProps {
    /** Label text for the field. */
    label?: string;
    /** Optional helper text shown below the control. */
    hint?: string;
    /** Error message — when set, renders in destructive color. */
    error?: string;
    /** The `for` attribute on the label (should match the control's id). */
    for?: string;
    /** Required indicator. */
    required?: boolean;
    [key: string]: any;
}

/**
 * Cossack UI Field — form field wrapper (Label + control + hint/error).
 *
 * Pass the control (Input, Select, etc.) as children. The label, hint, and
 * error are rendered around it with proper spacing.
 *
 *   ${component(Field, { label: 'Email', error: this.emailError, for: 'email' },
 *       component(Input, { id: 'email' }))}
 */
@Component()
export class Field extends Cossack {
    declare props: FieldProps;

    render() {
        const { label, hint, error, for: htmlFor, required = false, ...rest } = this.props;

        return html`
            <div class="cs-field flex flex-col gap-1.5" ...=${rest}>
                ${label
                    ? html`<label class="text-sm font-medium leading-none text-foreground" for=${htmlFor}>
                          ${label}${required ? html`<span class="text-destructive ml-0.5">*</span>` : null}
                      </label>`
                    : null}
                ${this.children}
                ${error
                    ? html`<span class="cs-field__error text-xs text-destructive">${error}</span>`
                    : hint
                        ? html`<span class="cs-field__hint text-xs text-muted-foreground">${hint}</span>`
                        : null}
            </div>
        `;
    }
}
