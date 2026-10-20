/** Menus, the search box and the language switcher in the header and footer. */
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { LanguageLink, MenuItemView, ThemeHelpers } from '@cossackframework/cms';

export function link(item: MenuItemView, className: string, helpers: ThemeHelpers): TemplateResult {
    const active = helpers.isActive(item.url);
    return html`<a href=${item.url} class=${`${className} ${active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        aria-current=${active ? 'page' : 'false'} target=${item.newTab ? '_blank' : ''} rel=${item.newTab ? 'noopener noreferrer' : ''}>${item.label}</a>`;
}

/** The header menu: dropdowns open on hover and keyboard focus. */
export function desktopMenu(items: readonly MenuItemView[], helpers: ThemeHelpers, depth = 0): TemplateResult {
    if (depth === 0) return html`<ul class="hidden items-center gap-x-6 md:flex">${items.map(item => html`<li class="group relative">
        ${link(item, 'inline-flex items-center gap-1 py-2 text-sm no-underline', helpers)}
        ${item.children.length ? html`<div class="invisible absolute left-0 top-full z-20 min-w-48 pt-2 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
            ${desktopMenu(item.children, helpers, 1)}</div>` : null}
    </li>`)}</ul>`;
    return html`<ul class="rounded-lg border border-border bg-popover p-1 shadow-lg">${items.map(item => html`<li class="group/sub relative">
        ${link(item, 'block rounded-md px-3 py-2 text-sm no-underline hover:bg-muted', helpers)}
        ${item.children.length ? html`<div class="invisible absolute left-full top-0 z-20 min-w-48 pl-1 opacity-0 transition group-hover/sub:visible group-hover/sub:opacity-100 group-focus-within/sub:visible group-focus-within/sub:opacity-100">
            ${desktopMenu(item.children, helpers, depth + 1)}</div>` : null}
    </li>`)}</ul>`;
}

/** The menu on small screens: a disclosure with the whole tree indented. */
export function mobileMenu(items: readonly MenuItemView[], helpers: ThemeHelpers): TemplateResult {
    const tree = (list: readonly MenuItemView[], depth: number): TemplateResult => html`<ul class=${depth ? 'ml-4 border-l border-border pl-3' : ''}>
        ${list.map(item => html`<li>${link(item, 'block py-2 text-sm no-underline', helpers)}${item.children.length ? tree(item.children, depth + 1) : null}</li>`)}</ul>`;
    return html`<details class="w-full md:hidden">
        <summary class="cursor-pointer select-none py-2 text-sm font-medium text-foreground">${__('Menu')}</summary>
        <div class="pb-2">${tree(items, 0)}</div>
    </details>`;
}

export function searchBox(action: string, className = ''): TemplateResult {
    return html`<form action=${action} method="get" role="search" class=${className}>
        <input type="search" name="q" placeholder=${__('Search')} aria-label=${__('Search')}
            class="w-44 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
    </form>`;
}

/** The current page in the site's other languages. */
export function languageSwitcher(languages: readonly LanguageLink[]): TemplateResult | null {
    if (languages.length < 2) return null;
    return html`<nav aria-label=${__('Language')}><ul class="flex items-center gap-1 text-sm">${languages.map(language => html`<li>
        <a href=${language.url} hreflang=${language.code} lang=${language.code} aria-current=${language.current ? 'true' : 'false'}
            class=${`rounded px-2 py-1 no-underline ${language.current ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>${language.label}</a></li>`)}</ul></nav>`;
}
