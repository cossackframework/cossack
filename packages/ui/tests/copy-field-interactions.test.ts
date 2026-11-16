import { expect, it, vi } from 'vitest';

// Load the component as browser code so its @Client method keeps its body.
Object.defineProperty(globalThis, 'window', { value: { document: {} }, configurable: true });
const { CopyField } = await import('../src/components/CopyField');

it('copies through the clipboard, and selects the text when the browser refuses', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
        const onCopy = vi.fn();
        const field = new CopyField() as unknown as { props: unknown; copy(): Promise<void>; copied: string; field: { value: unknown } };
        field.props = { label: 'Key', value: 'secret', onCopy };
        await field.copy();
        expect(writeText).toHaveBeenCalledWith('secret');
        expect(onCopy).toHaveBeenCalledWith('secret');
        expect(field.copied).toBe('yes');
        expect((field as unknown as { announced: string }).announced).toBe('Copied.');
        // A second copy repeats the message with a no-break space, so VoiceOver announces it again.
        await field.copy();
        expect((field as unknown as { announced: string }).announced).toBe('Copied.\u00A0');
        vi.advanceTimersByTime(2000);
        expect(field.copied).toBe('');

        writeText.mockRejectedValueOnce(new Error('denied'));
        const input = { focus: vi.fn(), select: vi.fn() };
        field.field.value = input;
        await field.copy();
        expect(field.copied).toBe('no');
        expect(input.select).toHaveBeenCalled();
        // A failure stays; a success clears itself.
        vi.advanceTimersByTime(3000);
        expect(field.copied).toBe('no');
        expect(onCopy).toHaveBeenCalledTimes(2);
        expect((field as unknown as { announced: string }).announced).toBe('Copy it from the box.');
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});
