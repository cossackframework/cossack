import { expect, it } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { AlertDialog } from '../src/components/AlertDialog';

it('renders a closed, named alert dialog with a linked description and native attributes', () => {
    const output = renderToString(component(AlertDialog, { id: 'delete', title: 'Delete row?', description: 'Cannot undo.', open: true, 'data-test': 'confirmation', actionDisabled: true }));
    const dialog = output.match(/<dialog\b[^>]*>/)![0];
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).not.toContain('aria-modal'); // showModal() supplies modal semantics.
    expect(dialog).not.toContain('closedby'); // Backdrop clicks never dismiss; Esc is the modal default.
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
it('keeps Esc from closing through closedby="none" when closeOnEscape is false', () => {
    const output = renderToString(component(AlertDialog, { id: 'alert', title: 'Confirm', closeOnEscape: false }));
    expect(output.match(/<dialog\b[^>]*>/)![0]).toContain('closedby="none"');
});
it('omits an empty description relationship', () => {
    expect(renderToString(component(AlertDialog, { id: 'alert', title: 'Confirm', description: '' }))).not.toContain('aria-describedby');
});
it.each([{ id: 'bad id' }, { title: '' }, { cancelLabel: ' ' }, { actionLabel: '' }])('rejects invalid identity or labels: %j', patch => {
    expect(() => renderToString(component(AlertDialog, { id: 'alert', title: 'Confirm', ...patch }))).toThrow('AlertDialog requires');
});
