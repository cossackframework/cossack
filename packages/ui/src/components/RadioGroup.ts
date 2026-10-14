import type { GlobalAttributes, ControlEvent } from "../native-attributes";
import { html, classMap, live, repeat } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type RadioGroupItem = { value: string; label?: unknown; disabled?: boolean; id?: string };

export type RadioGroupProps = Omit<GlobalAttributes<HTMLDivElement>, 'role' | 'aria-orientation'> & {
    /** Shared `name` for the radio inputs (required for native grouping). */
    name: string;
    /** Controlled selected value; re-applied on every render. Omit for native uncontrolled radios. */
    value?: string;
    /** Layout direction. */
    orientation?: "horizontal" | "vertical";
    /** Items: [{ value, label }]. */
    items?: readonly RadioGroupItem[];
    /** Disable every input. A disabled enclosing fieldset also works. */
    disabled?: boolean;
    /** Require one checked radio through native form validation. */
    required?: boolean;
    /** Associate every input with an external form by ID. */
    form?: string;
    /** Native input callback. Root @change remains a bubbling event on the div. */
    onValueChange?: (value: string, event: ControlEvent<HTMLInputElement>) => unknown;
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
        const { name, value, orientation = "vertical", items = [], disabled = false, required = false, form, onValueChange, ...rest } = this.props;

        if (typeof name !== 'string' || !name.trim()) throw new Error('RadioGroup requires a nonempty name.');
        const values = new Set<string>();
        for (const item of items) {
            if (typeof item.value !== 'string' || values.has(item.value)) throw new Error('RadioGroup item values must be unique strings.');
            values.add(item.value);
        }

        const groupClasses = classMap({
            "cs-radio-group": true,
            "flex flex-col gap-2": orientation === "vertical",
            "flex flex-row gap-4": orientation === "horizontal",
        });

        return html`
            <div class=${groupClasses} role="radiogroup" aria-orientation=${orientation} ...=${rest}>
                ${repeat(items, item => item.value,
                    (item) => html`
                        <label
                            class=${classMap({
                                "cs-radio-group__item": true,
                                "inline-flex items-center gap-2 text-sm text-foreground cursor-pointer": true,
                                "has-[>input:disabled]:opacity-50 has-[>input:disabled]:cursor-not-allowed": true,
                            })}
                        >
                            <input
                                type="radio"
                                name=${name}
                                value=${item.value}
                                id=${item.id}
                                form=${form}
                                ...=${value === undefined ? {} : { '.checked': live(value === item.value) }}
                                ?disabled=${disabled || !!item.disabled}
                                ?required=${required}
                                @change=${(event: Event) => {
                                    const input = event.currentTarget as HTMLInputElement;
                                    if (input.checked) onValueChange?.(input.value, event as ControlEvent<HTMLInputElement>);
                                }}
                                class="cs-radio-group__input disabled:cursor-not-allowed size-4 shrink-0 border border-input text-primary accent-primary outline-none transition-[color,box-shadow] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:border-ring"
                            />
                            ${item.label ?? item.value}
                        </label>
                    `,
                )}
            </div>
        `;
    }
}
