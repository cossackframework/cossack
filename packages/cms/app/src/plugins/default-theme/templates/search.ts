/** Search results, with the search form: each result's snippet marks the words that matched. */
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { ArchiveView, EntryView } from '@cossackframework/cms';
import { pageHref } from '../parts/list';

function result(entry: EntryView): TemplateResult {
    const snippet = entry.snippet?.length ? entry.snippet : entry.excerpt ? [{ text: entry.excerpt, match: false }] : [];
    return html`<article class="space-y-1">
        <p class="text-xs text-muted-foreground">${entry.kind}${entry.date ? ` · ${entry.date}` : ''}</p>
        <h2 class="text-lg font-semibold"><a href=${entry.url ?? '#'} class="text-foreground no-underline hover:text-primary">${entry.title}</a></h2>
        ${snippet.length ? html`<p class="text-sm leading-6 text-muted-foreground">${snippet.map(part => part.match ? html`<mark class="rounded-sm bg-primary/15 px-0.5 text-foreground">${part.text}</mark>` : part.text)}</p>` : null}
    </article>`;
}

export default function search(view: ArchiveView): TemplateResult {
    const { paging } = view;
    return html`<div class="cms-measure space-y-8">
        <form method="get" action="" role="search" class="flex gap-2">
            <input type="search" name="q" .value=${view.query} aria-label=${__('Search')} placeholder=${__('Search')}
                class="flex-1 rounded-md border border-input bg-background px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring">
            <button type="submit" class="rounded-md border-none bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">${__('Search')}</button>
        </form>
        ${view.query ? html`<h1 class="text-2xl font-bold text-foreground">${view.title}</h1>
            ${view.loose ? html`<p class="text-sm text-muted-foreground">${__('Nothing has every word; these have some of them.')}</p>` : null}
            <div class="space-y-8">${view.entries.length ? view.entries.map(result) : html`<p class="py-10 text-center text-muted-foreground">${__('Nothing matched your search.')}</p>`}</div>
            ${paging.page > 1 || paging.pages > paging.page ? html`<nav aria-label=${__('Pages')} class="flex items-center justify-between border-t border-border pt-6 text-sm">
                ${paging.page > 1 ? html`<a href=${pageHref(paging, paging.page - 1)} class="text-primary hover:underline" rel="prev">← ${__('Previous')}</a>` : html`<span></span>`}
                <span class="text-muted-foreground">${__('Page')} ${paging.page}</span>
                ${paging.pages > paging.page ? html`<a href=${pageHref(paging, paging.page + 1)} class="text-primary hover:underline" rel="next">${__('Next')} →</a>` : html`<span></span>`}
            </nav>` : null}` : null}
    </div>`;
}
