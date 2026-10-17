/**
 * Navigation menus: a tree of items saved as one document. Items link to a URL, an entry, a
 * collection archive or a term; entries and terms are stored by ID and resolved when the site
 * renders. Client-safe: the dashboard edits the tree with the helpers below, the host
 * validates it on save.
 */
import { safeLinkUrl } from './richtext';

export type MenuItemKind = 'link' | 'entry' | 'archive' | 'term';

export interface MenuItem {
    /** Stable within the menu: 1-40 letters, digits, `_` or `-`. */
    readonly id: string;
    readonly kind: MenuItemKind;
    /** Text shown on the site. Empty uses the entry's title, the collection's label or the term's name. */
    readonly label: string;
    /** link: the URL. */
    readonly url?: string;
    /** entry and archive: the collection name. */
    readonly collection?: string;
    /** entry: the entry ID. */
    readonly entry?: string;
    /** term: the taxonomy and term ID. */
    readonly taxonomy?: string;
    readonly term?: string;
    /** Open in a new tab. */
    readonly newTab?: boolean;
    readonly children: readonly MenuItem[];
}

export interface MenuShape {
    readonly id: string;
    readonly name: string;
    readonly items: readonly MenuItem[];
    readonly revision: number;
    readonly createdAt: number;
    readonly updatedAt: number;
}

/** A resolved item, as the site and the content API show it. */
export interface MenuItemView {
    readonly id: string;
    readonly label: string;
    readonly url: string;
    readonly newTab: boolean;
    readonly kind: MenuItemKind;
    readonly children: readonly MenuItemView[];
}

export const MENU_LIMITS = Object.freeze({ items: 300, depth: 5, label: 120, name: 80 });
export const MENU_LOCATION = /^[a-z][a-z0-9-]{0,31}$/;

const ITEM_ID = /^[A-Za-z0-9_-]{1,40}$/;
const NAME = /^[a-z][a-z0-9_]*$/;
const RECORD_ID = /^[A-Za-z0-9_-]{1,80}$/;
const KINDS = new Set(['link', 'entry', 'archive', 'term']);

/** Problems with a menu's items; empty when it can be saved. */
export function menuProblems(items: unknown): string[] {
    const problems: string[] = [];
    if (!Array.isArray(items)) return ['Menu items must be a list.'];
    const ids = new Set<string>();
    let count = 0;
    const visit = (list: readonly unknown[], depth: number) => {
        for (const value of list) {
            count++;
            const item = value as Partial<MenuItem> | null;
            const at = `Item ${typeof item?.label === 'string' && item.label ? `“${item.label.slice(0, 40)}”` : count}`;
            if (!item || typeof item !== 'object' || Array.isArray(item)) { problems.push(`Item ${count} must be an object.`); continue; }
            if (typeof item.id !== 'string' || !ITEM_ID.test(item.id) || ids.has(item.id)) problems.push(`${at} needs a distinct ID.`);
            else ids.add(item.id);
            if (!KINDS.has(item.kind as string)) problems.push(`${at}: the kind is link, entry, archive or term.`);
            if (typeof item.label !== 'string' || [...item.label].length > MENU_LIMITS.label) problems.push(`${at}: labels are at most ${MENU_LIMITS.label} characters.`);
            else if (item.kind === 'link' && !item.label.trim()) problems.push(`${at}: custom links need a label.`);
            if (item.kind === 'link' && !safeLinkUrl(item.url)) problems.push(`${at}: the URL must start with https://, http://, /, #, mailto: or tel:.`);
            if ((item.kind === 'entry' || item.kind === 'archive') && (typeof item.collection !== 'string' || !NAME.test(item.collection))) problems.push(`${at} needs a collection.`);
            if (item.kind === 'entry' && (typeof item.entry !== 'string' || !RECORD_ID.test(item.entry))) problems.push(`${at} needs an entry.`);
            if (item.kind === 'term' && (typeof item.taxonomy !== 'string' || !/^[a-z][a-zA-Z0-9]{0,40}$/.test(item.taxonomy) || typeof item.term !== 'string' || !RECORD_ID.test(item.term))) problems.push(`${at} needs a term.`);
            if (item.newTab !== undefined && typeof item.newTab !== 'boolean') problems.push(`${at}: newTab is true or false.`);
            if (!Array.isArray(item.children)) { problems.push(`${at}: children must be a list.`); continue; }
            if (item.children.length && depth + 1 >= MENU_LIMITS.depth) problems.push(`${at}: menus nest at most ${MENU_LIMITS.depth} levels deep.`);
            else visit(item.children, depth + 1);
        }
    };
    visit(items, 0);
    if (count > MENU_LIMITS.items) problems.push(`A menu holds at most ${MENU_LIMITS.items} items.`);
    return problems;
}

/** A clean copy of valid items: only the fields of each kind. */
export function normalizeMenu(items: readonly MenuItem[]): MenuItem[] {
    return items.map(item => Object.freeze({
        id: item.id, kind: item.kind, label: item.label.trim(),
        ...(item.kind === 'link' ? { url: item.url } : {}),
        ...(item.kind === 'entry' || item.kind === 'archive' ? { collection: item.collection } : {}),
        ...(item.kind === 'entry' ? { entry: item.entry } : {}),
        ...(item.kind === 'term' ? { taxonomy: item.taxonomy, term: item.term } : {}),
        ...(item.newTab ? { newTab: true } : {}),
        children: Object.freeze(normalizeMenu(item.children)),
    }));
}

/** Items counted across every level. */
export function menuSize(items: readonly MenuItem[]): number {
    return items.reduce((total, item) => total + 1 + menuSize(item.children), 0);
}

export function menuItemId(): string {
    return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
}

// --- Editing as a flat list -------------------------------------------------------------
// The editor shows the tree as rows with depths: a row's parent is the nearest row above it
// with a smaller depth. A row and the deeper rows after it are its subtree.

export type MenuRow = Omit<MenuItem, 'children'> & { readonly depth: number };

/** The tree as rows, parents before their children. */
export function flattenMenu(items: readonly MenuItem[], depth = 0): MenuRow[] {
    return items.flatMap(({ children, ...item }) => [{ ...item, depth }, ...flattenMenu(children, depth + 1)]);
}

/** Rows back to a tree. Depths that skip a level attach to the nearest possible parent. */
export function buildMenu(rows: readonly MenuRow[]): MenuItem[] {
    const root: MenuItem[] = [];
    const stack: { depth: number; children: MenuItem[] }[] = [{ depth: -1, children: root }];
    for (const { depth, ...item } of rows) {
        while (stack.length > 1 && stack.at(-1)!.depth >= depth) stack.pop();
        const children: MenuItem[] = [];
        stack.at(-1)!.children.push({ ...item, children });
        stack.push({ depth, children });
    }
    return root;
}

/** The index after a row's subtree. */
export function subtreeEnd(rows: readonly MenuRow[], index: number): number {
    const depth = rows[index]!.depth;
    let end = index + 1;
    while (end < rows.length && rows[end]!.depth > depth) end++;
    return end;
}

/** Levels below a row: 0 for a row without children. */
function subtreeHeight(rows: readonly MenuRow[], index: number): number {
    const end = subtreeEnd(rows, index);
    let height = 0;
    for (let row = index; row < end; row++) height = Math.max(height, rows[row]!.depth - rows[index]!.depth);
    return height;
}

/**
 * Depths a subtree can take when inserted before position `to` of the rows without it: at
 * most one deeper than the row above, and no shallower than the row below, which keeps its
 * parent. `max < min` means the subtree cannot go there.
 */
export function dropDepths(rows: readonly MenuRow[], from: number, to: number): { min: number; max: number } {
    const end = subtreeEnd(rows, from);
    const rest = [...rows.slice(0, from), ...rows.slice(end)];
    const above = rest[to - 1];
    const below = rest[to];
    const max = Math.min(above ? above.depth + 1 : 0, MENU_LIMITS.depth - 1 - subtreeHeight(rows, from));
    return { min: below ? below.depth : 0, max };
}

/**
 * Move the subtree at `from` before position `to` of the rows without it, with its root at
 * `depth` (clamped to what fits there). Returns the rows unchanged when it does not fit.
 */
export function moveRows(rows: readonly MenuRow[], from: number, to: number, depth: number): MenuRow[] {
    if (from < 0 || from >= rows.length) return [...rows];
    const end = subtreeEnd(rows, from);
    const moving = rows.slice(from, end);
    const rest = [...rows.slice(0, from), ...rows.slice(end)];
    const position = Math.min(Math.max(to, 0), rest.length);
    const { min, max } = dropDepths(rows, from, position);
    if (max < min) return [...rows];
    const target = Math.min(Math.max(depth, min), max);
    const shift = target - moving[0]!.depth;
    return [...rest.slice(0, position), ...moving.map(row => ({ ...row, depth: row.depth + shift })), ...rest.slice(position)];
}

export type MenuMove = 'up' | 'down' | 'in' | 'out';

/** The moves the row at `index` allows, for its buttons. */
export function allowedMoves(rows: readonly MenuRow[], index: number): Set<MenuMove> {
    const moves = new Set<MenuMove>();
    for (const move of ['up', 'down', 'in', 'out'] as const) if (shiftRows(rows, index, move) !== rows) moves.add(move);
    return moves;
}

/**
 * WordPress's move links: up or down past a sibling, in under the sibling above (as its last
 * child), or out to follow its parent. Returns the same array when the move is not possible.
 */
export function shiftRows(rows: readonly MenuRow[], index: number, move: MenuMove): readonly MenuRow[] {
    const row = rows[index];
    if (!row) return rows;
    const end = subtreeEnd(rows, index);
    const previousSibling = (() => {
        for (let other = index - 1; other >= 0; other--) {
            if (rows[other]!.depth < row.depth) return -1;
            if (rows[other]!.depth === row.depth) return other;
        }
        return -1;
    })();
    const changed = (next: MenuRow[]) => next.every((entry, position) => entry.id === rows[position]?.id && entry.depth === rows[position]?.depth) ? rows : next;
    switch (move) {
        case 'up': return previousSibling < 0 ? rows : changed(moveRows(rows, index, previousSibling, row.depth));
        case 'down': {
            const next = rows[end];
            if (!next || next.depth !== row.depth) return rows;
            // After the next sibling's subtree, counted in the rows without this subtree.
            return changed(moveRows(rows, index, subtreeEnd(rows, end) - (end - index), row.depth));
        }
        case 'in': return previousSibling < 0 ? rows : changed(moveRows(rows, index, index, row.depth + 1));
        case 'out': {
            if (row.depth === 0) return rows;
            let parent = index - 1;
            while (parent >= 0 && rows[parent]!.depth >= row.depth) parent--;
            const parentEnd = subtreeEnd(rows, parent);
            return changed(moveRows(rows, index, parentEnd - (end - index), row.depth - 1));
        }
    }
}
