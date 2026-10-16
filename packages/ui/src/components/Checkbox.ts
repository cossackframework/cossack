import type { CheckControlAttributes } from "../native-attributes";
import { html, classMap, live } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type CheckboxProps = CheckControlAttributes & {
    /** Controlled checked state; re-applied on every render. Omit for a native uncontrolled checkbox. */
    checked?: boolean;
    /** Indeterminate visual (sets the native indeterminate property on mount). */
    indeterminate?: boolean;
    /** Visible label. Takes precedence over children; otherwise provide children or aria-label. */
    label?: string;
}

/**
 * Cossack UI Checkbox — native `<input type="checkbox">` with a token-styled
 * label wrapper. The native control handles focus, form participation, and
 * keyboard; we only theme the surrounding affordance.
 *
 *   <${Checkbox} checked @change=${handler}>Accept terms</${Checkbox}>
 */
@Component()
export class Checkbox extends Cossack {
    declare props: CheckboxProps;

    render() {
        const { checked, indeterminate = false, label, ...rest } = this.props;

        const wrapperClasses = classMap({
            "cs-checkbox": true,
            "inline-flex items-center gap-2 text-sm text-foreground": true,
            "has-[>input:disabled]:opacity-50 has-[>input:disabled]:cursor-not-allowed": true,
        });

        return html`
            <label class=${wrapperClasses}>
                <input
                    type="checkbox"
                    class="cs-checkbox__input disabled:cursor-not-allowed size-4 shrink-0 rounded-[4px] border border-input shadow-xs accent-primary outline-none transition-[color,box-shadow] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:border-ring"
                    .indeterminate=${indeterminate}
                    ...=${checked === undefined ? rest : { '.checked': live(checked), ...rest }}
                />
                ${label ?? this.children}
            </label>
        `;
    }
}
