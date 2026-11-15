import { Client, Cossack, Page, Server, State, flashed, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Badge } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, NETWORK_ADMIN } from '@cossackframework/cms';
import { linkButton, notice, pageHeader, shortDate } from '../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../cms/guards';
import { network, siteNames } from '../../../../../cms/network-ui';
import { listFilters, listFooter, listTable, rowActions } from '../../../../../dashboard/list-table';

const PAGE_SIZE = 20;

interface AccountRow { id: string; name: string; email: string; status: 'active' | 'disabled'; admin: boolean; sites: string[]; lastSignInAt: number | null; createdAt: number; self: boolean }
type AccountAction = 'make-admin' | 'remove-admin' | 'suspend' | 'activate' | 'delete';

/** Network → Users: every account as a list table, with the sites it belongs to, network admins and suspension. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkUsers extends Cossack {
    @State() rows: AccountRow[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() search = '';
    @State() admins = false;
    /** All accounts and network admins, for the links above the list. */
    @State() counts = { all: 0, admins: 0 };
    @State() message = '';
    @State() error = '';
    /** The account waiting for the delete confirmation. */
    @State() pendingDelete: AccountRow | null = null;

    head(): HeadValue {
        return { title: 'Network users' };
    }

    async init() {
        const query = this.c.req.query();
        this.search = query.q?.trim() ?? '';
        this.admins = query.admins === '1';
        const page = Number(query.page);
        this.page = page >= 1 ? Math.floor(page) : 1;
        this.message = flashed<string>('network.message') ?? '';
        await this.load();
    }

    private async load() {
        const net = network(this.c);
        const search = this.search ? { search: this.search } : {};
        const [found, all, admins] = await Promise.all([
            net.main.accounts.list({ ...search, networkAdmins: this.admins, limit: PAGE_SIZE, offset: (this.page - 1) * PAGE_SIZE }),
            net.main.accounts.list({ ...search, limit: 1 }),
            net.main.accounts.list({ ...search, networkAdmins: true, limit: 1 }),
        ]);
        const memberships = await net.main.accounts.memberships(found.items.map(account => account.id));
        const names = await siteNames(this.c, [...memberships.values()].flat());
        const principal = this.c.get('principal');
        this.counts = { all: all.total, admins: admins.total };
        this.total = found.total;
        this.rows = found.items.map(account => ({
            id: account.id, name: account.name, email: account.email, status: account.status, admin: account.networkRole === NETWORK_ADMIN,
            sites: (memberships.get(account.id) ?? []).map(id => names.get(id) ?? id), lastSignInAt: account.lastSignInAt, createdAt: account.createdAt,
            self: principal.kind === 'user' && principal.id === account.id,
        }));
    }

    /** Change an account; your own stays as it is, so the network keeps an admin who can act. */
    @Server()
    async change(id: string, action: AccountAction) {
        this.message = '';
        this.error = '';
        const net = network(this.c);
        const principal = this.c.get('principal');
        try {
            if (principal.kind === 'user' && principal.id === id) throw new Error(__('Change your own account from your profile.'));
            if (action === 'make-admin' || action === 'remove-admin') {
                await net.main.accounts.setNetworkRole(id, action === 'make-admin' ? NETWORK_ADMIN : null);
                this.message = __('Saved.');
            } else if (action === 'suspend' || action === 'activate') {
                // Suspension signs the account out of every site.
                await net.main.accounts.setStatus(id, action === 'suspend' ? 'disabled' : 'active');
                this.message = action === 'suspend' ? __('Suspended and signed out everywhere.') : __('Active again.');
            } else if (action === 'delete') {
                await net.deleteAccount(id, { principal });
                this.message = __('Deleted from every site.');
            }
        } catch (error) {
            this.error = isCmsError(error) || error instanceof Error ? (error as Error).message : __('The account could not be changed.');
        }
        await this.load();
        const pages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        if (this.page > pages) { this.page = pages; await this.load(); }
    }

    @Client()
    async act(row: AccountRow, action: AccountAction) {
        await this.change(row.id, action);
    }

    @Client()
    requestDelete(row: AccountRow) {
        this.pendingDelete = row;
    }

    @Client()
    async confirmDelete() {
        const row = this.pendingDelete;
        this.pendingDelete = null;
        if (row) await this.change(row.id, 'delete');
    }

    private href(options: { admins?: boolean; page?: number } = {}): string {
        const params = new URLSearchParams();
        if (this.search) params.set('q', this.search);
        if (options.admins ?? this.admins) params.set('admins', '1');
        if ((options.page ?? 1) > 1) params.set('page', String(options.page));
        const query = params.toString();
        return query ? `/dashboard/network/users?${query}` : '/dashboard/network/users';
    }

    render() {
        const tabs = [{ admins: false, label: __('All'), count: this.counts.all }, { admins: true, label: __('Network admins'), count: this.counts.admins }];
        return html`<div class="space-y-6">
            ${pageHeader(__('Users'), {
                description: __('Accounts sign in once, on this host, and reach the sites they are members of. Roles are set per site.'),
                titleActions: linkButton(__('Add account'), '/dashboard/network/users/new', 'primary', { size: 'sm' }),
            })}
            ${this.message && !this.error ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="space-y-3">
                <nav aria-label=${__('Filter accounts')} class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    ${tabs.map((tab, index) => html`${index ? html`<span class="text-muted-foreground" aria-hidden="true">|</span>` : null}
                        <a href=${this.href({ admins: tab.admins })} class=${tab.admins === this.admins ? 'font-semibold text-foreground no-underline' : 'text-primary no-underline hover:underline'}
                            aria-current=${tab.admins === this.admins ? 'page' : 'false'}>${tab.label} <span class="text-muted-foreground">(${tab.count})</span></a>`)}
                </nav>
                ${listFilters({ action: '/dashboard/network/users', hidden: { admins: this.admins ? '1' : '' }, search: { name: 'q', value: this.search, placeholder: __('Search names and emails') } })}
            </div>
            ${listTable<AccountRow>({
                rows: this.rows, key: row => row.id, rowAttribute: 'data-account', empty: __('No accounts match.'),
                columns: [
                    { label: __('Account'), cell: row => html`<div class="min-w-0">
                        <a href=${`/dashboard/network/users/${row.id}`} class="font-medium text-foreground no-underline hover:text-primary">${row.name}</a>
                        ${row.self ? html` ${component(Badge, { variant: 'secondary' }, __('You'))}` : null}
                        ${row.admin ? html` ${component(Badge, { variant: 'default' }, __('Network admin'))}` : null}
                        ${row.status === 'disabled' ? html` ${component(Badge, { variant: 'destructive' }, __('Suspended'))}` : null}
                        <span class="block text-xs text-muted-foreground">${row.email}</span>
                        ${rowActions([
                            { id: `account-${row.id}-edit`, label: __('Edit'), href: `/dashboard/network/users/${row.id}` },
                            ...(row.self ? [] : [
                                row.admin ? { id: `account-${row.id}-remove-admin`, label: __('Remove network admin'), run: () => this.act(row, 'remove-admin') }
                                    : { id: `account-${row.id}-make-admin`, label: __('Make network admin'), run: () => this.act(row, 'make-admin') },
                                row.status === 'active' ? { id: `account-${row.id}-suspend`, label: __('Suspend'), danger: true, run: () => this.act(row, 'suspend') }
                                    : { id: `account-${row.id}-activate`, label: __('Activate'), run: () => this.act(row, 'activate') },
                                { id: `account-${row.id}-delete`, label: __('Delete'), danger: true, run: () => this.requestDelete(row) },
                            ]),
                        ])}
                    </div>` },
                    { label: __('Sites'), cell: row => html`<div class="flex flex-wrap gap-1">${row.sites.length ? row.sites.map(site => component(Badge, { variant: 'outline' }, site)) : html`<span class="text-xs text-muted-foreground">—</span>`}</div>` },
                    { label: __('Last sign-in'), class: 'text-muted-foreground', cell: row => row.lastSignInAt ? shortDate(row.lastSignInAt) : __('Never') },
                    { label: __('Created'), class: 'text-muted-foreground', cell: row => shortDate(row.createdAt) },
                ],
            })}
            ${listFooter({ total: this.total, page: this.page, totalPages: Math.max(1, Math.ceil(this.total / PAGE_SIZE)), href: page => this.href({ page }) })}
            ${component(AlertDialog, {
                id: 'delete-account-dialog',
                open: this.pendingDelete !== null,
                title: __('Delete account?'),
                description: this.pendingDelete ? `${this.pendingDelete.name} ${__('is removed from every site and can no longer sign in. This cannot be undone.')}` : '',
                cancelLabel: __('Cancel'),
                actionLabel: __('Delete'),
                actionVariant: 'destructive',
                onAction: () => this.confirmDelete(),
                onOpenChange: () => { this.pendingDelete = null; },
            })}
        </div>`;
    }
}
