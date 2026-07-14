import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface SliderProps {
    /** Current value. */
    value?: number;
    /** Minimum value. Default 0. */
    min?: number;
    /** Maximum value. Default 100. */
    max?: number;
    /** Step increment. Default 1. */
    step?: number;
    /** Disabled state. */
    disabled?: boolean;
    /** Accessible label (required for a11y on a standalone slider). */
    label?: string;
    /** Pass-through HTML input attributes (name, id, ...). */
    [key: string]: any;
}

/**
 * Cossack UI Slider — native `<input type="range">`.
 *
 * The native range input handles keyboard (Arrow keys), touch, form
 * participation, and accessibility. We theme the track/thumb via the
 * `accent-color` CSS property bound to the primary token (simplest cross-
 * browser approach).
 *
 *   ${component(Slider, { value: 40, min: 0, max: 100, label: 'Volume' })}
 */
@Component()
export class Slider extends Cossack {
    declare props: SliderProps;

    render() {
        const {
            value = 0,
            min = 0,
            max = 100,
            step = 1,
            disabled = false,
            label,
            ...rest
        } = this.props;

        const classes = classMap({
            "cs-slider": true,
            "w-full cursor-pointer": true,
            "opacity-50 cursor-not-allowed": disabled,
        });

        const style = "accent-color: var(--color-primary);";

        return html`
            <input
                type="range"
                class=${classes}
                style=${style}
                .value=${value}
                min=${min}
                max=${max}
                step=${step}
                ?disabled=${disabled}
                aria-label=${label}
                ...=${rest}
            />
        `;
    }
}
