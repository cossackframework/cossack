import { expect, it } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import { Popover } from '../src/components/Popover';

it('renders deterministic native target IDs and separates trigger and content attributes', () => {
    const template = () => component(Popover, {
        id: 'details', trigger: 'Details', disabled: true, 'aria-label': 'More details', 'data-trigger': 'yes',
        contentProps: { role: 'dialog', 'aria-labelledby': 'heading', 'data-panel': 'yes' },
    }, html`<h2 id="heading">Details</h2>`);
    const output = renderToString(template());
    expect(renderToString(template())).toBe(output);
    const button = output.match(/<button\b[^>]*>/)![0], panel = output.match(/<div\b[^>]*>/)![0];
    expect(button).toContain('id="details"');
    expect(button).toContain('popovertarget="details-content"');
    expect(button).toContain('disabled');
    expect(button).toContain('data-trigger="yes"');
    expect(button).not.toContain('data-panel');
    expect(panel).toContain('id="details-content"');
    expect(panel).toContain('popover="auto"');
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-labelledby="heading"');
    expect(panel).not.toContain('data-trigger');
    expect(output).not.toMatch(/\s(?:contentProps|trigger|side|align)=/);
});
it.each(['', 'two words', undefined])('rejects unstable IDs: %s', id => {
    const control = new Popover(); control.props = { id: id as string };
    expect(() => control.render()).toThrow('whitespace-free id');
});
it('rejects unsupported side and alignment values', () => {
    const control = new Popover();
    control.props = { id: 'details', side: 'invalid' as 'top' };
    expect(() => control.render()).toThrow('side must');
    control.props = { id: 'details', align: 'invalid' as 'start' };
    expect(() => control.render()).toThrow('align must');
});
it('keeps imperative operations safe before connection and after cleanup', () => {
    const control = new Popover(); control.props = { id: 'details' };
    control.show(); control.hide(); control.toggle(); control.onCleanup(); control.show();
    expect(control.popoverRef.value).toBeUndefined();
});
