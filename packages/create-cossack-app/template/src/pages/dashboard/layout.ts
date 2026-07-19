import { Cossack, Page, Server, State, Client } from '@cossackframework/core';
import { Sidebar, DropdownMenu, Avatar, Icon, SidebarItem } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import { Widget2Icon as dashboardIcon } from '@cossackframework/solar-icons/widget-2';
import { UsersGroupRoundedIcon as usersIcon } from '@cossackframework/solar-icons/users-group-rounded';
import { ShieldKeyholeIcon as rolesIcon } from '@cossackframework/solar-icons/shield-keyhole';
import { SunIcon as sunIcon } from '@cossackframework/solar-icons/sun';
import { MoonIcon as moonIcon } from '@cossackframework/solar-icons/moon';
import { AltArrowRightIcon as chevronIcon } from '@cossackframework/solar-icons/alt-arrow-right';
import { UserCircleIcon as profileIcon } from '@cossackframework/solar-icons/user-circle';
import { MonitorSmartphoneIcon as sessionsIcon } from '@cossackframework/solar-icons/monitor-smartphone';
import { Logout3Icon as logoutIcon } from '@cossackframework/solar-icons/logout-3';
import { logout } from '../../auth';
import { themeStore } from '@/stores';

/**
 * Dashboard layout: sidebar nav + user menu + theme toggle, shared by every
 * /dashboard/* page. The user menu in the sidebar footer links to Profile and
 * performs logout (which deletes the current session and redirects to login).
 *
 * Theme state here mirrors the App component: both manipulate the same
 * `<html>.dark` class + localStorage key, so the toggle stays consistent
 * regardless of which one rendered it.
 */
@Page({ transport: 'http' })
export default class DashboardLayout extends Cossack {
    @State() theme: 'light' | 'dark' = 'dark';
    /** Sidebar collapsed state. Seeded from the cookie at SSR (via this.c) and
     *  re-read client-side in onMount; persists across client navigations. */
    @State() sidebarCollapsed = false;

    @State() items: any[] = [];

    @State() currentPath = '';

    @State() isAdmin = false;

    private _themeUnsub?: () => void;

    onCleanup() {
        this._themeUnsub?.();
    }

    onMount() {
        // Keep the toggle icon in sync with the global themeStore (so toggling
        // from any page updates this layout's icon too).
        this._themeUnsub = themeStore.subscribe((value) => {
            this.theme = value;
        });
    }

    @Client()
    toggleTheme() {
        const theme = themeStore.get() === 'dark' ? 'light' : 'dark';
        document.cookie = `cs-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
        themeStore.set(theme);
    }

    /** Flip the sidebar collapsed state and persist to a cookie so the next
     *  SSR render paints the correct state (no flash). The @State update drives
     *  the Sidebar re-render (controlled component). */
    @Client()
    onToggleSidebar() {
        this.sidebarCollapsed = !this.sidebarCollapsed;
        try {
            document.cookie = `cs-sidebar-collapsed=${this.sidebarCollapsed}; Path=/; Max-Age=31536000; SameSite=Lax`;
        } catch { /* document.cookie unavailable */ }
    }

    @Server()
    async doLogout() {
        const { headers } = await logout(this.c);
        headers.forEach((value, key) => this.c.header(key, value));
        this.redirect(config('auth.redirectAfterLogout'));
    }

    async init() {
        const user = this.user;
        this.isAdmin = !!user?.roles?.some((r) => r.name === 'admin');

        this.sidebarCollapsed = this.c
            ? getCookie(this.c, 'cs-sidebar-collapsed') === 'true'
            : this.sidebarCollapsed;

        // Seed theme from cookie at SSR so the toggle icon matches initial paint.
        this.theme = this.c
            ? (getCookie(this.c, 'cs-theme') === 'dark' ? 'dark' : 'light')
            : this.theme;
    }

    render(): TemplateResult {
        const iconBtn = (size = 16) => 'inline-flex items-center justify-center [&_svg]:size-4';
        // Top-level nav. Profile/Sessions live only in the user dropdown (not
        // duplicated here). `active` marks the current section so the sidebar
        // highlights where you are.
        const items: SidebarItem[] = [
            {
                label: __('Dashboard'),
                href: '/dashboard',
                icon: dashboardIcon,
                active: this.isActive('/dashboard'),
            },
        ];

        // Users & Roles are collapsible groups with a "New ..." submenu link,
        // so admins can jump straight to the create form.
        if (this.isAdmin) {
            items.push({
                label: __('Users'),
                icon: usersIcon,
                active: this.isActive('/dashboard/users'),
                children: [
                    { label: __('All users'), href: '/dashboard/users', active: this.isActive('/dashboard/users') },
                    { label: __('New user'), href: '/dashboard/users/new', active: this.isActive('/dashboard/users/new') },
                ],
            });
            items.push({
                label: __('Roles'),
                icon: rolesIcon,
                active: this.isActive('/dashboard/roles'),
                children: [
                    { label: __('All roles'), href: '/dashboard/roles', active: this.isActive('/dashboard/roles') },
                    { label: __('New role'), href: '/dashboard/roles/new', active: this.isActive('/dashboard/roles/new') },
                ],
            });
        }

        return html`
            <div class="flex min-h-screen bg-background">
                ${component(Sidebar, {
                    title: __('My App'),
                    brand: html`<a href="/dashboard" class="flex items-center gap-2 no-underline group-[.is-collapsed]:hidden" aria-label=${__('Dashboard')}>
                        <img src="/logo.svg" alt="" width="24" height="24" class="shrink-0" />
                        <span class="text-sm font-semibold text-foreground truncate">${__('My App')}</span>
                    </a>
                    <a href="/dashboard" class="hidden group-[.is-collapsed]:flex items-center justify-center" aria-label=${__('Dashboard')}>
                        <img src="/logo.svg" alt="" width="24" height="24" />
                    </a>`,
                    width: '248px',
                    collapsible: 'icon',
                    collapsed: this.sidebarCollapsed,
                    onToggle: () => this.onToggleSidebar(),
                    items: items,
                    footer: html`
                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                @click=${() => this.toggleTheme()}
                                class="flex-1 flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer border-none bg-transparent group-[.is-collapsed]:px-0"
                                title=${this.theme === 'dark' ? __('Switch to light mode') : __('Switch to dark mode')}
                                aria-label=${__('Toggle theme')}
                            >
                                <span class=${iconBtn()}>
                                    ${this.theme === 'dark'
                                        ? component(Icon, { entry: sunIcon, size: 16 })
                                        : component(Icon, { entry: moonIcon, size: 16 })}
                                </span>
                                <span class="group-[.is-collapsed]:hidden">${this.theme === 'dark' ? __('Light') : __('Dark')}</span>
                            </button>
                        </div>
                        <div class="h-px bg-border my-1 group-[.is-collapsed]:hidden"></div>
                        ${component(DropdownMenu, {
                            block: true,
                            side: 'right',
                            align: 'end',
                            trigger: html`
                                <span class="flex items-center gap-2.5 w-full px-1.5 py-1 rounded-md text-left group-[.is-collapsed]:justify-center">
                                    ${component(Avatar, { src: this.user?.avatar ?? '', alt: this.user?.name ?? '', size: 32 })}
                                    <span class="flex-1 min-w-0 group-[.is-collapsed]:hidden">
                                        <span class="block text-sm font-medium text-foreground truncate">${this.user?.name ?? ''}</span>
                                        <span class="block text-xs text-muted-foreground truncate">${this.user?.email ?? ''}</span>
                                    </span>
                                    <span class="text-muted-foreground group-[.is-collapsed]:hidden ${iconBtn()}">
                                        ${component(Icon, { entry: chevronIcon, size: 16 })}
                                    </span>
                                </span>
                            `,
                        }, html`
                            <div class="px-3 py-2">
                                <div class="text-sm font-medium">${this.user?.name ?? ''}</div>
                                <div class="text-xs text-muted-foreground">${this.user?.email ?? ''}</div>
                            </div>
                            <div class="h-px bg-border my-1"></div>
                            <a href="/dashboard/profile" class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted text-foreground no-underline">
                                <span class=${iconBtn()}>${component(Icon, { entry: profileIcon, size: 16 })}</span>
                                ${__('Profile')}
                            </a>
                            <a href="/dashboard/sessions" class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted text-foreground no-underline">
                                <span class=${iconBtn()}>${component(Icon, { entry: sessionsIcon, size: 16 })}</span>
                                ${__('Sessions')}
                            </a>
                            <div class="h-px bg-border my-1"></div>
                            <button
                                @click=${() => this.doLogout()}
                                class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted cursor-pointer border-none bg-transparent text-left text-destructive">
                                <span class=${iconBtn()}>${component(Icon, { entry: logoutIcon, size: 16 })}</span>
                                ${__('Log out')}
                            </button>
                        `)}
                    `,
                })}
                <div class="flex-1 min-w-0 flex flex-col overflow-x-hidden">
                    <main class="flex-1 p-6 sm:p-8 overflow-x-hidden">
                        ${this.children}
                    </main>
                    <footer class="border-t border-border px-6 sm:px-8 py-4 text-xs text-muted-foreground">
                        &copy; ${new Date().getFullYear()} ${__('My App')}. ${__('All rights reserved.')}
                    </footer>
                </div>
            </div>
        `;
    }
}
