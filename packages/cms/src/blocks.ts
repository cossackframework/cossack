/**
 * Blocks: ordered, typed content sections stored in a `blocks` field as `{ id, type, data }`.
 * A block type declares its fields like a collection does. The host validates every block's
 * data on write; the site renders each type with its own component.
 */
import { field, validateValue, type FieldDeclaration } from './fields';

export { blocksShapeProblem } from './fields';

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
}

export interface Block {
    /** Stable within its field: 1-40 letters, digits, `_` or `-`. */
    readonly id: string;
    readonly type: string;
    readonly data: { readonly [field: string]: unknown };
}

/** Groups of the block picker, in its order, as in WordPress. */
export const BLOCK_CATEGORIES = Object.freeze([
    { id: 'text', label: 'Text' },
    { id: 'media', label: 'Media' },
    { id: 'design', label: 'Design' },
    { id: 'widgets', label: 'Widgets' },
    { id: 'embeds', label: 'Embeds' },
] as const);
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number]['id'];

/** A block's category, `widgets` when it names none. */
export function blockCategory(declaration: Pick<BlockDeclaration, 'category'>): BlockCategory {
    return declaration.category ?? 'widgets';
}

export const BLOCK_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Field kinds a block can hold. Blocks do not nest. */
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLOCK_FIELD_KINDS = new Set(['string', 'text', 'enum', 'integer', 'number', 'boolean', 'datetime', 'list', 'json']);

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
    return problems;
}

/**
 * Validate blocks against their types. Returns the blocks with defaults applied and unknown
 * data removed, or errors keyed by `<block id>.<field>`.
 */
export function validateBlocks(value: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, allowed?: readonly string[]): { blocks: Block[]; errors: { [path: string]: string } } {
    const errors: { [path: string]: string } = {};
    const blocks: Block[] = [];
    for (const block of value) {
        const type = types.get(block.type);
        if (!type || (allowed && allowed.length && !allowed.includes(block.type))) { errors[block.id] = `${block.type} is not an available block.`; continue; }
        const data: { [field: string]: unknown } = {};
        for (const [name, declaration] of Object.entries(type.fields)) {
            const entry = block.data[name];
            if (entry === undefined || entry === '' || entry === null) {
                if (declaration.default !== undefined) data[name] = declaration.default;
                else if (declaration.required) errors[`${block.id}.${name}`] = 'is required.';
                continue;
            }
            const error = validateValue(name, declaration, entry);
            if (error) errors[`${block.id}.${name}`] = error;
            else data[name] = entry;
        }
        blocks.push(Object.freeze({ id: block.id, type: block.type, data: Object.freeze(data) }));
    }
    return { blocks, errors };
}

/** Media file IDs referenced by blocks, for existence checks. */
export function blockMedia(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>): string[] {
    const ids: string[] = [];
    for (const block of blocks) {
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
