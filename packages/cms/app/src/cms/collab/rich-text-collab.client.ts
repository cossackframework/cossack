/**
 * Co-editing of one rich text document with `prosemirror-collab`: the entry's room is the
 * central authority. Unconfirmed steps go to the room one batch at a time; a batch made against
 * an old version comes back with the steps this editor lacked, which rebase the unconfirmed
 * ones; a document the room no longer has steps for is loaded again. Other editors' carets and
 * selections are decorations, mapped along as the document changes. The `.client.ts` name keeps
 * ProseMirror out of server bundles.
 */
import type { Editor } from '@tiptap/core';
import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { Step } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { RichTextDoc } from '@cossackframework/cms';

/** Another editor's selection in this document. */
export interface Caret {
    readonly peer: string;
    readonly name: string;
    readonly color: string;
    readonly anchor: number;
    readonly head: number;
}

/** The room's answer to a batch of steps. */
export type StepsResult =
    | { readonly status: 'accepted'; readonly version: number }
    | { readonly status: 'behind'; readonly version: number; readonly steps: readonly unknown[]; readonly clientIDs: readonly (string | number)[] }
    | { readonly status: 'reload' };

export interface CollabTransport {
    /** Send steps made against `version`; an empty batch asks for the steps after `version`. */
    steps(version: number, steps: readonly unknown[], clientID: string): Promise<StepsResult>;
    /** The whole document, to start over. */
    document(): Promise<{ doc: RichTextDoc | null; version: number }>;
}

export interface CollabOptions {
    readonly transport: CollabTransport;
    readonly clientID: string;
    readonly version: number;
}

const caretsKey = new PluginKey<{ carets: readonly Caret[]; set: DecorationSet }>('cmsCarets');

/** The caret's name is drawn by CSS, so it is neither in the document's text nor copied with it. */
const CARET_STYLE = `.cms-caret { position: relative; display: inline; border-left: 2px solid var(--caret-color); margin-left: -1px; pointer-events: none; }
.cms-caret::after { content: attr(data-name); position: absolute; left: -2px; bottom: 100%; white-space: nowrap; border-radius: 3px 3px 3px 0; background: var(--caret-color); color: #fff; font-size: 10px; line-height: 1.4; padding: 0 4px; font-weight: 500; font-family: system-ui, sans-serif; user-select: none; }`;

function caretWidget(caret: Caret): HTMLElement {
    if (!document.getElementById('cms-caret-style')) {
        const style = document.createElement('style');
        style.id = 'cms-caret-style';
        style.textContent = CARET_STYLE;
        document.head.appendChild(style);
    }
    const span = document.createElement('span');
    span.className = 'cms-caret';
    span.setAttribute('aria-hidden', 'true');
    span.dataset.name = caret.name;
    span.style.setProperty('--caret-color', caret.color);
    return span;
}

function caretDecorations(doc: Node, carets: readonly Caret[]): DecorationSet {
    const size = doc.content.size;
    const clamp = (position: number) => Math.max(0, Math.min(size, position));
    const decorations: Decoration[] = [];
    for (const caret of carets) {
        const anchor = clamp(caret.anchor);
        const head = clamp(caret.head);
        if (anchor !== head) decorations.push(Decoration.inline(Math.min(anchor, head), Math.max(anchor, head), { style: `background-color: ${caret.color}33` }));
        decorations.push(Decoration.widget(head, () => caretWidget(caret), { side: -1, key: `caret-${caret.peer}` }));
    }
    return DecorationSet.create(doc, decorations);
}

/** Other editors' carets: set through a transaction's meta, mapped as the document changes. */
export function caretsPlugin(): Plugin {
    return new Plugin<{ carets: readonly Caret[]; set: DecorationSet }>({
        key: caretsKey,
        state: {
            init: () => ({ carets: [] as readonly Caret[], set: DecorationSet.empty }),
            apply(transaction, value) {
                const carets = transaction.getMeta(caretsKey) as readonly Caret[] | undefined;
                if (carets) return { carets, set: caretDecorations(transaction.doc, carets) };
                return transaction.docChanged ? { carets: value.carets, set: value.set.map(transaction.mapping, transaction.doc) } : value;
            },
        },
        props: { decorations: state => caretsKey.getState(state)?.set },
    });
}

/** The plugins an editor starts with to take part: the collab plugin at the room's version, and the carets. */
export function collabPlugins(options: Pick<CollabOptions, 'clientID' | 'version'>): Plugin[] {
    return [collab({ version: options.version, clientID: options.clientID }), caretsPlugin()];
}

/** One editor's part in the room for its document. */
export class CollabSession {
    readonly #editor: Editor;
    readonly #transport: CollabTransport;
    readonly #clientID: string;
    #sending = false;
    #reloading = false;
    #destroyed = false;

    constructor(editor: Editor, options: CollabOptions) {
        this.#editor = editor;
        this.#transport = options.transport;
        this.#clientID = options.clientID;
    }

    /** The version this editor has synced to. */
    get version(): number {
        return getVersion(this.#editor.state);
    }

    /** After a local transaction: send what is unconfirmed, one batch at a time. */
    flush(): void {
        if (this.#destroyed || this.#sending || this.#reloading) return;
        const sendable = sendableSteps(this.#editor.state);
        if (!sendable) return;
        this.#sending = true;
        const steps = sendable.steps.map(step => step.toJSON() as unknown);
        this.#transport.steps(sendable.version, steps, this.#clientID).then(result => {
            if (this.#destroyed) return;
            // The room confirms the batch here as well as in its broadcast, whichever comes first.
            if (result.status === 'accepted') this.receive(result.version, steps, steps.map(() => this.#clientID));
            else if (result.status === 'behind') this.receive(result.version, result.steps, result.clientIDs);
            else void this.reload();
        }).catch(() => { /* The socket closed: the next connection joins the room again. */ })
            .finally(() => { this.#sending = false; if (!this.#destroyed) this.flush(); });
    }

    /**
     * Steps from the room, ending at `version`: others' changes and this editor's confirmations.
     * Steps already applied are skipped; a gap is filled by asking the room for what is missing.
     */
    receive(version: number, steps: readonly unknown[], clientIDs: readonly (string | number)[]): void {
        if (this.#destroyed || this.#reloading) return;
        const mine = this.version;
        if (version <= mine) return;
        const start = version - steps.length;
        if (start > mine) { void this.catchUp(); return; }
        const skip = mine - start;
        try {
            const schema = this.#editor.state.schema;
            const parsed = steps.slice(skip).map(step => Step.fromJSON(schema, step));
            this.#editor.view.dispatch(receiveTransaction(this.#editor.state, parsed, clientIDs.slice(skip), { mapSelectionBackward: true }));
        } catch { void this.reload(); return; }
        this.flush();
    }

    /** Ask the room for the steps after this editor's version. */
    async catchUp(): Promise<void> {
        if (this.#sending || this.#reloading) return;
        this.#sending = true;
        try {
            const result = await this.#transport.steps(this.version, [], this.#clientID);
            if (this.#destroyed) return;
            if (result.status === 'behind') this.receive(result.version, result.steps, result.clientIDs);
            else if (result.status === 'reload') void this.reload();
        } catch { /* The next connection joins again. */ }
        finally { this.#sending = false; if (!this.#destroyed) this.flush(); }
    }

    /** Load the document again from the room and start from its version; unconfirmed steps are lost. */
    async reload(): Promise<void> {
        if (this.#reloading || this.#destroyed) return;
        this.#reloading = true;
        try {
            const { doc, version } = await this.#transport.document();
            if (!this.#destroyed) this.reset(doc, version);
        } catch { /* The next connection joins again. */ }
        finally { this.#reloading = false; }
    }

    /** Replace the document with the room's and track from `version`, without sending the replacement as steps. */
    reset(doc: RichTextDoc | null, version: number): void {
        if (this.#destroyed) return;
        const editor = this.#editor;
        editor.unregisterPlugin('collab');
        editor.commands.setContent(doc && doc.content.length ? doc as never : '', { emitUpdate: false });
        editor.registerPlugin(collab({ version, clientID: this.#clientID }));
    }

    setCarets(carets: readonly Caret[]): void {
        if (this.#destroyed) return;
        this.#editor.view.dispatch(this.#editor.state.tr.setMeta(caretsKey, carets).setMeta('addToHistory', false));
    }

    destroy(): void {
        this.#destroyed = true;
    }
}
