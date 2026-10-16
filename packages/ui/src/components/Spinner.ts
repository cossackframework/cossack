import type { SvgAttributes } from "../native-attributes";
import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type SpinnerProps = Omit<SvgAttributes, 'role' | 'aria-label' | 'aria-labelledby' | 'aria-hidden' | 'aria-live' | 'aria-atomic' | 'tabindex' | 'focusable' | 'width' | 'height' | 'viewBox' | 'stroke' | 'stroke-width' | 'fill'> & {
    /** Pixel size of the spinner (width/height). */
    size?: number;
    /** Stroke width of the ring in px. */
    stroke?: number;
    /** Color token class, e.g. "text-primary" or "text-muted-foreground". */
    color?: string;
    /** Accessible label. When omitted, the spinner is aria-hidden. */
    label?: string;
}

/**
 * Cossack UI Spinner — a CSS-driven loading indicator.
 *
 * Renders an inline SVG with a circular track + a spinning arc (via
 * `animate-spin`). The arc uses `currentColor` so it inherits text color
 * (set via the `color` prop token class).
 *
 *   <${Spinner} size=${24} color="text-primary" label="Loading" />
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

        if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(stroke) || stroke <= 0 || stroke >= size) {
            throw new Error('Spinner requires finite size > stroke > 0.');
        }
        if (label !== undefined && (typeof label !== 'string' || !label.trim())) throw new Error('Spinner label must be nonempty when supplied.');
        const classes = classMap({
            "cs-spinner": true,
            "animate-spin motion-reduce:animate-none inline-block": true,
            [color]: true,
        });

        const a11y = label
            ? { role: "status", "aria-label": label }
            : { "aria-hidden": "true" };

        // SVG spinner: a full circle track at low opacity + an arc that spins.
        const r = (size - stroke) / 2;
        const cx = size / 2;
        const circumference = 2 * Math.PI * r;
        if (!Number.isFinite(circumference) || r <= 0) throw new Error('Spinner geometry exceeds the supported numeric range.');
        // Show ~25% of the circle as the visible arc.
        const arc = circumference * 0.25;

        return html`
            <svg
                class=${classes}
                width="${size}"
                height="${size}"
                viewBox="0 0 ${size} ${size}"
                fill="none"
                focusable="false"
                xmlns="http://www.w3.org/2000/svg"
                ...=${{ ...a11y, ...rest }}
            >
                <title>${label ?? ''}</title>
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
