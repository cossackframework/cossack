/**
 * The default site theme's frame: the header with menus, search and languages, the content,
 * and the footer. A theme is a plugin: `plugin.json` declares its menu locations and options,
 * and each file in `templates/` default-exports one template (`layout`, `entry`, `archive`,
 * `home`, `search`, `not-found`, and narrower ones such as `entry-posts` or `term-category`).
 * Shared pieces live in `parts/`. Edit this theme, or copy the directory to
 * `src/plugins/<your-theme>/`, rename it in `plugin.json` and activate it under Appearance → Themes.
 */
import { html, type TemplateResult } from '@cossackframework/renderer';
import { presetStyle, type SiteView, type ThemeHelpers } from '@cossackframework/cms';
import { desktopMenu, languageSwitcher, link, mobileMenu, searchBox } from '../parts/menu';
import { accentStyle, typographyCss, width } from '../parts/options';

export default function layout(site: SiteView, content: TemplateResult, helpers: ThemeHelpers): TemplateResult {
    // A blank canvas: the page's content alone, with the theme's colours and type but no header or footer.
    if (site.template === 'entry-blank') return html`<div class="min-h-screen bg-background text-foreground" style=${`${accentStyle(helpers)} ${presetStyle(helpers.presets)}`} data-theme="default-theme" data-frame="blank">
        <style data-theme-typography>${typographyCss(helpers)}</style>
        <main id="content">${content}</main>
    </div>`;
    const primary = site.menus.primary ?? [];
    const footer = site.menus.footer ?? [];
    const frame = `mx-auto w-full px-6 ${helpers.options.width === 'wide' ? 'max-w-6xl' : 'max-w-5xl'}`;
    const footerText = typeof helpers.options.footerText === 'string' && helpers.options.footerText.trim() ? helpers.options.footerText : `© ${new Date().getFullYear()} ${site.title}`;
    // The presets' variables sit on the root, so widget areas outside the content root resolve them too.
    // The typography options as a stylesheet here rather than in a head template, so a child theme with its own head keeps them.
    return html`<div class="flex min-h-screen flex-col bg-background text-foreground" style=${`${accentStyle(helpers)} ${presetStyle(helpers.presets)}`} data-theme="default-theme">
        <style data-theme-typography>${typographyCss(helpers)}</style>
        <a href="#content" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow">${__('Skip to content')}</a>
        <header class="border-b border-border">
            <div class=${`${frame} flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-5`}>
                <a href=${site.homeUrl} class="no-underline">
                    <span class="block text-xl font-bold text-foreground">${site.title}</span>
                    ${site.tagline ? html`<span class="block text-sm text-muted-foreground">${site.tagline}</span>` : null}
                </a>
                <div class="flex flex-1 flex-wrap items-center justify-end gap-x-6 gap-y-2">
                    ${primary.length ? html`<nav aria-label=${__('Primary')} class="contents">${desktopMenu(primary, helpers)}${mobileMenu(primary, helpers)}</nav>` : null}
                    ${helpers.options.showSearch === false ? null : searchBox(site.searchUrl, 'hidden sm:block')}
                    ${languageSwitcher(site.languages)}
                </div>
            </div>
        </header>
        <main id="content" class=${`mx-auto w-full flex-1 px-6 py-10 ${width(helpers)}`}>${content}</main>
        <footer class="border-t border-border">
            ${site.areas.footer?.length ? html`<div class=${`${frame} grid gap-8 border-b border-border py-8 text-sm sm:grid-cols-2 lg:grid-cols-3`}>
                ${site.areas.footer.map(block => html`<div class="cms-content min-w-0">${helpers.block(block)}</div>`)}</div>` : null}
            <div class=${`${frame} flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between`}>
                ${footer.length ? html`<nav aria-label=${__('Footer')}><ul class="flex flex-wrap gap-x-5 gap-y-2">
                    ${footer.flatMap(item => [item, ...item.children]).map(item => html`<li>${link(item, 'no-underline', helpers)}</li>`)}</ul></nav>` : null}
                <p class="flex flex-wrap items-center gap-x-3">
                    <span>${footerText}</span>
                    ${site.blog ? html`<a href="/feed" class="hover:text-foreground">RSS</a>` : null}
                    <a href="/auth/login" class="hover:text-foreground">${__('Log in')}</a>
                </p>
            </div>
        </footer>
    </div>`;
}
