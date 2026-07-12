import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface CheckboxProps {
    /** Checked state. */
    checked?: boolean;
    /** Indeterminate visual (sets the native indeterminate property on mount). */
    indeterminate?: boolean;
    /** Render the control inline with a label passed as children. */
    label?: string;
    /** Pass-through HTML input attributes (name, value, disabled, ...). */
    [key: string]: any;
}

/**
 * Cossack UI Checkbox — native `<input type="checkbox">` with a token-styled
 * label wrapper. The native control handles focus, form participation, and
 * keyboard; we only theme the surrounding affordance.
 *
 *   ${component(Checkbox, { checked: true, '@change': handler }, 'Accept terms')}
 */
@Component()
export class Checkbox extends Cossack {
    declare props: CheckboxProps;

    render() {
        const { checked = false, indeterminate = false, ...rest } = this.props;

        const wrapperClasses = classMap({
            "cs-checkbox": true,
            "inline-flex items-center gap-2 text-sm text-foreground": true,
            "disabled:opacity-50": !!rest.disabled,
        });

        return html`
            <label class=${wrapperClasses}>
                <input
                    type="checkbox"
                    class="cs-checkbox__input h-4 w-4 rounded border-border text-primary accent-[var(--color-primary)] focus:ring-2 focus:ring-ring/30"
                    ?checked=${checked}
                    ?indeterminate=${indeterminate}
                    ...=${rest}
                />
                ${this.children}
            </label>
        `;
    }
}
