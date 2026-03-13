import { describe, it, expect } from 'vitest';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';
import { html, renderToString, component } from './cossack-html';

describe('component() function', () => {
    class Child extends CossackElement {
        static properties = { name: { state: true } };
        declare name: string;
        render() {
            return html`<span>Hello ${this.name} ${this.children}</span>`;
        }
    }

    class Parent extends CossackElement {
        render() {
            return html`
                <div>
                    ${component(Child, { name: "World" })}
                    ${component(Child, { name: "Universe" }, '!')}
                </div>
            `;
        }
    }

    it('renders component() in SSR', () => {
        const parent = new Parent();
        pushCurrentInstance(parent);
        const output = renderToString(parent.render()!);
        popCurrentInstance();

        const normalized = output.replace(/\s+/g, ' ').trim();
        expect(normalized).toContain('<span>Hello World </span>');
        expect(normalized).toContain('<span>Hello Universe !</span>');
    });

    // --- Deep Nesting Test ---

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
                    ${component(GrandChild, { id: "1" })}
                    <div class="content">${this.children}</div>
                    ${component(GrandChild, { id: "2" })}
                </section>
            `;
        }
    }

    class DeepParentValid extends CossackElement {
        render() {
            return html`
                <main>
                    ${component(DeepChild, {}, html`<span>Projected</span>`)}
                    <hr>
                    ${component(DeepChild, {}, component(GrandChild, { id: "Slot" }))}
                </main>
            `;
        }
    }

    it('renders deep hierarchy with siblings and projection', () => {
        const root = new DeepParentValid();
        pushCurrentInstance(root);
        const output = renderToString(root.render()!);
        popCurrentInstance();

        const normalized = output.replace(/\s+/g, '');

        expect(normalized).toContain('<section><b>GC-1</b><divclass="content"><span>Projected</span></div><b>GC-2</b></section>');
        expect(normalized).toContain('<section><b>GC-1</b><divclass="content"><b>GC-Slot</b></div><b>GC-2</b></section>');
    });
});
