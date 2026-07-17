import { Cossack, Page } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Card, CardBody, Avatar } from '@cossackframework/ui';

@Page({ transport: 'http' })
export default class DashboardPage extends Cossack {
    render() {
        const user = this.user!;
        const stats = [
            { label: __('Plan'), value: __('Free') },
            { label: __('Role'), value: __('Member') },
            { label: __('Status'), value: __('Active') },
        ];

        return html`
            <div class="space-y-8">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Dashboard')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Welcome back')}.</p>
                </div>

                ${component(Card, {}, component(CardBody, {}, html`
                    <div class="flex items-center gap-4">
                        ${component(Avatar, { src: user.avatar ?? undefined, alt: user.name, size: 56 })}
                        <div>
                            <div class="text-lg font-semibold text-foreground">${user.name}</div>
                            <div class="text-sm text-muted-foreground">${user.email}</div>
                        </div>
                    </div>
                `))}

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    ${stats.map((stat) => html`
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
