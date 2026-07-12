import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface SwitchProps {
    /** Checked (on) state. */
    checked?: boolean;
    /** Pass-through HTML input attributes (name, value, disabled, ...). */
    [key: string]: any;
}

/**
 * Cossack UI Switch — a native `<input type="checkbox">` restyled as a toggle,
 * wrapped in a `<label role="switch">` for ARIA semantics. Pure CSS; the native
 * checkbox is visually hidden and drives a styled track/thumb.
 *
 *   ${component(Switch, { checked: this.on, '@change': handler })}
 */
@Component()
export class Switch extends Cossack {
    declare props: SwitchProps;

    render() {
        const { checked = false, ...rest } = this.props;

        const wrapperClasses = classMap({
            "cs-switch": true,
            "relative inline-flex items-center cursor-pointer": true,
            "disabled:opacity-50 disabled:cursor-not-allowed": !!rest.disabled,
        });

        return html`
            <label class=${wrapperClasses} role="switch" aria-checked=${checked}>
                <input
                    type="checkbox"
                    class="cs-switch__input peer sr-only"
                    ?checked=${checked}
                    ...=${rest}
                />
                <span
                    class="cs-switch__track inline-block h-6 w-11 rounded-full bg-muted border border-border transition-colors duration-150 peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/30"
                ></span>
                <span
                    class="cs-switch__thumb absolute left-0.5 top-0.5 inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform duration-150 peer-checked:translate-x-5"
                ></span>
            </label>
        `;
    }
}
