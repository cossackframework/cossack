import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { Command } from '../src/components/Command';

it('renders a closed named dialog and linked search results for hydration', () => {
    const output = renderToString(component(Command, { id: 'commands', label: 'Navigate', open: true, 'data-test': 'palette', items: [{ id: '/home', label: 'Home' }, { id: 'disabled', label: 'Unavailable', disabled: true }] }));
    const dialog = output.match(/<dialog\b[^>]*>/)![0];
    expect(dialog).toContain('aria-label="Navigate"');
    expect(dialog).toContain('data-test="palette"');
    expect(dialog).not.toMatch(/\sopen(?:=|>|\s)/);
    expect(output).toContain('role="combobox"');
    expect(output).toContain('aria-controls="commands-list"');
    expect(output).toContain('aria-activedescendant="commands-option-%2Fhome"');
    expect(output).toContain('role="listbox"');
    expect(output).toContain('aria-disabled="true"');
});
it('does not create a dangling active result for empty or disabled results', () => {
    for (const items of [[], [{ id: 'one', label: 'One', disabled: true }]]) {
        expect(renderToString(component(Command, { id: 'commands', label: 'Navigate', items }))).not.toContain('aria-activedescendant=');
    }
});
it.each([{ id: 'two words' }, { label: '' }, { searchLabel: '' }, { items: [{ id: 'a', label: 'A' }, { id: 'a', label: 'Again' }] }])('rejects invalid command contracts: %j', props => {
    expect(() => renderToString(component(Command, { id: 'commands', label: 'Navigate', ...props }))).toThrow('Command');
});

it('uses grouped visual order for filtering and keeps application data unchanged', () => {
    const items = [{ id: 'one', label: 'One', group: 'A' }, { id: 'two', label: 'Two', group: 'B' }, { id: 'three', label: 'Three', group: 'A' }] as const;
    const command = new Command();
    command.props = { id: 'commands', label: 'Commands', items, grouped: true };
    expect(command.getFiltered().map(item => item.id)).toEqual(['one', 'three', 'two']);
    expect(items.map(item => item.id)).toEqual(['one', 'two', 'three']);
    (command as unknown as { searchText: string }).searchText = '  TWO  ';
    expect(command.getFiltered().map(item => item.id)).toEqual(['two']);
});
it('keeps rich option names and descriptions separate from decorative content', () => {
    const out = renderToString(component(Command, { id: 'commands', label: 'Commands', grouped: true,
        items: [{id:'one',label:'One',group:'Actions',description:'Alt+1'}], renderItem:()=> 'Decorative' }));
    expect(out).toContain('role="group" aria-label="Actions"');
    expect(out).toContain('role="option" aria-label="One" aria-description="Alt+1"');
    expect(out).toContain('Decorative');
});

it('treats blank group labels as ungrouped content rather than unnamed ARIA groups', () => {
    const out = renderToString(component(Command, { id: 'commands', label: 'Commands', grouped: true,
        items: [{id:'one',label:'One',group:'   '}] }));
    expect(out).not.toContain('role="group"');
    expect(out).toContain('role="option" aria-label="One"');
});
