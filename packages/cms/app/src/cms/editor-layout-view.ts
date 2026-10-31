/**
 * An editor layout as the entry editor shows it. The tabs are the screen's own; this renders
 * what a tab or the sidebar holds: sections (a title, a note and what they hold), columns and
 * grids, notes, and the boxes themselves, which the screen renders by ID since it owns their
 * state. Client-safe.
 */
import { html, type TemplateResult } from '@cossackframework/renderer';
import type { EditorBlock } from './editor';

/** The grid classes a count of columns renders with, so Tailwind sees them. */
const COLUMNS: Record<number, string> = { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' };

export function editorLayoutView(blocks: readonly EditorBlock[], box: (id: string) => TemplateResult | null, options: { readonly sidebar?: boolean } = {}): TemplateResult {
    const gap = options.sidebar ? 'space-y-4' : 'space-y-5';
    const list = (items: readonly EditorBlock[]): TemplateResult => html`<div class=${gap}>${items.map(block => render(block))}</div>`;
    const render = (block: EditorBlock): TemplateResult | null => {
        const children = block.children ?? [];
        switch (block.type) {
            case 'editor/box': return box(String(block.data.box ?? ''));
            case 'editor/section': {
                const heading = `section-${block._id}`;
                return html`<section class="space-y-3" aria-labelledby=${heading}>
                    <div class="space-y-0.5">
                        <h3 id=${heading} class=${options.sidebar ? 'text-sm font-semibold text-foreground' : 'text-base font-semibold text-foreground'}>${String(block.data.title ?? '')}</h3>
                        ${block.data.description ? html`<p class="text-xs text-muted-foreground">${String(block.data.description)}</p>` : null}
                    </div>
                    ${list(children)}
                </section>`;
            }
            case 'core/columns': return html`<div class=${`grid gap-4 ${COLUMNS[Math.min(children.length, 6)] ?? ''}`}>${children.map(column => list(column.children ?? []))}</div>`;
            case 'core/grid': return html`<div class=${`grid gap-4 ${COLUMNS[Math.min(Math.max(Number(block.data.columns) || 2, 1), 6)] ?? ''}`}>${children.map(child => html`<div>${render(child)}</div>`)}</div>`;
            case 'core/paragraph': return html`<p class="whitespace-pre-line text-sm text-muted-foreground">${String(block.data.text ?? '')}</p>`;
            default: return children.length ? list(children) : null;
        }
    };
    return list(blocks);
}
