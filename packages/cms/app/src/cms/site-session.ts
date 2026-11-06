/**
 * The Live Edit session the site page and the site layout share in the browser. The page edits
 * the entry and the page's widget areas (`SiteDocument`s); the frame around the entry is the
 * layout's, so the layout previews the areas from this store through its own server method and
 * reloads the saved ones when the session ends. Client-safe and tiny: it holds state only.
 */
import { createStore } from '@cossackframework/core';
import type { EditorBlock } from './editor';

/** An area's blocks as the editor holds them: control values. */
export interface AreaDraft { name: string; blocks: EditorBlock[] }

export interface SiteEditingSession {
    areas: AreaDraft[];
}

/** What the page tells the layout at render time, so the areas render with their markers from the first paint. */
export interface SiteEditingContext {
    areas: AreaDraft[];
    /** The signed-in user may change the areas; otherwise they are marked but locked. */
    editable: boolean;
}

declare module 'hono' {
    interface ContextVariableMap {
        'cms.editing': SiteEditingContext | undefined;
    }
}

/** Null outside edit mode and before the editor's first change. */
export const siteSession = createStore<SiteEditingSession | null>(null);
