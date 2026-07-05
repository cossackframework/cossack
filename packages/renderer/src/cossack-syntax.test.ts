import { describe, it, expect, vi } from 'vitest';
import { html, renderToString, render } from './cossack-html';

describe('Cossack Syntax Extensions', () => {
    
    // --- SSR Tests ---

    it('renders boolean attributes (SSR)', () => {
        const template = html`<div ?disabled=${true} ?hidden=${false}>Content</div>`;
        const output = renderToString(template).replace(/\s+/g, ' ').replace(' >', '>');
        expect(output).toBe('<div disabled>Content</div>');
    });

    it('renders property bindings as attributes if possible (SSR)', () => {
        const template = html`<input .value=${"test"}>`;
        const output = renderToString(template).replace(/\s+/g, ' ');
        expect(output).toBe('<input value="test">');
    });

    it('ignores events in SSR', () => {
        const template = html`<button @click=${() => {}}>Click</button>`;
        const output = renderToString(template).replace(/\s+/g, ' ');
        expect(output).toBe('<button>Click</button>');
    });

    // --- Client Tests ---

    it('binds properties (Client)', () => {
        const container = document.createElement('div');
        const template = html`<input .value=${"initial"}>`;
        render(template, container);
        
        let input = container.querySelector('input')!;
        expect(input.value).toBe('initial');
        
        // Update
        const template2 = html`<input .value=${"updated"}>`;
        render(template2, container);
        input = container.querySelector('input')!;
        expect(input.value).toBe('updated');
    });

    it('binds boolean attributes (Client)', () => {
        const container = document.createElement('div');
        const template = html`<button ?disabled=${true}></button>`;
        render(template, container);
        
        let btn = container.querySelector('button')!;
        expect(btn.hasAttribute('disabled')).toBe(true);
        
        const template2 = html`<button ?disabled=${false}></button>`;
        render(template2, container);
        btn = container.querySelector('button')!;
        expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('binds events using @ syntax (Client)', () => {
        const container = document.createElement('div');
        const spy = vi.fn();

        const template = html`<button @click=${spy}></button>`;
        render(template, container);

        const btn = container.querySelector('button')!;
        btn.click();
        expect(spy).toHaveBeenCalled();
    });

    it('stops firing when an event handler is removed (value becomes null/undefined)', () => {
        // Regression: a conditional `@click=${cond ? handler : null}` must
        // disable the handler when cond becomes false. Previously the stable
        // wrapper kept delegating to the stale stored handler.
        const container = document.createElement('div');
        const spy = vi.fn();
        const on = () => spy;
        const tpl = (handler: unknown) => html`<button @click=${handler}>x</button>`;

        render(tpl(on()), container);
        const btn = container.querySelector('button')!;
        btn.click();
        expect(spy).toHaveBeenCalledTimes(1);

        // Conditionally remove the handler.
        render(tpl(null), container);
        btn.click();
        expect(spy).toHaveBeenCalledTimes(1); // still 1, not 2

        // And a non-function non-null value (e.g. undefined from a missing prop)
        // must also disable, not throw or stringify into an attribute.
        render(tpl(undefined), container);
        btn.click();
        expect(spy).toHaveBeenCalledTimes(1);
        // Must not leak a bogus `@click` HTML attribute either.
        expect(btn.hasAttribute('@click')).toBe(false);
    });
});