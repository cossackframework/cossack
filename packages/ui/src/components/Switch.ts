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
 * wrapped in a `<label>` for accessible naming. The switch role stays on the
 * native checkbox, avoiding nested interactive semantics. Pure CSS; the native
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
            <label class=${wrapperClasses}>
                <input
                    type="checkbox"
                    role="switch"
                    aria-checked=${checked}
                    class="cs-switch__input peer sr-only"
                    ?checked=${checked}
                    ...=${rest}
                />
                <span
                    class="cs-switch__track inline-block h-6 w-11 rounded-full border border-transparent bg-input transition-colors duration-200 peer-checked:bg-primary peer-focus-visible:ring-ring/50 peer-focus-visible:ring-[3px] peer-focus-visible:border-ring"
                ></span>
                <span
                    class="cs-switch__thumb absolute left-0.5 top-0.5 inline-block size-5 rounded-full bg-background shadow-lg ring-0 transition-[translate,transform] duration-200 ease-out peer-checked:translate-x-5"
                ></span>
            </label>
        `;
    }
}
