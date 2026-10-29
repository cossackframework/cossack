import { describe, expect, it } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import {
    beforeWrite, blockConditionProblem, field, inputFields, manifestProblems, requestedGrants, blockProblems, choiceOptions, collectionProblems, collectionResource, CORE_BLOCKS, displayValue, emailAddresses, FORM_BLOCKS, FORM_EMBED_BLOCK, formDataValues, formInputs,
    forms, formSettings, formsModule, formVisibility, inputName, notificationProblems, renderMergeTags, resolveResource, ruleMatches, submissionOf, submissionResource, submissionResourceName, validateBlocks,
    displayRows, flatFormInputs, inputHtmlName, inputKey, FORM_ROW_LIMIT, FORM_ITEM_LIMIT, MULTIPLE_INPUT_KINDS,
    validateSubmission, visibleBlocks, type Block, type BlockDeclaration, type FormRow,
} from '../src/index';

const types: ReadonlyMap<string, BlockDeclaration> = new Map([...CORE_BLOCKS, ...FORM_BLOCKS].map(block => [block.name, block]));
const input = (id: string, type: string, data: { [key: string]: unknown }, extra: Partial<Block> = {}): Block => ({ id, type: `form/${type}`, data: { label: id, ...data }, ...extra });

/** A contact form: name, email, a topic, a message, and a phone number shown when "call me" is ticked. */
const contact: Block[] = [
    { id: 'row', type: 'core/columns', data: {}, children: [
        { id: 'c1', type: 'core/column', data: {}, children: [input('n', 'text', { name: 'name', label: 'Your name', required: true })] },
        { id: 'c2', type: 'core/column', data: {}, children: [input('e', 'email', { name: 'email', label: 'Email', required: true })] },
    ] },
    input('t', 'select', { name: 'topic', label: 'Topic', options: ['sales|Sales', 'support|Support'], required: true }),
    input('m', 'textarea', { name: 'message', label: 'Message', required: true, maxLength: 20 }),
    input('cb', 'checkbox', { name: 'callMe', label: 'Call me' }),
    input('p', 'phone', { name: 'phone', label: 'Phone', required: true }, { when: { rules: [{ field: 'callMe', op: 'is', value: 'true' }] } }),
];
const checked = () => {
    const result = validateBlocks(contact, types, { form: true });
    expect(result.errors).toEqual({});
    return result.blocks;
};

describe('form blocks', () => {
    it('declares valid input blocks and keeps them in forms', () => {
        for (const block of [...FORM_BLOCKS, FORM_EMBED_BLOCK]) expect(blockProblems(block)).toEqual([]);
        expect(FORM_BLOCKS.every(block => block.input && block.category === 'form')).toBe(true);
        expect(blockProblems({ name: 'acme/rating', label: 'Rating', input: { kind: 'stars' as never }, fields: {} })).toEqual([
            'block acme/rating: input.kind is one of string, text, email, url, phone, number, boolean, date, choice, choices, rows.',
            'block acme/rating: an input block declares string fields name and label.',
        ]);
        // Inputs and conditions belong to forms.
        expect(validateBlocks([input('n', 'text', { name: 'name' })], types).errors).toEqual({ n: 'form/text goes only in a form.' });
        expect(validateBlocks([{ id: 'p', type: 'core/paragraph', data: { text: 'x' }, when: { rules: [{ field: 'a', op: 'empty' }] } }], types).errors).toEqual({ p: 'conditions apply only in forms and field groups.' });
    });

    it('names inputs from labels and checks the form as a whole', () => {
        const blocks = checked();
        expect(formInputs(blocks, types).map(entry => [entry.name, entry.kind, entry.required])).toEqual([
            ['name', 'string', true], ['email', 'email', true], ['topic', 'choice', true], ['message', 'text', true], ['callMe', 'boolean', false], ['phone', 'phone', true],
        ]);
        // Defaults fill in.
        expect(blocks[2]!.data).toMatchObject({ rows: 5, maxLength: 20, required: true });
        expect(blocks[2]!.data).not.toHaveProperty('minLength');
        const named = validateBlocks([input('a', 'text', { label: 'Your e-mail address' }), input('b', 'text', { label: 'Your e-mail address' }), input('c', 'text', { label: 'yourEMailAddress2', name: 'yourEMailAddress2' })], types, { form: true });
        expect(named.errors).toEqual({});
        expect(named.blocks.map(block => block.data.name)).toEqual(['yourEMailAddress', 'yourEMailAddress3', 'yourEMailAddress2']);
        expect(inputName('2nd choice')).toBe('field2ndChoice');
        expect(inputName('Status')).toBe('statusField');
        expect(inputName('')).toBe('field');
        const wrong = validateBlocks([
            input('a', 'text', { name: 'email' }), input('b', 'email', { name: 'email' }), input('c', 'text', { name: 'status' }),
            { id: 'p', type: 'core/paragraph', data: { text: 'x' }, when: { rules: [{ field: 'missing', op: 'empty' }] } },
            input('d', 'text', { name: 'self' }, { when: { rules: [{ field: 'self', op: 'notEmpty' }] } }),
        ], types, { form: true });
        expect(wrong.errors).toEqual({ 'b.name': 'is used by another field.', 'c.name': 'is reserved for the submission.', p: 'shows on missing, which is not a field of this form.', d: 'cannot show on its own value.' });
        const many = Array.from({ length: 49 }, (_, index) => input(`i${index}`, 'text', { name: `f${index}` }));
        expect(validateBlocks(many, types, { form: true }).errors).toEqual({ i48: 'A form holds at most 48 fields.' });
    });

    it('checks the shape of conditions', () => {
        expect(blockConditionProblem({ rules: [{ field: 'a', op: 'is', value: 'x' }], match: 'any', action: 'hide' })).toBeUndefined();
        expect(blockConditionProblem({ rules: [] })).toBe('block when.rules lists 1 to 10 rules.');
        expect(blockConditionProblem({ rules: [{ field: 'a', op: 'like' }] })).toContain("op is one of is, isNot");
        expect(blockConditionProblem({ rules: [{ field: 'A b', op: 'is' }] })).toBe('a condition rule names a form field.');
        expect(blockConditionProblem({ rules: [{ field: 'a', op: 'is' }], other: 1 })).toBe('block when takes action, match and rules.');
        // Stored conditions keep only what differs from the defaults.
        const [block] = validateBlocks([input('a', 'text', { name: 'a' }), input('b', 'text', { name: 'b' }, { when: { action: 'show', match: 'all', rules: [{ field: 'a', op: 'empty', value: 'x' }] } })], types, { form: true }).blocks.slice(1);
        expect(block!.when).toEqual({ rules: [{ field: 'a', op: 'empty' }] });
    });
});

describe('conditions', () => {
    it('compares values', () => {
        const values = { text: 'Hello World', n: 12, yes: true, no: false, many: ['a', 'b'], date: '2026-10-21', empty: '' };
        const test = (field: string, op: string, value?: string) => ruleMatches({ field, op: op as never, ...(value !== undefined ? { value } : {}) }, values);
        expect([test('text', 'is', 'hello world'), test('text', 'isNot', 'hello'), test('text', 'contains', 'WORLD'), test('many', 'contains', 'b'), test('many', 'is', 'a')]).toEqual([true, true, true, true, true]);
        expect([test('n', 'gt', '9'), test('n', 'lt', '9'), test('date', 'gt', '2026-10-01'), test('date', 'lt', '2026-10-01'), test('missing', 'gt', '0')]).toEqual([true, false, true, false, false]);
        expect([test('empty', 'empty'), test('missing', 'empty'), test('no', 'empty'), test('yes', 'notEmpty'), test('many', 'empty')]).toEqual([true, true, true, true, false]);
        expect([test('yes', 'is', 'true'), test('no', 'is', 'false'), test('n', 'in', '10, 12'), test('many', 'in', 'x,b'), test('text', 'in', 'x')]).toEqual([true, true, true, true, false]);
    });

    it('hides blocks, their children and what depends on them', () => {
        const blocks: Block[] = [
            input('a', 'checkbox', { name: 'more' }),
            { id: 'g', type: 'core/group', data: {}, when: { rules: [{ field: 'more', op: 'is', value: 'true' }] }, children: [input('b', 'text', { name: 'details' })] },
            input('c', 'text', { name: 'why' }, { when: { rules: [{ field: 'details', op: 'notEmpty' }] } }),
            input('d', 'text', { name: 'other' }, { when: { action: 'hide', match: 'any', rules: [{ field: 'more', op: 'is', value: 'true' }, { field: 'why', op: 'notEmpty' }] } }),
        ];
        const off = formVisibility(blocks, types, { more: false, details: 'stale', why: 'stale' });
        // The group is hidden, so `details` counts as empty and `why` hides too.
        expect([...off.hidden].sort()).toEqual(['b', 'c', 'g']);
        expect(off.values).toEqual({ more: false });
        const on = formVisibility(blocks, types, { more: true, details: 'x' });
        expect([...on.hidden]).toEqual(['d']);
        expect(visibleBlocks(blocks, types, { more: true }).map(block => block.id)).toEqual(['a', 'g']);
    });
});

describe('submissions', () => {
    it('checks values by kind and conditions', () => {
        const blocks = checked();
        const ok = validateSubmission(blocks, types, { name: ' Ada ', email: 'ada@example.com', topic: 'support', message: 'Line one\r\nTwo', phone: 'ignored' });
        expect(ok.errors).toEqual({});
        // The phone is hidden while "call me" is not ticked, so it is not required or kept.
        expect(ok.values).toEqual({ name: 'Ada', email: 'ada@example.com', topic: 'support', message: 'Line one\nTwo', callMe: false });
        const bad = validateSubmission(blocks, types, { email: 'not mail', topic: 'other', message: 'x'.repeat(21), callMe: 'on' });
        expect(bad.errors).toEqual({
            name: 'This field is required.', email: 'Enter an email address, such as name@example.com.', topic: 'Choose one of the options.',
            message: 'Use at most 20 characters.', phone: 'This field is required.',
        });
        expect(bad.values).toEqual({ callMe: true });
    });

    it('reads every kind', () => {
        const blocks = validateBlocks([
            input('u', 'url', { name: 'site' }), input('n', 'number', { name: 'count', min: 1, max: 10, step: 1 }), input('d', 'date', { name: 'day', min: '2026-01-01' }),
            input('c', 'checkboxes', { name: 'pick', options: ['a', 'b|Bee'], required: true }), input('k', 'consent', { name: 'agree', text: 'I agree' }),
            input('t', 'text', { name: 'code', pattern: '[A-Z]{3}' }), input('h', 'hidden', { name: 'source', defaultValue: 'ad' }),
        ], types, { form: true }).blocks;
        const good = validateSubmission(blocks, types, { site: 'https://example.com', count: '3', day: '2026-02-28', pick: ['b', 'a', 'b'], agree: 'on', code: 'ABC', source: 'mail' });
        expect(good.errors).toEqual({});
        expect(good.values).toEqual({ site: 'https://example.com', count: 3, day: '2026-02-28', pick: ['b', 'a'], agree: true, code: 'ABC', source: 'mail' });
        const bad = validateSubmission(blocks, types, { site: 'javascript:alert(1)', count: '2.5', day: '2026-02-30', pick: ['z'], code: 'abc' });
        expect(bad.errors).toEqual({
            site: 'Enter a web address starting with https://.', count: 'Enter a whole number.', day: 'Enter a date.', pick: 'Choose from the options.',
            agree: 'Tick this box to continue.', code: 'Enter a value in the expected format.',
        });
        expect(validateSubmission(blocks, types, { count: 'many', day: '2025-12-31', pick: [] }).errors).toMatchObject({ count: 'Enter a number.', day: 'Choose 2026-01-01 or later.', pick: 'Choose at least one option.' });
        expect(validateSubmission(blocks, types, { count: 11 }).errors.count).toBe('Enter 10 or less.');
        // Form data: every value of checkboxes, one of the others.
        const data = new FormData();
        data.append('pick', 'a'); data.append('pick', 'b'); data.append('site', 'https://a.example'); data.append('site', 'https://b.example');
        expect(formDataValues(data, formInputs(blocks, types))).toEqual({ site: 'https://a.example', pick: ['a', 'b'] });
    });

    it('reads choices and shows values', () => {
        expect(choiceOptions(['a', ' b | Bee ', 'a|Again', '', '|x', 3])).toEqual([{ value: 'a', label: 'a' }, { value: 'b', label: 'Bee' }]);
        expect(displayValue({ kind: 'choice', options: [{ value: 's', label: 'Sales' }] }, 's')).toBe('Sales');
        expect(displayValue({ kind: 'choices', options: [{ value: 's', label: 'Sales' }] }, ['s', 'x'])).toBe('Sales, x');
        expect(displayValue({ kind: 'boolean', options: [] }, false)).toBe('No');
        expect(displayValue({ kind: 'string', options: [] }, undefined)).toBe('');
    });

    it('stores each form in its own resource', () => {
        const id = '8f14e45f-ceea-467a-9575-1f2b3c4d5e6f';
        expect(submissionResourceName(id)).toBe('form_8f14e45fceea467a95751f2b3c4d5e6f');
        expect(() => submissionResourceName('---')).toThrow();
        const inputs = formInputs(checked(), types);
        const resource = resolveResource(submissionResource({ id, title: 'Contact' }, inputs), 'cms');
        expect(resource.id).toBe('cms/form_8f14e45fceea467a95751f2b3c4d5e6f');
        expect(resource.storage).toBe('r__cms__form_8f14e45fceea467a95751f2b3c4d5e6f');
        expect(resource.schemaless).toBe(true);
        expect(resource.revisions).toBe(false);
        expect(Object.fromEntries(Object.entries(resource.fields).map(([name, declaration]) => [name, declaration.kind]))).toEqual({
            name: 'string', email: 'string', topic: 'string', message: 'text', callMe: 'boolean', phone: 'string', status: 'enum', note: 'text', meta: 'json',
        });
        expect(resource.fields.name!.label).toBe('Your name');
        expect(resource.access).toEqual({ read: { permission: 'cms:submissions' }, create: 'none', update: { permission: 'cms:submissions' }, delete: { permission: 'cms:submissions' } });
        const submission = submissionOf(id, { id: 's1', rev: 1, createdAt: 5, updatedAt: 6, owner: null, name: 'Ada', removed: 'x', status: 'new', meta: { ip: '1.2.3.4' } }, inputs);
        expect(submission).toEqual({ id: 's1', form: id, status: 'new', values: { name: 'Ada' }, note: '', meta: { ip: '1.2.3.4' }, user: null, createdAt: 5, updatedAt: 6 });
    });
});

describe('repeaters', () => {
    /** A booking: a contact email, passengers (name, seat, a meal shown when "special meal" is ticked), and a note shown for 3 passengers or more. */
    const booking: Block[] = [
        input('e', 'email', { name: 'email', label: 'Email', required: true }),
        input('r', 'repeater', { name: 'pax', label: 'Passengers', rowLabel: 'Passenger', min: 1, max: 4 }, { children: [
            { id: 'cols', type: 'core/columns', data: {}, children: [
                { id: 'col', type: 'core/column', data: {}, children: [input('n', 'text', { name: 'name', label: 'Name', required: true })] },
                { id: 'col2', type: 'core/column', data: {}, children: [input('s', 'select', { name: 'seat', label: 'Seat', options: ['aisle', 'window'] })] },
            ] },
            input('sm', 'checkbox', { name: 'special', label: 'Special meal' }),
            input('ml', 'text', { name: 'meal', label: 'Meal', required: true }, { when: { rules: [{ field: 'special', op: 'is', value: 'true' }] } }),
            input('vip', 'text', { name: 'lounge', label: 'Lounge' }, { when: { rules: [{ field: 'email', op: 'contains', value: '@vip.example' }] } }),
        ] }),
        input('g', 'textarea', { name: 'groupNote', label: 'Group note' }, { when: { rules: [{ field: 'pax', op: 'gt', value: '2' }] } }),
    ];
    const checkedBooking = () => {
        const result = validateBlocks(booking, types, { form: true });
        expect(result.errors).toEqual({});
        return result.blocks;
    };

    it('is an input that holds the inputs of a row, one level deep, with names scoped to it', () => {
        const blocks = checkedBooking();
        const inputs = formInputs(blocks, types);
        expect(inputs.map(entry => [entry.name, entry.kind, entry.parent])).toEqual([['email', 'email', null], ['pax', 'rows', null], ['groupNote', 'text', null]]);
        expect(inputs[1]!.inputs.map(entry => [entry.name, entry.kind, entry.parent])).toEqual([['name', 'string', 'pax'], ['seat', 'choice', 'pax'], ['special', 'boolean', 'pax'], ['meal', 'string', 'pax'], ['lounge', 'string', 'pax']]);
        expect(flatFormInputs(inputs).map(entry => entry.name)).toEqual(['email', 'pax', 'name', 'seat', 'special', 'meal', 'lounge', 'groupNote']);
        expect(blocks[1]!.data).toMatchObject({ addLabel: 'Add another', rowLabel: 'Passenger', min: 1, max: 4 });
        // A row may reuse a top-level name; a repeater cannot hold a repeater; a top-level block cannot show on a row's input.
        const wrong = validateBlocks([
            input('e', 'email', { name: 'email' }),
            input('r', 'repeater', { name: 'pax' }, { children: [
                input('e2', 'email', { name: 'email' }), input('e3', 'text', { name: 'email' }),
                input('r2', 'repeater', { name: 'more' }, { children: [input('x', 'text', { name: 'x' })] }),
                input('y', 'text', { name: 'y' }, { when: { rules: [{ field: 'nope', op: 'empty' }] } }),
            ] }),
            input('t', 'text', { name: 'top' }, { when: { rules: [{ field: 'email', op: 'notEmpty' }, { field: 'name', op: 'empty' }] } }),
        ], types, { form: true });
        expect(wrong.errors).toEqual({ 'e3.name': 'is used by another field.', r2: 'A repeater cannot hold another repeater.', y: 'shows on nope, which is not a field in reach.', t: 'shows on name, which is not a field of this form.' });
        expect(inputHtmlName('pax.r1.name')).toBe('pax[r1][name]');
        expect(inputKey('pax[r1][name]')).toBe('pax.r1.name');
        expect(inputKey('email')).toBe('email');
    });

    it('reads rows from form data and JSON, checks each row with its own conditions, and keeps the form\'s conditions', () => {
        const blocks = checkedBooking();
        const inputs = formInputs(blocks, types);
        const data = new FormData();
        data.append('email', 'ada@example.com');
        data.append('pax[b][name]', 'Bob'); data.append('pax[b][seat]', 'window');
        data.append('pax[a][name]', 'Ada'); data.append('pax[a][special]', 'on'); data.append('pax[a][meal]', 'Vegan');
        data.append('pax[zz][seat]', 'aisle');
        expect(formDataValues(data, inputs)).toEqual({ email: 'ada@example.com', pax: [
            { _id: 'b', name: 'Bob', seat: 'window' }, { _id: 'a', name: 'Ada', special: 'on', meal: 'Vegan' }, { _id: 'zz', seat: 'aisle' },
        ] });
        const check = validateSubmission(blocks, types, formDataValues(data, inputs));
        // The third row lacks its name; the meal is required only where "special meal" is ticked; the lounge needs a VIP address.
        expect(check.errors).toEqual({ 'pax.zz.name': 'This field is required.' });
        expect(check.values).toEqual({ email: 'ada@example.com', pax: [
            { _id: 'b', name: 'Bob', seat: 'window', special: false }, { _id: 'a', name: 'Ada', special: true, meal: 'Vegan' }, { _id: 'zz', seat: 'aisle', special: false },
        ] });
        expect([...check.hidden]).toEqual(['b:ml', 'b:vip', 'a:vip', 'zz:ml', 'zz:vip']);
        // One passenger hides the group note, so it is neither kept nor required.
        const one = validateSubmission(blocks, types, { email: 'a@b.co', pax: [{ name: 'Solo' }], groupNote: 'dropped' });
        expect(one.hidden.has('g')).toBe(true);
        expect(one.values).toEqual({ email: 'a@b.co', pax: [{ _id: 'r1', name: 'Solo', special: false }] });
        // JSON rows without ids get numbered ones; a VIP address shows the lounge and three passengers show the note.
        const json = validateSubmission(blocks, types, { email: 'ada@vip.example', groupNote: 'Together', pax: [{ name: 'A', lounge: 'yes' }, { name: 'B' }, { name: 'C', _id: 'c' }] });
        expect(json.errors).toEqual({});
        expect(json.values).toEqual({ email: 'ada@vip.example', groupNote: 'Together', pax: [{ _id: 'r1', name: 'A', special: false, lounge: 'yes' }, { _id: 'r2', name: 'B', special: false }, { _id: 'c', name: 'C', special: false }] });
        expect(json.hidden.has('g')).toBe(false);
        // Too few, too many, not a list.
        expect(validateSubmission(blocks, types, { email: 'a@b.co' }).errors).toEqual({ pax: 'Add at least 1 Passenger.' });
        expect(validateSubmission(blocks, types, { email: 'a@b.co', pax: Array.from({ length: 5 }, () => ({ name: 'x' })) }).errors).toEqual({ pax: 'Add at most 4 Passenger rows.' });
        expect(validateSubmission(blocks, types, { email: 'a@b.co', pax: 'nope' }).errors).toEqual({ pax: 'Send the rows as a list.' });
        // Rows nobody filled in are dropped before the count: an empty form's starting row is not a passenger.
        expect(validateSubmission(blocks, types, { email: 'a@b.co', pax: [{ _id: 'x', name: '', special: '' }] }).errors).toEqual({ pax: 'Add at least 1 Passenger.' });
        const blankRow = validateSubmission(blocks, types, { email: 'a@b.co', pax: [{ _id: 'x', name: '' }, { _id: 'y', name: 'Yan' }] });
        expect(blankRow.values.pax).toEqual([{ _id: 'y', name: 'Yan', special: false }]);
        // The blank row's conditions still settle, so the page hides its meal until the box is ticked.
        expect([...blankRow.hidden]).toEqual(['g', 'x:ml', 'x:vip', 'y:ml', 'y:vip']);
        expect(FORM_ROW_LIMIT).toBe(50);
    });

    it('shows, stores and merges rows', () => {
        const blocks = checkedBooking();
        const inputs = formInputs(blocks, types);
        const pax = inputs[1]!;
        const rows: FormRow[] = [{ _id: 'a', name: 'Ada', seat: 'window', special: true, meal: 'Vegan' }, { _id: 'b', name: 'Bob', special: false }];
        expect(displayValue(pax, rows)).toBe('Passenger × 2');
        expect(displayValue({ kind: 'rows', options: [] }, [])).toBe('0 rows');
        expect(displayRows(pax, rows)).toEqual(['Name: Ada, Seat: window, Special meal: Yes, Meal: Vegan', 'Name: Bob, Special meal: No']);
        expect(ruleMatches({ field: 'pax', op: 'is', value: '2' }, { pax: rows })).toBe(true);
        const resource = resolveResource(submissionResource({ id: '8f14e45f-ceea-467a-9575-1f2b3c4d5e6f', title: 'Booking' }, inputs), 'cms');
        expect(resource.fields.pax).toMatchObject({ kind: 'rows', nullable: true, max: 50, label: 'Passengers' });
        expect(Object.fromEntries(Object.entries(resource.fields.pax!.fields!).map(([name, declaration]) => [name, [declaration.kind, declaration.search ?? false]]))).toEqual({
            name: ['string', false], seat: ['string', false], special: ['boolean', false], meal: ['string', false], lounge: ['string', false],
        });
        const context = { form: { id: 'f', title: 'Booking' }, inputs, values: { email: 'ada@example.com', pax: rows }, site: { title: 'Site', url: 'https://s.example', adminEmail: 'admin@s.example' } };
        expect(renderMergeTags('{all_fields}', context)).toBe('Email: ada@example.com\nPassengers:\n1. Name: Ada, Seat: window, Special meal: Yes, Meal: Vegan\n2. Name: Bob, Special meal: No');
        expect(renderMergeTags('{field:pax}', context)).toBe('1. Name: Ada, Seat: window, Special meal: Yes, Meal: Vegan\n2. Name: Bob, Special meal: No');
    });
});

describe('multiple inputs', () => {
    /** A guest list: an email, guest names (at most 3, 10 characters each), ages, and a note shown when a guest is called Zed. */
    const guests: Block[] = [
        input('e', 'email', { name: 'email', label: 'Email', required: true }),
        input('g', 'text', { name: 'guests', label: 'Guest names', multiple: true, minItems: 1, maxItems: 3, maxLength: 10, addLabel: 'Add guest' }),
        input('a', 'number', { name: 'ages', label: 'Ages', multiple: true, min: 0, step: 1 }),
        input('n', 'textarea', { name: 'remark', label: 'Remark' }, { when: { rules: [{ field: 'guests', op: 'contains', value: 'Zed' }] } }),
        input('r', 'repeater', { name: 'pax', label: 'Passengers', max: 2 }, { children: [input('t', 'text', { name: 'tags', label: 'Tags', multiple: true, maxItems: 2 })] }),
    ];
    const checkedGuests = () => {
        const result = validateBlocks(guests, types, { form: true });
        expect(result.errors).toEqual({});
        return result.blocks;
    };

    it('is a setting of the text-like inputs, read onto the field', () => {
        const withSetting = FORM_BLOCKS.filter(block => block.fields.multiple).map(block => block.name);
        expect(withSetting).toEqual(['form/text', 'form/email', 'form/url', 'form/phone', 'form/textarea', 'form/number', 'form/date']);
        expect(MULTIPLE_INPUT_KINDS).toEqual(['string', 'text', 'email', 'url', 'phone', 'number', 'date']);
        for (const block of FORM_BLOCKS.filter(block => block.fields.multiple)) expect(Object.keys(block.fields)).toEqual(expect.arrayContaining(['multiple', 'minItems', 'maxItems', 'addLabel']));
        expect(FORM_BLOCKS.find(block => block.name === 'form/repeater')!.fields.maxItems).toBeUndefined();
        const inputs = formInputs(checkedGuests(), types);
        expect(inputs.map(entry => [entry.name, entry.multiple])).toEqual([['email', false], ['guests', true], ['ages', true], ['remark', false], ['pax', false]]);
        expect(inputs[4]!.inputs[0]).toMatchObject({ name: 'tags', multiple: true, parent: 'pax' });
        // The setting means nothing on a kind that does not take it.
        expect(formInputs([input('s', 'select', { name: 'topic', options: ['a'], multiple: true })], types)[0]!.multiple).toBe(false);
        expect(FORM_ITEM_LIMIT).toBe(50);
    });

    it('reads every posted value, checks each as the kind, and drops blank items', () => {
        const blocks = checkedGuests();
        const inputs = formInputs(blocks, types);
        const data = new FormData();
        data.append('email', 'ada@example.com');
        data.append('guests', 'Ann'); data.append('guests', ''); data.append('guests', 'A name too long');
        data.append('ages', '30'); data.append('ages', 'x');
        data.append('pax[r1][tags]', 'vip'); data.append('pax[r1][tags]', 'late');
        expect(formDataValues(data, inputs)).toEqual({ email: 'ada@example.com', guests: ['Ann', '', 'A name too long'], ages: ['30', 'x'], pax: [{ _id: 'r1', tags: ['vip', 'late'] }] });
        const check = validateSubmission(blocks, types, formDataValues(data, inputs));
        // Errors name the item's position as posted; the blank item is dropped and does not count.
        expect(check.errors).toEqual({ 'guests.3': 'Use at most 10 characters.', 'ages.2': 'Enter a number.' });
        expect(check.values).toEqual({ email: 'ada@example.com', guests: ['Ann'], ages: [30], pax: [{ _id: 'r1', tags: ['vip', 'late'] }] });
        // JSON: a list, or one scalar as one item; the condition reads the items joined.
        const json = validateSubmission(blocks, types, { email: 'a@b.co', guests: 'Zed', ages: [1, 2.5], remark: 'Zed is here' });
        expect(json.errors).toEqual({ 'ages.2': 'Enter a whole number.' });
        expect(json.values).toEqual({ email: 'a@b.co', guests: ['Zed'], ages: [1], remark: 'Zed is here', pax: [] });
        expect(json.hidden.has('n')).toBe(false);
        expect(validateSubmission(blocks, types, { email: 'a@b.co', guests: ['Ann'] }).hidden.has('n')).toBe(true);
        // Too few, too many, required.
        expect(validateSubmission(blocks, types, { email: 'a@b.co' }).errors).toEqual({ guests: 'This field is required.' });
        expect(validateSubmission(blocks, types, { email: 'a@b.co', guests: [''] }).errors).toEqual({ guests: 'This field is required.' });
        expect(validateSubmission(blocks, types, { email: 'a@b.co', guests: ['A', 'B', 'C', 'D'] }).errors).toEqual({ guests: 'Add at most 3 values.' });
        expect(validateSubmission(blocks, types, { email: 'a@b.co', guests: ['A'], pax: [{ tags: ['a', 'b', 'c'] }] }).errors).toEqual({ 'pax.r1.tags': 'Add at most 2 values.' });
        const fewest = validateBlocks([input('g', 'text', { name: 'g', multiple: true, minItems: 2 })], types, { form: true }).blocks;
        expect(validateSubmission(fewest, types, { g: ['one'] }).errors).toEqual({ g: 'Add at least 2 values.' });
        expect(validateSubmission(fewest, types, {}).errors).toEqual({ g: 'Add at least 2 values.' });
    });

    it('stores a list of the kind, and shows and merges the items', () => {
        const inputs = formInputs(checkedGuests(), types);
        const resource = resolveResource(submissionResource({ id: '8f14e45f-ceea-467a-9575-1f2b3c4d5e6f', title: 'Guests' }, inputs), 'cms');
        expect(resource.fields.guests).toMatchObject({ kind: 'string', multiple: true, search: true, label: 'Guest names' });
        expect(resource.fields.guests!.nullable).toBeUndefined();
        expect(resource.fields.ages).toMatchObject({ kind: 'number', multiple: true });
        expect(resource.fields.pax!.fields!.tags).toMatchObject({ kind: 'string', multiple: true });
        expect(displayValue(inputs[1]!, ['Ann', 'Bea'])).toBe('Ann, Bea');
        expect(displayValue(inputs[2]!, [30, 41])).toBe('30, 41');
        const context = { form: { id: 'f', title: 'Guests' }, inputs, values: { email: 'ada@example.com', guests: ['Ann', 'Bea'], ages: [30] }, site: { title: 'Site', url: 'https://s.example', adminEmail: 'admin@s.example' } };
        expect(renderMergeTags('{all_fields}', context)).toBe('Email: ada@example.com\nGuest names: Ann, Bea\nAges: 30');
        expect(renderMergeTags('{field:guests}', context)).toBe('Ann, Bea');
    });
});

describe('the forms collection', () => {
    it('is a valid collection with settings defaults', () => {
        expect(collectionProblems(forms)).toEqual([]);
        const resource = resolveResource(collectionResource(forms), 'cms');
        expect(resource.fields.body).toMatchObject({ kind: 'blocks', form: true });
        expect(resource.fields.slug).toBeDefined();
        expect(collectionProblems({ ...forms, builtin: false, name: 'form_abc' })).toContain('Names starting with form_ are reserved for form submissions.');
        expect(formSettings({ limit: 5, store: false })).toMatchObject({ submitLabel: 'Submit', confirmation: 'message', limit: 5, store: false, opensAt: null, redirectUrl: '', turnstile: true });
    });

    it('checks settings and notifications when a form is saved', async () => {
        const hooks = createHookRegistry();
        formsModule.register!({ hooks, settings: { all: async () => ({}) as never }, taxonomies: { get: async () => null }, collection: () => undefined, blocks: () => types, now: Date.now });
        const save = (draft: { [key: string]: unknown }) => hooks.applyFilters(beforeWrite, draft, { resource: 'cms/forms', action: 'create', id: null, previous: null, actor: { kind: 'user', id: 'u' } });
        const body = checked();
        await expect(save({ body, settings: { confirmation: 'redirect' } })).rejects.toThrow();
        await expect(save({ body, settings: { oncePerEmail: 'email' }, notifications: { rules: [{ id: 'admin', label: 'Admin', to: '{admin_email}', subject: 'New {form:title}', body: '{all_fields}' }] } })).resolves.toBeDefined();
        const failure = await save({ body, settings: { oncePerEmail: 'name' } }).catch((error: Error) => (error.cause as Error).message);
        expect(failure).toBe('One submission per address needs an email field; name is not one.');
        // Other resources pass through.
        await expect(hooks.applyFilters(beforeWrite, { x: 1 }, { resource: 'cms/posts', action: 'create', id: null, previous: null, actor: { kind: 'user', id: 'u' } })).resolves.toEqual({ x: 1 });
    });

    it('checks notification rules and fills merge tags', () => {
        const inputs = formInputs(checked(), types);
        const rule = { id: 'auto', label: 'Autoresponder', to: '{field:email}', subject: 'Thanks, {field:name}', body: 'You wrote:\n{all_fields}\n{site:title}', replyTo: 'team@example.com' };
        expect(notificationProblems({ rules: [rule] }, inputs)).toEqual([]);
        expect(notificationProblems(null, inputs)).toEqual([]);
        expect(notificationProblems([], inputs)).toEqual(['Notifications are { rules: [...] }.']);
        expect(notificationProblems({ rules: [{ ...rule, to: '{field:name}, not-mail', subject: '{field:nope} {oops}' }, { ...rule, label: '' }] }, inputs)).toEqual([
            'Notification Autoresponder: {field:nope} is not a field of this form.',
            'Notification Autoresponder: {oops} is not a merge tag.',
            'Notification Autoresponder: recipients can use only email fields, not {field:name}.',
            'Notification Autoresponder: not-mail is not an email address.',
            'Notification auto: needs a distinct ID.',
            'Notification auto: needs a name of at most 80 characters.',
        ]);
        expect(notificationProblems({ rules: [{ ...rule, when: { rules: [{ field: 'gone', op: 'empty' }] } }] }, inputs)).toEqual(['Notification Autoresponder: its condition names gone, which is not a field of this form.']);
        const values = { name: 'Ada', email: 'ada@example.com', topic: 'sales', callMe: false };
        const context = { form: { id: 'f', title: 'Contact' }, inputs, values, site: { title: 'Site', url: 'https://example.com', adminEmail: 'admin@example.com' }, submission: { id: 's1' } };
        expect(renderMergeTags(rule.body, context)).toBe('You wrote:\nYour name: Ada\nEmail: ada@example.com\nTopic: Sales\nCall me: No\nSite');
        expect(renderMergeTags('{field:email} {admin_email} {submission:id} {user:email}|{unknown} {field:gone}', context)).toBe('ada@example.com admin@example.com s1 |{unknown} {field:gone}');
        expect(emailAddresses(renderMergeTags('{field:email}, {admin_email}, nobody, ada@example.com', context))).toEqual(['ada@example.com', 'admin@example.com']);
    });
});

describe('plugins and forms', () => {
    it('declare form hooks and input blocks in their manifest', () => {
        const manifest = {
            schemaVersion: 1, name: 'acme', version: '1.0.0',
            hooks: [{ point: 'cms.form.validate', version: 1 }, { point: 'cms.form.submitted', version: 1 }],
            blocks: [{ name: 'acme/rating', label: 'Rating', category: 'form', input: { kind: 'number' }, fields: inputFields({ stars: field.integer({ default: 5, min: 3, max: 10, label: 'Stars' }) }) }],
        };
        expect(manifestProblems(manifest)).toEqual([]);
        expect(requestedGrants(manifest as never)).toEqual(['hook:cms.form.submitted', 'hook:cms.form.validate']);
        expect(manifestProblems({ ...manifest, hooks: [{ point: 'cms.form.sent', version: 1 }] })).toEqual(['hooks: cms.form.sent is not a CMS extension point.']);
        // A plugin's input block is checked like the built-in ones.
        const types = new Map([...FORM_BLOCKS, manifest.blocks[0] as BlockDeclaration].map(block => [block.name, block]));
        const blocks = validateBlocks([{ id: 'r', type: 'acme/rating', data: { label: 'How did we do?' } }], types, { form: true }).blocks;
        expect(formInputs(blocks, types).map(input => [input.name, input.kind])).toEqual([['howDidWeDo', 'number']]);
    });
});
