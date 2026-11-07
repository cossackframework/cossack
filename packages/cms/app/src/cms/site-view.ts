/**
 * The public site's rendering: the active theme's templates, the helpers they receive, and
 * the core block renderers themes can replace. Client-safe; views arrive from the server with
 * Markdown and rich text already rendered to escaped HTML.
 */
import { component, html, ifDefined, unsafeHTML, type TemplateResult } from '@cossackframework/renderer';
import type { HeadValue } from '@cossackframework/core';
import { plugins } from '@cossackframework/framework/plugins';
import { formBlock, inputBlock } from './form-view';
import { SITE_ICONS } from './site-icons';
import { archiveTemplate, assembleSiteTheme, blockStyleAttributes, entryTemplate, MAP_EMBED_URL, SHARE_NETWORKS, type BreadcrumbView, type PluginHead, type ShareNetwork, type SiteView, placeholderStyle, presetStyle, resolvePresets, siteThemeProblems, type ArchiveView, type EntryView, type LanguageLink, type LanguageSwitcherOptions, type MediaView, type MenuItemView, type MenuOptions, type RenderedBlock, type SearchOptions, type SiteTheme, type ThemeData, type ThemeHelpers, type ThemePresets } from '@cossackframework/cms';

export { archiveTemplate, entryTemplate };
export type { ArchiveView, EntryView, MediaView, Paging, RenderedBlock, SiteView } from '@cossackframework/cms';

/** Prose styles for rendered bodies. */
export const PROSE = 'cms-prose max-w-none leading-7 [&_a]:text-primary [&_a]:underline [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li_p]:my-1 [&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_img]:my-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_hr]:my-8 [&_table]:my-4 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_td]:border [&_td]:border-border [&_td]:px-2';

/**
 * A plugin's theme (its `templates/` files and `ui.ts` `theme` export), layered over its
 * parent's for a child theme, or the built-in fallback when it is missing or invalid.
 */
export function siteTheme(state: { readonly name: string | null; readonly parent?: string | null }): SiteTheme {
    const plugin = state.name ? plugins.find(entry => entry.name === state.name) : undefined;
    const parent = state.parent ? plugins.find(entry => entry.name === state.parent) : undefined;
    const theme = plugin ? assembleSiteTheme(plugin, parent) : undefined;
    return theme && !siteThemeProblems(theme).length ? theme as SiteTheme : fallbackTheme;
}

/** What a site page renders its theme with: the theme, its option values and its loaders' data. */
export interface ThemeRenderState {
    readonly name: string | null;
    /** The theme a child theme extends, whose assets it falls back to. */
    readonly parent?: string | null;
    readonly options: Record<string, unknown>;
    /** The presets blocks pick from; the defaults when absent. */
    readonly presets?: Required<ThemePresets>;
    readonly data?: { readonly layout?: ThemeData; readonly page?: ThemeData };
    /**
     * The page is in edit mode: blocks are wrapped in `display: contents` markers carrying their
     * IDs (a field's rich text, the field's name), which the site editor finds. Themes never see
     * it; visitors never get it.
     */
    readonly editing?: boolean;
    /** The page in each of the site's languages, for `helpers.languages()`; empty on a site with one language. */
    readonly languages?: readonly LanguageLink[];
    /** The menus of the theme's locations, for `helpers.menu()` and the Navigation block. */
    readonly menus?: { readonly [location: string]: readonly MenuItemView[] };
    /** Active plugins apart from the theme chain, whose `ui.ts` `head` adds tags to every site page (`pluginHeads`). */
    readonly plugins?: readonly string[];
    /** The site's title, tagline, logo and URLs, for `helpers.search()` and the site logo block. */
    readonly site?: { readonly title: string; readonly tagline: string; readonly logo: string | null; readonly homeUrl: string; readonly searchUrl: string; readonly url?: string; readonly breadcrumbs?: readonly BreadcrumbView[] };
}

/** A search form posting to the site's search page: a box, or a button that opens one. As `helpers.search()` and the `core/search` block render it. */
export function searchForm(action: string, options: SearchOptions = {}): TemplateResult {
    const placeholder = options.placeholder || __('Search');
    const form = html`<form action=${action} method="get" role="search" class=${`cms-search${options.class ? ` ${options.class}` : ''}`}>
        <input type="search" name="q" placeholder=${placeholder} aria-label=${placeholder} class="cms-search-input">
    </form>`;
    if (options.style !== 'icon') return form;
    return html`<details class="cms-search-toggle"><summary class="cms-search-button" aria-label=${placeholder} title=${placeholder}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></summary>${form}</details>`;
}

/**
 * The page's other languages as a `nav` of links: by name, flag, both or code, in a row or a
 * column. Null on a site with one language. Themes render it through `helpers.languages()`, and
 * the `core/languages` block places it in widget areas and content.
 */
export function languageSwitcher(languages: readonly LanguageLink[], options: LanguageSwitcherOptions = {}): TemplateResult | null {
    if (languages.length < 2) return null;
    const style = options.style === 'flags' || options.style === 'flags-names' || options.style === 'codes' ? options.style : 'names';
    const list = options.layout === 'list';
    const name = (language: LanguageLink) => {
        const flag = language.flag ? html`<span aria-hidden="true">${language.flag}</span>` : null;
        switch (style) {
            case 'flags': return html`${flag ?? language.code.toUpperCase()}<span class="sr-only">${language.label}</span>`;
            case 'flags-names': return html`${flag}${flag ? ' ' : ''}${language.label}`;
            case 'codes': return html`<span aria-hidden="true">${language.code.toUpperCase()}</span><span class="sr-only">${language.label}</span>`;
            default: return html`${language.label}`;
        }
    };
    return html`<nav aria-label=${__('Language')} data-languages=${style} class=${options.class ?? ''}><ul class=${list ? 'flex flex-col gap-1 text-sm' : 'flex flex-wrap items-center gap-1 text-sm'}>${languages.map(language => html`<li>
        <a href=${language.url} hreflang=${language.code} lang=${language.code} aria-current=${language.current ? 'true' : 'false'} title=${language.label}
            class=${`inline-flex items-center gap-1 rounded px-2 py-1 no-underline ${language.current ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>${name(language)}</a></li>`)}</ul></nav>`;
}

/** A media field's view among typed fields, or null for anything else. */
function mediaOf(value: unknown): MediaView | null {
    return value && typeof value === 'object' && !Array.isArray(value) && 'contentType' in value && typeof (value as MediaView).url === 'string' ? value as MediaView : null;
}

/** A location's name as an accessible name, when the theme gives none: `primary` is “Primary”. */
function locationLabel(location: string): string {
    const words = location.replaceAll('-', ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A menu as a `nav`, as `helpers.menu()` and the `core/navigation` block render it. `dropdowns`
 * is a header menu: one row, a dropdown under an item with children, a mega panel under an item
 * with a panel or heading children (one column per heading, links with their icon, description
 * and badge from the field groups attached to menu items, the panel's blocks beside them), and
 * below the `collapse` width (768px, or 1024px for `lg`) a hamburger button opening a drawer
 * with a tree whose groups fold: the `mobile` items when given (another location's menu), else
 * this menu's own. `inline` is one row with children flattened, for
 * footers; `list` the whole tree as nested lists, for sidebars. Panels and dropdowns open on
 * hover, keyboard focus and while a block inside is selected in Live Edit, with the motion the
 * `nav`'s `data-motion` names (`cms/blocks.css`: `rise` by default, `fade`, `scale`, `none`, or
 * a theme's own). Null without items. Themes restyle the `cms-nav-*` and `cms-mega-*` classes
 * or draw their own.
 */
export function menuNav(items: readonly MenuItemView[], options: MenuOptions, helpers: Pick<ThemeHelpers, 'block' | 'isActive'>): TemplateResult | null {
    if (!items.length) return null;
    const style = options.style === 'inline' || options.style === 'list' ? options.style : 'dropdowns';
    const motion = typeof options.motion === 'string' && options.motion.trim() ? options.motion.trim() : 'rise';
    const collapse = options.collapse === 'lg' ? 'lg' : 'md';
    // `helpers.menu` resolves a location name to items; a name reaching here, or no items, means this menu's own tree.
    const mobileItems = Array.isArray(options.mobile) && options.mobile.length ? options.mobile : items;
    const label = options.label ?? __('Menu');
    const className = `cms-nav cms-nav-${style}${options.class ? ` ${options.class}` : ''}`;
    const badge = (item: MenuItemView) => typeof item.fields.badge === 'string' && item.fields.badge ? html` <span class="cms-nav-badge">${item.fields.badge}</span>` : null;
    /** A heading is text; a link carries its class names, attributes and whether it is the current page. */
    const link = (item: MenuItemView, kind: string): TemplateResult => {
        if (item.url === null) return html`<span class=${`${kind} cms-nav-heading${item.className ? ` ${item.className}` : ''}`} ...=${item.attributes}>${item.label}${badge(item)}</span>`;
        const active = helpers.isActive(item.url);
        return html`<a href=${item.url} class=${`${kind}${item.className ? ` ${item.className}` : ''}`} aria-current=${ifDefined(active ? 'page' : undefined)}
            target=${ifDefined(item.newTab ? '_blank' : undefined)} rel=${ifDefined(item.newTab ? 'noopener noreferrer' : undefined)} ...=${item.attributes}>${item.label}${badge(item)}</a>`;
    };
    const tree = (item: MenuItemView): TemplateResult => html`<li class="cms-nav-item">${link(item, 'cms-nav-treelink')}${item.children.length ? html`<ul>${item.children.map(tree)}</ul>` : null}</li>`;
    if (style === 'list') return html`<nav class=${className} aria-label=${label}><ul class="cms-nav-tree">${items.map(tree)}</ul></nav>`;
    if (style === 'inline') {
        // One level flattened; a heading shows the links under it.
        const flat = items.flatMap(item => item.url === null ? item.children.filter(child => child.url !== null) : [item, ...item.children.filter(child => child.url !== null)]);
        return html`<nav class=${className} aria-label=${label}><ul class="cms-nav-list">${flat.map(item => html`<li class="cms-nav-item">${link(item, 'cms-nav-link')}</li>`)}</ul></nav>`;
    }
    const dropdown = (children: readonly MenuItemView[]): TemplateResult => html`<div class="cms-nav-sub"><ul class="cms-nav-sublist">
        ${children.map(child => html`<li class="cms-nav-item">${link(child, 'cms-nav-sublink')}${child.children.length ? dropdown(child.children) : null}</li>`)}</ul></div>`;
    const megaLink = (item: MenuItemView): TemplateResult => {
        const icon = mediaOf(item.fields.icon);
        return html`<a href=${item.url ?? '#'} class=${`cms-mega-link${item.className ? ` ${item.className}` : ''}`} aria-current=${ifDefined(item.url && helpers.isActive(item.url) ? 'page' : undefined)}
            target=${ifDefined(item.newTab ? '_blank' : undefined)} rel=${ifDefined(item.newTab ? 'noopener noreferrer' : undefined)} ...=${item.attributes}>
            ${icon ? html`<img class="cms-nav-icon" src=${icon.url} alt="" width="20" height="20" loading="lazy" decoding="async">` : null}
            <span class="cms-mega-text"><span class="cms-nav-label">${item.label}${badge(item)}</span>${item.description ? html`<span class="cms-nav-description">${item.description}</span>` : null}</span></a>`;
    };
    /** Columns of a mega panel: the links before any heading in one, then one per heading. */
    const megaColumns = (children: readonly MenuItemView[]): { heading: MenuItemView | null; links: MenuItemView[] }[] => {
        const columns: { heading: MenuItemView | null; links: MenuItemView[] }[] = [];
        for (const child of children) {
            if (child.url === null) columns.push({ heading: child, links: child.children.filter(link => link.url !== null) });
            else {
                let loose = columns.find(column => column.heading === null);
                if (!loose) columns.unshift(loose = { heading: null, links: [] });
                loose.links.push(child);
            }
        }
        return columns.filter(column => column.links.length || column.heading);
    };
    const mega = (item: MenuItemView): TemplateResult => {
        const columns = megaColumns(item.children);
        const panel = item.panel?.length ? item.panel : null;
        return html`<div class="cms-mega" data-panel=${ifDefined(panel ? '' : undefined)}><div class="cms-mega-box">
            ${columns.length ? html`<div class="cms-mega-columns">${columns.map(column => html`<div class="cms-mega-column">
                ${column.heading ? html`<p class="cms-mega-heading">${column.heading.label}</p>` : null}
                <ul class="cms-mega-links">${column.links.map(entry => html`<li>${megaLink(entry)}</li>`)}</ul></div>`)}</div>` : null}
            ${panel ? html`<div class="cms-mega-panel cms-content">${helpers.block(panel)}</div>` : null}
        </div></div>`;
    };
    const top = (item: MenuItemView): TemplateResult => {
        const isMega = Boolean(item.panel?.length) || item.children.some(child => child.url === null);
        const sub = isMega ? mega(item) : item.children.length ? dropdown(item.children) : null;
        return html`<li class=${`cms-nav-item${sub ? ' cms-nav-has-sub' : ''}`} data-mega=${ifDefined(isMega ? '' : undefined)}>${link(item, 'cms-nav-link')}${sub}</li>`;
    };
    /** The drawer's tree: a link with children folds (its link in the summary stays a link), a heading labels the group under it. */
    const fold = (item: MenuItemView): TemplateResult => {
        if (item.url === null) return html`<li class="cms-nav-group"><span class="cms-nav-group-label">${item.label}${badge(item)}</span><ul>${item.children.map(fold)}</ul></li>`;
        if (!item.children.length) return html`<li>${link(item, 'cms-nav-treelink')}</li>`;
        return html`<li class="cms-nav-group"><details class="cms-nav-fold"><summary class="cms-nav-fold-row">${link(item, 'cms-nav-treelink')}<span class="cms-nav-caret" aria-hidden="true"></span></summary><ul>${item.children.map(fold)}</ul></details></li>`;
    };
    return html`<nav class=${className} aria-label=${label} data-motion=${motion} data-collapse=${collapse}>
        <ul class="cms-nav-list">${items.map(top)}</ul>
        <details class="cms-nav-mobile"><summary class="cms-nav-toggle"><span class="cms-nav-burger" aria-hidden="true"></span><span class="cms-nav-toggle-label">${__('Menu')}</span></summary>
            <div class="cms-nav-drawer"><ul class="cms-nav-tree">${mobileItems.map(fold)}</ul></div></details>
    </nav>`;
}

/**
 * Keeps a header menu closed once a link in it is followed. Client-side navigation keeps the
 * layout, so the followed link would keep its focus and the pointer stay over the panel, and
 * either holds a CSS-only menu open; the drawer is a `<details>` nothing closes. On a plain
 * click of a link in a `cms-nav` (not a modifier click, not a new tab), the drawer and its folds
 * close, the link loses focus, and the nav is marked `data-closed`, which the stylesheet reads
 * to keep dropdowns and panels hidden until the pointer leaves the item or focus returns. A
 * click in Live Edit, where it selects a block, is left alone. Returns the function that stops
 * listening.
 */
export function closeMenusOnFollow(root: Document = document): () => void {
    const onClick = (event: MouseEvent) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = (event.target as Element | null)?.closest?.('a[href]');
        const nav = link?.closest('nav.cms-nav');
        if (!link || !nav || link.getAttribute('target') === '_blank' || link.closest('[data-cms-doc]')) return;
        for (const details of nav.querySelectorAll<HTMLDetailsElement>('details[open]')) details.open = false;
        (link as HTMLElement).blur();
        nav.setAttribute('data-closed', '');
    };
    const onFocus = (event: FocusEvent) => { (event.target as Element | null)?.closest?.('nav.cms-nav[data-closed]')?.removeAttribute('data-closed'); };
    const onPointerOut = (event: PointerEvent) => {
        const item = (event.target as Element | null)?.closest?.('nav.cms-nav[data-closed] .cms-nav-list > .cms-nav-item');
        if (item && !(event.relatedTarget instanceof Node && item.contains(event.relatedTarget))) item.closest('nav')?.removeAttribute('data-closed');
    };
    root.addEventListener('click', onClick);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('pointerout', onPointerOut);
    return () => {
        root.removeEventListener('click', onClick);
        root.removeEventListener('focusin', onFocus);
        root.removeEventListener('pointerout', onPointerOut);
    };
}

/**
 * What active plugins add to the document head: each `ui.ts` `head` export, called with the site,
 * the helpers and the plugin's own `asset()`. A hook that throws adds nothing.
 */
export function pluginHeads(state: Pick<ThemeRenderState, 'plugins'>, site: SiteView, helpers: ThemeHelpers): HeadValue[] {
    const heads: HeadValue[] = [];
    for (const name of state.plugins ?? []) {
        const plugin = plugins.find(entry => entry.name === name);
        const head = (plugin?.ui as { head?: unknown } | null | undefined)?.head;
        if (typeof head !== 'function') continue;
        try { heads.push((head as PluginHead)(site, helpers, { asset: path => plugin!.assets[path] ?? '' })); } catch { /* a broken hook adds nothing */ }
    }
    return heads;
}

/** The helpers every template receives. `isActive` is the component's own: an exact path, or a prefix. */
export function themeHelpers(theme: SiteTheme, state: ThemeRenderState, isActive: (path: string, exact: boolean) => boolean): ThemeHelpers {
    const assetsOf = (name: string | null | undefined) => name ? plugins.find(plugin => plugin.name === name)?.assets ?? {} : {};
    // A child theme's files win over its parent's.
    const assets: Readonly<Record<string, string>> = { ...assetsOf(state.parent), ...assetsOf(state.name) };
    const helpers: ThemeHelpers = {
        options: state.options,
        presets: state.presets ?? resolvePresets(undefined),
        data: { layout: state.data?.layout ?? {}, page: state.data?.page ?? {} },
        asset: path => assets[path] ?? '',
        icon: (name, options = {}) => siteIcon(name, options),
        breadcrumbs: (site, options = {}) => breadcrumbTrail(site.breadcrumbs, options),
        logo: (site, options = {}) => site.logo ? html`<img src=${site.logo} alt=${site.title} class=${`cms-site-logo object-contain ${options.class ?? 'h-10 w-auto'}`}>` : null,
        languages: options => languageSwitcher(state.languages ?? [], options),
        menu: (source, options = {}) => menuNav(typeof source === 'string' ? state.menus?.[source] ?? [] : source,
            { ...(typeof source === 'string' ? { label: locationLabel(source) } : {}), ...options, ...(typeof options.mobile === 'string' ? { mobile: state.menus?.[options.mobile] ?? [] } : {}) }, helpers),
        search: options => searchForm(state.site?.searchUrl ?? '/search', options),
        isActive: url => {
            const path = url.replace(/[?#].*$/, '').replace(/(.)\/$/, '$1');
            if (!path.startsWith('/')) return false;
            return path === '/' ? isActive('/', true) : isActive(path, true) || isActive(`${path}/`, false);
        },
        block: input => {
            const list: readonly RenderedBlock[] = Array.isArray(input) ? input as readonly RenderedBlock[] : [input as RenderedBlock];
            return html`${list.map(block => state.editing ? marked(block) : render(block))}`;
        },
        layout: (blocks, options = {}) => html`<div class=${`cms-layout${options.class ? ` ${options.class}` : ''}`}>${blocks.map(block => layoutItem(block, helpers))}</div>`,
        content: parts => html`${parts.map(part => part.kind === 'html' ? html`<div class=${PROSE}>${unsafeHTML(part.html)}</div>` : render(part.block))}`,
    };
    // In edit mode a block carries its ID; a field's rich text is one document, edited as a whole in the field's panel.
    const marked = (block: RenderedBlock) => block.field
        ? html`<div data-cms-edit="body" data-field=${block.field} style="display: contents">${render(block)}</div>`
        : html`<div data-cms-edit="block" data-block-id=${block.sourceId ?? block._id} data-cms-doc=${block.document ?? (block.pattern ? `pattern:${block.pattern}` : 'entry')} data-cms-locked=${ifDefined(block.locked ? '' : undefined)} style="display: contents">${render(block)}</div>`;
    const render = (block: RenderedBlock) => {
        // Data blocks hold values for themes and the API; nothing shows for them.
        if (block.dataOnly) return null;
        const rendered = theme.blocks?.[block.type]?.(block, helpers) ?? coreBlock(block, helpers, state);
        // A styled block gets one wrapper: classes per property and the presets' variables inline.
        // A column's wrapper takes its grid placement, as cms/blocks.css places `.cms-column-box`.
        // A group's wrapper carries its alignment too, so a narrow group's background is as narrow as the group.
        // A video plays behind the content, muted and looping, with the background image as its poster; the overlay paints over both (cms/blocks.css).
        const attributes = blockStyleAttributes(block);
        const column = block.type === 'core/column';
        const video = attributes?.video;
        const poster = typeof block.style?.image === 'string' ? block.media[block.style.image]?.url : undefined;
        const styled = attributes ? html`<div class=${column ? `${attributes.className} cms-column-box` : attributes.className} id=${ifDefined(attributes.id || undefined)} data-nosnippet=${ifDefined(attributes.nosnippet ? '' : undefined)}
            data-align=${ifDefined(block.type === 'core/group' ? alignOf(block) : undefined)}
            style=${ifDefined([attributes.style, column ? `--cms-span: ${columnSpan(block)}` : ''].filter(Boolean).join('; ') || undefined)}>${video
                ? html`<video class="cms-bg-video" src=${video.url} poster=${ifDefined(poster)} autoplay muted loop playsinline disablepictureinpicture preload="auto" aria-hidden="true" tabindex="-1"></video>` : null}${rendered}</div>` : rendered;
        // A hidden block stays in the HTML; the stylesheet drops it at those container widths.
        const hide = block.layout?.hide ?? [];
        const sized = hide.length ? html`<div data-hide=${hide.join(' ')} style="display: contents">${styled}</div>` : styled;
        // In a form, a block with a condition shows or hides as the form's values change.
        return block.when ? html`<div data-cms-when=${block._id} ?data-hidden=${block.shown === false} style="display: contents">${sized}</div>` : sized;
    };
    return helpers;
}

/**
 * Rendered blocks, and the blocks inside them, as part of a Live Edit document: the markers name
 * it, and a locked one selects nothing. A block expanded from a synced pattern belongs to the
 * pattern's document instead, locked unless `patterns` says the user may change that pattern.
 */
export function tagDocument(blocks: readonly RenderedBlock[], document: string, locked: boolean, patterns?: ReadonlyMap<string, boolean>): RenderedBlock[] {
    return blocks.map(block => {
        const own = block.pattern ? { document: `pattern:${block.pattern}`, locked: patterns?.get(block.pattern) ?? true } : { document, locked };
        return { ...block, document: own.document, ...(own.locked ? { locked: true } : {}), ...(block.children ? { children: tagDocument(block.children, document, locked, patterns) } : {}) };
    });
}

const ALIGNMENTS: ReadonlySet<string> = new Set(['content', 'wide', 'full', 'center', 'left', 'right']);

/** A block's width where the layout constrains blocks: its Width field (`align`), `content` without one. */
export function alignOf(block: Pick<RenderedBlock, 'data'>): string {
    const align = block.data.align;
    return typeof align === 'string' && ALIGNMENTS.has(align) ? align : 'content';
}

/**
 * A block as an item of a constrained layout: a box at the content measure, or the wide, full
 * or narrow one its Width field asks for (`cms-item` in cms/blocks.css), which is also the
 * query container the block responds to. `helpers.layout` wraps a template's blocks root in
 * them; a full-width group wraps its children.
 */
export function layoutItem(block: RenderedBlock, helpers: Pick<ThemeHelpers, 'block'>): TemplateResult {
    return html`<div class="cms-item" data-align=${alignOf(block)}>${helpers.block(block)}</div>`;
}

/**
 * The root the layout blocks respond to: columns stack and hidden blocks hide by its width,
 * not the viewport's, so the editor's device toggle only narrows it. Site pages wrap the
 * theme's page in it; a theme wraps widget areas it renders.
 */
export function siteContent(page: TemplateResult, theme?: Pick<ThemeRenderState, 'presets'>): TemplateResult {
    return html`<div class="cms-content" style=${ifDefined(presetStyle(theme?.presets) || undefined)}>${page}</div>`;
}

/** A column's width out of 12, from the span the columns block computed for it. */
function columnSpan(block: RenderedBlock): number {
    return Math.min(Math.max(Number(block.data.span) || 12, 1), 12);
}

/**
 * An image with its resized variants, for blocks; `sizes` is how wide it shows. Its width and
 * height keep the page from shifting as it loads, and its blurred placeholder shows until then.
 */
export function image(media: MediaView | undefined, className = '', sizes = media?.sizes): TemplateResult | null {
    if (!media) return null;
    return html`<img src=${media.url} srcset=${ifDefined(media.srcset || undefined)} sizes=${ifDefined(media.srcset ? sizes : undefined)} alt=${media.alt}
        width=${media.width ?? ''} height=${media.height ?? ''} loading=${media.priority ? 'eager' : 'lazy'} fetchpriority=${ifDefined(media.priority ? 'high' : undefined)} decoding="async" class=${className}
        style=${ifDefined(placeholderStyle(media.placeholder, media.width, media.height) || undefined)}>`;
}

/** A media element's `preload`, from the block's choice. */
function preloadOf(value: string): 'metadata' | 'auto' | 'none' {
    return value === 'auto' || value === 'none' ? value : 'metadata';
}

/** YouTube and Vimeo URLs as their privacy-respecting embed URLs. */
export function embedUrl(url: string): string | null {
    const youtube = /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,20})/.exec(url);
    if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`;
    const vimeo = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{1,15})/.exec(url);
    return vimeo ? `https://player.vimeo.com/video/${vimeo[1]}` : null;
}

function safeLink(url: unknown): string {
    return typeof url === 'string' && /^(?:https?:\/\/|\/|mailto:|tel:|#)/.test(url) ? url : '#';
}

/** A divider's color: a palette slug as its variable, else the CSS color given, else the border color. */
function dividerColor(value: string): string {
    if (!value) return 'var(--border)';
    return /^[a-z][a-z0-9-]*$/.test(value) && !/^(?:red|blue|green|black|white|gray|grey|transparent|currentcolor)$/.test(value) ? `var(--cms-color-${value}, ${value})` : value;
}

/** The carousel's browser part: arrows, dots and autoplay over a scroll-snapping track. Swiping works without it. */
function enhanceCarousel(element: Element | undefined): void {
    if (!element || typeof window === 'undefined') return;
    void import('./carousel.client').then(module => module.enhanceCarousel(element as HTMLElement)).catch(() => undefined);
}

/** The tabs' browser part: the buttons switch panels, the arrow keys move between them. Every panel shows without it. */
function enhanceTabs(element: Element | undefined): void {
    if (!element || typeof window === 'undefined') return;
    void import('./tabs.client').then(module => module.enhanceTabs(element as HTMLElement)).catch(() => undefined);
}

/** The stat's browser part: the number counts up as it scrolls into view. */
function enhanceStat(element: Element | undefined): void {
    if (!element || typeof window === 'undefined') return;
    void import('./stat.client').then(module => module.enhanceStat(element as HTMLElement)).catch(() => undefined);
}

/** The countdown's browser part: the units tick every second. */
function enhanceCountdown(element: Element | undefined): void {
    if (!element || typeof window === 'undefined') return;
    void import('./countdown.client').then(module => module.enhanceCountdown(element as HTMLElement)).catch(() => undefined);
}

/** The share buttons' browser part: copying the address, opening networks in a small window. */
function enhanceShare(element: Element | undefined): void {
    if (!element || typeof window === 'undefined') return;
    void import('./share.client').then(module => module.enhanceShare(element as HTMLElement)).catch(() => undefined);
}

const SEPARATORS: Readonly<Record<string, string>> = { chevron: '›', slash: '/', arrow: '→' };

/** A page's breadcrumbs as a `nav`: links, then the page itself; null for a trail of one. `helpers.breadcrumbs` and the block render this. */
export function breadcrumbTrail(crumbs: readonly BreadcrumbView[] | undefined, options: { readonly class?: string; readonly separator?: string; readonly home?: boolean } = {}): TemplateResult | null {
    const shown = options.home === false ? (crumbs ?? []).slice(1) : crumbs ?? [];
    if (shown.length < (options.home === false ? 1 : 2)) return null;
    const separator = SEPARATORS[options.separator ?? ''] ? options.separator! : 'chevron';
    return html`<nav class=${`cms-breadcrumbs${options.class ? ` ${options.class}` : ''}`} aria-label=${__('Breadcrumb')} data-separator=${separator}><ol class="cms-breadcrumbs-list">${shown.map(crumb => html`<li class="cms-breadcrumb">${crumb.url
        ? html`<a href=${crumb.url}>${crumb.label}</a>` : html`<span aria-current="page">${crumb.label}</span>`}</li>`)}</ol></nav>`;
}

const SHARE_NAMES: Readonly<Record<ShareNetwork, string>> = { facebook: 'Facebook', x: 'X', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', telegram: 'Telegram', reddit: 'Reddit', pinterest: 'Pinterest', bluesky: 'Bluesky', threads: 'Threads', email: 'Email', copy: 'Copy link' };

/** Where a network's share intent takes a page, with its title; null for the copy button. */
export function shareUrl(network: ShareNetwork, url: string, title: string): string | null {
    const u = encodeURIComponent(url);
    const t = encodeURIComponent(title);
    switch (network) {
        case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
        case 'x': return `https://x.com/intent/post?url=${u}&text=${t}`;
        case 'linkedin': return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
        case 'whatsapp': return `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`.trim())}`;
        case 'telegram': return `https://t.me/share/url?url=${u}&text=${t}`;
        case 'reddit': return `https://www.reddit.com/submit?url=${u}&title=${t}`;
        case 'pinterest': return `https://pinterest.com/pin/create/button/?url=${u}&description=${t}`;
        case 'bluesky': return `https://bsky.app/intent/compose?text=${encodeURIComponent(`${title} ${url}`.trim())}`;
        case 'threads': return `https://www.threads.net/intent/post?text=${encodeURIComponent(`${title} ${url}`.trim())}`;
        case 'email': return `mailto:?subject=${t}&body=${u}`;
        case 'copy': return null;
    }
}

/** An accordion that opens one section at a time: its sections share a `name`, which the browser keeps exclusive. */
function enhanceAccordion(element: Element | undefined): void {
    if (!(element instanceof HTMLElement) || element.dataset.single !== 'true') return;
    for (const details of element.querySelectorAll<HTMLDetailsElement>('details.cms-accordion-item')) details.name = `${element.id || 'cms-accordion'}-${element.dataset.group ?? ''}`;
}

/**
 * One of the site icons (`SITE_ICON_NAMES`) as an inline SVG: `class` sizes it (default
 * `size-5`), and it is decorative unless `label` names it. Null for a name outside the set, so a
 * theme can fall back. `helpers.icon` is this.
 */
export function siteIcon(name: string, options: { readonly class?: string; readonly label?: string } = {}): TemplateResult | null {
    const artwork = SITE_ICONS[name]?.line;
    if (!artwork) return null;
    const label = options.label?.trim();
    return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class=${`cms-icon ${options.class ?? 'size-5'}`} focusable="false"
        role=${ifDefined(label ? 'img' : undefined)} aria-label=${ifDefined(label || undefined)} aria-hidden=${ifDefined(label ? undefined : 'true')}>${unsafeHTML(artwork)}</svg>`;
}

/** What a social link is called when no network is known: Email, Phone, or the site's host. */
function socialTitle(url: string): string {
    if (url.startsWith('mailto:')) return __('Email');
    if (url.startsWith('tel:')) return __('Phone');
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** `core/latest-entries`: the entries as a list with excerpts, a grid of cards or titles alone. */
function latestEntries(block: RenderedBlock): TemplateResult {
    const entries = block.entries ?? [];
    const layout = typeof block.data.layout === 'string' ? block.data.layout : 'list';
    const showImage = block.data.showImage !== false;
    const showDate = block.data.showDate !== false;
    if (!entries.length) return html`<p class="my-4 text-sm text-muted-foreground">${__('Nothing published yet.')}</p>`;
    if (layout === 'titles') return html`<ul class="my-4 space-y-1.5">${entries.map(entry => html`<li class="flex items-baseline justify-between gap-3">
        <a href=${entry.url ?? '#'} class="text-primary hover:underline">${entry.title}</a>${showDate && entry.date ? html`<time class="shrink-0 text-xs text-muted-foreground">${entry.date}</time>` : null}</li>`)}</ul>`;
    if (layout === 'grid') {
        const columns = Math.min(Math.max(Number(block.data.columns) || 3, 1), 4);
        return html`<div class="cms-grid my-6" data-gap="medium" style=${`--cms-cols-lg: ${columns}; --cms-cols-md: ${Math.min(columns, 2)}; --cms-cols-sm: 1`}>
            ${entries.map(entry => html`<article class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
                ${showImage && entry.image ? html`<a href=${entry.url ?? '#'} class="block">${image(entry.image, 'aspect-[4/3] w-full object-cover', `(min-width: 1024px) ${Math.round(1024 / columns)}px, 100vw`)}</a>` : null}
                <div class="space-y-1.5 p-4">
                    <h3 class="text-base font-semibold"><a href=${entry.url ?? '#'} class="no-underline hover:text-primary">${entry.title}</a></h3>
                    ${showDate && entry.date ? html`<time class="block text-xs text-muted-foreground">${entry.date}</time>` : null}
                    ${entry.excerpt ? html`<p class="text-sm text-muted-foreground">${entry.excerpt}</p>` : null}
                </div>
            </article>`)}</div>`;
    }
    return html`<div class="my-6 space-y-6">${entries.map(entry => html`<article class="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        ${showImage && entry.image ? html`<a href=${entry.url ?? '#'} class="block overflow-hidden rounded-md">${image(entry.image, 'aspect-[4/3] w-full object-cover', '(min-width: 640px) 8rem, 100vw')}</a>` : showImage ? html`<span class="hidden sm:block"></span>` : null}
        <div class=${showImage ? 'space-y-1' : 'space-y-1 sm:col-span-2'}>
            <h3 class="text-lg font-semibold"><a href=${entry.url ?? '#'} class="no-underline hover:text-primary">${entry.title}</a></h3>
            ${showDate && entry.date ? html`<time class="block text-xs text-muted-foreground">${entry.date}${entry.authors.length ? ` · ${entry.authors.map(author => author.name).join(', ')}` : ''}</time>` : null}
            ${entry.excerpt ? html`<p class="text-sm leading-6 text-muted-foreground">${entry.excerpt}</p>` : null}
        </div>
    </article>`)}</div>`;
}

/** Columns' track spans out of twelve: a declared `span`, the rest shared equally. */
export function columnSpans(columns: readonly RenderedBlock[]): number[] {
    const declared = columns.map(column => Number.isInteger(column.data.span) ? Math.min(Math.max(column.data.span as number, 1), 12) : 0);
    const auto = declared.filter(span => !span).length;
    const share = auto ? Math.max(Math.floor((12 - declared.reduce((sum, span) => sum + span, 0)) / auto), 1) : 0;
    return declared.map(span => span || share);
}

/** A block of a core type, or of a plugin type through its `ui.ts` component. Unknown types render nothing. */
export function coreBlock(block: RenderedBlock, helpers: ThemeHelpers, state?: Pick<ThemeRenderState, 'site'>): TemplateResult | null {
    const text = (name: string) => typeof block.data[name] === 'string' ? block.data[name] as string : '';
    const children = block.children ?? [];
    switch (block.type) {
        // The site's logo (the block's own image, else Settings → General's) or its title, linked home.
        case 'core/site-logo': {
            const site = state?.site;
            if (!site) return null;
            const own = block.media[text('image')];
            const showTitle = block.data.showTitle === true || (!own && !site.logo);
            const picture = own ? image(own, 'cms-site-logo-image', '12rem') : site.logo ? html`<img src=${site.logo} alt=${showTitle ? '' : site.title} class="cms-site-logo-image">` : null;
            return html`<a href=${site.homeUrl} class="cms-site-logo" data-size=${text('size') || 'medium'} rel="home">${picture}
                ${showTitle || (block.data.showTagline === true && site.tagline) ? html`<span class="cms-site-logo-text">${showTitle ? html`<span class="cms-site-logo-title">${site.title}</span>` : null}
                    ${block.data.showTagline === true && site.tagline ? html`<span class="cms-site-logo-tagline">${site.tagline}</span>` : null}</span>` : null}</a>`;
        }
        case 'core/search': return helpers.search({ placeholder: text('placeholder'), style: text('style') });
        // Text with block references renders its runs and blocks; the HTML alone otherwise.
        case 'core/paragraph': return block.content?.text ? helpers.content(block.content.text) : html`<div class=${PROSE}>${unsafeHTML(block.html.text ?? '')}</div>`;
        case 'core/heading': {
            const level = text('level') || 'h2';
            return level === 'h3' ? html`<h3 class="mt-6 text-xl font-semibold">${text('text')}</h3>`
                : level === 'h4' ? html`<h4 class="mt-4 text-lg font-semibold">${text('text')}</h4>`
                : html`<h2 class="mt-8 text-2xl font-semibold">${text('text')}</h2>`;
        }
        case 'core/image': {
            const media = block.media[text('image')];
            const img = image(media, 'w-full rounded-lg');
            return html`<figure class="my-6">${text('link') ? html`<a href=${safeLink(text('link'))}>${img}</a>` : img}
                ${text('caption') || media?.caption ? html`<figcaption class="mt-2 text-center text-sm text-muted-foreground">${text('caption') || media?.caption}</figcaption>` : null}</figure>`;
        }
        case 'core/gallery': {
            const ids = Array.isArray(block.data.images) ? block.data.images as string[] : [];
            const columns = Math.min(Math.max(Number(block.data.columns) || 3, 1), 6);
            // Logos: whole images at one height, grey until hovered, as a wall of clients or partners.
            if (text('layout') === 'logos') return html`<div class="cms-logos my-6" style=${`--cms-logo-columns: ${columns}`}>${ids.map(id => block.media[id] ? html`<div class="cms-logo">${image(block.media[id], 'cms-logo-image', `${Math.round(100 / columns)}vw`)}</div>` : null)}</div>`;
            return html`<div class="my-6 grid gap-3" style=${`grid-template-columns: repeat(${columns}, minmax(0, 1fr))`}>
                ${ids.map(id => image(block.media[id], 'aspect-square w-full rounded-md object-cover', `(min-width: 768px) ${Math.round(768 / columns)}px, ${Math.round(100 / columns)}vw`))}</div>`;
        }
        case 'core/quote': return html`<blockquote class="my-6 border-l-4 border-primary pl-4">
            <p class="text-lg italic">${text('text')}</p>${text('citation') ? html`<cite class="mt-2 block text-sm not-italic text-muted-foreground">— ${text('citation')}</cite>` : null}</blockquote>`;
        case 'core/list': {
            const items = Array.isArray(block.data.items) ? block.data.items as string[] : [];
            return block.data.ordered === true ? html`<ol class="my-4 list-decimal space-y-1 pl-6">${items.map(item => html`<li>${item}</li>`)}</ol>`
                : html`<ul class="my-4 list-disc space-y-1 pl-6">${items.map(item => html`<li>${item}</li>`)}</ul>`;
        }
        // Saved only by people allowed to post HTML (`cms:html`), so it renders as written.
        case 'core/html': return html`${unsafeHTML(text('html'))}`;
        case 'core/code': return html`<pre class="my-4 overflow-x-auto rounded-md bg-muted p-4 text-sm"><code data-language=${text('language')}>${text('code')}</code></pre>`;
        case 'core/button': return html`<div class="cms-button my-6"><a href=${safeLink(text('url'))}
            class=${`inline-flex items-center rounded-md px-5 py-2.5 text-sm font-medium no-underline ${text('style') === 'outline' ? 'border border-border text-foreground hover:bg-muted' : 'bg-primary text-primary-foreground hover:opacity-90'}`}>${text('label')}</a></div>`;
        case 'core/embed': {
            const src = embedUrl(text('url'));
            return src ? html`<figure class="my-6"><div class="aspect-video overflow-hidden rounded-lg bg-muted">
                <iframe src=${src} title=${text('caption') || 'Video'} class="h-full w-full" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
                ${text('caption') ? html`<figcaption class="mt-2 text-center text-sm text-muted-foreground">${text('caption')}</figcaption>` : null}</figure>` : null;
        }
        case 'core/video': {
            const media = block.media[text('video')];
            if (!media) return null;
            const poster = block.media[text('poster')];
            const captions = block.media[text('captions')];
            const autoplay = block.data.autoplay === true;
            return html`<figure class="my-6"><video src=${media.url} class="w-full rounded-lg bg-black" poster=${ifDefined(poster?.url)} preload=${preloadOf(text('preload'))}
                    ?controls=${block.data.controls !== false} ?autoplay=${autoplay} ?loop=${block.data.loop === true} ?muted=${autoplay || block.data.muted === true} ?playsinline=${autoplay}
                    width=${ifDefined(media.width ?? undefined)} height=${ifDefined(media.height ?? undefined)}>
                    ${captions ? html`<track kind="captions" src=${captions.url} default>` : null}
                    <a href=${media.url}>${text('caption') || media.caption || 'Download the video'}</a></video>
                ${text('caption') || media.caption ? html`<figcaption class="mt-2 text-center text-sm text-muted-foreground">${text('caption') || media.caption}</figcaption>` : null}</figure>`;
        }
        case 'core/audio': {
            const media = block.media[text('audio')];
            if (!media) return null;
            return html`<figure class="my-6"><audio src=${media.url} class="w-full" controls preload=${preloadOf(text('preload'))} ?autoplay=${block.data.autoplay === true} ?loop=${block.data.loop === true}>
                    <a href=${media.url}>${text('caption') || media.caption || 'Download the audio'}</a></audio>
                ${text('caption') || media.caption ? html`<figcaption class="mt-2 text-center text-sm text-muted-foreground">${text('caption') || media.caption}</figcaption>` : null}</figure>`;
        }
        case 'core/richtext': return helpers.content(block.content?.text ?? []);
        case 'core/divider': {
            const vertical = text('orientation') === 'vertical';
            const style = `--cms-divider-color: ${dividerColor(text('color'))}`;
            if (vertical) return html`<div class="cms-divider cms-divider-vertical" data-thickness=${text('thickness') || 'thin'} data-width=${text('width') || 'full'} style=${style} role="separator" aria-orientation="vertical"></div>`;
            return text('text')
                ? html`<div class="cms-divider cms-divider-text" data-thickness=${text('thickness') || 'thin'} data-width=${text('width') || 'full'} style=${style} role="separator"><span>${text('text')}</span></div>`
                : html`<hr class="cms-divider" data-thickness=${text('thickness') || 'thin'} data-width=${text('width') || 'full'} style=${style}>`;
        }
        case 'core/card': {
            const media = block.media[text('image')];
            const url = text('url');
            const title = text('title');
            const picture = media ? image(media, 'h-full w-full object-cover') : null;
            const framed = picture ? html`<div class="cms-card-media">${url && !text('linkLabel') ? html`<a href=${safeLink(url)}>${picture}</a>` : picture}</div>` : null;
            // An icon stands in for the image: the icon box and the feature of page builders.
            const glyph = !media && text('icon') ? siteIcon(text('icon'), { class: 'size-8' }) : null;
            return html`<div class="cms-card" data-layout=${media ? text('layout') || 'top' : 'none'} data-style=${text('style') === 'plain' ? 'plain' : 'boxed'}>
                ${framed}
                <div class="cms-card-body">
                    ${glyph ? html`<div class="cms-card-icon">${glyph}</div>` : null}
                    ${title ? html`<h3 class="text-lg font-semibold">${url && !text('linkLabel') ? html`<a href=${safeLink(url)} class="no-underline hover:text-primary">${title}</a>` : title}</h3>` : null}
                    ${block.html.text ? html`<div class=${`${PROSE} text-sm [&_p]:my-2`}>${unsafeHTML(block.html.text)}</div>` : null}
                    ${url && text('linkLabel') ? html`<p class="mt-3"><a href=${safeLink(url)} class="text-sm font-medium text-primary hover:underline">${text('linkLabel')} →</a></p>` : null}
                </div>
            </div>`;
        }
        case 'core/carousel': {
            // Slides of blocks when the carousel holds any, else its images.
            const slides = children.filter(child => child.type === 'core/slide');
            const ids = slides.length ? [] : Array.isArray(block.data.images) ? (block.data.images as string[]).filter(id => block.media[id]) : [];
            const count = slides.length || ids.length;
            if (!count) return null;
            const captions = block.data.captions !== false;
            const items = slides.length
                ? slides.map((slide, index) => html`<div class="cms-carousel-slide cms-carousel-blockslide" id=${`${block._id}-slide-${index + 1}`} aria-roledescription="slide" aria-label=${`${index + 1} / ${count}`}>${helpers.block(slide)}</div>`)
                : ids.map((id, index) => html`<figure class="cms-carousel-slide" id=${`${block._id}-slide-${index + 1}`} aria-roledescription="slide" aria-label=${`${index + 1} / ${count}`}>
                    ${image(block.media[id], 'cms-carousel-image', '(min-width: 1024px) 1024px, 100vw')}
                    ${captions && block.media[id]?.caption ? html`<figcaption class="cms-carousel-caption">${block.media[id]!.caption}</figcaption>` : null}
                </figure>`);
            return html`<div class="cms-carousel my-6" data-aspect=${text('aspect') || 'video'} data-autoplay=${block.data.autoplay === true ? 'true' : 'false'} data-interval=${String(Math.min(Math.max(Number(block.data.interval) || 5, 2), 30))}
                role="region" aria-roledescription="carousel" aria-label=${slides.length ? __('Slides') : __('Image carousel')} ref=${enhanceCarousel}>
                <div class="cms-carousel-track" tabindex="0">${items}</div>
                ${count > 1 ? html`<button type="button" class="cms-carousel-arrow cms-carousel-prev" data-direction="-1" aria-label=${__('Previous')}>‹</button>
                    <button type="button" class="cms-carousel-arrow cms-carousel-next" data-direction="1" aria-label=${__('Next')}>›</button>
                    <div class="cms-carousel-dots" role="tablist">${Array.from({ length: count }, (_, index) => html`<button type="button" role="tab" aria-label=${`${__('Slide')} ${index + 1}`} aria-selected=${index === 0 ? 'true' : 'false'} data-index=${String(index)}></button>`)}</div>` : null}
            </div>`;
        }
        case 'core/slide': return html`<div class="cms-slide" data-valign=${text('valign') || 'center'}>${children.map(child => helpers.block(child))}</div>`;
        case 'core/answer': return html`<aside class="cms-answer my-6 rounded-lg border border-border bg-muted/40 p-4" aria-label=${text('label') || __('Quick answer')}>
            ${text('label') ? html`<p class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">${text('label')}</p>` : null}
            <div class=${`${PROSE} text-lg [&_p]:my-2`}>${block.content?.text ? helpers.content(block.content.text) : unsafeHTML(block.html.text ?? '')}</div></aside>`;
        case 'core/faq': return html`<section class="cms-faq my-8 divide-y divide-border border-y border-border">${children.map(child => helpers.block(child))}</section>`;
        case 'core/faq-item': return html`<details class="cms-faq-item group py-3" open>
            <summary class="cursor-pointer list-none text-lg font-semibold"><h3 class="inline">${text('question')}</h3></summary>
            <div class=${`${PROSE} mt-2 [&_p]:my-2`}>${unsafeHTML(block.html.answer ?? '')}</div></details>`;
        case 'core/steps': return html`<ol class="cms-steps my-8 space-y-6 border-l-2 border-border pl-6">${children.map((child, index) => html`<li class="relative" data-step=${String(index + 1)}>
            <span class="absolute -left-[2.1rem] flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden="true">${index + 1}</span>${helpers.block(child)}</li>`)}</ol>`;
        case 'core/step': return html`<div class="cms-step"><h3 class="text-lg font-semibold">${text('title')}</h3>${block.html.text ? html`<div class=${`${PROSE} [&_p]:my-2`}>${unsafeHTML(block.html.text)}</div>` : null}</div>`;
        case 'core/claim': {
            const source = text('sourceUrl') ? html`<a href=${safeLink(text('sourceUrl'))} rel="noopener" class="text-primary hover:underline">${text('sourceName')}</a>` : text('sourceName');
            return html`<figure class="cms-claim my-6 rounded-lg border-l-4 border-primary bg-muted/40 p-4">
                <blockquote class=${text('kind') === 'quote' ? 'text-lg italic' : 'text-2xl font-semibold'}>${text('text')}</blockquote>
                <figcaption class="mt-2 text-sm text-muted-foreground">${__('Source')}: <cite class="not-italic">${source}</cite>${text('date') ? html`, ${text('date')}` : null}</figcaption></figure>`;
        }
        case 'core/definition': return html`<dl class="cms-definition my-6 rounded-lg border border-border p-4"><dt class="text-lg font-semibold">${text('term')}</dt><dd class=${`${PROSE} mt-1 [&_p]:my-1`}>${unsafeHTML(block.html.definition ?? '')}</dd></dl>`;
        case 'core/latest-entries': return latestEntries(block);
        case 'core/languages': return helpers.languages({ style: text('style'), layout: text('layout') });
        case 'core/navigation': return helpers.menu(text('location') || 'primary', { style: text('style'), motion: text('motion'), mobile: text('mobile') || undefined, collapse: text('collapse') });
        case 'core/meta': return null;
        // Section blocks: the leaf widgets of page builders, placed in columns and grids.
        case 'core/spacer': return html`<div class="cms-spacer" data-size=${text('size') || 'medium'} aria-hidden="true"></div>`;
        case 'core/tabs': {
            const tabs = children.filter(child => child.type === 'core/tab');
            if (!tabs.length) return null;
            // The first panel is active before any script runs; without scripting every panel shows under its title (cms/blocks.css).
            return html`<div class="cms-tabs my-6" ref=${enhanceTabs}>
                <div class="cms-tablist" role="tablist">${tabs.map((tab, index) => html`<button type="button" role="tab" class="cms-tab" id=${`${block._id}-tab-${index + 1}`} aria-controls=${`${block._id}-panel-${index + 1}`} aria-selected=${index === 0 ? 'true' : 'false'} tabindex=${index === 0 ? 0 : -1}>${siteIcon(typeof tab.data.icon === 'string' ? tab.data.icon : '', { class: 'size-4' })}<span>${typeof tab.data.label === 'string' ? tab.data.label : ''}</span></button>`)}</div>
                ${tabs.map((tab, index) => html`<section class="cms-tabpanel" role="tabpanel" id=${`${block._id}-panel-${index + 1}`} aria-labelledby=${`${block._id}-tab-${index + 1}`} data-active=${ifDefined(index === 0 ? '' : undefined)} tabindex="0">
                    <h3 class="cms-tabpanel-title">${typeof tab.data.label === 'string' ? tab.data.label : ''}</h3>${helpers.block(tab)}</section>`)}
            </div>`;
        }
        case 'core/tab': return html`<div class="cms-tab-content">${children.map(child => helpers.block(child))}</div>`;
        case 'core/accordion': return html`<div class="cms-accordion my-6" id=${`${block._id}-accordion`} data-single=${block.data.single === true ? 'true' : 'false'} ref=${enhanceAccordion}>${children.map(child => helpers.block(child))}</div>`;
        case 'core/accordion-item': return html`<details class="cms-accordion-item" ?open=${block.data.open === true}>
            <summary class="cms-accordion-summary">${text('label')}<span class="cms-accordion-caret" aria-hidden="true"></span></summary>
            <div class="cms-accordion-body">${children.map(child => helpers.block(child))}</div></details>`;
        case 'core/icon-list': return html`<ul class="cms-icon-list my-4" data-size=${text('size') || 'medium'} style=${`--cms-icon-columns: ${Math.min(Math.max(Number(block.data.columns) || 1, 1), 3)}`}>${children.map(child => helpers.block(child))}</ul>`;
        case 'core/icon-item': {
            const url = text('url');
            return html`<li class="cms-icon-item">${siteIcon(text('icon') || 'check-circle', { class: 'cms-icon-item-icon' }) ?? siteIcon('check-circle', { class: 'cms-icon-item-icon' })}${url ? html`<a href=${safeLink(url)}>${text('text')}</a>` : html`<span>${text('text')}</span>`}</li>`;
        }
        case 'core/testimonial': {
            const avatar = block.media[text('avatar')];
            const rating = Math.min(Math.max(Math.round(Number(block.data.rating) || 0), 0), 5);
            const url = text('url');
            return html`<figure class="cms-testimonial my-6">
                ${rating ? html`<div class="cms-rating" role="img" aria-label=${`${rating} / 5`}>${[1, 2, 3, 4, 5].map(star => html`<span class="cms-rating-star" data-filled=${star <= rating ? 'true' : 'false'}>★</span>`)}</div>` : null}
                <blockquote class="cms-testimonial-quote">${block.html.text ? html`<div class=${`${PROSE} [&_p]:my-1`}>${unsafeHTML(block.html.text)}</div>` : text('text')}</blockquote>
                <figcaption class="cms-testimonial-author">${avatar ? image(avatar, 'cms-testimonial-avatar', '48px') : null}
                    <div><div class="cms-testimonial-name">${url ? html`<a href=${safeLink(url)} rel="noopener">${text('name')}</a>` : text('name')}</div>${text('role') ? html`<div class="cms-testimonial-role">${text('role')}</div>` : null}</div></figcaption>
            </figure>`;
        }
        case 'core/stat': return html`<div class="cms-stat my-6" data-animate=${block.data.animate === false ? 'false' : 'true'} ref=${enhanceStat}>
            <p class="cms-stat-value">${text('prefix') ? html`<span class="cms-stat-prefix">${text('prefix')}</span>` : null}<span class="cms-stat-number" data-value=${text('value')}>${text('value')}</span>${text('suffix') ? html`<span class="cms-stat-suffix">${text('suffix')}</span>` : null}</p>
            ${text('label') ? html`<p class="cms-stat-label">${text('label')}</p>` : null}</div>`;
        case 'core/pricing': {
            const features = Array.isArray(block.data.features) ? (block.data.features as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : [];
            const url = text('buttonUrl');
            const label = text('buttonLabel');
            return html`<div class="cms-pricing my-6" data-highlighted=${block.data.highlighted === true ? 'true' : 'false'}>
                ${text('badge') ? html`<span class="cms-pricing-badge">${text('badge')}</span>` : null}
                <h3 class="cms-pricing-name">${text('name')}</h3>
                <p class="cms-pricing-price"><span class="cms-pricing-amount">${text('price')}</span>${text('period') ? html` <span class="cms-pricing-period">${text('period')}</span>` : null}</p>
                ${text('description') ? html`<p class="cms-pricing-description">${text('description')}</p>` : null}
                ${features.length ? html`<ul class="cms-pricing-features">${features.map(feature => html`<li>${siteIcon('check-circle', { class: 'size-4' })}<span>${feature}</span></li>`)}</ul>` : null}
                ${url && label ? html`<p class="cms-pricing-action"><a href=${safeLink(url)} class=${`inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium no-underline ${block.data.highlighted === true ? 'bg-primary text-primary-foreground hover:opacity-90' : 'border border-border text-foreground hover:bg-muted'}`}>${label}</a></p>` : null}
            </div>`;
        }
        case 'core/social-links': {
            const links = Array.isArray(block.data.links) ? (block.data.links as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : [];
            if (!links.length) return null;
            const labels = block.data.labels === true;
            return html`<ul class="cms-social my-4" data-size=${text('size') || 'medium'} data-shape=${text('shape') || 'round'} data-labels=${labels ? 'true' : 'false'}>${links.map(url => {
                const brand = block.icons?.[url];
                const title = brand?.title ?? socialTitle(url);
                const glyph = brand ? html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="cms-social-icon" aria-hidden="true" focusable="false"><path d=${brand.path}></path></svg>`
                    : siteIcon(url.startsWith('mailto:') ? 'letter' : url.startsWith('tel:') ? 'phone' : 'link', { class: 'cms-social-icon' });
                const external = /^https?:/.test(url);
                return html`<li><a class="cms-social-link" href=${safeLink(url)} style=${ifDefined(brand ? `--cms-brand: #${brand.hex}` : undefined)} title=${title} aria-label=${ifDefined(labels ? undefined : title)}
                    rel=${ifDefined(external ? 'me noopener' : undefined)} target=${ifDefined(external ? '_blank' : undefined)}>${glyph}${labels ? html`<span class="cms-social-label">${title}</span>` : null}</a></li>`;
            })}</ul>`;
        }
        case 'core/map': {
            // An address is looked up by Google Maps; an embed URL is shown as given, checked again here before it reaches an iframe.
            const address = text('address').trim();
            const given = text('url').trim();
            const zoom = Math.min(Math.max(Math.round(Number(block.data.zoom) || 14), 1), 20);
            const src = address ? `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&output=embed` : MAP_EMBED_URL.test(given) ? given : '';
            if (!src) return null;
            const caption = text('caption');
            return html`<figure class="cms-map my-6" data-height=${text('height') || 'medium'}>
                <iframe class="cms-map-frame" src=${src} title=${caption || address || __('Map')} loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
                ${caption ? html`<figcaption class="cms-map-caption">${caption}</figcaption>` : null}
            </figure>`;
        }
        // Layout blocks: CSS grid from cms/blocks.css, responding to the content root's width.
        case 'core/notice': {
            const kind = ['success', 'warning', 'danger'].includes(text('kind')) ? text('kind') : 'info';
            const glyph = block.data.showIcon === false ? null : siteIcon(({ info: 'info-circle', success: 'check-circle', warning: 'danger-triangle', danger: 'close-circle' } as Record<string, string>)[kind]!, { class: 'cms-notice-icon' });
            return html`<aside class="cms-notice my-6" data-kind=${kind} role="note">${glyph}<div class="cms-notice-body">${text('title') ? html`<p class="cms-notice-title">${text('title')}</p>` : null}${block.html.text ? html`<div class=${`${PROSE} text-sm [&_p]:my-1`}>${unsafeHTML(block.html.text)}</div>` : text('text')}</div></aside>`;
        }
        case 'core/countdown': {
            // The server writes the first values; countdown.client.ts keeps them ticking and shows the end.
            const until = Number(block.data.until);
            if (!Number.isFinite(until) || until <= 0) return null;
            const left = Math.max(0, Math.floor((until - Date.now()) / 1000));
            const seconds = block.data.seconds !== false;
            const units: [string, number, string][] = [['days', Math.floor(left / 86_400), __('Days')], ['hours', Math.floor((left % 86_400) / 3600), __('Hours')], ['minutes', Math.floor((left % 3600) / 60), __('Minutes')], ...(seconds ? [['seconds', left % 60, __('Seconds')] as [string, number, string]] : [])];
            const over = left <= 0;
            return html`<div class="cms-countdown my-6" data-until=${String(until)} ref=${enhanceCountdown}>
                ${text('label') ? html`<p class="cms-countdown-label">${text('label')}</p>` : null}
                <div class="cms-countdown-units" ?hidden=${over}>${units.map(([unit, value, name]) => html`<div class="cms-countdown-unit"><span class="cms-countdown-value" data-unit=${unit}>${unit === 'days' ? String(value) : String(value).padStart(2, '0')}</span><span class="cms-countdown-name">${name}</span></div>`)}</div>
                <p class="cms-countdown-done" ?hidden=${!over}>${text('done')}</p>
            </div>`;
        }
        case 'core/toc': {
            const deepest = ({ h2: 2, h3: 3, h4: 4 } as Record<string, number>)[text('depth')] ?? 3;
            const headings = (block.headings ?? []).filter(heading => heading.level <= deepest);
            if (!headings.length) return null;
            const title = text('title');
            const items = headings.map(heading => html`<li class="cms-toc-item" data-level=${String(heading.level)}><a href=${`#${heading.id}`}>${heading.text}</a></li>`);
            return html`<nav class="cms-toc my-6" aria-labelledby=${ifDefined(title ? `${block._id}-title` : undefined)} aria-label=${ifDefined(title ? undefined : __('Table of contents'))}>
                ${title ? html`<p class="cms-toc-title" id=${`${block._id}-title`}>${title}</p>` : null}
                ${block.data.numbered === true ? html`<ol class="cms-toc-list">${items}</ol>` : html`<ul class="cms-toc-list">${items}</ul>`}</nav>`;
        }
        case 'core/share': {
            const chosen = (Array.isArray(block.data.networks) ? block.data.networks as unknown[] : []).filter((entry): entry is ShareNetwork => (SHARE_NETWORKS as readonly string[]).includes(entry as string));
            const url = state?.site?.url ?? '';
            if (!chosen.length) return null;
            const crumbs = state?.site?.breadcrumbs ?? [];
            const title = crumbs.at(-1)?.label || state?.site?.title || '';
            const labels = text('style') === 'labels';
            const glyph = (network: ShareNetwork) => {
                const brand = block.icons?.[network];
                if (brand) return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="cms-share-icon" aria-hidden="true" focusable="false"><path d=${brand.path}></path></svg>`;
                return siteIcon(network === 'email' ? 'letter' : network === 'copy' ? 'link' : 'share', { class: 'cms-share-icon' });
            };
            return html`<div class="cms-share my-6" data-style=${labels ? 'labels' : 'icons'} ref=${enhanceShare}>
                ${text('label') ? html`<span class="cms-share-label">${text('label')}</span>` : null}
                <ul class="cms-share-list">${chosen.map(network => {
                    const name = block.icons?.[network]?.title ?? (network === 'email' ? __('Email') : network === 'copy' ? __('Copy link') : SHARE_NAMES[network]);
                    const target = shareUrl(network, url, title);
                    const brand = block.icons?.[network];
                    const inner = html`${glyph(network)}${labels ? html`<span class="cms-share-name">${name}</span>` : null}`;
                    return html`<li>${target === null
                        ? html`<button type="button" class="cms-share-link" data-network="copy" data-url=${url} title=${name} aria-label=${ifDefined(labels ? undefined : name)}>${inner}<span class="cms-share-copied" aria-live="polite">${__('Copied')}</span></button>`
                        : html`<a class="cms-share-link" href=${target} data-network=${network} style=${ifDefined(brand ? `--cms-brand: #${brand.hex}` : undefined)} title=${name} aria-label=${ifDefined(labels ? undefined : name)}
                            rel=${ifDefined(network === 'email' ? undefined : 'noopener')} target=${ifDefined(network === 'email' ? undefined : '_blank')}>${inner}</a>`}</li>`;
                })}</ul>
            </div>`;
        }
        case 'core/breadcrumbs': return breadcrumbTrail(state?.site?.breadcrumbs, { separator: text('separator'), home: block.data.home !== false });
        case 'core/group': {
            // A full-width stack keeps its children at the content measure, as the page's layout does; a full row lays its row within it (cms/blocks.css).
            const align = alignOf(block);
            const direction = text('direction') || 'column';
            const height = text('height');
            const valign = text('valign');
            const inner = align === 'full' && direction !== 'row' ? children.map(child => layoutItem(child, helpers)) : children.map(child => helpers.block(child));
            return html`<div class="cms-group" data-align=${align} data-direction=${direction} data-justify=${text('justify') || 'start'}
                data-height=${ifDefined(height && height !== 'auto' ? height : undefined)} data-valign=${ifDefined(valign && valign !== 'top' ? valign : undefined)}>${inner}</div>`;
        }
        case 'core/columns': {
            const spans = columnSpans(children);
            return html`<div class="cms-columns" data-gap=${text('gap') || 'medium'} data-stack=${text('stack') || 'mobile'}>${children.map((column, index) => helpers.block({ ...column, data: { ...column.data, span: spans[index] } }))}</div>`;
        }
        case 'core/column': return html`<div class="cms-column" data-valign=${text('verticalAlign') || 'top'} style=${`--cms-span: ${columnSpan(block)}`}>${children.map(child => helpers.block(child))}</div>`;
        case 'core/grid': {
            const count = (name: string, fallback: number) => Math.min(Math.max(Number(block.data[name]) || fallback, 1), 6);
            return html`<div class="cms-grid" data-gap=${text('gap') || 'medium'} style=${`--cms-cols-lg: ${count('columns', 3)}; --cms-cols-md: ${count('columnsMd', 2)}; --cms-cols-sm: ${count('columnsSm', 1)}`}>
                ${children.map(child => html`<div class="min-w-0">${helpers.block(child)}</div>`)}</div>`;
        }
        case 'core/form': return formBlock(block, helpers);
        default: {
            if (block.type.startsWith('form/')) return inputBlock(block, helpers);
            const plugin = plugins.find(entry => block.type.startsWith(`${entry.name}/`));
            const blocks = (plugin?.ui as { blocks?: Record<string, unknown> } | null | undefined)?.blocks;
            const view = blocks?.[block.type.slice(block.type.indexOf('/') + 1)] ?? blocks?.[block.type];
            return view ? component(view as never, { block, helpers }) : null;
        }
    }
}

/** Shown in the theme's layout before setup and while content migrates. */
export function unavailable(): TemplateResult {
    return html`<section class="space-y-2 py-16 text-center">
        <h1 class="text-2xl font-bold text-foreground">${__('This site is being set up')}</h1>
        <p class="text-muted-foreground">${__('Please come back soon.')}</p>
    </section>`;
}

const list = (view: ArchiveView) => html`<section>
    <h1>${view.title}</h1>
    ${view.entries.length ? html`<ul>${view.entries.map(entry => html`<li><a href=${entry.url ?? '#'}>${entry.title}</a> ${entry.date}</li>`)}</ul>` : html`<p>${__('Nothing here yet.')}</p>`}
    ${view.paging.page < view.paging.pages ? html`<a href=${`${view.paging.base}?page=${view.paging.page + 1}`}>${__('Older')}</a>` : null}
</section>`;

/** Plain templates for a site without a usable theme. Activate a theme under Appearance. */
export const fallbackTheme: SiteTheme = {
    layout: (site, content, helpers) => html`<div class="mx-auto max-w-3xl px-6 py-8 text-foreground">
        <header><a href=${site.homeUrl}><strong>${site.title}</strong></a> ${site.tagline}${helpers.menu('primary', { style: 'list', label: __('Site') })}
            ${site.languages.length > 1 ? html`<nav aria-label=${__('Language')}>${site.languages.map(language => html`<a href=${language.url} hreflang=${language.code}>${language.label}</a> `)}</nav>` : null}</header>
        <main>${content}</main>
    </div>`,
    entry: (entry: EntryView, helpers) => html`<article><h1>${entry.title}</h1><p>${entry.date}</p>${helpers.block(entry.content)}
        ${entry.comments ? html`<section id="comments"><h2>${__('Comments')}</h2>${entry.comments.items.map(item => html`<div id=${`comment-${item.id}`}><strong>${item.author}</strong> ${item.date}${unsafeHTML(item.html)}</div>`)}
            ${entry.comments.form && !entry.comments.form.requireSignIn ? html`<form method="post" action=${entry.comments.form.action}><input type="hidden" name="collection" value=${entry.comments.form.collection}>
                <input type="hidden" name="entry" value=${entry.comments.form.entry}><textarea name="content" required aria-label=${__('Comment')}></textarea>
                ${entry.comments.form.userName ? null : html`<input name="authorName" aria-label=${__('Name')} placeholder=${__('Name')}><input name="authorEmail" type="email" aria-label=${__('Email')} placeholder=${__('Email')}>`}
                <button type="submit">${__('Post comment')}</button></form>` : null}</section>` : null}</article>`,
    archive: list,
    notFound: () => html`<section><h1>${__('Page not found')}</h1><a href="/">${__('Go to the home page')}</a></section>`,
};
