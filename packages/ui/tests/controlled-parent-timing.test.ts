// @vitest-environment jsdom
// Every controlled component against a parent that renders a proposal in a
// later task: it accepts one change, silently rejects the next by rendering
// its old value again, and then accepts the same change when the user repeats it.
import { afterEach, expect, it, vi } from 'vitest';
import { component, html, render, type TemplateResult } from '@cossackframework/renderer';
import { Toggle } from '../src/components/Toggle';
import { ToggleGroup } from '../src/components/ToggleGroup';
import { Tabs } from '../src/components/Tabs';
import { Accordion } from '../src/components/Accordion';
import { Collapsible } from '../src/components/Collapsible';
import { Sidebar } from '../src/components/Sidebar';
import { Combobox } from '../src/components/Combobox';
import { MultiSelect } from '../src/components/MultiSelect';
import { Calendar } from '../src/components/Calendar';
import { DatePicker } from '../src/components/DatePicker';
import { InputOTP } from '../src/components/InputOTP';
import { Resizable } from '../src/components/Resizable';
import { Pagination } from '../src/components/Pagination';
import { DataTable, type DataTableState } from '../src/components/DataTable';
import { Checkbox } from '../src/components/Checkbox';
import { Switch } from '../src/components/Switch';
import { RadioGroup } from '../src/components/RadioGroup';
import { PasswordInput } from '../src/components/PasswordInput';
import { Command } from '../src/components/Command';
import { AuthForm, type AuthFormMode } from '../src/blocks/AuthForm/index';
import { CommandPalette } from '../src/blocks/CommandPalette/index';
import { SettingsPanel, type SettingsValues } from '../src/blocks/SettingsPanel/index';

// jsdom has no layout observers; positioning is not under test here.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { document.body.replaceChildren(); });
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

type Edit = (root: HTMLElement) => void;
interface Case<V> {
    initial: V;
    draw(value: V, propose: (next: V) => void): TemplateResult;
    /** The value the component currently shows. */
    shown(root: HTMLElement): V;
    /** From `initial`; the parent accepts it. */
    first: [Edit, V];
    /** From the first value; the parent rejects it, then accepts the repeat. */
    second: [Edit, V];
}
const controlled = <V>(entry: Case<V>) => entry as Case<unknown>;

const click = (selector: string, text?: string): Edit => root => {
    const element = Array.from(root.querySelectorAll<HTMLElement>(selector)).find(item => text === undefined || item.textContent?.trim() === text);
    if (!element) throw new Error(`No ${selector} ${text ?? ''}`);
    element.click();
};
const type = (selector: string, value: string): Edit => root => {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
};
const key = (selector: string, name: string): Edit => root => {
    root.querySelector(selector)!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
};
const pressed = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')).map(button => button.dataset.value!);
const people = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }];
const table = { caption: 'People', rows: people, columns: [{ id: 'name', header: 'Name', key: 'name' as const }], getRowId: (row: { id: string }) => row.id, rowCount: 30 };
const settings = [{ id: 'account', title: 'Account', rows: [{ key: 'email', type: 'switch' as const, label: 'Email alerts' }] }];

const cases: Record<string, Case<unknown>> = {
    Toggle: controlled<boolean>({
        initial: false,
        draw: (pressed, propose) => html`${component(Toggle, { pressed, onPressedChange: propose, 'aria-label': 'Bold' })}`,
        shown: root => root.querySelector('button')!.getAttribute('aria-pressed') === 'true',
        first: [click('button'), true], second: [click('button'), false],
    }),
    'ToggleGroup single': controlled<string>({
        initial: 'left',
        draw: (value, propose) => html`${component(ToggleGroup, { label: 'Align', items: [{ value: 'left' }, { value: 'center' }, { value: 'right' }], value, onValueChange: propose })}`,
        shown: root => pressed(root)[0] ?? '',
        first: [click('button', 'center'), 'center'], second: [click('button', 'right'), 'right'],
    }),
    'ToggleGroup multiple': controlled<string[]>({
        initial: [],
        draw: (value, propose) => html`${component(ToggleGroup, { label: 'Format', type: 'multiple', items: [{ value: 'bold' }, { value: 'italic' }], value, onValueChange: propose })}`,
        shown: pressed,
        first: [click('button', 'bold'), ['bold']], second: [click('button', 'italic'), ['bold', 'italic']],
    }),
    Tabs: controlled<string>({
        initial: 'a',
        draw: (value, propose) => html`${component(Tabs, { id: 'tabs', label: 'Sections', value, onValueChange: propose,
            items: ['a', 'b', 'c'].map(item => ({ value: item, label: item.toUpperCase(), content: item })) })}`,
        shown: root => root.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!.dataset.value!,
        first: [click('[role="tab"]', 'B'), 'b'], second: [click('[role="tab"]', 'C'), 'c'],
    }),
    Accordion: controlled<boolean>({
        initial: false,
        draw: (open, propose) => html`${component(Accordion, { id: 'faq', summary: 'FAQ', open, onOpenChange: propose }, 'Answer')}`,
        shown: root => root.querySelector('button')!.getAttribute('aria-expanded') === 'true',
        first: [click('button'), true], second: [click('button'), false],
    }),
    Collapsible: controlled<boolean>({
        initial: false,
        draw: (open, propose) => html`${component(Collapsible, { id: 'more', trigger: 'More', open, onOpenChange: propose }, 'Details')}`,
        shown: root => root.querySelector('button')!.getAttribute('aria-expanded') === 'true',
        first: [click('button'), true], second: [click('button'), false],
    }),
    Sidebar: controlled<boolean>({
        initial: false,
        draw: (collapsed, propose) => html`${component(Sidebar, { id: 'nav', label: 'Application', items: [], collapsed, onCollapsedChange: propose })}`,
        shown: root => root.querySelector('aside')!.classList.contains('cs-sidebar--collapsed'),
        first: [click('.cs-sidebar__toggle'), true], second: [click('.cs-sidebar__toggle'), false],
    }),
    Combobox: controlled<string>({
        initial: 'apple',
        draw: (value, propose) => html`${component(Combobox, { id: 'fruit', 'aria-label': 'Fruit', name: 'fruit', value, onValueChange: propose,
            options: [{ value: 'apple', label: 'Apple' }, { value: 'banana', label: 'Banana' }, { value: 'cherry', label: 'Cherry' }] })}`,
        shown: root => root.querySelector<HTMLInputElement>('input[type="hidden"]')!.value,
        first: [click('[role="option"]', 'Banana'), 'banana'], second: [click('[role="option"]', 'Cherry'), 'cherry'],
    }),
    MultiSelect: controlled<string[]>({
        initial: [],
        draw: (value, propose) => html`${component(MultiSelect, { id: 'roof', 'aria-label': 'Roof', options: ['Metal', 'Tile', 'Slate'], value, onValueChange: propose })}`,
        shown: root => Array.from(root.querySelectorAll<HTMLElement>('[data-tag]')).map(tag => tag.dataset.tag!),
        first: [click('[role="option"]', 'Metal'), ['Metal']], second: [click('[role="option"]', 'Tile'), ['Metal', 'Tile']],
    }),
    Calendar: controlled<string>({
        initial: '2024-02-01',
        draw: (value, propose) => html`${component(Calendar, { id: 'calendar', today: '2024-02-01', value, onValueChange: propose })}`,
        shown: root => root.querySelector<HTMLButtonElement>('td[aria-selected="true"] button')!.dataset.date!,
        first: [click('button[data-date="2024-02-05"]'), '2024-02-05'], second: [click('button[data-date="2024-02-10"]'), '2024-02-10'],
    }),
    DatePicker: controlled<string>({
        initial: '',
        draw: (value, propose) => html`${component(DatePicker, { id: 'due', 'aria-label': 'Due date', value, onValueChange: propose })}`,
        shown: root => root.querySelector<HTMLInputElement>('input[type="date"]')!.value,
        first: [type('input[type="date"]', '2024-02-05'), '2024-02-05'], second: [type('input[type="date"]', '2024-02-10'), '2024-02-10'],
    }),
    InputOTP: controlled<string>({
        initial: '',
        draw: (value, propose) => html`${component(InputOTP, { length: 4, 'aria-label': 'Code', value, onValueChange: propose })}`,
        shown: root => root.querySelector('input')!.value,
        first: [type('input', '1'), '1'], second: [type('input', '12'), '12'],
    }),
    PasswordInput: controlled<string>({
        initial: '',
        draw: (value, propose) => html`${component(PasswordInput, { id: 'password', 'aria-label': 'Password', value, onValueChange: propose })}`,
        shown: root => root.querySelector('input')!.value,
        first: [type('input', 'a'), 'a'], second: [type('input', 'ab'), 'ab'],
    }),
    Resizable: controlled<number>({
        initial: 50,
        draw: (size, propose) => html`${component(Resizable, { id: 'split', label: 'Editor', primary: 'A', secondary: 'B', size, onSizeChange: propose })}`,
        shown: root => Number(root.querySelector('[role="separator"]')!.getAttribute('aria-valuenow')),
        first: [key('[role="separator"]', 'ArrowRight'), 51], second: [key('[role="separator"]', 'ArrowRight'), 52],
    }),
    Pagination: controlled<number>({
        initial: 2,
        draw: (page, propose) => html`${component(Pagination, { page, totalPages: 5, onPageChange: propose })}`,
        shown: root => Number(root.querySelector('[aria-current="page"]')!.textContent),
        first: [click('[aria-label="Next page"]'), 3], second: [click('[aria-label="Next page"]'), 4],
    }),
    'DataTable selection': controlled<Set<string>>({
        initial: new Set(),
        draw: (selection, propose) => html`${component(DataTable<{ id: string; name: string }>, { ...table, state: { page: 1, pageSize: 2, filter: '' }, onStateChange: () => {}, selection, onSelectionChange: propose })}`,
        shown: root => new Set(Array.from(root.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')).filter(input => input.checked).map(input => input.getAttribute('aria-label')!.slice('Select '.length))),
        first: [click('[aria-label="Select a"]'), new Set(['a'])], second: [click('[aria-label="Select b"]'), new Set(['a', 'b'])],
    }),
    'DataTable state': controlled<DataTableState>({
        initial: { page: 1, pageSize: 2, filter: '' },
        draw: (state, propose) => html`${component(DataTable<{ id: string; name: string }>, { ...table, state, onStateChange: propose })}`,
        shown: root => ({
            page: Number(/Page (\d+) of/.exec(root.textContent ?? '')![1]),
            pageSize: Number(root.querySelector('select')!.value),
            filter: root.querySelector<HTMLInputElement>('input[type="search"]')!.value,
        }),
        first: [click('button', 'Next page'), { page: 2, pageSize: 2, filter: '' }], second: [click('button', 'Next page'), { page: 3, pageSize: 2, filter: '' }],
    }),
    AuthForm: controlled<AuthFormMode>({
        initial: 'login',
        draw: (mode, propose) => html`${component(AuthForm, { id: 'account', mode, onModeChange: propose, onSubmit: () => {} })}`,
        shown: root => root.querySelector('input[name="name"]') ? 'signup' : 'login',
        first: [click('button', 'Create an account instead'), 'signup'], second: [click('button', 'Sign in instead'), 'login'],
    }),
    SettingsPanel: controlled<SettingsValues>({
        initial: { email: false },
        draw: (values, propose) => html`${component(SettingsPanel, { id: 'settings', sections: settings, values, onValuesChange: propose })}`,
        shown: root => ({ email: root.querySelector<HTMLInputElement>('#settings-field-email')!.checked }),
        first: [click('#settings-field-email'), { email: true }], second: [click('#settings-field-email'), { email: false }],
    }),
    Checkbox: controlled<boolean>({
        initial: false,
        draw: (checked, propose) => html`${component(Checkbox, { checked, 'aria-label': 'Accept', '@change': event => propose(event.currentTarget.checked) })}`,
        shown: root => root.querySelector('input')!.checked,
        first: [click('input'), true], second: [click('input'), false],
    }),
    Switch: controlled<boolean>({
        initial: false,
        draw: (checked, propose) => html`${component(Switch, { checked, 'aria-label': 'Alerts', '@change': event => propose(event.currentTarget.checked) })}`,
        shown: root => root.querySelector('input')!.checked,
        first: [click('input'), true], second: [click('input'), false],
    }),
    RadioGroup: controlled<string>({
        initial: 'free',
        draw: (value, propose) => html`${component(RadioGroup, { name: 'plan', 'aria-label': 'Plan', items: [{ value: 'free' }, { value: 'pro' }, { value: 'team' }], value, onValueChange: propose })}`,
        shown: root => root.querySelector<HTMLInputElement>('input:checked')!.value,
        first: [click('input[value="pro"]'), 'pro'], second: [click('input[value="team"]'), 'team'],
    }),
};

it.each(Object.entries(cases))('%s: accepts, silently rejects, then re-accepts a change from a parent that renders later', async (_name, entry) => {
    const container = document.createElement('div');
    document.body.append(container);
    let value = entry.initial, accept = true;
    const proposals: unknown[] = [];
    const draw = () => render(entry.draw(value, propose), container);
    // Callbacks may pass an event after the value. The parent renders in a later task.
    function propose(next: unknown) {
        proposals.push(next);
        setTimeout(() => { if (accept) value = next; draw(); }, 0);
    }
    draw();
    await settle();
    expect(entry.shown(container)).toEqual(entry.initial);

    const [firstEdit, first] = entry.first, [secondEdit, second] = entry.second;
    firstEdit(container);
    await settle();
    expect(proposals).toEqual([first]);
    expect(entry.shown(container)).toEqual(first);

    accept = false;
    secondEdit(container);
    await settle();
    expect(proposals).toEqual([first, second]);
    expect(entry.shown(container)).toEqual(first);

    accept = true;
    secondEdit(container);
    await settle();
    expect(proposals).toEqual([first, second, second]);
    expect(entry.shown(container)).toEqual(second);
});

// Command and CommandPalette own native modal dialogs, which jsdom lacks. Their
// parent renders by assigning a new props object; Chromium tests cover the dialog.
it.each([
    ['Command', () => { const command = new Command(); command.props = { id: 'search', label: 'Search' }; return command; }],
    ['CommandPalette', () => { const palette = new CommandPalette(); palette.props = { id: 'commands', label: 'Commands', commands: [], onSelect: () => {} }; return palette; }],
] as const)('%s: accepts, silently rejects, then re-accepts an open change', (_name, create) => {
    const instance = create();
    vi.spyOn(instance as unknown as { requestUpdate(): Promise<boolean> }, 'requestUpdate').mockResolvedValue(true);
    const proposals: boolean[] = [];
    const onOpenChange = (next: boolean) => { proposals.push(next); };
    const parentRenders = (open: boolean) => { instance.props = { ...instance.props, open, onOpenChange }; };
    parentRenders(false);

    instance.setOpen(true);
    parentRenders(true);
    expect(instance.isOpen).toBe(true);

    instance.setOpen(false);
    parentRenders(true); // Rejects by rendering its old value.
    expect(instance.isOpen).toBe(true);

    instance.setOpen(false);
    parentRenders(false);
    expect(proposals).toEqual([true, false, false]);
    expect(instance.isOpen).toBe(false);
});

it('PasswordInput: the reveal toggle keeps native edits that the parent has not rendered', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    render(html`${component(PasswordInput, { id: 'password', 'aria-label': 'Password', value: 'initial', onValueChange: () => {} })}`, container);
    await settle();
    const input = container.querySelector('input')!;
    input.value = 'typed';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('button[aria-label="Show password"]')!.click();
    await settle();
    expect(input.type).toBe('text');
    expect(input.value).toBe('typed');
});
