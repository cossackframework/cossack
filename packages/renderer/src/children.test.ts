import { describe, it, expect } from 'vitest';
import { html, renderToString, component } from './cossack-html';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';

describe('Children Projection', () => {
    class Wrapper extends CossackElement {
        render() {
            return html`<div class="wrapper">${this.children}</div>`;
        }
    }

    it('renders children in SSR', () => {
        // Usage: component(Wrapper, props, children)
        const template = html`
            ${component(Wrapper, {}, html`<span>I am a child</span>`)}
        `;
        
        expect(renderToString(template).trim()).toBe(
            '<div class="wrapper"><span>I am a child</span></div>'
        );
    });

    it('renders multiple children (array)', () => {
        const children = [html`<i>1</i>`, html`<i>2</i>`];
        const template = html`
            ${component(Wrapper, {}, children)}
        `;
        expect(renderToString(template).trim()).toBe(
            '<div class="wrapper"><i>1</i><i>2</i></div>'
        );
    });

    // --- Deep Nesting with component() ---

    class GrandChild extends CossackElement {
        static properties = { id: { state: true } };
        declare id: string;
        render() {
            return html`<b>GC-${this.id}</b>`;
        }
    }

    class DeepChild extends CossackElement {
        render() {
            return html`
                <section>
                    ${component(GrandChild, {id: "1"})}
                    <div class="content">${this.children}</div>
                    ${component(GrandChild, {id: "2"})}
                </section>
            `;
        }
    }

    class DeepParent extends CossackElement {
        render() {
            return html`
                <main>
                    ${component(DeepChild, {}, html`
                        ${component(GrandChild, {id: "Slot"})}
                    `)}
                </main>
            `;
        }
    }

    it('renders deep hierarchy with component() helper', () => {
        const root = new DeepParent();
        pushCurrentInstance(root);
        const output = renderToString(root.render()!);
        popCurrentInstance();
        
        const normalized = output.replace(/\s+/g, '');
        
        expect(normalized).toContain('<section><b>GC-1</b><divclass="content"><b>GC-Slot</b></div><b>GC-2</b></section>');
    });
});
