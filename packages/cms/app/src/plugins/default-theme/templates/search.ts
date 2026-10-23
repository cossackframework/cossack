/** Search results, with the search form. */
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { ArchiveView } from '@cossackframework/cms';
import { list } from '../parts/list';

export default function search(view: ArchiveView): TemplateResult {
    return html`<div class="space-y-8">
        <form method="get" action="" role="search" class="flex gap-2">
            <input type="search" name="q" .value=${view.query} aria-label=${__('Search')} placeholder=${__('Search')}
                class="flex-1 rounded-md border border-input bg-background px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring">
            <button type="submit" class="rounded-md border-none bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">${__('Search')}</button>
        </form>
        ${view.query ? html`<h1 class="text-2xl font-bold text-foreground">${view.title}</h1>${list(view, __('Nothing matched your search.'))}` : null}
    </div>`;
}
