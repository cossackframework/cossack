import { it, expect } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { SettingsPanel, type SettingsPanelProps } from '../src/blocks/SettingsPanel/index';
const sections = [{ id: 'account', title: 'Account', rows: [
    { key: 'email', type: 'switch' as const, label: 'Email alerts', hint: 'Receive updates' },
    { key: 'name', type: 'text' as const, label: 'Name' },
    { key: 'delete', type: 'button' as const, label: 'Dangerous operation', action: 'Delete' },
] }];
function instance(props: Record<string, unknown> = {}) {
    const panel = new SettingsPanel();
    panel.props = { id: 'settings', sections, onAction() {}, ...props } as SettingsPanelProps;
    return panel;
}
it('renders named native controls, descriptions and safe explicit actions on the server', () => {
    const out = renderToString(instance({ defaultValues: { email: true, name: 'Jane' }, class: 'custom', 'data-panel': 'account' }).render());
    expect(out).toContain('for="settings-field-name"');
    expect(out).toContain('aria-labelledby="settings-field-email-label"');
    expect(out).toContain('aria-describedby="settings-field-email-hint"');
    expect(out).toContain('value="Jane"'); expect(out.match(/<input[^>]*name="email"[^>]*>/)?.[0]).toMatch(/\schecked(?:=|\s|\/|>)/); expect(out).not.toContain('aria-checked');
    expect(out).toContain('name="email"'); expect(out).toContain('name="name"');
    expect(out).toContain('type="button"'); expect(out).not.toContain('cs-button--destructive');
    expect(out).toContain('data-panel="account"'); expect(out).toContain('custom');
});
it('captures local defaults once and uses controlled values directly', () => {
    const local = instance({ defaultValues: { name: 'Initial' } });
    expect(renderToString(local.render())).toContain('value="Initial"');
    local.props = { ...local.props, defaultValues: { name: 'Ignored' } } as SettingsPanelProps;
    expect(renderToString(local.render())).toContain('value="Initial"');
    const controlled = instance({ values: { name: 'First' }, onValuesChange() {} });
    controlled.render(); controlled.props = { ...controlled.props, values: { name: 'Next' } } as SettingsPanelProps;
    expect(renderToString(controlled.render())).toContain('value="Next"');
});
it('escapes labels and treats prototype-like keys as ordinary data', () => {
    const out = renderToString(instance({ sections: [{ id: 'x', title: '<Account>', rows: [{ key: '__proto__', type: 'text', label: '<Name>' }] }], defaultValues: JSON.parse('{"__proto__":"safe"}') }).render());
    expect(out).toContain('&lt;Account&gt;'); expect(out).toContain('&lt;Name&gt;'); expect(out).toContain('value="safe"');
});
it.each([
    { id: '' }, { id: 'two words' }, { sections: undefined }, { values: {} },
    { values: {}, defaultValues: {}, onValuesChange() {} }, { defaultValues: [] },
    { values: { email: 'yes' }, onValuesChange() {} }, { defaultValues: { name: false } },
    { onAction: undefined },
    { sections: [{ id: '', title: 'A', rows: [] }] },
    { sections: [{ id: 'x', title: 'A', rows: [] }, { id: 'x', title: 'B', rows: [] }] },
    { sections: [{ id: 'x', title: 'A', rows: [{ key: 'x', type: 'text', label: '' }] }] },
    { sections: [{ id: 'x', title: 'A', rows: [{ key: 'x', type: 'text', label: 'X' }, { key: 'x', type: 'switch', label: 'Again' }] }] },
    { sections: [{ id: 'x', title: 'A', rows: [{ key: 'x', type: 'button', label: 'X' }] }] },
    { sections: [{ id: 'x', title: 'A', rows: [{ key: 'x', type: 'button', label: 'X', action: 'Run', variant: 'automatic' }] }] },
])('rejects invalid ownership or row contracts %j', props => expect(() => instance(props).render()).toThrow('SettingsPanel'));
