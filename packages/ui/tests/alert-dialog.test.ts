import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { AlertDialog } from '../src/components/AlertDialog';

it('renders a closed, named alert dialog with a linked description and native attributes', () => {
    const output = renderToString(component(AlertDialog, { id: 'delete', title: 'Delete row?', description: 'Cannot undo.', open: true, 'data-test': 'confirmation', actionDisabled: true }));
    const dialog = output.match(/<dialog\b[^>]*>/)![0];
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('aria-labelledby="delete-title"');
    expect(dialog).toContain('aria-describedby="delete-description"');
    expect(dialog).toContain('data-test="confirmation"');
    expect(dialog).not.toMatch(/\sopen(?:=|>|\s)/);
    expect(output).toContain('id="delete-title"');
    expect(output).toContain('id="delete-description"');
    expect(output).toMatch(/<button[^>]*autofocus/);
    expect(output).toMatch(/<button[^>]*disabled/);
    expect(output).not.toContain('actionDisabled=');
});
it('omits an empty description relationship', () => {
    expect(renderToString(component(AlertDialog, { id: 'alert', title: 'Confirm', description: '' }))).not.toContain('aria-describedby');
});
it.each([{ id: 'bad id' }, { title: '' }, { cancelLabel: ' ' }, { actionLabel: '' }])('rejects invalid identity or labels: %j', patch => {
    expect(() => renderToString(component(AlertDialog, { id: 'alert', title: 'Confirm', ...patch }))).toThrow('AlertDialog requires');
});
