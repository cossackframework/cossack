/**
 * Revision comparison: a word-level diff of text, and a field-by-field comparison of two
 * record snapshots. Client-safe; the revisions screen renders the parts.
 */
import type { FieldDeclaration } from './fields';
import type { RecordShape } from './records';
import { richTextPlain, type RichTextDoc } from './richtext';

export interface DiffPart {
    readonly kind: 'same' | 'added' | 'removed';
    readonly text: string;
}

export interface FieldChange {
    readonly name: string;
    readonly label: string;
    /** Text fields are diffed by word; other values are shown before and after. */
    readonly kind: 'text' | 'value';
    /** JSON fields: the texts are JSON documents, best compared line by line. Blocks keep the word diff, since their text is prose. */
    readonly structured: boolean;
    readonly before: string;
    readonly after: string;
    readonly parts: readonly DiffPart[];
}

/** Tokens: words, runs of spaces, and line breaks, so a diff keeps the text's layout. */
function tokens(text: string): string[] {
    return text.match(/\n|[^\S\n]+|[^\s]+/g) ?? [];
}

/**
 * The word-level difference between two texts (Myers' algorithm). Texts over `limit` tokens,
 * or with more than `maxEdits` changed tokens, are reported as replaced, to bound the work.
 */
export function diffWords(before: string, after: string, limit = 20_000, maxEdits = 4_000): DiffPart[] {
    const replaced = () => merge([...(before ? [{ kind: 'removed' as const, text: before }] : []), ...(after ? [{ kind: 'added' as const, text: after }] : [])]);
    const a = tokens(before);
    const b = tokens(after);
    if (a.length + b.length > limit) return replaced();
    const max = Math.min(a.length + b.length, maxEdits);
    const offset = max + 1;
    const frontier = new Int32Array(2 * max + 3);
    // trace[d] holds the frontier before round d, for diagonals -d-1..d+1.
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
        trace.push(frontier.slice(offset - d - 1, offset + d + 2));
        for (let k = -d; k <= d; k += 2) {
            let x = k === -d || (k !== d && frontier[offset + k - 1]! < frontier[offset + k + 1]!) ? frontier[offset + k + 1]! : frontier[offset + k - 1]! + 1;
            let y = x - k;
            while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
            frontier[offset + k] = x;
            if (x >= a.length && y >= b.length) { found = d; break; }
        }
    }
    if (found < 0) return replaced();
    // Walk the trace back from the end, collecting edits in reverse.
    const parts: DiffPart[] = [];
    let x = a.length;
    let y = b.length;
    for (let d = found; d > 0; d--) {
        const previous = trace[d]!;
        const at = (k: number) => previous[k + d + 1]!;
        const k = x - y;
        const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
        const priorK = down ? k + 1 : k - 1;
        const priorX = at(priorK);
        const priorY = priorX - priorK;
        while (x > priorX && y > priorY) { parts.push({ kind: 'same', text: a[--x]! }); y--; }
        if (down) parts.push({ kind: 'added', text: b[--y]! });
        else parts.push({ kind: 'removed', text: a[--x]! });
    }
    while (x > 0 && y > 0) { parts.push({ kind: 'same', text: a[--x]! }); y--; }
    return merge(parts.reverse());
}

/** Join neighbouring parts of the same kind. */
function merge(parts: readonly DiffPart[]): DiffPart[] {
    const merged: DiffPart[] = [];
    for (const part of parts) {
        const last = merged.at(-1);
        if (last && last.kind === part.kind) merged[merged.length - 1] = { kind: part.kind, text: last.text + part.text };
        else if (part.text) merged.push(part);
    }
    return merged;
}

/** A value as the comparison shows it: rich text as its plain text, lists one per line. */
export function comparableValue(declaration: FieldDeclaration, value: unknown): string {
    if (value === null || value === undefined) return '';
    if (declaration.kind === 'richtext') return richTextPlain(value as RichTextDoc);
    if (declaration.kind === 'boolean') return value ? 'Yes' : 'No';
    if (declaration.kind === 'datetime' && typeof value === 'number') return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    if (Array.isArray(value) && declaration.multiple) return value.map(item => comparableValue({ ...declaration, multiple: false }, item)).join('\n');
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}

/** Fields that differ between two snapshots, in declaration order. */
export function compareRecords(fields: { readonly [name: string]: FieldDeclaration }, before: RecordShape | null, after: RecordShape): FieldChange[] {
    const changes: FieldChange[] = [];
    for (const [name, declaration] of Object.entries(fields)) {
        const from = comparableValue(declaration, before?.[name]);
        const to = comparableValue(declaration, after[name]);
        if (from === to) continue;
        const text = ['string', 'text', 'richtext', 'json', 'blocks'].includes(declaration.kind) || declaration.multiple === true;
        changes.push({
            name, label: declaration.label ?? name, kind: text ? 'text' : 'value', structured: declaration.kind === 'json', before: from, after: to,
            parts: text ? diffWords(from, to) : [...(from ? [{ kind: 'removed' as const, text: from }] : []), ...(to ? [{ kind: 'added' as const, text: to }] : [])],
        });
    }
    return changes;
}
