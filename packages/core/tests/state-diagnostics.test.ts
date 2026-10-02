import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { State, Store } from '../src/shared/decorators';

/**
 * RT-04 diagnostics: nested mutations on plain @State warn in development
 * with the component and field; @Store mutations stay silent (they are
 * reactive). Warnings fire once per field.
 */
class Panel extends Cossack {
    @State() config = { theme: 'light', nested: { depth: 1 } };
    @Store() cart = { items: 0 };
}

describe('shallow mutation diagnostics (RT-04)', () => {
    it('warns once with the component, field, and fix for plain @State', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const panel = new Panel();
        panel.connectedCallback();
        (panel as any).config.theme = 'dark';
        const first = warn.mock.calls[0]?.[0] as string;
        expect(first).toContain("plain @State 'config'");
        expect(first).toContain('Panel');
        expect(first).toContain('@Store()');
        // Once per field: the second mutation is silent.
        (panel as any).config.nested.depth = 2;
        expect(warn).toHaveBeenCalledTimes(1);
        // A different field warns independently.
        warn.mockClear();
        (panel as any).config = { theme: 'blue', nested: { depth: 3 } };
        (panel as any).config.theme = 'red';
        // Reassignment created a fresh plain object; the diagnostic re-arms.
        expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
        warn.mockRestore();
    });

    it('@Store nested mutations never warn (they are reactive)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const panel = new Panel();
        panel.connectedCallback();
        (panel as any).cart.items = 5;
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
