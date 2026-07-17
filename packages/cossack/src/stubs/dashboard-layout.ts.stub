import { Cossack, Page, Server } from '@cossackframework/core';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { Sidebar, DropdownMenu, Avatar } from '@cossackframework/ui';
import { logout } from '../../auth';

/**
 * Dashboard layout: sidebar nav + user menu, shared by every /dashboard/* page.
 * The user menu in the sidebar footer links to Profile and performs logout
 * (which deletes the current session and redirects to the login page).
 */
@Page({ transport: 'http' })
export default class DashboardLayout extends Cossack {
    @Server()
    async doLogout() {
        const { headers } = await logout(this.c);
        headers.forEach((value, key) => this.c.header(key, value));
        this.redirect(config('auth.redirectAfterLogout'));
    }

    render(): TemplateResult {
        const user = this.user;
        const name = user?.name ?? user?.email ?? __('Account');
        const avatar = user?.avatar ?? undefined;
        const isAdmin = !!user?.roles?.some((r) => r.name === 'admin');

        const items = [
            { label: __('Dashboard'), href: '/dashboard' },
            { label: __('Profile'), href: '/dashboard/profile' },
            { label: __('Sessions'), href: '/dashboard/sessions' },
        ];
        // Admin-only sections (Users, Roles) — hidden from non-admins so they
        // don't see links they can't access (the pages are also gated via
        // guard.requireRole('admin')).
        if (isAdmin) {
            items.push({ label: __('Users'), href: '/dashboard/users' });
            items.push({ label: __('Roles'), href: '/dashboard/roles' });
        }

        return html`
            <div class="flex min-h-screen bg-background">
                ${component(Sidebar, {
                    title: __('My App'),
                    width: '248px',
                    collapsible: 'icon',
                    items,
                    footer: component(DropdownMenu, {
                        block: true,
                        side: 'right',
                        align: 'end',
                        trigger: html`
                            <span class="flex items-center gap-2.5 w-full px-1.5 py-1 rounded-md text-left group-[.is-collapsed]:justify-center">
                                ${component(Avatar, { src: avatar, alt: name, size: 32 })}
                                <span class="flex-1 min-w-0 group-[.is-collapsed]:hidden">
                                    <span class="block text-sm font-medium text-foreground truncate">${name}</span>
                                    <span class="block text-xs text-muted-foreground truncate">${user?.email ?? ''}</span>
                                </span>
                            </span>
                        `,
                    }, html`
                        <div class="px-3 py-2">
                            <div class="text-sm font-medium">${name}</div>
                            <div class="text-xs text-muted-foreground">${user?.email ?? ''}</div>
                        </div>
                        <div class="h-px bg-border my-1"></div>
                        <a href="/dashboard/profile" class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted text-foreground no-underline">${__('Profile')}</a>
                        <a href="/dashboard/sessions" class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted text-foreground no-underline">${__('Sessions')}</a>
                        <div class="h-px bg-border my-1"></div>
                        <button
                            @click=${() => this.doLogout()}
                            class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted cursor-pointer border-none bg-transparent text-left text-destructive">
                            ${__('Log out')}
                        </button>
                    `),
                })}
                <div class="flex-1 min-w-0 p-6 sm:p-8 overflow-x-hidden">
                    ${this.children}
                </div>
            </div>
        `;
    }
}
