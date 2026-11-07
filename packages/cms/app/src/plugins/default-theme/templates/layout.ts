/**
 * The default site theme's frame: the header and the footer bar are widget areas with the
 * theme's default blocks (a site logo, the primary menu with its dropdowns and mega panels,
 * search and the language switcher; the footer menu, the switcher and a copyright line), so
 * they are edited in place and under Appearance → Widgets; the footer widgets grid sits
 * between the content and the bar. Nothing here frames the blocks: the root sets the measures
 * (`--cms-content`, `--cms-wide`, `--cms-gutter`) from the width option, `helpers.layout`
 * renders each area as a constrained layout, and the templates keep their own parts at the
 * content measure with `cms-measure`, so a full-width group makes a band across the page. A
 * theme is a plugin: `plugin.json` declares its menu locations, areas and options, and each
 * file in `templates/` default-exports one template (`layout`, `entry`, `archive`, `home`,
 * `search`, `not-found`, and narrower ones such as `entry-posts` or `term-category`). Shared
 * pieces live in `parts/`. Edit this theme, or copy the directory to `src/plugins/<your-theme>/`,
 * rename it in `plugin.json` and activate it under Appearance → Themes.
 */
import { html, type TemplateResult } from '@cossackframework/renderer';
import { presetStyle, type SiteView, type ThemeHelpers } from '@cossackframework/cms';
import { accentStyle, measureStyle, typographyCss } from '../parts/options';

export default function layout(site: SiteView, content: TemplateResult, helpers: ThemeHelpers): TemplateResult {
    // The presets' variables and the measures sit on the root, so widget areas outside the content root resolve them too.
    const rootStyle = `${accentStyle(helpers)} ${presetStyle(helpers.presets)} ${measureStyle(helpers)}`;
    // A blank canvas: the page's content alone, with the theme's colors and type but no header or footer.
    if (site.template === 'entry-blank') return html`<div class="min-h-screen bg-background text-foreground" style=${rootStyle} data-theme="default-theme" data-frame="blank">
        <style data-theme-typography>${typographyCss(helpers)}</style>
        <main id="content">${content}</main>
    </div>`;
    // The typography options as a stylesheet here rather than in a head template, so a child theme with its own head keeps them.
    return html`<div class="flex min-h-screen flex-col bg-background text-foreground" style=${rootStyle} data-theme="default-theme">
        <style data-theme-typography>${typographyCss(helpers)}</style>
        <a href="#content" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow">${__('Skip to content')}</a>
        <header class="relative border-b border-border">${helpers.layout(site.areas.header ?? [])}</header>
        <main id="content" class="flex-1 py-10">${content}</main>
        <footer class="border-t border-border">
            ${site.areas.footer?.length ? html`<div class="border-b border-border py-8"><div class="cms-measure-wide grid gap-8 text-sm sm:grid-cols-2 lg:grid-cols-3">
                ${site.areas.footer.map(block => html`<div class="cms-content min-w-0">${helpers.block(block)}</div>`)}</div></div>` : null}
            ${helpers.layout(site.areas['footer-bar'] ?? [], { class: 'text-sm text-muted-foreground' })}
        </footer>
    </div>`;
}
