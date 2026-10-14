// @vitest-environment jsdom
// A controlled parent applies onChange in a later render. Two edits made before
// that render must build on each other, not on the stale value prop.
import { afterEach, expect, it, vi } from 'vitest';
import { render, type TemplateResult } from '@cossackframework/renderer';
import { Tabs, type TabsProps } from '../src/components/Tabs';
import { Combobox, type ComboboxProps } from '../src/components/Combobox';
import { DatePicker, type DatePickerProps } from '../src/components/DatePicker';
import { Calendar, type CalendarProps } from '../src/components/Calendar';
import { InputOTP, type InputOTPProps } from '../src/components/InputOTP';
import { Toggle } from '../src/components/Toggle';
import { AccordionItem } from '../src/components/Accordion';
import { Collapsible } from '../src/components/Collapsible';
import { Sidebar } from '../src/components/Sidebar';

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
    const onChange = vi.fn();
    const tabs = quiet(new Tabs());
    tabs.props = { id: 'tabs', label: 'Sections', value: 'a', onChange, items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } satisfies TabsProps;
    const select = (tabs as unknown as { select(value: string): void }).select.bind(tabs);
    select('b');
    select('a');
    expect(onChange.mock.calls).toEqual([['b'], ['a']]);
});

it('Combobox: picking another option and back emits both picks', () => {
    const onChange = vi.fn();
    const combobox = quiet(new Combobox());
    combobox.props = { id: 'fruit', value: 'a', onChange, options: [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }] } satisfies ComboboxProps;
    const internals = combobox as unknown as { input?: HTMLInputElement; select(value: string): void };
    internals.input = document.createElement('input');
    internals.select('b');
    internals.select('a');
    expect(onChange.mock.calls).toEqual([['b'], ['a']]);
});

it('DatePicker: entering then clearing a date emits the clear', () => {
    const onChange = vi.fn();
    const picker = quiet(new DatePicker());
    picker.props = { id: 'due', value: '', onChange } satisfies DatePickerProps;
    const input = document.createElement('input');
    const internals = picker as unknown as { input?: HTMLInputElement; commit(event: unknown): void };
    internals.input = input;
    input.value = '2024-02-01'; internals.commit(inputEvent(input));
    input.value = ''; internals.commit(inputEvent(input));
    expect(onChange.mock.calls).toEqual([['2024-02-01'], ['']]);
});

it('Calendar: picking another day and back emits both picks', () => {
    const onChange = vi.fn();
    const calendar = quiet(new Calendar());
    calendar.props = { id: 'calendar', value: '2024-02-01', today: '2024-02-01', onChange } satisfies CalendarProps;
    const select = (calendar as unknown as { select(iso: string, source: HTMLButtonElement): void }).select.bind(calendar);
    const button = document.createElement('button');
    select('2024-02-05', button);
    select('2024-02-01', button);
    expect(onChange.mock.calls).toEqual([['2024-02-05'], ['2024-02-01']]);
});

it('InputOTP: a digit then Backspace emits the empty code', () => {
    const onChange = vi.fn();
    const otp = quiet(new InputOTP());
    otp.props = { value: '', onChange } satisfies InputOTPProps;
    const input = document.createElement('input');
    const commit = (otp as unknown as { commit(event: unknown): void }).commit.bind(otp);
    input.value = '1'; commit(inputEvent(input));
    input.value = ''; commit(inputEvent(input));
    expect(onChange.mock.calls.map(call => call[0])).toEqual(['1', '']);
});

it('InputOTP: uncontrolled edits emit each change once', () => {
    const onChange = vi.fn();
    const otp = quiet(new InputOTP());
    otp.props = { onChange } satisfies InputOTPProps;
    const input = document.createElement('input');
    const commit = (otp as unknown as { commit(event: unknown): void }).commit.bind(otp);
    for (const value of ['1', '12', '12', '1']) { input.value = value; commit(inputEvent(input)); }
    expect(onChange.mock.calls.map(call => call[0])).toEqual(['1', '12', '1']);
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
    ['AccordionItem', () => { const item = new AccordionItem(); item.props = { id: 'faq', summary: 'FAQ', open: false }; return item; }],
    ['Collapsible', () => { const item = new Collapsible(); item.props = { id: 'more', trigger: 'More', open: false }; return item; }],
] as const)('%s: a double toggle proposes open then closed', (_name, create) => {
    const onToggle = vi.fn();
    const item = create();
    item.props = { ...item.props, onToggle };
    item.toggle();
    item.toggle();
    expect(onToggle.mock.calls).toEqual([[true], [false]]);
});

it('Sidebar: a double click on the toggle proposes collapsed then expanded', () => {
    const onToggle = vi.fn();
    const sidebar = new Sidebar();
    sidebar.props = { id: 'nav', label: 'Application', items: [], collapsed: false, onToggle };
    const button = mount(sidebar.render()).querySelector<HTMLButtonElement>('.cs-sidebar__toggle')!;
    button.click();
    button.click();
    expect(onToggle.mock.calls).toEqual([[true], [false]]);
});
