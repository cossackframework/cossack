import { Client, Cossack, Page, Server, State, flashed, type HeadValue } from '@cossackframework/core';
import { AlertDialog } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, MAIN_SITE } from '@cossackframework/cms';
import { networkSite, type SiteStatus } from '@cossackframework/cms/server';
import { linkButton, notice, pageHeader, shortDate } from '../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../cms/guards';
import { network, siteIconUrl, siteLinks } from '../../../../../cms/network-ui';
import { siteIcon, siteStatus } from '../../../../../cms/network-view';
import { listFilters, listFooter, listTable, rowActions } from '../../../../../dashboard/list-table';

const PAGE_SIZE = 20;
const STATUSES = ['active', 'archived', 'deleted', 'creating'] as const;
const STATUS_LABELS: Record<string, string> = { '': 'All', active: 'Active', archived: 'Archived', deleted: 'Deleted', creating: 'Being created' };

interface SiteRow { id: string; name: string; host: string; status: SiteStatus; members: number; createdAt: number | null; home: string; dashboard: string; icon: string; exportRequested: boolean }

/** Network → Sites: every site as a list table, the main site first, with its address, members and state. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkSites extends Cossack {
    @State() rows: SiteRow[] = [];
    @State() total = 0;
    @State() pages = 1;
    @State() page = 1;
    @State() search = '';
    @State() status = '';
    /** The status links above the list, with how many sites each has. */
    @State() counts: { key: string; count: number }[] = [];
    @State() canAdd = false;
    @State() message = '';
    @State() error = '';
    /** The site waiting for the delete confirmation. */
    @State() pendingDelete: SiteRow | null = null;

    head(): HeadValue {
        return { title: 'Sites' };
    }

    async init() {
        const query = this.c.req.query();
        this.search = query.q?.trim() ?? '';
        this.status = (STATUSES as readonly string[]).includes(query.status ?? '') ? query.status! : '';
        const page = Number(query.page);
        this.page = page >= 1 ? Math.floor(page) : 1;
        this.canAdd = network(this.c).canAddSites;
        this.message = flashed<string>('network.message') ?? '';
        await this.load();
    }

    /** The page of sites and the counts by status. The main site, which has no registry row, leads All and Active. */
    private async load() {
        const net = network(this.c);
        const search = this.search ? { search: this.search } : {};
        const [totals, members, mainName, networkIcon, requests] = await Promise.all([
            Promise.all(STATUSES.map(status => net.sites.list({ ...search, status, limit: 1 }).then(found => found.total))),
            net.main.accounts.memberCounts(),
            net.main.settings.get('general.siteTitle').then(title => title || __('Main site'), () => __('Main site')),
            // The main site's icon is the network's, for sites without one.
            siteIconUrl(this.c, net.main, { host: null }),
            net.exportRequests(),
        ]);
        const withMain = !this.search || mainName.toLowerCase().includes(this.search.toLowerCase()) ? 1 : 0;
        const byStatus = new Map(STATUSES.map((status, index) => [status, totals[index]!]));
        this.counts = [
            { key: '', count: totals.reduce((sum, count) => sum + count, withMain) },
            ...STATUSES.map(status => ({ key: status, count: byStatus.get(status)! + (status === 'active' ? withMain : 0) })).filter(entry => entry.key !== 'creating' || entry.count),
        ];
        const found = await net.sites.list({ ...search, ...(this.status ? { status: this.status as SiteStatus } : {}), limit: PAGE_SIZE, offset: (this.page - 1) * PAGE_SIZE });
        const leadsWithMain = withMain && this.page === 1 && (!this.status || this.status === 'active');
        const main: SiteRow[] = leadsWithMain ? [{ id: MAIN_SITE, name: mainName, host: new URL(siteLinks(this.c, { host: null }).home, this.c.req.url).host, status: 'active', members: members.get(MAIN_SITE) ?? 0, createdAt: null, icon: networkIcon, exportRequested: false, ...siteLinks(this.c, { host: null }) }] : [];
        this.rows = [...main, ...await Promise.all(found.items.map(async site => {
            const host = site.domains.find(domain => domain.primary)?.host ?? '';
            // Sites being created or deleted have no settings to read.
            const own = site.status === 'active' || site.status === 'archived' ? await siteIconUrl(this.c, net.hostOf(networkSite(site)), { host }) : '';
            return { id: site.id, name: site.name, host, status: site.status, members: members.get(site.id) ?? 0, createdAt: site.createdAt, icon: own || networkIcon,
                exportRequested: requests.get(site.id)?.approvedAt === null, ...siteLinks(this.c, { host }) };
        }))];
        this.total = found.total + (this.status === '' || this.status === 'active' ? withMain : 0);
        this.pages = Math.max(1, Math.ceil(found.total / PAGE_SIZE));
    }

    /** Archive, restore or delete a site. A deleted site can be restored for 30 days. */
    @Server()
    async change(id: string, action: 'archive' | 'restore' | 'delete') {
        this.message = '';
        this.error = '';
        try {
            const site = await network(this.c).setSiteStatus(id, action === 'archive' ? 'archived' : action === 'delete' ? 'deleted' : 'active', { principal: this.c.get('principal') });
            this.message = action === 'delete' ? `${site.name} ${__('is deleted. It can be restored for 30 days.')}` : `${site.name} ${action === 'archive' ? __('is archived.') : __('is active.')}`;
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The site could not be changed.');
        }
        await this.load();
        if (this.page > this.pages) { this.page = this.pages; await this.load(); }
    }

    @Client()
    async act(row: SiteRow, action: 'archive' | 'restore') {
        await this.change(row.id, action);
    }

    @Client()
    requestDelete(row: SiteRow) {
        this.pendingDelete = row;
    }

    @Client()
    async confirmDelete() {
        const row = this.pendingDelete;
        this.pendingDelete = null;
        if (row) await this.change(row.id, 'delete');
    }

    /** The list's address with the current search and status. */
    private href(options: { status?: string; page?: number } = {}): string {
        const params = new URLSearchParams();
        const status = options.status ?? this.status;
        if (this.search) params.set('q', this.search);
        if (status) params.set('status', status);
        if ((options.page ?? 1) > 1) params.set('page', String(options.page));
        const query = params.toString();
        return query ? `/dashboard/network/sites?${query}` : '/dashboard/network/sites';
    }

    render() {
        const actions = (row: SiteRow) => rowActions([
            ...(row.id === MAIN_SITE ? [] : [{ id: `site-${row.id}-edit`, label: __('Edit'), href: `/dashboard/network/sites/${row.id}` }]),
            ...(row.status === 'active' || row.status === 'archived' ? [
                { id: `site-${row.id}-dashboard`, label: __('Dashboard'), href: row.dashboard },
                { id: `site-${row.id}-visit`, label: __('Visit'), href: row.home },
            ] : []),
            ...(row.id === MAIN_SITE ? [] : [
                ...(row.status === 'active' ? [{ id: `site-${row.id}-archive`, label: __('Archive'), run: () => this.act(row, 'archive') }] : []),
                ...(row.status === 'archived' || row.status === 'deleted' ? [{ id: `site-${row.id}-restore`, label: __('Restore'), run: () => this.act(row, 'restore') }] : []),
                ...(row.status === 'active' || row.status === 'archived' ? [{ id: `site-${row.id}-delete`, label: __('Delete'), danger: true, run: () => this.requestDelete(row) }] : []),
            ]),
        ]);
        return html`<div class="space-y-6">
            ${pageHeader(__('Sites'), {
                description: __('The main site is the network itself; every other site has its own database.'),
                titleActions: this.canAdd ? linkButton(__('Add site'), '/dashboard/network/sites/new', 'primary', { size: 'sm' }) : null,
            })}
            ${this.message && !this.error ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.canAdd ? null : notice(__('This network cannot add sites yet: give it a provider for site databases (see Settings → Network).'))}
            <div class="space-y-3">
                <nav aria-label=${__('Filter by status')} class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    ${this.counts.map((tab, index) => html`${index ? html`<span class="text-muted-foreground" aria-hidden="true">|</span>` : null}
                        <a href=${this.href({ status: tab.key })} class=${tab.key === this.status ? 'font-semibold text-foreground no-underline' : 'text-primary no-underline hover:underline'}
                            aria-current=${tab.key === this.status ? 'page' : 'false'}>${__(STATUS_LABELS[tab.key]!)} <span class="text-muted-foreground">(${tab.count})</span></a>`)}
                </nav>
                ${listFilters({ action: '/dashboard/network/sites', hidden: { status: this.status }, search: { name: 'q', value: this.search, placeholder: __('Search names and domains') } })}
            </div>
            ${listTable<SiteRow>({
                rows: this.rows, key: row => row.id, rowAttribute: 'data-site', empty: this.search || this.status ? __('No sites match.') : __('No sites besides the main one yet.'),
                columns: [
                    { label: __('Site'), cell: row => html`<div class="flex items-start gap-3">${siteIcon(row.icon)}<div class="min-w-0">
                        ${row.id === MAIN_SITE ? html`<span class="font-medium text-foreground">${row.name}</span> <span class="text-xs text-muted-foreground">(${__('main site')})</span>`
                            : html`<a href=${`/dashboard/network/sites/${row.id}`} class="font-medium text-foreground no-underline hover:text-primary">${row.name}</a>`}
                        <span class="block text-xs text-muted-foreground">${row.host}</span>
                        ${actions(row)}
                    </div></div>` },
                    { label: __('Members'), class: 'text-right text-muted-foreground', cell: row => row.members },
                    { label: __('Status'), cell: row => html`<div class="flex flex-wrap items-center gap-1">${siteStatus(row.status)}
                        ${row.exportRequested ? html`<a href=${`/dashboard/network/sites/${row.id}`} class="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 no-underline dark:text-amber-300">${__('Export requested')}</a>` : null}</div>` },
                    { label: __('Created'), class: 'text-muted-foreground', cell: row => row.createdAt === null ? '—' : shortDate(row.createdAt) },
                ],
            })}
            ${listFooter({ total: this.total, page: this.page, totalPages: this.pages, href: page => this.href({ page }) })}
            ${component(AlertDialog, {
                id: 'delete-site-dialog',
                open: this.pendingDelete !== null,
                title: __('Delete site?'),
                description: this.pendingDelete ? `${this.pendingDelete.name} ${__('stops answering at once. Its database and media are deleted for good after 30 days; until then it can be restored.')}` : '',
                cancelLabel: __('Cancel'),
                actionLabel: __('Delete'),
                actionVariant: 'destructive',
                onAction: () => this.confirmDelete(),
                onOpenChange: () => { this.pendingDelete = null; },
            })}
        </div>`;
    }
}
