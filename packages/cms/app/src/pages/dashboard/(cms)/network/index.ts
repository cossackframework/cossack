import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { linkButton, notice, pageHeader } from '../../../../cms/ui';
import { network, requireNetworkAdmin } from '../../../../cms/network-ui';

/** The network at a glance: its sites, accounts and pending upgrades. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkHome extends Cossack {
    @State() name = '';
    @State() sites = { active: 0, archived: 0, deleted: 0 };
    @State() accounts = 0;
    @State() admins = 0;
    @State() canAdd = false;

    head(): HeadValue {
        return { title: 'Network' };
    }

    async init() {
        const net = network(this.c);
        this.name = (await net.settings()).name;
        for (const status of ['active', 'archived', 'deleted'] as const) this.sites[status] = (await net.sites.list({ status, limit: 1 })).total;
        // The main site counts as an active site.
        this.sites.active += 1;
        this.accounts = await net.main.accounts.count();
        this.admins = (await net.main.accounts.list({ networkAdmins: true, limit: 1 })).total;
        this.canAdd = net.canAddSites;
    }

    render() {
        const stat = (label: string, value: number, href: string) => component(Card, {}, component(CardBody, { class: 'space-y-1' }, html`
            <p class="text-sm text-muted-foreground">${label}</p>
            <a href=${href} class="text-2xl font-semibold text-foreground no-underline">${value}</a>`));
        return html`<div class="max-w-5xl space-y-6">
            ${pageHeader(this.name || __('Network'), { description: __('Every site in this network, and the accounts that sign in to them.'), actions: this.canAdd ? linkButton(__('Add site'), '/dashboard/network/sites#add') : null })}
            ${this.canAdd ? null : notice(__('Sites need their own databases: files beside the main one on Node, or ROMEDB_SITES_URL and ROMEDB_SITES_TOKEN (a RomeDB organization). Until then the network is this site only.'))}
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                ${stat(__('Active sites'), this.sites.active, '/dashboard/network/sites')}
                ${stat(__('Archived or deleted'), this.sites.archived + this.sites.deleted, '/dashboard/network/sites?status=archived')}
                ${stat(__('Accounts'), this.accounts, '/dashboard/network/users')}
                ${stat(__('Network admins'), this.admins, '/dashboard/network/users?admins=1')}
            </div>
            <ul class="space-y-1 text-sm">
                <li><a class="text-primary" href="/dashboard/network/plugins">${__('Plugins')}</a> — ${__('plugins active on every site, available to each site, or hidden.')}</li>
                <li><a class="text-primary" href="/dashboard/network/themes">${__('Themes')}</a> — ${__('the themes sites may choose.')}</li>
                <li><a class="text-primary" href="/dashboard/network/updates">${__('Updates')}</a> — ${__('sites with schema steps to apply after a deploy.')}</li>
                <li><a class="text-primary" href="/dashboard/network/settings">${__('Settings')}</a> — ${__('the network name and the address new sites start at.')}</li>
            </ul>
        </div>`;
    }
}
