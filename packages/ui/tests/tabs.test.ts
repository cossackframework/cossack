import { expect, it } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import { Tabs } from '../src/components/Tabs';

const items = [{ value: 'a/b #?', label: 'First', content: 'First content' }, { value: 'disabled', label: 'Unavailable', disabled: true }, { value: 'last', label: 'Last' }];
it('scopes tab/panel IDs and names the list while keeping inactive panels mounted', () => {
    const output = renderToString(html`${component(Tabs, { id: 'one', label: 'First set', items })}${component(Tabs, { id: 'two', label: 'Second set', items })}`);
    const ids = [...output.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(output).toContain('aria-controls="one-panel-a%2Fb%20%23%3F"');
    expect(output).toContain('aria-labelledby="two-tab-a%2Fb%20%23%3F"');
    expect(output).toContain('aria-label="First set"');
    expect(output).toContain('aria-label="Second set"');
    expect(output).toContain('disabled');
    expect(output.match(/role="tabpanel"/g)).toHaveLength(6);
});
it('falls back to the first enabled tab for invalid controlled selections and clears all-disabled selection', () => {
    const output = renderToString(component(Tabs, { id: 'tabs', label: 'Sections', value: 'disabled', items }));
    expect(output).toMatch(/id="tabs-tab-a%2Fb%20%23%3F"[^>]*aria-selected="true"/);
    const empty = renderToString(component(Tabs, { id: 'tabs', label: 'Sections', items: [{ value: 'none', label: 'None', disabled: true }] }));
    expect(empty).not.toContain('aria-selected="true"');
});
it('supports rich labels with an explicit accessible name', () => {
    const output = renderToString(component(Tabs, { id: 'tabs', label: 'Sections', items: [{ value: 'rich', label: html`<b>Rich</b>`, ariaLabel: 'Rich section' }] }));
    expect(output).toContain('aria-label="Rich section"');
});
it.each([{ id: 'bad id' }, { label: '' }, { items: [{ value: 'x', label: 'X' }, { value: 'x', label: 'Again' }] }, { items: [{ value: 'rich', label: {} }] }])('rejects invalid tabs contracts: %j', patch => {
    expect(() => renderToString(component(Tabs, { id: 'tabs', label: 'Sections', ...patch } as any))).toThrow('Tabs');
});
