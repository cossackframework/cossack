/** A collection or term archive. Copy to archive-<collection>.ts, term.ts or term-<taxonomy>.ts for a narrower one. */
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { ArchiveView } from '@cossackframework/cms';
import { list } from '../parts/list';

export default function archive(view: ArchiveView): TemplateResult {
    return html`<div class="space-y-10">
        <header class="space-y-2 border-b border-border pb-6">
            <h1 class="text-3xl font-bold text-foreground">${view.title}</h1>
            ${view.description ? html`<p class="text-muted-foreground">${view.description}</p>` : null}
        </header>
        ${list(view, __('Nothing here yet.'))}
    </div>`;
}
