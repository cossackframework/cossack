import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { Accordion } from '../src/components/Accordion';
import { Collapsible } from '../src/components/Collapsible';

it('owns accordion heading, trigger and panel identities', () => {
    const output = renderToString(component(Accordion, { id: 'section', summary: 'Details', headingLevel: 2, 'data-root': 'root', triggerProps: { 'data-trigger': 'trigger' }, panelProps: { 'data-panel': 'panel' } }, 'Content'));
    expect(output).toContain('role="heading" aria-level="2"');
    expect(output).toContain('id="section-trigger"');
    expect(output).toContain('aria-controls="section-panel"');
    expect(output).toContain('id="section-panel"');
    expect(output).toContain('data-root="root"');
    expect(output).toContain('data-trigger="trigger"');
    expect(output).toContain('data-panel="panel"');
});
it('renders a native collapsible button without an interactive wrapper', () => {
    const output = renderToString(component(Collapsible, { id: 'more', trigger: 'More', disabled: true }));
    expect(output).toMatch(/<button[^>]*id="more-trigger"[^>]*disabled/);
    expect(output).toContain('aria-controls="more-panel"');
    expect(output).toContain('aria-expanded="false"');
    expect(output).toContain('inert');
});
it('rejects unstable IDs, empty labels and invalid heading levels', () => {
    expect(() => renderToString(component(Accordion, { id: 'two words', summary: 'Details' }))).toThrow('id');
    expect(() => renderToString(component(Collapsible, { id: 'more', trigger: '' }))).toThrow('trigger text');
    expect(() => renderToString(component(Accordion, { id: 'section', summary: 'Details', headingLevel: 9 as 3 }))).toThrow('headingLevel');
});
