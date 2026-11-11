import { Cossack, Page, State, Server, Client } from '@cossackframework/core';
import { Avatar, Badge, NativeSelect, AlertDialog } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { canAssignRoles, canGrantRoles, canManageUser, guard } from '../../../services/rbac';
import type { PublicUser } from '../../../auth';
import {
    getUser,
    listUsers,
    deleteUser,
    syncUserRoles,
    type UserSummary,
    type ListUsersResult,
} from '../../../services/users';
import { listRoles, type RoleDetail } from '../../../services/roles';
import { bulkBar, type BulkChoice } from '../../../dashboard/bulk';
import { timeAgo } from '../../../dashboard/time-ago';
import { listFilters, listFooter, listTable, rowActions } from '../../../dashboard/list-table';
import { linkButton, notice, pageHeader } from '@cossackframework/ui/blocks';

const PAGE_SIZE = 20;

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class UsersPage extends Cossack {
    @State() users: UserSummary[] = [];
    @State() allRoles: RoleDetail[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() error = '';
    /** Currently applied search (seeded from ?search= in the URL). */
    @State() appliedSearch = '';
    /** Currently applied role filter, as a role NAME (?role=name from the URL). */
    @State() appliedRoleName = '';
    /** Resolved role id matching appliedRoleName (looked up in init). */
    @State() roleId = '';
    /** User pending deletion confirmation (null = dialog closed). */
    @State() pendingDelete: UserSummary | null = null;
    /** Role managers set roles in bulk; others only delete accounts they may manage. */
    @State() canAssignRoles = false;
    /** Rows that can be selected: not your own account, and only accounts you may manage. */
    @State() selectable: string[] = [];
    @State() selected: string[] = [];
    @State() bulk = '';
    /** A bulk action waiting for confirmation. */
    @State() pendingBulk: BulkChoice | null = null;
    @State() message = '';
    /** When the page was rendered, for "Last signed in" as time ago. */
    @State() now = 0;

    @Server()
    async init() {
        this.now = Date.now();
        // Drive initial state from the URL so search + role filter are
        // bookmarkable/shareable. The search form is a native GET; the "View
        // Users" button on the roles page links here as ?role=<role_name>.
        this.appliedSearch = this.c.req.query('search')?.trim() ?? '';
        this.appliedRoleName = this.c.req.query('role')?.trim() ?? '';
        const pageParam = Number(this.c.req.query('page'));
        this.page = pageParam >= 1 ? pageParam : 1;

        const roles = await listRoles();
        this.allRoles = roles;
        this.canAssignRoles = canAssignRoles(this.user as PublicUser | undefined);
        // Resolve role name → id (the URL carries the human-readable name).
        if (this.appliedRoleName) {
            const match = roles.find((r) => r.name === this.appliedRoleName);
            this.roleId = match?.id ?? '';
        }

        const result = await this.query();
        this.applyResult(result);
    }

    /** Builds and runs the list query from the current filter/pagination state. */
    private async query(): Promise<ListUsersResult> {
        return listUsers({
            search: this.appliedSearch || undefined,
            roleId: this.roleId || undefined,
            page: this.page,
            pageSize: PAGE_SIZE,
        });
    }

    private applyResult(result: ListUsersResult) {
        this.users = result.items;
        this.total = result.total;
        const actor = this.user as PublicUser | undefined;
        this.selectable = result.items.filter(u => u.id !== actor?.id && canManageUser(actor, u)).map(u => u.id);
        this.selected = this.selected.filter(id => this.selectable.includes(id));
    }

    /** Delete, or (for role managers) `role:<id>` to give the selected users that role alone. */
    private bulkChoices(): BulkChoice[] {
        return [
            { key: 'delete', label: __('Delete'), confirm: __('The selected accounts and their sessions will be deleted. This cannot be undone.') },
            ...(this.canAssignRoles ? this.allRoles.map(role => ({ key: `role:${role.id}`, label: `${__('Change role to')} ${role.name}` })) : []),
        ];
    }

    @Client()
    async submitBulk() {
        const choice = this.bulkChoices().find(entry => entry.key === this.bulk);
        if (!choice || !this.selected.length) return;
        if (choice.confirm) { this.pendingBulk = choice; return; }
        await this.runBulk(choice.key);
    }

    @Client()
    async runBulk(key: string) {
        this.pendingBulk = null;
        await this.applyBulk(this.selected, key);
    }

    /**
     * Apply a bulk action account by account. Your own account and accounts you may not manage
     * are skipped, so an administrator always remains: the one acting.
     */
    @Server()
    async applyBulk(ids: string[], key: string) {
        this.error = '';
        this.message = '';
        const actor = this.user as PublicUser | undefined;
        const roleId = key.startsWith('role:') ? key.slice('role:'.length) : '';
        if (key !== 'delete' && !roleId) return;
        const granted = roleId ? (await listRoles()).find(role => role.id === roleId) : undefined;
        if (roleId && (!canAssignRoles(actor) || !granted)) { this.error = __('Only an administrator can change roles.'); return; }
        if (granted && !canGrantRoles(actor, [granted])) { this.error = __('You cannot give a role with permissions you do not have.'); return; }
        let done = 0, skipped = 0;
        for (const id of [...new Set(ids)].slice(0, 100)) {
            const target = await getUser(id);
            if (!target || id === actor?.id || !canManageUser(actor, target)) { skipped++; continue; }
            if (roleId) await syncUserRoles(id, [roleId]); else await deleteUser(id);
            done++;
        }
        this.selected = [];
        this.bulk = '';
        const result = await this.query();
        const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        if (this.page > maxPage) { this.page = maxPage; this.applyResult(await this.query()); } else this.applyResult(result);
        this.message = `${done} ${done === 1 ? __('user updated.') : __('users updated.')}${skipped ? ` ${skipped} ${__('skipped.')}` : ''}`;
        if (!done && skipped) this.error = __('None of the selected accounts can be changed by you.');
    }

    /** Re-run the query (used after mutations). */
    @Server()
    private async refresh() {
        const result = await this.query();
        this.applyResult(result);
    }

    @Server()
    async remove(id: string) {
        this.message = '';
        this.error = '';
        if (id === this.user!.id) {
            this.error = __('You cannot delete your own account from here.');
            return;
        }
        try {
            const target = await getUser(id);
            if (target && !canManageUser(this.user as PublicUser | undefined, target)) {
                this.error = __('Only an administrator can delete this account.');
                return;
            }
            await deleteUser(id);
            this.message = __('User deleted.');
            const result = await this.query();
            const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
            if (this.page > maxPage) {
                this.page = maxPage;
                this.applyResult(await this.query());
            } else {
                this.applyResult(result);
            }
        } catch (e: any) {
            this.error = e?.message || __('Could not delete user');
        }
    }

    /** Open the delete-confirmation dialog for a user (client-side). */
    @Client()
    requestDelete(u: UserSummary) {
        if (u.id === this.user!.id) return;
        this.pendingDelete = u;
    }

    /** Confirm: actually delete the pending user, then close the dialog. */
    @Client()
    async confirmDelete() {
        const u = this.pendingDelete;
        this.pendingDelete = null;
        if (!u) return;
        await this.remove(u.id);
    }

    /** Query-string for pagination links — preserves the current search + role. */
    private pageHref(p: number): string {
        const params = new URLSearchParams();
        if (this.appliedSearch) params.set('search', this.appliedSearch);
        if (this.appliedRoleName) params.set('role', this.appliedRoleName);
        if (p > 1) params.set('page', String(p));
        const qs = params.toString();
        return qs ? `/dashboard/users?${qs}` : '/dashboard/users';
    }

    private formatDate(iso: string): string {
        try {
            return new Date(iso).toLocaleDateString();
        } catch {
            return iso;
        }
    }

    private formatDateTime(iso: string): string {
        try {
            return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        } catch {
            return iso;
        }
    }

    render() {
        const totalPages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        const bulk = (id: string) => bulkBar({ id, choices: this.bulkChoices(), value: this.bulk, count: this.selected.length,
            choose: key => { this.bulk = key; }, apply: () => this.submitBulk() });
        return html`
            <div class="space-y-6">
                ${pageHeader(__('Users'), { description: __('Manage user accounts.'), titleActions: linkButton(__('New user'), '/dashboard/users/new', 'primary', { size: 'sm' }) })}
                ${this.message && !this.error ? notice(this.message, 'success') : null}
                ${this.error ? notice(this.error, 'error') : null}
                <div class="space-y-3">
                    ${listFilters({ action: '/dashboard/users', id: 'users-filter-form', search: { name: 'search', value: this.appliedSearch, placeholder: __('Search by name or email') },
                        filters: html`<div class="w-44">${component(NativeSelect, { name: 'role', size: 'sm', 'aria-label': __('Filter by role'),
                            '@change': (event: Event) => (event.currentTarget as HTMLSelectElement).form?.requestSubmit() }, html`
                            <option value="" ?selected=${!this.appliedRoleName}>${__('All roles')}</option>
                            ${this.allRoles.map((r) => html`<option value=${r.name} ?selected=${this.appliedRoleName === r.name}>${r.name}</option>`)}`)}</div>` })}
                    ${this.selectable.length ? bulk('users-bulk') : null}
                </div>
                ${listTable<UserSummary>({
                    rows: this.users, key: u => u.id, rowAttribute: 'data-user', empty: __('No users found.'),
                    ...(this.selectable.length ? { selection: { selected: this.selected, selectable: this.selectable, label: u => u.name || u.email, change: ids => { this.selected = ids; } } } : {}),
                    columns: [
                        { label: __('User'), cell: u => html`<div class="flex items-start gap-3">
                            ${component(Avatar, { src: u.avatar ?? undefined, alt: u.name, size: 32 })}
                            <div class="min-w-0">
                                <a href="/dashboard/users/${u.id}" class="font-medium text-foreground no-underline hover:text-primary">${u.name || '—'}</a>
                                ${u.id === this.user!.id ? html` ${component(Badge, { variant: 'secondary' }, __('You'))}` : null}
                                ${u.badge ? html` ${component(Badge, { variant: 'outline' }, u.badge)}` : null}
                                <span class="block text-xs text-muted-foreground">${u.email}</span>
                                ${rowActions([
                                    { id: `user-${u.id}-edit`, label: __('Edit'), href: `/dashboard/users/${u.id}` },
                                    ...(u.id !== this.user!.id && this.selectable.includes(u.id) ? [{ id: `user-${u.id}-delete`, label: __('Delete'), danger: true, run: () => this.requestDelete(u) }] : []),
                                ])}
                            </div>
                        </div>` },
                        { label: __('Roles'), cell: u => html`<div class="flex flex-wrap gap-1">${u.roles.length === 0
                            ? html`<span class="text-xs text-muted-foreground">—</span>` : u.roles.map((r) => component(Badge, { variant: 'outline' }, r.name))}</div>` },
                        { label: __('Last signed in'), class: 'text-muted-foreground', cell: u => u.lastSignedInAt
                            ? html`<time datetime=${u.lastSignedInAt} title=${this.formatDateTime(u.lastSignedInAt)}>${timeAgo(u.lastSignedInAt, this.now)}</time>` : __('Never') },
                        { label: __('Created'), class: 'text-muted-foreground', cell: u => this.formatDate(u.createdAt) },
                    ],
                })}
                ${this.users.length && this.selectable.length ? bulk('users-bulk-bottom') : null}
                ${listFooter({ total: this.total, page: this.page, totalPages, href: p => this.pageHref(p) })}

                ${component(AlertDialog, {
                    id: 'bulk-users-dialog',
                    open: this.pendingBulk !== null,
                    // Closed dialogs still need their labels.
                    title: this.pendingBulk ? `${this.pendingBulk.label} ${this.selected.length} ${this.selected.length === 1 ? __('user') : __('users')}?` : __('Apply'),
                    description: this.pendingBulk?.confirm ?? '',
                    cancelLabel: __('Cancel'),
                    actionLabel: this.pendingBulk?.label || __('Apply'),
                    actionVariant: this.pendingBulk?.key === 'delete' ? 'destructive' : 'primary',
                    onAction: () => { if (this.pendingBulk) void this.runBulk(this.pendingBulk.key); },
                    onOpenChange: () => { this.pendingBulk = null; },
                })}

                ${component(AlertDialog, {
                    id: 'delete-user-dialog',
                    open: this.pendingDelete !== null,
                    title: __('Delete user?'),
                    description: this.pendingDelete
                        ? `${__('Are you sure you want to delete')} ${this.pendingDelete.name || this.pendingDelete.email}? ${__('This action cannot be undone.')}`
                        : '',
                    cancelLabel: __('Cancel'),
                    actionLabel: __('Delete'),
                    actionVariant: 'destructive',
                    onAction: () => this.confirmDelete(),
                    onOpenChange: () => { this.pendingDelete = null; },
                })}
            </div>
        `;
    }
}
