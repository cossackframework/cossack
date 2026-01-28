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
});