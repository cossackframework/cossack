import { describe, expect, it } from 'vitest';
import {
    applyTreeOp, checkPresence, COLLAB_COLORS, expiredPeers, groupPeers, livePeers, parseRichTextPath, participantColor, patchKey, PendingKeys, richTextPath, scalarKey, StepLog, treeHash, treeOps,
    type Block, type PeerState, type TreeOp,
} from '../src/index';

const block = (id: string, type = 'core/paragraph', data: Record<string, unknown> = { text: id }, children?: Block[]): Block => ({ _id: id, type, data, ...(children ? { children } : {}) });
const ids = (blocks: readonly Block[]): unknown => blocks.map(entry => entry.children ? { [entry._id]: ids(entry.children) } : entry._id);

/** Apply ops one by one, as the room does; every op must apply. */
function apply(blocks: readonly Block[], ops: readonly TreeOp[]): Block[] {
    let current: readonly Block[] = blocks;
    for (const op of ops) {
        const next = applyTreeOp(current, op);
        if (!next) throw new Error(`op did not apply: ${JSON.stringify(op)}`);
        current = next;
    }
    return [...current];
}

describe('participants', () => {
    it('colors users from the palette, the same every time', () => {
        expect(participantColor('alice')).toBe(participantColor('alice'));
        expect(COLLAB_COLORS).toContain(participantColor('alice'));
        expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(participantColor)).size).toBeGreaterThan(3);
    });

    it('groups peers by user with their tabs, and drops the silent ones', () => {
        const peer = (id: string, user: string, tab: string | undefined, at: number): PeerState => ({ peer: id, user, name: user.toUpperCase(), avatar: null, color: participantColor(user), at, presence: tab ? { tab } : {} });
        const peers = [peer('1', 'bob', 'edit', 100), peer('2', 'alice', 'seo', 100), peer('3', 'alice', 'edit', 100), peer('4', 'alice', 'edit', 100), peer('5', 'carol', undefined, 0)];
        const live = livePeers(peers, 30_050);
        expect(live.map(entry => entry.peer)).toEqual(['1', '2', '3', '4']);
        expect(expiredPeers(peers, 30_050)).toEqual(['5']);
        expect(groupPeers(live)).toEqual([
            { user: 'alice', name: 'ALICE', avatar: null, color: participantColor('alice'), tabs: ['seo', 'edit'], peers: 3 },
            { user: 'bob', name: 'BOB', avatar: null, color: participantColor('bob'), tabs: ['edit'], peers: 1 },
        ]);
    });

    it('keeps only known, bounded presence from client input', () => {
        expect(checkPresence({ tab: 'edit', field: 'title', block: 'b1', dragging: 'b2', selection: { path: 'content:b1.text', anchor: 3, head: 7 }, extra: 1 }))
            .toEqual({ tab: 'edit', field: 'title', block: 'b1', dragging: 'b2', selection: { path: 'content:b1.text', anchor: 3, head: 7 } });
        expect(checkPresence({ tab: 'x'.repeat(200), field: 7, selection: { path: 'body', anchor: -1, head: 2 } })).toEqual({});
        expect(checkPresence(null)).toEqual({});
        expect(checkPresence('nope')).toEqual({});
    });
});

describe('pending keys', () => {
    it('ignores remote values of a key while a change is in flight, and accepts them after the echo', () => {
        const pending = new PendingKeys();
        expect(pending.accepts(scalarKey('title'))).toBe(true);
        pending.sent(scalarKey('title'));
        pending.sent(scalarKey('title'));
        expect(pending.accepts(scalarKey('title'))).toBe(false);
        expect(pending.accepts(scalarKey('slug'))).toBe(true);
        pending.settled(scalarKey('title'));
        expect(pending.accepts(scalarKey('title'))).toBe(false);
        pending.settled(scalarKey('title'));
        expect(pending.accepts(scalarKey('title'))).toBe(true);
        // An extra settle is harmless.
        pending.settled(scalarKey('title'));
        expect(pending.size).toBe(0);
        expect(patchKey('content', 'b1', 'data.text')).toBe('block:content:b1:data.text');
    });

    it('converges two editors typing in one field through the room', () => {
        // The room applies in arrival order; an editor ignores what arrived before its own last change.
        const room: string[] = [];
        const alice = new PendingKeys();
        let aliceValue = 'A1';
        alice.sent(scalarKey('t'));
        room.push('alice:A1');
        room.push('bob:B1');
        aliceValue = 'A2';
        alice.sent(scalarKey('t'));
        room.push('alice:A2');
        for (const entry of room) {
            const [peer, value] = entry.split(':') as [string, string];
            if (peer === 'alice') alice.settled(scalarKey('t'));
            else if (alice.accepts(scalarKey('t'))) aliceValue = value;
        }
        expect(aliceValue).toBe('A2');
        expect(room.at(-1)).toBe('alice:A2');
    });
});

describe('rich text paths', () => {
    it('names a field or a block field inside it', () => {
        expect(richTextPath('body')).toBe('body');
        expect(richTextPath('content', { id: 'b1', key: 'text' })).toBe('content:b1.text');
        expect(parseRichTextPath('body')).toEqual({ field: 'body' });
        expect(parseRichTextPath('content:b1.text')).toEqual({ field: 'content', block: { id: 'b1', key: 'text' } });
        expect(parseRichTextPath('content:b1')).toBeNull();
    });
});

describe('tree ops', () => {
    const before: Block[] = [block('a'), block('cols', 'core/columns', {}, [block('c1', 'core/column', {}, [block('x')]), block('c2', 'core/column', {}, [block('y'), block('z')])]), block('b')];

    it('finds no ops between equal trees and a hash that follows the shape', () => {
        expect(treeOps('content', before, structuredClone(before))).toEqual([]);
        expect(treeHash(before)).toBe(treeHash(structuredClone(before)));
        expect(treeHash(before)).not.toBe(treeHash([before[1]!, before[0]!, before[2]!]));
        expect(treeHash(before)).toMatch(/^[0-9a-f]{8}$/);
    });

    it('reorders siblings with anchored moves', () => {
        const after = [before[2]!, before[0]!, before[1]!];
        const ops = treeOps('content', before, after);
        expect(ops).toEqual([{ kind: 'move', field: 'content', id: 'b', parent: null, after: null }]);
        expect(ids(apply(before, ops))).toEqual(ids(after));
    });

    it('moves a block into another container, inserts a new one and removes a container with what it holds', () => {
        const after: Block[] = [
            block('a'),
            block('new', 'core/group', {}, [block('n1'), block('y'), block('n2')]),
            block('c2', 'core/column', {}, [block('z'), block('x')]),
        ];
        const ops = treeOps('content', before, after);
        expect(ops.filter(op => op.kind === 'remove').map(op => (op as { id: string }).id).sort()).toEqual(['b', 'cols']);
        // The new group carries its own new children; `y` (kept) gets a move into it.
        const insert = ops.find(op => op.kind === 'insert') as Extract<TreeOp, { kind: 'insert' }>;
        expect(ids([insert.block])).toEqual([{ new: ['n1', 'n2'] }]);
        expect(ops).toContainEqual({ kind: 'move', field: 'content', id: 'y', parent: 'new', after: 'n1' });
        // c2 climbs to the top level, keeps z, and takes x from c1 before cols goes.
        expect(ops).toContainEqual({ kind: 'move', field: 'content', id: 'c2', parent: null, after: 'new' });
        expect(ops).toContainEqual({ kind: 'move', field: 'content', id: 'x', parent: 'c2', after: 'z' });
        expect(ids(apply(before, ops))).toEqual(ids(after));
    });

    it('patches data, layout and style of blocks that stayed, and skips what another log owns', () => {
        const [first, columns, last] = structuredClone(before) as [Block, Block, Block];
        const column = columns.children![1]!;
        const after: Block[] = [
            { ...first, data: { text: 'changed', align: 'center' }, layout: { anchor: 'top' } },
            { ...columns, children: [columns.children![0]!, { ...column, children: [{ ...column.children![0]!, data: {} }, column.children![1]!], style: { padding: 'lg' } }] },
            last,
        ];
        const ops = treeOps('content', before, after);
        expect(ops).toEqual([
            { kind: 'patch', field: 'content', id: 'a', path: 'data.text', value: 'changed' },
            { kind: 'patch', field: 'content', id: 'a', path: 'data.align', value: 'center' },
            { kind: 'patch', field: 'content', id: 'a', path: 'layout', value: { anchor: 'top' } },
            { kind: 'patch', field: 'content', id: 'c2', path: 'style', value: { padding: 'lg' } },
            { kind: 'patch', field: 'content', id: 'y', path: 'data.text' },
        ]);
        expect(apply(before, ops)).toEqual(after);
        expect(treeOps('content', before, after, { skip: (type, key) => type === 'core/paragraph' && key === 'text' }).map(op => (op as { path?: string }).path)).toEqual(['data.align', 'layout', 'style']);
    });

    it('drops ops that no longer apply and keeps the tree whole', () => {
        expect(applyTreeOp(before, { kind: 'remove', field: 'content', id: 'gone' })).toBeNull();
        expect(applyTreeOp(before, { kind: 'move', field: 'content', id: 'gone', parent: null, after: null })).toBeNull();
        expect(applyTreeOp(before, { kind: 'move', field: 'content', id: 'cols', parent: 'c1', after: null })).toBeNull();
        expect(applyTreeOp(before, { kind: 'insert', field: 'content', block: block('a'), parent: null, after: null })).toBeNull();
        expect(applyTreeOp(before, { kind: 'insert', field: 'content', block: block('q'), parent: 'gone', after: null })).toBeNull();
        expect(applyTreeOp(before, { kind: 'insert', field: 'content', block: { _id: 'bad id!', type: 'core/paragraph', data: {} }, parent: null, after: null })).toBeNull();
        expect(applyTreeOp(before, { kind: 'patch', field: 'content', id: 'a', path: 'constructor', value: 1 })).toBeNull();
        expect(applyTreeOp(before, { kind: 'patch', field: 'content', id: 'a', path: 'style', value: 'loud' })).toBeNull();
        // An anchor that went away puts the block last in its parent.
        const moved = applyTreeOp(before, { kind: 'move', field: 'content', id: 'a', parent: 'c1', after: 'gone' })!;
        expect(ids(moved)).toEqual([{ cols: [{ c1: ['x', 'a'] }, { c2: ['y', 'z'] }] }, 'b']);
    });

    it('lets two editors change different blocks at once, in either order', () => {
        const alice = treeOps('content', before, [before[0]!, before[1]!, block('b', 'core/paragraph', { text: 'Alice' })]);
        const bob = treeOps('content', before, [before[1]!, before[0]!, before[2]!]);
        const one = apply(apply(before, alice), bob);
        const other = apply(apply(before, bob), alice);
        expect(one).toEqual(other);
        expect(ids(one)).toEqual([{ cols: [{ c1: ['x'] }, { c2: ['y', 'z'] }] }, 'a', 'b']);
        expect(one[2]!.data.text).toBe('Alice');
    });
});

describe('step log', () => {
    it('accepts batches against the current version alone and serves the steps an editor lacks', () => {
        const log = new StepLog<string>(0, 3);
        expect(log.accepts(0)).toBe(true);
        expect(log.push(['s1', 's2'], 7)).toBe(2);
        expect(log.accepts(0)).toBe(false);
        expect(log.accepts(2)).toBe(true);
        expect(log.since(0)).toEqual({ version: 2, steps: ['s1', 's2'], clientIDs: [7, 7] });
        expect(log.since(1)).toEqual({ version: 2, steps: ['s2'], clientIDs: [7] });
        expect(log.since(2)).toEqual({ version: 2, steps: [], clientIDs: [] });
        log.push(['s3', 's4'], 'bob');
        // Only the last three steps are kept: version 0 is too far back.
        expect(log.since(0)).toBeNull();
        expect(log.since(1)).toEqual({ version: 4, steps: ['s2', 's3', 's4'], clientIDs: [7, 'bob', 'bob'] });
        expect(log.since(5)).toBeNull();
        expect(log.since(-1)).toBeNull();
    });
});
