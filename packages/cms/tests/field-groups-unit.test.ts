import { describe, expect, it } from 'vitest';
import {
    CORE_BLOCKS, FIELD_BLOCKS, FIELD_BLOCK_TYPES, FIELD_BLOCK_KINDS, blockProblems, blockSupports, clearHidden, field, fieldBlockDeclaration, fieldBlockOf, fieldGroupDeclarations, upgradeFieldBlocks,
    fieldGroupProblems, fieldProblems, fieldVisibility, groupsForTarget, hiddenKey, indexedRowField, indexedRowPaths, layoutOf, rowIndexPath, rowsPlain, rowUniqueProblem, storageType, targetOrder, validateBlocks, validateValue, withRowIds, withTarget,
    type Block, type BlockDeclaration, type FieldGroup,
} from '../src/index';

const types: ReadonlyMap<string, BlockDeclaration> = new Map([...CORE_BLOCKS, ...FIELD_BLOCKS].map(block => [block.name, block]));
const fieldBlock = (id: string, kind: string, data: { [key: string]: unknown }, extra: Partial<Block> = {}): Block => ({ _id: id, type: `field/${kind}`, data: { label: id, ...data }, ...extra });

/** A product's fields: two columns, a pricing tab, and a specifications repeater with nested notes. */
const product: Block[] = [
    { _id: 'cols', type: 'core/columns', data: {}, children: [
        { _id: 'c1', type: 'core/column', data: {}, children: [fieldBlock('sku', 'text', { name: 'sku', label: 'SKU', unique: true, max: 40 })] },
        { _id: 'c2', type: 'core/column', data: {}, children: [fieldBlock('brand', 'reference', { name: 'brand', label: 'Brand', target: 'brands' })] },
    ] },
    { _id: 'tabs', type: 'core/tabs', data: {}, children: [
        { _id: 'pricing', type: 'core/tab', data: { label: 'Pricing' }, children: [
            fieldBlock('price', 'number', { name: 'price', label: 'Price', min: 0, index: true, required: true }),
            fieldBlock('sale', 'boolean', { name: 'onSale', label: 'On sale' }),
            fieldBlock('salePrice', 'number', { name: 'salePrice', label: 'Sale price', min: 0 }, { when: { rules: [{ field: 'onSale', op: 'is', value: 'true' }] } }),
        ] },
    ] },
    fieldBlock('specs', 'repeater', { name: 'specs', label: 'Specifications', max: 20, summary: 'name' }, { children: [
        fieldBlock('specName', 'text', { name: 'name', label: 'Name', required: true, index: true, search: true }),
        fieldBlock('specKind', 'choice', { name: 'kind', label: 'Kind', choices: ['text', 'link'] }),
        fieldBlock('specUrl', 'text', { name: 'url', label: 'URL' }, { when: { rules: [{ field: 'kind', op: 'is', value: 'link' }] } }),
        fieldBlock('notes', 'repeater', { name: 'notes', label: 'Notes' }, { children: [
            fieldBlock('noteText', 'textarea', { name: 'text', label: 'Note', search: true }),
            fieldBlock('noteTag', 'text', { name: 'tag', label: 'Tag', index: true }),
        ] }),
    ] }),
];

const group: FieldGroup = { id: 'product', title: 'Product', targets: [{ kind: 'collection', name: 'products' }], blocks: product };

describe('field blocks', () => {
    it('declares one valid block per builder type, without a Style tab', () => {
        expect(FIELD_BLOCKS.map(block => block.field!.kind)).toEqual([...FIELD_BLOCK_KINDS]);
        expect(FIELD_BLOCK_TYPES.map(type => type.kind)).toEqual([...FIELD_BLOCK_KINDS]);
        for (const block of FIELD_BLOCKS) {
            expect(blockProblems(block)).toEqual([]);
            expect(block.category).toBe('field');
            expect(blockSupports(block)).toEqual([]);
        }
    });

    it('goes only in a field group, with layout blocks alone beside it', () => {
        expect(validateBlocks([fieldBlock('a', 'text', { name: 'a' })], types).errors).toEqual({ a: 'field/text goes only in a field group.' });
        // Common blocks (an image, a heading) go anywhere; other content blocks stay out of field groups.
        expect(validateBlocks([{ _id: 'img', type: 'core/image', data: { image: 'x' } }], types, { fieldGroup: true }).errors).toEqual({});
        const { errors } = validateBlocks([{ _id: 'q', type: 'core/quote', data: { text: 'Said' } }], types, { fieldGroup: true });
        expect(errors).toEqual({ q: 'core/quote does not go in a field group.' });
    });

    it('names fields from labels, keeps names distinct per scope and checks conditions in reach', () => {
        const blocks: Block[] = [
            fieldBlock('a', 'text', { label: 'Release date' }),
            fieldBlock('b', 'text', { label: 'Release date' }),
            fieldBlock('r', 'repeater', { name: 'rows', label: 'Rows' }, { children: [
                fieldBlock('inner', 'text', { label: 'Release date' }),
                fieldBlock('cond', 'text', { name: 'cond', label: 'Cond' }, { when: { rules: [{ field: 'releaseDate', op: 'notEmpty' }] } }),
                fieldBlock('bad', 'text', { name: 'bad', label: 'Bad' }, { when: { rules: [{ field: 'missing', op: 'notEmpty' }] } }),
            ] }),
            fieldBlock('own', 'text', { name: 'title', label: 'Title' }),
            fieldBlock('self', 'text', { name: 'self', label: 'Self' }, { when: { rules: [{ field: 'self', op: 'notEmpty' }] } }),
        ];
        const { blocks: checked, errors } = validateBlocks(blocks, types, { fieldGroup: { scope: ['title'] } });
        expect(checked[0]!.data.name).toBe('releaseDate');
        expect(checked[1]!.data.name).toBe('releaseDate2');
        // Names are distinct across the group, rows included, so row filter paths and conditions stay unambiguous.
        expect(checked[2]!.children![0]!.data.name).toBe('releaseDate3');
        expect(errors).toEqual({ bad: 'shows on missing, which is not a field in reach.', 'own.name': 'is used by the target itself.', self: 'cannot show on its own value.' });
    });
});

describe('field groups', () => {
    it('compiles blocks to declarations, repeaters to rows and indexed row fields to array index paths', () => {
        const { problems, fields } = fieldGroupProblems(group, types);
        expect(problems).toEqual([]);
        expect(Object.keys(fields)).toEqual(['sku', 'brand', 'price', 'onSale', 'salePrice', 'specs']);
        expect(fields.sku).toEqual(field.string({ label: 'SKU', max: 40, unique: true }));
        expect(fields.brand).toEqual(field.reference('cms/brands', { label: 'Brand', nullable: true }));
        expect(fields.price).toEqual(field.number({ label: 'Price', required: true, min: 0, nullable: false, index: true }));
        expect(fields.specs!.kind).toBe('rows');
        expect(fields.specs!.max).toBe(20);
        expect(Object.keys(fields.specs!.fields!)).toEqual(['name', 'kind', 'url', 'notes']);
        expect(fields.specs!.fields!.notes!.kind).toBe('rows');
        expect(storageType(fields.specs!, () => '')).toBe('array<object>');
        expect(indexedRowPaths(fields)).toEqual([['specs', 'name'], ['specs', 'notes', 'tag']]);
        expect(indexedRowPaths(fields).map(rowIndexPath)).toEqual(['specs.*.name', 'specs.*.notes.*.tag']);
        expect(indexedRowField(fields, ['specs', 'notes', 'tag'])).toMatchObject({ kind: 'string', index: true });
        expect(indexedRowField(fields, ['specs', 'notes', 'text'])).toBeNull();
        expect(indexedRowField(fields, ['specs'])).toBeNull();
        expect(indexedRowField(fields, ['price', 'name'])).toBeNull();
    });

    it('rejects bad groups and indexes on row fields that cannot be lists', () => {
        const bad = fieldGroupProblems({ ...group, id: 'no spaces', title: '', targets: [{ kind: 'collection', name: 'a' }, { kind: 'collection', name: 'a' }, { kind: 'nope' } as never] }, types);
        expect(bad.problems).toEqual(expect.arrayContaining([
            'The ID must be 1-40 letters, digits, underscores or hyphens.', 'The title is required and at most 120 characters.', 'Target 2 is listed twice.', 'Target 3 is not a collection, taxonomy, users or menus.',
        ]));
        const rows = fieldGroupProblems({ ...group, blocks: [fieldBlock('r', 'repeater', { name: 'r', label: 'R' }, { children: [fieldBlock('g', 'media', { name: 'g', label: 'G', multiple: true })] })] }, types);
        expect(rows.problems).toEqual([]);
        const indexed = fieldGroupProblems({ ...group, blocks: [fieldBlock('r', 'repeater', { name: 'r', label: 'R' }, { children: [fieldBlock('l', 'text', { name: 'l', label: 'L', index: true, multiple: true })] })] }, types);
        expect(indexed.problems).toEqual(['field r.l: multiple row fields cannot be filterable.']);
    });

    it('round-trips declarations through field blocks', () => {
        const { fields } = fieldGroupProblems(group, types);
        const layout = layoutOf(fields, ['specs', 'sku']);
        expect(layout.map(block => block._id)).toEqual(['specs', 'sku', 'brand', 'price', 'onSale', 'salePrice']);
        expect(layout[0]!.children!.map(block => block.type)).toEqual(['field/text', 'field/choice', 'field/text', 'field/repeater']);
        const again = fieldGroupDeclarations(validateBlocks(layout, types, { fieldGroup: true }).blocks, types);
        expect(again).toEqual(fields);
        expect(fieldBlockOf('cover', field.media({ label: 'Cover' })).type).toBe('field/media');
        expect(fieldBlockOf('shots', field.gallery({ label: 'Shots' }))).toEqual({ _id: 'shots', type: 'field/media', data: { name: 'shots', label: 'Shots', multiple: true } });
    });

    it('compiles a Multiple field block to a multiple declaration and back', () => {
        const tags = fieldBlock('tags', 'text', { name: 'tags', label: 'Tags', multiple: true, max: 20, index: true, minItems: 1, maxItems: 5, addLabel: 'Add tag', defaultValue: 'new\n\nhot' });
        const declaration = fieldBlockDeclaration(tags, types)!;
        expect(declaration).toEqual({ kind: 'string', label: 'Tags', multiple: true, minItems: 1, maxItems: 5, addLabel: 'Add tag', max: 20, index: true, default: ['new', 'hot'] });
        expect(fieldBlockOf('tags', declaration).data).toEqual({ name: 'tags', label: 'Tags', max: 20, index: true, multiple: true, minItems: 1, maxItems: 5, addLabel: 'Add tag', defaultValue: 'new\nhot' });
        // A multiple number is a list of numbers, never null; a multiple choice checks each value; a boolean never multiplies.
        expect(fieldBlockDeclaration(fieldBlock('n', 'integer', { name: 'n', label: 'N', multiple: true, defaultValue: '1\nx\n3' }), types)).toEqual({ kind: 'integer', label: 'N', multiple: true, default: [1, 3] });
        expect(fieldBlockDeclaration(fieldBlock('c', 'choice', { name: 'c', label: 'C', multiple: true, choices: ['s', 'm'], defaultValue: 'm' }), types)).toEqual({ kind: 'enum', values: ['s', 'm'], label: 'C', multiple: true, default: ['m'] });
        expect(fieldBlockDeclaration(fieldBlock('b', 'boolean', { name: 'b', label: 'B', multiple: true }), types)).toEqual({ kind: 'boolean', label: 'B', default: false });
        expect(fieldProblems('tags', declaration)).toEqual([]);
        expect(FIELD_BLOCKS.find(block => block.name === 'field/boolean')!.fields).not.toHaveProperty('multiple');
        expect(FIELD_BLOCKS.find(block => block.name === 'field/media')!.fields).toHaveProperty('multiple');
        // Field blocks of earlier builds read as today's.
        expect(upgradeFieldBlocks([fieldBlock('r', 'repeater', { name: 'r' }, { children: [fieldBlock('l', 'list', { name: 'l' }), fieldBlock('g', 'gallery', { name: 'g' })] })])[0]!.children!.map(block => [block.type, block.data.multiple]))
            .toEqual([['field/text', true], ['field/media', true]]);
    });
});

describe('targets', () => {
    const group = (id: string, order: number | undefined, targets: FieldGroup['targets']): FieldGroup => ({ id, title: id, ...(order !== undefined ? { order } : {}), targets, blocks: [] });
    const products = { kind: 'collection', name: 'products' } as const;

    it('orders a target\'s groups by their order there, then by the group\'s order and id', () => {
        const groups = [
            group('b', 5, [{ ...products, order: 1 }, { kind: 'users' }]),
            group('a', 1, [products]),
            group('c', 0, [{ ...products, order: -1 }, { kind: 'taxonomy', name: 'tags', order: 3 }]),
            group('d', undefined, [{ kind: 'taxonomy', name: 'tags' }]),
        ];
        expect(groupsForTarget(groups, products).map(entry => entry.id)).toEqual(['c', 'a', 'b']);
        expect(groupsForTarget(groups, { kind: 'taxonomy', name: 'tags' }).map(entry => entry.id)).toEqual(['d', 'c']);
        expect(groupsForTarget(groups, { kind: 'users' }).map(entry => entry.id)).toEqual(['b']);
        expect(targetOrder(groups[0]!, products)).toBe(1);
        expect(targetOrder(groups[0]!, { kind: 'users' })).toBe(5);
    });

    it('attaches and detaches a target, keeping the others', () => {
        const base = group('a', undefined, [{ kind: 'users' }, { ...products, order: 2 }]);
        expect(withTarget(base, products, true, 7).targets).toEqual([{ kind: 'users' }, { ...products, order: 7 }]);
        expect(withTarget(base, { ...products, order: 9 }, true).targets).toEqual([{ kind: 'users' }, products]);
        expect(withTarget(base, products, false).targets).toEqual([{ kind: 'users' }]);
        expect(fieldGroupProblems(group('a', undefined, [{ ...products, order: 1.5 }]), types).problems).toContain('Target 1: the order is a whole number.');
    });
});

describe('rows', () => {
    const specs = field.rows({ name: field.string({ required: true }), qty: field.integer({ nullable: true }), notes: field.rows({ text: field.text({ search: true }) }) }, { max: 2, min: 1 });

    it('declares and validates rows, with distinct ids and nested rows', () => {
        expect(fieldProblems('specs', specs)).toEqual([]);
        expect(fieldProblems('bad', field.rows({ blocks: field.blocks() }))).toEqual(['field bad.blocks: row fields cannot be blocks, rich text, vectors or big integers.']);
        expect(fieldProblems('big', field.rows({ a: field.string() }, { max: 5000 }))).toEqual(['field big: rows hold at most 1000 rows.']);
        expect(validateValue('specs', specs, [])).toBe('needs at least 1 row.');
        expect(validateValue('specs', specs, [{ name: 'a' }, { name: 'b' }, { name: 'c' }])).toBe('must be a list of at most 2 rows.');
        expect(validateValue('specs', specs, [{ _id: 'x', name: 'a' }, { _id: 'x', name: 'b' }])).toBe('row 2 has an invalid or repeated _id.');
        expect(validateValue('specs', specs, [{ qty: 1 }])).toBe('row 1: name is required.');
        expect(validateValue('specs', specs, [{ name: 'a', qty: 'many' }])).toBe('row 1: qty must be a safe integer.');
        expect(validateValue('specs', specs, [{ name: 'a', extra: 1 }])).toBe('row 1 has no field extra.');
        expect(validateValue('specs', specs, [{ name: 'a', notes: [{ text: 1 }] }])).toBe('row 1: notes row 1: text must be text.');
        expect(validateValue('specs', specs, [{ _id: 'r1', name: 'a', qty: null, notes: [{ _id: 'n1', text: 'hi' }] }])).toBeUndefined();
    });

    it('fills in row ids, derives search text, and checks uniqueness within the entry', () => {
        let count = 0;
        const value = withRowIds(specs, [{ name: 'a', notes: [{ text: 'first' }, { _id: 'keep', text: 'second' }] }, { _id: 'r2', name: 'b' }], () => `id${++count}`) as { _id: string; notes?: { _id: string }[] }[];
        expect(value.map(row => row._id)).toEqual(['id1', 'r2']);
        expect(value[0]!.notes!.map(row => row._id)).toEqual(['id2', 'keep']);
        expect(rowsPlain(specs, [{ name: 'a', notes: [{ text: 'first note' }] }, { name: 'b', notes: [{ text: ' ' }] }])).toBe('first note');
        const unique = field.rows({ code: field.string({ unique: true }), inner: field.rows({ code: field.string({ unique: true }) }) });
        expect(rowUniqueProblem('specs', unique, [{ code: 'a' }, { code: 'a' }])).toBe('specs: code must be different in every row.');
        expect(rowUniqueProblem('specs', unique, [{ code: 'a', inner: [{ code: 'z' }, { code: 'z' }] }])).toBe('specs.inner: code must be different in every row.');
        expect(rowUniqueProblem('specs', unique, [{ code: 'a' }, { code: 'b' }])).toBeUndefined();
    });
});

describe('field visibility', () => {
    const { blocks } = fieldGroupProblems(group, types);

    it('hides fields by their conditions at the top level and per row, and clears their values', () => {
        const values = {
            price: 10, onSale: false, salePrice: 5,
            specs: [
                { _id: 'r1', name: 'Weight', kind: 'text', url: 'gone' },
                { _id: 'r2', name: 'Site', kind: 'link', url: 'https://example.com', notes: [{ _id: 'n1', text: 'kept' }] },
            ],
        };
        const result = fieldVisibility(blocks, types, values);
        expect([...result.hidden]).toEqual([hiddenKey([], 'salePrice'), hiddenKey([{ name: 'specs', id: 'r1' }], 'specUrl')]);
        expect(result.values).toEqual({ price: 10, onSale: false, specs: [{ _id: 'r1', name: 'Weight', kind: 'text' }, values.specs[1]] });
        expect(fieldVisibility(blocks, types, { ...values, onSale: true }).hidden.has('salePrice')).toBe(false);
    });

    it('lets a row see the rows above it and the target scope, and follows hidden fields', () => {
        const nested: Block[] = [
            fieldBlock('flag', 'boolean', { name: 'flag' }),
            fieldBlock('a', 'text', { name: 'a' }, { when: { rules: [{ field: 'status', op: 'is', value: 'published' }] } }),
            fieldBlock('b', 'text', { name: 'b' }, { when: { rules: [{ field: 'a', op: 'notEmpty' }] } }),
            fieldBlock('outer', 'repeater', { name: 'outer' }, { children: [
                fieldBlock('kind', 'choice', { name: 'kind', choices: ['x', 'y'] }),
                fieldBlock('inner', 'repeater', { name: 'inner' }, { children: [
                    fieldBlock('deep', 'text', { name: 'deep' }, { when: { match: 'all', rules: [{ field: 'kind', op: 'is', value: 'x' }, { field: 'flag', op: 'is', value: 'true' }] } }),
                ] }),
            ] }),
        ];
        const checked = validateBlocks(nested, types, { fieldGroup: { scope: ['status'] } });
        expect(checked.errors).toEqual({});
        const values = { flag: true, a: 'set', b: 'follows', outer: [{ _id: 'o1', kind: 'x', inner: [{ _id: 'i1', deep: 'shown' }] }, { _id: 'o2', kind: 'y', inner: [{ _id: 'i2', deep: 'hidden' }] }] };
        const draft = fieldVisibility(checked.blocks, types, values, { status: 'draft' });
        // `a` hides on a draft, so `b`, which depends on it, follows in the next round.
        expect([...draft.hidden]).toEqual(['a', 'b', 'outer=o2/inner=i2/deep']);
        expect(draft.values).toEqual({ flag: true, outer: [{ _id: 'o1', kind: 'x', inner: [{ _id: 'i1', deep: 'shown' }] }, { _id: 'o2', kind: 'y', inner: [{ _id: 'i2' }] }] });
        const published = fieldVisibility(checked.blocks, types, values, { status: 'published' });
        expect([...published.hidden]).toEqual(['outer=o2/inner=i2/deep']);
        expect(clearHidden(checked.blocks, types, values, new Set(['outer=o1/inner']))).toEqual({ ...values, outer: [{ _id: 'o1', kind: 'x' }, values.outer[1]] });
    });
});
