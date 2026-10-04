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
