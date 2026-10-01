import { describe, expect, it, vi } from 'vitest';

// @Client methods need the browser environment flag at module initialization.
vi.stubGlobal('window', { document: {} });
const { AccordionItem } = await import('../src/components/Accordion');
const { Collapsible } = await import('../src/components/Collapsible');
const { renderToString } = await import('@cossackframework/renderer');

describe.each([AccordionItem, Collapsible])('%s state ownership', (Component) => {
    it('toggles default-open content before the first render', () => {
        const instance = new Component();
        const onToggle = vi.fn();
        instance.props = { defaultOpen: true, onToggle };
        instance.toggle();
        expect(onToggle).toHaveBeenCalledWith(false);
        expect(renderToString(instance.render())).toContain('height: 0; overflow: hidden');
        instance.toggle();
        expect(onToggle).toHaveBeenLastCalledWith(true);
        expect(renderToString(instance.render())).toContain('height: auto; overflow: visible');
    });

    it('leaves controlled state with the parent until props change', () => {
        const instance = new Component();
        const onToggle = vi.fn();
        instance.props = { open: false, defaultOpen: true, onToggle };
        instance.toggle();
        expect(onToggle).toHaveBeenCalledWith(true);
        expect(renderToString(instance.render())).toContain('height: 0; overflow: hidden');
        instance.props = { ...instance.props, open: true };
        expect(renderToString(instance.render())).toContain('height: auto; overflow: visible');
        instance.toggle();
        expect(onToggle).toHaveBeenLastCalledWith(false);
    });
});
