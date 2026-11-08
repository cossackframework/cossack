import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { isSameOriginPost } from '@cossackframework/cms';
import { notice, pageHeader } from '../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../cms/guards';
import { network } from '../../../../../cms/network-ui';
import { submitButton } from '../../../../../cms/network-view';

/**
 * Network → Updates: sites whose schema has host steps to apply after a deploy. Each site
 * applies its own when it next loads; this applies them now, ten sites at a time.
 */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkUpdates extends Cossack {
    @State() pending: { id: string; name: string; steps: number }[] = [];
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Network updates' };
    }

    async init() {
        this.pending = (await network(this.c).updates()).map(entry => ({ id: entry.site.id, name: entry.name, steps: entry.pending }));
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const report = await network(this.c).upgrade({ principal: this.c.get('principal'), limit: 10 });
        if (report.upgraded.length) flash('network.message', `${__('Upgraded')} ${report.upgraded.length} ${report.upgraded.length === 1 ? __('site') : __('sites')}.`);
        if (report.failed.length) flash('network.error', report.failed.map(failure => `${failure.site}: ${failure.message}`).join(' '));
        return this.redirect('/dashboard/network/updates');
    }

    render() {
        return html`<div class="max-w-3xl space-y-6">
            ${pageHeader(__('Updates'), { description: __('Sites upgrade their own schema when they next load after a deploy. Upgrade them here to avoid the wait.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.pending.length ? html`<ul class="divide-y divide-border rounded-lg border border-border">${this.pending.map(site => html`<li class="flex justify-between px-3 py-2 text-sm">
                    <span class="font-medium text-foreground">${site.name}</span><span class="text-muted-foreground">${site.steps} ${site.steps === 1 ? __('step pending') : __('steps pending')}</span></li>`)}</ul>
                <form method="post">${submitButton(__('Upgrade up to 10 sites'))}</form>`
                : notice(__('Every site is up to date.'), 'success')}
        </div>`;
    }
}
