import { describe, it, expect, vi } from 'vitest';
import { CossackElement } from './cossack-element';
import { html, render } from './cossack-html';
import type { ComponentResult } from './component';

/**
 * Verifies that child components are fully torn down (destroy() called) when
 * they are removed from the DOM via re-render. Previously only
 * disconnectedCallback() ran, leaking WebSockets / IntersectionObservers /
 * event listeners for the page's lifetime.
 */
function makeComponentResult(clazz: new () => CossackElement): ComponentResult {
    return { _type: 'COMPONENT', clazz, props: {}, children: undefined };
}

describe('component disposal calls destroy()', () => {
    it('recreates a same-class child when its rendering parent instance changes', () => {
        const destroySpy = vi.fn();
        class Child extends CossackElement {
            render() { return html`<p>child</p>`; }
            destroy() { destroySpy(); }
        }
        const firstParent = new CossackElement();
        const secondParent = new CossackElement();
        const container = document.createElement('div');
        const template = (result: ComponentResult) => html`${result}`;

        render(template({ ...makeComponentResult(Child), parent: firstParent }), container);
        render(template({ ...makeComponentResult(Child), parent: secondParent }), container);

        expect(destroySpy).toHaveBeenCalledTimes(1);
    });

    it('calls destroy() when a component part is replaced by a non-component value', () => {
        const destroySpy = vi.fn();
        const disconnectedSpy = vi.fn();

        class MockComponent extends CossackElement {
            render() {
                return html`<p>child</p>`;
            }
            disconnectedCallback() {
                disconnectedSpy();
            }
            destroy() {
                destroySpy();
            }
        }

        const container = document.createElement('div');
        document.body.appendChild(container);

        // First render: a raw ComponentResult makes the part own the component
        // directly (the updateComponent path), setting `componentInstance`.
        let value: unknown = makeComponentResult(MockComponent);
        render(html`${value}`, container);
        expect(disconnectedSpy).not.toHaveBeenCalled();

        // Re-render the SAME template (same strings) with a plain value: the
        // part's update() sees a non-component value and disposes the component.
        value = 'gone';
        render(html`${value}`, container);

        expect(disconnectedSpy).toHaveBeenCalledTimes(1);
        expect(destroySpy).toHaveBeenCalledTimes(1);

        container.remove();
    });

    it('does not throw when the component has no destroy() (plain CossackElement)', () => {
        class PlainComponent extends CossackElement {
            render() {
                return html`<p>plain</p>`;
            }
        }

        const container = document.createElement('div');
        document.body.appendChild(container);

        let value: unknown = makeComponentResult(PlainComponent);
        render(html`${value}`, container);

        // Should not throw even though PlainComponent has no destroy().
        expect(() => {
            value = 'gone';
            render(html`${value}`, container);
        }).not.toThrow();

        container.remove();
    });
});

describe('component connection ordering', () => {
    it('assigns direct props, props, and children before connectedCallback()', () => {
        const observed: Array<Record<string, unknown>> = [];

        class Child extends CossackElement {
            value = 'default';

            connectedCallback() {
                observed.push({
                    value: this.value,
                    propsValue: this.props.value,
                    children: this.children,
                });
                super.connectedCallback();
            }

            render() {
                return html`<p>${this.value}:${this.children}</p>`;
            }
        }

        const container = document.createElement('div');
        render(html`${{
            ...makeComponentResult(Child),
            props: { value: 'passed' },
            children: 'projected',
        }}`, container);

        expect(observed).toEqual([{
            value: 'passed',
            propsValue: 'passed',
            children: 'projected',
        }]);
    });
});
