// @vitest-environment jsdom
// A controlled parent rejects a check change by re-rendering its own value.
// That value equals the last committed one, so the binding must compare with
// the live DOM state (live()) or the DOM stays toggled.
import { afterEach, expect, it, vi } from 'vitest';
import { component, html, render, type TemplateResult } from '@cossackframework/renderer';
import { Checkbox } from '../src/components/Checkbox';
import { Switch } from '../src/components/Switch';
import { RadioGroup } from '../src/components/RadioGroup';
import { DataTable } from '../src/components/DataTable';

afterEach(() => { document.body.replaceChildren(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function mount(draw: () => TemplateResult) {
    const container = document.createElement('div');
    document.body.append(container);
    render(draw(), container);
    await tick();
    return { container, redraw: async () => { render(draw(), container); await tick(); } };
}

it.each([
    ['Checkbox', () => html`${component(Checkbox, { checked: false, 'aria-label': 'Accept' })}`],
    ['Switch', () => html`${component(Switch, { checked: false, 'aria-label': 'Alerts' })}`],
] as const)('%s: a parent can reject a check change', async (_name, draw) => {
    const { container, redraw } = await mount(draw);
    const input = container.querySelector<HTMLInputElement>('input')!;
    input.click();
    expect(input.checked).toBe(true);
    await redraw();
    expect(input.checked).toBe(false);
});

it('Checkbox: an uncontrolled check survives a parent re-render', async () => {
    const { container, redraw } = await mount(() => html`${component(Checkbox, { 'aria-label': 'Accept' })}`);
    const input = container.querySelector<HTMLInputElement>('input')!;
    input.click();
    await redraw();
    expect(input.checked).toBe(true);
});

it('Switch: the native checkbox carries no stale aria-checked', async () => {
    const { container } = await mount(() => html`${component(Switch, { 'aria-label': 'Alerts' })}`);
    const input = container.querySelector<HTMLInputElement>('input')!;
    expect(input.hasAttribute('aria-checked')).toBe(false);
});

it('RadioGroup: a parent can reject a selection', async () => {
    const items = [{ value: 'free' }, { value: 'pro' }];
    const { container, redraw } = await mount(() => html`${component(RadioGroup, { name: 'plan', value: 'free', items })}`);
    const [free, pro] = container.querySelectorAll<HTMLInputElement>('input');
    pro.click();
    expect(pro.checked).toBe(true);
    await redraw();
    expect(free.checked).toBe(true);
    expect(pro.checked).toBe(false);
});

it('RadioGroup: an uncontrolled selection survives a parent re-render', async () => {
    const items = [{ value: 'free' }, { value: 'pro' }];
    const { container, redraw } = await mount(() => html`${component(RadioGroup, { name: 'plan', items })}`);
    const pro = container.querySelectorAll<HTMLInputElement>('input')[1];
    pro.click();
    await redraw();
    expect(pro.checked).toBe(true);
});

it('DataTable: a parent can reject row and page selection changes', async () => {
    type Row = { id: string; name: string };
    const selection = new Set<string>();
    const onSelectionChange = vi.fn();
    const { container, redraw } = await mount(() => html`${component(DataTable<Row>, {
        caption: 'People', rows: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
        columns: [{ id: 'name', header: 'Name', key: 'name' }], getRowId: row => row.id,
        rowCount: 2, state: { page: 1, pageSize: 2, filter: '' }, onStateChange: () => {},
        selection, onSelectionChange,
    })}`);
    const [all, row] = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    row.click();
    all.click();
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    await redraw();
    expect(row.checked).toBe(false);
    expect(all.checked).toBe(false);
});
