import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface ProgressProps {
    /** Current value (0 to max). */
    value?: number;
    /** Maximum value. Default 100. */
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
        const pct = Math.min(100, Math.max(0, (value / max) * 100));

        const classes = classMap({
            "cs-progress": true,
            [SIZES[size]]: true,
            "w-full overflow-hidden rounded-full bg-muted": true,
        });

        return html`
            <div
                class=${classes}
                role="progressbar"
                aria-valuenow=${value}
                aria-valuemin="0"
                aria-valuemax=${max}
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
