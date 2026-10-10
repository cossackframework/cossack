import { html } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';

export type AspectRatioProps = GlobalAttributes<HTMLDivElement> & {
    /** Positive finite width/height ratio of the inner sizing box. Default: 1. */
    ratio?: number;
};

/** Native wrapper attributes surround an independently sized CSS aspect-ratio box. */
@Component()
export class AspectRatio extends Cossack {
    declare props: AspectRatioProps;
    render() {
        const { ratio = 1, ...rest } = this.props;
        if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) throw new Error('AspectRatio ratio must be a positive finite number.');
        return html`<div class="cs-aspect-ratio w-full" ...=${rest}>
            <div class="cs-aspect-ratio__box relative w-full" style=${`aspect-ratio:${ratio}`}>
                <div class="absolute inset-0 w-full h-full">${this.children}</div>
            </div>
        </div>`;
    }
}
