/**
 * Editor layout: how a collection's entry editor is arranged. The editor is made of boxes
 * (the Publish box, the content, the SEO box, each taxonomy, each field group, …), and a
 * layout places them: tabs for the main column, and the sidebar every tab shares. A layout is
 * a block tree of editor-only blocks (`editor/tab`, `editor/section`, `editor/box`) and the
 * core layout blocks, so the collection manager edits it with the block tree. A collection
 * without a stored layout renders `defaultEditorLayout`, which is what the editor showed
 * before layouts existed. Pure functions, shared by the dashboard and the host.
 */
import { CORE_BLOCKS, flattenBlocks, validateBlocks, type Block, type BlockDeclaration } from './blocks';
import type { CollectionDefinition } from './collections';
import { field, slugify, SLUG_PATTERN, type FieldDeclaration } from './fields';
import type { FieldGroup } from './field-groups';

// --- Boxes --------------------------------------------------------------------------------

/**
 * A meta box the entry editor shows (a box, in the code). `field:<name>` is one field of the entry (a feature such as
 * the content or the featured image, or a field a module or plugin declares), `group:<id>` a
 * field group attached to the collection, `taxonomy:<name>` the terms of one taxonomy, and
 * the rest are the editor's own: `seo` (search and sharing), `attributes` (parent and order),
 * `languages`, `template`, `discussion` and `revisions`. The title with its permalink and the
 * Publish box are not boxes: they are pinned.
 */
export const EDITOR_BOX = /^(?:field:[a-z][a-zA-Z0-9_]{0,62}|group:[A-Za-z0-9_-]{1,40}|taxonomy:[a-z][a-zA-Z0-9_]{0,40}|seo|attributes|languages|template|discussion|revisions)$/;

/** The editor's own boxes, with their default place. */
export const EDITOR_OWN_BOXES: readonly { readonly id: string; readonly label: string; readonly placement: 'main' | 'sidebar'; readonly note: string }[] = Object.freeze([
    { id: 'seo', label: 'Search and sharing', placement: 'main', note: 'Shown when entries are on the site.' },
    { id: 'attributes', label: 'Attributes', placement: 'sidebar', note: 'Parent and order; shown when entries nest.' },
    { id: 'languages', label: 'Languages', placement: 'sidebar', note: 'Shown when the site has several languages.' },
    { id: 'template', label: 'Template', placement: 'sidebar', note: 'Shown when the active theme offers templates for entries.' },
    { id: 'discussion', label: 'Discussion', placement: 'sidebar', note: 'Shown when comments are on.' },
    { id: 'revisions', label: 'Revisions', placement: 'sidebar', note: 'Shown once the entry has revisions.' },
]);

export interface EditorBox {
    readonly id: string;
    readonly label: string;
    /** Where the default layout puts it. */
    readonly placement: 'main' | 'sidebar';
    /** When the editor shows it, for boxes that depend on the site or the entry. */
    readonly note?: string;
    /** The plugin whose group it is. */
    readonly plugin?: string;
}

/** Where the editor shows a field by default: its declared place, else the sidebar for a checkbox, a single file or a reference. */
export function fieldPlacement(declaration: FieldDeclaration): 'main' | 'sidebar' {
    if (declaration.placement) return declaration.placement;
    const sidebar = declaration.kind === 'boolean' || (declaration.media === true && declaration.kind === 'string' && !declaration.multiple) || declaration.kind === 'reference';
    return sidebar ? 'sidebar' : 'main';
}

export interface EditorBoxesInput {
    readonly collection: Pick<CollectionDefinition, 'hierarchical' | 'comments' | 'path' | 'features'>;
    /** The resource's fields: the core fields, the features', the declared ones and the groups'. */
    readonly fields: { readonly [name: string]: FieldDeclaration };
    /** The groups attached to the collection, in order. */
    readonly groups: readonly Pick<FieldGroup, 'id' | 'title' | 'placement' | 'blocks' | 'plugin'>[];
    /** The collection's taxonomies, with labels. */
    readonly taxonomies: readonly { readonly name: string; readonly label: string }[];
    /** Fields the editor shows nowhere or lays out itself: the core fields (`CORE_FIELDS`), or a plugin resource's title field. */
    readonly special: readonly string[];
}

/**
 * The boxes an editor of the collection has, in the order the default layout shows them:
 * the main column's, then the sidebar's. Fields the groups lay out are the groups' boxes.
 */
export function editorBoxes(input: EditorBoxesInput): EditorBox[] {
    const laidOut = new Set(input.groups.flatMap(group => flattenBlocks(group.blocks).filter(block => block.type.startsWith('field/')).map(block => String(block.data.name ?? ''))));
    const special = new Set([...input.special, ...input.taxonomies.map(taxonomy => taxonomy.name)]);
    const fields = Object.entries(input.fields).filter(([name, declaration]) => !special.has(name) && !laidOut.has(name) && !declaration.taxonomy)
        .map(([name, declaration]) => ({ id: `field:${name}`, label: declaration.label ?? name, placement: fieldPlacement(declaration) }));
    const groups = input.groups.map(group => ({ id: `group:${group.id}`, label: group.title, placement: group.placement ?? 'main' as const, ...(group.plugin ? { plugin: group.plugin } : {}) }));
    const own = (id: string) => EDITOR_OWN_BOXES.find(box => box.id === id)!;
    const main: EditorBox[] = [
        ...fields.filter(box => box.placement === 'main'),
        ...groups.filter(box => box.placement === 'main'),
        ...(input.collection.path !== null && input.collection.path !== undefined ? [own('seo')] : []),
    ];
    const sidebar: EditorBox[] = [
        ...(input.collection.hierarchical ? [own('attributes')] : []),
        own('languages'),
        ...(input.fields.template ? [own('template')] : []),
        ...input.taxonomies.map(taxonomy => ({ id: `taxonomy:${taxonomy.name}`, label: taxonomy.label, placement: 'sidebar' as const })),
        ...fields.filter(box => box.placement === 'sidebar'),
        ...groups.filter(box => box.placement === 'sidebar'),
        ...(input.collection.comments ? [own('discussion')] : []),
        ...(input.collection.features?.revisions !== false ? [own('revisions')] : []),
    ];
    return [...main, ...sidebar];
}

// --- Blocks -------------------------------------------------------------------------------

const BOX = field.string({ required: true, max: 120, pattern: EDITOR_BOX.source.slice(1, -1), label: 'Meta box' });

/** The editor-only blocks a layout is built from. A box (a meta box, on screen) names one of `editorBoxes`. */
export const EDITOR_LAYOUT_BLOCKS: readonly BlockDeclaration[] = Object.freeze<BlockDeclaration[]>([
    { name: 'editor/tab', label: 'Tab', icon: 'widget-2', category: 'design', description: 'A tab of the main column.', fields: {
        label: field.string({ required: true, max: 80, label: 'Label' }),
        icon: field.string({ max: 60, pattern: SLUG_PATTERN, label: 'Icon', description: 'One of the dashboard\'s icons, shown before the label.' }),
    }, children: { allowed: ['editor/section', 'editor/box', 'core/columns', 'core/grid', 'core/paragraph'] } },
    { name: 'editor/section', label: 'Section', icon: 'layers', category: 'design', description: 'A titled part of a tab or the sidebar, holding meta boxes.', fields: {
        title: field.string({ required: true, max: 120, label: 'Title' }),
        description: field.string({ max: 500, label: 'Description' }),
    }, children: { allowed: ['editor/section', 'editor/box', 'core/columns', 'core/grid', 'core/paragraph'] } },
    { name: 'editor/box', label: 'Meta box', icon: 'card', category: 'design', description: 'One of the editor\'s meta boxes: a field, a field group, a taxonomy, or the editor\'s own.', fields: { box: BOX } },
]);

/** Core layout blocks a layout may use beside the editor's own. */
export const EDITOR_LAYOUT_CORE: readonly string[] = Object.freeze(['core/columns', 'core/column', 'core/grid', 'core/paragraph']);

/** What goes inside a tab, a section, a column or a grid cell: everything but a tab, so tabs stay at the top of the main column. */
export const EDITOR_LAYOUT_INSIDE: readonly string[] = Object.freeze(['editor/section', 'editor/box', 'core/columns', 'core/grid', 'core/paragraph']);

/** Every block type a layout may hold. */
export const EDITOR_LAYOUT_TYPES: ReadonlySet<string> = new Set([...EDITOR_LAYOUT_BLOCKS.map(block => block.name), ...EDITOR_LAYOUT_CORE]);

/**
 * The block types a layout is validated and edited against. With `boxes`, the Box block's
 * `box` is a choice among them (and the IDs in `keep`, which a stored layout names although
 * they are not available now), so an editor offers a list instead of a text field.
 */
export function editorLayoutTypes(boxes?: readonly EditorBox[], keep: readonly string[] = []): Map<string, BlockDeclaration> {
    const types = new Map<string, BlockDeclaration>();
    for (const name of EDITOR_LAYOUT_CORE) {
        const block = CORE_BLOCKS.find(entry => entry.name === name)!;
        // A column or a grid cell holds what a tab holds, never a tab.
        types.set(name, block.children && !block.children.allowed ? { ...block, children: { ...block.children, allowed: EDITOR_LAYOUT_INSIDE } } : block);
    }
    for (const block of EDITOR_LAYOUT_BLOCKS) types.set(block.name, block);
    if (boxes) {
        const ids = [...new Set([...boxes.map(box => box.id), ...keep.filter(id => EDITOR_BOX.test(id))])];
        const choices = Object.fromEntries(ids.map(id => [id, boxes.find(box => box.id === id)?.label ?? `${id} (not available)`]));
        const box = types.get('editor/box')!;
        types.set('editor/box', { ...box, fields: { box: field.enum(ids, { required: true, label: 'Meta box', choices }) } });
    }
    return types;
}

// --- Layout -------------------------------------------------------------------------------

export interface EditorLayout {
    /** The main column's tabs: `editor/tab` blocks, the first with the ID `edit`. JSON follows them. */
    readonly tabs: readonly Block[];
    /** The sidebar under the Publish box, shared by every tab. */
    readonly sidebar: readonly Block[];
}

/** The first tab, which cannot be removed or moved. */
export const EDIT_TAB = 'edit';
export const EDITOR_LAYOUT_LIMITS = Object.freeze({ tabs: 12, blocks: 200 });

/** A tab's ID, which the editor's address names (`?tab=`): a slug of at most 40 characters. */
export const EDITOR_TAB_ID = new RegExp(`^(?=.{1,40}$)${SLUG_PATTERN}$`);

/** Tab IDs the editor keeps for itself: its JSON view, and the sidebar the layout editor shows beside the tabs. */
export const EDITOR_TAB_RESERVED: readonly string[] = Object.freeze(['json', 'sidebar']);

/**
 * A tab ID from a label: its slug, with `-2`, `-3`, … when `taken` (or the reserved IDs) has
 * it already; `tab` when the label has no letters or digits.
 */
export function editorTabId(label: string, taken: Iterable<string> = []): string {
    const used = new Set([...taken, ...EDITOR_TAB_RESERVED]);
    const base = slugify(label, 36) || 'tab';
    if (!used.has(base)) return base;
    for (let suffix = 2; ; suffix += 1) if (!used.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
}

/** A box block. */
export function boxBlock(id: string): Block {
    return { _id: `box-${id.replace(/[^A-Za-z0-9_-]+/g, '-')}`, type: 'editor/box', data: { box: id } };
}

/** The boxes a tree names, in document order, with the block each sits in. */
export function layoutBoxes(blocks: readonly Block[]): { id: string; block: Block }[] {
    return flattenBlocks(blocks).filter(block => block.type === 'editor/box' && typeof block.data.box === 'string').map(block => ({ id: block.data.box as string, block }));
}

/**
 * The layout the editor showed before layouts existed: one Edit tab with the main column's
 * boxes, and the sidebar's boxes in their order.
 */
export function defaultEditorLayout(boxes: readonly EditorBox[], options: { readonly editLabel?: string } = {}): EditorLayout {
    return {
        tabs: [{ _id: EDIT_TAB, type: 'editor/tab', data: { label: options.editLabel ?? 'Edit' }, children: boxes.filter(box => box.placement === 'main').map(box => boxBlock(box.id)) }],
        sidebar: boxes.filter(box => box.placement === 'sidebar').map(box => boxBlock(box.id)),
    };
}

/** Whether a value has a layout's shape, for definitions read as data. */
export function editorLayoutShapeProblem(value: unknown): string | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'is tabs and a sidebar.';
    const layout = value as { tabs?: unknown; sidebar?: unknown };
    for (const key of ['tabs', 'sidebar'] as const) {
        const list = layout[key];
        if (!Array.isArray(list)) return `${key} is a list of blocks.`;
        if (list.some(block => !block || typeof block !== 'object' || typeof block._id !== 'string' || typeof block.type !== 'string')) return `${key}: every block needs an _id and a type.`;
    }
    if ((layout.tabs as unknown[]).length > EDITOR_LAYOUT_LIMITS.tabs) return `holds at most ${EDITOR_LAYOUT_LIMITS.tabs} tabs.`;
    const count = flattenBlocks(layout.tabs as Block[]).length + flattenBlocks(layout.sidebar as Block[]).length;
    if (count > EDITOR_LAYOUT_LIMITS.blocks) return `holds at most ${EDITOR_LAYOUT_LIMITS.blocks} blocks.`;
    return undefined;
}

/**
 * Problems in a layout, and the layout with defaults applied: the tabs are `editor/tab`
 * blocks alone, the first the Edit tab (`partial` layouts, such as a plugin's, need not have
 * it); nothing else holds a tab; every block is an editor layout block; a box is named once.
 */
export function editorLayoutProblems(layout: EditorLayout, options: { readonly partial?: boolean; readonly types?: ReadonlyMap<string, BlockDeclaration> } = {}): { problems: string[]; layout: EditorLayout } {
    const problems: string[] = [];
    const shape = editorLayoutShapeProblem(layout);
    if (shape) return { problems: [`The layout ${shape}`], layout: { tabs: [], sidebar: [] } };
    const types = options.types ?? editorLayoutTypes();
    const check = (blocks: readonly Block[], where: string, allowed?: readonly string[]) => {
        const { blocks: checked, errors } = validateBlocks(blocks, types, allowed ? { allowed } : {});
        problems.push(...Object.entries(errors).map(([path, message]) => `${where} block ${path}: ${message}`));
        for (const block of flattenBlocks(checked)) if (!EDITOR_LAYOUT_TYPES.has(block.type)) problems.push(`${where} block ${block._id}: ${block.type} does not go in an editor layout.`);
        return checked;
    };
    const tabs = check(layout.tabs, 'Tab', ['editor/tab']);
    const sidebar = check(layout.sidebar, 'Sidebar', EDITOR_LAYOUT_INSIDE);
    if (!options.partial && tabs[0]?._id !== EDIT_TAB) problems.push(`The first tab is ${EDIT_TAB}.`);
    const ids = tabs.map(tab => tab._id);
    for (const [index, id] of ids.entries()) {
        if (ids.indexOf(id) !== index) problems.push(`Tab ${id} is listed twice.`);
        else if (EDITOR_TAB_RESERVED.includes(id)) problems.push(`Tab ${id}: the ID ${id} is the editor's own.`);
        else if (!EDITOR_TAB_ID.test(id)) problems.push(`Tab ${id}: an ID is lowercase letters, digits and single hyphens, at most 40 characters, for the address (?tab=).`);
    }
    const seen = new Set<string>();
    for (const { id, block } of [...layoutBoxes(tabs), ...layoutBoxes(sidebar)]) {
        if (seen.has(id)) problems.push(`Block ${block._id}: the box ${id} is placed twice.`);
        seen.add(id);
    }
    return { problems, layout: { tabs, sidebar } };
}

/** A plugin's addition to a collection's layout: tabs and sidebar blocks it appends, named by the plugin. */
export interface EditorLayoutAddition {
    readonly plugin: string;
    readonly layout: EditorLayout;
}

export interface ResolvedEditorLayout extends EditorLayout {
    /** Box IDs the layout names that are not available now: a detached group's, an inactive plugin's, a feature turned off. */
    readonly missing: string[];
    /** Tab IDs each plugin added. */
    readonly added: { [tab: string]: string };
}

/**
 * The layout an editor renders: the stored one, or the default, with the plugins' additions
 * and every box the layout does not name appended (main boxes to the first tab, sidebar boxes
 * to the sidebar), and the boxes that are not available left out. A plugin's tab whose ID the
 * stored layout already has is the stored one, so moving it keeps it where it was put; a
 * plugin's box the stored layout places stays there too.
 */
export function resolveEditorLayout(stored: EditorLayout | undefined, boxes: readonly EditorBox[], additions: readonly EditorLayoutAddition[] = [], options: { readonly editLabel?: string; /** Keep the boxes that are not available, for an editor of the layout. */ readonly keep?: boolean } = {}): ResolvedEditorLayout {
    // A plugin's addition places boxes the default would otherwise put on the Edit tab or the sidebar.
    const addedBoxes = new Set(additions.flatMap(addition => [...layoutBoxes(addition.layout.tabs), ...layoutBoxes(addition.layout.sidebar)].map(entry => entry.id)));
    const base = stored ?? defaultEditorLayout(boxes.filter(box => !addedBoxes.has(box.id)), options);
    let tabs = [...base.tabs];
    let sidebar = [...base.sidebar];
    const added: { [tab: string]: string } = {};
    const placed = () => new Set([...layoutBoxes(tabs), ...layoutBoxes(sidebar)].map(entry => entry.id));
    for (const addition of additions) {
        const known = placed();
        const prefix = (block: Block): Block => ({ ...block, _id: block._id.startsWith(`${addition.plugin}-`) ? block._id : `${addition.plugin}-${block._id}` });
        const without = (blocks: readonly Block[]): Block[] => blocks.flatMap(block => block.type === 'editor/box' && known.has(String(block.data.box)) ? [] : [block.children ? { ...block, children: without(block.children) } : block]);
        for (const tab of addition.layout.tabs) {
            const next = prefix(tab);
            if (tabs.some(entry => entry._id === next._id)) continue;
            tabs.push({ ...next, children: without(next.children ?? []) });
            added[next._id] = addition.plugin;
        }
        sidebar.push(...without(addition.layout.sidebar.map(prefix)));
    }
    const available = new Map(boxes.map(box => [box.id, box]));
    const named = placed();
    const missing = [...named].filter(id => !available.has(id));
    const prune = (blocks: readonly Block[]): Block[] => options.keep ? [...blocks] : blocks.flatMap(block => block.type === 'editor/box' ? (available.has(String(block.data.box)) ? [block] : []) : [block.children ? { ...block, children: prune(block.children) } : block]);
    tabs = tabs.map(tab => ({ ...tab, children: prune(tab.children ?? []) }));
    sidebar = prune(sidebar);
    const rest = boxes.filter(box => !named.has(box.id));
    if (!tabs.length) tabs = [{ _id: EDIT_TAB, type: 'editor/tab', data: { label: options.editLabel ?? 'Edit' }, children: [] }];
    tabs[0] = { ...tabs[0]!, children: [...(tabs[0]!.children ?? []), ...rest.filter(box => box.placement === 'main').map(box => boxBlock(box.id))] };
    sidebar = [...sidebar, ...rest.filter(box => box.placement === 'sidebar').map(box => boxBlock(box.id))];
    return { tabs, sidebar, missing, added };
}

/** The names of the fields a box edits, so an error can find the tab its box is on. */
export function boxFields(id: string, groups: readonly Pick<FieldGroup, 'id' | 'blocks'>[]): string[] {
    if (id.startsWith('field:')) return [id.slice('field:'.length)];
    if (id.startsWith('taxonomy:')) return [id.slice('taxonomy:'.length)];
    if (id.startsWith('group:')) {
        const group = groups.find(entry => entry.id === id.slice('group:'.length));
        return group ? flattenBlocks(group.blocks).filter(block => block.type.startsWith('field/')).map(block => String(block.data.name ?? '')).filter(Boolean) : [];
    }
    switch (id) {
        case 'seo': return ['seo', 'summary'];
        case 'attributes': return ['parent', 'menuOrder'];
        case 'languages': return ['locale', 'translationGroup'];
        case 'template': return ['template'];
        case 'discussion': return ['commentsOpen'];
        default: return [];
    }
}
