import { expect, it } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import type { Cossack } from '@cossackframework/core';
import { Modal } from '../src/components/Modal';
import { Sheet } from '../src/components/Sheet';
import { Drawer } from '../src/components/Drawer';

it.each([Modal, Sheet, Drawer])('keeps server dialogs closed and forwards native attributes to the dialog', Control => {
    const output = renderToString(component<Cossack & { props: import('../src/internal/dialog').DialogControlProps }>(Control, {
        id: 'example', open: true, defaultOpen: true, 'aria-label': 'Example',
        'aria-describedby': 'description', 'data-context': 'test', closeOnEscape: false,
    }, html`<p id="description">Details</p>`));
    const opening = output.match(/<dialog\b[^>]*>/)![0];
    expect(opening).toContain('id="example"');
    expect(opening).toContain('aria-label="Example"');
    expect(opening).toContain('aria-describedby="description"');
    expect(opening).toContain('data-context="test"');
    expect(opening).not.toMatch(/\sopen(?:\s|=|>)/);
    expect(output).not.toMatch(/defaultOpen=|closeOnEscape=/);
    expect(output).toContain('data-dialog-panel');
});
it('uses Drawer title as a fallback accessible name and supports vertical size', () => {
    const output = renderToString(component(Drawer, { title: 'Details', side: 'bottom', size: '420px', closeLabel: 'Dismiss' }));
    expect(output).toContain('aria-label="Details"');
    expect(output).toContain('height:420px');
    expect(output).toContain('aria-label="Dismiss"');
    const named = renderToString(component(Drawer, { title: 'Details', 'aria-labelledby': 'heading' }));
    expect(named.match(/<dialog\b[^>]*>/)![0]).not.toContain('aria-label=');
});
it.each([Sheet, Drawer])('rejects invalid panel placement', Control => {
    const control = new Control();
    control.props = { side: 'invalid' as 'left' };
    expect(() => control.render()).toThrow('side must be');
});
