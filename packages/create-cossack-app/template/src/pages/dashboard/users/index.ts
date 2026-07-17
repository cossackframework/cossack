import { Cossack, Page, State, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Card, CardBody, CardHeader, Avatar, Button } from '@cossackframework/ui';
import { guard } from '../../../services/rbac';
import { listUsers, deleteUser, type UserSummary } from '../../../services/users';

@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class UsersPage extends Cossack {
    @State() users: UserSummary[] = [];
    @State() error = '';

    @Server()
    async init() {
        this.users = await listUsers();
    }

    @Server()
    async remove(id: string) {
        if (id === this.user!.id) {
            this.error = __('You cannot delete your own account from here.');
            return;
        }
        try {
            await deleteUser(id);
            this.users = await listUsers();
        } catch (e: any) {
            this.error = e?.message || __('Could not delete user');
        }
    }

    private formatDate(iso: string): string {
        try {
            return new Date(iso).toLocaleDateString();
        } catch {
            return iso;
        }
    }

    render() {
        return html`
            <div class="space-y-8">
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
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('All users')}</h2>`)}
                    ${component(CardBody, {}, html`
                        <table class="w-full">
                            <thead>
                                <tr class="text-left text-xs uppercase tracking-wide text-muted-foreground">
                                    <th class="py-2 pr-4 font-medium">${__('User')}</th>
                                    <th class="py-2 pr-4 font-medium">${__('Email')}</th>
                                    <th class="py-2 pr-4 font-medium">${__('Created')}</th>
                                    <th class="py-2 text-right font-medium"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.users.map((u) => html`
                                    <tr class="border-t border-border">
                                        <td class="py-3 pr-4">
                                            <a href="/dashboard/users/${u.id}" class="flex items-center gap-3 hover:underline">
                                                ${component(Avatar, { src: u.avatar ?? undefined, alt: u.name, size: 32 })}
                                                <span class="text-sm font-medium text-foreground">${u.name || '—'}</span>
                                            </a>
                                        </td>
                                        <td class="py-3 pr-4 text-sm text-muted-foreground">${u.email}</td>
                                        <td class="py-3 pr-4 text-sm text-muted-foreground">${this.formatDate(u.createdAt)}</td>
                                        <td class="py-3 text-right space-x-2">
                                            <a href="/dashboard/users/${u.id}"
                                               class="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                                                ${__('Edit')}
                                            </a>
                                            ${u.id !== this.user!.id
                                                ? component(Button, {
                                                      variant: 'destructive',
                                                      size: 'sm',
                                                      '@click': () => this.remove(u.id),
                                                  }, __('Delete'))
                                                : component(Button, { variant: 'outline', size: 'sm', '?disabled': true }, __('You'))}
                                        </td>
                                    </tr>
                                `)}
                            </tbody>
                        </table>
                        ${this.users.length === 0
                            ? html`<p class="py-6 text-center text-sm text-muted-foreground">${__('No users yet.')}</p>`
                            : null}
                    `)}
                `)}
            </div>
        `;
    }
}
