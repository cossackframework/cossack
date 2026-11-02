import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import type { SiteStatus } from '@cossackframework/cms/server';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';
import { actionButton, field, network, requireNetworkAdmin, siteLinks, siteStatus, SUBMIT } from '../../../../../cms/network-ui';

interface SiteRow { id: string; name: string; host: string; status: SiteStatus; members: number; createdAt: number; home: string; dashboard: string }

/** Network → Sites: every site with its address, members and state, and the form that adds one. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkSites extends Cossack {
    @State() rows: SiteRow[] = [];
    @State() total = 0;
    @State() search = '';
    @State() status = '';
    @State() canAdd = false;
    @State() suffix = '';
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Sites' };
    }

    async init() {
        const net = network(this.c);
        const query = this.c.req.query();
        this.search = query.q ?? '';
        this.status = ['active', 'archived', 'deleted', 'creating'].includes(query.status ?? '') ? query.status! : '';
        const [page, counts] = await Promise.all([
            net.sites.list({ ...(this.search ? { search: this.search } : {}), ...(this.status ? { status: this.status as SiteStatus } : {}), limit: 100 }),
            net.main.accounts.memberCounts(),
        ]);
        this.total = page.total;
        this.rows = page.items.map(site => {
            const host = site.domains.find(domain => domain.primary)?.host ?? '';
            return { id: site.id, name: site.name, host, status: site.status, members: counts.get(site.id) ?? 0, createdAt: site.createdAt, ...siteLinks(this.c, { host }) };
        });
        this.canAdd = net.canAddSites;
        this.suffix = (await net.settings()).subdomainSuffix || net.subdomainSuffix;
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        const value = (name: string) => String(form.get(name) ?? '').trim();
        const net = network(this.c);
        const principal = this.c.get('principal');
        try {
            const action = value('action');
            if (action === 'add') {
                const admin = value('admin') ? await net.main.accounts.findByEmail(value('admin')) : await net.main.accounts.get(principal.kind === 'user' ? principal.id : '');
                if (!admin) throw new Error(__('No account has that email. Add the person under Network → Users first.'));
                const site = await net.createSite({ name: value('name'), host: value('host'), admin: admin.id, ...(value('id') ? { id: value('id') } : {}), starter: form.get('starter') === 'on' }, { principal });
                flash('network.message', `${site.name} is ready.`);
            } else if (action === 'archive' || action === 'restore' || action === 'delete') {
                const site = await net.setSiteStatus(value('site'), action === 'archive' ? 'archived' : action === 'delete' ? 'deleted' : 'active', { principal });
                flash('network.message', action === 'delete' ? `${site.name} is deleted. It can be restored for 30 days.` : `${site.name} is ${action === 'archive' ? 'archived' : 'active'}.`);
            }
        } catch (error) {
            flash('network.error', isCmsError(error) || error instanceof Error ? (error as Error).message : 'The site could not be changed.');
        }
        return this.redirect('/dashboard/network/sites');
    }

    render() {
        const actions = (row: SiteRow) => html`<div class="flex flex-wrap gap-1.5">
            ${row.status === 'active' || row.status === 'archived' ? html`<a class="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground no-underline hover:bg-muted" href=${row.dashboard}>${__('Dashboard')}</a>
                <a class="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground no-underline hover:bg-muted" href=${row.home}>${__('Visit')}</a>` : null}
            <a class="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground no-underline hover:bg-muted" href=${`/dashboard/network/sites/${row.id}`}>${__('Edit')}</a>
            ${row.status === 'active' ? actionButton('archive', __('Archive'), { site: row.id }) : null}
            ${row.status === 'archived' || row.status === 'deleted' ? actionButton('restore', __('Restore'), { site: row.id }) : null}
            ${row.status !== 'deleted' && row.status !== 'creating' ? actionButton('delete', __('Delete'), { site: row.id }, { danger: true }) : null}
        </div>`;
        return html`<div class="max-w-6xl space-y-6">
            ${pageHeader(__('Sites'), { description: __('The main site is the network itself; every other site has its own database.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <form method="get" class="flex flex-wrap gap-2">
                <input name="q" .value=${this.search} placeholder=${__('Search names and domains')} class="rounded-md border border-input bg-background px-3 py-2 text-sm">
                <select name="status" class="rounded-md border border-input bg-background px-3 py-2 text-sm">
                    ${[['', __('Any status')], ['active', __('Active')], ['archived', __('Archived')], ['deleted', __('Deleted')], ['creating', __('Being created')]].map(([value, label]) => html`<option value=${value} ?selected=${this.status === value}>${label}</option>`)}
                </select>
                <button type="submit" class="rounded-md border border-border bg-background px-3 py-2 text-sm cursor-pointer">${__('Filter')}</button>
            </form>
            <div class="overflow-x-auto rounded-lg border border-border">
                <table class="w-full text-sm">
                    <thead class="bg-muted/50 text-left text-muted-foreground"><tr>
                        <th class="px-3 py-2 font-medium">${__('Site')}</th><th class="px-3 py-2 font-medium">${__('Members')}</th>
                        <th class="px-3 py-2 font-medium">${__('Status')}</th><th class="px-3 py-2 font-medium">${__('Created')}</th><th class="px-3 py-2"></th>
                    </tr></thead>
                    <tbody>${this.rows.length ? this.rows.map(row => html`<tr class="border-t border-border align-top">
                        <td class="px-3 py-2"><a class="font-medium text-foreground" href=${`/dashboard/network/sites/${row.id}`}>${row.name}</a><div class="text-xs text-muted-foreground">${row.host}</div></td>
                        <td class="px-3 py-2">${row.members}</td>
                        <td class="px-3 py-2">${siteStatus(row.status)}</td>
                        <td class="px-3 py-2 text-muted-foreground">${shortDate(row.createdAt)}</td>
                        <td class="px-3 py-2">${actions(row)}</td>
                    </tr>`) : html`<tr><td colspan="5" class="px-3 py-6 text-center text-muted-foreground">${__('No sites besides the main one yet.')}</td></tr>`}</tbody>
                </table>
            </div>
            ${this.canAdd ? html`<section id="add" class="max-w-xl space-y-4 rounded-lg border border-border p-4">
                <h2 class="text-lg font-semibold text-foreground">${__('Add site')}</h2>
                <form method="post" class="space-y-4">
                    <input type="hidden" name="action" value="add">
                    ${field('name', __('Name'), { required: true })}
                    ${field('host', __('Address'), { required: true, placeholder: this.suffix ? `blog.${this.suffix}` : 'blog.example.com', hint: this.suffix ? `${__('A subdomain of')} ${this.suffix}. ${__('Add its own domain once it exists.')}` : '' })}
                    ${field('admin', __('First administrator'), { type: 'email', placeholder: __('Your account when empty'), hint: __('The email of an existing account.') })}
                    <label class="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" name="starter" checked> ${__('Add starter content')}</label>
                    <button type="submit" class=${SUBMIT}>${__('Add site')}</button>
                </form>
            </section>` : notice(__('This network cannot add sites yet: give it a provider for site databases (see Network).'))}
        </div>`;
    }
}
