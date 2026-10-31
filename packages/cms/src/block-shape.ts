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
/** Style properties every block may carry, outside its type's data, and the preset kind each takes. */
export const STYLE_PROPERTIES = Object.freeze({ background: 'color', text: 'color', padding: 'spacing', margin: 'spacing', fontSize: 'typography', align: 'typography' } as const);
export type StyleProperty = keyof typeof STYLE_PROPERTIES;
export const TEXT_ALIGNMENTS = Object.freeze(['left', 'center', 'right'] as const);
/** A preset's slug: lowercase letters, digits and hyphens. */
export const PRESET_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ANCHOR = /^[A-Za-z][\w-]{0,59}$/;
/** A form input's name: a lowercase letter, then letters and digits, as field names are. */
export const INPUT_NAME = /^[a-z][a-zA-Z0-9]{0,39}$/;
/** How a condition compares an input's value. */
export const CONDITION_OPERATORS = Object.freeze(['is', 'isNot', 'contains', 'empty', 'notEmpty', 'gt', 'lt', 'in'] as const);
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
/** Rules a block's condition holds. */
export const CONDITION_LIMIT = 10;
const CLASS_NAME = /^-?[_A-Za-z][\w-]*$/;

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
            const { _id: id, type, data, layout, style, when, children } = block as { _id?: unknown; type?: unknown; data?: unknown; layout?: unknown; style?: unknown; when?: unknown; children?: unknown };
            if (typeof id !== 'string' || !BLOCK_ID.test(id) || ids.has(id)) return 'blocks need distinct IDs.';
            ids.add(id);
            if (ids.size > BLOCK_LIMITS.count) return `must be a list of at most ${BLOCK_LIMITS.count} blocks.`;
            if (typeof type !== 'string' || !BLOCK_TYPE.test(type)) return 'blocks need a type such as core/paragraph.';
            if (!data || typeof data !== 'object' || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) return 'block data must be an object.';
            if (layout !== undefined) {
                const problem = blockLayoutProblem(layout);
                if (problem) return problem;
            }
            if (style !== undefined) {
                const problem = blockStyleProblem(style);
                if (problem) return problem;
            }
            if (when !== undefined) {
                const problem = blockConditionProblem(when);
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

/** The shape of a block's `layout`: `hide` lists breakpoints; `anchor` is an HTML id; `className` lists class names; `nosnippet` keeps it out of snippets. */
export function blockLayoutProblem(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return 'block layout must be an object.';
    const { hide, anchor, className, nosnippet } = value as { hide?: unknown; anchor?: unknown; className?: unknown; nosnippet?: unknown };
    if (nosnippet !== undefined && typeof nosnippet !== 'boolean') return 'block layout.nosnippet is on or off.';
    if (hide !== undefined && (!Array.isArray(hide) || !hide.every(entry => (BREAKPOINTS as readonly string[]).includes(entry as string)))) return `block layout.hide lists ${BREAKPOINTS.join(', ')}.`;
    if (anchor !== undefined && anchor !== '' && (typeof anchor !== 'string' || !ANCHOR.test(anchor))) return 'block layout.anchor is an HTML id: a letter, then up to 59 letters, digits, _ or -.';
    if (className !== undefined && className !== '' && (typeof className !== 'string' || className.length > 200 || !className.trim().split(/\s+/).every(name => CLASS_NAME.test(name)))) return 'block layout.className lists class names, at most 200 characters.';
    return undefined;
}

/** The shape of a block's `style`: preset slugs per property, and an alignment. */
export function blockStyleProblem(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return 'block style must be an object.';
    for (const [property, entry] of Object.entries(value)) {
        if (!Object.hasOwn(STYLE_PROPERTIES, property)) return `block style has no ${property}; it takes ${Object.keys(STYLE_PROPERTIES).join(', ')}.`;
        if (entry === undefined || entry === '') continue;
        if (property === 'align' ? !(TEXT_ALIGNMENTS as readonly string[]).includes(entry as string) : typeof entry !== 'string' || entry.length > 40 || !PRESET_SLUG.test(entry)) {
            return property === 'align' ? `block style.align is ${TEXT_ALIGNMENTS.join(', ')}.` : `block style.${property} is a preset slug.`;
        }
    }
    return undefined;
}

/**
 * The shape of a block's `when`: show (or hide) the block when all or any of its rules match
 * the values of the form's inputs. `value` is text; `in` takes a comma-separated list.
 */
export function blockConditionProblem(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return 'block when must be an object.';
    const { action, match, rules, ...rest } = value as { action?: unknown; match?: unknown; rules?: unknown };
    if (Object.keys(rest).length) return 'block when takes action, match and rules.';
    if (action !== undefined && action !== 'show' && action !== 'hide') return 'block when.action is show or hide.';
    if (match !== undefined && match !== 'all' && match !== 'any') return 'block when.match is all or any.';
    if (!Array.isArray(rules) || !rules.length || rules.length > CONDITION_LIMIT) return `block when.rules lists 1 to ${CONDITION_LIMIT} rules.`;
    for (const rule of rules) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return 'block when.rules holds rules.';
        const { field, op, value: expected, ...extra } = rule as { field?: unknown; op?: unknown; value?: unknown };
        if (Object.keys(extra).length) return 'a condition rule takes field, op and value.';
        if (typeof field !== 'string' || !INPUT_NAME.test(field)) return 'a condition rule names a form field.';
        if (!(CONDITION_OPERATORS as readonly string[]).includes(op as string)) return `a condition rule's op is one of ${CONDITION_OPERATORS.join(', ')}.`;
        if (expected !== undefined && (typeof expected !== 'string' || expected.length > 500)) return 'a condition rule\'s value is text of at most 500 characters.';
    }
    return undefined;
}
