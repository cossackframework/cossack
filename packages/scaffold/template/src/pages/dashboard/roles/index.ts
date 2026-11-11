import { Cossack, Page, State, Server, Client } from '@cossackframework/core';
import { AlertDialog } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { requireRoleManager } from '../../../services/rbac';
import { listFilters, listFooter, listTable, rowActions } from '../../../dashboard/list-table';
import { linkButton, notice, pageHeader } from '@cossackframework/ui/blocks';
import {
    listRoles,
    deleteRole,
    type RoleDetail,
    type ListRolesResult,
} from '../../../services/roles';

const PAGE_SIZE = 20;

@Page({ transport: 'http', middlewares: [requireRoleManager] })
export default class RolesPage extends Cossack {
    @State() roles: RoleDetail[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() appliedSearch = '';
    @State() error = '';
    @State() message = '';
    /** Role pending deletion confirmation (null = dialog closed). */
    @State() pendingDelete: RoleDetail | null = null;

    @Server()
    async init() {
        // Drive initial state from the URL so the search/page are bookmarkable
        // and shareable (the search form is a native GET, pagination is links).
        const search = this.c.req.query('search')?.trim() ?? '';
        const pageParam = Number(this.c.req.query('page'));
        this.appliedSearch = search;
        this.page = pageParam >= 1 ? pageParam : 1;
        this.applyResult(await this.query());
    }

    private async query(): Promise<ListRolesResult> {
        return listRoles({
            search: this.appliedSearch || undefined,
            page: this.page,
            pageSize: PAGE_SIZE,
        });
    }

    private applyResult(result: ListRolesResult) {
        this.roles = result.items;
        this.total = result.total;
    }

    @Server()
    async remove(id: string) {
        this.message = '';
        this.error = '';
        try {
            await deleteRole(id);
            this.message = __('Role deleted.');
            const result = await this.query();
            const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
            if (this.page > maxPage) {
                this.page = maxPage;
                this.applyResult(await this.query());
            } else {
                this.applyResult(result);
            }
        } catch (e: any) {
            this.error = e?.message || __('Could not delete role');
        }
    }

    /** Open the delete-confirmation dialog for a role (client-side). */
    @Client()
    requestDelete(r: RoleDetail) {
        if (r.name === 'admin') return;
        this.pendingDelete = r;
    }

    /** Confirm: actually delete the pending role, then close the dialog. */
    @Client()
    async confirmDelete() {
        const r = this.pendingDelete;
        this.pendingDelete = null;
        if (!r) return;
        await this.remove(r.id);
    }

    /** Query-string for pagination links — preserves the current search. */
    private pageHref(p: number): string {
        const params = new URLSearchParams();
        if (this.appliedSearch) params.set('search', this.appliedSearch);
        if (p > 1) params.set('page', String(p));
        const qs = params.toString();
        return qs ? `/dashboard/roles?${qs}` : '/dashboard/roles';
    }

    render() {
        const totalPages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        return html`
            <div class="space-y-6">
                ${pageHeader(__('Roles'), { description: __('Manage roles and their permissions.'), titleActions: linkButton(__('New role'), '/dashboard/roles/new', 'primary', { size: 'sm' }) })}
                ${this.message && !this.error ? notice(this.message, 'success') : null}
                ${this.error ? notice(this.error, 'error') : null}
                ${listFilters({ action: '/dashboard/roles', search: { name: 'search', value: this.appliedSearch, placeholder: __('Search roles') } })}
                ${listTable<RoleDetail>({
                    rows: this.roles, key: role => role.id, rowAttribute: 'data-role', empty: __('No roles found.'),
                    columns: [
                        { label: __('Role'), cell: role => html`<a href="/dashboard/roles/${role.id}" class="font-medium text-foreground no-underline hover:text-primary">${role.name}</a>
                            ${rowActions([
                                { id: `role-${role.id}-edit`, label: __('Edit'), href: `/dashboard/roles/${role.id}` },
                                { id: `role-${role.id}-users`, label: __('View users'), href: `/dashboard/users?role=${encodeURIComponent(role.name)}` },
                                ...(role.name !== 'admin' ? [{ id: `role-${role.id}-delete`, label: __('Delete'), danger: true, run: () => this.requestDelete(role) }] : []),
                            ])}` },
                        { label: __('Users'), class: 'text-muted-foreground', cell: role => html`<a href="/dashboard/users?role=${encodeURIComponent(role.name)}" class="text-muted-foreground no-underline hover:text-primary">${role.userCount ?? 0}</a>` },
                    ],
                })}
                ${listFooter({ total: this.total, page: this.page, totalPages, href: p => this.pageHref(p) })}

                ${component(AlertDialog, {
                    id: 'delete-role-dialog',
                    open: this.pendingDelete !== null,
                    title: __('Delete role?'),
                    description: this.pendingDelete
                        ? `${__('Are you sure you want to delete the')} "${this.pendingDelete.name}" ${__('role')}? ${__('Users assigned this role will lose its permissions. This action cannot be undone.')}`
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
