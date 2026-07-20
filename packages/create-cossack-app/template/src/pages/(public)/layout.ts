import { Cossack, Page, State, Client, HeadContext, HeadValue, server$ } from '@cossackframework/core';
import { NavigationMenu, Sheet, Icon } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import { SunIcon as sunIcon } from '@cossackframework/solar-icons/sun';
import { MoonIcon as moonIcon } from '@cossackframework/solar-icons/moon';
import { HamburgerMenuIcon as hamburgerIcon } from '@cossackframework/solar-icons/hamburger-menu';
import { themeStore } from '../../stores';
/**
 * Public layout: header (logo + nav + theme toggle) and footer shared by all
 * marketing-style pages. Nav links are auth-aware: a logged-in visitor sees
 * Dashboard; a logged-out visitor sees Login + Register.
 *
 * Desktop nav uses the NavigationMenu component; on mobile a hamburger button
 * opens a slide-in Sheet with the same links. Theme state mirrors the App /
 * dashboard layout (both manipulate the same `<html>.dark` class + localStorage).
 *
 * This is a URL-stripped route group — the parens in `(public)` mean pages
 * here keep their normal URL (e.g. `(public)/index.ts` serves `/`), they only
 * share this layout.
 */
@Page({ transport: 'http' })
export default class PublicLayout extends Cossack {
    appName = server$(() => config('app.name'), { initial: 'My App' });
    @State() theme: 'light' | 'dark' = 'dark';
    @State() mobileNavOpen = false;
    /** Auth-aware nav data — computed server-side in init() so it serializes
     *  and the client never re-derives it from this.user (undefined on client). */
    @State() navSections: any[] = [];
    @State() mobileLinks: any[] = [];
    @State() primaryCta: { label: string; href: string } = { label: '', href: '' };

    private _themeUnsub?: () => void;

    public head(context: HeadContext): HeadValue {
        return { title: context.title ? `${this.appName} — ${context.title}` : this.appName };
    }

    onCleanup() {
        this._themeUnsub?.();
    }

    onMount() {
        this._themeUnsub = themeStore.subscribe((value) => {
            this.theme = value;
        });
    }

    async init() {
        // Seed theme from cookie at SSR so the toggle icon matches initial paint.
        this.theme = this.c
            ? (getCookie(this.c, 'cs-theme') === 'dark' ? 'dark' : 'light')
            : this.theme;

        // Build the nav data once, server-side. this.user is available here
        // (request-scoped) but NOT on client re-renders, so derive here and
        // store as @State.
        const isLoggedIn = !!this.user;
        const docsItems = [{ label: __('Docs'), href: 'https://cossack.dev/docs', description: __('Guides, API reference, examples') }];
        const starterItems = [
            { label: __('Blog'), href: '/blog', description: __('Read the starter post') },
            { label: __('Contact'), href: '/contact', description: __('Send us a message') },
        ];
        const authItems = isLoggedIn
            ? [{ label: __('Dashboard'), href: '/dashboard', description: __('Your account overview') }]
            : [
                { label: __('Login'), href: '/auth/login', description: __('Sign in to your account') },
                { label: __('Register'), href: '/auth/register', description: __('Create a new account') },
            ];
        this.navSections = [
            { label: __('Explore'), items: starterItems },
            { label: __('Docs'), items: docsItems },
            { label: isLoggedIn ? __('Account') : __('Get started'), items: authItems },
        ];
        this.mobileLinks = [
            { label: __('Blog'), href: '/blog' },
            { label: __('Contact'), href: '/contact' },
            { label: __('Docs'), href: 'https://cossack.dev/docs' },
            ...(isLoggedIn
                ? [{ label: __('Dashboard'), href: '/dashboard' }]
                : [{ label: __('Login'), href: '/auth/login' }, { label: __('Register'), href: '/auth/register' }]),
        ];
        this.primaryCta = isLoggedIn
            ? { label: __('Dashboard'), href: '/dashboard' }
            : { label: __('Get started'), href: '/auth/register' };
    }

    @Client()
    toggleTheme() {
        const theme = themeStore.get() === 'dark' ? 'light' : 'dark';
        document.cookie = `cs-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
        themeStore.set(theme);
    }

    @Client()
    openMobileNav() { this.mobileNavOpen = true; }

    @Client()
    closeMobileNav() { this.mobileNavOpen = false; }

    render(): TemplateResult {
        const iconBtn = 'inline-flex items-center justify-center [&_svg]:size-4';

        return html`
            <div class="min-h-screen flex flex-col bg-background text-foreground">
                <header class="border-b border-border sticky top-0 z-30 bg-background/95 backdrop-blur">
                    <div class="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-4">
                        <a href="/" class="flex items-center gap-2 font-semibold text-foreground shrink-0">
                            <img src="/logo.svg" alt=${this.appName} width="28" height="28" />
                            <span>${this.appName}</span>
                        </a>

                        <div class="flex items-center gap-2">
                            <!-- Desktop nav (NavigationMenu) -->
                            <div class="hidden sm:block">
                                ${component(NavigationMenu, {
                                    trigger: 'hover',
                                    sections: this.navSections,
                                })}
                            </div>

                            <!-- Theme toggle (all sizes) -->
                            <button
                                type="button"
                                @click=${() => this.toggleTheme()}
                                class="w-9 h-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer border-none bg-transparent"
                                title=${this.theme === 'dark' ? __('Switch to light mode') : __('Switch to dark mode')}
                                aria-label=${__('Toggle theme')}
                            >
                                <span class=${iconBtn}>
                                    ${this.theme === 'dark'
                                        ? component(Icon, { entry: sunIcon, size: 18 })
                                        : component(Icon, { entry: moonIcon, size: 18 })}
                                </span>
                            </button>

                            <!-- Desktop primary CTA (auth-aware, from @State) -->
                            <a href=${this.primaryCta.href} class="hidden sm:inline-flex items-center rounded-md bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:opacity-90 transition-opacity">${this.primaryCta.label}</a>

                            <!-- Mobile hamburger -->
                            <button
                                type="button"
                                @click=${() => this.openMobileNav()}
                                class="sm:hidden w-9 h-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer border-none bg-transparent"
                                aria-label=${__('Open navigation menu')}
                                aria-expanded=${this.mobileNavOpen ? 'true' : 'false'}
                            >
                                <span class=${iconBtn}>${component(Icon, { entry: hamburgerIcon, size: 20 })}</span>
                            </button>
                        </div>
                    </div>
                </header>

                <!-- Mobile nav Sheet -->
                ${component(Sheet, {
                    open: this.mobileNavOpen,
                    side: 'right',
                    onClose: () => this.closeMobileNav(),
                }, html`
                    <nav class="flex flex-col gap-1 pt-4">
                        ${this.mobileLinks.map((link) => html`
                            <a href=${link.href} class="px-3 py-2.5 rounded-md text-sm font-medium text-foreground hover:bg-muted transition-colors no-underline">${link.label}</a>
                        `)}
                    </nav>
                `)}

                <main class="flex-1">
                    ${this.children}
                </main>

                <footer class="border-t border-border">
                    <div class="mx-auto max-w-6xl px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
                        <p>&copy; ${new Date().getFullYear()} ${this.appName}. ${__('All rights reserved.')}</p>
                        <div class="flex items-center gap-4">
                            <a href="https://github.com/cossackframework" class="hover:text-foreground transition-colors">GitHub</a>
                            <a href="https://x.com/cossackframework" class="hover:text-foreground transition-colors">X</a>
                            <a href="https://cossack.dev/docs" class="hover:text-foreground transition-colors">${__('Docs')}</a>
                        </div>
                    </div>
                </footer>
            </div>
        `;
    }
}
