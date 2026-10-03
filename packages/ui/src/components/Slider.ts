import type { RangeAttributes } from "../native-attributes";
import { html, classMap, live } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type SliderProps = RangeAttributes & {
    /** Controlled value. The browser clamps it to min/max and applies step. */
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
            "aria-label": ariaLabel,
            ...rest
        } = this.props;

        if (![value, min, max, step].every(Number.isFinite) || max < min || step <= 0) {
            throw new Error('Slider requires finite values, max >= min and a positive step.');
        }

        const classes = classMap({
            "cs-slider": true,
            "w-full cursor-pointer": true,
            "disabled:opacity-50 disabled:cursor-not-allowed": true,
        });

        const style = "accent-color: var(--color-primary);";

        // Apply constraints before live value so a formerly clamped value can recover.
        return html`
            <input
                type="range"
                class=${classes}
                style=${style}
                min=${min}
                max=${max}
                step=${step}
                ?disabled=${disabled}
                aria-label=${label ?? ariaLabel}
                ...=${rest}
                .value=${live(value)}
            />
        `;
    }
}
