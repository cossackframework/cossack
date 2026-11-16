import { Cossack, Page, Server, State, Client, server$, type HeadValue } from '@cossackframework/core';
import type { SidebarItem } from '@cossackframework/ui';
import { DashboardShell, type CommandItem } from '@cossackframework/ui/blocks';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import { dashboardFind, dashboardNotices, dashboardSearch, dashboardStatus, navigation } from '#app/dashboard/access';
import { shellIcons } from '#app/dashboard/icons';
import { dashboardHead } from '#app/dashboard/head';
import { siteHasLogo, siteLogo, siteName } from '#app/brand';
import type { DashboardModule, DashboardNotice, DashboardStatus } from '#app/dashboard/types';
import { logout } from '#app/auth';
import { requireDashboardUser } from '#app/middlewares/auth';
import { themeStore } from '@/stores.client';

/**
 * Dashboard layout, shared by every /dashboard/* page: it decides what the signed-in user sees
 * and renders it in `DashboardShell` from `@cossackframework/ui/blocks` (sidebar, account menu,
 * theme toggle, palette, notices, taskbar). src/dashboard/access.ts decides which modules the
 * user sees; each describes its icon, destination, submenu links, and whether it belongs in
 * navigation or the account menu.
 *
 * The theme toggle writes the same `cs-theme` cookie and themeStore the App
 * component applies to `<html>.dark`, and draws itself from that class.
 *
 * The taskbar along the bottom (desktop and tablet) opens the site, shows what
 * waits for the user (`dashboardStatus` in src/dashboard/access.ts, a `server$`
 * resource so it is fresh on every navigation) and holds the Screen options and
 * Help buttons, which open the `#screen-options` and `#screen-help` popovers a
 * screen renders with `screenOptions()` and `screenHelp()` from src/dashboard/page.ts.
 */
@Page({ transport: 'http', middlewares: [requireDashboardUser] })
export default class DashboardLayout extends Cossack {
    appName = server$(() => siteName(), { initial: 'Cossack' });
    appLogo = server$(() => siteLogo(), { initial: '/logo.svg' });
    /** The site set its own logo: it shows without the name beside it. */
    appLogoOnly = server$(() => siteHasLogo(), { initial: false });
    /** What waits for the user, with counts, for the taskbar. */
    statuses: DashboardStatus[] = server$(() => dashboardStatus(this.c), { initial: [] });
    /** Messages above every screen, such as the ones CMS plugins return; fresh on every navigation, like the statuses. */
    notices: DashboardNotice[] = server$(() => dashboardNotices(this.c), { initial: [] });
    /** Sidebar collapsed state. Seeded from the cookie at SSR (via this.c) and
     *  re-read client-side in onMount; persists across client navigations. */
    @State() sidebarCollapsed = false;
    /** Navigation the signed-in user may open, resolved on the server. */
    @State() modules: DashboardModule[] = [];
    /** Where Ctrl/Cmd+K can go: every screen of the navigation, resolved with it. */
    @State() commands: { id: string; label: string; group: string; href: string }[] = [];
    /** What the palette found for its text besides the screens (`dashboardFind`): the CMS's entries. */
    @State() found: { id: string; label: string; group: string; href: string }[] = [];
    /** The palette's text the next find is for; one find runs at a time, so an older answer never replaces a newer one. */
    private wanted = '';
    private finding = false;
    private findTimer: ReturnType<typeof setTimeout> | undefined;
    @State() logoutError = '';
    @State() account: { name: string; email: string; avatar: string | null } = {
        name: '',
        email: '',
        avatar: null,
    };

    @Client()
    toggleTheme() {
        // The opposite of what shows. Back to the system's scheme forgets the choice, so the
        // page follows the system again; a choice that differs from it is kept until undone.
        const theme = themeStore.get() === 'dark' ? 'light' : 'dark';
        const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.cookie = theme === system ? 'cs-theme=; Path=/; Max-Age=0; SameSite=Lax' : `cs-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
        themeStore.set(theme);
    }

    /** Flip the sidebar collapsed state and persist to a cookie so the next
     *  SSR render paints the correct state (no flash). The @State update drives
     *  the Sidebar re-render (controlled component). */
    /** Open the screen or entry a palette entry names; the palette's ids are the hrefs. */
    @Client()
    go(id: string) {
        const found = [...this.commands, ...this.found].find((entry) => entry.id === id);
        if (found) window.location.assign(found.href);
    }

    /** The palette's text changed: find for it a moment after the typing stops, from two characters. */
    @Client()
    onPaletteSearch(text: string) {
        this.wanted = text.trim();
        clearTimeout(this.findTimer);
        if (this.wanted.length < 2) {
            if (this.found.length) this.found = [];
            return;
        }
        this.findTimer = setTimeout(() => void this.findWanted(), 150);
    }

    /** Find for the text wanted, again while it changed during a find. */
    @Client()
    async findWanted() {
        if (this.finding) return;
        this.finding = true;
        try {
            let text: string;
            do {
                text = this.wanted;
                if (text.length >= 2) await this.find(text);
            } while (text !== this.wanted);
            if (this.wanted.length < 2 && this.found.length) this.found = [];
        } catch {
            /* the screens still show; the next text finds again */
        } finally {
            this.finding = false;
        }
    }

    @Server()
    async find(text: string) {
        const seen = new Set(this.commands.map((entry) => entry.id));
        this.found = typeof text === 'string' ? (await dashboardFind(this.c, text.slice(0, 200))).filter((entry) => !seen.has(entry.id)) : [];
    }

    @Client()
    onToggleSidebar() {
        this.sidebarCollapsed = !this.sidebarCollapsed;
        try {
            document.cookie = `cs-sidebar-collapsed=${this.sidebarCollapsed}; Path=/; Max-Age=31536000; SameSite=Lax`;
        } catch { /* document.cookie unavailable */ }
    }

    @Server()
    async doLogout() {
        this.logoutError = '';
        try {
            const { headers } = await logout(this.c);
            headers.forEach((value, key) => this.c.header(key, value));
            this.redirect(config('auth.redirectAfterLogout'));
        } catch {
            this.logoutError = 'Could not sign out. Try again.';
        }
    }

    async init() {
        const user = this.user;
        if (this.c) {
            this.modules = await navigation(this.c);
            this.commands = await dashboardSearch(this.c);
        }
        this.account = {
            name: user?.name ?? '',
            email: user?.email ?? '',
            avatar: user?.avatar ?? null,
        };

        this.sidebarCollapsed = this.c
            ? getCookie(this.c, 'cs-sidebar-collapsed') === 'true'
            : this.sidebarCollapsed;
    }

    head(): HeadValue {
        return { meta: dashboardHead() };
    }

    render(): TemplateResult {
        const icons = shellIcons();
        const availableModules = this.modules;
        // A module with a parent the user also sees is listed inside the parent's menu.
        const nested = (module: DashboardModule) => !!module.parent && availableModules.some((other) => other.id === module.parent);
        const navigationModules = availableModules.filter(
            (module) => module.placement !== 'account' && !nested(module),
        );
        const accountModules = availableModules.filter(
            (module) => module.placement === 'account',
        );
        const items: SidebarItem[] = [
            {
                value: 'dashboard',
                label: __('Dashboard'),
                href: '/dashboard',
                icon: icons.home,
                active: this.isActive('/dashboard'),
            },
            ...navigationModules.map((module): SidebarItem => {
                const item = {
                    value: `module:${module.id}`,
                    label: __(module.label), href: module.href, icon: module.icon,
                    active: module.activeFor ? this.isActive(module.activeFor, false) : this.isActive(module.href),
                };
                const children = [
                    ...(module.children ?? []),
                    ...availableModules.filter((other) => other.parent === module.id && nested(other))
                        .flatMap((other) => other.children?.length ? other.children : [{ label: other.label, href: other.href }]),
                ];
                if (!children.length) return item;
                // A group lists its own page as a link too; leave it out when a child already opens it.
                const { href: _href, active: _active, ...group } = item;
                return {
                    ...(children.some((child) => child.href === module.href) ? group : item),
                    children: children.map((child) => ({
                        value: `module:${module.id}:${child.href}`,
                        label: __(child.label), href: child.href,
                        active: this.isActive(child.href),
                    })),
                };
            }),
        ];

        return html`${component(DashboardShell, {
            brand: { name: this.appName, logo: this.appLogo, logoOnly: this.appLogoOnly },
            account: this.account,
            navigation: items,
            accountLinks: accountModules.map((module) => ({ label: __(module.label), href: module.href, icon: module.icon })),
            collapsed: this.sidebarCollapsed,
            onCollapsedChange: () => this.onToggleSidebar(),
            onLogout: () => this.doLogout(),
            onThemeToggle: () => this.toggleTheme(),
            commands: [...this.commands.map((entry): CommandItem => ({ id: entry.id, label: entry.label, group: entry.group })),
                ...this.found.map((entry): CommandItem => ({ id: entry.id, label: entry.label, group: entry.group, matched: true }))],
            onCommand: (id: string) => this.go(id),
            onCommandSearch: (text: string) => this.onPaletteSearch(text),
            notices: this.notices,
            statuses: this.statuses.map((item) => ({ ...item, label: __(item.label) })),
            error: this.logoutError,
            icons: { light: icons.light, dark: icons.dark, expand: icons.expand, logout: icons.logout },
            labels: {
                navigation: __('Dashboard navigation'), expand: __('Expand navigation'), collapse: __('Collapse navigation'), viewSite: __('View site'),
                toggleTheme: __('Switch between light and dark mode'), lightMode: __('Light mode'), darkMode: __('Dark mode'), logOut: __('Log out'),
                palette: __('Go to'), palettePlaceholder: __('Type a screen name or search…'), taskbar: __('Dashboard taskbar'), screenOptions: __('Screen options'), help: __('Help'),
            },
        }, this.children)}`;
    }
}
