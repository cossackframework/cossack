// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { component, render } from '@cossackframework/renderer';
import { SettingsPanel, type SettingsValues } from '../src/blocks/SettingsPanel/index';

const sections = [{ id: 'account', title: 'Account', rows: [
    { key: 'email', type: 'switch' as const, label: 'Email alerts' },
    { key: 'name', type: 'text' as const, label: 'Name' },
] }];

afterEach(() => { document.body.replaceChildren(); });

async function mountControlled(values: SettingsValues, onChange: (values: SettingsValues) => unknown) {
    const container = document.createElement('div');
    document.body.append(container);
    render(component(SettingsPanel, { id: 'settings', sections, values, onChange }), container);
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
    const onChange = vi.fn();
    const { name } = await mountControlled({ email: false, name: 'Ja' }, onChange);
    type(name, 'Jan');
    expect(name.value).toBe('Jan');
    await Promise.resolve();
    expect(name.value).toBe('Jan');
    expect(onChange.mock.lastCall).toEqual([{ email: false, name: 'Jan' }]);
});

it('builds each controlled edit on the pending values', async () => {
    const onChange = vi.fn();
    const { name, email } = await mountControlled({ email: false, name: 'Ja' }, onChange);
    type(name, 'Jan');
    type(name, 'Jane');
    email.click();
    expect(onChange.mock.calls).toEqual([
        [{ email: false, name: 'Jan' }],
        [{ email: false, name: 'Jane' }],
        [{ email: true, name: 'Jane' }],
    ]);
});

it('restores the parent values when onChange throws', async () => {
    const { name } = await mountControlled({ email: false, name: 'Ja' }, () => { throw new Error('rejected'); });
    const errors: unknown[] = [];
    const report = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener('error', report);
    try { type(name, 'Jan'); } finally { window.removeEventListener('error', report); }
    expect(errors).toEqual([new Error('rejected')]);
    expect(name.value).toBe('Ja');
});
