import { html, component, repeat } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import { Avatar } from './Avatar';
import type { GlobalAttributes } from '../native-attributes';

export interface AvatarGroupItem {
    /** Stable identity independent of position or display name. */
    value: string;
    src?: string;
    /** Meaningful image name, or empty for a decorative item. */
    alt: string;
}
export type AvatarGroupProps = Omit<GlobalAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'aria-labelledby'> & {
    label: string;
    items: readonly AvatarGroupItem[];
    /** Maximum visible avatars, including zero; overflow remains described. */
    max?: number;
    size?: number;
    shape?: 'circle' | 'square';
    direction?: 'row' | 'row-reverse';
    /** Nonnegative overlap in pixels, smaller than size. Defaults to size / 4. */
    overlap?: number;
    ring?: boolean;
    overflowLabel?: (count: number) => string;
};

/** Named collection with stable avatar identity and logical overlap. No selection behavior. */
@Component()
export class AvatarGroup extends Cossack {
    declare props: AvatarGroupProps;
    render() {
        const { label, items, max = 5, size = 36, shape = 'circle', direction = 'row', overlap = size / 4, ring = true,
            overflowLabel = count => `${count} more people`, ...rest } = this.props;
        if (typeof label !== 'string' || !label.trim()) throw new Error('AvatarGroup requires a nonempty label.');
        if (!Array.isArray(items)) throw new Error('AvatarGroup requires an items array.');
        if (!Number.isSafeInteger(max) || max < 0) throw new Error('AvatarGroup max must be a nonnegative safe integer.');
        if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(overlap) || overlap < 0 || overlap >= size) throw new Error('AvatarGroup requires finite size > overlap >= 0.');
        if (!['circle', 'square'].includes(shape) || !['row', 'row-reverse'].includes(direction)) throw new Error('AvatarGroup requires a supported shape and direction.');
        if (typeof ring !== 'boolean' || typeof overflowLabel !== 'function') throw new Error('AvatarGroup requires boolean ring and an overflowLabel callback.');
        const keys = new Set<string>();
        for (const item of items) {
            if (!item || typeof item.value !== 'string' || !item.value.trim() || keys.has(item.value)) throw new Error('AvatarGroup items require unique nonempty values.');
            if (typeof item.alt !== 'string' || (item.src !== undefined && typeof item.src !== 'string')) throw new Error('AvatarGroup items require alt text and optional string src.');
            keys.add(item.value);
        }
        const visible = items.slice(0, max), overflow = items.length - visible.length;
        const overflowName = overflow ? overflowLabel(overflow) : '';
        if (overflow && (typeof overflowName !== 'string' || !overflowName.trim())) throw new Error('AvatarGroup overflowLabel must return nonempty text.');
        const edge = direction === 'row' ? 'margin-inline-start' : 'margin-inline-end';
        const ringStyle = ring ? 'box-shadow:0 0 0 2px var(--color-card,var(--color-background,#fff));' : '';
        const radius = shape === 'circle' ? '50%' : '0.375rem';
        const itemStyle = (index: number) => `${edge}:${index ? -overlap : 0}px;border-radius:${radius};${ringStyle}`;
        return html`<div class=${`cs-avatar-group inline-flex items-center ${direction === 'row-reverse' ? 'flex-row-reverse' : ''}`}
            role="group" aria-label=${label} ...=${rest}>
            ${repeat(visible, item => item.value, (item, index) => html`<span class="cs-avatar-group__item inline-flex shrink-0" data-value=${item.value} style=${itemStyle(index)}>
                ${component(Avatar, { src: item.src, alt: item.alt, size, shape })}
            </span>`)}
            ${overflow ? html`<span class="cs-avatar-group__overflow inline-flex shrink-0 items-center justify-center bg-muted text-muted-foreground font-medium select-none"
                style=${`${itemStyle(visible.length)}width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;`}>
                <span aria-hidden="true">+${overflow}</span><span class="sr-only">${overflowName}</span>
            </span>` : null}
        </div>`;
    }
}
