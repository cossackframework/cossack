import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { MAIN_SITE, type SiteStatus } from '@cossackframework/cms/server';
import { pageHeader } from '../../../../cms/ui';
import { network, siteLinks, siteStatus } from '../../../../cms/network-ui';

interface MySite {
    id: string;
    name: string;
    address: string;
    home: string;
    dashboard: string;
    status: SiteStatus;
    current: boolean;
}

/** The sites the signed-in account is a member of, with their dashboards: the Start menu's and the sidebar's My sites. */
@Page({ transport: 'http' })
export default class MySitesPage extends Cossack {
    @State() sites: MySite[] = [];

    head(): HeadValue {
        return { title: 'My sites' };
    }

    async init() {
        const principal = this.c.get('principal');
        if (principal?.kind !== 'user') return;
        const net = network(this.c);
        const here = this.c.get('site')?.id ?? MAIN_SITE;
        const mainTitle = await net.main.settings.get('general.siteTitle').catch(() => '');
        this.sites = (await net.memberSites(principal.id)).map(site => {
            const links = siteLinks(this.c, site);
            return {
                id: site.id, name: site.name ?? (mainTitle || __('Main site')), address: site.host ?? new URL(links.home, this.c.req.url).host,
                home: links.home, dashboard: links.dashboard, status: site.status, current: site.id === here,
            };
        });
    }

    render() {
        const th = 'px-3 py-2 font-medium';
        return html`<div class="max-w-4xl space-y-6">
            ${pageHeader(__('My sites'), { description: __('Every site your account belongs to. Your account signs you in to each one.') })}
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class=${th}>${__('Site')}</th><th class=${th}>${__('Address')}</th><th class=${th}>${__('Status')}</th><th class=${`${th} text-right`}>${__('Actions')}</th>
                </tr></thead>
                <tbody>${this.sites.map(site => html`<tr data-site=${site.id} class="border-b border-border last:border-0">
                    <td class="px-3 py-3 font-medium text-foreground">${site.name}${site.current ? html` <span class="text-xs font-normal text-muted-foreground">(${__('this site')})</span>` : null}</td>
                    <td class="px-3 py-3 text-muted-foreground">${site.address}</td>
                    <td class="px-3 py-3">${siteStatus(site.status)}</td>
                    <td class="px-3 py-3"><div class="flex justify-end gap-3">
                        <a href=${site.dashboard} class="text-sm text-primary hover:underline">${__('Dashboard')}</a>
                        <a href=${site.home} class="text-sm text-primary hover:underline">${__('Visit')}</a>
                    </div></td>
                </tr>`)}</tbody></table>
                ${this.sites.length ? null : html`<p role="status" class="px-4 py-10 text-center text-sm text-muted-foreground">${__('Your account belongs to no site.')}</p>`}</div>`))}
        </div>`;
    }
}
