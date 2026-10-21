/**
 * The conditional logic control: show or hide a form's block, or send a notification, only
 * when the form's values match rules, as Gravity Forms' conditional logic. Client-safe.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Checkbox, Input, NativeSelect } from '@cossackframework/ui';
import { CONDITION_LIMIT, inputName, type BlockCondition, type ConditionOperator, type ConditionRule } from '@cossackframework/cms';
import type { BlockOption, EditorBlock } from './editor';

/** An input a rule can test. */
export interface ConditionField { name: string; label: string }

const OPERATORS: readonly { value: ConditionOperator; label: string }[] = [
    { value: 'is', label: 'is' }, { value: 'isNot', label: 'is not' }, { value: 'contains', label: 'contains' },
    { value: 'empty', label: 'is empty' }, { value: 'notEmpty', label: 'is not empty' },
    { value: 'gt', label: 'is greater than' }, { value: 'lt', label: 'is less than' }, { value: 'in', label: 'is one of' },
];
const NO_VALUE = new Set<ConditionOperator>(['empty', 'notEmpty']);

/** The inputs of an editor's form tree, in order, named as the server will name them. */
export function conditionFields(blocks: readonly EditorBlock[], options: readonly BlockOption[], except?: string): ConditionField[] {
    const inputs = new Set(options.filter(option => option.input).map(option => option.name));
    const fields: ConditionField[] = [];
    const walk = (list: readonly EditorBlock[]) => {
        for (const block of list) {
            if (inputs.has(block.type) && block.id !== except) {
                const label = typeof block.data.label === 'string' ? block.data.label : '';
                const name = typeof block.data.name === 'string' && block.data.name.trim() ? block.data.name.trim() : inputName(label);
                if (!fields.some(field => field.name === name)) fields.push({ name, label: label || name });
            }
            if (block.children) walk(block.children);
        }
    };
    walk(blocks);
    return fields;
}

/**
 * Edit a condition. `subject` names what it applies to, such as "this block"; `change`
 * receives undefined when conditional logic is turned off.
 */
export function conditionControl(when: BlockCondition | undefined, fields: readonly ConditionField[], idPrefix: string, change: (when: BlockCondition | undefined) => void,
    labels: { readonly toggle: string; readonly subject: string; readonly show?: string; readonly hide?: string } = { toggle: 'Conditional logic', subject: 'this block' }): TemplateResult {
    const id = `${idPrefix}-when`;
    const blank = (): ConditionRule => ({ field: fields[0]?.name ?? '', op: 'is', value: '' });
    const toggle = html`<label for=${id} class="flex items-center gap-2 text-xs font-medium text-foreground">
        ${component(Checkbox, { id, checked: Boolean(when), disabled: !fields.length && !when, '@change': (event: Event) => change((event.target as HTMLInputElement).checked ? { rules: [blank()] } : undefined) })}
        ${labels.toggle}</label>`;
    if (!when) return html`<div class="space-y-1">${toggle}${fields.length ? null : html`<p class="text-xs text-muted-foreground">${__('Add a field to the form to show or hide this on its value.')}</p>`}</div>`;
    const set = (next: Partial<BlockCondition>) => change({ ...when, ...next });
    const setRule = (index: number, next: Partial<ConditionRule>) => set({ rules: when.rules.map((rule, at) => at === index ? { ...rule, ...next } : rule) });
    const select = (name: string, label: string, value: string, choices: readonly { value: string; label: string }[], pick: (value: string) => void) =>
        component(NativeSelect, { id: name, size: 'sm', 'aria-label': label, '@change': (event: Event) => pick((event.target as HTMLSelectElement).value) },
            html`${choices.map(choice => html`<option value=${choice.value} ?selected=${choice.value === value}>${choice.label}</option>`)}`);
    const known = fields.map(field => ({ value: field.name, label: field.label }));
    return html`<div class="space-y-2 rounded-md border border-border p-3">
        ${toggle}
        <div class="flex flex-wrap items-center gap-2 text-xs text-foreground">
            ${select(`${id}-action`, __('Show or hide'), when.action ?? 'show', [{ value: 'show', label: labels.show ?? __('Show') }, { value: 'hide', label: labels.hide ?? __('Hide') }], value => set({ action: value === 'hide' ? 'hide' : 'show' }))}
            <span>${labels.subject} ${__('if')}</span>
            ${select(`${id}-match`, __('Which rules'), when.match ?? 'all', [{ value: 'all', label: __('all') }, { value: 'any', label: __('any') }], value => set({ match: value === 'any' ? 'any' : 'all' }))}
            <span>${__('of these match:')}</span>
        </div>
        <ul class="space-y-2">${when.rules.map((rule, index) => html`<li class="flex flex-wrap items-center gap-2" data-rule=${index}>
            ${select(`${id}-${index}-field`, __('Field'), rule.field, known.some(choice => choice.value === rule.field) ? known : [...known, { value: rule.field, label: rule.field || __('Choose a field') }], value => setRule(index, { field: value }))}
            ${select(`${id}-${index}-op`, __('Comparison'), rule.op, OPERATORS.map(entry => ({ value: entry.value, label: __(entry.label) })), value => setRule(index, { op: value as ConditionOperator }))}
            ${NO_VALUE.has(rule.op) ? null : component(Input, { id: `${id}-${index}-value`, size: 'sm', class: 'w-40', 'aria-label': __('Value'), placeholder: rule.op === 'in' ? __('a, b, c') : '', '.value': rule.value ?? '',
                '@input': (event: Event) => setRule(index, { value: (event.target as HTMLInputElement).value }) })}
            ${when.rules.length > 1 ? component(Button, { type: 'button', size: 'sm', variant: 'ghost', 'aria-label': `${__('Remove rule')} ${index + 1}`, '@click': () => set({ rules: when.rules.filter((_, at) => at !== index) }) }, '×') : null}
        </li>`)}</ul>
        ${when.rules.length < CONDITION_LIMIT ? component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => set({ rules: [...when.rules, blank()] }) }, __('Add rule')) : null}
    </div>`;
}

/** A condition as saved: rules without a field are dropped, values trimmed; undefined when none is left. */
export function conditionInput(when: BlockCondition | undefined): BlockCondition | undefined {
    const rules = (when?.rules ?? []).filter(rule => rule.field).map(rule => ({ field: rule.field, op: rule.op, ...(NO_VALUE.has(rule.op) ? {} : { value: (rule.value ?? '').trim() }) }));
    if (!when || !rules.length) return undefined;
    return { ...(when.action === 'hide' ? { action: 'hide' as const } : {}), ...(when.match === 'any' ? { match: 'any' as const } : {}), rules };
}
