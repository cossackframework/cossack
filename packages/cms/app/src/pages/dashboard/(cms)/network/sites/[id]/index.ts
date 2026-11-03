import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import { networkSite, type SiteDomain, type SiteStatus } from '@cossackframework/cms/server';
import { notice, pageHeader, shortDate } from '../../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../../cms/guards';
import { network, siteLinks } from '../../../../../../cms/network-ui';
import { actionButton, field, siteStatus, SUBMIT } from '../../../../../../cms/network-view';
import { listTable } from '../../../../../../dashboard/list-table';

interface Member { id: string; name: string; email: string; roles: string }

/** One site: its name, domains (with the check that makes one primary), members and state. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkSite extends Cossack {
    @State() id = '';
    @State() name = '';
    @State() status: SiteStatus = 'active';
    @State() createdAt = 0;
    @State() domains: SiteDomain[] = [];
    @State() members: Member[] = [];
    @State() roles: { id: string; name: string }[] = [];
    @State() home = '';
    @State() dashboard = '';
    /** The site's export request: who asked and when, and the approval while it lasts. */
    @State() exportRequest: { by: string; at: number; approvedAt: number | null; expiresAt: number | null } | null = null;
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: this.name || 'Site' };
    }

    async init() {
        const net = network(this.c);
        const record = await net.sites.get(this.c.req.param('id') ?? '');
        if (!record) { this.error = __('There is no such site.'); this.c.status(404); return; }
        Object.assign(this, { id: record.id, name: record.name, status: record.status, createdAt: record.createdAt, domains: [...record.domains] }, siteLinks(this.c, networkSite(record)));
        if (record.status !== 'creating') {
            const host = net.hostOf(networkSite(record));
            this.members = (await host.users.list({ limit: 100 })).items.map(user => ({ id: user.id, name: user.name, email: user.email, roles: user.assignments.map(role => role.name).join(', ') || __('No role') }));
            this.roles = (await host.users.roles()).map(role => ({ id: role.id, name: role.name }));
        }
        const request = (await net.exportRequests()).get(record.id);
        if (request) {
            const account = await net.main.accounts.get(request.requestedBy);
            this.exportRequest = { by: account ? `${account.name} (${account.email})` : request.requestedBy, at: request.requestedAt, approvedAt: request.approvedAt, expiresAt: request.expiresAt };
        }
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const id = this.c.req.param('id') ?? '';
        const form = await this.c.req.formData();
        const value = (name: string) => String(form.get(name) ?? '').trim();
        const net = network(this.c);
        const principal = this.c.get('principal');
        try {
            const record = await net.sites.get(id);
            if (!record) throw new Error(__('There is no such site.'));
            const action = value('action');
            if (action === 'rename') {
                await net.sites.update(id, { name: value('name') });
                net.invalidate();
                flash('network.message', __('Saved.'));
            } else if (action === 'add-domain') {
                await net.addDomain(id, value('host'), { principal });
                flash('network.message', __('Added. Point its DNS at this network, then check it to make it the primary domain.'));
            } else if (action === 'check-domain') {
                flash(await net.checkDomain(id, value('host'), { principal }) ? 'network.message' : 'network.error',
                    await net.sites.get(id).then(site => site?.domains.find(domain => domain.host === value('host'))?.primary) ? `${value('host')} ${__('is now the primary domain.')}` : `${value('host')} ${__('does not answer for this site yet. Waiting for DNS.')}`);
            } else if (action === 'remove-domain') {
                await net.removeDomain(id, value('host'), { principal });
                flash('network.message', __('Removed.'));
            } else if (action === 'add-member') {
                const account = await net.main.accounts.findByEmail(value('email'));
                if (!account) throw new Error(__('No account has that email.'));
                const host = net.hostOf(networkSite(record));
                await host.users.addMember(account.id);
                await host.users.setRoles(account.id, value('role') ? [value('role')] : []);
                flash('network.message', `${account.name} ${__('is a member now.')}`);
            } else if (action === 'remove-member') {
                await net.hostOf(networkSite(record)).users.delete(value('account'));
                flash('network.message', __('Removed from the site.'));
            } else if (action === 'approve-export' || action === 'decline-export') {
                await net.answerExport(id, action === 'approve-export', { principal });
                flash('network.message', action === 'approve-export' ? __('Approved. The site can download its export under Tools → Export for 7 days.') : __('Declined.'));
            } else if (action === 'archive' || action === 'restore' || action === 'delete') {
                const site = await net.setSiteStatus(id, action === 'archive' ? 'archived' : action === 'delete' ? 'deleted' : 'active', { principal });
                flash('network.message', action === 'delete' ? `${site.name} ${__('is deleted. It can be restored for 30 days.')}` : `${site.name} ${action === 'archive' ? __('is archived.') : __('is active.')}`);
            }
        } catch (error) {
            flash('network.error', isCmsError(error) || error instanceof Error ? (error as Error).message : __('The site could not be changed.'));
        }
        return this.redirect(`/dashboard/network/sites/${id}`);
    }

    render() {
        if (!this.id) return html`<div class="max-w-3xl space-y-4">${notice(this.error, 'error')}<a href="/dashboard/network/sites" class="text-sm text-primary">← ${__('Sites')}</a></div>`;
        const live = this.status === 'active' || this.status === 'archived';
        const card = (title: string, body: TemplateResult, description = '') => component(Card, {}, html`
            ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${title}</h2>${description ? html`<p class="mt-1 text-sm text-muted-foreground">${description}</p>` : null}`)}
            ${component(CardBody, { class: 'space-y-4' }, body)}`);
        return html`<div class="max-w-4xl space-y-6">
            ${pageHeader(this.name, {
                titleActions: siteStatus(this.status),
                description: `${this.domains.find(domain => domain.primary)?.host ?? ''}${this.createdAt ? ` · ${__('Created')} ${shortDate(this.createdAt)}` : ''}`,
                actions: html`<div class="flex flex-wrap items-center gap-3 text-sm">
                    <a href="/dashboard/network/sites" class="text-muted-foreground hover:text-foreground">← ${__('Sites')}</a>
                    ${live ? html`<a class="text-primary" href=${this.dashboard}>${__('Dashboard')}</a><a class="text-primary" href=${this.home}>${__('Visit')}</a>` : null}
                </div>`,
            })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${card(__('Details'), html`<form method="post" class="flex max-w-xl items-end gap-3">
                <input type="hidden" name="action" value="rename">
                <div class="flex-1">${field('name', __('Name'), { value: this.name, required: true })}</div>
                <button type="submit" class=${SUBMIT}>${__('Save')}</button>
            </form>`)}
            ${card(__('Domains'), html`
                <ul class="divide-y divide-border rounded-lg border border-border">${this.domains.map(domain => html`<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-domain=${domain.host}>
                    <span><span class="font-medium text-foreground">${domain.host}</span>
                        <span class="ml-2 text-xs text-muted-foreground">${domain.primary ? __('Primary') : domain.verifiedAt ? __('Alias, redirects to the primary domain') : __('Waiting for DNS')}</span></span>
                    <span class="flex gap-1.5">${domain.primary ? null : html`${actionButton('check-domain', __('Check and make primary'), { host: domain.host })}${actionButton('remove-domain', __('Remove'), { host: domain.host }, { danger: true })}`}</span>
                </li>`)}</ul>
                <form method="post" class="flex max-w-xl items-end gap-3">
                    <input type="hidden" name="action" value="add-domain">
                    <div class="flex-1">${field('host', __('Add a domain'), { placeholder: 'www.example.org', required: true })}</div>
                    <button type="submit" class=${SUBMIT}>${__('Add')}</button>
                </form>`, __('The primary domain serves the site; the others redirect to it.'))}
            ${this.status === 'creating' ? null : html`<section class="space-y-3">
                <h2 class="text-base font-semibold text-foreground">${__('Members')}</h2>
                ${listTable<Member>({
                    rows: this.members, key: member => member.id, rowAttribute: 'data-member', empty: __('This site has no members.'),
                    columns: [
                        { label: __('Member'), cell: member => html`<a href=${`/dashboard/network/users/${member.id}`} class="font-medium text-foreground no-underline hover:text-primary">${member.name}</a>
                            <span class="block text-xs text-muted-foreground">${member.email}</span>` },
                        { label: __('Roles'), class: 'text-muted-foreground', cell: member => member.roles },
                        { label: '', class: 'text-right', cell: member => actionButton('remove-member', __('Remove from site'), { account: member.id }, { danger: true }) },
                    ],
                })}
                <form method="post" class="flex max-w-xl flex-wrap items-end gap-3">
                    <input type="hidden" name="action" value="add-member">
                    <div class="flex-1">${field('email', __('Add an account'), { type: 'email', required: true })}</div>
                    <select name="role" aria-label=${__('Role')} class="rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="">${__('No role')}</option>
                        ${this.roles.map(role => html`<option value=${role.id} ?selected=${role.id === 'editor'}>${role.name}</option>`)}
                    </select>
                    <button type="submit" class=${SUBMIT}>${__('Add')}</button>
                </form>
            </section>`}
            ${this.status === 'creating' ? null : card(__('Database export'), html`
                ${this.exportRequest ? html`<p class="text-sm text-foreground" data-export-request>${this.exportRequest.approvedAt
                    ? `${__('Approved')} ${shortDate(this.exportRequest.approvedAt)}: ${__('the site can download its export until')} ${shortDate(this.exportRequest.expiresAt)}.`
                    : `${this.exportRequest.by} ${__('requested an export on')} ${shortDate(this.exportRequest.at)}.`}</p>
                    ${this.exportRequest.approvedAt ? null : html`<div class="flex flex-wrap gap-2">${actionButton('approve-export', __('Approve'))}${actionButton('decline-export', __('Decline'), {}, { danger: true })}</div>`}` : null}
                <a href=${`/api/cms/network/sites/${this.id}/export`} download class="inline-flex w-fit items-center justify-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground no-underline hover:bg-muted">${__('Download export')}</a>`,
                __('The site\'s database as one JSON file. Sessions, passwords, second factors, application passwords and webhook secrets stay out; media files are not included.'))}
            ${this.status === 'creating' ? null : card(__('Site state'), html`<div class="flex flex-wrap gap-2">
                ${this.status === 'active' ? actionButton('archive', __('Archive'), {}) : null}
                ${this.status === 'archived' || this.status === 'deleted' ? actionButton('restore', __('Restore'), {}) : null}
                ${live ? actionButton('delete', __('Delete'), {}, { danger: true }) : null}
            </div>`, this.status === 'deleted' ? __('Deleted: its database and media go for good 30 days after deletion. Restore it before then.')
                : __('Archived sites show visitors "This site is archived"; members keep their dashboard. A deleted site can be restored for 30 days.'))}
        </div>`;
    }
}
