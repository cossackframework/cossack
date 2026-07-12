import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface RadioGroupProps {
    /** Shared `name` for the radio inputs (required for native grouping). */
    name: string;
    /** Currently selected value. */
    value?: string;
    /** Layout direction. */
    orientation?: "horizontal" | "vertical";
    /** Items: [{ value, label }]. */
    items?: Array<{ value: string; label?: unknown; disabled?: boolean }>;
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

/**
 * Cossack UI Radio Group — native `<input type="radio">` group.
 *
 * Native radios handle form participation, keyboard (Arrow Up/Down), and
 * accessibility. We theme the label/control wrapper with tokens.
 *
 *   ${component(RadioGroup, {
 *       name: 'plan',
 *       value: 'pro',
 *       items: [
 *           { value: 'free', label: 'Free' },
 *           { value: 'pro', label: 'Pro' },
 *       ],
 *   })}
 */
@Component()
export class RadioGroup extends Cossack {
    declare props: RadioGroupProps;

    render() {
        const { name, value, orientation = "vertical", items = [], ...rest } = this.props;

        const groupClasses = classMap({
            "cs-radio-group": true,
            "flex flex-col gap-2": orientation === "vertical",
            "flex flex-row gap-4": orientation === "horizontal",
        });

        return html`
            <div class=${groupClasses} role="radiogroup" ...=${rest}>
                ${items.map(
                    (item) => html`
                        <label
                            class=${classMap({
                                "cs-radio-group__item": true,
                                "inline-flex items-center gap-2 text-sm text-foreground cursor-pointer": true,
                                "opacity-50 cursor-not-allowed": !!item.disabled,
                            })}
                        >
                            <input
                                type="radio"
                                name=${name}
                                value=${item.value}
                                ?checked=${value === item.value}
                                ?disabled=${!!item.disabled}
                                class="cs-radio-group__input h-4 w-4 border-border text-primary accent-[var(--color-primary)] focus:ring-2 focus:ring-ring/30"
                            />
                            ${item.label ?? item.value}
                        </label>
                    `,
                )}
            </div>
        `;
    }
}
