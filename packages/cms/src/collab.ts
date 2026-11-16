/**
 * Co-editing: the rules an entry's room (the live instance every editor of the entry connects
 * to) and its editors share. The room is the authority: it applies every change in the order
 * it receives them, and three rules make the editors converge on its values.
 *
 * - Scalars are last-write-wins per field. An editor applies its own change at once and
 *   ignores remote values of a field while it has sets of its own in flight (`PendingKeys`):
 *   whatever it ignored reached the room before its own last set, so the room agrees with it.
 * - A blocks field takes ops by block ID (`TreeOp`): the editor diffs its tree against the
 *   last one (`treeOps`), the room applies each op in order (`applyTreeOp`), drops what no
 *   longer applies, and broadcasts the op with a hash of its tree (`treeHash`); an editor whose
 *   hash differs asks for the tree again.
 * - Rich text keeps a step log per document (`StepLog`), as `prosemirror-collab` expects of a
 *   central authority: a batch applies against the current version alone, and an editor that
 *   fell behind rebases on the steps it lacked.
 *
 * Client-safe: no schema, no database.
 */
import { blocksShapeProblem } from './block-shape';
import { findBlock, insertBlock, placeBlocks, removeBlock, updateBlock, type Block } from './blocks';

// --- Participants ------------------------------------------------------------------------------

/** Eight colors that tell editors apart on light and dark backgrounds, chosen by user ID. */
export const COLLAB_COLORS: readonly string[] = Object.freeze(['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f']);

function fnv1a(text: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/** The same user gets the same color in every room and on every screen. */
export function participantColor(userId: string): string {
    return COLLAB_COLORS[fnv1a(userId) % COLLAB_COLORS.length]!;
}

/** Where an editor is: the layout tab open, the control or block focused, the text selected, the block dragged. */
export interface PeerPresence {
    readonly tab?: string;
    readonly field?: string;
    readonly block?: string;
    /** A selection in a rich text document (`richTextPath`), as ProseMirror positions. */
    readonly selection?: { readonly path: string; readonly anchor: number; readonly head: number };
    readonly dragging?: string;
}

/** One connection to the room: a browser tab of a user. */
export interface PeerState {
    readonly peer: string;
    readonly user: string;
    readonly name: string;
    readonly avatar: string | null;
    readonly color: string;
    /** When the peer was last heard from. */
    readonly at: number;
    readonly presence: PeerPresence;
}

/** A user in the room, whatever the number of tabs. */
export interface Participant {
    readonly user: string;
    readonly name: string;
    readonly avatar: string | null;
    readonly color: string;
    /** The layout tabs the user has open, each once. */
    readonly tabs: readonly string[];
    /** Browser tabs. */
    readonly peers: number;
}

/** A peer that has not been heard from for this long has left. */
export const PRESENCE_TIMEOUT = 30_000;

/** Peers heard from within the timeout. */
export function livePeers(peers: Iterable<PeerState>, now: number, timeout = PRESENCE_TIMEOUT): PeerState[] {
    return [...peers].filter(peer => now - peer.at < timeout);
}

/** The peers not heard from within the timeout, by ID: they left without saying so. */
export function expiredPeers(peers: Iterable<PeerState>, now: number, timeout = PRESENCE_TIMEOUT): string[] {
    return [...peers].filter(peer => now - peer.at >= timeout).map(peer => peer.peer);
}

/** The room's users from its peers, by name. */
export function groupPeers(peers: Iterable<PeerState>): Participant[] {
    const users = new Map<string, { user: string; name: string; avatar: string | null; color: string; tabs: Set<string>; peers: number }>();
    for (const peer of peers) {
        const entry = users.get(peer.user) ?? { user: peer.user, name: peer.name, avatar: peer.avatar, color: peer.color, tabs: new Set<string>(), peers: 0 };
        entry.peers++;
        if (peer.presence.tab) entry.tabs.add(peer.presence.tab);
        users.set(peer.user, entry);
    }
    return [...users.values()].map(entry => ({ ...entry, tabs: [...entry.tabs] })).sort((a, b) => a.name.localeCompare(b.name) || a.user.localeCompare(b.user));
}

const SHORT = 120;
const short = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= SHORT ? value : undefined;
const position = (value: unknown): number | undefined => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;

/** A presence from client input: known keys with bounded values; anything else is dropped. */
export function checkPresence(value: unknown): PeerPresence {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const presence: { -readonly [key in keyof PeerPresence]: PeerPresence[key] } = {};
    const tab = short(source.tab);
    if (tab) presence.tab = tab;
    const field = short(source.field);
    if (field) presence.field = field;
    const block = short(source.block);
    if (block) presence.block = block;
    const dragging = short(source.dragging);
    if (dragging) presence.dragging = dragging;
    const selection = source.selection && typeof source.selection === 'object' ? source.selection as Record<string, unknown> : null;
    const path = short(selection?.path);
    const anchor = position(selection?.anchor);
    const head = position(selection?.head);
    if (path && anchor !== undefined && head !== undefined) presence.selection = { path, anchor, head };
    return presence;
}

// --- Scalars -----------------------------------------------------------------------------------

/**
 * This editor's changes the room has not echoed yet, by key. While a key has one in flight, a
 * remote value for it is ignored: it reached the room before this editor's last change, which
 * the room applied after it.
 */
export class PendingKeys {
    readonly #counts = new Map<string, number>();

    /** One more change of `key` is on its way to the room. */
    sent(key: string): void {
        this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
    }

    /** The room echoed, or refused, one of this editor's changes of `key`. */
    settled(key: string): void {
        const left = (this.#counts.get(key) ?? 0) - 1;
        if (left > 0) this.#counts.set(key, left);
        else this.#counts.delete(key);
    }

    /** Whether a remote value of `key` applies now. */
    accepts(key: string): boolean {
        return !this.#counts.has(key);
    }

    get size(): number {
        return this.#counts.size;
    }

    clear(): void {
        this.#counts.clear();
    }
}

/** The pending key of a field's value. */
export function scalarKey(field: string): string {
    return `field:${field}`;
}

/** The pending key of a block's patched path. */
export function patchKey(field: string, id: string, path: string): string {
    return `block:${field}:${id}:${path}`;
}

/**
 * The path of a rich text document in the room: a field's own, or a block's text field inside
 * a blocks field (`content:b1.text`).
 */
export function richTextPath(field: string, block?: { readonly id: string; readonly key: string }): string {
    return block ? `${field}:${block.id}.${block.key}` : field;
}

export function parseRichTextPath(path: string): { field: string; block?: { id: string; key: string } } | null {
    const match = /^([^:.]+)(?::([^.]+)\.(.+))?$/.exec(path);
    if (!match) return null;
    return match[2] ? { field: match[1]!, block: { id: match[2], key: match[3]! } } : { field: match[1]! };
}

// --- Block trees -------------------------------------------------------------------------------

/** A change to a blocks field, by block ID. `after: null` puts a block first in its parent. */
export type TreeOp =
    | { readonly kind: 'insert'; readonly field: string; readonly block: Block; readonly parent: string | null; readonly after: string | null }
    | { readonly kind: 'move'; readonly field: string; readonly id: string; readonly parent: string | null; readonly after: string | null }
    | { readonly kind: 'remove'; readonly field: string; readonly id: string }
    /** `type`, `layout`, `style`, `when` or `data.<key>`; an undefined value removes the key. */
    | { readonly kind: 'patch'; readonly field: string; readonly id: string; readonly path: string; readonly value?: unknown };

export interface TreeOpsOptions {
    /** Data keys the diff leaves out, such as rich text edited through its own step log, by block type and key. */
    readonly skip?: (type: string, key: string) => boolean;
}

/** JSON with sorted keys, so two equal values stringify alike. */
export function stableJson(value: unknown): string {
    return JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry as object).sort().map(key => [key, (entry as Record<string, unknown>)[key]]))
        : entry) ?? 'undefined';
}

const same = (a: unknown, b: unknown): boolean => a === b || stableJson(a) === stableJson(b);

function placesOf(blocks: readonly Block[]): Map<string, { block: Block; parent: string | null }> {
    const map = new Map<string, { block: Block; parent: string | null }>();
    for (const place of placeBlocks(blocks)) map.set(place.block._id, { block: place.block, parent: place.parent });
    return map;
}

/**
 * The ops that take `before` to `after`, in an order the room can apply one by one: container
 * by container from the top, inserts and moves anchored on the sibling before them (a block
 * that leaves a container about to go moves out first); then removals, where a removed
 * container takes what is left in it; then patches of what changed in the blocks that stayed.
 * A new block's op carries the new blocks inside it; blocks that moved into it get moves of
 * their own. Anchors are IDs, so blocks still waiting for their removal never shift one.
 */
export function treeOps(field: string, before: readonly Block[], after: readonly Block[], options: TreeOpsOptions = {}): TreeOp[] {
    const ops: TreeOp[] = [];
    const was = placesOf(before);
    const is = placesOf(after);
    // A new block without the blocks that already existed: those get moves into it.
    const fresh = (block: Block): Block => block.children ? { ...block, children: block.children.filter(child => !was.has(child._id)).map(fresh) } : block;
    const place = (parent: string | null, children: readonly Block[]) => {
        const isNew = parent !== null && !was.has(parent);
        // What the room holds here once the ops so far applied: the kept blocks that stay, in their old order, or a new block's new children.
        const current = isNew ? children.filter(child => !was.has(child._id)).map(child => child._id)
            : (parent === null ? before : (was.get(parent)!.block.children ?? [])).map(child => child._id).filter(id => is.get(id)?.parent === parent);
        children.forEach((child, index) => {
            const previous = index ? children[index - 1]!._id : null;
            if (!was.has(child._id)) {
                if (!isNew) { ops.push({ kind: 'insert', field, block: fresh(child), parent, after: previous }); current.splice(index, 0, child._id); }
            } else if (current[index] !== child._id) {
                ops.push({ kind: 'move', field, id: child._id, parent, after: previous });
                const at = current.indexOf(child._id);
                if (at >= 0) current.splice(at, 1);
                current.splice(index, 0, child._id);
            }
            place(child._id, child.children ?? []);
        });
    };
    place(null, after);
    for (const [id, { parent }] of was) {
        if (is.has(id)) continue;
        let covered = false;
        for (let ancestor = parent; ancestor !== null; ancestor = was.get(ancestor)?.parent ?? null) if (!is.has(ancestor)) { covered = true; break; }
        if (!covered) ops.push({ kind: 'remove', field, id });
    }
    for (const [id, { block: next }] of is) {
        const previous = was.get(id)?.block;
        if (!previous) continue;
        if (previous.type !== next.type) ops.push({ kind: 'patch', field, id, path: 'type', value: next.type });
        for (const key of new Set([...Object.keys(previous.data), ...Object.keys(next.data)])) {
            if (options.skip?.(next.type, key) || same(previous.data[key], next.data[key])) continue;
            ops.push({ kind: 'patch', field, id, path: `data.${key}`, ...(next.data[key] === undefined ? {} : { value: next.data[key] }) });
        }
        for (const path of ['layout', 'style', 'when'] as const) {
            if (same(previous[path], next[path])) continue;
            ops.push({ kind: 'patch', field, id, path, ...(next[path] === undefined ? {} : { value: next[path] }) });
        }
    }
    return ops;
}

/** A block's patchable paths; `data.__proto__` and the like are refused, since a patch writes the key onto a plain object. */
const PATCH_PATH = /^(?:type|layout|style|when|data\.(?!(?:__proto__|constructor|prototype)$)[A-Za-z_][A-Za-z0-9_-]{0,79})$/;

function indexAfter(blocks: readonly Block[], parent: string | null, after: string | null): number | undefined {
    if (after === null) return 0;
    const siblings = parent === null ? blocks : findBlock(blocks, parent)?.children ?? [];
    const at = siblings.findIndex(block => block._id === after);
    return at < 0 ? undefined : at + 1;
}

function patched<T extends Block>(block: T, path: string, value: unknown): T {
    if (path === 'type') return { ...block, type: String(value) };
    if (path.startsWith('data.')) {
        const data = { ...block.data } as Record<string, unknown>;
        const key = path.slice(5);
        if (value === undefined) delete data[key];
        else data[key] = value;
        return { ...block, data };
    }
    const next = { ...block } as Record<string, unknown>;
    if (value === undefined || value === null) delete next[path];
    else next[path] = value;
    return next as T;
}

/**
 * The tree with one op applied, or null when the op no longer applies: its block was removed,
 * its parent or anchor is gone (an unknown anchor puts the block last), it would put a block
 * inside itself, or its block is malformed.
 */
export function applyTreeOp<T extends Block>(blocks: readonly T[], op: TreeOp): T[] | null {
    switch (op.kind) {
        case 'insert': {
            if (blocksShapeProblem([op.block])) return null;
            const ids = new Set(placeBlocks(blocks).map(place => place.block._id));
            if (placeBlocks([op.block]).some(place => ids.has(place.block._id))) return null;
            if (op.parent !== null && !findBlock(blocks, op.parent)) return null;
            return insertBlock(blocks, op.parent, op.block as T, indexAfter(blocks, op.parent, op.after));
        }
        case 'move': {
            const block = findBlock(blocks, op.id);
            if (!block) return null;
            if (op.parent !== null && (op.parent === op.id || findBlock(block.children ?? [], op.parent) || !findBlock(blocks, op.parent))) return null;
            const without = removeBlock(blocks, op.id);
            return insertBlock(without, op.parent, block, indexAfter(without, op.parent, op.after));
        }
        case 'remove': return findBlock(blocks, op.id) ? removeBlock(blocks, op.id) : null;
        case 'patch': {
            if (!PATCH_PATH.test(op.path) || !findBlock(blocks, op.id)) return null;
            if (op.path === 'type' && typeof op.value !== 'string') return null;
            if ((op.path === 'layout' || op.path === 'style' || op.path === 'when') && op.value !== undefined && op.value !== null && (typeof op.value !== 'object' || Array.isArray(op.value))) return null;
            return updateBlock(blocks, op.id, block => patched(block, op.path, op.value));
        }
    }
}

/** A short hash of the tree's shape: its block IDs in document order with their depth. */
export function treeHash(blocks: readonly Block[]): string {
    return fnv1a(placeBlocks(blocks).map(place => `${place.depth}:${place.block._id}`).join(',')).toString(16).padStart(8, '0');
}

// --- Rich text ---------------------------------------------------------------------------------

/**
 * The step log of one rich text document, as `prosemirror-collab`'s central authority keeps
 * it: a version that counts the steps applied so far, and the last `max` steps with the
 * clients that made them, so an editor that fell behind can catch up and rebase.
 */
export class StepLog<Step = unknown> {
    #version: number;
    readonly #steps: { step: Step; clientID: number | string }[] = [];
    readonly #max: number;

    constructor(version = 0, max = 500) {
        this.#version = version;
        this.#max = max;
    }

    get version(): number {
        return this.#version;
    }

    /** A batch applies only when it was made against the current version. */
    accepts(version: number): boolean {
        return version === this.#version;
    }

    /** Record steps that applied; the new version. */
    push(steps: readonly Step[], clientID: number | string): number {
        for (const step of steps) this.#steps.push({ step, clientID });
        this.#version += steps.length;
        if (this.#steps.length > this.#max) this.#steps.splice(0, this.#steps.length - this.#max);
        return this.#version;
    }

    /** The steps after `version`, or null when some were dropped from the log: the editor reloads the document. */
    since(version: number): { version: number; steps: Step[]; clientIDs: (number | string)[] } | null {
        if (!Number.isSafeInteger(version) || version < 0 || version > this.#version) return null;
        const missing = this.#version - version;
        if (missing > this.#steps.length) return null;
        const slice = this.#steps.slice(this.#steps.length - missing);
        return { version: this.#version, steps: slice.map(entry => entry.step), clientIDs: slice.map(entry => entry.clientID) };
    }
}
