/**
 * The default site theme. A theme is a plugin: `plugin.json` declares its menu locations and
 * options, and this module exports the templates as `theme`. Edit it, or copy the directory
 * to `src/plugins/<your-theme>/`, rename it in `plugin.json` and activate it under
 * Appearance → Themes.
 */
import { component, html, ifDefined, unsafeHTML, type TemplateResult } from '@cossackframework/renderer';
import { Turnstile } from '@cossackframework/ui';
import type { ArchiveView, CommentFormView, CommentView, CommentsView, EntryView, LanguageLink, MediaView, MenuItemView, Paging, SiteTheme, SiteView, ThemeHelpers } from '@cossackframework/cms';

/** Accent colours as the UI kit's primary tokens, light and dark. */
const ACCENTS: Record<string, [string, string] | undefined> = {
    blue: ['oklch(0.546 0.245 262.881)', 'oklch(0.985 0 0)'],
    emerald: ['oklch(0.596 0.145 163.225)', 'oklch(0.985 0 0)'],
    violet: ['oklch(0.541 0.281 293.009)', 'oklch(0.985 0 0)'],
    rose: ['oklch(0.586 0.253 17.585)', 'oklch(0.985 0 0)'],
    amber: ['oklch(0.769 0.188 70.08)', 'oklch(0.205 0 0)'],
};
const WIDTHS: Record<string, string> = { narrow: 'max-w-3xl', wide: 'max-w-5xl' };

const width = (helpers: ThemeHelpers) => WIDTHS[String(helpers.options.width)] ?? WIDTHS.narrow!;

function accentStyle(helpers: ThemeHelpers): string {
    const accent = ACCENTS[String(helpers.options.accent)];
    return accent ? `--primary: ${accent[0]}; --primary-foreground: ${accent[1]}; --ring: ${accent[0]};` : '';
}

function link(item: MenuItemView, className: string, helpers: ThemeHelpers): TemplateResult {
    const active = helpers.isActive(item.url);
    return html`<a href=${item.url} class=${`${className} ${active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        aria-current=${active ? 'page' : 'false'} target=${item.newTab ? '_blank' : ''} rel=${item.newTab ? 'noopener noreferrer' : ''}>${item.label}</a>`;
}

/** The header menu: dropdowns open on hover and keyboard focus. */
function desktopMenu(items: readonly MenuItemView[], helpers: ThemeHelpers, depth = 0): TemplateResult {
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
function mobileMenu(items: readonly MenuItemView[], helpers: ThemeHelpers): TemplateResult {
    const tree = (list: readonly MenuItemView[], depth: number): TemplateResult => html`<ul class=${depth ? 'ml-4 border-l border-border pl-3' : ''}>
        ${list.map(item => html`<li>${link(item, 'block py-2 text-sm no-underline', helpers)}${item.children.length ? tree(item.children, depth + 1) : null}</li>`)}</ul>`;
    return html`<details class="w-full md:hidden">
        <summary class="cursor-pointer select-none py-2 text-sm font-medium text-foreground">${__('Menu')}</summary>
        <div class="pb-2">${tree(items, 0)}</div>
    </details>`;
}

function searchBox(action: string, className = ''): TemplateResult {
    return html`<form action=${action} method="get" role="search" class=${className}>
        <input type="search" name="q" placeholder=${__('Search')} aria-label=${__('Search')}
            class="w-44 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
    </form>`;
}

/** An image with its resized variants; `sizes` says how wide it shows, so the browser picks one. */
function image(media: MediaView | null, className: string, sizes = '(min-width: 1024px) 1024px, 100vw', wide = false): TemplateResult | null {
    if (!media) return null;
    const fill = wide && Boolean(media.wideSrcset);
    const srcset = fill ? media.wideSrcset : media.srcset;
    // A 16:9 frame: its size, so the page does not shift while the image loads.
    const height = fill && media.width ? Math.round(media.width * 9 / 16) : media.height;
    return html`<img src=${media.url} srcset=${ifDefined(srcset || undefined)} sizes=${ifDefined(srcset ? sizes : undefined)} alt=${media.alt} width=${media.width ?? ''} height=${height ?? ''} loading="lazy" decoding="async" class=${className}>`;
}

/** The current page in the site's other languages. */
function languageSwitcher(languages: readonly LanguageLink[]): TemplateResult | null {
    if (languages.length < 2) return null;
    return html`<nav aria-label=${__('Language')}><ul class="flex items-center gap-1 text-sm">${languages.map(language => html`<li>
        <a href=${language.url} hreflang=${language.code} lang=${language.code} aria-current=${language.current ? 'true' : 'false'}
            class=${`rounded px-2 py-1 no-underline ${language.current ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>${language.label}</a></li>`)}</ul></nav>`;
}

const INPUT = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** The comment form; `parent` makes it a reply. The hidden `website` field catches bots. */
function commentForm(form: CommentFormView, parent: string | null): TemplateResult {
    if (form.requireSignIn) return html`<p class="text-sm text-muted-foreground"><a href=${form.signInUrl} class="text-primary hover:underline">${__('Log in')}</a> ${__('to post a comment.')}</p>`;
    const id = (name: string) => `comment-${parent ?? 'new'}-${name}`;
    return html`<form method="post" action=${form.action} class="space-y-3">
        <input type="hidden" name="collection" value=${form.collection}>
        <input type="hidden" name="entry" value=${form.entry}>
        ${parent ? html`<input type="hidden" name="parent" value=${parent}>` : null}
        <div aria-hidden="true" class="hidden"><label>${__('Leave this empty')} <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="space-y-1">
            <label for=${id('content')} class="block text-sm font-medium text-foreground">${parent ? __('Your reply') : __('Your comment')}</label>
            <textarea id=${id('content')} name="content" required rows="4" maxlength="5000" class=${INPUT}></textarea>
        </div>
        ${form.userName ? html`<p class="text-xs text-muted-foreground">${__('Commenting as')} ${form.userName}.</p>` : html`<div class="grid gap-3 sm:grid-cols-3">
            <div class="space-y-1"><label for=${id('name')} class="block text-sm font-medium text-foreground">${__('Name')}${form.requireNameEmail ? ' *' : ''}</label>
                <input id=${id('name')} name="authorName" maxlength="100" ?required=${form.requireNameEmail} autocomplete="name" class=${INPUT}></div>
            <div class="space-y-1"><label for=${id('email')} class="block text-sm font-medium text-foreground">${__('Email')}${form.requireNameEmail ? ' *' : ''}</label>
                <input id=${id('email')} name="authorEmail" type="email" maxlength="254" ?required=${form.requireNameEmail} autocomplete="email" class=${INPUT}></div>
            <div class="space-y-1"><label for=${id('url')} class="block text-sm font-medium text-foreground">${__('Website')}</label>
                <input id=${id('url')} name="authorUrl" type="url" maxlength="200" autocomplete="url" class=${INPUT}></div>
        </div>
        <p class="text-xs text-muted-foreground">${__('Your email address will not be published.')}</p>`}
        ${form.turnstileSiteKey ? component(Turnstile, { id: id('verify'), siteKey: form.turnstileSiteKey, action: 'comment', label: __('Bot protection') }) : null}
        <button type="submit" class="rounded-md border-none bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">${parent ? __('Post reply') : __('Post comment')}</button>
    </form>`;
}

function comment(item: CommentView, form: CommentFormView | null): TemplateResult {
    return html`<li id=${`comment-${item.id}`} class="space-y-3">
        <article class="flex gap-3">
            ${item.avatar ? html`<img src=${item.avatar} alt="" width="40" height="40" class="size-10 shrink-0 rounded-full object-cover">`
                : html`<span aria-hidden="true" class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">${[...item.author][0]?.toUpperCase() ?? '?'}</span>`}
            <div class="min-w-0 flex-1 space-y-1">
                <p class="text-sm"><span class="font-semibold text-foreground">${item.authorUrl ? html`<a href=${item.authorUrl} rel="ugc nofollow noopener" class="text-foreground hover:underline">${item.author}</a>` : item.author}</span>
                    <span class="text-muted-foreground"> · ${item.date}</span></p>
                <div class="text-sm leading-6 text-foreground [&_p]:my-2">${unsafeHTML(item.html)}</div>
                ${item.replyable && form ? html`<details class="text-sm"><summary class="cursor-pointer text-primary">${__('Reply')}</summary><div class="mt-3">${commentForm(form, item.id)}</div></details>` : null}
            </div>
        </article>
        ${item.replies.length ? html`<ol class="ml-6 space-y-4 border-l border-border pl-4 sm:ml-12">${item.replies.map(reply => comment(reply, form))}</ol>` : null}
    </li>`;
}

const COMMENT_ERRORS: Record<string, string> = {
    closed: 'Comments are closed.', 'sign-in': 'Log in to comment.', 'too-fast': 'You are commenting too quickly. Wait a moment and try again.',
    invalid: 'Write a comment, with your name and a valid email address.', bot: 'The check against bots failed. Try again.',
};

function comments(view: CommentsView): TemplateResult {
    return html`<section id="comments" aria-labelledby="comments-title" class="space-y-6 border-t border-border pt-8">
        <h2 id="comments-title" class="text-2xl font-semibold text-foreground">${view.count ? `${view.count} ${view.count === 1 ? __('comment') : __('comments')}` : __('Comments')}</h2>
        ${view.notice === 'held' ? html`<p role="status" class="rounded-md border border-border bg-muted px-3 py-2 text-sm">${__('Thanks! Your comment is awaiting moderation.')}</p>` : null}
        ${view.notice === 'posted' ? html`<p role="status" class="rounded-md border border-border bg-muted px-3 py-2 text-sm">${__('Thanks! Your comment is posted.')}</p>` : null}
        ${view.error ? html`<p role="alert" class="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">${__(COMMENT_ERRORS[view.error] ?? 'Your comment could not be posted.')}</p>` : null}
        ${view.items.length ? html`<ol class="space-y-6">${view.items.map(item => comment(item, view.form))}</ol>` : view.open ? html`<p class="text-sm text-muted-foreground">${__('No comments yet.')}</p>` : null}
        ${view.form ? html`<div class="space-y-3"><h3 class="text-lg font-semibold text-foreground">${__('Leave a comment')}</h3>${commentForm(view.form, null)}</div>`
            : html`<p class="text-sm text-muted-foreground">${__('Comments are closed.')}</p>`}
    </section>`;
}

function card(entry: EntryView): TemplateResult {
    return html`<article class="group grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        ${entry.image ? html`<a href=${entry.url ?? '#'} class="block overflow-hidden rounded-lg">${image(entry.image, 'aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105', '(min-width: 640px) 12rem, 100vw')}</a>` : html`<span class="hidden sm:block"></span>`}
        <div class="space-y-2">
            <h2 class="text-xl font-semibold"><a href=${entry.url ?? '#'} class="text-foreground no-underline hover:text-primary">${entry.title}</a></h2>
            ${entry.date || entry.author ? html`<p class="text-xs text-muted-foreground">${entry.date}${entry.author ? ` · ${entry.author}` : ''}</p>` : null}
            ${entry.excerpt ? html`<p class="text-sm leading-6 text-muted-foreground">${entry.excerpt}</p>` : null}
            ${entry.url ? html`<a href=${entry.url} class="text-sm font-medium text-primary hover:underline">${__('Read more')} →</a>` : null}
        </div>
    </article>`;
}

function pagination(paging: Paging): TemplateResult | null {
    if (paging.pages <= 1) return null;
    const href = (page: number) => page > 1 ? `${paging.base}?page=${page}` : paging.base;
    return html`<nav aria-label=${__('Pages')} class="flex items-center justify-between border-t border-border pt-6 text-sm">
        ${paging.page > 1 ? html`<a href=${href(paging.page - 1)} class="text-primary hover:underline" rel="prev">← ${__('Newer')}</a>` : html`<span></span>`}
        <span class="text-muted-foreground">${__('Page')} ${paging.page} ${__('of')} ${paging.pages}</span>
        ${paging.page < paging.pages ? html`<a href=${href(paging.page + 1)} class="text-primary hover:underline" rel="next">${__('Older')} →</a>` : html`<span></span>`}
    </nav>`;
}

function list(view: ArchiveView, empty: string): TemplateResult {
    return html`<div class="space-y-10">
        ${view.entries.length ? view.entries.map(card) : html`<p class="py-10 text-center text-muted-foreground">${empty}</p>`}
        ${pagination(view.paging)}
    </div>`;
}

function layout(site: SiteView, content: TemplateResult, helpers: ThemeHelpers): TemplateResult {
    const primary = site.menus.primary ?? [];
    const footer = site.menus.footer ?? [];
    const frame = `mx-auto w-full px-6 ${helpers.options.width === 'wide' ? 'max-w-6xl' : 'max-w-5xl'}`;
    const footerText = typeof helpers.options.footerText === 'string' && helpers.options.footerText.trim() ? helpers.options.footerText : `© ${new Date().getFullYear()} ${site.title}`;
    return html`<div class="flex min-h-screen flex-col bg-background text-foreground" style=${accentStyle(helpers)} data-theme="default-theme">
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

export const theme: SiteTheme = {
    layout,
    entry: (entry, helpers) => html`<article class="space-y-6">
        <header class="space-y-3">
            <h1 class="text-4xl font-bold tracking-tight text-foreground">${entry.title}</h1>
            ${entry.date || entry.author ? html`<p class="text-sm text-muted-foreground">${entry.date}${entry.author ? html` · ${entry.author}` : null}</p>` : null}
        </header>
        ${entry.image ? html`<figure>${image(entry.image, 'aspect-video w-full rounded-xl object-cover', '(min-width: 1024px) 1024px, 100vw', true)}${entry.image.caption ? html`<figcaption class="mt-2 text-sm text-muted-foreground">${entry.image.caption}</figcaption>` : null}</figure>` : null}
        ${entry.details.length ? html`<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border p-4 text-sm">
            ${entry.details.map(detail => html`<dt class="text-muted-foreground">${detail.label}</dt><dd class="text-foreground">${detail.value}</dd>`)}</dl>` : null}
        ${entry.body.length ? helpers.content(entry.body) : null}
        ${entry.blocks.length ? html`<div>${entry.blocks.map(block => helpers.block(block))}</div>` : null}
        ${entry.terms.some(group => group.terms.length) ? html`<footer class="space-y-1 border-t border-border pt-4 text-sm text-muted-foreground">
            ${entry.terms.filter(group => group.terms.length).map(group => html`<p>${group.label}: ${group.terms.map((term, index) => html`${index ? ', ' : ''}${term.url
                ? html`<a href=${term.url} class="text-primary hover:underline">${term.name}</a>` : term.name}`)}</p>`)}
        </footer>` : null}
        ${entry.comments ? comments(entry.comments) : null}
    </article>`,
    home: view => list(view, __('Nothing published yet.')),
    archive: view => html`<div class="space-y-10">
        <header class="space-y-2 border-b border-border pb-6">
            <h1 class="text-3xl font-bold text-foreground">${view.title}</h1>
            ${view.description ? html`<p class="text-muted-foreground">${view.description}</p>` : null}
        </header>
        ${list(view, __('Nothing here yet.'))}
    </div>`,
    search: view => html`<div class="space-y-8">
        <form method="get" action="" role="search" class="flex gap-2">
            <input type="search" name="q" .value=${view.query} aria-label=${__('Search')} placeholder=${__('Search')}
                class="flex-1 rounded-md border border-input bg-background px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring">
            <button type="submit" class="rounded-md border-none bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">${__('Search')}</button>
        </form>
        ${view.query ? html`<h1 class="text-2xl font-bold text-foreground">${view.title}</h1>${list(view, __('Nothing matched your search.'))}` : null}
    </div>`,
    notFound: () => html`<section class="space-y-3 py-16 text-center">
        <h1 class="text-3xl font-bold text-foreground">${__('Page not found')}</h1>
        <p class="text-muted-foreground">${__('The page you are looking for does not exist.')}</p>
        <a href="/" class="text-primary hover:underline">${__('Go to the home page')}</a>
    </section>`,
};
