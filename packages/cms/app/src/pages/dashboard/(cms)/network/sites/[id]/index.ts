import { Client, Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import { networkSite, siteImportState, type SiteDomain, type SiteStatus } from '@cossackframework/cms/server';
import { notice, pageHeader, shortDate } from '../../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../../cms/guards';
import { network, siteLinks } from '../../../../../../cms/network-ui';
import { actionButton, field, siteStatus, SUBMIT } from '../../../../../../cms/network-view';
import { listTable } from '../../../../../../dashboard/list-table';
import { importRequest, importSummary, sendsExport } from '../../../../../../cms/site-import';
import { sendExport } from '../../../../../../cms/import.client';

/** `movable`: the account can change kind here, a network account only when it belongs to this site alone and does not run the network. */
interface Member { id: string; name: string; email: string; roles: string; account: 'site' | 'network'; movable: boolean }

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
    /** Whether an export can be imported: into a new site, or again after an import stopped. */
    @State() importState: 'new' | 'stopped' | 'running' | 'used' = 'used';
    @State() importing = false;
    @State() importError = '';
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
            const users = (await host.users.list({ limit: 100 })).items;
            const network = users.filter(user => user.account === 'network').map(user => user.id);
            const [sites, admins] = await Promise.all([net.main.accounts.memberships(network), net.main.accounts.list({ networkAdmins: true, limit: 100 })]);
            const runsNetwork = new Set(admins.items.map(account => account.id));
            this.members = users.map(user => ({
                id: user.id, name: user.name, email: user.email, roles: user.assignments.map(role => role.name).join(', ') || __('No role'), account: user.account,
                movable: user.account === 'site' || (!runsNetwork.has(user.id) && (sites.get(user.id) ?? []).every(site => site === record.id)),
            }));
            this.roles = (await host.users.roles()).map(role => ({ id: role.id, name: role.name }));
            this.importState = await siteImportState(host);
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
        // An export sent as the request body; everything else is a form.
        if (sendsExport(this.c)) return this.importSite(id, true);
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
                if (!account) throw new Error(__('No network account has that email.'));
                const host = net.hostOf(networkSite(record));
                await host.users.addMember(account.id);
                await host.users.setRoles(account.id, value('role') ? [value('role')] : []);
                flash('network.message', `${account.name} ${__('is a member now.')}`);
            } else if (action === 'convert-member') {
                const to = value('to') === 'site' ? 'site' : 'network';
                const user = await net.hostOf(networkSite(record)).users.convert(value('account'), to);
                flash('network.message', `${user.name} ${to === 'site' ? __('has a site account now.') : __('has a network account now.')}`);
            } else if (action === 'import') {
                return this.importSite(id, false);
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

    /** Fill the site from an export: in the request body, or a form's file. */
    private async importSite(id: string, raw: boolean) {
        const net = network(this.c);
        try {
            const record = await net.sites.get(id);
            if (!record || record.status === 'creating') throw new Error(__('There is no such site.'));
            flash('network.message', importSummary(await importRequest(this.c, net.hostOf(networkSite(record)))));
            return raw ? this.c.json({ next: `/dashboard/network/sites/${id}` }) : this.redirect(`/dashboard/network/sites/${id}`);
        } catch (error) {
            const message = isCmsError(error) || error instanceof Error ? (error as Error).message : __('The export could not be imported.');
            if (raw) return this.c.json({ error: message }, 400);
            flash('network.error', message);
            return this.redirect(`/dashboard/network/sites/${id}`);
        }
    }

    /** Send the export as the request body, so a large file is read as a stream. */
    @Client()
    async upload(event: SubmitEvent) {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        this.importing = true;
        this.importError = '';
        const result = await sendExport(form);
        if (result.next) { location.assign(result.next); return; }
        this.importing = false;
        this.importError = result.error ?? '';
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
                        // Site accounts are the site's own: the network lists only its accounts.
                        { label: __('Member'), cell: member => html`${member.account === 'network' ? html`<a href=${`/dashboard/network/users/${member.id}`} class="font-medium text-foreground no-underline hover:text-primary">${member.name}</a>`
                                : html`<span class="font-medium text-foreground">${member.name}</span> ${component(Badge, { variant: 'outline' }, __('Site account'))}`}
                            <span class="block text-xs text-muted-foreground">${member.email}</span>` },
                        { label: __('Roles'), class: 'text-muted-foreground', cell: member => member.roles },
                        { label: '', class: 'text-right', cell: member => html`<span class="inline-flex flex-wrap justify-end gap-1.5">
                            ${member.movable ? actionButton('convert-member', member.account === 'site' ? __('Make a network account') : __('Make a site account'), { account: member.id, to: member.account === 'site' ? 'network' : 'site' }) : null}
                            ${actionButton('remove-member', __('Remove from site'), { account: member.id }, { danger: true })}</span>` },
                    ],
                })}
                <form method="post" class="flex max-w-xl flex-wrap items-end gap-3">
                    <input type="hidden" name="action" value="add-member">
                    <div class="flex-1">${field('email', __('Add a network account'), { type: 'email', required: true, hint: __('Site accounts are added on the site, under Users.') })}</div>
                    <select name="role" aria-label=${__('Role')} class="rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="">${__('No role')}</option>
                        ${this.roles.map(role => html`<option value=${role.id} ?selected=${role.id === 'editor'}>${role.name}</option>`)}
                    </select>
                    <button type="submit" class=${SUBMIT}>${__('Add')}</button>
                </form>
                <p class="text-xs text-muted-foreground">${__('A network account signs in on the network and can join other sites; a site account signs in on this site only. Changing the kind keeps the member\'s roles, password and authenticator app. Their sessions end, and their passkeys are removed: passkeys work only on the address they were made on.')}</p>
            </section>`}
            ${this.status !== 'creating' && (this.importState === 'new' || this.importState === 'stopped') ? card(__('Import an export'), html`
                ${this.importState === 'stopped' ? html`<p class="text-sm text-foreground" data-import-stopped>${__('An import into this site stopped partway. Import the export again to start over.')}</p>` : null}
                ${this.importError ? notice(this.importError, 'error') : null}
                <form method="post" enctype="multipart/form-data" class="flex max-w-xl flex-wrap items-end gap-3" data-site-import @submit=${(event: SubmitEvent) => this.upload(event)}>
                    <input type="hidden" name="action" value="import">
                    <input name="file" type="file" required accept=".json,application/json" aria-label=${__('Export file')} class="block flex-1 text-sm text-foreground">
                    <button type="submit" ?disabled=${this.importing} class=${SUBMIT}>${this.importing ? __('Importing…') : __('Import')}</button>
                </form>`, __('Fill this new site from another site\'s JSON export: its content, settings, roles and members. Network accounts among the members stay network accounts; the others get site accounts and set their passwords with Forgot password. Media files are not in exports: copy them to this site\'s storage.')) : null}
            ${this.status === 'creating' ? null : card(__('Database export'), html`
                ${this.exportRequest ? html`<p class="text-sm text-foreground" data-export-request>${this.exportRequest.approvedAt
                    ? `${__('Approved')} ${shortDate(this.exportRequest.approvedAt)}: ${__('the site can download its export until')} ${shortDate(this.exportRequest.expiresAt)}.`
                    : `${this.exportRequest.by} ${__('requested an export on')} ${shortDate(this.exportRequest.at)}.`}</p>
                    ${this.exportRequest.approvedAt ? null : html`<div class="flex flex-wrap gap-2">${actionButton('approve-export', __('Approve'))}${actionButton('decline-export', __('Decline'), {}, { danger: true })}</div>`}` : null}
                <div class="flex flex-wrap gap-2">
                    <a href=${`/api/cms/network/sites/${this.id}/export`} download class="inline-flex w-fit items-center justify-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground no-underline hover:bg-muted">${__('Download export')}</a>
                    <a href=${`/api/cms/network/sites/${this.id}/export?format=romedb`} download data-database-file class="inline-flex w-fit items-center justify-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground no-underline hover:bg-muted">${__('Download database file')}</a>
                </div>`,
                __('The JSON export leaves out sessions, passwords, second factors, application passwords and webhook secrets. The database file is a .romedb file that a new install opens directly: it keeps the site\'s own accounts with their password hashes, without sessions, webhooks or pending work. Media files are in neither.'))}
            ${this.status === 'creating' ? null : card(__('Site state'), html`<div class="flex flex-wrap gap-2">
                ${this.status === 'active' ? actionButton('archive', __('Archive'), {}) : null}
                ${this.status === 'archived' || this.status === 'deleted' ? actionButton('restore', __('Restore'), {}) : null}
                ${live ? actionButton('delete', __('Delete'), {}, { danger: true }) : null}
            </div>`, this.status === 'deleted' ? __('Deleted: its database and media go for good 30 days after deletion. Restore it before then.')
                : __('Archived sites show visitors "This site is archived"; members keep their dashboard. A deleted site can be restored for 30 days.'))}
        </div>`;
    }
}
