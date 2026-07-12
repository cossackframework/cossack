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
 * Uses Tailwind v4's built-in `animate-spin` keyframes; no custom CSS needed.
 * The ring color is `currentColor` so it inherits text color (set via the
 * `color` prop token class).
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
            "animate-spin inline-block rounded-full": true,
            "border-current border-t-transparent": true,
            [color]: true,
        });

        const a11y = label
            ? { role: "status", "aria-label": label }
            : { "aria-hidden": "true" };

        return html`
            <span
                class=${classes}
                style=${`width:${size}px;height:${size}px;border-width:${stroke}px;`}
                ...=${{ ...a11y, ...rest }}
            ></span>
        `;
    }
}
