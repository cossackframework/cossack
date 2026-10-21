/**
 * Blocks: ordered, typed content sections stored in a `blocks` field as `{ id, type, data }`,
 * with `children` under a container and `layout` for how a block shows. A block type declares
 * its fields like a collection does, and which blocks it holds. The host validates every
 * block's data on write; the site renders each type with its own component. Layouts are
 * blocks: a group, columns and a grid hold other blocks, so one tree is stored, edited,
 * diffed and shared as a pattern.
 */
import { field, slugify, validateValue, type FieldDeclaration } from './fields';

export { blocksShapeProblem, blockLayoutProblem, blockStyleProblem, blockConditionProblem, BLOCK_LIMITS, BREAKPOINTS, STYLE_PROPERTIES, TEXT_ALIGNMENTS, PRESET_SLUG, INPUT_NAME, CONDITION_OPERATORS, CONDITION_LIMIT,
    type Breakpoint, type StyleProperty, type ConditionOperator } from './block-shape';
import { BLOCK_LIMITS, BREAKPOINTS, INPUT_NAME, STYLE_PROPERTIES, TEXT_ALIGNMENTS, type Breakpoint, type ConditionOperator, type StyleProperty } from './block-shape';

/**
 * What a form input collects, which decides how its value is checked and stored: text of a
 * kind, a number, a yes or no, a `YYYY-MM-DD` date, one of the block's options or several.
 */
export const INPUT_KINDS = Object.freeze(['string', 'text', 'email', 'url', 'phone', 'number', 'boolean', 'date', 'choice', 'choices'] as const);
export type InputKind = (typeof INPUT_KINDS)[number];

/** A form holds at most this many inputs. */
export const FORM_INPUT_LIMIT = 48;
/** Input names a submission keeps for itself. */
export const RESERVED_INPUT_NAMES: ReadonlySet<string> = new Set(['id', 'rev', 'owner', 'createdAt', 'updatedAt', 'status', 'note', 'meta', 'form']);

/**
 * Which style properties a block type offers, as Gutenberg's block supports: `true` for all
 * of a kind, a list for some, `false` for none. Absent kinds follow the category's defaults.
 */
export interface BlockSupports {
    readonly color?: boolean | readonly ('background' | 'text')[];
    readonly spacing?: boolean | readonly ('padding' | 'margin')[];
    readonly typography?: boolean | readonly ('fontSize' | 'align')[];
}

export interface BlockDeclaration {
    /** `<owner>/<name>`, such as `core/paragraph` or `support-desk/ticket-form`. */
    readonly name: string;
    readonly label: string;
    readonly description?: string;
    /** Solar icon name for the block picker, such as `text-field`. Unknown names show a generic icon. */
    readonly icon?: string;
    /** The block picker's group. Default `widgets`. */
    readonly category?: BlockCategory;
    readonly fields: { readonly [name: string]: FieldDeclaration };
    /** The block holds other blocks: those named, or any, up to `max`. Absent for a leaf block. */
    readonly children?: { readonly allowed?: readonly string[]; readonly max?: number };
    /** The block goes only inside these types, as a column goes inside columns. Pickers offer it there alone. */
    readonly parent?: readonly string[];
    /** The Style tab's controls; the category decides when absent. See `blockSupports`. */
    readonly supports?: BlockSupports;
    /**
     * The block is a form input: it collects one value under its `name` data field, labelled by
     * its `label`. Input blocks go only in a form's blocks field.
     */
    readonly input?: { readonly kind: InputKind };
}

/** One test of a condition: an input's value against `value`. */
export interface ConditionRule {
    /** The input's name. */
    readonly field: string;
    readonly op: ConditionOperator;
    readonly value?: string;
}

/** When a block in a form shows: if `all` (the default) or `any` rule matches; `hide` turns it around. */
export interface BlockCondition {
    readonly action?: 'show' | 'hide';
    readonly match?: 'all' | 'any';
    readonly rules: readonly ConditionRule[];
}

/** How a block shows, apart from its type's data. Checked by core for every block. */
export interface BlockLayout {
    /** Container widths the block is hidden at: `sm` below 640px, `md` below 1024px, `lg` from there. */
    readonly hide?: readonly Breakpoint[];
    /** The block's HTML id, for in-page links. */
    readonly anchor?: string;
    /** Extra class names on the block's wrapper, for the theme's stylesheet. */
    readonly className?: string;
}

/** A block's style: slugs of the theme's presets, and a text alignment. Rendered as classes and custom properties. */
export interface BlockStyle {
    readonly background?: string;
    readonly text?: string;
    readonly padding?: string;
    readonly margin?: string;
    readonly fontSize?: string;
    readonly align?: (typeof TEXT_ALIGNMENTS)[number];
}

export interface Block {
    /** Stable within its field: 1-40 letters, digits, `_` or `-`; distinct across the whole tree. */
    readonly id: string;
    readonly type: string;
    readonly data: { readonly [field: string]: unknown };
    readonly layout?: BlockLayout;
    readonly style?: BlockStyle;
    /** In a form: when the block shows, from the values of the form's inputs. */
    readonly when?: BlockCondition;
    /** The blocks inside a container. */
    readonly children?: readonly Block[];
}

/** Groups of the block picker, in its order, as in WordPress. */
export const BLOCK_CATEGORIES = Object.freeze([
    { id: 'text', label: 'Text' },
    { id: 'media', label: 'Media' },
    { id: 'design', label: 'Design' },
    { id: 'widgets', label: 'Widgets' },
    { id: 'embeds', label: 'Embeds' },
    { id: 'form', label: 'Form fields' },
] as const);
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number]['id'];

/** A block's category, `widgets` when it names none. */
export function blockCategory(declaration: Pick<BlockDeclaration, 'category'>): BlockCategory {
    return declaration.category ?? 'widgets';
}

const SUPPORT_KINDS = Object.freeze({ color: ['background', 'text'], spacing: ['padding', 'margin'], typography: ['fontSize', 'align'] } as const);
type SupportKind = keyof typeof SUPPORT_KINDS;

/**
 * The style properties a block type offers: its `supports` over the category's defaults.
 * Text blocks get colour, spacing and typography; media blocks spacing alone; the rest
 * colour and spacing.
 */
export function blockSupports(declaration: Pick<BlockDeclaration, 'category' | 'supports'>): readonly StyleProperty[] {
    const category = blockCategory(declaration);
    const defaults: Record<SupportKind, boolean> = { color: category !== 'media', spacing: true, typography: category === 'text' };
    const properties: StyleProperty[] = [];
    for (const kind of Object.keys(SUPPORT_KINDS) as SupportKind[]) {
        const support = declaration.supports?.[kind] ?? defaults[kind];
        if (support === false) continue;
        for (const property of SUPPORT_KINDS[kind]) if (support === true || (Array.isArray(support) && (support as readonly string[]).includes(property))) properties.push(property);
    }
    return properties;
}

export const BLOCK_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Field kinds a block can hold. Nesting is through `children`, not fields. */
const BLOCK_FIELD_KINDS = new Set(['string', 'text', 'enum', 'integer', 'number', 'boolean', 'datetime', 'list', 'json']);

const GAP = field.enum(['none', 'small', 'medium', 'large'], { default: 'medium', label: 'Gap' });

/** Built-in block types. */
const core: BlockDeclaration[] = [
    { name: 'core/paragraph', label: 'Paragraph', icon: 'paragraph-spacing', category: 'text', fields: { text: field.text({ required: true, max: 20_000, format: 'markdown', label: 'Text' }) } },
    { name: 'core/heading', label: 'Heading', icon: 'text-bold', category: 'text', fields: {
        text: field.string({ required: true, max: 200, label: 'Text' }),
        level: field.enum(['h2', 'h3', 'h4'], { default: 'h2', label: 'Level' }),
    } },
    { name: 'core/image', label: 'Image', icon: 'gallery', category: 'media', fields: {
        image: field.media({ required: true, nullable: false, label: 'Image' }),
        caption: field.string({ max: 300, label: 'Caption' }),
        link: field.string({ max: 2048, pattern: '(?:https?://|/)\\S*', label: 'Link' }),
    } },
    { name: 'core/gallery', label: 'Gallery', icon: 'gallery-wide', category: 'media', fields: {
        images: { ...field.list('string', { label: 'Images' }), media: true },
        columns: field.integer({ default: 3, min: 1, max: 6, label: 'Columns' }),
    } },
    { name: 'core/quote', label: 'Quote', icon: 'chat-round-line', category: 'text', fields: {
        text: field.text({ required: true, max: 2000, label: 'Quote' }),
        citation: field.string({ max: 200, label: 'Citation' }),
    } },
    { name: 'core/list', label: 'List', icon: 'list', category: 'text', fields: {
        items: field.list('string', { label: 'Items', description: 'One item per line.' }),
        ordered: field.boolean({ default: false, label: 'Numbered' }),
    } },
    { name: 'core/code', label: 'Code', icon: 'code-square', category: 'text', fields: {
        code: field.text({ required: true, max: 20_000, label: 'Code' }),
        language: field.string({ max: 40, pattern: '[a-z0-9+#-]*', label: 'Language' }),
    } },
    { name: 'core/button', label: 'Button', icon: 'cursor-square', category: 'design', fields: {
        label: field.string({ required: true, max: 80, label: 'Label' }),
        url: field.string({ required: true, max: 2048, pattern: '(?:https?://|/|mailto:)\\S*', label: 'URL' }),
        style: field.enum(['primary', 'outline'], { default: 'primary', label: 'Style' }),
    } },
    { name: 'core/embed', label: 'Video embed', icon: 'play-circle', category: 'embeds', description: 'A YouTube or Vimeo video.', fields: {
        url: field.string({ required: true, max: 2048, pattern: 'https://(?:www\\.)?(?:youtube\\.com/watch\\?v=|youtu\\.be/|vimeo\\.com/)\\S+', label: 'Video URL' }),
        caption: field.string({ max: 300, label: 'Caption' }),
    } },
    { name: 'core/divider', label: 'Divider', icon: 'minus-square', category: 'design', fields: {} },
    // Layout: containers that hold other blocks. They render as CSS grid and respond to the
    // width of the content they are in, so columns inside a column stack on their own.
    { name: 'core/group', label: 'Group', icon: 'layers', category: 'design', description: 'A stack of blocks with one width.', fields: {
        align: field.enum(['full', 'wide', 'center', 'left', 'right'], { default: 'full', label: 'Width', choices: { full: 'Full width', wide: 'Wide', center: 'Narrow, centered', left: 'Narrow, left', right: 'Narrow, right' } }),
    }, children: {} },
    { name: 'core/columns', label: 'Columns', icon: 'widget-2', category: 'design', description: 'Blocks side by side; they stack on small screens.', fields: {
        gap: GAP,
        stack: field.enum(['mobile', 'tablet', 'never'], { default: 'mobile', label: 'Stack', choices: { mobile: 'On phones', tablet: 'On phones and tablets', never: 'Never' } }),
    }, children: { allowed: ['core/column'], max: 6 } },
    { name: 'core/column', label: 'Column', icon: 'widget', category: 'design', parent: ['core/columns'], fields: {
        span: field.integer({ min: 1, max: 12, label: 'Width', description: 'Out of 12; empty shares the space equally.' }),
        verticalAlign: field.enum(['top', 'center', 'bottom'], { default: 'top', label: 'Vertical alignment' }),
    }, children: {} },
    { name: 'core/grid', label: 'Grid', icon: 'widget-3', category: 'design', description: 'Blocks in equal cells.', fields: {
        columns: field.integer({ default: 3, min: 1, max: 6, label: 'Columns' }),
        columnsMd: field.integer({ default: 2, min: 1, max: 6, label: 'Columns on tablets' }),
        columnsSm: field.integer({ default: 1, min: 1, max: 6, label: 'Columns on phones' }),
        gap: GAP,
    }, children: { max: 24 } },
    // A synced pattern: the site renders the pattern's current content in its place.
    { name: 'core/pattern', label: 'Pattern', icon: 'widget-add', category: 'design', description: 'A synced pattern.', fields: {
        pattern: field.string({ required: true, max: 80, pattern: '[A-Za-z0-9_-]{1,80}', label: 'Pattern' }),
    } },
];
export const CORE_BLOCKS: readonly BlockDeclaration[] = Object.freeze(core);

/** Problems in a block type declaration; empty when valid. */
export function blockProblems(declaration: BlockDeclaration, owner?: string): string[] {
    const problems: string[] = [];
    const at = `block ${String(declaration?.name)}`;
    if (typeof declaration?.name !== 'string' || !BLOCK_NAME.test(declaration.name)) problems.push(`${at}: names are <owner>/<name> in lowercase with hyphens.`);
    else if (owner && !declaration.name.startsWith(`${owner}/`)) problems.push(`${at}: must be named ${owner}/<name>.`);
    if (typeof declaration?.label !== 'string' || !declaration.label.trim() || declaration.label.length > 80) problems.push(`${at}: needs a label of at most 80 characters.`);
    if (declaration?.icon !== undefined && (typeof declaration.icon !== 'string' || declaration.icon.length > 60 || !ICON_NAME.test(declaration.icon))) problems.push(`${at}: icons are Solar icon names, such as text-field.`);
    if (declaration?.category !== undefined && !BLOCK_CATEGORIES.some(category => category.id === declaration.category)) {
        problems.push(`${at}: the category is one of ${BLOCK_CATEGORIES.map(category => category.id).join(', ')}.`);
    }
    const fields = Object.entries(declaration?.fields ?? {});
    if (fields.length > 16) problems.push(`${at}: declare at most 16 fields.`);
    for (const [name, entry] of fields) {
        if (!BLOCK_FIELD_KINDS.has(entry.kind)) problems.push(`${at}: field ${name} cannot be ${entry.kind}.`);
        if (entry.unique || entry.index || entry.search || entry.slugFrom || entry.taxonomy) problems.push(`${at}: field ${name} cannot be indexed, searched or derived.`);
    }
    const children = declaration?.children;
    if (children !== undefined) {
        if (!children || typeof children !== 'object' || Array.isArray(children)) problems.push(`${at}: children is an object.`);
        else {
            if (children.allowed !== undefined && (!Array.isArray(children.allowed) || !children.allowed.every(name => typeof name === 'string' && BLOCK_NAME.test(name)))) problems.push(`${at}: children.allowed lists block names.`);
            if (children.max !== undefined && (!Number.isInteger(children.max) || children.max < 1 || children.max > BLOCK_LIMITS.count)) problems.push(`${at}: children.max is 1 to ${BLOCK_LIMITS.count}.`);
        }
    }
    const input = declaration?.input;
    if (input !== undefined) {
        if (!input || typeof input !== 'object' || !(INPUT_KINDS as readonly string[]).includes(input.kind)) problems.push(`${at}: input.kind is one of ${INPUT_KINDS.join(', ')}.`);
        if (declaration.fields?.name?.kind !== 'string' || declaration.fields?.label?.kind !== 'string') problems.push(`${at}: an input block declares string fields name and label.`);
        if (declaration.children !== undefined) problems.push(`${at}: an input block cannot hold blocks.`);
    }
    if (declaration?.parent !== undefined && (!Array.isArray(declaration.parent) || !declaration.parent.length || !declaration.parent.every(name => typeof name === 'string' && BLOCK_NAME.test(name)))) {
        problems.push(`${at}: parent lists block names.`);
    }
    const supports = declaration?.supports;
    if (supports !== undefined) {
        if (!supports || typeof supports !== 'object' || Array.isArray(supports)) problems.push(`${at}: supports is an object.`);
        else for (const [kind, support] of Object.entries(supports)) {
            const known = (SUPPORT_KINDS as Record<string, readonly string[] | undefined>)[kind];
            if (!known) problems.push(`${at}: supports has no ${kind}; it takes ${Object.keys(SUPPORT_KINDS).join(', ')}.`);
            else if (typeof support !== 'boolean' && (!Array.isArray(support) || !support.every(property => known.includes(property as string)))) problems.push(`${at}: supports.${kind} is true, false or some of ${known.join(', ')}.`);
        }
    }
    return problems;
}

/** Whether `type` may go directly inside a block of `parent` (null for the top level), by their declarations. */
export function blockAllowedIn(types: ReadonlyMap<string, BlockDeclaration>, type: string, parent: string | null): boolean {
    const declaration = types.get(type);
    if (!declaration) return false;
    if (declaration.parent && (!parent || !declaration.parent.includes(parent))) return false;
    if (parent === null) return true;
    const container = types.get(parent)?.children;
    return !!container && (!container.allowed || container.allowed.includes(type));
}

export interface ValidateBlocksOptions {
    /** Block types allowed at the top level; all when empty. */
    readonly allowed?: readonly string[];
    /** The field holds a form: input blocks and conditions are allowed, and checked as a whole. */
    readonly form?: boolean;
}

/**
 * Validate blocks against their types. Returns the blocks with defaults applied and unknown
 * data removed, or errors keyed by `<block id>.<field>`, or `<block id>` for a block that is
 * not available or does not fit where it is. In a form, an input without a name takes one
 * from its label; names must be distinct and conditions must name the form's inputs.
 */
export function validateBlocks(value: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, options: ValidateBlocksOptions = {}): { blocks: Block[]; errors: { [path: string]: string } } {
    const errors: { [path: string]: string } = {};
    const { allowed, form = false } = options;
    // Names given in the tree, so a name taken from a label does not take one of them.
    const taken = new Set(form ? flattenBlocks(value).filter(block => types.get(block.type)?.input).map(block => block.data.name).filter((name): name is string => typeof name === 'string' && name.trim() !== '') : []);
    const visit = (list: readonly Block[], parent: string | null): Block[] => {
        const blocks: Block[] = [];
        for (const block of list) {
            const type = types.get(block.type);
            if (!type || (parent === null && allowed && allowed.length && !allowed.includes(block.type))) { errors[block.id] = `${block.type} is not an available block.`; continue; }
            if (!blockAllowedIn(types, block.type, parent)) { errors[block.id] = parent ? `${block.type} cannot go inside ${parent}.` : `${block.type} goes inside ${type.parent?.join(' or ')}.`; continue; }
            if (type.input && !form) { errors[block.id] = `${block.type} goes only in a form.`; continue; }
            if (block.when !== undefined && !form) { errors[block.id] = 'conditions apply only in forms.'; continue; }
            let source = block.data;
            if (type.input && (typeof source.name !== 'string' || !source.name.trim())) {
                const name = uniqueInputName(inputName(typeof source.label === 'string' ? source.label : ''), taken);
                taken.add(name);
                source = { ...source, name };
            }
            const data: { [field: string]: unknown } = {};
            for (const [name, declaration] of Object.entries(type.fields)) {
                const entry = source[name];
                if (entry === undefined || entry === '' || entry === null) {
                    if (declaration.default !== undefined) data[name] = declaration.default;
                    else if (declaration.required) errors[`${block.id}.${name}`] = 'is required.';
                    continue;
                }
                const error = validateValue(name, declaration, entry);
                if (error) errors[`${block.id}.${name}`] = error;
                else data[name] = entry;
            }
            const children = block.children ?? [];
            if (children.length && !type.children) { errors[block.id] = `${block.type} does not hold blocks.`; continue; }
            if (type.children?.max !== undefined && children.length > type.children.max) { errors[block.id] = `holds at most ${type.children.max} blocks.`; continue; }
            const layout = blockLayoutOf(block);
            const style = blockStyleOf(block, blockSupports(type));
            const when = block.when ? blockConditionOf(block.when) : undefined;
            blocks.push(Object.freeze({
                id: block.id, type: block.type, data: Object.freeze(data),
                ...(layout ? { layout } : {}),
                ...(style ? { style } : {}),
                ...(when ? { when } : {}),
                ...(type.children ? { children: Object.freeze(visit(children, block.type)) } : {}),
            }));
        }
        return blocks;
    };
    const blocks = visit(value, null);
    if (form) Object.assign(errors, formTreeErrors(blocks, types));
    return { blocks, errors };
}

/** A form's own rules: at most 48 inputs, distinct names that are not reserved, conditions on its inputs. */
function formTreeErrors(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>): { [path: string]: string } {
    const errors: { [path: string]: string } = {};
    const all = flattenBlocks(blocks);
    const inputs = all.filter(block => types.get(block.type)?.input);
    if (inputs.length > FORM_INPUT_LIMIT) errors[inputs[FORM_INPUT_LIMIT]!.id] = `A form holds at most ${FORM_INPUT_LIMIT} fields.`;
    const named = new Map<string, Block>();
    for (const block of inputs) {
        const name = block.data.name as string;
        if (RESERVED_INPUT_NAMES.has(name)) errors[`${block.id}.name`] = 'is reserved for the submission.';
        else if (named.has(name)) errors[`${block.id}.name`] = 'is used by another field.';
        else named.set(name, block);
    }
    for (const block of all) {
        for (const rule of block.when?.rules ?? []) {
            const target = named.get(rule.field);
            if (!target) errors[block.id] = `shows on ${rule.field}, which is not a field of this form.`;
            else if (target === block) errors[block.id] = 'cannot show on its own value.';
        }
    }
    return errors;
}

/** An input name from a label: camel case, starting with a letter, at most 40 characters. */
export function inputName(label: string): string {
    const words = slugify(label, 80).split('-').filter(Boolean);
    let name = words.map((word, index) => index ? word.charAt(0).toUpperCase() + word.slice(1) : word).join('');
    if (!/^[a-z]/.test(name)) name = `field${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    name = name.slice(0, 40);
    return RESERVED_INPUT_NAMES.has(name) ? `${name}Field` : name;
}

/** `name`, or `name2`, `name3`, … when it is taken. */
function uniqueInputName(name: string, taken: ReadonlySet<string>): string {
    if (!taken.has(name)) return name;
    for (let suffix = 2; ; suffix++) {
        const candidate = `${name.slice(0, 40 - String(suffix).length)}${suffix}`;
        if (!taken.has(candidate)) return candidate;
    }
}

/** A condition with its defaults left out and values dropped where the operator takes none. */
function blockConditionOf(when: BlockCondition): BlockCondition {
    return Object.freeze({
        ...(when.action === 'hide' ? { action: 'hide' as const } : {}),
        ...(when.match === 'any' ? { match: 'any' as const } : {}),
        rules: Object.freeze(when.rules.map(rule => Object.freeze({
            field: rule.field, op: rule.op,
            ...(rule.op !== 'empty' && rule.op !== 'notEmpty' && rule.value !== undefined ? { value: rule.value } : {}),
        }))),
    });
}

/** A block's `layout` with `hide` in breakpoint order and empty extras dropped; undefined when it has none. */
function blockLayoutOf(block: Block): BlockLayout | undefined {
    const hide = block.layout?.hide?.filter((entry, index, all) => all.indexOf(entry) === index);
    const anchor = block.layout?.anchor?.trim();
    const className = block.layout?.className?.trim().split(/\s+/).filter(Boolean).join(' ');
    const layout = {
        ...(hide?.length ? { hide: Object.freeze([...BREAKPOINTS].filter(breakpoint => hide.includes(breakpoint))) } : {}),
        ...(anchor ? { anchor } : {}), ...(className ? { className } : {}),
    };
    return Object.keys(layout).length ? Object.freeze(layout) : undefined;
}

/** A block's `style` with the properties its type supports; undefined when none is set. */
function blockStyleOf(block: Block, supports: readonly StyleProperty[]): BlockStyle | undefined {
    const style: Record<string, string> = {};
    for (const property of supports) {
        const value = block.style?.[property];
        if (typeof value === 'string' && value) style[property] = value;
    }
    return Object.keys(style).length ? Object.freeze(style) as BlockStyle : undefined;
}

/** Media file IDs referenced by blocks, nested ones included, for existence checks. */
export function blockMedia(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>): string[] {
    const ids: string[] = [];
    for (const block of flattenBlocks(blocks)) {
        for (const [name, declaration] of Object.entries(types.get(block.type)?.fields ?? {})) {
            if (!declaration.media) continue;
            const value = block.data[name];
            if (typeof value === 'string') ids.push(value);
            else if (Array.isArray(value)) ids.push(...value.filter((item): item is string => typeof item === 'string'));
        }
    }
    return [...new Set(ids)];
}

/** A new block ID. */
export function blockId(): string {
    return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
}

// --- The tree, for editors ---------------------------------------------------------

/** Every block of a tree in document order, with where it sits. */
export interface BlockPlace<T extends Block = Block> {
    readonly block: T;
    readonly depth: number;
    /** The container's ID, or null at the top level. */
    readonly parent: string | null;
    /** Its position among its siblings. */
    readonly index: number;
}

/** The blocks of a tree in document order. */
export function flattenBlocks<T extends Block>(blocks: readonly T[]): T[] {
    return placeBlocks(blocks).map(place => place.block);
}

/** The blocks of a tree in document order, with their depth, parent and index. */
export function placeBlocks<T extends Block>(blocks: readonly T[], parent: string | null = null, depth = 0): BlockPlace<T>[] {
    return blocks.flatMap((block, index) => [{ block, depth, parent, index }, ...placeBlocks((block.children ?? []) as readonly T[], block.id, depth + 1)]);
}

/** The block with an ID anywhere in the tree. */
export function findBlock<T extends Block>(blocks: readonly T[], id: string): T | undefined {
    return flattenBlocks(blocks).find(block => block.id === id);
}

/** The tree with one block replaced by what `change` returns for it. */
export function updateBlock<T extends Block>(blocks: readonly T[], id: string, change: (block: T) => T): T[] {
    return blocks.map(block => block.id === id ? change(block) : block.children ? { ...block, children: updateBlock(block.children as readonly T[], id, change) } : block);
}

/** The tree without one block and what it held. */
export function removeBlock<T extends Block>(blocks: readonly T[], id: string): T[] {
    return blocks.filter(block => block.id !== id).map(block => block.children ? { ...block, children: removeBlock(block.children as readonly T[], id) } : block);
}

/** The tree with a block inserted under `parent` (null for the top level) at `index`, or last. */
export function insertBlock<T extends Block>(blocks: readonly T[], parent: string | null, block: T, index?: number): T[] {
    const at = (list: readonly T[]): T[] => {
        const position = index === undefined ? list.length : Math.min(Math.max(index, 0), list.length);
        return [...list.slice(0, position), block, ...list.slice(position)];
    };
    if (parent === null) return at(blocks);
    return blocks.map(entry => entry.id === parent ? { ...entry, children: at((entry.children ?? []) as readonly T[]) }
        : entry.children ? { ...entry, children: insertBlock(entry.children as readonly T[], parent, block, index) } : entry);
}

/**
 * The tree with a block moved under `parent` at `index`, counted among the siblings without
 * it. Unchanged when the target is the block itself or inside it.
 */
export function moveBlock<T extends Block>(blocks: readonly T[], id: string, parent: string | null, index: number): T[] {
    const block = findBlock(blocks, id);
    if (!block || parent === id || (parent && findBlock(block.children ?? [], parent))) return [...blocks];
    return insertBlock(removeBlock(blocks, id), parent, block, index);
}

export type BlockMove = 'up' | 'down' | 'in' | 'out';

/**
 * WordPress's moves: up or down past a sibling, in as the last child of the sibling above,
 * or out to follow its container. Returns the same array when the move is not possible or
 * the types do not allow it there.
 */
export function shiftBlock<T extends Block>(blocks: readonly T[], id: string, move: BlockMove, types: ReadonlyMap<string, BlockDeclaration>): readonly T[] {
    const places = placeBlocks(blocks);
    const place = places.find(entry => entry.block.id === id);
    if (!place) return blocks;
    const siblings = place.parent === null ? blocks : (findBlock(blocks, place.parent)?.children ?? []) as readonly T[];
    let next: T[] | undefined;
    switch (move) {
        case 'up': if (place.index > 0) next = moveBlock(blocks, id, place.parent, place.index - 1); break;
        case 'down': if (place.index < siblings.length - 1) next = moveBlock(blocks, id, place.parent, place.index + 1); break;
        case 'in': {
            const above = siblings[place.index - 1];
            if (above && types.get(above.type)?.children) next = moveBlock(blocks, id, above.id, (above.children ?? []).length);
            break;
        }
        case 'out': {
            if (place.parent === null) break;
            const container = places.find(entry => entry.block.id === place.parent)!;
            next = moveBlock(blocks, id, container.parent, container.index + 1);
            break;
        }
    }
    return next && !blockTreeProblem(next, types) ? next : blocks;
}

/** Why a tree breaks the types' nesting rules or the limits; undefined when it is fine. */
export function blockTreeProblem(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>): string | undefined {
    const places = placeBlocks(blocks);
    if (places.length > BLOCK_LIMITS.count) return `At most ${BLOCK_LIMITS.count} blocks.`;
    const typeOf = new Map(places.map(place => [place.block.id, place.block.type]));
    for (const { block, parent: parentId, depth } of places) {
        if (depth >= BLOCK_LIMITS.depth) return `Blocks nest at most ${BLOCK_LIMITS.depth} deep.`;
        const type = types.get(block.type);
        if (!type) continue;
        const parent = parentId ? typeOf.get(parentId) ?? null : null;
        if (!blockAllowedIn(types, block.type, parent)) return parent ? `${type.label} cannot go inside ${types.get(parent)?.label ?? parent}.` : `${type.label} goes inside ${type.parent?.map(name => types.get(name)?.label ?? name).join(' or ')}.`;
        const children = block.children ?? [];
        if (children.length && !type.children) return `${type.label} does not hold blocks.`;
        if (type.children?.max !== undefined && children.length > type.children.max) return `${type.label} holds at most ${type.children.max} blocks.`;
    }
    return undefined;
}
