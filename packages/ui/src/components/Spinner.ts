import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface SpinnerProps {
    /** Pixel size of the spinner (width/height). */
    size?: number;
    /** Stroke width of the ring in px. */
    stroke?: number;
    /** Color token class, e.g. "text-primary" or "text-muted-foreground". */
    color?: string;
    /** Accessible label. When omitted, the spinner is aria-hidden. */
    label?: string;
    /** Allow arbitrary HTML attributes to spread onto the spinner. */
    [key: string]: any;
}

/**
 * Cossack UI Spinner — a CSS-driven loading indicator.
 *
 * Renders an inline SVG with a circular track + a spinning arc (via
 * `animate-spin`). The arc uses `currentColor` so it inherits text color
 * (set via the `color` prop token class).
 *
 *   ${component(Spinner, { size: 24, color: 'text-primary', label: 'Loading' })}
 */
@Component()
export class Spinner extends Cossack {
    declare props: SpinnerProps;

    render() {
        const {
            size = 20,
            stroke = 2,
            color = "text-primary",
            label,
            ...rest
        } = this.props;

        const classes = classMap({
            "cs-spinner": true,
            "animate-spin inline-block": true,
            [color]: true,
        });

        const a11y = label
            ? { role: "status", "aria-label": label }
            : { "aria-hidden": "true" };

        // SVG spinner: a full circle track at low opacity + an arc that spins.
        const r = (size - stroke) / 2;
        const cx = size / 2;
        const circumference = 2 * Math.PI * r;
        // Show ~25% of the circle as the visible arc.
        const arc = circumference * 0.25;

        return html`
            <svg
                class=${classes}
                width="${size}"
                height="${size}"
                viewBox="0 0 ${size} ${size}"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                ...=${{ ...a11y, ...rest }}
            >
                <circle
                    cx="${cx}"
                    cy="${cx}"
                    r="${r}"
                    stroke="currentColor"
                    stroke-width="${stroke}"
                    class="opacity-20"
                />
                <circle
                    cx="${cx}"
                    cy="${cx}"
                    r="${r}"
                    stroke="currentColor"
                    stroke-width="${stroke}"
                    stroke-linecap="round"
                    stroke-dasharray="${arc} ${circumference}"
                />
            </svg>
        `;
    }
}
