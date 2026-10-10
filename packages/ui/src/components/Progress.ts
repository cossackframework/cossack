import { html, classMap, ifDefined } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';

export type ProgressProps = Omit<GlobalAttributes<HTMLDivElement>,
    'role' | 'aria-label' | 'aria-labelledby' | 'aria-valuenow' | 'aria-valuemin' | 'aria-valuemax' | 'aria-valuetext' |
    'tabindex' | 'autofocus' | '?autofocus' | 'contenteditable'> & {
    /** Required accessible name, independent of the current value. */
    label: string;
    /** Omit or use null for unknown progress. Finite values clamp to 0..max. */
    value?: number | null;
    /** Positive finite maximum; defaults to 100. */
    max?: number;
    /** Optional human-readable value, such as "3 of 8 files". */
    valueText?: string;
    size?: 'sm' | 'md' | 'lg';
};
const SIZES = { sm: 'h-1', md: 'h-2', lg: 'h-3' };

/** Named, noninteractive progress indicator. The parent owns work and announcements. */
@Component()
export class Progress extends Cossack {
    declare props: ProgressProps;
    render() {
        const { label, value, max = 100, valueText, size = 'md', ...rest } = this.props;
        if (typeof label !== 'string' || !label.trim()) throw new Error('Progress requires a nonempty label.');
        if (!Number.isFinite(max) || max <= 0) throw new Error('Progress max must be positive and finite.');
        if (value != null && !Number.isFinite(value)) throw new Error('Progress value must be finite, null or omitted.');
        if (!Object.hasOwn(SIZES, size)) throw new Error('Progress size must be sm, md or lg.');
        if (valueText !== undefined && (typeof valueText !== 'string' || !valueText.trim())) throw new Error('Progress valueText must be nonempty when supplied.');
        const current = value == null ? undefined : Math.min(max, Math.max(0, value));
        const classes = classMap({ 'cs-progress w-full overflow-hidden rounded-full bg-muted': true, [SIZES[size]]: true });
        return html`<div class=${classes} role="progressbar" aria-label=${label}
            aria-valuenow=${ifDefined(current)} aria-valuemin="0" aria-valuemax=${max}
            aria-valuetext=${ifDefined(valueText)} data-state=${current === undefined ? 'indeterminate' : 'determinate'} ...=${rest}>
            <div class="cs-progress__bar h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style=${`width:${current === undefined ? 100 : current / max * 100}%`}></div>
        </div>`;
    }
}
