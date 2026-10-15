import { afterAll, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { document: {} });
const { Tabs } = await import('../src/components/Tabs');
const { renderToString } = await import('@cossackframework/renderer');
afterAll(() => vi.unstubAllGlobals());
const items = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
function selected(tabs: InstanceType<typeof Tabs>, value: string) {
    expect(renderToString(tabs.render())).toMatch(new RegExp(`id="tabs-tab-${value}"[^>]*aria-selected="true"`));
}
it('proposes controlled selection without overriding the parent', () => {
    const tabs = new Tabs(), onValueChange = vi.fn();
    tabs.props = { id: 'tabs', label: 'Sections', value: 'a', items, onValueChange };
    (tabs as any).select('b');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('b');
    selected(tabs, 'a');
    tabs.props = { ...tabs.props, value: 'b' };
    selected(tabs, 'b');
    tabs.props = { ...tabs.props, value: 'a' };
    selected(tabs, 'a');
});
it('captures the uncontrolled default once and commits user selection', () => {
    const tabs = new Tabs(), onValueChange = vi.fn();
    tabs.props = { id: 'tabs', label: 'Sections', defaultValue: 'a', items, onValueChange };
    selected(tabs, 'a');
    tabs.props = { ...tabs.props, defaultValue: 'b' };
    selected(tabs, 'a');
    (tabs as any).select('b');
    selected(tabs, 'b');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('b');
});
