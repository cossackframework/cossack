import { html, IfDefinedResult } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';

/** Numbers are CSS pixels; strings are nonempty CSS lengths/expressions. */
export type SkeletonDimension = number | string;
export type SkeletonProps = Omit<GlobalAttributes<HTMLDivElement>, 'role' | 'tabindex' | 'aria-hidden' | 'autofocus' | '?autofocus' | 'contenteditable'> & (
    { circle?: false; width?: SkeletonDimension; height?: SkeletonDimension; size?: never } |
    { circle: true; size?: SkeletonDimension; width?: never; height?: never }
);
function skeletonDimension(value: SkeletonDimension, name: string) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return `${value}px`;
    if (typeof value === 'string' && value.trim()) return value;
    throw new Error(`Skeleton ${name} must be a nonnegative finite number or nonempty CSS length.`);
}

/** Decorative placeholder. Announce loading on the containing region, not each shape. */
@Component()
export class Skeleton extends Cossack {
    declare props: SkeletonProps;
    render() {
        const { circle = false, width, height, size, style, ...rest } = this.props;
        if (typeof circle !== 'boolean' || (circle ? width !== undefined || height !== undefined : size !== undefined)) throw new Error('Skeleton uses size for circles and width/height for rectangles.');
        const w = skeletonDimension(circle ? size ?? '1em' : width ?? '100%', circle ? 'size' : 'width');
        const h = circle ? w : skeletonDimension(height ?? '1em', 'height');
        const suppliedStyle = style instanceof IfDefinedResult ? style.value : style;
        const dimensions = `width:${w};height:${h};${typeof suppliedStyle === 'string' ? suppliedStyle : ''}`;
        return html`<div class=${`cs-skeleton animate-pulse motion-reduce:animate-none bg-muted ${circle ? 'rounded-full' : 'rounded-md'}`} style=${dimensions} aria-hidden="true" ...=${rest}></div>`;
    }
}
