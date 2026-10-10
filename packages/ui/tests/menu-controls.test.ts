import { it, expect } from 'vitest';
import { component, html, renderToString } from '@cossackframework/renderer';
import { DropdownMenu } from '../src/components/DropdownMenu';
import { ContextMenu } from '../src/components/ContextMenu';

it('renders deterministic named menu semantics with focusable disabled actions', () => {
    const render = () => renderToString(component(DropdownMenu, { id: 'actions', trigger: 'Actions', 'data-trigger': 'yes',
        items: [{ label: 'Edit' }, { separator: true }, { label: 'Delete', disabled: true }], menuProps: { 'data-panel': 'yes' } }));
    const output = render();
    expect(render()).toBe(output);
    expect(output).toContain('popovertarget="actions-menu"');
    expect(output).toContain('aria-haspopup="menu"');
    expect(output).toContain('aria-expanded="false"');
    expect(output).toContain('role="menu"');
    expect(output).toContain('aria-labelledby="actions"');
    expect(output.match(/role="menuitem"/g)).toHaveLength(2);
    expect(output).toContain('role="separator"');
    expect(output).toContain('aria-disabled="true"');
    expect(output).not.toMatch(/\sdisabled(?:\s|>|=)/);
});
it('names the context menu independently of its keyboard-focusable context region', () => {
    const output = renderToString(component(ContextMenu, { id: 'region', menuLabel: 'Document actions', 'aria-label': 'Document',
        items: [{ label: 'Copy' }] }, html`<p>Document content</p>`));
    expect(output).toContain('id="region" tabindex="0"');
    expect(output).toContain('aria-label="Document actions"');
    expect(output).toContain('aria-label="Document"');
    expect(output).toContain('popover="manual"');
    expect(output).toContain('Document content');
});
it('validates required menu identities, labels and placement', () => {
    expect(() => renderToString(component(DropdownMenu, { id: '', items: [] }))).toThrow('whitespace-free id');
    expect(() => renderToString(component(ContextMenu, { id: 'context', menuLabel: '' }))).toThrow('menuLabel');
    expect(() => renderToString(component(DropdownMenu, { id: 'actions', items: [{ label: '' }] }))).toThrow('labels');
    expect(() => renderToString(component(DropdownMenu, { id: 'actions', side: 'invalid' as 'top' }))).toThrow('side');
});
it('supports native panel name overrides and safe pre-mount methods', () => {
    const output = renderToString(component(DropdownMenu, { id: 'actions', menuProps: { 'aria-label': 'Custom' } }));
    expect(output).toContain('aria-label="Custom"');expect(output).not.toContain('aria-labelledby=');
    const dropdown = new DropdownMenu();dropdown.props = { id: 'actions' };dropdown.showMenu();dropdown.closeMenu();dropdown.onCleanup();
    const context = new ContextMenu();context.props = { id: 'context', menuLabel: 'Actions' };context.hide();context.onCleanup();
});
