import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface ScrollAreaProps {
    /** Fixed height for the scroll area (CSS value). */
    height?: string;
    [key: string]: any;
}

/**
 * Cossack UI ScrollArea — styled scrollable container.
 *
 * Uses native scrolling with custom scrollbar styling via CSS.
 *
 *   ${component(ScrollArea, { height: '300px' }, html\`<p>Long content...</p>\`)}
 */
@Component()
export class ScrollArea extends Cossack {
    declare props: ScrollAreaProps;

    render() {
        const { height = "auto", ...rest } = this.props;

        const wrapperClasses = classMap({
            "cs-scroll-area": true,
            "relative": true,
        });

        const viewportStyle = height !== "auto" ? `height:${height};overflow-y:auto;` : "overflow-y:auto;";

        return html`
            <div class=${wrapperClasses} ...=${rest}>
                <div class="cs-scroll-area__viewport" style=${viewportStyle}>
                    ${this.children}
                </div>
            </div>
        `;
    }
}
