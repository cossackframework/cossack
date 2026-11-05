/**
 * Notes on passages of rich text, drawn as decorations: an amber underline on each noted
 * passage, stronger on the thread open in the rail, mapped along as the document changes so
 * a note stays on its words while people type around it. A stored range that no longer holds
 * its quote is put back on the nearest occurrence of the quote; a quote that is gone detaches
 * the note, and the rail shows it on the block instead. The `.client.ts` name keeps ProseMirror
 * out of server bundles.
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findQuote, type NoteRange } from '@cossackframework/cms';

/** A text note as the page knows it: its last range, and the words it was left on. */
export interface NoteMarkInput {
    readonly id: string;
    readonly range: NoteRange | null;
    readonly quote: string;
}

/** A text note as it sits in the document now. */
export interface NoteMark {
    readonly id: string;
    readonly from: number;
    readonly to: number;
}

interface NotesState {
    marks: readonly NoteMark[];
    active: string | null;
    set: DecorationSet;
}

export interface NotesPluginOptions {
    /** A noted passage was clicked. */
    onClick(id: string): void;
    /** The passages moved, or the notes were placed: where every note that could be placed sits now. */
    onMoved(marks: readonly NoteMark[]): void;
}

const notesKey = new PluginKey<NotesState>('cmsNotes');

const NOTE_STYLE = `.cms-note { background: rgba(245, 158, 11, 0.16); border-bottom: 2px solid rgb(245 158 11); cursor: pointer; }
.cms-note-active { background: rgba(245, 158, 11, 0.38); }`;

function ensureStyle(): void {
    if (document.getElementById('cms-note-style')) return;
    const style = document.createElement('style');
    style.id = 'cms-note-style';
    style.textContent = NOTE_STYLE;
    document.head.append(style);
}

/** The document's text with, for each character, the position it sits at. */
function flatten(doc: Node): { text: string; positions: number[] } {
    let text = '';
    const positions: number[] = [];
    doc.descendants((node, position) => {
        if (node.isText && node.text) {
            for (let index = 0; index < node.text.length; index++) positions.push(position + index);
            text += node.text;
        } else if (node.isBlock && text && !text.endsWith('\n')) {
            // Blocks are separated so a quote never spans two of them.
            positions.push(position);
            text += '\n';
        }
        return true;
    });
    return { text, positions };
}

/**
 * Where a note's words are now: its range when it still holds the quote, else the nearest
 * occurrence of the quote, else nothing. Without a quote the range stands as it is.
 */
export function anchorNote(doc: Node, input: NoteMarkInput): NoteRange | null {
    const size = doc.content.size;
    const range = input.range && input.range.to <= size ? input.range : null;
    const quote = input.quote.replace(/\s+/g, ' ').trim();
    if (!quote) return range;
    if (range && doc.textBetween(range.from, range.to, ' ').replace(/\s+/g, ' ').trim() === quote) return range;
    const flat = flatten(doc);
    const at = findQuote(flat.text, quote, range ? flat.positions.findIndex(position => position >= range.from) : 0);
    if (at === -1 || at + quote.length > flat.positions.length) return null;
    return { from: flat.positions[at]!, to: flat.positions[at + quote.length - 1]! + 1 };
}

function decorate(doc: Node, marks: readonly NoteMark[], active: string | null): DecorationSet {
    const size = doc.content.size;
    return DecorationSet.create(doc, marks.filter(mark => mark.from < mark.to && mark.to <= size)
        .map(mark => Decoration.inline(mark.from, mark.to, { class: mark.id === active ? 'cms-note cms-note-active' : 'cms-note', 'data-note': mark.id })));
}

/** The notes plugin: notes are set through a transaction's meta; the document's changes move them. */
export function notesPlugin(options: NotesPluginOptions): Plugin<NotesState> {
    return new Plugin<NotesState>({
        key: notesKey,
        state: {
            init: () => ({ marks: [], active: null, set: DecorationSet.empty }),
            apply(transaction, value) {
                const meta = transaction.getMeta(notesKey) as { inputs: readonly NoteMarkInput[]; active: string | null } | undefined;
                if (meta) {
                    // A note already placed keeps the place the document's changes carried it to; a new one is put on its words; one no longer listed goes.
                    const placed = new Map(value.marks.map(mark => [mark.id, mark]));
                    const marks = meta.inputs.flatMap(input => {
                        const known = placed.get(input.id);
                        if (known) return [known];
                        const range = anchorNote(transaction.doc, input);
                        return range ? [{ id: input.id, from: range.from, to: range.to }] : [];
                    });
                    const same = marks.length === value.marks.length && marks.every((mark, index) => mark === value.marks[index]);
                    if (!same) queueMicrotask(() => options.onMoved(marks));
                    return { marks, active: meta.active, set: decorate(transaction.doc, marks, meta.active) };
                }
                if (!transaction.docChanged) return value;
                const marks = value.marks.map(mark => ({ id: mark.id, from: transaction.mapping.map(mark.from, 1), to: transaction.mapping.map(mark.to, -1) })).filter(mark => mark.from < mark.to);
                if (marks.length !== value.marks.length || marks.some((mark, index) => mark.from !== value.marks[index]!.from || mark.to !== value.marks[index]!.to)) queueMicrotask(() => options.onMoved(marks));
                return { marks, active: value.active, set: decorate(transaction.doc, marks, value.active) };
            },
        },
        props: {
            decorations: state => notesKey.getState(state)?.set,
            handleClick(_view, _position, event) {
                const target = event.target instanceof Element ? event.target.closest('[data-note]') : null;
                const id = target?.getAttribute('data-note');
                if (!id) return false;
                options.onClick(id);
                return false;
            },
        },
        view: () => { ensureStyle(); return {}; },
    });
}

/** Place the notes in an editor's document; the plugin answers through `onMoved` with where each one sits. */
export function setNotes(view: { state: import('@tiptap/pm/state').EditorState; dispatch(tr: import('@tiptap/pm/state').Transaction): void }, inputs: readonly NoteMarkInput[], active: string | null): void {
    view.dispatch(view.state.tr.setMeta(notesKey, { inputs, active }).setMeta('addToHistory', false));
}
