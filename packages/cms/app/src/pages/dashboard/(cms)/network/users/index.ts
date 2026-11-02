import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost, NETWORK_ADMIN } from '@cossackframework/cms';
import { MAIN_SITE } from '@cossackframework/cms/server';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';
import { actionButton, field, network, requireNetworkAdmin, SUBMIT } from '../../../../../cms/network-ui';

interface AccountRow { id: string; name: string; email: string; status: 'active' | 'disabled'; admin: boolean; sites: string[]; lastSignInAt: number | null; self: boolean }

/** Network → Users: every account, the sites it belongs to, the network admins, and suspension. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkUsers extends Cossack {
    @State() rows: AccountRow[] = [];
    @State() total = 0;
    @State() search = '';
    @State() admins = false;
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Network users' };
    }

    async init() {
        const net = network(this.c);
        const query = this.c.req.query();
        this.search = query.q ?? '';
        this.admins = query.admins === '1';
        const page = await net.main.accounts.list({ ...(this.search ? { search: this.search } : {}), networkAdmins: this.admins, limit: 100 });
        const memberships = await net.main.accounts.memberships(page.items.map(account => account.id));
        const names = new Map<string, string>([[MAIN_SITE, __('Main site')]]);
        for (const id of new Set([...memberships.values()].flat())) if (!names.has(id)) names.set(id, (await net.sites.get(id))?.name ?? id);
        const principal = this.c.get('principal');
        this.total = page.total;
        this.rows = page.items.map(account => ({
            id: account.id, name: account.name, email: account.email, status: account.status, admin: account.networkRole === NETWORK_ADMIN,
            sites: (memberships.get(account.id) ?? []).map(id => names.get(id) ?? id), lastSignInAt: account.lastSignInAt, self: principal.kind === 'user' && principal.id === account.id,
        }));
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        const value = (name: string) => String(form.get(name) ?? '').trim();
        const net = network(this.c);
        const principal = this.c.get('principal');
        const accounts = net.main.accounts;
        try {
            const action = value('action');
            const id = value('account');
            if (action === 'add') {
                const account = await accounts.create({ email: value('email'), name: value('name') || value('email').split('@')[0]!, password: value('password') });
                flash('network.message', `${account.name} ${__('can sign in now. Add them to sites under Network → Sites.')}`);
            } else if (action === 'make-admin' || action === 'remove-admin') {
                await accounts.setNetworkRole(id, action === 'make-admin' ? NETWORK_ADMIN : null);
                flash('network.message', __('Saved.'));
            } else if (action === 'suspend' || action === 'activate') {
                // Suspension signs the account out of every site.
                await accounts.setStatus(id, action === 'suspend' ? 'disabled' : 'active');
                flash('network.message', action === 'suspend' ? __('Suspended and signed out everywhere.') : __('Active again.'));
            } else if (action === 'delete') {
                await net.deleteAccount(id, { principal });
                flash('network.message', __('Deleted from every site.'));
            }
        } catch (error) {
            flash('network.error', isCmsError(error) || error instanceof Error ? (error as Error).message : 'The account could not be changed.');
        }
        return this.redirect('/dashboard/network/users');
    }

    render() {
        return html`<div class="max-w-6xl space-y-6">
            ${pageHeader(__('Users'), { description: __('Accounts sign in once, on this host, and reach the sites they are members of. Roles are set per site.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <form method="get" class="flex flex-wrap items-center gap-2">
                <input name="q" .value=${this.search} placeholder=${__('Search names and emails')} class="rounded-md border border-input bg-background px-3 py-2 text-sm">
                <label class="flex items-center gap-1.5 text-sm"><input type="checkbox" name="admins" value="1" ?checked=${this.admins}> ${__('Network admins')}</label>
                <button type="submit" class="rounded-md border border-border bg-background px-3 py-2 text-sm cursor-pointer">${__('Filter')}</button>
            </form>
            <div class="overflow-x-auto rounded-lg border border-border">
                <table class="w-full text-sm">
                    <thead class="bg-muted/50 text-left text-muted-foreground"><tr>
                        <th class="px-3 py-2 font-medium">${__('Account')}</th><th class="px-3 py-2 font-medium">${__('Sites')}</th>
                        <th class="px-3 py-2 font-medium">${__('Last sign-in')}</th><th class="px-3 py-2"></th>
                    </tr></thead>
                    <tbody>${this.rows.map(row => html`<tr class="border-t border-border align-top">
                        <td class="px-3 py-2"><span class="font-medium text-foreground">${row.name}</span>
                            ${row.admin ? html`<span class="ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">${__('Network admin')}</span>` : null}
                            ${row.status === 'disabled' ? html`<span class="ml-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">${__('Suspended')}</span>` : null}
                            <div class="text-xs text-muted-foreground">${row.email}</div></td>
                        <td class="px-3 py-2"><div class="flex flex-wrap gap-1">${row.sites.map(site => html`<span class="rounded-full bg-muted px-2 py-0.5 text-xs">${site}</span>`)}</div></td>
                        <td class="px-3 py-2 text-muted-foreground">${row.lastSignInAt ? shortDate(row.lastSignInAt) : __('Never')}</td>
                        <td class="px-3 py-2"><div class="flex flex-wrap gap-1.5">${row.self ? null : html`
                            ${row.admin ? actionButton('remove-admin', __('Remove network admin'), { account: row.id }) : actionButton('make-admin', __('Make network admin'), { account: row.id })}
                            ${row.status === 'active' ? actionButton('suspend', __('Suspend'), { account: row.id }, { danger: true }) : actionButton('activate', __('Activate'), { account: row.id })}
                            ${actionButton('delete', __('Delete'), { account: row.id }, { danger: true })}`}</div></td>
                    </tr>`)}</tbody>
                </table>
            </div>
            <section class="max-w-xl space-y-4 rounded-lg border border-border p-4">
                <h2 class="text-lg font-semibold text-foreground">${__('Add account')}</h2>
                <form method="post" class="space-y-4">
                    <input type="hidden" name="action" value="add">
                    ${field('name', __('Name'))}
                    ${field('email', __('Email'), { type: 'email', required: true })}
                    ${field('password', __('Password'), { type: 'password', required: true, hint: __('At least 8 characters.') })}
                    <button type="submit" class=${SUBMIT}>${__('Add account')}</button>
                </form>
            </section>
        </div>`;
    }
}
