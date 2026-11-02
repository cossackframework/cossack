import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import { networkSite, type SiteDomain, type SiteStatus } from '@cossackframework/cms/server';
import { notice, pageHeader } from '../../../../../../cms/ui';
import { actionButton, field, network, requireNetworkAdmin, siteLinks, siteStatus, SUBMIT } from '../../../../../../cms/network-ui';

interface Member { id: string; name: string; email: string; roles: string }

/** One site: its name, domains (with the check that makes one primary) and members. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkSite extends Cossack {
    @State() id = '';
    @State() name = '';
    @State() status: SiteStatus = 'active';
    @State() domains: SiteDomain[] = [];
    @State() members: Member[] = [];
    @State() roles: { id: string; name: string }[] = [];
    @State() dashboard = '';
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: this.name || 'Site' };
    }

    async init() {
        const net = network(this.c);
        const record = await net.sites.get(this.c.req.param('id') ?? '');
        if (!record) { this.error = __('There is no such site.'); this.c.status(404); return; }
        Object.assign(this, { id: record.id, name: record.name, status: record.status, domains: [...record.domains] });
        this.dashboard = siteLinks(this.c, networkSite(record)).dashboard;
        if (record.status !== 'creating') {
            const host = net.hostOf(networkSite(record));
            this.members = (await host.users.list({ limit: 100 })).items.map(user => ({ id: user.id, name: user.name, email: user.email, roles: user.assignments.map(role => role.name).join(', ') || __('No role') }));
            this.roles = (await host.users.roles()).map(role => ({ id: role.id, name: role.name }));
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
            }
        } catch (error) {
            flash('network.error', isCmsError(error) || error instanceof Error ? (error as Error).message : 'The site could not be changed.');
        }
        return this.redirect(`/dashboard/network/sites/${id}`);
    }

    render() {
        if (!this.id) return html`<div class="max-w-3xl">${notice(this.error, 'error')}</div>`;
        return html`<div class="max-w-4xl space-y-8">
            ${pageHeader(this.name, { titleActions: siteStatus(this.status), actions: this.status === 'active' || this.status === 'archived' ? html`<a class="text-sm text-primary" href=${this.dashboard}>${__('Open its dashboard')}</a>` : null })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <form method="post" class="flex max-w-xl items-end gap-3">
                <input type="hidden" name="action" value="rename">
                <div class="flex-1">${field('name', __('Name'), { value: this.name, required: true })}</div>
                <button type="submit" class=${SUBMIT}>${__('Save')}</button>
            </form>
            <section class="space-y-3">
                <h2 class="text-lg font-semibold text-foreground">${__('Domains')}</h2>
                <ul class="divide-y divide-border rounded-lg border border-border">${this.domains.map(domain => html`<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span><span class="font-medium text-foreground">${domain.host}</span>
                        <span class="ml-2 text-xs text-muted-foreground">${domain.primary ? __('Primary') : domain.verifiedAt ? __('Alias, redirects to the primary domain') : __('Waiting for DNS')}</span></span>
                    <span class="flex gap-1.5">${domain.primary ? null : html`${actionButton('check-domain', __('Check and make primary'), { host: domain.host })}${actionButton('remove-domain', __('Remove'), { host: domain.host }, { danger: true })}`}</span>
                </li>`)}</ul>
                <form method="post" class="flex max-w-xl items-end gap-3">
                    <input type="hidden" name="action" value="add-domain">
                    <div class="flex-1">${field('host', __('Add a domain'), { placeholder: 'www.example.org', required: true })}</div>
                    <button type="submit" class=${SUBMIT}>${__('Add')}</button>
                </form>
            </section>
            ${this.status === 'creating' ? null : html`<section class="space-y-3">
                <h2 class="text-lg font-semibold text-foreground">${__('Members')}</h2>
                <ul class="divide-y divide-border rounded-lg border border-border">${this.members.map(member => html`<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span><span class="font-medium text-foreground">${member.name}</span> <span class="text-muted-foreground">${member.email}</span> <span class="ml-2 text-xs text-muted-foreground">${member.roles}</span></span>
                    ${actionButton('remove-member', __('Remove from site'), { account: member.id }, { danger: true })}
                </li>`)}</ul>
                <form method="post" class="flex max-w-xl flex-wrap items-end gap-3">
                    <input type="hidden" name="action" value="add-member">
                    <div class="flex-1">${field('email', __('Add an account'), { type: 'email', required: true })}</div>
                    <select name="role" class="rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="">${__('No role')}</option>
                        ${this.roles.map(role => html`<option value=${role.id} ?selected=${role.id === 'editor'}>${role.name}</option>`)}
                    </select>
                    <button type="submit" class=${SUBMIT}>${__('Add')}</button>
                </form>
            </section>`}
        </div>`;
    }
}
