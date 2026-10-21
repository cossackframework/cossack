/**
 * Blocks as menu rows with depths, so a tree moves with the menu editor's drag code; shared by
 * the site editor and the dashboard's block tree. Client-safe.
 */
import { blockTreeProblem, moveRows, placeBlocks, type BlockDeclaration, type MenuRow } from '@cossackframework/cms';
import type { EditorBlock } from './editor';

/** The tree as menu rows with depths, so blocks move with the menu editor's drag code. */
export function blockRows(blocks: readonly EditorBlock[]): MenuRow[] {
    return placeBlocks(blocks).map(place => ({ id: place.block.id, kind: 'link', label: '', depth: place.depth }) as MenuRow);
}

/** The tree the rows describe: each row's block under the nearest shallower row above it. */
export function nestRows(rows: readonly MenuRow[], blocks: readonly EditorBlock[]): EditorBlock[] {
    const index = new Map(placeBlocks(blocks).map(place => [place.block.id, place.block]));
    const top: EditorBlock[] = [];
    const stack: { block: EditorBlock; depth: number }[] = [];
    for (const row of rows) {
        const block: EditorBlock = { ...index.get(row.id)!, children: [] };
        while (stack.length && stack.at(-1)!.depth >= row.depth) stack.pop();
        const parent = stack.at(-1);
        if (parent) parent.block.children!.push(block); else top.push(block);
        stack.push({ block, depth: row.depth });
    }
    // Leaves have no children list; a container keeps an empty one.
    const tidy = (list: EditorBlock[]): EditorBlock[] => list.map(block => {
        const children = tidy(block.children ?? []);
        return children.length || index.get(block.id)?.children ? { ...block, children } : (({ children: _, ...rest }) => rest)(block);
    });
    return tidy(top);
}

/**
 * Move the block at row `from` to sit at row `to` of the rows without it, at `depth`, as a
 * drag drops it. The blocks are unchanged when the types do not allow the result.
 */
export function reorderBlocks(blocks: readonly EditorBlock[], from: number, to: number, depth: number, types: ReadonlyMap<string, BlockDeclaration>): EditorBlock[] {
    const rows = blockRows(blocks);
    const moved = moveRows(rows, from, to, depth);
    if (moved.every((row, position) => row.id === rows[position]?.id && row.depth === rows[position]?.depth)) return [...blocks];
    const next = nestRows(moved, blocks);
    return blockTreeProblem(next, types) ? [...blocks] : next;
}

