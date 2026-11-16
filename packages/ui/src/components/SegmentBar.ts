import { html } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { GlobalAttributes } from '../native-attributes';

export type SegmentBarItem = {
    /** Stable and unique within the bar. */
    id: string;
    label: string;
    /** A finite amount of zero or more; the segment's width is its share of the total. */
    value: number;
    /** What the legend shows for the value, such as "1.2 MB"; the number by default. */
    valueText?: string;
};

export type SegmentBarProps = Omit<GlobalAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'aria-labelledby'> & {
    /** Required accessible name of the whole, such as "Files by kind". */
    label: string;
    items: readonly SegmentBarItem[];
    /** Hide the legend below the bar; the bar keeps a text alternative. */
    legend?: boolean;
};

/** The chart colors, in order; a sixth segment and later reuse them. */
const COLORS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

/**
 * Parts of a whole as one bar of colored segments with a legend of each part's value and
 * share, such as storage by file kind. Noninteractive; zero parts show in the legend only.
 */
@Component()
export class SegmentBar extends Cossack {
    declare props: SegmentBarProps;
    render() {
        const { label, items, legend = true, ...rest } = this.props;
        if (typeof label !== 'string' || !label.trim()) throw new Error('SegmentBar requires a nonempty label.');
        if (!Array.isArray(items)) throw new Error('SegmentBar items must be a list.');
        const ids = new Set<string>();
        for (const item of items) {
            if (typeof item?.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('SegmentBar items need unique nonempty ids.');
            if (typeof item.label !== 'string' || !item.label.trim()) throw new Error('SegmentBar items need nonempty labels.');
            if (!Number.isFinite(item.value) || item.value < 0) throw new Error('SegmentBar values must be finite and not negative.');
            ids.add(item.id);
        }
        const total = items.reduce((sum, item) => sum + item.value, 0);
        const share = (value: number) => total ? Math.round(value / total * 1000) / 10 : 0;
        const text = (item: SegmentBarItem) => item.valueText ?? String(item.value);
        const summary = items.map(item => `${item.label}: ${text(item)} (${share(item.value)}%)`).join(', ');
        return html`<div class="cs-segment-bar space-y-3" ...=${rest}>
            <div class="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label=${`${label}: ${summary || '0'}`}>
                ${items.map((item, index) => item.value > 0 ? html`<div class=${`h-full ${COLORS[index % COLORS.length]}`} style=${`width:${item.value / total * 100}%`} data-segment=${item.id}></div>` : null)}
            </div>
            ${legend ? html`<ul class="cs-segment-bar__legend grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                ${items.map((item, index) => html`<li class="flex items-center gap-2" data-segment=${item.id}>
                    <span aria-hidden="true" class=${`size-2.5 shrink-0 rounded-sm ${COLORS[index % COLORS.length]}`}></span>
                    <span class="min-w-0 flex-1 truncate text-foreground">${item.label}</span>
                    <span class="tabular-nums text-muted-foreground">${text(item)} · ${share(item.value)}%</span>
                </li>`)}
            </ul>` : null}
        </div>`;
    }
}
