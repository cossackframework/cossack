import { expect, it } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import { Toggle } from '../src/components/Toggle';
import { ToggleGroup } from '../src/components/ToggleGroup';

it('consumes toggle state props and captures its uncontrolled default once', () => {
    const toggle = new Toggle();
    toggle.props = { defaultPressed: true, id: 'bold', onPressedChange: () => {} };
    const first = renderToString(toggle.render());
    expect(first).toContain('aria-pressed="true"');
    expect(first).not.toMatch(/\s(?:pressed|defaultPressed|onPressedChange)=/);
    toggle.props = { ...toggle.props, defaultPressed: false };
    expect(renderToString(toggle.render())).toContain('aria-pressed="true"');
    toggle.props = { ...toggle.props, pressed: false };
    expect(renderToString(toggle.render())).toContain('aria-pressed="false"');
});
it('renders controlled group selection during SSR and retains disabled selected values', () => {
    const output = renderToString(component(ToggleGroup, { label: 'Format', type: 'multiple', value: Object.freeze(['bold']), items: [{ value: 'bold', label: 'Bold', disabled: true }, { value: 'italic', label: 'Italic' }], 'data-test': 'group' }));
    expect(output).toContain('role="group" aria-label="Format"');
    expect(output).toContain('data-test="group"');
    expect(output).toContain('aria-pressed="true"');
    expect(output).toContain('aria-pressed="false"');
    expect(output).toContain('disabled');
});
it('captures group defaults once and accepts rich labels with explicit names', () => {
    const group = new ToggleGroup();
    group.props = { label: 'Format', defaultValue: 'bold', items: [{ value: 'bold', label: html`<b>B</b>`, ariaLabel: 'Bold' }] };
    expect(renderToString(group.render())).toContain('aria-pressed="true"');
    group.props = { ...group.props, defaultValue: '' };
    expect(renderToString(group.render())).toContain('aria-pressed="true"');
});
it.each([{ label: '' }, { type: 'single', value: ['bold'] }, { type: 'multiple', value: 'bold' }, { type: 'multiple', value: ['bold','bold'] }, { items: [{value:'x'},{value:'x'}] }, { items: [{value:'rich',label:{}}] }])('rejects invalid toggle group contracts: %j', patch => {
    expect(() => renderToString(component(ToggleGroup, { label: 'Format', ...patch } as any))).toThrow('ToggleGroup');
});

it('captures group defaults on the first render even before items arrive', () => {
    const group = new ToggleGroup();
    group.props = { label: 'Format', defaultValue: 'bold', items: [] };
    renderToString(group.render());
    group.props = { label: 'Format', defaultValue: 'italic', items: [{ value: 'bold' }, { value: 'italic' }] };
    const output = renderToString(group.render());
    expect(group.isSelected('bold')).toBe(true);
    expect(group.isSelected('italic')).toBe(false);
    expect(output).toContain('aria-pressed="true"');
});
