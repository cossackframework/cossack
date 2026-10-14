// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { component, render } from '@cossackframework/renderer';
import { SettingsPanel, type SettingsValues } from '../src/blocks/SettingsPanel/index';

const sections = [{ id: 'account', title: 'Account', rows: [
    { key: 'email', type: 'switch' as const, label: 'Email alerts' },
    { key: 'name', type: 'text' as const, label: 'Name' },
] }];

afterEach(() => { document.body.replaceChildren(); });

async function mountControlled(values: SettingsValues, onValuesChange: (values: SettingsValues) => unknown) {
    const container = document.createElement('div');
    document.body.append(container);
    render(component(SettingsPanel, { id: 'settings', sections, values, onValuesChange }), container);
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
        name: container.querySelector<HTMLInputElement>('#settings-field-name')!,
        email: container.querySelector<HTMLInputElement>('#settings-field-email')!,
    };
}
function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

it('keeps a typed character while an async parent has not re-rendered', async () => {
    const onValuesChange = vi.fn();
    const { name } = await mountControlled({ email: false, name: 'Ja' }, onValuesChange);
    type(name, 'Jan');
    expect(name.value).toBe('Jan');
    await Promise.resolve();
    expect(name.value).toBe('Jan');
    expect(onValuesChange.mock.lastCall).toEqual([{ email: false, name: 'Jan' }]);
});

it('builds each controlled edit on the pending values', async () => {
    const onValuesChange = vi.fn();
    const { name, email } = await mountControlled({ email: false, name: 'Ja' }, onValuesChange);
    type(name, 'Jan');
    type(name, 'Jane');
    email.click();
    expect(onValuesChange.mock.calls).toEqual([
        [{ email: false, name: 'Jan' }],
        [{ email: false, name: 'Jane' }],
        [{ email: true, name: 'Jane' }],
    ]);
});

it('restores the parent values when onValuesChange throws', async () => {
    const { name } = await mountControlled({ email: false, name: 'Ja' }, () => { throw new Error('rejected'); });
    const errors: unknown[] = [];
    const report = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener('error', report);
    try { type(name, 'Jan'); } finally { window.removeEventListener('error', report); }
    expect(errors).toEqual([new Error('rejected')]);
    expect(name.value).toBe('Ja');
});
