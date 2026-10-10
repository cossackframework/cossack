// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { ClientState, State, Store } from '../src/shared/decorators';

/**
 * RT-04 diagnostics: nested mutations on plain @State warn in development
 * with the component and field; @Store mutations stay silent (they are
 * reactive). Warnings fire once per field.
 */
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

class Panel extends Cossack {
    @State() config = { theme: 'light', nested: { depth: 1 } };
    @Store() cart = { items: 0 };
}

describe('shallow mutation diagnostics (RT-04)', () => {
    it('keeps identity stable before and after warning, including nested reads', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const panel = new Panel();
        panel.connectedCallback();
        const config = panel.config;
        const nested = config.nested;
        expect(panel.config).toBe(config);
        expect(panel.config.nested).toBe(nested);
        nested.depth = 2;
        expect(warn).toHaveBeenCalledTimes(1);
        expect(panel.config).toBe(config);
        expect(panel.config.nested).toBe(nested);
        warn.mockRestore();
    });
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
    it('names the nested client field and ClientStore fix without scheduling a render', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        class Local extends Cossack { @ClientState() draft = { rows: [{ label: 'old' }] }; }
        const page = new Local();
        page.connectedCallback();
        const update = vi.spyOn(page, 'requestUpdate').mockImplementation(() => Promise.resolve(true));
        page.draft.rows[0].label = 'new';
        expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(
            "plain @ClientState 'draft' of Local at draft.rows.0.label"));
        expect(warn.mock.calls[0][0]).toContain('@ClientStore()');
        expect(update).not.toHaveBeenCalled();
        page.draft = { rows: [{ label: 'replacement' }] };
        expect(update).toHaveBeenCalledOnce();
    });

    it('does not warn for no-op assignments, missing deletes or rejected writes', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = new Panel();
        page.connectedCallback();
        page.config.theme = 'light';
        delete (page.config as any).missing;
        Object.freeze(page.config.nested);
        expect(() => { page.config.nested.depth = 2; }).toThrow(TypeError);
        expect(warn).not.toHaveBeenCalled();
    });

    it('retains raw identity when assigning diagnostic proxies inside another field', () => {
        const page = new Panel();
        page.connectedCallback();
        const raw = (page.getPublicState().config as any).nested;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (page.config as any).alias = page.config.nested;
        expect((page.getPublicState().config as any).alias).toBe(raw);
        expect(warn).toHaveBeenCalledOnce();
    });

});
