/**
 * Blocks: ordered, typed content sections stored in a `blocks` field as `{ id, type, data }`,
 * with `children` under a container and `layout` for how a block shows. A block type declares
 * its fields like a collection does, and which blocks it holds. The host validates every
 * block's data on write; the site renders each type with its own component. Layouts are
 * blocks: a group, columns and a grid hold other blocks, so one tree is stored, edited,
 * diffed and shared as a pattern.
 */
import { field, slugify, validateValue, type FieldDeclaration } from './fields';
import { richTextBlocks, richTextMedia, type RichTextDoc } from './richtext';

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
    /** Other words the picker's search finds the block by, such as `wysiwyg` for Rich text. */
    readonly keywords?: readonly string[];
    /**
     * Offered everywhere blocks go, forms and field groups included, whatever its category: a
     * heading or a paragraph is as useful beside a form's inputs as in a page. Input and field
     * blocks keep to their own places regardless.
     */
    readonly common?: boolean;
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
    /**
     * The block is a field of a field group: it declares one field of the group's target under
     * its `name` data field, labelled by its `label`. Field blocks go only in a field group.
     */
    readonly field?: { readonly kind: FieldBlockKind };
}

/** The builder's field types, one field block each. */
export const FIELD_BLOCK_KINDS = Object.freeze(['text', 'textarea', 'markdown', 'number', 'integer', 'boolean', 'date', 'choice', 'media', 'gallery', 'reference', 'list', 'blocks', 'json', 'repeater'] as const);
export type FieldBlockKind = (typeof FIELD_BLOCK_KINDS)[number];

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
    // Input blocks collect a form's values; field blocks declare a field group's fields. Each family is offered in its own
    // place alone, under one label: both are the fields of what is being built.
    { id: 'form', label: 'Fields' },
    { id: 'field', label: 'Fields' },
    // Data blocks store values with the entry and draw nothing: metadata, custom fields, settings a theme reads.
    { id: 'data', label: 'Data' },
] as const);
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number]['id'];

/** A block's category, `widgets` when it names none. */
export function blockCategory(declaration: Pick<BlockDeclaration, 'category'>): BlockCategory {
    return declaration.category ?? 'widgets';
}

/** A data-only block: it stores values and the site renders nothing for it. */
export function blockIsData(declaration: Pick<BlockDeclaration, 'category'>): boolean {
    return blockCategory(declaration) === 'data';
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
    if (category === 'data' || category === 'field') return [];
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
const BLOCK_FIELD_KINDS = new Set(['string', 'text', 'enum', 'integer', 'number', 'boolean', 'datetime', 'list', 'json', 'richtext']);
const LINK = '(?:https?://|/|mailto:|tel:|#)\\S*';

const GAP = field.enum(['none', 'small', 'medium', 'large'], { default: 'medium', label: 'Gap' });

/** Built-in block types. */
const core: BlockDeclaration[] = [
    // The word processor block: formatted text with headings, lists, links and images, as the body of a WordPress post.
    { name: 'core/richtext', keywords: ['wysiwyg', 'editor', 'word processor', 'text'], common: true, label: 'Rich text', icon: 'text-selection', category: 'text', description: 'Formatted text with headings, lists, links and images.', fields: { text: field.richText({ label: 'Text' }) } },
    { name: 'core/paragraph', keywords: ['text', 'markdown'], common: true, label: 'Paragraph', icon: 'paragraph-spacing', category: 'text', fields: { text: field.text({ required: true, max: 20_000, format: 'markdown', label: 'Text' }) } },
    { name: 'core/heading', keywords: ['title', 'h2', 'h3', 'subtitle'], common: true, label: 'Heading', icon: 'text-bold', category: 'text', fields: {
        text: field.string({ required: true, max: 200, label: 'Text' }),
        level: field.enum(['h2', 'h3', 'h4'], { default: 'h2', label: 'Level' }),
    } },
    { name: 'core/image', keywords: ['picture', 'photo', 'figure'], common: true, label: 'Image', icon: 'gallery', category: 'media', fields: {
        image: field.media({ required: true, nullable: false, label: 'Image' }),
        caption: field.string({ max: 300, label: 'Caption' }),
        link: field.string({ max: 2048, pattern: '(?:https?://|/)\\S*', label: 'Link' }),
    } },
    { name: 'core/gallery', keywords: ['images', 'photos'], label: 'Gallery', icon: 'gallery-wide', category: 'media', fields: {
        images: { ...field.list('string', { label: 'Images' }), media: true },
        columns: field.integer({ default: 3, min: 1, max: 6, label: 'Columns' }),
    } },
    { name: 'core/quote', keywords: ['blockquote', 'citation'], label: 'Quote', icon: 'chat-round-line', category: 'text', fields: {
        text: field.text({ required: true, max: 2000, label: 'Quote' }),
        citation: field.string({ max: 200, label: 'Citation' }),
    } },
    { name: 'core/list', keywords: ['bullets', 'numbered', 'ul', 'ol'], label: 'List', icon: 'list', category: 'text', fields: {
        items: field.list('string', { label: 'Items', description: 'One item per line.' }),
        ordered: field.boolean({ default: false, label: 'Numbered' }),
    } },
    { name: 'core/code', keywords: ['snippet', 'pre', 'source'], label: 'Code', icon: 'code-square', category: 'text', fields: {
        code: field.text({ required: true, max: 20_000, format: 'code', label: 'Code' }),
        language: field.string({ max: 40, pattern: '[a-z0-9+#-]*', label: 'Language', description: 'Such as html, css, js, ts, json, python or bash.' }),
    } },
    { name: 'core/button', keywords: ['link', 'cta', 'call to action'], label: 'Button', icon: 'cursor-square', category: 'design', fields: {
        label: field.string({ required: true, max: 80, label: 'Label' }),
        url: field.string({ required: true, max: 2048, pattern: '(?:https?://|/|mailto:)\\S*', label: 'URL' }),
        style: field.enum(['primary', 'outline'], { default: 'primary', label: 'Style' }),
    } },
    { name: 'core/embed', keywords: ['youtube', 'vimeo', 'video'], label: 'Video embed', icon: 'play-circle', category: 'embeds', description: 'A YouTube or Vimeo video.', fields: {
        url: field.string({ required: true, max: 2048, pattern: 'https://(?:www\\.)?(?:youtube\\.com/watch\\?v=|youtu\\.be/|vimeo\\.com/)\\S+', label: 'Video URL' }),
        caption: field.string({ max: 300, label: 'Caption' }),
    } },
    { name: 'core/divider', keywords: ['separator', 'hr', 'line', 'rule'], common: true, label: 'Divider', icon: 'minus-square', category: 'design', description: 'A line between sections, with text in the middle if you like.', fields: {
        orientation: field.enum(['horizontal', 'vertical'], { default: 'horizontal', label: 'Orientation', choices: { horizontal: 'Horizontal', vertical: 'Vertical' } }),
        thickness: field.enum(['thin', 'medium', 'thick'], { default: 'thin', label: 'Thickness' }),
        width: field.enum(['full', 'wide', 'narrow'], { default: 'full', label: 'Length', choices: { full: 'Full width', wide: 'Three quarters', narrow: 'A quarter' } }),
        color: field.string({ max: 60, pattern: '(?:#[0-9a-fA-F]{3,8}|[a-z][a-z0-9-]*(?:\\([^)]*\\))?)?', label: 'Colour', description: 'A palette slug or a CSS colour; empty uses the border colour.' }),
        text: field.string({ max: 80, label: 'Text', description: 'Shown in the middle of the line.' }),
    } },
    { name: 'core/card', keywords: ['box', 'tile'], label: 'Card', icon: 'card', category: 'design', description: 'An image with a title, text and a link, in a box.', fields: {
        image: field.media({ label: 'Image' }),
        title: field.string({ max: 200, label: 'Title' }),
        text: field.text({ max: 5000, format: 'markdown', label: 'Text' }),
        url: field.string({ max: 2048, pattern: LINK, label: 'Link' }),
        linkLabel: field.string({ max: 80, label: 'Link text', description: 'Empty links the title and the image.' }),
        layout: field.enum(['top', 'left', 'right'], { default: 'top', label: 'Image position', choices: { top: 'Above the text', left: 'Left of the text', right: 'Right of the text' } }),
    } },
    { name: 'core/carousel', keywords: ['slider', 'slideshow'], label: 'Carousel', icon: 'posts-carousel-horizontal', category: 'media', description: 'Images one at a time, with arrows and dots; swipe on touch screens.', fields: {
        images: { ...field.list('string', { label: 'Images' }), media: true },
        aspect: field.enum(['video', 'wide', 'square', 'auto'], { default: 'video', label: 'Shape', choices: { video: '16:9', wide: '21:9', square: 'Square', auto: 'As uploaded' } }),
        autoplay: field.boolean({ default: false, label: 'Play automatically' }),
        interval: field.integer({ default: 5, min: 2, max: 30, label: 'Seconds per image' }),
        captions: field.boolean({ default: true, label: 'Show captions' }),
    } },
    { name: 'core/latest-entries', keywords: ['posts', 'recent', 'query', 'loop'], label: 'Latest entries', icon: 'list-arrow-down', category: 'widgets', description: 'The newest published entries of a collection, kept up to date.', fields: {
        collection: field.string({ required: true, max: 40, pattern: '[a-z][a-z0-9_]*', default: 'posts', label: 'Collection' }),
        count: field.integer({ default: 5, min: 1, max: 24, label: 'How many' }),
        term: field.string({ max: 80, pattern: '[A-Za-z0-9_-]*', label: 'Only with the term', description: 'A category, tag or other term; empty shows every entry.' }),
        order: field.enum(['newest', 'oldest', 'title'], { default: 'newest', label: 'Order', choices: { newest: 'Newest first', oldest: 'Oldest first', title: 'By title' } }),
        layout: field.enum(['list', 'grid', 'titles'], { default: 'list', label: 'Layout', choices: { list: 'List with excerpts', grid: 'Grid of cards', titles: 'Titles only' } }),
        columns: field.integer({ default: 3, min: 1, max: 4, label: 'Columns', description: 'For the grid.' }),
        showImage: field.boolean({ default: true, label: 'Show the featured image' }),
        showDate: field.boolean({ default: true, label: 'Show the date' }),
    } },
    // Data: stored with the entry, shown nowhere. Themes read `entry.blocks` and the API returns them.
    { name: 'core/meta', keywords: ['metadata', 'data', 'key value'], label: 'Custom fields', icon: 'database', category: 'data', description: 'Named values stored with the entry for themes and integrations; nothing shows on the page.', fields: {
        fields: field.list('string', { label: 'Fields', description: 'One per line, as name: value.' }),
    } },
    // Layout: containers that hold other blocks. They render as CSS grid and respond to the
    // width of the content they are in, so columns inside a column stack on their own.
    { name: 'core/group', keywords: ['container', 'section', 'stack'], label: 'Group', icon: 'layers', category: 'design', description: 'A stack of blocks with one width.', fields: {
        align: field.enum(['full', 'wide', 'center', 'left', 'right'], { default: 'full', label: 'Width', choices: { full: 'Full width', wide: 'Wide', center: 'Narrow, centered', left: 'Narrow, left', right: 'Narrow, right' } }),
    }, children: {} },
    { name: 'core/columns', keywords: ['row', 'side by side', 'layout'], label: 'Columns', icon: 'widget-2', category: 'design', description: 'Blocks side by side; they stack on small screens.', fields: {
        gap: GAP,
        stack: field.enum(['mobile', 'tablet', 'never'], { default: 'mobile', label: 'Stack', choices: { mobile: 'On phones', tablet: 'On phones and tablets', never: 'Never' } }),
    }, children: { allowed: ['core/column'], max: 6 } },
    { name: 'core/column', label: 'Column', icon: 'widget', category: 'design', parent: ['core/columns'], fields: {
        span: field.integer({ min: 1, max: 12, label: 'Width', description: 'Out of 12; empty shares the space equally.' }),
        verticalAlign: field.enum(['top', 'center', 'bottom'], { default: 'top', label: 'Vertical alignment' }),
    }, children: {} },
    { name: 'core/grid', keywords: ['cells', 'layout'], label: 'Grid', icon: 'widget-3', category: 'design', description: 'Blocks in equal cells.', fields: {
        columns: field.integer({ default: 3, min: 1, max: 6, label: 'Columns' }),
        columnsMd: field.integer({ default: 2, min: 1, max: 6, label: 'Columns on tablets' }),
        columnsSm: field.integer({ default: 1, min: 1, max: 6, label: 'Columns on phones' }),
        gap: GAP,
    }, children: { max: 24 } },
    // Tabs: one panel shown at a time. In a field group they are the dashboard's tabs.
    { name: 'core/tabs', keywords: ['panels'], label: 'Tabs', icon: 'window-frame', category: 'design', description: 'Panels shown one at a time.', fields: {}, children: { allowed: ['core/tab'], max: 12 } },
    { name: 'core/tab', label: 'Tab', icon: 'tuning-square', category: 'design', parent: ['core/tabs'], fields: {
        label: field.string({ required: true, max: 80, label: 'Label' }),
        icon: field.string({ max: 60, pattern: '[a-z0-9]+(?:-[a-z0-9]+)*', label: 'Icon', description: 'A Solar icon name, such as settings.' }),
    }, children: {} },
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
    if (declaration?.keywords !== undefined && (!Array.isArray(declaration.keywords) || declaration.keywords.length > 12 || declaration.keywords.some(word => typeof word !== 'string' || !word.trim() || word.length > 40))) problems.push(`${at}: keywords are at most 12 words of at most 40 characters.`);
    if (declaration?.common !== undefined && typeof declaration.common !== 'boolean') problems.push(`${at}: common is on or off.`);
    if (declaration?.common && (declaration.input || declaration.field)) problems.push(`${at}: an input or field block cannot be common.`);
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
    /**
     * The blocks are a field group: field blocks and layout blocks alone, conditions allowed,
     * names from labels and distinct across the group, rows included. `scope` names fields of
     * the target a condition may test besides the group's own.
     */
    readonly fieldGroup?: boolean | { readonly scope?: readonly string[] };
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
    const fieldGroup = options.fieldGroup !== undefined && options.fieldGroup !== false;
    const conditional = form || fieldGroup;
    // Names given in the tree, so a name taken from a label does not take one of them.
    const named = (block: Block) => form ? !!types.get(block.type)?.input : fieldGroup ? !!types.get(block.type)?.field : false;
    const taken = new Set(conditional ? flattenBlocks(value).filter(named).map(block => block.data.name).filter((name): name is string => typeof name === 'string' && name.trim() !== '') : []);
    const visit = (list: readonly Block[], parent: string | null): Block[] => {
        const blocks: Block[] = [];
        for (const block of list) {
            const type = types.get(block.type);
            if (!type || (parent === null && allowed && allowed.length && !allowed.includes(block.type))) { errors[block.id] = `${block.type} is not an available block.`; continue; }
            if (!blockAllowedIn(types, block.type, parent)) { errors[block.id] = parent ? `${block.type} cannot go inside ${parent}.` : `${block.type} goes inside ${type.parent?.join(' or ')}.`; continue; }
            if (type.input && !form) { errors[block.id] = `${block.type} goes only in a form.`; continue; }
            if (type.field && !fieldGroup) { errors[block.id] = `${block.type} goes only in a field group.`; continue; }
            if (fieldGroup && !type.field && !type.common && !FIELD_GROUP_LAYOUT.has(block.type)) { errors[block.id] = `${block.type} does not go in a field group.`; continue; }
            if (block.when !== undefined && !conditional) { errors[block.id] = 'conditions apply only in forms and field groups.'; continue; }
            let source = block.data;
            if (named(block) && (typeof source.name !== 'string' || !source.name.trim())) {
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
    if (fieldGroup) Object.assign(errors, fieldGroupTreeErrors(blocks, types, typeof options.fieldGroup === 'object' ? options.fieldGroup.scope ?? [] : []));
    return { blocks, errors };
}

/** Core blocks a field group lays its fields out with. They render as dashboard UI there. */
export const FIELD_GROUP_LAYOUT: ReadonlySet<string> = new Set(['core/group', 'core/columns', 'core/column', 'core/grid', 'core/tabs', 'core/tab', 'core/heading', 'core/paragraph', 'core/divider']);
/** Fields a group holds at most, rows included. */
export const FIELD_GROUP_LIMIT = 96;

/**
 * A field group's own rules: at most 96 fields, names distinct across the group (rows
 * included) and not a target's own, conditions naming fields in reach: the group's at the
 * same or an outer row level, and `scope`'s.
 */
function fieldGroupTreeErrors(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, scope: readonly string[]): { [path: string]: string } {
    const errors: { [path: string]: string } = {};
    const fields = flattenBlocks(blocks).filter(block => types.get(block.type)?.field);
    if (fields.length > FIELD_GROUP_LIMIT) errors[fields[FIELD_GROUP_LIMIT]!.id] = `A field group holds at most ${FIELD_GROUP_LIMIT} fields.`;
    // A row's field sits inside its row, so only a top-level field can take a name the target has.
    const inRows = new Set(fields.filter(block => types.get(block.type)?.field?.kind === 'repeater').flatMap(block => flattenBlocks(block.children ?? []).map(child => child.id)));
    const named = new Map<string, Block>();
    for (const block of fields) {
        const name = block.data.name as string;
        if (RESERVED_FIELD_NAMES.has(name) || (scope.includes(name) && !inRows.has(block.id))) errors[`${block.id}.name`] = 'is used by the target itself.';
        else if (named.has(name)) errors[`${block.id}.name`] = 'is used by another field.';
        else named.set(name, block);
    }
    // The names in reach of a row level: the outer levels' and its own, whatever the order.
    const visit = (list: readonly Block[], visible: ReadonlySet<string>) => {
        const here = new Set(visible);
        const collect = (items: readonly Block[]) => {
            for (const block of items) {
                const type = types.get(block.type);
                if (type?.field) here.add(block.data.name as string);
                if (block.children && !type?.field) collect(block.children);
            }
        };
        collect(list);
        const check = (items: readonly Block[]) => {
            for (const block of items) {
                const type = types.get(block.type);
                for (const rule of block.when?.rules ?? []) {
                    if (!here.has(rule.field)) errors[block.id] = `shows on ${rule.field}, which is not a field in reach.`;
                    else if (named.get(rule.field) === block) errors[block.id] = 'cannot show on its own value.';
                }
                if (!block.children) continue;
                if (type?.field) visit(block.children, here);
                else check(block.children);
            }
        };
        check(list);
    };
    visit(blocks, new Set(scope));
    return errors;
}

/** Field names every record keeps for itself; a target's own fields come through `scope`. */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(['id', 'rev', 'owner', 'createdAt', 'updatedAt', 'meta', '_id']);

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

/** Media file IDs referenced by blocks, nested ones and rich text inside them included, for existence checks. */
export function blockMedia(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>): string[] {
    const ids: string[] = [];
    for (const block of flattenBlocks(blocks)) {
        for (const [name, declaration] of Object.entries(types.get(block.type)?.fields ?? {})) {
            const value = block.data[name];
            if (declaration.kind === 'richtext') {
                const doc = value as RichTextDoc | null | undefined;
                ids.push(...richTextMedia(doc), ...blockMedia(richTextBlocks(doc), types));
                continue;
            }
            if (!declaration.media) continue;
            if (typeof value === 'string') ids.push(value);
            else if (Array.isArray(value)) ids.push(...value.filter((item): item is string => typeof item === 'string'));
        }
    }
    return [...new Set(ids)];
}

/** The rich text documents inside blocks, nested ones included, for patterns and media. */
export function blockDocuments(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>): RichTextDoc[] {
    const docs: RichTextDoc[] = [];
    for (const block of flattenBlocks(blocks)) {
        for (const [name, declaration] of Object.entries(types.get(block.type)?.fields ?? {})) {
            const value = block.data[name];
            if (declaration.kind === 'richtext' && value && typeof value === 'object') docs.push(value as RichTextDoc);
        }
    }
    return docs;
}

/**
 * The plain text of blocks, for search and excerpts: their string and text fields and the
 * text of their rich text, in document order. Data blocks are left out.
 */
export function blocksPlain(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, plain: (doc: RichTextDoc) => string, max = 100_000): string {
    const parts: string[] = [];
    let length = 0;
    for (const block of flattenBlocks(blocks)) {
        const type = types.get(block.type);
        if (!type || blockIsData(type)) continue;
        for (const [name, declaration] of Object.entries(type.fields)) {
            const value = block.data[name];
            const text = declaration.kind === 'richtext' ? (value && typeof value === 'object' ? plain(value as RichTextDoc) : '')
                : (declaration.kind === 'string' || declaration.kind === 'text') && typeof value === 'string' && !declaration.media && !declaration.pattern ? value
                : declaration.kind === 'list' && declaration.items === 'string' && !declaration.media && Array.isArray(value) ? value.join('\n') : '';
            if (!text.trim()) continue;
            parts.push(text.trim());
            length += text.length;
            if (length >= max) return parts.join('\n\n').slice(0, max);
        }
    }
    return parts.join('\n\n');
}

/** Blocks with fresh IDs, for copies of a template or a pattern. */
export function cloneBlocks<T extends Block>(blocks: readonly T[], id: () => string = blockId): T[] {
    return blocks.map(block => ({ ...block, id: id(), ...(block.children ? { children: cloneBlocks(block.children as readonly T[], id) } : {}) }));
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
