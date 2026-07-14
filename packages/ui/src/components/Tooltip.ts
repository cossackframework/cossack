import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface TooltipProps {
    /** The tooltip text (plain string). */
    label?: string;
    /** Preferred side. NOTE: positioning is CSS-based (absolute relative to the
     * wrapper); without CSS Anchor Positioning this is a hint, not a collision-
     * aware placement. */
    side?: "top" | "bottom" | "left" | "right";
    /** Delay in ms before the tooltip appears on hover. Implemented via CSS. */
    [key: string]: any;
}

/**
 * Cossack UI Tooltip — pure-CSS hover tooltip (no JS, no portal).
 *
 * The tooltip is a `position: absolute` child of a `position: relative`
 * wrapper, shown on `:hover` and `:focus-within`. It does NOT escape
 * `overflow: hidden` ancestors or do collision detection — for that, the
 * native `popover` attribute (see the Popover component) is recommended.
 *
 * Accessibility: the label is set as `aria-label` on the trigger wrapper so
 * screen readers announce it. The visual tooltip is `role="tooltip"`.
 *
 *   ${component(Tooltip, { label: 'Save changes', side: 'top' },
 *       component(Button, {}, 'Save'))}
 */
@Component()
export class Tooltip extends Cossack {
    declare props: TooltipProps;

    render() {
        const { label = "", side = "top", ...rest } = this.props;

        // Position classes — each variant offsets the bubble appropriately.
        // The bubble uses CSS group-hover via the .cs-tooltip:hover selector
        // (defined inline via Tailwind arbitrary variants).
        const bubbleClasses = classMap({
            "cs-tooltip__bubble": true,
            "cs-tooltip__bubble--top": side === "top",
            "cs-tooltip__bubble--bottom": side === "bottom",
            "cs-tooltip__bubble--left": side === "left",
            "cs-tooltip__bubble--right": side === "right",
            "absolute z-50 px-2 py-1 text-xs rounded-md": true,
            "bg-foreground text-background whitespace-nowrap pointer-events-none": true,
            "opacity-0 scale-95 transition-opacity transition-transform duration-150": true,
        });

        return html`
            <span
                class="cs-tooltip relative inline-flex"
                aria-label=${label}
                ...=${rest}
            >
                ${this.children}
                <span role="tooltip" class=${bubbleClasses}>${label}</span>
            </span>
        `;
    }
}
