/** Entry cards, pagination and the list that archives, the home page and search share. */
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { ArchiveView, EntryView, Paging } from '@cossackframework/cms';
import { image } from './media';

function card(entry: EntryView): TemplateResult {
    return html`<article class="group grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        ${entry.image ? html`<a href=${entry.url ?? '#'} class="block overflow-hidden rounded-lg">${image(entry.image, 'aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105', '(min-width: 640px) 12rem, 100vw')}</a>` : html`<span class="hidden sm:block"></span>`}
        <div class="space-y-2">
            <h2 class="text-xl font-semibold"><a href=${entry.url ?? '#'} class="text-foreground no-underline hover:text-primary">${entry.title}</a></h2>
            ${entry.date || entry.authors.length ? html`<p class="text-xs text-muted-foreground">${entry.date}${entry.authors.length ? ` · ${entry.authors.map(author => author.name).join(', ')}` : ''}</p>` : null}
            ${entry.excerpt ? html`<p class="text-sm leading-6 text-muted-foreground">${entry.excerpt}</p>` : null}
            ${entry.url ? html`<a href=${entry.url} class="text-sm font-medium text-primary hover:underline">${__('Read more')} →</a>` : null}
        </div>
    </article>`;
}

/** The URL of a page of a list: the base, with `page=N` added to its query after the first. */
export function pageHref(paging: Paging, page: number): string {
    return page > 1 ? `${paging.base}${paging.base.includes('?') ? '&' : '?'}page=${page}` : paging.base;
}

function pagination(paging: Paging): TemplateResult | null {
    if (paging.pages <= 1) return null;
    const href = (page: number) => pageHref(paging, page);
    return html`<nav aria-label=${__('Pages')} class="flex items-center justify-between border-t border-border pt-6 text-sm">
        ${paging.page > 1 ? html`<a href=${href(paging.page - 1)} class="text-primary hover:underline" rel="prev">← ${__('Newer')}</a>` : html`<span></span>`}
        <span class="text-muted-foreground">${__('Page')} ${paging.page} ${__('of')} ${paging.pages}</span>
        ${paging.page < paging.pages ? html`<a href=${href(paging.page + 1)} class="text-primary hover:underline" rel="next">${__('Older')} →</a>` : html`<span></span>`}
    </nav>`;
}

export function list(view: ArchiveView, empty: string): TemplateResult {
    return html`<div class="cms-measure space-y-10">
        ${view.entries.length ? view.entries.map(card) : html`<p class="py-10 text-center text-muted-foreground">${empty}</p>`}
        ${pagination(view.paging)}
    </div>`;
}
