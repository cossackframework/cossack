import { Cossack, Page, State, Server, Client } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Avatar, Button, Badge, Input, NativeSelect, Pagination, Icon, AlertDialog } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { PenNewRoundIcon as editIcon } from '@cossackframework/solar-icons/pen-new-round';
import { TrashBinMinimalisticIcon as deleteIcon } from '@cossackframework/solar-icons/trash-bin-minimalistic';
import { MagnifierIcon as searchIcon } from '@cossackframework/solar-icons/magnifier';
import { guard } from '../../../services/rbac';
import {
    listUsers,
    deleteUser,
    type UserSummary,
    type ListUsersResult,
} from '../../../services/users';
import { listRoles, type RoleDetail } from '../../../services/roles';

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

    @Server()
    async init() {
        // Drive initial state from the URL so search + role filter are
        // bookmarkable/shareable. The search form is a native GET; the "View
        // Users" button on the roles page links here as ?role=<role_name>.
        this.appliedSearch = this.c.req.query('search')?.trim() ?? '';
        this.appliedRoleName = this.c.req.query('role')?.trim() ?? '';
        const pageParam = Number(this.c.req.query('page'));
        this.page = pageParam >= 1 ? pageParam : 1;

        const roles = await listRoles();
        this.allRoles = roles;
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
    }

    /** Re-run the query (used after mutations). */
    @Server()
    private async refresh() {
        const result = await this.query();
        this.applyResult(result);
    }

    @Server()
    async remove(id: string) {
        if (id === this.user!.id) {
            this.error = __('You cannot delete your own account from here.');
            return;
        }
        try {
            await deleteUser(id);
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

    render() {
        const totalPages = Math.max(1, Math.ceil(this.total / PAGE_SIZE));
        const from = this.total === 0 ? 0 : (this.page - 1) * PAGE_SIZE + 1;
        const to = Math.min(this.total, this.page * PAGE_SIZE);
        const iconBtn = 'inline-flex items-center justify-center [&_svg]:size-4';
        const iconBtnClass = 'inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors border-none bg-transparent cursor-pointer';
        // The select's value mirrors the URL's role name.
        const selectedRoleName = this.appliedRoleName;

        return html`
            <div class="space-y-6">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <h1 class="text-2xl font-bold text-foreground">${__('Users')}</h1>
                        <p class="mt-1 text-sm text-muted-foreground">${__('Manage user accounts.')}</p>
                    </div>
                    <a href="/dashboard/users/new"
                       class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
                        ${__('New user')}
                    </a>
                </div>

                ${this.error ? html`<div class="text-sm text-destructive">${this.error}</div>` : null}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`
                        <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                            <h2 class="text-base font-semibold text-foreground">${__('All users')}</h2>
                            <!-- Native GET form: submit navigates to ?search=…&role=… (URL reflects state).
                                 The role <select> submits the form on change via a tiny inline script. -->
                            <form method="GET" action="/dashboard/users" class="flex flex-col sm:flex-row gap-2 sm:items-center" id="users-filter-form">
                                <div class="relative w-full sm:w-64">
                                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground ${iconBtn}">${component(Icon, { entry: searchIcon, size: 16 })}</span>
                                    ${component(Input, {
                                        type: 'search',
                                        name: 'search',
                                        placeholder: __('Search by name or email'),
                                        value: this.appliedSearch,
                                        size: 'sm',
                                        class: 'pl-8 w-full',
                                    })}
                                </div>
                                ${component(NativeSelect, {
                                    name: 'role',
                                    size: 'sm',
                                    'aria-label': __('Filter by role'),
                                    onchange: 'this.form.submit()',
                                }, html`
                                    <option value="" ?selected=${!selectedRoleName}>${__('All roles')}</option>
                                    ${this.allRoles.map((r) => html`<option value=${r.name} ?selected=${selectedRoleName === r.name}>${r.name}</option>`)}
                                `)}
                                ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Search'))}
                            </form>
                        </div>
                    `)}
                    ${component(CardBody, {}, html`
                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead>
                                    <tr class="text-left text-xs uppercase tracking-wide text-muted-foreground">
                                        <th class="py-2 pr-4 font-medium">${__('User')}</th>
                                        <th class="py-2 pr-4 font-medium">${__('Roles')}</th>
                                        <th class="py-2 pr-4 font-medium">${__('Created')}</th>
                                        <th class="py-2 text-right font-medium">${__('Actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${this.users.map((u) => html`
                                        <tr class="border-t border-border">
                                            <td class="py-3 pr-4">
                                                <a href="/dashboard/users/${u.id}" class="flex items-center gap-3 hover:underline">
                                                    ${component(Avatar, { src: u.avatar ?? undefined, alt: u.name, size: 32 })}
                                                    <span class="flex flex-col">
                                                        <span class="text-sm font-medium text-foreground">${u.name || '—'}</span>
                                                        <span class="text-xs text-muted-foreground">${u.email}</span>
                                                    </span>
                                                </a>
                                            </td>
                                            <td class="py-3 pr-4">
                                                <div class="flex flex-wrap gap-1">
                                                    ${u.roles.length === 0
                                                        ? html`<span class="text-xs text-muted-foreground">—</span>`
                                                        : u.roles.map((r) => component(Badge, { variant: 'outline' }, r.name))}
                                                </div>
                                            </td>
                                            <td class="py-3 pr-4 text-sm text-muted-foreground">${this.formatDate(u.createdAt)}</td>
                                            <td class="py-3">
                                                <div class="flex items-center justify-end gap-1">
                                                    <a href="/dashboard/users/${u.id}"
                                                       class="${iconBtnClass} text-muted-foreground hover:bg-muted hover:text-foreground"
                                                       title=${__('Edit user')}
                                                       aria-label=${__('Edit user')}>
                                                        <span class=${iconBtn}>${component(Icon, { entry: editIcon, size: 16 })}</span>
                                                    </a>
                                                    ${u.id !== this.user!.id
                                                        ? html`<button
                                                              type="button"
                                                              @click=${() => this.requestDelete(u)}
                                                              class="${iconBtnClass} text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                              title=${__('Delete user')}
                                                              aria-label=${__('Delete user')}>
                                                              <span class=${iconBtn}>${component(Icon, { entry: deleteIcon, size: 16 })}</span>
                                                          </button>`
                                                        : component(Badge, { variant: 'secondary' }, __('You'))}
                                                </div>
                                            </td>
                                        </tr>
                                    `)}
                                </tbody>
                            </table>
                            ${this.users.length === 0
                                ? html`<p class="py-6 text-center text-sm text-muted-foreground">${__('No users found.')}</p>`
                                : null}
                        </div>
                        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-border">
                            <p class="text-xs text-muted-foreground">
                                ${__('Showing')} ${from}–${to} ${__('of')} ${this.total}
                            </p>
                            ${totalPages > 1
                                ? component(Pagination, {
                                      page: this.page,
                                      totalPages,
                                      onPageChange: (p: number) => { window.location.href = this.pageHref(p); },
                                  })
                                : null}
                        </div>
                    `)}
                `)}

                ${component(AlertDialog, {
                    open: this.pendingDelete !== null,
                    title: __('Delete user?'),
                    description: this.pendingDelete
                        ? `${__('Are you sure you want to delete')} ${this.pendingDelete.name || this.pendingDelete.email}? ${__('This action cannot be undone.')}`
                        : '',
                    cancelLabel: __('Cancel'),
                    actionLabel: __('Delete'),
                    actionVariant: 'destructive',
                    onAction: () => this.confirmDelete(),
                    onClose: () => { this.pendingDelete = null; },
                })}
            </div>
        `;
    }
}
