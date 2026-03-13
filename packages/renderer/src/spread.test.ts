import { describe, it, expect } from 'vitest';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';
import { html, renderToString, render, component } from './cossack-html';

describe('Spread Syntax ...=${vars}', () => {
    
    // --- SSR Tests ---

    it('spreads attributes on standard element (SSR)', () => {
        const attrs = { id: 'test', class: 'foo', disabled: true };
        const template = html`<div ...=${attrs}>Content</div>`;
        expect(renderToString(template).replace(/\s+/g, ' ')).toBe('<div id="test" class="foo" disabled>Content</div>');
    });

    it('spreads attributes on component (SSR)', () => {
        class SpreadComp extends CossackElement {
            static properties = {
                id: { reflect: true },
                title: { reflect: true }
            };
            declare id: string;
            declare title: string;

            render() {
                return html`<span>${this.id} - ${this.title}</span>`;
            }
        }

        class Parent extends CossackElement {
            render() {
                const props = { id: '123', title: 'Hello' };
                return html`${component(SpreadComp, props)}`;
            }
        }

        const root = new Parent();
        pushCurrentInstance(root);
        const output = renderToString(root.render()!);
        popCurrentInstance();

        expect(output).toContain('<span>123 - Hello</span>');
    });

    // --- Client Tests (Simulated) ---

    it('spreads attributes on standard element (Client)', () => {
        const container = document.createElement('div');
        const attrs = { id: 'client', 'data-val': '1' };
        
        const template = html`<div ...=${attrs}></div>`;
        render(template, container);
        
        const div = container.firstElementChild as HTMLElement;
        expect(div.getAttribute('id')).toBe('client');
        expect(div.getAttribute('data-val')).toBe('1');
        
        // Update
        const newAttrs = { id: 'client-updated' }; // data-val removed
        const template2 = html`<div ...=${newAttrs}></div>`;
        render(template2, container);
        
        const divUpdated = container.firstElementChild as HTMLElement;
        expect(divUpdated.getAttribute('id')).toBe('client-updated');
        expect(divUpdated.hasAttribute('data-val')).toBe(false);
    });
});