/**
 * Forms built from blocks. A form is an entry of the built-in `forms` collection whose `body`
 * holds input blocks laid out with the core containers. Its submissions are records of a
 * resource of their own, typed from its inputs and stored in a table of their own. Pure
 * functions: the site's script and the host validate a submission with the same code.
 */
import { field, type FieldDeclaration } from './fields';
import { INPUT_NAME, flattenBlocks, type Block, type BlockCondition, type BlockDeclaration, type ConditionRule, type InputKind } from './blocks';
import { blockConditionProblem } from './block-shape';
import type { CollectionDefinition } from './collections';
import type { RecordShape } from './records';
import type { ResourceDeclaration } from './resource';
import { PERMISSIONS } from './permissions';

// --- Input blocks -----------------------------------------------------------------------

const NAME = field.string({ max: 40, pattern: INPUT_NAME.source.slice(1, -1), label: 'Field name', description: 'Submissions and exports keep the value under this name. Taken from the label when empty.' });
const LABEL = field.string({ required: true, max: 200, label: 'Label' });
const HELP = field.string({ max: 500, label: 'Help text' });
const REQUIRED = field.boolean({ default: false, label: 'Required' });
const PLACEHOLDER = field.string({ max: 200, label: 'Placeholder' });
const OPTIONS = field.list('string', { label: 'Choices', description: 'One per line. Write value|Label to store a value other than the label.' });
const INLINE = field.boolean({ default: false, label: 'Show choices in a row' });
const DATE = '\\d{4}-\\d{2}-\\d{2}';
/** Items a multiple input takes at most, whatever its settings. */
export const FORM_ITEM_LIMIT = 50;
/** The input kinds that take `multiple`: one control per value, added one at a time. */
export const MULTIPLE_INPUT_KINDS: readonly InputKind[] = Object.freeze(['string', 'text', 'email', 'url', 'phone', 'number', 'date']);
/** The settings of an input that can take several values; the same four a field block has. */
const MULTIPLE_SETTINGS: { readonly [name: string]: FieldDeclaration } = {
    multiple: field.boolean({ default: false, label: 'Multiple', description: 'Several values, added one at a time.' }),
    minItems: field.integer({ min: 0, max: FORM_ITEM_LIMIT, label: 'Fewest values' }),
    maxItems: field.integer({ min: 1, max: FORM_ITEM_LIMIT, label: 'Most values' }),
    addLabel: field.string({ max: 80, default: 'Add another', label: 'Add button' }),
};

/** The fields every input block has, then its own. Plugins build their input blocks with it. */
export function inputFields(own: { readonly [name: string]: FieldDeclaration } = {}): { [name: string]: FieldDeclaration } {
    return { label: LABEL, name: NAME, description: HELP, required: REQUIRED, ...own };
}

const textInput = (name: string, label: string, icon: string, kind: InputKind, description: string, keywords: readonly string[]): BlockDeclaration => ({
    name, label, icon, category: 'form', description, input: { kind }, keywords,
    fields: inputFields({ placeholder: PLACEHOLDER, defaultValue: field.string({ max: 500, label: 'Default value' }), ...MULTIPLE_SETTINGS }),
});

/** Built-in input blocks. A submit button is not a block: the form's settings label it. */
export const FORM_BLOCKS: readonly BlockDeclaration[] = Object.freeze([
    { name: 'form/text', keywords: ['single line', 'input', 'string', 'name'], label: 'Text', icon: 'text-field', category: 'form', description: 'One line of text.', input: { kind: 'string' }, fields: inputFields({
        placeholder: PLACEHOLDER,
        defaultValue: field.string({ max: 500, label: 'Default value' }),
        minLength: field.integer({ min: 0, max: 10_000, label: 'Minimum length' }),
        maxLength: field.integer({ default: 255, min: 1, max: 10_000, label: 'Maximum length' }),
        pattern: field.string({ max: 200, label: 'Pattern', description: 'A regular expression the whole value must match.' }),
        ...MULTIPLE_SETTINGS,
    }) },
    textInput('form/email', 'Email', 'letter', 'email', 'An email address.', ['mail', 'address', 'contact']),
    textInput('form/url', 'Website', 'link', 'url', 'A web address.', ['url', 'link', 'homepage']),
    textInput('form/phone', 'Phone', 'phone', 'phone', 'A phone number.', ['tel', 'telephone', 'mobile', 'number']),
    { name: 'form/textarea', keywords: ['multi line', 'textarea', 'message', 'long text'], label: 'Paragraph text', icon: 'text-square', category: 'form', description: 'Several lines of text.', input: { kind: 'text' }, fields: inputFields({
        placeholder: PLACEHOLDER,
        defaultValue: field.text({ max: 5000, label: 'Default value' }),
        rows: field.integer({ default: 5, min: 2, max: 20, label: 'Rows' }),
        minLength: field.integer({ min: 0, max: 50_000, label: 'Minimum length' }),
        maxLength: field.integer({ default: 5000, min: 1, max: 50_000, label: 'Maximum length' }),
        ...MULTIPLE_SETTINGS,
    }) },
    { name: 'form/number', keywords: ['numeric', 'quantity', 'amount'], label: 'Number', icon: 'calculator', category: 'form', description: 'A number, within limits.', input: { kind: 'number' }, fields: inputFields({
        placeholder: PLACEHOLDER,
        defaultValue: field.number({ nullable: true, label: 'Default value' }),
        min: field.number({ nullable: true, label: 'Minimum' }),
        max: field.number({ nullable: true, label: 'Maximum' }),
        step: field.number({ nullable: true, min: 0, label: 'Step', description: 'Values go up in steps of this size from the minimum. Empty for any value; 1 for whole numbers.' }),
        ...MULTIPLE_SETTINGS,
    }) },
    { name: 'form/date', keywords: ['calendar', 'day'], label: 'Date', icon: 'calendar', category: 'form', description: 'A day of the calendar.', input: { kind: 'date' }, fields: inputFields({
        defaultValue: field.string({ max: 10, pattern: DATE, label: 'Default value' }),
        min: field.string({ max: 10, pattern: DATE, label: 'Earliest' }),
        max: field.string({ max: 10, pattern: DATE, label: 'Latest' }),
        ...MULTIPLE_SETTINGS,
    }) },
    { name: 'form/select', keywords: ['select', 'list', 'choice', 'option'], label: 'Dropdown', icon: 'list-down', category: 'form', description: 'One choice from a list.', input: { kind: 'choice' }, fields: inputFields({
        options: OPTIONS,
        placeholder: field.string({ max: 200, default: 'Choose…', label: 'Prompt' }),
        defaultValue: field.string({ max: 200, label: 'Default value' }),
    }) },
    { name: 'form/radio', keywords: ['radio', 'choice', 'option', 'single'], label: 'Multiple choice', icon: 'record-circle', category: 'form', description: 'One choice, all shown.', input: { kind: 'choice' }, fields: inputFields({
        options: OPTIONS, inline: INLINE,
        defaultValue: field.string({ max: 200, label: 'Default value' }),
    }) },
    { name: 'form/checkboxes', keywords: ['multiple', 'choices', 'options', 'tick'], label: 'Checkboxes', icon: 'checklist', category: 'form', description: 'Any number of choices.', input: { kind: 'choices' }, fields: inputFields({
        options: OPTIONS, inline: INLINE,
    }) },
    { name: 'form/checkbox', keywords: ['tick', 'boolean', 'yes no', 'toggle'], label: 'Checkbox', icon: 'check-square', category: 'form', description: 'A yes or no.', input: { kind: 'boolean' }, fields: inputFields({
        text: field.string({ max: 500, label: 'Checkbox text', description: 'Shown beside the box; the label when empty.' }),
        defaultValue: field.boolean({ default: false, label: 'Checked at first' }),
    }) },
    { name: 'form/consent', keywords: ['agree', 'terms', 'gdpr', 'privacy'], label: 'Consent', icon: 'shield-check', category: 'form', description: 'A box people must tick to agree.', input: { kind: 'boolean' }, fields: {
        ...inputFields(),
        required: field.boolean({ default: true, label: 'Required' }),
        text: field.text({ required: true, max: 2000, format: 'markdown', label: 'Agreement', description: 'Shown beside the box. Links are allowed.' }),
    } },
    { name: 'form/hidden', keywords: ['utm', 'tracking', 'source', 'secret'], label: 'Hidden', icon: 'eye-closed', category: 'form', description: 'A value visitors do not see, from the default or the page address.', input: { kind: 'string' }, fields: inputFields({
        defaultValue: field.string({ max: 500, label: 'Value' }),
    }) },
    { name: 'form/repeater', keywords: ['rows', 'repeat', 'list', 'passengers', 'attendees', 'items', 'group'], label: 'Repeater', icon: 'layers-minimalistic', category: 'form', description: 'A set of fields people fill in once per row: passengers, attendees, items.', input: { kind: 'rows' }, children: {}, fields: inputFields({
        rowLabel: field.string({ max: 60, label: 'Row name', description: 'What one row is, such as Passenger: rows are numbered with it.' }),
        addLabel: field.string({ max: 80, default: 'Add another', label: 'Add button' }),
        min: field.integer({ min: 0, max: 50, label: 'Fewest rows' }),
        max: field.integer({ min: 1, max: 50, label: 'Most rows' }),
    }) },
] satisfies BlockDeclaration[]);

/** Rows a repeater takes at most, whatever its settings. */
export const FORM_ROW_LIMIT = 50;
/** The row id of a repeater's template row on a page, replaced by the page's script when a row is added. */
export const TEMPLATE_ROW = '__row__';

/** The type that places a form in content: `form` is the form's slug. */
export const FORM_EMBED_BLOCK: BlockDeclaration = Object.freeze({
    name: 'core/form', label: 'Form', icon: 'checklist-minimalistic', category: 'widgets', description: 'One of the site\'s forms.',
    fields: { form: field.string({ required: true, max: 200, pattern: '[a-z0-9]+(?:-[a-z0-9]+)*', label: 'Form', description: 'The form\'s slug.' }) },
});

// --- Inputs of a form ---------------------------------------------------------------------

export interface ChoiceOption {
    readonly value: string;
    readonly label: string;
}

/** A form input, read from its block. */
export interface FormField {
    /** The block's ID. */
    readonly id: string;
    readonly type: string;
    readonly name: string;
    readonly label: string;
    readonly kind: InputKind;
    readonly required: boolean;
    /** Several values of the kind, each its own control; `minItems`, `maxItems` and `addLabel` in `data`. */
    readonly multiple: boolean;
    /** For choice kinds. */
    readonly options: readonly ChoiceOption[];
    readonly data: { readonly [field: string]: unknown };
    /** A repeater's inputs, those of each of its rows; empty for other kinds. */
    readonly inputs: readonly FormField[];
    /** The name of the repeater this input belongs to; null at the form's top level. */
    readonly parent: string | null;
}

/** Choices of an input: `value|Label` or a label that is also the value, at most 100, distinct values. */
export function choiceOptions(lines: unknown): ChoiceOption[] {
    if (!Array.isArray(lines)) return [];
    const options: ChoiceOption[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        if (typeof line !== 'string') continue;
        const bar = line.indexOf('|');
        const value = (bar === -1 ? line : line.slice(0, bar)).trim();
        const label = (bar === -1 ? line : line.slice(bar + 1)).trim() || value;
        if (!value || seen.has(value)) continue;
        seen.add(value);
        options.push(Object.freeze({ value, label }));
        if (options.length === 100) break;
    }
    return options;
}

/**
 * The inputs of a form in document order: those of its top level, a repeater among them
 * carrying its rows' inputs as `inputs`. Blocks of unknown types are left out.
 */
export function formInputs(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, parent: string | null = null): FormField[] {
    const inputs: FormField[] = [];
    const walk = (list: readonly Block[]) => {
        for (const block of list) {
            const kind = types.get(block.type)?.input?.kind;
            if (kind && typeof block.data.name === 'string') {
                inputs.push(Object.freeze({
                    id: block.id, type: block.type, name: block.data.name, kind,
                    label: typeof block.data.label === 'string' && block.data.label ? block.data.label : block.data.name,
                    required: block.data.required === true,
                    multiple: block.data.multiple === true && MULTIPLE_INPUT_KINDS.includes(kind),
                    options: kind === 'choice' || kind === 'choices' ? choiceOptions(block.data.options) : [],
                    data: block.data,
                    // A repeater inside a repeater is not valid; its inputs are left out, as the form check refuses it.
                    inputs: kind === 'rows' && parent === null ? formInputs(block.children ?? [], types, block.data.name) : [],
                    parent,
                }));
                if (kind === 'rows') continue;
            }
            if (block.children) walk(block.children);
        }
    };
    walk(blocks);
    return inputs;
}

/** Every input of a form, the repeaters' rows' inputs after their repeater, in document order. */
export function flatFormInputs(inputs: readonly FormField[]): FormField[] {
    return inputs.flatMap(input => [input, ...input.inputs]);
}

// --- Conditions ---------------------------------------------------------------------------

/** A value of an input: text, a number, a yes or no, the chosen values or a multiple input's items, or a repeater's rows. */
export type FormValue = string | number | boolean | readonly string[] | readonly number[] | readonly FormRow[];
export type FormValues = { readonly [name: string]: FormValue };
/** One row of a repeater: its inputs' values under `_id`, which names the row in errors and in the page. */
export type FormRow = { readonly _id: string; readonly [name: string]: FormValue };

/** Whether a value is a repeater's rows. An empty list is blank either way. */
export function isRows(value: unknown): value is readonly FormRow[] {
    return Array.isArray(value) && value.length > 0 && value.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry));
}
/** A row's values keyed by input name, without `_id`. */
export function rowValues(row: FormRow): FormValues {
    const { _id, ...values } = row;
    return values;
}

const blank = (value: FormValue | null | undefined): boolean =>
    value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);
/** Text to compare: a repeater counts as its number of rows. */
const asText = (value: FormValue): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : typeof value === 'boolean' ? String(value) : isRows(value) ? String(value.length) : (value as readonly (string | number)[]).join(',');
const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

function compare(value: FormValue, expected: string): number | null {
    if (Array.isArray(value) || typeof value === 'boolean') return null;
    const a = typeof value === 'number' ? value : Number(value);
    const b = Number(expected);
    if (String(value).trim() !== '' && expected.trim() !== '' && Number.isFinite(a) && Number.isFinite(b)) return a - b;
    // Dates as YYYY-MM-DD compare as text.
    const text = String(value);
    return text < expected ? -1 : text > expected ? 1 : 0;
}

/** Whether one rule matches the values. A repeater's value is its number of rows. */
export function ruleMatches(rule: ConditionRule, values: FormValues): boolean {
    const raw = values[rule.field];
    const value: FormValue | undefined = isRows(raw) ? raw.length : raw;
    const expected = rule.value ?? '';
    switch (rule.op) {
        case 'empty': return blank(value);
        case 'notEmpty': return !blank(value);
        case 'is': case 'isNot': {
            const match = value !== undefined && (Array.isArray(value) ? value.some(entry => same(entry, expected)) : same(asText(value as FormValue), expected));
            return rule.op === 'is' ? match : !match;
        }
        case 'contains':
            if (blank(value)) return false;
            return Array.isArray(value) ? value.some(entry => same(entry, expected)) : asText(value as FormValue).toLocaleLowerCase().includes(expected.trim().toLocaleLowerCase());
        case 'in': {
            if (blank(value) && value !== false) return false;
            const list = expected.split(',').map(entry => entry.trim()).filter(Boolean);
            const entries = Array.isArray(value) ? value : [asText(value as FormValue)];
            return entries.some(entry => list.some(item => same(item, entry)));
        }
        case 'gt': case 'lt': {
            if (blank(value)) return false;
            const order = compare(value as FormValue, expected);
            return order !== null && (rule.op === 'gt' ? order > 0 : order < 0);
        }
    }
}

/** Whether a block with this condition shows. A block without one always shows. */
export function conditionShows(when: BlockCondition | undefined, values: FormValues): boolean {
    if (!when) return true;
    const results = when.rules.map(rule => ruleMatches(rule, values));
    const matched = when.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    return when.action === 'hide' ? !matched : matched;
}

/**
 * Which blocks of a form are hidden by their conditions, or inside a hidden container, and
 * the values that count: hidden inputs count as empty, so conditions that depend on them
 * follow. Settles after a few rounds; a cycle stops at the last round.
 */
export function formVisibility(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, values: FormValues): { hidden: ReadonlySet<string>; values: FormValues } {
    const inputs = new Map(formInputs(blocks, types).map(input => [input.id, input.name]));
    let current: FormValues = values;
    let hidden = new Set<string>();
    for (let round = 0; round <= inputs.size; round++) {
        const next = new Set<string>();
        const walk = (list: readonly Block[], inside: boolean) => {
            for (const block of list) {
                const off = inside || !conditionShows(block.when, current);
                if (off) next.add(block.id);
                // A repeater's rows have conditions of their own, settled per row with the row's values.
                if (types.get(block.type)?.input?.kind !== 'rows') walk(block.children ?? [], off);
            }
        };
        walk(blocks, false);
        const counted: { [name: string]: FormValue } = {};
        for (const [name, value] of Object.entries(values)) counted[name] = value;
        for (const [id, name] of inputs) if (next.has(id)) delete counted[name];
        const settled = next.size === hidden.size && [...next].every(id => hidden.has(id));
        hidden = next;
        current = counted;
        if (settled) break;
    }
    return { hidden, values: current };
}

/** The form's blocks without those its conditions hide. */
export function visibleBlocks(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, values: FormValues): Block[] {
    const { hidden } = formVisibility(blocks, types, values);
    const keep = (list: readonly Block[]): Block[] => list.filter(block => !hidden.has(block.id)).map(block => block.children ? { ...block, children: keep(block.children) } : block);
    return keep(blocks);
}

// --- Submissions --------------------------------------------------------------------------

/** What a form posts: text, or several texts for checkboxes, or rows of those for a repeater. JSON may send numbers and booleans too. */
export type SubmittedValues = { readonly [name: string]: unknown };
/** A posted value as form data carries it. */
export type PostedValue = string | string[] | { [name: string]: string | string[] }[];

/** The HTML name of an input: `name` at the top level, `repeater[row id][name]` in a row. Errors use the dotted key. */
export function inputHtmlName(key: string): string {
    const [head, ...rest] = key.split('.');
    return `${head}${rest.map(part => `[${part}]`).join('')}`;
}
/** The dotted key of a posted field, from its HTML name. */
export function inputKey(htmlName: string): string {
    return htmlName.replace(/\[([^\]]*)\]/g, '.$1');
}

export interface SubmissionCheck {
    /** Values of the shown inputs that were filled in, typed by kind. */
    readonly values: FormValues;
    /** Messages by input name, for the shown inputs. */
    readonly errors: { readonly [name: string]: string };
    /** IDs of hidden blocks. */
    readonly hidden: ReadonlySet<string>;
}

/**
 * Read the inputs of a form from posted form data: every value of a checkboxes or multiple
 * input, one of the others, and a repeater's rows from `repeater[row id][input]` names, in
 * the order the rows appear, at most `FORM_ROW_LIMIT` of them.
 */
export function formDataValues(form: Pick<FormData, 'get' | 'getAll' | 'keys'>, inputs: readonly FormField[]): { [name: string]: PostedValue } {
    const values: { [name: string]: PostedValue } = {};
    const read = (input: FormField, htmlName: string): string | string[] | undefined => {
        if (input.kind === 'choices' || input.multiple) return form.getAll(htmlName).filter((entry): entry is string => typeof entry === 'string');
        const value = form.get(htmlName);
        return typeof value === 'string' ? value : undefined;
    };
    let keys: string[] | undefined;
    for (const input of inputs) {
        if (input.kind === 'rows') {
            keys ??= [...form.keys()];
            const ids: string[] = [];
            const pattern = new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([A-Za-z0-9_-]{1,40})\\]\\[`);
            for (const key of keys) {
                const id = pattern.exec(key)?.[1];
                if (id && !ids.includes(id)) ids.push(id);
            }
            values[input.name] = ids.slice(0, FORM_ROW_LIMIT).map(id => {
                const row: { [name: string]: string | string[] } = { _id: id };
                for (const child of input.inputs) {
                    const value = read(child, `${input.name}[${id}][${child.name}]`);
                    if (value !== undefined) row[child.name] = value;
                }
                return row;
            });
            continue;
        }
        const value = read(input, input.name);
        if (value !== undefined) values[input.name] = value;
    }
    return values;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const PHONE = /^\+?[0-9 ().-]{5,30}$/;

/** Read one posted value as the input's kind. */
function readValue(input: FormField, raw: unknown): { value: FormValue | null; error?: string } {
    const one = Array.isArray(raw) ? raw[0] : raw;
    switch (input.kind) {
        case 'boolean': return { value: one === true || (typeof one === 'string' && ['on', 'true', '1', 'yes'].includes(one.toLowerCase())) };
        case 'choices': {
            const list = (Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw]).filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean);
            return { value: [...new Set(list)] };
        }
        case 'number': {
            if (typeof one === 'number') return Number.isFinite(one) ? { value: one } : { value: null, error: 'Enter a number.' };
            const text = typeof one === 'string' ? one.trim() : '';
            if (!text) return { value: null };
            const value = Number(text);
            return Number.isFinite(value) ? { value } : { value: null, error: 'Enter a number.' };
        }
        default: {
            if (one !== undefined && one !== null && typeof one !== 'string') return { value: null, error: 'Enter text.' };
            const text = input.kind === 'text' ? (one ?? '').replace(/\r\n?/g, '\n').trim() : (one ?? '').trim();
            return { value: text || null };
        }
    }
}

/** The posted items of a multiple input, each read as the kind, in posted order, at most `FORM_ITEM_LIMIT`; a scalar is one item. */
function readItems(input: FormField, raw: unknown): { value: FormValue | null; error?: string }[] {
    const list = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw];
    return list.slice(0, FORM_ITEM_LIMIT).map(item => readValue(input, item));
}

const numberData = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Why a filled-in value is not right for its input, as a sentence for the visitor. */
function valueProblem(input: FormField, value: FormValue): string | undefined {
    const data = input.data;
    switch (input.kind) {
        case 'string': case 'text': case 'email': case 'url': case 'phone': {
            const text = value as string;
            const length = [...text].length;
            const fallback = input.kind === 'text' ? 5000 : input.kind === 'url' ? 2048 : input.kind === 'email' ? 254 : input.kind === 'phone' ? 30 : 255;
            const max = numberData(data.maxLength) ?? fallback;
            const min = numberData(data.minLength);
            if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) return 'Enter well-formed text.';
            if (length > max) return `Use at most ${max} characters.`;
            if (min !== undefined && length < min) return `Use at least ${min} characters.`;
            if (input.kind === 'email' && !EMAIL.test(text)) return 'Enter an email address, such as name@example.com.';
            if (input.kind === 'url') {
                let url: URL | undefined;
                try { url = new URL(text); } catch { /* not a URL */ }
                if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return 'Enter a web address starting with https://.';
            }
            if (input.kind === 'phone' && (!PHONE.test(text) || text.replace(/\D/g, '').length < 5)) return 'Enter a phone number.';
            if (input.kind === 'string' && typeof data.pattern === 'string' && data.pattern) {
                let pattern: RegExp | undefined;
                try { pattern = new RegExp(`^(?:${data.pattern})$`, 'u'); } catch { /* an invalid pattern checks nothing */ }
                if (pattern && !pattern.test(text)) return 'Enter a value in the expected format.';
            }
            return undefined;
        }
        case 'number': {
            const number = value as number;
            const min = numberData(data.min);
            const max = numberData(data.max);
            const step = numberData(data.step);
            if (min !== undefined && number < min) return `Enter ${min} or more.`;
            if (max !== undefined && number > max) return `Enter ${max} or less.`;
            if (step) {
                const steps = (number - (min ?? 0)) / step;
                if (Math.abs(steps - Math.round(steps)) > 1e-9) return step === 1 ? 'Enter a whole number.' : `Enter a multiple of ${step}${min ? ` from ${min}` : ''}.`;
            }
            return undefined;
        }
        case 'date': {
            const text = value as string;
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
            const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
            if (!match || !date || date.toISOString().slice(0, 10) !== text) return 'Enter a date.';
            if (typeof data.min === 'string' && data.min && text < data.min) return `Choose ${data.min} or later.`;
            if (typeof data.max === 'string' && data.max && text > data.max) return `Choose ${data.max} or earlier.`;
            return undefined;
        }
        case 'choice': return input.options.some(option => option.value === value) ? undefined : 'Choose one of the options.';
        case 'choices': return (value as readonly string[]).every(entry => input.options.some(option => option.value === entry)) ? undefined : 'Choose from the options.';
        case 'boolean': return undefined;
    }
}

/** The posted rows of a repeater as objects, in order, at most `FORM_ROW_LIMIT`; anything else is no rows. */
function postedRows(raw: unknown): { [name: string]: unknown }[] {
    return (Array.isArray(raw) ? raw : []).filter((row): row is { [name: string]: unknown } => !!row && typeof row === 'object' && !Array.isArray(row)).slice(0, FORM_ROW_LIMIT);
}

/** What a repeater calls one row, lowercase, for its messages. */
function rowName(input: FormField, count: number): string {
    const label = typeof input.data.rowLabel === 'string' && input.data.rowLabel.trim() ? input.data.rowLabel.trim() : '';
    if (!label) return count === 1 ? 'row' : 'rows';
    return count === 1 ? label : `${label} rows`;
}

/**
 * Check a submission against a form: read each value as its input's kind, apply the
 * conditions, and check the shown inputs. Hidden inputs are neither required nor kept. A
 * repeater's rows are checked the same way, each with its own values over the form's: its
 * errors are keyed `repeater.<row id>.<input>`, its hidden blocks `<row id>:<block id>`.
 */
export function validateSubmission(blocks: readonly Block[], types: ReadonlyMap<string, BlockDeclaration>, raw: SubmittedValues): SubmissionCheck {
    const errors: { [name: string]: string } = {};
    const hidden = new Set<string>();
    const values = checkLevel(blocks, formInputs(blocks, types), types, raw, {}, { key: '', id: '' }, errors, hidden);
    return { values: Object.freeze(values), errors: Object.freeze(errors), hidden };
}

/** One level of a submission: the form's top level, or one row of a repeater with the form's values as `outer`. */
function checkLevel(blocks: readonly Block[], inputs: readonly FormField[], types: ReadonlyMap<string, BlockDeclaration>, raw: SubmittedValues, outer: FormValues,
    prefix: { readonly key: string; readonly id: string }, errors: { [name: string]: string }, hidden: Set<string>): { [name: string]: FormValue } {
    const read: { [name: string]: FormValue } = {};
    const unreadable: { [name: string]: string } = {};
    for (const input of inputs) {
        if (input.kind === 'rows') {
            const entry = raw[input.name];
            if (entry !== undefined && entry !== null && entry !== '' && !Array.isArray(entry)) unreadable[input.name] = 'Send the rows as a list.';
            else if (postedRows(entry).length) read[input.name] = postedRows(entry).map(row => ({ _id: '' }));
            continue;
        }
        if (input.multiple) {
            const items = readItems(input, raw[input.name]).flatMap(item => item.value === null ? [] : [item.value]);
            if (items.length) read[input.name] = items as string[] | number[];
            continue;
        }
        const { value, error } = readValue(input, raw[input.name]);
        if (error) unreadable[input.name] = error;
        else if (value !== null) read[input.name] = value;
    }
    const { hidden: off } = formVisibility(blocks, types, { ...outer, ...read });
    for (const id of off) hidden.add(prefix.id ? `${prefix.id}:${id}` : id);
    const values: { [name: string]: FormValue } = {};
    for (const input of inputs) {
        if (off.has(input.id)) continue;
        const key = `${prefix.key}${input.name}`;
        if (unreadable[input.name]) { errors[key] = unreadable[input.name]!; continue; }
        if (input.kind === 'rows') {
            const children = (blocks.length ? flattenBlocks(blocks).find(entry => entry.id === input.id) : undefined)?.children ?? [];
            // A row nobody filled in, such as the empty one a form starts with, is not a row: it is neither checked nor kept, though its conditions still settle on the page.
            const posted = postedRows(raw[input.name]);
            const filled = (row: { [name: string]: unknown }) => input.inputs.some(child => !blank(readValue(child, row[child.name]).value));
            const count = posted.filter(filled).length;
            const most = Math.min(numberData(input.data.max) ?? FORM_ROW_LIMIT, FORM_ROW_LIMIT);
            const fewest = Math.max(numberData(input.data.min) ?? 0, input.required ? 1 : 0);
            if (count > most) errors[key] = `Add at most ${most} ${rowName(input, most)}.`;
            else if (count < fewest) errors[key] = `Add at least ${fewest} ${rowName(input, fewest)}.`;
            const ids = new Set<string>();
            const rows: FormRow[] = [];
            posted.forEach((row, index) => {
                const id = typeof row._id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(row._id) && !ids.has(row._id) ? row._id : `r${index + 1}`;
                ids.add(id);
                if (filled(row)) {
                    rows.push(Object.freeze({ _id: id, ...checkLevel(children, input.inputs, types, row, { ...outer, ...read }, { key: `${key}.${id}.`, id }, errors, hidden) }));
                    return;
                }
                const own: { [name: string]: FormValue } = {};
                for (const child of input.inputs) { const { value } = readValue(child, row[child.name]); if (value !== null) own[child.name] = value; }
                for (const off of formVisibility(children, types, { ...outer, ...read, ...own }).hidden) hidden.add(`${id}:${off}`);
            });
            values[input.name] = rows;
            continue;
        }
        if (input.multiple) {
            // Each item is checked as the kind; a blank item, such as the empty control a form starts with, is dropped. Errors name the item's position as posted.
            const items = readItems(input, raw[input.name]);
            const kept: (string | number)[] = [];
            let count = 0;
            items.forEach((item, index) => {
                if (item.error) { errors[`${key}.${index + 1}`] = item.error; count++; return; }
                if (item.value === null) return;
                count++;
                const problem = valueProblem(input, item.value);
                if (problem) errors[`${key}.${index + 1}`] = problem;
                else kept.push(item.value as string | number);
            });
            const most = Math.min(numberData(input.data.maxItems) ?? FORM_ITEM_LIMIT, FORM_ITEM_LIMIT);
            const fewest = Math.max(numberData(input.data.minItems) ?? 0, input.required ? 1 : 0);
            if (count > most) errors[key] = `Add at most ${most} ${most === 1 ? 'value' : 'values'}.`;
            else if (count === 0 && fewest === 1) errors[key] = 'This field is required.';
            else if (count < fewest) errors[key] = `Add at least ${fewest} values.`;
            if (kept.length) values[input.name] = kept as string[] | number[];
            continue;
        }
        const value = read[input.name];
        if (blank(value)) {
            if (input.required) errors[key] = input.kind === 'boolean' ? 'Tick this box to continue.' : input.kind === 'choices' ? 'Choose at least one option.' : 'This field is required.';
            // An unticked box is a no.
            if (input.kind === 'boolean') values[input.name] = false;
            continue;
        }
        const problem = valueProblem(input, value!);
        if (problem) errors[key] = problem;
        else values[input.name] = value!;
    }
    return values;
}

/**
 * How a value reads in emails, lists and exports: choice labels, Yes or No, values joined by
 * commas, and a repeater as its number of rows ("Passenger × 3"); `displayRows` has the rows.
 */
export function displayValue(input: Pick<FormField, 'kind' | 'options'> & { readonly data?: FormField['data'] }, value: FormValue | null | undefined): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (input.kind === 'rows') {
        const count = Array.isArray(value) ? value.length : 0;
        const label = typeof input.data?.rowLabel === 'string' && input.data.rowLabel.trim() ? input.data.rowLabel.trim() : '';
        return label ? `${label} × ${count}` : `${count} ${count === 1 ? 'row' : 'rows'}`;
    }
    const label = (entry: string | number) => input.options.find(option => option.value === entry)?.label ?? String(entry);
    if (isRows(value)) return `${value.length} ${value.length === 1 ? 'row' : 'rows'}`;
    if (Array.isArray(value)) return (value as readonly (string | number)[]).map(label).join(', ');
    return input.kind === 'choice' ? label(String(value)) : String(value);
}

/** A repeater's rows as lines of text, one per row: `Label: value, Label: value`, inputs without a value left out. */
export function displayRows(input: Pick<FormField, 'inputs'>, value: FormValue | null | undefined): string[] {
    if (!isRows(value)) return [];
    return value.map(row => input.inputs
        .filter(child => !blank(row[child.name]) || row[child.name] === false)
        .map(child => `${child.label}: ${displayValue(child, row[child.name])}`).join(', '));
}

// --- The forms collection -----------------------------------------------------------------

/** What a form does around its inputs. Every setting is optional; `formSettings` fills the defaults. */
export const FORM_SETTINGS = Object.freeze({
    submitLabel: field.string({ max: 80, default: 'Submit', label: 'Submit button' }),
    confirmation: field.enum(['message', 'redirect'], { default: 'message', label: 'After submitting', choices: { message: 'Show a message', redirect: 'Go to a page' } }),
    message: field.text({ max: 5000, format: 'markdown', default: 'Thanks! We received your submission.', label: 'Message' }),
    redirectUrl: field.string({ max: 2048, pattern: '(?:https?://\\S+|/\\S*)?', label: 'Page address', description: 'A path such as /thanks, or a full address.' }),
    closedMessage: field.text({ max: 2000, format: 'markdown', default: 'This form is closed.', label: 'Closed message' }),
    limit: field.integer({ min: 1, max: 10_000_000, label: 'Submission limit', description: 'Close the form after this many submissions. Empty for no limit.' }),
    opensAt: field.datetime({ label: 'Opens' }),
    closesAt: field.datetime({ label: 'Closes' }),
    requireSignIn: field.boolean({ default: false, label: 'Only signed-in people can submit' }),
    oncePerUser: field.boolean({ default: false, label: 'One submission per person', description: 'People sign in to submit.' }),
    oncePerEmail: field.string({ max: 40, pattern: `(?:${INPUT_NAME.source.slice(1, -1)})?`, label: 'One submission per address in', description: 'The name of an email field. Empty to allow repeats.' }),
    store: field.boolean({ default: true, label: 'Keep submissions', description: 'Off sends the notifications and keeps nothing.' }),
    recordIp: field.boolean({ default: true, label: 'Keep the sender\'s IP address' }),
    turnstile: field.boolean({ default: true, label: 'Check for bots with Turnstile', description: 'When the site has Turnstile keys.' }),
});

export interface FormSettings {
    readonly submitLabel: string;
    readonly confirmation: 'message' | 'redirect';
    readonly message: string;
    readonly redirectUrl: string;
    readonly closedMessage: string;
    readonly limit: number | null;
    readonly opensAt: number | null;
    readonly closesAt: number | null;
    readonly requireSignIn: boolean;
    readonly oncePerUser: boolean;
    readonly oncePerEmail: string;
    readonly store: boolean;
    readonly recordIp: boolean;
    readonly turnstile: boolean;
}

/** A form's settings with defaults for those it does not set. */
export function formSettings(value: unknown): FormSettings {
    const stored = value && typeof value === 'object' && !Array.isArray(value) ? value as { [key: string]: unknown } : {};
    const settings: { [key: string]: unknown } = {};
    for (const [name, declaration] of Object.entries(FORM_SETTINGS)) {
        const entry = stored[name];
        settings[name] = entry !== undefined && entry !== null && entry !== '' ? entry : declaration.default ?? (declaration.kind === 'string' || declaration.kind === 'text' ? '' : null);
    }
    return Object.freeze(settings) as unknown as FormSettings;
}

/**
 * Built-in forms: their inputs and layout are blocks, their settings and notifications are
 * fields. The slug names a form on the site and in the API; submissions are kept apart.
 */
export const forms: CollectionDefinition = {
    name: 'forms',
    label: 'Forms',
    singular: 'Form',
    icon: 'checklist-minimalistic',
    builtin: true,
    // Forms have their own screens; the collection manager and field groups stay out of them.
    managed: true,
    // Draft forms are built in the dashboard; the site shows and takes only published ones.
    visibility: 'private',
    description: 'Forms built from blocks, with their own submissions.',
    fields: {
        body: { ...field.blocks({ label: 'Form' }), form: true },
        enabled: field.boolean({ default: true, placement: 'sidebar', label: 'Accepting submissions' }),
        settings: field.group(FORM_SETTINGS, { label: 'Settings' }),
        notifications: field.json({ label: 'Notifications', description: 'Emails sent for each submission.' }),
    },
};

// --- Submission storage -------------------------------------------------------------------

export const SUBMISSION_STATUSES = Object.freeze(['new', 'read', 'spam', 'trash'] as const);
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** What the host records beside the values. */
export const SUBMISSION_META = Object.freeze({
    ip: field.string({ max: 64, label: 'IP address' }),
    userAgent: field.string({ max: 300, label: 'Browser' }),
    referrer: field.string({ max: 2048, label: 'Referrer' }),
    page: field.string({ max: 2048, label: 'Page' }),
    locale: field.string({ max: 16, label: 'Language' }),
});

export interface SubmissionMeta {
    readonly ip?: string;
    readonly userAgent?: string;
    readonly referrer?: string;
    readonly page?: string;
    readonly locale?: string;
}

/**
 * The resource holding a form's submissions, `cms/form_<form id>`: its table is the form's
 * own, so a busy form never grows another's. Named by the form's ID, so renaming the form or
 * changing its slug keeps the table.
 */
export function submissionResourceName(formId: string): string {
    const name = `form_${formId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (name.length === 5 || name.length > 41) throw new Error(`Form ${formId} cannot name a submissions table.`);
    return name;
}

/** Prefix of submission resources in the `cms` namespace; collections cannot take it. */
export const SUBMISSION_PREFIX = 'form_';

function inputField(input: FormField): FieldDeclaration {
    const declaration = singleInputField(input);
    if (!input.multiple) return declaration;
    // A multiple input is a list of the kind's values: never null, empty when nothing was entered.
    const { nullable, ...rest } = declaration;
    return { ...rest, multiple: true };
}

function singleInputField(input: FormField): FieldDeclaration {
    const label = input.label.slice(0, 200);
    switch (input.kind) {
        case 'rows': {
            // Rows are not searched or indexed: submissions are found by their top-level inputs.
            const fields = Object.fromEntries(input.inputs.filter(child => child.kind !== 'rows').map(child => { const { search, ...declaration } = inputField(child); return [child.name, declaration]; }));
            return field.rows(fields, { nullable: true, max: FORM_ROW_LIMIT, label });
        }
        case 'text': return field.text({ nullable: true, max: 50_000, search: true, label });
        case 'number': return field.number({ nullable: true, label });
        case 'boolean': return field.boolean({ nullable: true, label });
        case 'choices': return field.list('string', { label });
        case 'string': case 'email': return field.string({ nullable: true, max: 10_000, search: true, label });
        default: return field.string({ nullable: true, max: 10_000, label });
    }
}

/**
 * Submissions of a form: one field per input, then the status, a note and what the host
 * records. Only the host writes them; reading and handling need `cms:submissions`. Added
 * inputs are new fields; removed ones keep their stored values.
 */
export function submissionResource(form: { readonly id: string; readonly title?: string }, inputs: readonly FormField[], options: { readonly indexed?: readonly string[] } = {}): ResourceDeclaration {
    const fields: { [name: string]: FieldDeclaration } = {};
    let searched = 0;
    for (const input of inputs) {
        let declaration = inputField(input);
        if (declaration.search && ++searched > 16) declaration = { ...declaration, search: false };
        // Inputs looked up on every submission, such as the email of "one per address".
        if (options.indexed?.includes(input.name) && declaration.kind === 'string') declaration = { ...declaration, index: true };
        fields[input.name] = declaration;
    }
    fields.status = field.enum(SUBMISSION_STATUSES, { required: true, default: 'new', label: 'Status' });
    fields.note = field.text({ max: 5000, nullable: true, label: 'Note' });
    fields.meta = field.group(SUBMISSION_META, { label: 'Details' });
    const handle = { permission: PERMISSIONS.manageSubmissions };
    return {
        name: submissionResourceName(form.id),
        owner: 'cms',
        label: `${form.title ?? 'Form'} submissions`.slice(0, 120),
        ownership: true,
        revisions: false,
        schemaless: true,
        fields,
        indexes: [{ name: 'inbox', fields: ['status', '_createdAt'] }],
        access: { read: handle, create: 'none', update: handle, delete: handle },
    };
}

/** A submission as the dashboard, hooks and notifications see it. */
export interface SubmissionShape {
    readonly id: string;
    /** The form's ID. */
    readonly form: string;
    readonly status: SubmissionStatus;
    readonly values: FormValues;
    readonly note: string;
    readonly meta: SubmissionMeta;
    /** The signed-in person who submitted, if any. */
    readonly user: string | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}

/** A submission from its record. Values of removed inputs stay out. */
export function submissionOf(formId: string, record: RecordShape, inputs: readonly FormField[]): SubmissionShape {
    const values: { [name: string]: FormValue } = {};
    for (const input of inputs) {
        const value = record[input.name];
        if (value !== undefined && value !== null) values[input.name] = value as FormValue;
    }
    return Object.freeze({
        id: record.id, form: formId,
        status: (SUBMISSION_STATUSES as readonly unknown[]).includes(record.status) ? record.status as SubmissionStatus : 'new',
        values: Object.freeze(values), note: typeof record.note === 'string' ? record.note : '',
        meta: Object.freeze({ ...(record.meta && typeof record.meta === 'object' ? record.meta as SubmissionMeta : {}) }),
        user: record.owner, createdAt: record.createdAt, updatedAt: record.updatedAt,
    });
}

// --- Notifications ------------------------------------------------------------------------

/** An email sent for each submission. Text fields take merge tags such as `{field:email}`. */
export interface NotificationRule {
    /** Stable within the form: 1-40 letters, digits, `_` or `-`. */
    readonly id: string;
    readonly label: string;
    readonly enabled?: boolean;
    /** Comma-separated addresses or tags, such as `{admin_email}, {field:email}`. */
    readonly to: string;
    readonly subject: string;
    /** Plain text; `{all_fields}` lists the answers. */
    readonly body: string;
    readonly replyTo?: string;
    /** Send only when the submission's values match. */
    readonly when?: BlockCondition;
}

export const NOTIFICATION_LIMIT = 10;
const RULE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const TAG = /\{([a-z_]+)(?::([A-Za-z0-9_]+))?\}/g;

/** The rules stored in a form's `notifications` field: `{ rules: [...] }`. */
export function notificationRules(value: unknown): NotificationRule[] {
    const rules = value && typeof value === 'object' && !Array.isArray(value) ? (value as { rules?: unknown }).rules : undefined;
    return Array.isArray(rules) ? rules as NotificationRule[] : [];
}

/** Problems in a form's notification rules against its inputs; empty when they are fine. */
export function notificationProblems(value: unknown, inputs: readonly FormField[]): string[] {
    if (value === null || value === undefined) return [];
    if (typeof value !== 'object' || Array.isArray(value) || !Array.isArray((value as { rules?: unknown }).rules) || Object.keys(value).some(key => key !== 'rules')) return ['Notifications are { rules: [...] }.'];
    const rules = (value as { rules: unknown[] }).rules;
    if (rules.length > NOTIFICATION_LIMIT) return [`A form sends at most ${NOTIFICATION_LIMIT} notifications.`];
    const problems: string[] = [];
    const ids = new Set<string>();
    const names = new Map(inputs.map(input => [input.name, input]));
    for (const rule of rules) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) { problems.push('Each notification is an object.'); continue; }
        const { id, label, enabled, to, subject, body, replyTo, when } = rule as { [key: string]: unknown };
        const at = `Notification ${typeof label === 'string' && label ? label : String(id)}`;
        if (typeof id !== 'string' || !RULE_ID.test(id) || ids.has(id)) problems.push(`${at}: needs a distinct ID.`);
        else ids.add(id);
        if (typeof label !== 'string' || !label.trim() || label.length > 80) problems.push(`${at}: needs a name of at most 80 characters.`);
        if (enabled !== undefined && typeof enabled !== 'boolean') problems.push(`${at}: is on or off.`);
        for (const [key, entry, max, required] of [['to', to, 1000, true], ['replyTo', replyTo, 1000, false], ['subject', subject, 300, true], ['body', body, 20_000, true]] as const) {
            if (entry === undefined && !required) continue;
            if (typeof entry !== 'string' || (required && !entry.trim()) || entry.length > max) { problems.push(`${at}: ${key === 'replyTo' ? 'reply-to' : key} must be ${required ? '1' : '0'} to ${max} characters.`); continue; }
            for (const match of entry.matchAll(TAG)) {
                const problem = tagProblem(match[1]!, match[2], names);
                if (problem) problems.push(`${at}: ${problem}`);
            }
        }
        for (const [key, entry] of [['to', to], ['replyTo', replyTo]] as const) {
            if (typeof entry !== 'string') continue;
            for (const part of entry.split(',').map(item => item.trim()).filter(Boolean)) {
                const tag = /^\{(field|admin_email|user)(?::([A-Za-z0-9_]+))?\}$/.exec(part);
                if (tag) {
                    if (tag[1] === 'field' && names.get(tag[2] ?? '')?.kind !== 'email') problems.push(`${at}: ${key === 'to' ? 'recipients' : 'reply-to'} can use only email fields, not ${part}.`);
                    if (tag[1] === 'user' && tag[2] !== 'email') problems.push(`${at}: use {user:email} for the person who submitted.`);
                } else if (!EMAIL.test(part)) problems.push(`${at}: ${part} is not an email address.`);
            }
        }
        if (when !== undefined) {
            const problem = blockConditionProblem(when);
            if (problem) problems.push(`${at}: ${problem.replace('block when', 'the condition')}`);
            else for (const condition of (when as BlockCondition).rules) if (!names.has(condition.field)) problems.push(`${at}: its condition names ${condition.field}, which is not a field of this form.`);
        }
    }
    return problems;
}

/** Tags a template can use. */
export const MERGE_TAGS = Object.freeze([
    { tag: '{all_fields}', label: 'All answers' },
    { tag: '{form:title}', label: 'Form title' },
    { tag: '{submission:id}', label: 'Submission ID' },
    { tag: '{submission:url}', label: 'Submission in the dashboard' },
    { tag: '{submission:date}', label: 'Submission time' },
    { tag: '{user:email}', label: 'Email of the signed-in sender' },
    { tag: '{user:name}', label: 'Name of the signed-in sender' },
    { tag: '{site:title}', label: 'Site title' },
    { tag: '{site:url}', label: 'Site address' },
    { tag: '{admin_email}', label: 'Administration email' },
] as const);

function tagProblem(name: string, argument: string | undefined, inputs: ReadonlyMap<string, FormField>): string | undefined {
    if (name === 'field') return argument && inputs.has(argument) ? undefined : `{field:${argument ?? ''}} is not a field of this form.`;
    const known = MERGE_TAGS.some(entry => entry.tag === `{${name}${argument ? `:${argument}` : ''}}`);
    return known ? undefined : `{${name}${argument ? `:${argument}` : ''}} is not a merge tag.`;
}

export interface MergeContext {
    readonly form: { readonly id: string; readonly title: string };
    readonly inputs: readonly FormField[];
    readonly values: FormValues;
    readonly submission?: { readonly id: string; readonly url?: string; readonly date?: string };
    readonly user?: { readonly email: string; readonly name: string } | null;
    readonly site: { readonly title: string; readonly url: string; readonly adminEmail: string };
}

/** Markdown's special characters escaped, so a sender's answer shows as typed in a Markdown message. */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, character => `\\${character}`);
}

/**
 * Fill a template's merge tags. Tags it does not know stay as written, so mistakes show.
 * `escape` applies to what senders typed, such as `escapeMarkdown` for a Markdown message.
 */
export function renderMergeTags(template: string, context: MergeContext, options: { readonly escape?: (text: string) => string } = {}): string {
    const inputs = new Map(context.inputs.map(input => [input.name, input]));
    const escape = options.escape ?? ((text: string) => text);
    return template.replace(TAG, (whole, name: string, argument?: string) => {
        switch (argument ? `${name}:${argument}` : name) {
            case 'all_fields': return context.inputs.filter(input => !blank(context.values[input.name]) || context.values[input.name] === false)
                .map(input => input.kind === 'rows'
                    ? `${escape(input.label)}:\n${displayRows(input, context.values[input.name]).map((line, index) => `${index + 1}. ${escape(line)}`).join('\n')}`
                    : `${escape(input.label)}: ${escape(displayValue(input, context.values[input.name]))}`).join('\n');
            case 'form:title': return context.form.title;
            case 'submission:id': return context.submission?.id ?? '';
            case 'submission:url': return context.submission?.url ?? '';
            case 'submission:date': return context.submission?.date ?? '';
            case 'user:email': return escape(context.user?.email ?? '');
            case 'user:name': return escape(context.user?.name ?? '');
            case 'site:title': return context.site.title;
            case 'site:url': return context.site.url;
            case 'admin_email': return context.site.adminEmail;
        }
        if (name === 'field' && argument && inputs.has(argument)) {
            const input = inputs.get(argument)!;
            return input.kind === 'rows' ? displayRows(input, context.values[argument]).map((line, index) => `${index + 1}. ${escape(line)}`).join('\n') : escape(displayValue(input, context.values[argument]));
        }
        return whole;
    });
}

/** Addresses from a filled-in recipient list; parts that are not addresses are left out. */
export function emailAddresses(list: string): string[] {
    return [...new Set(list.split(',').map(part => part.trim()).filter(part => EMAIL.test(part) && part.length <= 254))];
}
