/**
 * A blank canvas for landing and marketing pages: the entry's blocks and nothing else. The
 * layout leaves out its header and footer for this template, so the content owns the page.
 * Choose it under Template in the editor's sidebar.
 */
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { EntryContext } from '@cossackframework/cms';

export default function entryBlank({ entry, helpers }: EntryContext): TemplateResult {
    return html`<article class="cms-blank" data-template="entry-blank">
        ${helpers.layout(entry.content)}
    </article>`;
}
