import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { DEFAULT_ROLES, isCmsError, isSameOriginPost, MAIN_SITE, NETWORK_ADMIN } from '@cossackframework/cms';
import { networkSite, type CmsHost } from '@cossackframework/cms/server';
import { notice, pageHeader, shortDate } from '../../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../../cms/guards';
import { network, siteLinks, siteNames } from '../../../../../../cms/network-ui';
import { actionButton, field, SUBMIT } from '../../../../../../cms/network-view';
import { listTable } from '../../../../../../dashboard/list-table';

interface Membership { id: string; name: string; roles: string; dashboard: string }

/** One account: its profile and password, network role, suspension, the sites it belongs to with their roles, and deletion. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkUser extends Cossack {
    @State() id = '';
    @State() name = '';
    @State() email = '';
    @State() status: 'active' | 'disabled' = 'active';
    @State() admin = false;
    @State() self = false;
    @State() createdAt = 0;
    @State() lastSignInAt: number | null = null;
    @State() memberships: Membership[] = [];
    /** Sites the account can join: the main site and active or archived sites it is not a member of. */
    @State() joinable: { id: string; name: string }[] = [];
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: this.name || 'Account' };
    }

    async init() {
        const net = network(this.c);
        const account = await net.main.accounts.get(this.c.req.param('id') ?? '');
        if (!account) { this.error = __('There is no such account.'); this.c.status(404); return; }
        const principal = this.c.get('principal');
        Object.assign(this, {
            id: account.id, name: account.name, email: account.email, status: account.status, admin: account.networkRole === NETWORK_ADMIN,
            self: principal.kind === 'user' && principal.id === account.id, createdAt: account.createdAt, lastSignInAt: account.lastSignInAt,
        });
        const ids = (await net.main.accounts.memberships([account.id])).get(account.id) ?? [];
        const names = await siteNames(this.c, ids);
        const memberships: Membership[] = [];
        for (const site of ids) {
            const host = await this.hostOf(site);
            if (!host) continue;
            const member = await host.users.get(account.id);
            const record = site === MAIN_SITE ? null : await net.sites.get(site);
            memberships.push({ id: site, name: names.get(site) ?? site, roles: member?.assignments.map(role => role.name).join(', ') || __('No role'),
                dashboard: siteLinks(this.c, { host: record?.domains.find(domain => domain.primary)?.host ?? null }).dashboard });
        }
        this.memberships = memberships;
        const open = [...(await net.sites.list({ status: 'active', limit: 100 })).items, ...(await net.sites.list({ status: 'archived', limit: 100 })).items];
        const others = await siteNames(this.c, [MAIN_SITE]);
        this.joinable = [{ id: MAIN_SITE, name: others.get(MAIN_SITE)! }, ...open.map(site => ({ id: site.id, name: site.name }))].filter(site => !ids.includes(site.id));
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    /** A site's host, for the main site or an added site that is not being created. */
    private async hostOf(site: string): Promise<CmsHost | null> {
        const net = network(this.c);
        if (site === MAIN_SITE) return net.main;
        const record = await net.sites.get(site);
        return record && record.status !== 'creating' ? net.hostOf(networkSite(record)) : null;
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const id = this.c.req.param('id') ?? '';
        const form = await this.c.req.formData();
        const value = (name: string) => String(form.get(name) ?? '').trim();
        const net = network(this.c);
        const principal = this.c.get('principal');
        const accounts = net.main.accounts;
        try {
            const account = await accounts.get(id);
            if (!account) throw new Error(__('There is no such account.'));
            const self = principal.kind === 'user' && principal.id === id;
            const action = value('action');
            if (self && action !== 'profile') throw new Error(__('Change your own account from your profile.'));
            if (action === 'profile') {
                await accounts.update(id, { name: value('name'), email: value('email') });
                // Sites keep a copy of the name and email in their member rows.
                for (const site of (await accounts.memberships([id])).get(id) ?? []) await (await this.hostOf(site))?.users.update(id, { name: value('name'), email: value('email') });
                if (value('password')) await accounts.setPassword(id, value('password'));
                flash('network.message', __('Saved.'));
            } else if (action === 'make-admin' || action === 'remove-admin') {
                await accounts.setNetworkRole(id, action === 'make-admin' ? NETWORK_ADMIN : null);
                flash('network.message', __('Saved.'));
            } else if (action === 'suspend' || action === 'activate') {
                await accounts.setStatus(id, action === 'suspend' ? 'disabled' : 'active');
                flash('network.message', action === 'suspend' ? __('Suspended and signed out everywhere.') : __('Active again.'));
            } else if (action === 'add-site') {
                const host = await this.hostOf(value('site'));
                if (!host) throw new Error(__('There is no such site.'));
                const role = value('role');
                if (role && !(await host.users.roles()).some(entry => entry.id === role)) throw new Error(__('That site has no such role.'));
                await host.users.addMember(id);
                await host.users.setRoles(id, role ? [role] : []);
                flash('network.message', `${account.name} ${__('is a member now.')}`);
            } else if (action === 'remove-site') {
                await (await this.hostOf(value('site')))?.users.delete(id);
                flash('network.message', __('Removed from the site.'));
            } else if (action === 'delete') {
                await net.deleteAccount(id, { principal });
                flash('network.message', __('Deleted from every site.'));
                return this.redirect('/dashboard/network/users');
            }
        } catch (error) {
            flash('network.error', isCmsError(error) || error instanceof Error ? (error as Error).message : __('The account could not be changed.'));
        }
        return this.redirect(`/dashboard/network/users/${id}`);
    }

    render() {
        if (!this.id) return html`<div class="max-w-3xl space-y-4">${notice(this.error, 'error')}<a href="/dashboard/network/users" class="text-sm text-primary">← ${__('Users')}</a></div>`;
        const card = (title: string, body: TemplateResult, description = '') => component(Card, {}, html`
            ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${title}</h2>${description ? html`<p class="mt-1 text-sm text-muted-foreground">${description}</p>` : null}`)}
            ${component(CardBody, { class: 'space-y-4' }, body)}`);
        return html`<div class="max-w-4xl space-y-6">
            ${pageHeader(this.name, {
                titleActions: html`${this.self ? component(Badge, { variant: 'secondary' }, __('You')) : null}
                    ${this.admin ? component(Badge, { variant: 'default' }, __('Network admin')) : null}
                    ${this.status === 'disabled' ? component(Badge, { variant: 'destructive' }, __('Suspended')) : null}`,
                description: `${this.email} · ${__('Created')} ${shortDate(this.createdAt)} · ${__('Last sign-in')} ${this.lastSignInAt ? shortDate(this.lastSignInAt) : __('never')}`,
                actions: html`<a href="/dashboard/network/users" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Users')}</a>`,
            })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${card(__('Profile'), html`<form method="post" class="max-w-xl space-y-4">
                <input type="hidden" name="action" value="profile">
                ${field('name', __('Name'), { value: this.name, required: true })}
                ${field('email', __('Email'), { type: 'email', value: this.email, required: true })}
                ${field('password', __('New password'), { type: 'password', placeholder: __('Unchanged when empty'), hint: __('At least 8 characters.') })}
                <button type="submit" class=${SUBMIT}>${__('Save')}</button>
            </form>`, __('The account signs in to every site with this email and password.'))}
            ${html`<section class="space-y-3">
                <h2 class="text-base font-semibold text-foreground">${__('Sites')}</h2>
                ${listTable<Membership>({
                    rows: this.memberships, key: site => site.id, rowAttribute: 'data-membership', empty: __('This account belongs to no site.'),
                    columns: [
                        { label: __('Site'), cell: site => html`${site.id === MAIN_SITE ? html`<span class="font-medium text-foreground">${site.name}</span>`
                            : html`<a href=${`/dashboard/network/sites/${site.id}`} class="font-medium text-foreground no-underline hover:text-primary">${site.name}</a>`}
                            <a href=${site.dashboard} class="block text-xs text-primary">${__('Dashboard')}</a>` },
                        { label: __('Roles'), class: 'text-muted-foreground', cell: site => site.roles },
                        { label: '', class: 'text-right', cell: site => this.self ? null : actionButton('remove-site', __('Remove from site'), { site: site.id }, { danger: true }) },
                    ],
                })}
                ${this.self || !this.joinable.length ? null : html`<form method="post" class="flex max-w-xl flex-wrap items-end gap-3">
                    <input type="hidden" name="action" value="add-site">
                    <div class="flex-1 space-y-1.5">
                        <label for="network-site" class="block text-sm font-medium text-foreground">${__('Add to a site')}</label>
                        <select id="network-site" name="site" class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">${this.joinable.map(site => html`<option value=${site.id}>${site.name}</option>`)}</select>
                    </div>
                    <select name="role" aria-label=${__('Role')} class="rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="">${__('No role')}</option>
                        ${DEFAULT_ROLES.map(role => html`<option value=${role.id} ?selected=${role.id === 'editor'}>${role.name}</option>`)}
                    </select>
                    <button type="submit" class=${SUBMIT}>${__('Add')}</button>
                </form>`}
            </section>`}
            ${this.self ? null : card(__('Network access'), html`<div class="flex flex-wrap gap-2">
                ${this.admin ? actionButton('remove-admin', __('Remove network admin')) : actionButton('make-admin', __('Make network admin'))}
                ${this.status === 'active' ? actionButton('suspend', __('Suspend'), {}, { danger: true }) : actionButton('activate', __('Activate'))}
            </div>
            <details class="rounded-md border border-destructive/30 p-3">
                <summary class="cursor-pointer text-sm font-medium text-destructive">${__('Delete account…')}</summary>
                <div class="mt-3 space-y-3">
                    <p class="text-sm text-muted-foreground">${this.name} ${__('is removed from every site and can no longer sign in. This cannot be undone; content keeps its author ID.')}</p>
                    ${actionButton('delete', __('Delete for good'), {}, { danger: true })}
                </div>
            </details>`, __('Network admins run every site and this dashboard. Suspension signs the account out everywhere until it is activated again.'))}
        </div>`;
    }
}
