/**
 * The public site's rendering: the active theme's templates, the helpers they receive, and
 * the core block renderers themes can replace. Client-safe; views arrive from the server with
 * Markdown and rich text already rendered to escaped HTML.
 */
import { component, html, ifDefined, unsafeHTML, type TemplateResult } from '@cossackframework/renderer';
import { plugins } from '@cossackframework/framework/plugins';
import { formBlock, inputBlock } from './form-view';
import { archiveTemplate, assembleSiteTheme, blockStyleAttributes, entryTemplate, presetStyle, resolvePresets, siteThemeProblems, type ArchiveView, type EntryView, type MediaView, type MenuItemView, type RenderedBlock, type SiteTheme, type ThemeData, type ThemeHelpers, type ThemePresets } from '@cossackframework/cms';

export { archiveTemplate, entryTemplate };
export type { ArchiveView, EntryView, MediaView, Paging, RenderedBlock, SiteView } from '@cossackframework/cms';

/** Prose styles for rendered bodies. */
export const PROSE = 'cms-prose max-w-none text-foreground leading-7 [&_a]:text-primary [&_a]:underline [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li_p]:my-1 [&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_img]:my-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_hr]:my-8 [&_table]:my-4 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_td]:border [&_td]:border-border [&_td]:px-2';

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
        isActive: url => {
            const path = url.replace(/[?#].*$/, '').replace(/(.)\/$/, '$1');
            if (!path.startsWith('/')) return false;
            return path === '/' ? isActive('/', true) : isActive(path, true) || isActive(`${path}/`, false);
        },
        block: input => {
            const list: readonly RenderedBlock[] = Array.isArray(input) ? input as readonly RenderedBlock[] : [input as RenderedBlock];
            return html`${list.map(block => state.editing ? marked(block) : render(block))}`;
        },
        content: parts => html`${parts.map(part => part.kind === 'html' ? html`<div class=${PROSE}>${unsafeHTML(part.html)}</div>` : render(part.block))}`,
    };
    // In edit mode a block carries its ID; a field's rich text is one document, edited as a whole in the field's panel.
    const marked = (block: RenderedBlock) => block.field
        ? html`<div data-cms-edit="body" data-field=${block.field} style="display: contents">${render(block)}</div>`
        : html`<div data-cms-edit="block" data-block-id=${block.id} style="display: contents">${render(block)}</div>`;
    const render = (block: RenderedBlock) => {
        // Data blocks hold values for themes and the API; nothing shows for them.
        if (block.dataOnly) return null;
        const rendered = theme.blocks?.[block.type]?.(block, helpers) ?? coreBlock(block, helpers);
        // A styled block gets one wrapper: classes per property and the presets' variables inline.
        // A column's wrapper takes its grid placement, as cms/blocks.css places `.cms-column-box`.
        const attributes = blockStyleAttributes(block);
        const column = block.type === 'core/column';
        const styled = attributes ? html`<div class=${column ? `${attributes.className} cms-column-box` : attributes.className} id=${ifDefined(attributes.id || undefined)}
            style=${ifDefined([attributes.style, column ? `--cms-span: ${columnSpan(block)}` : ''].filter(Boolean).join('; ') || undefined)}>${rendered}</div>` : rendered;
        // A hidden block stays in the HTML; the stylesheet drops it at those container widths.
        const hide = block.layout?.hide ?? [];
        const sized = hide.length ? html`<div data-hide=${hide.join(' ')} style="display: contents">${styled}</div>` : styled;
        // In a form, a block with a condition shows or hides as the form's values change.
        return block.when ? html`<div data-cms-when=${block.id} ?data-hidden=${block.shown === false} style="display: contents">${sized}</div>` : sized;
    };
    return helpers;
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

/** An image with its resized variants, for blocks; `sizes` is how wide it shows. */
export function image(media: MediaView | undefined, className = '', sizes = '(min-width: 768px) 768px, 100vw'): TemplateResult | null {
    if (!media) return null;
    return html`<img src=${media.url} srcset=${ifDefined(media.srcset || undefined)} sizes=${ifDefined(media.srcset ? sizes : undefined)} alt=${media.alt}
        width=${media.width ?? ''} height=${media.height ?? ''} loading="lazy" decoding="async" class=${className}>`;
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

/** A divider's colour: a palette slug as its variable, else the CSS colour given, else the border colour. */
function dividerColor(value: string): string {
    if (!value) return 'var(--border)';
    return /^[a-z][a-z0-9-]*$/.test(value) && !/^(?:red|blue|green|black|white|gray|grey|transparent|currentcolor)$/.test(value) ? `var(--cms-color-${value}, ${value})` : value;
}

/** The carousel's browser part: arrows, dots and autoplay over a scroll-snapping track. Swiping works without it. */
function enhanceCarousel(element: Element | undefined): void {
    if (!element || typeof window === 'undefined') return;
    void import('./carousel.client').then(module => module.enhanceCarousel(element as HTMLElement)).catch(() => undefined);
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
                    <h3 class="text-base font-semibold"><a href=${entry.url ?? '#'} class="text-foreground no-underline hover:text-primary">${entry.title}</a></h3>
                    ${showDate && entry.date ? html`<time class="block text-xs text-muted-foreground">${entry.date}</time>` : null}
                    ${entry.excerpt ? html`<p class="text-sm text-muted-foreground">${entry.excerpt}</p>` : null}
                </div>
            </article>`)}</div>`;
    }
    return html`<div class="my-6 space-y-6">${entries.map(entry => html`<article class="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        ${showImage && entry.image ? html`<a href=${entry.url ?? '#'} class="block overflow-hidden rounded-md">${image(entry.image, 'aspect-[4/3] w-full object-cover', '(min-width: 640px) 8rem, 100vw')}</a>` : showImage ? html`<span class="hidden sm:block"></span>` : null}
        <div class=${showImage ? 'space-y-1' : 'space-y-1 sm:col-span-2'}>
            <h3 class="text-lg font-semibold"><a href=${entry.url ?? '#'} class="text-foreground no-underline hover:text-primary">${entry.title}</a></h3>
            ${showDate && entry.date ? html`<time class="block text-xs text-muted-foreground">${entry.date}${entry.author ? ` · ${entry.author}` : ''}</time>` : null}
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
export function coreBlock(block: RenderedBlock, helpers: ThemeHelpers): TemplateResult | null {
    const text = (name: string) => typeof block.data[name] === 'string' ? block.data[name] as string : '';
    const children = block.children ?? [];
    switch (block.type) {
        case 'core/paragraph': return html`<div class=${PROSE}>${unsafeHTML(block.html.text ?? '')}</div>`;
        case 'core/heading': {
            const level = text('level') || 'h2';
            return level === 'h3' ? html`<h3 class="mt-6 text-xl font-semibold text-foreground">${text('text')}</h3>`
                : level === 'h4' ? html`<h4 class="mt-4 text-lg font-semibold text-foreground">${text('text')}</h4>`
                : html`<h2 class="mt-8 text-2xl font-semibold text-foreground">${text('text')}</h2>`;
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
            return html`<div class="my-6 grid gap-3" style=${`grid-template-columns: repeat(${columns}, minmax(0, 1fr))`}>
                ${ids.map(id => image(block.media[id], 'aspect-square w-full rounded-md object-cover', `(min-width: 768px) ${Math.round(768 / columns)}px, ${Math.round(100 / columns)}vw`))}</div>`;
        }
        case 'core/quote': return html`<blockquote class="my-6 border-l-4 border-primary pl-4">
            <p class="text-lg italic text-foreground">${text('text')}</p>${text('citation') ? html`<cite class="mt-2 block text-sm not-italic text-muted-foreground">— ${text('citation')}</cite>` : null}</blockquote>`;
        case 'core/list': {
            const items = Array.isArray(block.data.items) ? block.data.items as string[] : [];
            return block.data.ordered === true ? html`<ol class="my-4 list-decimal space-y-1 pl-6">${items.map(item => html`<li>${item}</li>`)}</ol>`
                : html`<ul class="my-4 list-disc space-y-1 pl-6">${items.map(item => html`<li>${item}</li>`)}</ul>`;
        }
        case 'core/code': return html`<pre class="my-4 overflow-x-auto rounded-md bg-muted p-4 text-sm"><code data-language=${text('language')}>${text('code')}</code></pre>`;
        case 'core/button': return html`<p class="my-6"><a href=${safeLink(text('url'))}
            class=${`inline-flex items-center rounded-md px-5 py-2.5 text-sm font-medium no-underline ${text('style') === 'outline' ? 'border border-border text-foreground hover:bg-muted' : 'bg-primary text-primary-foreground hover:opacity-90'}`}>${text('label')}</a></p>`;
        case 'core/embed': {
            const src = embedUrl(text('url'));
            return src ? html`<figure class="my-6"><div class="aspect-video overflow-hidden rounded-lg bg-muted">
                <iframe src=${src} title=${text('caption') || 'Video'} class="h-full w-full" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
                ${text('caption') ? html`<figcaption class="mt-2 text-center text-sm text-muted-foreground">${text('caption')}</figcaption>` : null}</figure>` : null;
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
            return html`<div class="cms-card" data-layout=${media ? text('layout') || 'top' : 'none'}>
                ${framed}
                <div class="cms-card-body">
                    ${title ? html`<h3 class="text-lg font-semibold text-foreground">${url && !text('linkLabel') ? html`<a href=${safeLink(url)} class="no-underline hover:text-primary">${title}</a>` : title}</h3>` : null}
                    ${block.html.text ? html`<div class=${`${PROSE} text-sm [&_p]:my-2`}>${unsafeHTML(block.html.text)}</div>` : null}
                    ${url && text('linkLabel') ? html`<p class="mt-3"><a href=${safeLink(url)} class="text-sm font-medium text-primary hover:underline">${text('linkLabel')} →</a></p>` : null}
                </div>
            </div>`;
        }
        case 'core/carousel': {
            const ids = Array.isArray(block.data.images) ? (block.data.images as string[]).filter(id => block.media[id]) : [];
            if (!ids.length) return null;
            const captions = block.data.captions !== false;
            return html`<div class="cms-carousel my-6" data-aspect=${text('aspect') || 'video'} data-autoplay=${block.data.autoplay === true ? 'true' : 'false'} data-interval=${String(Math.min(Math.max(Number(block.data.interval) || 5, 2), 30))}
                role="region" aria-roledescription="carousel" aria-label=${__('Image carousel')} ref=${enhanceCarousel}>
                <div class="cms-carousel-track" tabindex="0">${ids.map((id, index) => html`<figure class="cms-carousel-slide" id=${`${block.id}-slide-${index + 1}`} aria-roledescription="slide" aria-label=${`${index + 1} / ${ids.length}`}>
                    ${image(block.media[id], 'cms-carousel-image', '(min-width: 1024px) 1024px, 100vw')}
                    ${captions && block.media[id]?.caption ? html`<figcaption class="cms-carousel-caption">${block.media[id]!.caption}</figcaption>` : null}
                </figure>`)}</div>
                ${ids.length > 1 ? html`<button type="button" class="cms-carousel-arrow cms-carousel-prev" data-direction="-1" aria-label=${__('Previous image')}>‹</button>
                    <button type="button" class="cms-carousel-arrow cms-carousel-next" data-direction="1" aria-label=${__('Next image')}>›</button>
                    <div class="cms-carousel-dots" role="tablist">${ids.map((_, index) => html`<button type="button" role="tab" aria-label=${`${__('Image')} ${index + 1}`} aria-selected=${index === 0 ? 'true' : 'false'} data-index=${String(index)}></button>`)}</div>` : null}
            </div>`;
        }
        case 'core/latest-entries': return latestEntries(block);
        case 'core/meta': return null;
        // Layout blocks: CSS grid from cms/blocks.css, responding to the content root's width.
        case 'core/group': return html`<div class="cms-group" data-align=${text('align') || 'full'}>${children.map(child => helpers.block(child))}</div>`;
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
            if (block.type.startsWith('form/')) return inputBlock(block);
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

function menuList(items: readonly MenuItemView[]): TemplateResult {
    return html`<ul>${items.map(item => html`<li><a href=${item.url} target=${item.newTab ? '_blank' : ''} rel=${item.newTab ? 'noopener' : ''}>${item.label}</a>${item.children.length ? menuList(item.children) : null}</li>`)}</ul>`;
}

const list = (view: ArchiveView) => html`<section>
    <h1>${view.title}</h1>
    ${view.entries.length ? html`<ul>${view.entries.map(entry => html`<li><a href=${entry.url ?? '#'}>${entry.title}</a> ${entry.date}</li>`)}</ul>` : html`<p>${__('Nothing here yet.')}</p>`}
    ${view.paging.page < view.paging.pages ? html`<a href=${`${view.paging.base}?page=${view.paging.page + 1}`}>${__('Older')}</a>` : null}
</section>`;

/** Plain templates for a site without a usable theme. Activate a theme under Appearance. */
export const fallbackTheme: SiteTheme = {
    layout: (site, content) => html`<div class="mx-auto max-w-3xl px-6 py-8 text-foreground">
        <header><a href=${site.homeUrl}><strong>${site.title}</strong></a> ${site.tagline}<nav aria-label=${__('Site')}>${menuList(site.menus.primary ?? [])}</nav>
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
