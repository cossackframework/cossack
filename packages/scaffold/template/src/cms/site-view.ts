/**
 * The public site's rendering: the active theme's templates, the helpers they receive, and
 * the core block renderers themes can replace. Client-safe; views arrive from the server with
 * Markdown and rich text already rendered to escaped HTML.
 */
import { component, html, ifDefined, unsafeHTML, type TemplateResult } from '@cossackframework/renderer';
import { plugins } from '@cossackframework/framework/plugins';
import { siteThemeProblems, type ArchiveView, type EntryView, type MediaView, type MenuItemView, type RenderedBlock, type SiteTheme, type ThemeHelpers } from '@cossackframework/cms';

export type { ArchiveView, EntryView, MediaView, Paging, RenderedBlock, SiteView } from '@cossackframework/cms';

/** Prose styles for rendered bodies. */
export const PROSE = 'cms-prose max-w-none text-foreground leading-7 [&_a]:text-primary [&_a]:underline [&_h1]:mt-8 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li_p]:my-1 [&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_img]:my-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_hr]:my-8 [&_table]:my-4 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_td]:border [&_td]:border-border [&_td]:px-2';

/** The theme a plugin's `ui.ts` exports, or the built-in fallback when it is missing or invalid. */
export function siteTheme(name: string | null): SiteTheme {
    const theme = name ? (plugins.find(plugin => plugin.name === name)?.ui as { theme?: unknown } | null | undefined)?.theme : undefined;
    return theme && !siteThemeProblems(theme).length ? theme as SiteTheme : fallbackTheme;
}

/** The helpers every template receives. `isActive` is the component's own: an exact path, or a prefix. */
export function themeHelpers(theme: SiteTheme, options: Record<string, unknown>, isActive: (path: string, exact: boolean) => boolean): ThemeHelpers {
    const helpers: ThemeHelpers = {
        options,
        isActive: url => {
            const path = url.replace(/[?#].*$/, '').replace(/(.)\/$/, '$1');
            if (!path.startsWith('/')) return false;
            return path === '/' ? isActive('/', true) : isActive(path, true) || isActive(`${path}/`, false);
        },
        block: block => theme.blocks?.[block.type]?.(block, helpers) ?? coreBlock(block),
        content: parts => html`${parts.map(part => part.kind === 'html' ? html`<div class=${PROSE}>${unsafeHTML(part.html)}</div>` : helpers.block(part.block))}`,
    };
    return helpers;
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
    return typeof url === 'string' && /^(?:https?:\/\/|\/|mailto:)/.test(url) ? url : '#';
}

/** A block of a core type, or of a plugin type through its `ui.ts` component. Unknown types render nothing. */
export function coreBlock(block: RenderedBlock): TemplateResult | null {
    const text = (name: string) => typeof block.data[name] === 'string' ? block.data[name] as string : '';
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
        case 'core/divider': return html`<hr class="my-8 border-border">`;
        default: {
            const plugin = plugins.find(entry => block.type.startsWith(`${entry.name}/`));
            const blocks = (plugin?.ui as { blocks?: Record<string, unknown> } | null | undefined)?.blocks;
            const view = blocks?.[block.type.slice(block.type.indexOf('/') + 1)] ?? blocks?.[block.type];
            return view ? component(view as never, { block }) : null;
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
    entry: (entry: EntryView, helpers) => html`<article><h1>${entry.title}</h1><p>${entry.date}</p>${helpers.content(entry.body)}${entry.blocks.map(block => helpers.block(block))}
        ${entry.comments ? html`<section id="comments"><h2>${__('Comments')}</h2>${entry.comments.items.map(item => html`<div id=${`comment-${item.id}`}><strong>${item.author}</strong> ${item.date}${unsafeHTML(item.html)}</div>`)}
            ${entry.comments.form && !entry.comments.form.requireSignIn ? html`<form method="post" action=${entry.comments.form.action}><input type="hidden" name="collection" value=${entry.comments.form.collection}>
                <input type="hidden" name="entry" value=${entry.comments.form.entry}><textarea name="content" required aria-label=${__('Comment')}></textarea>
                ${entry.comments.form.userName ? null : html`<input name="authorName" aria-label=${__('Name')} placeholder=${__('Name')}><input name="authorEmail" type="email" aria-label=${__('Email')} placeholder=${__('Email')}>`}
                <button type="submit">${__('Post comment')}</button></form>` : null}</section>` : null}</article>`,
    archive: list,
    notFound: () => html`<section><h1>${__('Page not found')}</h1><a href="/">${__('Go to the home page')}</a></section>`,
};
