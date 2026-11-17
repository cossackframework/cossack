/**
 * The frame of a dashboard: the sidebar with the brand and the navigation, the account menu,
 * the light and dark toggle, the Ctrl/Meta+K palette, the notices above every screen and the
 * taskbar. The application decides who the user is and what they may open, and passes it in:
 * the shell reads no store, no session and no database.
 *
 *   <${DashboardShell} brand=${{ name: 'Acme', logo: '/logo.svg' }} account=${account}
 *       navigation=${items} accountLinks=${links} collapsed=${this.collapsed}
 *       onCollapsedChange=${(next: boolean) => this.setCollapsed(next)} onLogout=${() => this.logout()}>
 *       ${this.children}
 *   </${DashboardShell}>
 *
 * A screen with navigation of its own marks its root `data-subnav`: the main area then drops
 * its padding. The taskbar's Screen options and Help buttons open the `#screen-options` and
 * `#screen-help` popovers a screen renders, and show only on screens that have them.
 */
import { Component, Cossack, Image } from '@cossackframework/core';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import { SunIcon } from '@cossackframework/solar-icons/sun/line';
import { MoonIcon } from '@cossackframework/solar-icons/moon/line';
import { AltArrowRightIcon } from '@cossackframework/solar-icons/alt-arrow-right/line';
import { Logout3Icon } from '@cossackframework/solar-icons/logout-3/line';
import { Avatar } from '../../components/Avatar.js';
import { DropdownMenu } from '../../components/DropdownMenu.js';
import { Sidebar, type SidebarItem } from '../../components/Sidebar.js';
import { Icon } from '../../icons/Icon.js';
import { CommandPalette, type CommandItem } from '../CommandPalette/index.js';
import { notice, type NoticeTone } from '../DashboardPage/index.js';

/** A link of the account menu, such as Profile or Sessions. */
export interface DashboardShellLink {
    label: string;
    href: string;
    icon?: IconEntry;
}

/** A message above every screen. With `href`, the whole message links there. */
export interface DashboardShellNotice {
    id: string;
    tone: NoticeTone;
    message: string;
    href?: string;
}

/** What waits for the user, in the taskbar: a link with an optional count. */
export interface DashboardShellStatus {
    id: string;
    label: string;
    href: string;
    count?: number;
    tone?: 'info' | 'warning' | 'error';
}

export interface DashboardShellLabels {
    navigation?: string;
    expand?: string;
    collapse?: string;
    viewSite?: string;
    toggleTheme?: string;
    lightMode?: string;
    darkMode?: string;
    logOut?: string;
    palette?: string;
    palettePlaceholder?: string;
    taskbar?: string;
    screenOptions?: string;
    help?: string;
}

export type DashboardShellIcons = Partial<Record<'light' | 'dark' | 'expand' | 'logout', IconEntry>>;

export type DashboardShellProps = {
    /** The site the dashboard belongs to. Its logo and name link to `href` (default `/`). `logoOnly`: the logo already shows the name. */
    brand: { name: string; logo: string; logoOnly?: boolean; href?: string };
    /** The signed-in user, in the account menu. */
    account: { name: string; email: string; avatar?: string | null };
    /** The sidebar's items; the caller marks the active one. */
    navigation: readonly SidebarItem[];
    /** The account menu's links, above Log out. */
    accountLinks?: readonly DashboardShellLink[];
    /** Sidebar collapsed to icons; the caller keeps it, such as in a cookie. */
    collapsed: boolean;
    onCollapsedChange(collapsed: boolean): unknown;
    onLogout(): unknown;
    /** Shows the light and dark toggle; the caller switches the theme. */
    onThemeToggle?(): unknown;
    /** The palette's entries; without them there is no palette. */
    commands?: readonly CommandItem[];
    onCommand?(id: string): unknown;
    onCommandSearch?(text: string): unknown;
    notices?: readonly DashboardShellNotice[];
    /** The taskbar's statuses. */
    statuses?: readonly DashboardShellStatus[];
    /** Shows the taskbar along the bottom on wider screens. Default: true. */
    taskbar?: boolean;
    /** A message above the screen, such as why signing out failed. */
    error?: string;
    labels?: DashboardShellLabels;
    icons?: DashboardShellIcons;
    /** The sidebar's width when open. Default: 248px. */
    width?: string;
};

const LABELS: Required<DashboardShellLabels> = {
    navigation: 'Dashboard navigation', expand: 'Expand navigation', collapse: 'Collapse navigation', viewSite: 'View site',
    toggleTheme: 'Switch between light and dark mode', lightMode: 'Light mode', darkMode: 'Dark mode', logOut: 'Log out',
    palette: 'Go to', palettePlaceholder: 'Type a screen name or search…', taskbar: 'Dashboard taskbar', screenOptions: 'Screen options', help: 'Help',
};

const ICONS: Required<DashboardShellIcons> = { light: { line: SunIcon }, dark: { line: MoonIcon }, expand: { line: AltArrowRightIcon }, logout: { line: Logout3Icon } };

@Component()
export class DashboardShell extends Cossack {
    declare props: DashboardShellProps;

    render(): TemplateResult {
        const props = this.props;
        const labels = { ...LABELS, ...props.labels };
        const icons = { ...ICONS, ...props.icons };
        const { brand, account } = props;
        const home = brand.href ?? '/';
        const iconClass = 'inline-flex items-center justify-center [&_svg]:size-4';
        // Only one theme icon shows, so `hidden` must not share the element with `inline-flex`.
        const themeIcon = 'items-center justify-center [&_svg]:size-4';
        const statusTone = (tone: DashboardShellStatus['tone']) => tone === 'error' ? 'text-destructive' : tone === 'warning' ? 'text-warning-text' : 'text-muted-foreground';
        const taskbarButton = 'hidden h-7 cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground';
        const accountLinks = props.accountLinks ?? [];
        const notices = props.notices ?? [];
        return html`
            <div class="cs-dashboard-shell group/dashboard flex min-h-screen bg-background">
                ${component(Sidebar, {
                    id: 'dashboard-navigation', label: labels.navigation, expandLabel: labels.expand, collapseLabel: labels.collapse,
                    title: brand.name,
                    brand: html`<a href=${home} class="flex items-center gap-2 no-underline group-[.is-collapsed]:hidden" aria-label=${labels.viewSite} title=${labels.viewSite}>
                        ${brand.logoOnly
                            ? Image({ src: brand.logo, alt: brand.name, width: 32, height: 32, loading: 'eager', class: 'h-8 w-auto max-w-40 shrink-0 object-contain' })
                            : html`${Image({ src: brand.logo, alt: '', width: 24, height: 24, loading: 'eager', class: 'h-6 w-auto max-w-24 shrink-0 object-contain' })}
                        <span class="text-sm font-semibold text-foreground truncate">${brand.name}</span>`}
                    </a>
                    <a href=${home} class="hidden group-[.is-collapsed]:flex items-center justify-center" aria-label=${labels.viewSite} title=${labels.viewSite}>
                        ${Image({ src: brand.logo, alt: '', width: 24, height: 24, loading: 'eager', class: 'size-6 object-contain' })}
                    </a>`,
                    width: props.width ?? '248px',
                    collapsible: 'icon',
                    collapsed: props.collapsed,
                    onCollapsedChange: (next: boolean) => props.onCollapsedChange(next),
                    items: props.navigation,
                    // Both theme labels render; the .dark class on <html> shows the current one, so the
                    // server's markup matches before the theme is known.
                    footer: html`
                        ${props.onThemeToggle ? html`<div class="flex items-center gap-1">
                            <button type="button" @click=${() => props.onThemeToggle?.()} title=${labels.toggleTheme} aria-label=${labels.toggleTheme}
                                class="flex-1 flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer border-none bg-transparent group-[.is-collapsed]:px-0">
                                <span class=${`${themeIcon} inline-flex dark:hidden`}>${component(Icon, { entry: icons.light, size: 16 })}</span>
                                <span class=${`${themeIcon} hidden dark:inline-flex`}>${component(Icon, { entry: icons.dark, size: 16 })}</span>
                                <span class="group-[.is-collapsed]:hidden dark:hidden">${labels.lightMode}</span>
                                <span class="hidden group-[.is-collapsed]:hidden dark:inline">${labels.darkMode}</span>
                            </button>
                        </div>
                        <div class="h-px bg-border my-1 group-[.is-collapsed]:hidden"></div>` : null}
                        ${component(DropdownMenu, {
                            id: 'dashboard-account-menu', block: true, side: 'right', align: 'end',
                            trigger: html`
                                <span class="flex items-center gap-2.5 w-full px-1.5 py-1 rounded-md text-left group-[.is-collapsed]:justify-center">
                                    ${component(Avatar, { src: account.avatar ?? '', alt: account.name, size: 32 })}
                                    <span class="flex-1 min-w-0 group-[.is-collapsed]:hidden">
                                        <span class="block text-sm font-medium text-foreground truncate">${account.name}</span>
                                        <span class="block text-xs text-muted-foreground truncate">${account.email}</span>
                                    </span>
                                    <span class="text-muted-foreground group-[.is-collapsed]:hidden ${iconClass}">${component(Icon, { entry: icons.expand, size: 16 })}</span>
                                </span>`,
                        }, html`
                            <div class="px-3 py-2">
                                <div class="text-sm font-medium">${account.name}</div>
                                <div class="text-xs text-muted-foreground">${account.email}</div>
                            </div>
                            ${accountLinks.length ? html`<div class="h-px bg-border my-1"></div>` : null}
                            ${accountLinks.map(link => html`
                                <a role="menuitem" tabindex="-1" href=${link.href} class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted text-foreground no-underline">
                                    ${link.icon ? html`<span class=${iconClass}>${component(Icon, { entry: link.icon, size: 16 })}</span>` : null}
                                    ${link.label}
                                </a>`)}
                            <div class="h-px bg-border my-1"></div>
                            <button type="button" role="menuitem" tabindex="-1" @click=${() => props.onLogout()}
                                class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted cursor-pointer border-none bg-transparent text-left text-destructive">
                                <span class=${iconClass}>${component(Icon, { entry: icons.logout, size: 16 })}</span>
                                ${labels.logOut}
                            </button>`)}`,
                })}
                <div class="flex-1 min-w-0 flex flex-col">
                    ${props.commands ? component(CommandPalette, { id: 'dashboard-commands', label: labels.palette, placeholder: labels.palettePlaceholder, shortcut: true,
                        commands: props.commands, onSelect: (id: string) => props.onCommand?.(id), onSearchChange: (text: string) => props.onCommandSearch?.(text) }) : null}
                    <main class="flex-1 p-6 sm:p-8 overflow-x-hidden has-[[data-settings-toolbar]]:overflow-visible has-[[data-subnav]]:grid has-[[data-subnav]]:grid-cols-1 has-[[data-subnav]]:p-0">
                        ${props.error ? html`<p role="alert" class="mb-4 text-sm text-destructive">${props.error}</p>` : null}
                        ${notices.length ? html`<div data-dashboard-notices class="mb-6 space-y-2 group-has-[[data-subnav]]/dashboard:m-4">${notices.map(item => item.href
                            ? html`<a href=${item.href} data-notice-id=${item.id} class="block no-underline">${notice(item.message, item.tone)}</a>`
                            : html`<div data-notice-id=${item.id}>${notice(item.message, item.tone)}</div>`)}</div>` : null}
                        ${this.children}
                    </main>
                    ${props.taskbar === false ? null : html`<footer data-dashboard-taskbar aria-label=${labels.taskbar} class="sticky bottom-0 z-30 hidden h-10 items-center gap-1 border-t border-border bg-background/95 px-3 text-xs text-muted-foreground backdrop-blur md:flex">
                        <a href=${home} class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground no-underline hover:bg-muted" title=${labels.viewSite}>
                            ${brand.logoOnly
                                ? Image({ src: brand.logo, alt: brand.name, width: 24, height: 24, loading: 'eager', class: 'h-6 w-auto max-w-28 shrink-0 object-contain' })
                                : html`${Image({ src: brand.logo, alt: '', width: 16, height: 16, loading: 'eager', class: 'h-4 w-auto max-w-16 shrink-0 object-contain' })}
                            <span class="max-w-40 truncate">${brand.name}</span>`}
                        </a>
                        <span aria-hidden="true" class="mx-1 h-4 w-px bg-border"></span>
                        ${(props.statuses ?? []).map(item => html`<a href=${item.href} data-status=${item.id} class=${`inline-flex h-7 items-center gap-1.5 rounded-md px-2 no-underline hover:bg-muted hover:text-foreground ${statusTone(item.tone)}`}>
                            ${item.label}${item.count !== undefined ? html`<span class="rounded-full bg-muted px-1.5 py-px text-[0.7rem] font-semibold tabular-nums text-foreground">${item.count}</span>` : null}</a>`)}
                        <span class="flex-1"></span>
                        <button type="button" popovertarget="screen-options" class=${`${taskbarButton} group-has-[#screen-options]/dashboard:inline-flex`}>${labels.screenOptions}</button>
                        <button type="button" popovertarget="screen-help" class=${`${taskbarButton} group-has-[#screen-help]/dashboard:inline-flex`}>${labels.help}</button>
                        <span class="px-2">&copy; ${new Date().getFullYear()} ${brand.name}</span>
                    </footer>`}
                </div>
            </div>`;
    }
}
