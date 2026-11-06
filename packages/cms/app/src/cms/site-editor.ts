/**
 * Editing an entry on the public site: the draft a site page keeps in edit mode and block
 * moves. Client-safe and small, since site pages ship it to every visitor; the editor itself is
 * `site-editor.client.ts`, loaded only in edit mode, and the bar that opens it is the site
 * taskbar (`taskbar.ts`).
 */
import type { Note } from '@cossackframework/cms';
import type { Someone } from './collab/presence';
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

/**
 * A block list edited beside the entry: one of the theme's widget areas on the page, with its own
 * revision and permission. The entry's own blocks are the `entry` document.
 */
export interface SiteDocument {
    /** `area:<name>`. */
    key: string;
    kind: 'area';
    /** The area's name. */
    name: string;
    label: string;
    /** 0 until the site saves the area: the theme's default blocks show. */
    revision: number;
    blocks: EditorBlock[];
    /** The user may change it (`cms:appearance` for an area). A locked document shows its markers, but nothing in it selects. */
    editable: boolean;
    changed: boolean;
    error: string;
    /** Someone saved the area since the draft started. */
    conflict: boolean;
}

/** The entry being edited on the site: control values as the dashboard editor keeps them, and the page's areas beside it. */
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
    /** The page's widget areas, each saved on its own. */
    documents: SiteDocument[];
    /** Changes since the last save. */
    changed: boolean;
    error: string;
    errors: Record<string, string>;
    /** Someone else saved the entry since the draft started. */
    conflict: boolean;
    chooser: MediaChooserState;
    /** The entry's review notes, and who they name; written through the content API, since the site has no room. */
    notes: Note[];
    people: Record<string, Someone>;
    /** The editor's user ID, and whether they remove anyone's notes. */
    me: string;
    admin: boolean;
    mentionable: { id: string; name: string }[];
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
    /** The notes changed through the API: keep them in the draft. */
    onNotes(notes: Note[]): void;
    /** A document's blocks changed; the layout previews them. */
    onDocumentChange(key: string, blocks: EditorBlock[]): void;
};
