import { expect, it } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import { Tooltip } from '../src/components/Tooltip';
import { HoverCard } from '../src/components/HoverCard';

it('renders a stable tooltip description without relabeling its trigger wrapper', () => {
    const template = () => component(Tooltip, { id: 'save-description', label: 'Save changes', 'data-wrapper': 'yes' }, html`<button aria-describedby="save-description">Save</button>`);
    const output = renderToString(template());
    expect(renderToString(template())).toBe(output);
    expect(output).toContain('id="save-description" role="tooltip" popover="manual"');
    expect(output).toContain('aria-describedby="save-description"');
    expect(output).not.toContain('aria-label=');
    expect(output).toContain('data-wrapper="yes"');
});
it('renders a named nonmodal card with no additional wrapper tab stop', () => {
    const output = renderToString(component(HoverCard, { id: 'details', label: 'Account details', content: html`<a href="/account">Account</a>`, contentProps: { 'data-panel': 'yes' } }, html`<button>Details</button>`));
    expect(output).toContain('role="dialog" aria-label="Account details" popover="manual"');
    expect(output).not.toContain('tabindex=');
    expect(output).not.toContain('popovertarget=');
    expect(output).toContain('data-panel="yes"');
});
it.each([-1, NaN, Infinity, 0.5, 60001])('rejects invalid delay %s', delay => {
    const tooltip = new Tooltip();tooltip.props = { id: 'tip', label: 'Help', delay };
    expect(() => tooltip.render()).toThrow('delay');
});
it('validates IDs, plain descriptions and sides', () => {
    expect(() => renderToString(component(Tooltip, { id: 'two words', label: 'Help' }))).toThrow('id');
    expect(() => renderToString(component(Tooltip, { id: 'tip', label: '' }))).toThrow('label');
    expect(() => renderToString(component(HoverCard, { id: 'card', label: 'Card', content: '', side: 'bad' as 'top' }))).toThrow('side');
});
