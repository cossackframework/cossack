// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { MultiSelect, type MultiSelectProps } from '../src/components/MultiSelect';

type Internals = { input?: HTMLInputElement; add(value: string): void; remove(value: string): Promise<void>; requestUpdate(): Promise<boolean> };

function controlled(props: Omit<MultiSelectProps, 'id'>) {
    const control = new MultiSelect();
    const internals = control as unknown as Internals;
    control.props = { id: 'roof', options: ['Metal', 'Tile', 'Unknown'], ...props };
    internals.input = document.createElement('input');
    vi.spyOn(internals, 'requestUpdate').mockResolvedValue(true);
    return { control, internals };
}

it('accumulates controlled edits made before the parent re-renders', async () => {
    const onValueChange = vi.fn();
    const { internals } = controlled({ value: [], onValueChange });
    internals.add('Metal');
    internals.add('Unknown');
    expect(onValueChange.mock.calls).toEqual([[['Metal']], [['Metal', 'Unknown']]]);
});

it('keeps a pick when a rendered tag is removed before the parent re-renders', async () => {
    const onValueChange = vi.fn();
    const { internals } = controlled({ value: ['Metal'], onValueChange });
    internals.add('Tile');
    await internals.remove('Metal');
    expect(onValueChange.mock.calls).toEqual([[['Metal', 'Tile']], [['Tile']]]);
});

it('builds on the parent value again once the parent re-renders', () => {
    const onValueChange = vi.fn();
    const { control, internals } = controlled({ value: ['Tile'], onValueChange });
    internals.add('Metal');
    // The parent rejects the edit and re-renders with its own value.
    control.props = { ...control.props, value: ['Tile'] };
    internals.add('Unknown');
    expect(onValueChange.mock.lastCall).toEqual([['Tile', 'Unknown']]);
});

it('re-emits a pending pick so a parent that ignored it can still accept it', () => {
    const onValueChange = vi.fn();
    const { internals } = controlled({ value: [], onValueChange });
    internals.add('Metal');
    internals.add('Metal');
    expect(onValueChange.mock.calls).toEqual([[['Metal']], [['Metal']]]);
});

it('applies max to edits that are not yet rendered', () => {
    const onValueChange = vi.fn();
    const { internals } = controlled({ value: [], max: 1, onValueChange });
    internals.add('Metal');
    internals.add('Tile');
    expect(onValueChange.mock.calls).toEqual([[['Metal']]]);
});

it('keeps locked values: no remove button, Backspace skips them, and every change keeps them', async () => {
    const onValueChange = vi.fn();
    const { control, internals } = controlled({ value: ['Metal', 'Tile'], lockedValues: ['Metal'], onValueChange });
    const { renderToString } = await import('@cossackframework/renderer');
    const output = renderToString(control.render());
    expect(output).not.toContain('aria-label="Remove Metal"');
    expect(output).toContain('aria-label="Remove Tile"');
    expect(output).toMatch(/<span data-locked[^>]*>\s*Metal\s*<\/span>/);
    await internals.remove('Metal');
    expect(onValueChange).not.toHaveBeenCalled();
    const keydown = (control as unknown as { keydown(event: KeyboardEvent): void }).keydown.bind(control);
    keydown(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }));
    await Promise.resolve();
    expect(onValueChange.mock.calls).toEqual([[['Metal']]]);
    // Only locked values are left: Backspace does nothing.
    control.props = { ...control.props, value: ['Metal'] };
    const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    keydown(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    internals.add('Unknown');
    expect(onValueChange.mock.lastCall).toEqual([['Metal', 'Unknown']]);
});
