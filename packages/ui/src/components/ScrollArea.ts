import { html, IfDefinedResult } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import type { GlobalAttributes } from "../native-attributes";

export type ScrollAreaProps = Omit<GlobalAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'aria-labelledby'> & {
    /** Accessible name for this scrollable region. */
    label: string;
    /** Viewport height. Numbers are nonnegative CSS pixels; strings are CSS lengths. */
    height?: number | string;
};

/** Native scroll viewport. Attributes, styles and events all target the scrolling div.
 * Keyboard focus defaults to tabindex=0; callers can set -1 when another control
 * supplies keyboard access. Keep the region name short and specific.
 */
@Component()
export class ScrollArea extends Cossack {
    declare props: ScrollAreaProps;

    render() {
        const { label, height = "auto", style, tabindex = 0, ...rest } = this.props;
        if (typeof label !== 'string' || !label.trim()) throw new Error('ScrollArea requires a nonempty label.');
        if (!(typeof height === 'number' && Number.isFinite(height) && height >= 0) && !(typeof height === 'string' && height.trim())) {
            throw new Error('ScrollArea height must be a nonnegative finite number or nonempty CSS length.');
        }
        const suppliedStyle = style instanceof IfDefinedResult ? style.value : style;
        const viewportStyle = `height:${typeof height === 'number' ? `${height}px` : height};overflow:auto;${typeof suppliedStyle === 'string' ? suppliedStyle : ''}`;
        return html`<div class="cs-scroll-area cs-scroll-area__viewport relative focus-visible:outline-2 focus-visible:outline-ring" style=${viewportStyle} ...=${rest} role="region" aria-label=${label} tabindex=${tabindex}>${this.children}</div>`;
    }
}
