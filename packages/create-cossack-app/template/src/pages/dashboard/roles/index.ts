import { Cossack, Page, State, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Button, Badge } from '@cossackframework/ui';
import { guard } from '../../../services/rbac';
import { listRoles, deleteRole, type RoleDetail } from '../../../services/roles';

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class RolesPage extends Cossack {
    @State() roles: RoleDetail[] = [];
    @State() error = '';

    @Server()
    async init() {
        this.roles = await listRoles();
    }

    @Server()
    async remove(id: string, name: string) {
        if (name === 'admin') {
            this.error = __('The admin role cannot be deleted.');
            return;
        }
        try {
            await deleteRole(id);
            this.roles = await listRoles();
        } catch (e: any) {
            this.error = e?.message || __('Could not delete role');
        }
    }

    render() {
        return html`
            <div class="space-y-8">
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
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('All roles')}</h2>`)}
                    ${component(CardBody, {}, html`
                        <table class="w-full">
                            <thead>
                                <tr class="text-left text-xs uppercase tracking-wide text-muted-foreground">
                                    <th class="py-2 pr-4 font-medium">${__('Role')}</th>
                                    <th class="py-2 pr-4 font-medium">${__('Permissions')}</th>
                                    <th class="py-2 text-right font-medium"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.roles.map((role) => html`
                                    <tr class="border-t border-border">
                                        <td class="py-3 pr-4">
                                            <a href="/dashboard/roles/${role.id}" class="text-sm font-medium text-foreground hover:underline">${role.name}</a>
                                        </td>
                                        <td class="py-3 pr-4">
                                            <div class="flex flex-wrap gap-1">
                                                ${role.permissions.length === 0
                                                    ? html`<span class="text-xs text-muted-foreground">${__('None')}</span>`
                                                    : role.permissions.map((p) => component(Badge, { variant: 'outline' }, p))}
                                            </div>
                                        </td>
                                        <td class="py-3 text-right space-x-2">
                                            <a href="/dashboard/roles/${role.id}"
                                               class="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                                                ${__('Edit')}
                                            </a>
                                            ${role.name !== 'admin'
                                                ? component(Button, {
                                                      variant: 'destructive',
                                                      size: 'sm',
                                                      '@click': () => this.remove(role.id, role.name),
                                                  }, __('Delete'))
                                                : null}
                                        </td>
                                    </tr>
                                `)}
                            </tbody>
                        </table>
                        ${this.roles.length === 0
                            ? html`<p class="py-6 text-center text-sm text-muted-foreground">${__('No roles yet.')}</p>`
                            : null}
                    `)}
                `)}
            </div>
        `;
    }
}
