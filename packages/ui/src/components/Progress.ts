import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface ProgressProps {
    /** Current value, clamped to 0..max. Non-finite values fall back to 0. */
    value?: number;
    /** Positive, finite maximum value. Invalid values fall back to 100. */
    max?: number;
    /** Size token: sm | md | lg. Controls height. */
    size?: "sm" | "md" | "lg";
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

const SIZES: Record<NonNullable<ProgressProps["size"]>, string> = {
    sm: "h-1",
    md: "h-2",
    lg: "h-3",
};

/**
 * Cossack UI Progress — token-styled progress bar.
 *
 * Uses a native `<div role="progressbar">` (not the `<progress>` element) for
 * consistent cross-browser token theming. The native `<progress>` is hard to
 * style across browsers; a div with `aria-valuenow`/`aria-valuemax` gives the
 * same semantics with full control.
 *
 *   ${component(Progress, { value: 60, max: 100 })}
 */
@Component()
export class Progress extends Cossack {
    declare props: ProgressProps;

    render() {
        const { value = 0, max = 100, size = "md", ...rest } = this.props;
        const maximum = Number.isFinite(max) && max > 0 ? max : 100;
        const current = Number.isFinite(value) ? Math.min(maximum, Math.max(0, value)) : 0;
        const pct = (current / maximum) * 100;

        const classes = classMap({
            "cs-progress": true,
            [SIZES[size]]: true,
            "w-full overflow-hidden rounded-full bg-muted": true,
        });

        return html`
            <div
                class=${classes}
                role="progressbar"
                aria-valuenow=${current}
                aria-valuemin="0"
                aria-valuemax=${maximum}
                ...=${rest}
            >
                <div
                    class="cs-progress__bar h-full rounded-full bg-primary transition-all duration-300"
                    style=${`width:${pct}%`}
                ></div>
            </div>
        `;
    }
}
