import { html, component, repeat } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import { Card } from '../../components/Card.js';
import { Icon } from '../../icons/Icon.js';
import type { GlobalAttributes } from '../../native-attributes.js';
import type { IconEntry } from '@cossackframework/solar-icons/types';

export type StatTrend = 'up' | 'down' | 'neutral';
export type StatTone = 'positive' | 'negative' | 'neutral';
type StatIdentity = {
    /** Stable identity, unique within this list. Not a document ID. */
    readonly id: string;
    readonly label: string;
    /** Preformatted text or a finite number. Formatting/units belong to the caller. */
    readonly value: string | number;
    /** Explicitly trusted, decorative SVG artwork. */
    readonly icon?: Readonly<IconEntry>;
};
export type StatItem = StatIdentity & (
    { readonly change?: never; readonly trend?: never; readonly tone?: never }
    | {
        /** Localized change text, including units/comparison period where useful. */
        readonly change: string;
        /** Direction only. It does not determine whether a change is favorable. */
        readonly trend?: StatTrend;
        /** Explicit meaning. Defaults to neutral independently of direction. */
        readonly tone?: StatTone;
    }
);
export type DashboardStatProps = Omit<GlobalAttributes<HTMLUListElement>, 'role'> & {
    stats: readonly StatItem[];
    /** One column on narrow screens, two from sm, then this count from md. Default 4. */
    columns?: 2 | 3 | 4;
    trendLabels?: Partial<Record<StatTrend, string>>;
    /** Visible meaning accompanying positive/negative color. Neutral implies no assessment. */
    toneLabels?: Partial<Record<Exclude<StatTone, 'neutral'>, string>>;
};
const COLUMNS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 md:grid-cols-3', 4: 'sm:grid-cols-2 md:grid-cols-4' } as const;
const TRENDS: Record<StatTrend, string> = { up: 'Increase', down: 'Decrease', neutral: 'No change' };
const TONES: Record<Exclude<StatTone, 'neutral'>, string> = { positive: 'Favorable', negative: 'Unfavorable' };
const COLORS: Record<StatTone, string> = { neutral: 'text-muted-foreground', positive: 'text-success-text', negative: 'text-destructive' };

/** Read-only metric list with native label/value definitions and explicit change meaning. */
@Component()
export class DashboardStat extends Cossack {
    declare props: DashboardStatProps;
    render() {
        const { stats, columns = 4, trendLabels, toneLabels, ...root } = this.props;
        if (!Array.isArray(stats)) throw new Error('DashboardStat requires a stats array.');
        if (![2, 3, 4].includes(columns)) throw new Error('DashboardStat columns must be 2, 3 or 4.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('DashboardStat uses stats, not positional children.');
        const trends = { ...TRENDS }, tones = { ...TONES };
        for (const key of Object.keys(trends) as StatTrend[]) {
            const value = trendLabels?.[key];
            if (value !== undefined) {
                if (typeof value !== 'string' || !value.trim()) throw new Error('DashboardStat trend labels must be nonempty text.');
                trends[key] = value;
            }
        }
        for (const key of Object.keys(tones) as Exclude<StatTone, 'neutral'>[]) {
            const value = toneLabels?.[key];
            if (value !== undefined) {
                if (typeof value !== 'string' || !value.trim()) throw new Error('DashboardStat tone labels must be nonempty text.');
                tones[key] = value;
            }
        }
        const ids = new Set<string>();
        for (const stat of stats) {
            if (!stat || typeof stat.id !== 'string' || !stat.id.trim() || ids.has(stat.id)) throw new Error('DashboardStat metrics require unique nonempty IDs.');
            ids.add(stat.id);
            if (typeof stat.label !== 'string' || !stat.label.trim()) throw new Error('DashboardStat metric labels must be nonempty text.');
            if (!((typeof stat.value === 'number' && Number.isFinite(stat.value)) || (typeof stat.value === 'string' && stat.value.trim()))) throw new Error('DashboardStat values must be finite numbers or nonempty text.');
            if (stat.change === undefined) {
                if (stat.trend !== undefined || stat.tone !== undefined) throw new Error('DashboardStat trend and tone require change text.');
            } else {
                if (typeof stat.change !== 'string' || !stat.change.trim()) throw new Error('DashboardStat change must be nonempty text.');
                if (stat.trend !== undefined && !Object.hasOwn(TRENDS, stat.trend)) throw new Error('DashboardStat trend must be up, down or neutral.');
                if (stat.tone !== undefined && !Object.hasOwn(COLORS, stat.tone)) throw new Error('DashboardStat tone must be positive, negative or neutral.');
            }
        }
        return html`<ul role="list" class="cs-dashboard-stat grid grid-cols-1 ${COLUMNS[columns]} gap-4 m-0 p-0 list-none" ...=${root}>
            ${repeat<StatItem>(stats, stat => stat.id, stat => {
                const tone = stat.tone ?? 'neutral';
                return html`<li data-stat-id=${stat.id} class="cs-block__stat-card min-w-0">
                    ${component(Card, { class: 'h-full min-w-0' }, html`<div class="flex items-start gap-3 min-w-0">
                        <dl class="min-w-0 flex-1 break-words">
                            <dt class="text-sm text-muted-foreground">${stat.label}</dt>
                            <dd class="text-2xl font-bold text-foreground mt-1">${stat.value}</dd>
                            ${stat.change !== undefined ? html`<dd class=${`cs-dashboard-stat__change text-xs font-medium mt-1 ${COLORS[tone]}`}>
                                ${stat.trend ? html`<span>${trends[stat.trend]}: </span>` : null}${stat.change}${tone !== 'neutral' ? html`<span> · ${tones[tone]}</span>` : null}
                            </dd>` : null}
                        </dl>
                        ${stat.icon ? html`<span aria-hidden="true" class="size-10 rounded-lg bg-muted inline-flex items-center justify-center text-muted-foreground shrink-0">
                            ${component(Icon, { entry: stat.icon, size: 20 })}
                        </span>` : null}
                    </div>`)}
                </li>`;
            })}
        </ul>`;
    }
}
