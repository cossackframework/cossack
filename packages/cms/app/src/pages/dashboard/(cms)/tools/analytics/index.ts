import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { PERMISSIONS } from '@cossackframework/cms';
import type { ViewsReport } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../cms/guards';
import { pageHeader } from '../../../../../cms/ui';

/**
 * Tools → Analytics: page views and visitors counted by the site's own beacon over the last
 * thirty days, without cookies: a day's visitor is a hash of the address, the browser and the
 * day. Top pages and the sites visitors came from. Settings → Analytics turns the beacon off or
 * adds Cloudflare Web Analytics beside it.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class AnalyticsPage extends Cossack {
    @State() report: ViewsReport = { days: [], pages: [], referrers: [], views: 0, visitors: 0 };
    @State() enabled = true;

    head(): HeadValue {
        return { title: 'Analytics' };
    }

    async init() {
        const cms = this.c.get('cms');
        this.enabled = await cms.settings.get('analytics.enabled').catch(() => true) as boolean;
        this.report = await cms.traffic.views(30);
    }

    render() {
        const peak = Math.max(1, ...this.report.days.map(day => day.views));
        return html`<div class="space-y-6">
            ${pageHeader(__('Analytics'), { description: __('Page views and visitors over the last thirty days, counted by the site\'s beacon without cookies. Crawlers and the dashboard are left out.') })}
            ${this.enabled ? null : html`<p class="rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">${__('The beacon is off (Settings → Analytics), so nothing new is counted.')}</p>`}
            <div class="grid gap-4 sm:grid-cols-2">
                ${component(Card, {}, component(CardBody, {}, html`<p class="text-sm text-muted-foreground">${__('Views')}</p><p class="text-3xl font-semibold text-foreground" data-testid="analytics-views">${this.report.views}</p>`))}
                ${component(Card, {}, component(CardBody, {}, html`<p class="text-sm text-muted-foreground">${__('Visitors')}</p><p class="text-3xl font-semibold text-foreground" data-testid="analytics-visitors">${this.report.visitors}</p>`))}
            </div>
            ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Views by day')}</h2>`)}
                ${component(CardBody, {}, this.report.days.length ? html`<ol class="flex h-32 items-end gap-1" aria-label=${__('Views by day')}>${this.report.days.map(day => html`<li class="flex-1 rounded-t bg-primary/70" style=${`height: ${Math.max(2, Math.round(day.views / peak * 100))}%`} title=${`${day.day}: ${day.views} ${__('views')}, ${day.visitors} ${__('visitors')}`}></li>`)}</ol>`
                    : html`<p class="text-sm text-muted-foreground">${__('No views yet. The count starts with the next visit.')}</p>`)}`)}
            <div class="grid gap-6 lg:grid-cols-2">
                ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Top pages')}</h2>`)}
                    ${component(CardBody, { class: 'p-0' }, this.report.pages.length ? html`<ul class="divide-y divide-border" data-testid="analytics-pages">${this.report.pages.map(page => html`<li class="flex items-center justify-between gap-3 px-4 py-2 text-sm"><a href=${page.path} class="truncate text-foreground hover:underline">${page.path}</a><span class="tabular-nums text-muted-foreground">${page.views}</span></li>`)}</ul>` : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('Nothing yet.')}</p>`)}`)}
                ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Came from')}</h2>`)}
                    ${component(CardBody, { class: 'p-0' }, this.report.referrers.length ? html`<ul class="divide-y divide-border">${this.report.referrers.map(entry => html`<li class="flex items-center justify-between gap-3 px-4 py-2 text-sm"><span class="truncate text-foreground">${entry.host}</span><span class="tabular-nums text-muted-foreground">${entry.count}</span></li>`)}</ul>` : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('No referrers yet: direct visits and searches do not say where they came from.')}</p>`)}`)}
            </div>
        </div>`;
    }
}
