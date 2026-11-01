/**
 * Editing an entry on the public site: the draft a site page keeps in edit mode and block
 * moves. Client-safe and small, since site pages ship it to every visitor; the editor itself is
 * `site-editor.client.ts`, loaded only in edit mode, and the bar that opens it is the site
 * taskbar (`taskbar.ts`).
 */
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

export { blockRows, nestRows, reorderBlocks } from './block-rows';

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
