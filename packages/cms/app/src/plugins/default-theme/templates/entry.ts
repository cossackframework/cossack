/** One entry: a post, a page or an entry of another collection. Copy to entry-<collection>.ts for one collection. */
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { EntryView, ThemeHelpers } from '@cossackframework/cms';
import { comments } from '../parts/comments';
import { image } from '../parts/media';

export default function entry(entry: EntryView, helpers: ThemeHelpers): TemplateResult {
    return html`<article class="space-y-6">
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
    </article>`;
}
