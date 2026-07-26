import { Cossack, Page, Server, State, Client, Image, server$ } from '@cossackframework/core';
import { Sidebar, DropdownMenu, Avatar, Icon, type SidebarItem } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import { Widget2Icon as dashboardIconSvg } from '@cossackframework/solar-icons/widget-2/line';
import { SunIcon as sunIconSvg } from '@cossackframework/solar-icons/sun/line';
import { MoonIcon as moonIconSvg } from '@cossackframework/solar-icons/moon/line';
import { AltArrowRightIcon as chevronIconSvg } from '@cossackframework/solar-icons/alt-arrow-right/line';
import { Logout3Icon as logoutIconSvg } from '@cossackframework/solar-icons/logout-3/line';
import { dashboardModules } from '../../dashboard/registry';
import { logout } from '../../auth';
import { themeStore } from '@/stores.client';

const dashboardIcon = { line: dashboardIconSvg };
const sunIcon = { line: sunIconSvg };
const moonIcon = { line: moonIconSvg };
const chevronIcon = { line: chevronIconSvg };
const logoutIcon = { line: logoutIconSvg };

/**
 * Dashboard layout: sidebar nav + user menu + theme toggle, shared by every
 * /dashboard/* page. Installed dashboard modules describe their own icons,
 * destinations, submenu links, and whether they belong in navigation or the
 * account menu.
 *
 * Theme state here mirrors the App component: both manipulate the same
 * `<html>.dark` class + cookie, so the toggle stays consistent
 * regardless of which one rendered it.
 */
@Page({ transport: 'http' })
export default class DashboardLayout extends Cossack {
    appName = server$(() => config('app.name'), { initial: 'My App' });
    @State() theme: 'light' | 'dark' = 'dark';
    /** Sidebar collapsed state. Seeded from the cookie at SSR (via this.c) and
     *  re-read client-side in onMount; persists across client navigations. */
    @State() sidebarCollapsed = false;
    @State() isAdmin = false;
    @State() account: { name: string; email: string; avatar: string | null } = {
        name: '',
        email: '',
        avatar: null,
    };

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
        this.account = {
            name: user?.name ?? '',
            email: user?.email ?? '',
            avatar: user?.avatar ?? null,
        };

        this.sidebarCollapsed = this.c
            ? getCookie(this.c, 'cs-sidebar-collapsed') === 'true'
            : this.sidebarCollapsed;

        // A valid cookie lets SSR render the matching toggle icon. With no
        // cookie, root.ts resolves the system preference before first paint
        // and the themeStore subscription synchronizes this state on mount.
        const savedTheme = this.c ? getCookie(this.c, 'cs-theme') : undefined;
        if (savedTheme === 'light' || savedTheme === 'dark') {
            this.theme = savedTheme;
        }
    }

    render(): TemplateResult {
        const iconClass = 'inline-flex items-center justify-center [&_svg]:size-4';
        const availableModules = dashboardModules.filter((module) =>
            module.authorization !== 'admin' || this.isAdmin,
        );
        const navigationModules = availableModules.filter(
            (module) => module.placement !== 'account',
        );
        const accountModules = availableModules.filter(
            (module) => module.placement === 'account',
        );
        const items: SidebarItem[] = [
            {
                label: __('Dashboard'),
                href: '/dashboard',
                icon: dashboardIcon,
                active: this.isActive('/dashboard'),
            },
            ...navigationModules.map((module) => ({
                label: __(module.label),
                href: module.href,
                icon: module.icon,
                active: this.isActive(module.href, false),
                children: module.children?.map((child) => ({
                    label: __(child.label),
                    href: child.href,
                    active: this.isActive(child.href),
                })),
            })),
        ];

        return html`
            <div class="flex min-h-screen bg-background">
                ${component(Sidebar, {
                    title: this.appName,
                    brand: html`<a href="/dashboard" class="flex items-center gap-2 no-underline group-[.is-collapsed]:hidden" aria-label=${__('Dashboard')}>
                        ${Image({ src: '/logo.svg', alt: '', width: 24, height: 24, loading: 'eager', class: 'size-6 shrink-0' })}
                        <span class="text-sm font-semibold text-foreground truncate">${this.appName}</span>
                    </a>
                    <a href="/dashboard" class="hidden group-[.is-collapsed]:flex items-center justify-center" aria-label=${__('Dashboard')}>
                        ${Image({ src: '/logo.svg', alt: '', width: 24, height: 24, loading: 'eager', class: 'size-6' })}
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
                                <span class=${iconClass}>
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
                                    ${component(Avatar, { src: this.account.avatar ?? '', alt: this.account.name, size: 32 })}
                                    <span class="flex-1 min-w-0 group-[.is-collapsed]:hidden">
                                        <span class="block text-sm font-medium text-foreground truncate">${this.account.name}</span>
                                        <span class="block text-xs text-muted-foreground truncate">${this.account.email}</span>
                                    </span>
                                    <span class="text-muted-foreground group-[.is-collapsed]:hidden ${iconClass}">
                                        ${component(Icon, { entry: chevronIcon, size: 16 })}
                                    </span>
                                </span>
                            `,
                        }, html`
                            <div class="px-3 py-2">
                                <div class="text-sm font-medium">${this.account.name}</div>
                                <div class="text-xs text-muted-foreground">${this.account.email}</div>
                            </div>
                            ${accountModules.length ? html`<div class="h-px bg-border my-1"></div>` : null}
                            ${accountModules.map((module) => html`
                                <a href=${module.href} class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted text-foreground no-underline">
                                    <span class=${iconClass}>${component(Icon, { entry: module.icon, size: 16 })}</span>
                                    ${__(module.label)}
                                </a>
                            `)}
                            <div class="h-px bg-border my-1"></div>
                            <button
                                type="button"
                                @click=${() => this.doLogout()}
                                class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted cursor-pointer border-none bg-transparent text-left text-destructive">
                                <span class=${iconClass}>${component(Icon, { entry: logoutIcon, size: 16 })}</span>
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
                        &copy; ${new Date().getFullYear()} ${this.appName}. ${__('All rights reserved.')}
                    </footer>
                </div>
            </div>
        `;
    }
}
