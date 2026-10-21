/**
 * The shape of stored blocks, shared by field validation and rich text documents, which embed
 * blocks. No imports, so both can use it.
 */
const BLOCK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const BLOCK_TYPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** How many blocks a field holds across its tree, and how deep they nest. */
export const BLOCK_LIMITS = Object.freeze({ count: 200, depth: 4 });
/** Container widths blocks respond to: `sm` below 640px, `md` below 1024px, `lg` from there. */
export const BREAKPOINTS = Object.freeze(['sm', 'md', 'lg'] as const);
export type Breakpoint = (typeof BREAKPOINTS)[number];

/**
 * The shape of a `blocks` value: `{ id, type, data }` items, with `layout` and `children`
 * under a container, at most 200 across the tree and 4 deep. Each block's data is checked
 * against its type separately.
 */
export function blocksShapeProblem(value: unknown): string | undefined {
    if (!Array.isArray(value)) return 'must be a list of at most 200 blocks.';
    const ids = new Set<string>();
    const visit = (list: unknown[], depth: number): string | undefined => {
        if (depth >= BLOCK_LIMITS.depth) return `blocks nest at most ${BLOCK_LIMITS.depth} deep.`;
        for (const block of list) {
            if (!block || typeof block !== 'object' || Array.isArray(block)) return 'must contain blocks.';
            const { id, type, data, layout, children } = block as { id?: unknown; type?: unknown; data?: unknown; layout?: unknown; children?: unknown };
            if (typeof id !== 'string' || !BLOCK_ID.test(id) || ids.has(id)) return 'blocks need distinct IDs.';
            ids.add(id);
            if (ids.size > BLOCK_LIMITS.count) return `must be a list of at most ${BLOCK_LIMITS.count} blocks.`;
            if (typeof type !== 'string' || !BLOCK_TYPE.test(type)) return 'blocks need a type such as core/paragraph.';
            if (!data || typeof data !== 'object' || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) return 'block data must be an object.';
            if (layout !== undefined) {
                const problem = blockLayoutProblem(layout);
                if (problem) return problem;
            }
            if (children !== undefined) {
                if (!Array.isArray(children)) return 'block children must be a list of blocks.';
                const problem = visit(children, depth + 1);
                if (problem) return problem;
            }
        }
        return undefined;
    };
    const problem = visit(value, 0);
    if (problem) return problem;
    if (JSON.stringify(value).length > 512 * 1024) return 'must be at most 512 KB.';
    return undefined;
}

/** The shape of a block's `layout`: `hide` lists breakpoints. */
export function blockLayoutProblem(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return 'block layout must be an object.';
    const { hide } = value as { hide?: unknown };
    if (hide !== undefined && (!Array.isArray(hide) || !hide.every(entry => (BREAKPOINTS as readonly string[]).includes(entry as string)))) return `block layout.hide lists ${BREAKPOINTS.join(', ')}.`;
    return undefined;
}
