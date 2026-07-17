import { html, component } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import { Card, CardBody, NamedIcon } from '@cossackframework/ui';

export interface StatItem {
    label: string;
    value: string | number;
    /** Optional delta (e.g. "+12.5%"). */
    change?: string;
    /** Whether the change is positive (green) or negative (red). */
    trend?: 'up' | 'down' | 'neutral';
    /** Solar icon name. */
    icon?: string;
}

export interface DashboardStatProps {
    stats: StatItem[];
    /** Grid columns on desktop. Default 4. */
    columns?: 2 | 3 | 4;
    [key: string]: any;
}

const COLS: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
};

/**
 * Dashboard Stats Block — KPI tile grid for dashboard pages.
 *
 * Renders a responsive grid of stat cards, each showing an icon, label, value,
 * and trend indicator. A drop-in for the "total revenue / active users / new
 * signups" pattern every admin dashboard uses.
 *
 *   ${component(DashboardStat, {
 *       stats: [
 *           { label: 'Revenue', value: '$45.2K', change: '+12.5%', trend: 'up' },
 *           { label: 'Users', value: '2,340', change: '+4.3%', trend: 'up' },
 *           { label: 'Churn', value: '1.2%', change: '-0.3%', trend: 'down' },
 *       ],
 *       columns: 3,
 *   })}
 */
@Component()
export class DashboardStat extends Cossack {
    declare props: DashboardStatProps;

    render() {
        const { stats, columns = 4 } = this.props;

        return html`
            <div class="grid ${COLS[columns]} gap-4">
                ${stats.map((stat) => {
                    const trendColor = stat.trend === 'down' ? 'text-destructive' : 'text-success';
                    return html`
                        <div class="cs-block__stat-card">
                            ${component(Card, {},
                                component(CardBody, {},
                                    html`<div class="flex items-start justify-between gap-3">
                                        <div class="min-w-0">
                                            <p class="text-sm text-muted-foreground truncate">${stat.label}</p>
                                            <p class="text-2xl font-bold text-foreground mt-1">${stat.value}</p>
                                            ${stat.change ? html`<p class=${`text-xs font-medium mt-1 ${trendColor}`}>${stat.change}</p>` : null}
                                        </div>
                                        ${stat.icon ? html`<div class="w-10 h-10 rounded-lg bg-muted inline-flex items-center justify-center text-muted-foreground shrink-0">
                                            ${component(NamedIcon, { name: stat.icon, size: 20 })}
                                        </div>` : null}
                                    </div>`))}
                            )}
                        </div>
                    `;
                })}
            </div>
        `;
    }
}
