import type { CheckControlAttributes } from "../native-attributes";
import { html, classMap, live } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type SwitchProps = CheckControlAttributes & {
    /** Controlled on state; re-applied on every render. Omit for a native uncontrolled switch. */
    checked?: boolean;
}

/**
 * Cossack UI Switch — a native `<input type="checkbox">` restyled as a toggle,
 * wrapped in a `<label>` for accessible naming. The switch role stays on the
 * native checkbox, avoiding nested interactive semantics. Pure CSS; the native
 * checkbox is visually hidden and drives a styled track/thumb.
 *
 *   <${Switch} checked=${this.on} @change=${handler} />
 */
@Component()
export class Switch extends Cossack {
    declare props: SwitchProps;

    render() {
        const { checked, ...rest } = this.props;

        const wrapperClasses = classMap({
            "cs-switch": true,
            "relative inline-flex items-center cursor-pointer": true,
            "has-[>input:disabled]:opacity-50 has-[>input:disabled]:cursor-not-allowed": true,
        });

        return html`
            <label class=${wrapperClasses}>
                <input
                    type="checkbox"
                    role="switch"
                    class="cs-switch__input peer sr-only"
                    ...=${checked === undefined ? rest : { '.checked': live(checked), ...rest }}
                />
                <span
                    class="cs-switch__track inline-block h-6 w-11 rounded-full border border-transparent bg-input transition-colors duration-200 peer-checked:bg-primary peer-focus-visible:ring-ring/50 peer-focus-visible:ring-[3px] peer-focus-visible:border-ring"
                ></span>
                <span
                    class="cs-switch__thumb absolute left-0.5 top-0.5 inline-block size-5 rounded-full bg-background shadow-lg ring-0 transition-[translate,transform] duration-200 ease-out peer-checked:translate-x-5"
                ></span>
                ${this.children}
            </label>
        `;
    }
}
