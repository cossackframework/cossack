/**
 * Editing an entry on the public site: the draft a site page keeps in edit mode, block moves,
 * and the bar signed-in editors see. Client-safe and small, since site pages ship it to
 * every visitor; the editor itself is `site-editor.client.ts`, loaded only in edit mode.
 */
import { html, type TemplateResult } from '@cossackframework/renderer';
import { blockTreeProblem, moveRows, placeBlocks, type BlockDeclaration, type MenuRow } from '@cossackframework/cms';
import type { EditorBlock, EditorValues, EditorView } from './editor';
import type { MediaPreview } from './field-controls';
import type { MediaChooserState } from './media-chooser';

/** Who may edit the entry a site page shows, for its bar. Null for everyone else. */
export interface SiteEditable {
    collection: string;
    id: string;
    /** The entry in the dashboard's editor. */
    dashboard: string;
}

/** The entry being edited on the site: control values as the dashboard editor keeps them. */
export interface SiteDraft {
    collection: string;
    id: string;
    /** The revision the draft started from; saving with another one is a conflict. */
    rev: number;
    view: EditorView;
    values: EditorValues;
    previews: Record<string, MediaPreview>;
    /** Reference fields' choices. */
    references: Record<string, { id: string; title: string }[]>;
    /** The entry's blocks field and rich text body, edited in place; null when it has none. */
    blocksField: string | null;
    bodyField: string | null;
    /** Changes since the last save. */
    changed: boolean;
    error: string;
    errors: Record<string, string>;
    /** Someone else saved the entry since the draft started. */
    conflict: boolean;
    chooser: MediaChooserState;
}

/** A block as the draft holds it: data as control values, nested blocks under a container. */
export type DraftBlock = EditorBlock;

/** The handlers a site page gives the editor; each change is kept in the page's draft. */
export type SiteEditorProps = {
    draft: SiteDraft;
    saving: boolean;
    /** Keep new values; `preview` renders the page from them. */
    onChange(values: EditorValues, preview: boolean): void;
    onSave(): void;
    /** Leave edit mode; unsaved changes are dropped. */
    onExit(): void;
    /** Start again from the saved entry, after a conflict. */
    onReload(): void;
    onSearchMedia(search: string): void;
    onChooser(state: MediaChooserState): void;
    onPreviews(previews: Record<string, MediaPreview>): void;
};

/** The tree as menu rows with depths, so blocks move with the menu editor's drag code. */
export function blockRows(blocks: readonly DraftBlock[]): MenuRow[] {
    return placeBlocks(blocks).map(place => ({ id: place.block.id, kind: 'link', label: '', depth: place.depth }) as MenuRow);
}

/** The tree the rows describe: each row's block under the nearest shallower row above it. */
export function nestRows(rows: readonly MenuRow[], blocks: readonly DraftBlock[]): DraftBlock[] {
    const index = new Map(placeBlocks(blocks).map(place => [place.block.id, place.block]));
    const top: DraftBlock[] = [];
    const stack: { block: DraftBlock; depth: number }[] = [];
    for (const row of rows) {
        const block: DraftBlock = { ...index.get(row.id)!, children: [] };
        while (stack.length && stack.at(-1)!.depth >= row.depth) stack.pop();
        const parent = stack.at(-1);
        if (parent) parent.block.children!.push(block); else top.push(block);
        stack.push({ block, depth: row.depth });
    }
    // Leaves have no children list; a container keeps an empty one.
    const tidy = (list: DraftBlock[]): DraftBlock[] => list.map(block => {
        const children = tidy(block.children ?? []);
        return children.length || index.get(block.id)?.children ? { ...block, children } : (({ children: _, ...rest }) => rest)(block);
    });
    return tidy(top);
}

/**
 * Move the block at row `from` to sit at row `to` of the rows without it, at `depth`, as a
 * drag drops it. The blocks are unchanged when the types do not allow the result.
 */
export function reorderBlocks(blocks: readonly DraftBlock[], from: number, to: number, depth: number, types: ReadonlyMap<string, BlockDeclaration>): DraftBlock[] {
    const rows = blockRows(blocks);
    const moved = moveRows(rows, from, to, depth);
    if (moved.every((row, position) => row.id === rows[position]?.id && row.depth === rows[position]?.depth)) return [...blocks];
    const next = nestRows(moved, blocks);
    return blockTreeProblem(next, types) ? [...blocks] : next;
}

/** The bar an editor sees on an entry they can edit, outside edit mode. */
export function editBar(editable: SiteEditable, start: () => void): TemplateResult {
    return html`<div role="region" aria-label=${__('Editing')} class="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/95 px-2 py-1.5 text-sm shadow-lg backdrop-blur">
        <button type="button" class="rounded-full border-none bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground cursor-pointer" @click=${start}>${__('Edit this page')}</button>
        <a href=${editable.dashboard} class="rounded-full px-3 py-1.5 text-sm text-muted-foreground no-underline hover:text-foreground">${__('Open in the dashboard')}</a>
    </div>`;
}
