import { describe, it, expect } from 'vitest';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';
import { html, renderToString } from './cossack-html';

describe('JSX-like Syntax <c:Component>', () => {
    class Child extends CossackElement {
        static properties = { name: { state: true } };
        declare name: string;
        render() {
            return html`<span>Hello ${this.name} ${this.children}</span>`;
        }
    }

    class Parent extends CossackElement {
        static components = { Child };
        
        render() {
            return html`
                <div>
                    <c:Child name="World"></c:Child>
                    <c:Child name=${"Universe"}>!</c:Child>
                </div>
            `;
        }
    }

    it('renders c:tag in SSR', () => {
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
        static components = { GrandChild };
        render() {
            return html`
                <section>
                    <c:GrandChild id="1"></c:GrandChild>
                    <div class="content">${this.children}</div>
                    <c:GrandChild id="2"></c:GrandChild>
                </section>
            `;
        }
    }

    class DeepParentValid extends CossackElement {
        static components = { DeepChild, GrandChild };
        render() {
            return html`
                <main>
                    <c:DeepChild>
                        <span>Projected</span>
                    </c:DeepChild>
                    <hr>
                    <c:DeepChild>
                        <c:GrandChild id="Slot"></c:GrandChild>
                    </c:DeepChild>
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
