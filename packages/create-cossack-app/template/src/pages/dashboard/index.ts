import { Cossack, Page, State } from '@cossackframework/core';
import { Card, CardBody, Avatar } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';

interface DashboardStat {
    label: string;
    value: string;
}

@Page({ transport: 'http' })
export default class DashboardPage extends Cossack {
    /** Display name for the greeting card (seeded server-side so it serializes). */
    @State() userName = '';
    @State() userEmail = '';
    @State() userAvatar: string | null = null;
    /** Stats derived from the user's roles — computed in init(), not render(). */
    @State() stats: DashboardStat[] = [];

    async init() {
        const user = this.user;
        if (user) {
            this.userName = user.name;
            this.userEmail = user.email;
            this.userAvatar = user.avatar;
            const roleNames = user.roles?.map((r) => r.name) ?? [];
            this.stats = [
                { label: __('Plan'), value: __('Free') },
                { label: __('Role'), value: roleNames.length ? roleNames.map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(', ') : __('None') },
                { label: __('Status'), value: __('Active') },
            ];
        }
    }

    render() {
        return html`
            <div class="space-y-8">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Dashboard')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Welcome back')}.</p>
                </div>

                ${component(Card, {}, component(CardBody, {}, html`
                    <div class="flex items-center gap-4">
                        ${component(Avatar, { src: this.userAvatar ?? undefined, alt: this.userName, size: 56 })}
                        <div>
                            <div class="text-lg font-semibold text-foreground">${this.userName}</div>
                            <div class="text-sm text-muted-foreground">${this.userEmail}</div>
                        </div>
                    </div>
                `))}

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    ${this.stats.map((stat) => html`
                        ${component(Card, {}, component(CardBody, {}, html`
                            <p class="text-sm text-muted-foreground">${stat.label}</p>
                            <p class="text-2xl font-bold text-foreground mt-1">${stat.value}</p>
                        `))}
                    `)}
                </div>
            </div>
        `;
    }
}
