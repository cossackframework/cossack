import { expect, it } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
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
    // Disabled: plain hidden, so find-in-page cannot open what the trigger cannot.
    expect(output).toMatch(/id="more-panel"[^>]*hidden(="")?>/);
    expect(output).not.toContain('inert');
});
it.each([
    ['Accordion', () => component(Accordion, { id: 'panel', summary: 'Details' }, 'Findable')],
    ['Collapsible', () => component(Collapsible, { id: 'panel', trigger: 'Details' }, 'Findable')],
])('%s keeps closed content findable with until-found', (_name, render) => {
    const output = renderToString(render());
    expect(output).toMatch(/id="panel-panel"[^>]*hidden="until-found"/);
    expect(output).toContain('Findable');
    expect(output).not.toContain('inert');
    expect(output).not.toMatch(/id="panel-panel"[^>]*aria-hidden/);
});
it.each([
    ['Accordion', () => component(Accordion, { id: 'lead', summary: html`<img src="/a.png" alt=""> <span>Ada</span> <span class="badge">3</span>` }, 'Body')],
    ['Collapsible', () => component(Collapsible, { id: 'lead', trigger: html`<img src="/a.png" alt=""> <span>Ada</span> <span class="badge">3</span>` }, 'Body')],
])('%s puts a template header inside its own trigger button', (_name, render) => {
    const output = renderToString(render());
    expect(output).toMatch(/<button[^>]*id="lead-trigger"[^>]*>[\s\S]*<img src="\/a.png" alt="">[\s\S]*<span>Ada<\/span>[\s\S]*<span class="badge">3<\/span>[\s\S]*<\/button>/);
    expect(output).toContain('aria-expanded="false"');
    expect(output).toContain('aria-controls="lead-panel"');
});
it('rejects unstable IDs, empty labels and invalid heading levels', () => {
    expect(() => renderToString(component(Accordion, { id: 'two words', summary: 'Details' }))).toThrow('id');
    expect(() => renderToString(component(Collapsible, { id: 'more', trigger: '' }))).toThrow('trigger text');
    expect(() => renderToString(component(Accordion, { id: 'section', summary: 'Details', headingLevel: 9 as 3 }))).toThrow('headingLevel');
});
