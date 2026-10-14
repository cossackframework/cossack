// @vitest-environment jsdom
// A controlled parent applies a proposed value in a later render. Two edits made before
// that render must build on each other, not on the stale value prop.
import { afterEach, expect, it, vi } from 'vitest';
import { component, html, render, type TemplateResult } from '@cossackframework/renderer';
import { Tabs, type TabsProps } from '../src/components/Tabs';
import { Combobox, type ComboboxProps } from '../src/components/Combobox';
import { DatePicker, type DatePickerProps } from '../src/components/DatePicker';
import { Calendar, type CalendarProps } from '../src/components/Calendar';
import { InputOTP, type InputOTPProps } from '../src/components/InputOTP';
import { Toggle } from '../src/components/Toggle';
import { Accordion } from '../src/components/Accordion';
import { Collapsible } from '../src/components/Collapsible';
import { Sidebar } from '../src/components/Sidebar';
import { Resizable } from '../src/components/Resizable';
import { Command } from '../src/components/Command';
import { CommandPalette } from '../src/blocks/CommandPalette/index';
import { AuthForm } from '../src/blocks/AuthForm/index';
import { DataTable, type DataTableProps } from '../src/components/DataTable';
import { Pagination } from '../src/components/Pagination';

afterEach(() => { document.body.replaceChildren(); });

function quiet<T extends object>(control: T): T {
    vi.spyOn(control as unknown as { requestUpdate(): Promise<boolean> }, 'requestUpdate').mockResolvedValue(true);
    return control;
}
function mount(template: TemplateResult) {
    const container = document.createElement('div');
    document.body.append(container);
    render(template, container);
    return container;
}
const inputEvent = (input: HTMLInputElement) => ({ currentTarget: input }) as never;

it('Tabs: ArrowRight then ArrowLeft with automatic activation selects the focused tab', () => {
    const onValueChange = vi.fn();
    const tabs = quiet(new Tabs());
    tabs.props = { id: 'tabs', label: 'Sections', value: 'a', onValueChange, items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } satisfies TabsProps;
    const select = (tabs as unknown as { select(value: string): void }).select.bind(tabs);
    select('b');
    select('a');
    expect(onValueChange.mock.calls).toEqual([['b'], ['a']]);
});

it('Combobox: picking another option and back emits both picks', () => {
    const onValueChange = vi.fn();
    const combobox = quiet(new Combobox());
    combobox.props = { id: 'fruit', value: 'a', onValueChange, options: [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }] } satisfies ComboboxProps;
    const internals = combobox as unknown as { input?: HTMLInputElement; select(value: string): void };
    internals.input = document.createElement('input');
    internals.select('b');
    internals.select('a');
    expect(onValueChange.mock.calls).toEqual([['b'], ['a']]);
});

it('DatePicker: entering then clearing a date emits the clear', () => {
    const onValueChange = vi.fn();
    const picker = quiet(new DatePicker());
    picker.props = { id: 'due', value: '', onValueChange } satisfies DatePickerProps;
    const input = document.createElement('input');
    const internals = picker as unknown as { input?: HTMLInputElement; commit(event: unknown): void };
    internals.input = input;
    input.value = '2024-02-01'; internals.commit(inputEvent(input));
    input.value = ''; internals.commit(inputEvent(input));
    expect(onValueChange.mock.calls).toEqual([['2024-02-01'], ['']]);
});

it('Calendar: picking another day and back emits both picks', () => {
    const onValueChange = vi.fn();
    const calendar = quiet(new Calendar());
    calendar.props = { id: 'calendar', value: '2024-02-01', today: '2024-02-01', onValueChange } satisfies CalendarProps;
    const select = (calendar as unknown as { select(iso: string, source: HTMLButtonElement): void }).select.bind(calendar);
    const button = document.createElement('button');
    select('2024-02-05', button);
    select('2024-02-01', button);
    expect(onValueChange.mock.calls).toEqual([['2024-02-05'], ['2024-02-01']]);
});

it('InputOTP: a digit then Backspace emits the empty code', () => {
    const onValueChange = vi.fn();
    const otp = quiet(new InputOTP());
    otp.props = { value: '', onValueChange } satisfies InputOTPProps;
    const input = document.createElement('input');
    const commit = (otp as unknown as { commit(event: unknown): void }).commit.bind(otp);
    input.value = '1'; commit(inputEvent(input));
    input.value = ''; commit(inputEvent(input));
    expect(onValueChange.mock.calls.map(call => call[0])).toEqual(['1', '']);
});

it('InputOTP: uncontrolled edits emit each change once', () => {
    const onValueChange = vi.fn();
    const otp = quiet(new InputOTP());
    otp.props = { onValueChange } satisfies InputOTPProps;
    const input = document.createElement('input');
    const commit = (otp as unknown as { commit(event: unknown): void }).commit.bind(otp);
    for (const value of ['1', '12', '12', '1']) { input.value = value; commit(inputEvent(input)); }
    expect(onValueChange.mock.calls.map(call => call[0])).toEqual(['1', '12', '1']);
});

it('Toggle: a double click proposes pressed then unpressed', () => {
    const onPressedChange = vi.fn();
    const toggle = new Toggle();
    toggle.props = { pressed: false, onPressedChange, 'aria-label': 'Bold' };
    const button = mount(toggle.render()).querySelector('button')!;
    button.click();
    button.click();
    expect(onPressedChange.mock.calls).toEqual([[true], [false]]);
});

it.each([
    ['Accordion', () => { const item = new Accordion(); item.props = { id: 'faq', summary: 'FAQ', open: false }; return item; }],
    ['Collapsible', () => { const item = new Collapsible(); item.props = { id: 'more', trigger: 'More', open: false }; return item; }],
] as const)('%s: a double toggle proposes open then closed', (_name, create) => {
    const onOpenChange = vi.fn();
    const item = create();
    item.props = { ...item.props, onOpenChange };
    item.toggle();
    item.toggle();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
});

it('Sidebar: a double click on the toggle proposes collapsed then expanded', () => {
    const onCollapsedChange = vi.fn();
    const sidebar = new Sidebar();
    sidebar.props = { id: 'nav', label: 'Application', items: [], collapsed: false, onCollapsedChange };
    const button = mount(sidebar.render()).querySelector<HTMLButtonElement>('.cs-sidebar__toggle')!;
    button.click();
    button.click();
    expect(onCollapsedChange.mock.calls).toEqual([[true], [false]]);
});

// Components that compared edits with the stale prop instead of using the shared helper.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('Resizable: arrow keys before the parent renders build on the pending size', async () => {
    const onSizeChange = vi.fn();
    const container = mount(html`${component(Resizable, { id: 'split', label: 'Editor', primary: 'A', secondary: 'B', size: 50, onSizeChange })}`);
    await settle();
    const handle = container.querySelector<HTMLDivElement>('.cs-resizable__handle')!;
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft']) handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    expect(onSizeChange.mock.calls).toEqual([[51], [52], [51], [50]]);
});

it('Command: opening then closing before the parent renders proposes both states', () => {
    const onOpenChange = vi.fn();
    const command = quiet(new Command());
    command.props = { id: 'search', label: 'Search', open: false, onOpenChange };
    command.setOpen(true);
    command.setOpen(false);
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
});

it('CommandPalette: a double toggle proposes open then closed', () => {
    const onOpenChange = vi.fn();
    const palette = quiet(new CommandPalette());
    palette.props = { id: 'commands', label: 'Commands', commands: [], onSelect: () => {}, open: false, onOpenChange };
    palette.toggle();
    palette.toggle();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
});

it('AuthForm: a double mode switch proposes signup then login', async () => {
    const onModeChange = vi.fn();
    const container = mount(html`${component(AuthForm, { id: 'account', mode: 'login', onModeChange, onSubmit: () => {} })}`);
    await settle();
    const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Create an account instead'))!;
    button.click();
    button.click();
    expect(onModeChange.mock.calls).toEqual([['signup'], ['login']]);
});

type Person = { id: string; name: string };
async function table(props: Partial<DataTableProps<Person>>) {
    const container = mount(html`${component(DataTable<Person>, {
        caption: 'People', rows: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
        columns: [{ id: 'name', header: 'Name', key: 'name', sortable: true }], getRowId: row => row.id,
        rowCount: 30, state: { page: 1, pageSize: 2, filter: '' }, onStateChange: () => {}, ...props,
    })}`);
    await settle();
    return container;
}

it('DataTable: two row checks before the parent renders keep both rows', async () => {
    const onSelectionChange = vi.fn();
    const container = await table({ selection: new Set(), onSelectionChange });
    const [, alice, bob] = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    alice.click();
    bob.click();
    expect(onSelectionChange.mock.calls).toEqual([[new Set(['a'])], [new Set(['a', 'b'])]]);
});

it('DataTable: query edits before the parent renders build on the pending state', async () => {
    const onStateChange = vi.fn();
    const container = await table({ onStateChange });
    const filter = container.querySelector<HTMLInputElement>('input[type=search]')!;
    filter.value = 'al';
    filter.dispatchEvent(new InputEvent('input', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('th button')!.click();
    const next = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Next page')!;
    next.click();
    next.click();
    const sort = { columnId: 'name', direction: 'asc' };
    expect(onStateChange.mock.calls.map(call => call[0])).toEqual([
        { page: 1, pageSize: 2, filter: 'al' },
        { page: 1, pageSize: 2, filter: 'al', sort },
        { page: 2, pageSize: 2, filter: 'al', sort },
        { page: 3, pageSize: 2, filter: 'al', sort },
    ]);
});

it('Pagination: Next then Previous before the parent renders build on the pending page', async () => {
    const onPageChange = vi.fn();
    const container = mount(html`${component(Pagination, { page: 3, totalPages: 5, onPageChange })}`);
    await settle();
    const next = container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!;
    const previous = container.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!;
    next.click();
    next.click();
    previous.click();
    previous.click();
    expect(onPageChange.mock.calls).toEqual([[4], [5], [4], [3]]);
});
