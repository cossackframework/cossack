import {
  Client,
  ClientState,
  Cossack,
  On,
  Page,
  Shared,
} from '@cossackframework/core';
import { bind, component, html } from '@cossackframework/renderer';
import {
  Button,
  Input,
  Sheet,
  Sidebar,
  Typography,
  type SidebarItem,
} from '@cossackframework/ui';
import { Icon } from '@cossackframework/ui';
import { HamburgerMenuIcon } from '@cossackframework/solar-icons/hamburger-menu';
import { MagnifierIcon } from '@cossackframework/solar-icons/magnifier';
import {
  demoCatalog,
  type DemoCatalogGroup,
} from '../demo-catalog.js';

@Page({ transport: 'http' })
export default class RootLayout extends Cossack {
  @ClientState() search = '';
  @ClientState() sidebarCollapsed = false;
  @ClientState() mobileNavigationOpen = false;
  @ClientState() currentPath = '/';

  get filteredCatalog(): readonly DemoCatalogGroup[] {
    const query = this.search.trim().toLowerCase();
    if (!query) return demoCatalog;

    return demoCatalog
      .map((group) => {
        const categoryMatches = group.category.toLowerCase().includes(query);
        return {
          ...group,
          entries: categoryMatches
            ? group.entries
            : group.entries.filter((entry) => entry.label.toLowerCase().includes(query)),
        };
      })
      .filter((group) => group.entries.length > 0);
  }

  get pathname(): string {
    if (this.isServer) return this.c.req.path;
    return this.currentPath || window.location.pathname;
  }

  get sidebarItems(): SidebarItem[] {
    return this.filteredCatalog.map((group) => ({
      label: group.category,
      icon: group.icon,
      active: group.entries.some((entry) => this.isEntryActive(entry.url)),
      children: group.entries.map((entry) => ({
        label: entry.label,
        href: entry.url,
        active: this.isEntryActive(entry.url),
      })),
    }));
  }

  @On('navigate-complete')
  @Client()
  handleNavigateComplete(pathname: string) {
    this.currentPath = pathname;
    this.mobileNavigationOpen = false;
  }

  @Client()
  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  @Client()
  openMobileNavigation() {
    this.mobileNavigationOpen = true;
  }

  @Client()
  closeMobileNavigation() {
    this.mobileNavigationOpen = false;
  }

  @Client()
  navigate(item: SidebarItem) {
    if (!item.href) return;
    this.currentPath = item.href;
    this.mobileNavigationOpen = false;
    this.redirect(item.href);
  }

  @Shared()
  private isEntryActive(url: string): boolean {
    if (url === '/') return this.pathname === '/';
    return this.pathname === url;
  }

  @Shared()
  private renderSidebar(collapsible: 'icon' | 'offcanvas') {
    return component(Sidebar, {
      title: 'Cossack demos',
      brand: html`
        <a href="/" class="flex items-center gap-2 text-sm font-semibold text-foreground no-underline">
          <img src="/logo.svg" alt="Cossack logo" class="h-6 w-6" />
          <span class="group-[.is-collapsed]:hidden">Cossack demos</span>
        </a>
      `,
      items: this.sidebarItems,
      collapsed: collapsible === 'icon' ? this.sidebarCollapsed : false,
      collapsible,
      onToggle: collapsible === 'icon' ? this.toggleSidebar : this.closeMobileNavigation,
      onNavigate: this.navigate,
      footer: html`<p class="px-2 text-xs text-muted-foreground group-[.is-collapsed]:hidden">Built with Cossack</p>`,
      'data-testid': collapsible === 'icon' ? 'desktop-sidebar' : 'mobile-sidebar',
    });
  }

  render() {
    const noResults = this.filteredCatalog.length === 0;

    return html`
      <div class="min-h-screen bg-background text-foreground">
        <div class="hidden md:fixed md:inset-y-0 md:left-0 md:flex">
          ${this.renderSidebar('icon')}
        </div>

        ${component(Sheet, {
          open: this.mobileNavigationOpen,
          side: 'left',
          size: 'min(88vw, 320px)',
          onClose: this.closeMobileNavigation,
          'aria-label': 'Demo navigation',
        }, this.renderSidebar('offcanvas'))}

        <div class="min-h-screen transition-[margin] duration-300 ${this.sidebarCollapsed ? 'md:ml-[72px]' : 'md:ml-[260px]'}">
          <header class="sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
            <div class="md:hidden">
              ${component(Button, {
                variant: 'ghost',
                size: 'icon',
                '@click': this.openMobileNavigation,
                'aria-label': 'Open navigation',
                'data-testid': 'mobile-navigation-trigger',
              }, component(Icon, { entry: HamburgerMenuIcon, size: 18 }))}
            </div>
            <div class="relative w-full max-w-xl">
              <span class="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground">
                ${component(Icon, { entry: MagnifierIcon, size: 16 })}
              </span>
              ${component(Input, {
                type: 'search',
                '.value': bind(this, 'search'),
                placeholder: 'Filter demos by page or category…',
                'aria-label': 'Filter demos',
                class: 'pl-9',
              })}
            </div>
            <div class="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
              <kbd class="rounded border bg-muted px-1.5 py-0.5">Ctrl</kbd>
              <span>+</span>
              <kbd class="rounded border bg-muted px-1.5 py-0.5">K</kbd>
            </div>
          </header>

          ${noResults
            ? html`<div class="border-b bg-muted/30 px-6 py-3 text-sm text-muted-foreground" role="status">
                No demos match “${this.search}”.
              </div>`
            : null}

          <main class="mx-auto w-full max-w-7xl p-4 md:p-8">
            ${this.children}
          </main>
        </div>

      </div>

    `;
  }
}
