import { html } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface AspectRatioProps {
    /** Width/height ratio, e.g. 16/9 = 1.778. Default 1 (square). */
    ratio?: number;
    [key: string]: any;
}

/**
 * Cossack UI AspectRatio — constrains children to a fixed aspect ratio.
 *
 * Uses the padding-top percentage hack for maximum browser compatibility.
 *
 *   ${component(AspectRatio, { ratio: 16/9 },
 *       html\`<img src="cover.jpg" class="absolute inset-0 w-full h-full object-cover" />\`)}
 */
@Component()
export class AspectRatio extends Cossack {
    declare props: AspectRatioProps;

    render() {
        const { ratio = 1 } = this.props;
        const paddingTop = (1 / ratio) * 100;

        return html`
            <div class="cs-aspect-ratio relative w-full" style=${`padding-top:${paddingTop}%`}>
                <div class="absolute inset-0 w-full h-full">
                    ${this.children}
                </div>
            </div>
        `;
    }
}
