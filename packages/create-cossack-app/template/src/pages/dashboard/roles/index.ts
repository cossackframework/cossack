import { Cossack, Page, State, Server, Client } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Button, Badge, Input, Icon, Pagination, AlertDialog } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { PenNewRoundIcon as editIcon } from '@cossackframework/solar-icons/pen-new-round';
import { TrashBinMinimalisticIcon as deleteIcon } from '@cossackframework/solar-icons/trash-bin-minimalistic';
import { UsersGroupRoundedIcon as usersIcon } from '@cossackframework/solar-icons/users-group-rounded';
import { MagnifierIcon as searchIcon } from '@cossackframework/solar-icons/magnifier';
import { guard } from '../../../services/rbac';
import {
    listRoles,
    deleteRole,
    type RoleDetail,
    type ListRolesResult,
} from '../../../services/roles';

const PAGE_SIZE = 20;

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class RolesPage extends Cossack {
    @State() roles: RoleDetail[] = [];
    @State() total = 0;
    @State() page = 1;
    @State() appliedSearch = '';
    @State() error = '';
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
    async remove(id: string, name: string) {
        if (name === 'admin') {
            this.error = __('The admin role cannot be deleted.');
            return;
        }
        try {
            await deleteRole(id);
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
        await this.remove(r.id, r.name);
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
        const from = this.total === 0 ? 0 : (this.page - 1) * PAGE_SIZE + 1;
        const to = Math.min(this.total, this.page * PAGE_SIZE);
        const iconBtn = 'inline-flex items-center justify-center [&_svg]:size-4';
        const iconBtnClass = 'inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors border-none bg-transparent cursor-pointer';

        return html`
            <div class="space-y-6">
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <h1 class="text-2xl font-bold text-foreground">${__('Roles')}</h1>
                        <p class="mt-1 text-sm text-muted-foreground">${__('Manage roles and their permissions.')}</p>
                    </div>
                    <a href="/dashboard/roles/new"
                       class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
                        ${__('New role')}
                    </a>
                </div>

                ${this.error ? html`<div class="text-sm text-destructive">${this.error}</div>` : null}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`
                        <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                            <h2 class="text-base font-semibold text-foreground">${__('All roles')}</h2>
                            <!-- Native GET form: submit navigates to ?search=… (URL reflects state). -->
                            <form method="GET" action="/dashboard/roles" class="flex items-center gap-2">
                                <div class="relative">
                                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground ${iconBtn}">${component(Icon, { entry: searchIcon, size: 16 })}</span>
                                    ${component(Input, {
                                        type: 'search',
                                        name: 'search',
                                        placeholder: __('Search roles'),
                                        value: this.appliedSearch,
                                        size: 'sm',
                                        class: 'pl-8',
                                    })}
                                </div>
                                ${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Search'))}
                            </form>
                        </div>
                    `)}
                    ${component(CardBody, {}, html`
                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead>
                                    <tr class="text-left text-xs uppercase tracking-wide text-muted-foreground">
                                        <th class="py-2 pr-4 font-medium">${__('Role')}</th>
                                        <th class="py-2 pr-4 font-medium">${__('Users')}</th>
                                        <th class="py-2 text-right font-medium">${__('Actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${this.roles.map((role) => html`
                                        <tr class="border-t border-border">
                                            <td class="py-3 pr-4">
                                                <a href="/dashboard/roles/${role.id}" class="text-sm font-medium text-foreground hover:underline">${role.name}</a>
                                            </td>
                                            <td class="py-3 pr-4 text-sm text-muted-foreground">${role.userCount ?? 0}</td>
                                            <td class="py-3">
                                                <div class="flex items-center justify-end gap-1">
                                                    <a href="/dashboard/users?role=${role.name}"
                                                       class="${iconBtnClass} text-muted-foreground hover:bg-muted hover:text-foreground"
                       title=${__('View users with this role')}
                       aria-label=${__('View users with this role')}>
                                                        <span class=${iconBtn}>${component(Icon, { entry: usersIcon, size: 16 })}</span>
                                                    </a>
                                                    <a href="/dashboard/roles/${role.id}"
                                                       class="${iconBtnClass} text-muted-foreground hover:bg-muted hover:text-foreground"
                       title=${__('Edit role')}
                       aria-label=${__('Edit role')}>
                                                        <span class=${iconBtn}>${component(Icon, { entry: editIcon, size: 16 })}</span>
                                                    </a>
                                                    ${role.name !== 'admin'
                                                        ? html`<button
                                                              type="button"
                                                              @click=${() => this.requestDelete(role)}
                                                              class="${iconBtnClass} text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                              title=${__('Delete role')}
                                                              aria-label=${__('Delete role')}>
                                                              <span class=${iconBtn}>${component(Icon, { entry: deleteIcon, size: 16 })}</span>
                                                          </button>`
                                                        : null}
                                                </div>
                                            </td>
                                        </tr>
                                    `)}
                                </tbody>
                            </table>
                            ${this.roles.length === 0
                                ? html`<p class="py-6 text-center text-sm text-muted-foreground">${__('No roles found.')}</p>`
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
                    title: __('Delete role?'),
                    description: this.pendingDelete
                        ? `${__('Are you sure you want to delete the')} "${this.pendingDelete.name}" ${__('role')}? ${__('Users assigned this role will lose its permissions. This action cannot be undone.')}`
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
