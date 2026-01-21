// @ts-nocheck
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { html, CossackElement, Component, State, PropertyValues } from '../src/index';

describe('Component System', () => {
    
    // Helper to wait for microtasks/animation frames
    const nextFrame = async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => setTimeout(resolve, 0));
    };

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('should render a basic component', async () => {
        @Component({ tag: 'test-basic' })
        // eslint-disable-next-line no-unused-vars
        class TestBasic extends CossackElement {
            render() {
                return html`<span>Hello Component</span>`;
            }
        }

        document.body.innerHTML = '<test-basic></test-basic>';
        await nextFrame();

        const el = document.querySelector('test-basic');
        expect(el?.innerHTML).toContain('<span>Hello Component</span>');
    });

    it('should update when state changes', async () => {
        @Component({ tag: 'test-counter' })
        class TestCounter extends CossackElement {
            @State() count = 0;
            render() {
                return html`<p>${this.count}</p>`;
            }
        }

        const el = document.createElement('test-counter') as unknown as TestCounter;
        document.body.appendChild(el);
        await nextFrame();

        expect(el.textContent).toContain('0');

        el.count++;
        await nextFrame();
        expect(el.textContent).toContain('1');
    });

    it('should capture and project slots (Light DOM composition)', async () => {
        @Component({ tag: 'test-slot' })
        // eslint-disable-next-line no-unused-vars
        class TestSlot extends CossackElement {
            render() {
                return html`
                    <div class="wrapper">
                        ${this.originalChildren}
                    </div>
                `;
            }
        }

        // Simulate browser parsing: Parent exists, children are inside BEFORE upgrade
        const container = document.createElement('div');
        container.innerHTML = `
            <test-slot>
                <h1>Original Content</h1>
            </test-slot>
        `;
        document.body.appendChild(container);
        
        // Wait for upgrade and render
        await nextFrame();

        const el = container.querySelector('test-slot');
        expect(el?.innerHTML).toContain('<div class="wrapper">');
        expect(el?.querySelector('.wrapper')?.innerHTML).toContain('<h1>Original Content</h1>');
    });

    it('should call updated() lifecycle hook', async () => {
        const spy = vi.fn();

        @Component({ tag: 'test-lifecycle' })
        class TestLifecycle extends CossackElement {
            @State() value = 'initial';
            
            render() { return html`${this.value}`; }

            updated(changedProps: PropertyValues) {
                spy(changedProps);
            }
        }

        const el = document.createElement('test-lifecycle') as unknown as TestLifecycle;
        document.body.appendChild(el);
        await nextFrame();

        // Clear initial call
        spy.mockClear();
        
        el.value = 'changed';
        await nextFrame();

        expect(spy).toHaveBeenCalled();
        const lastCallArgs = spy.mock.calls[spy.mock.calls.length - 1][0];
        expect(lastCallArgs.get('value')).toBe('initial');
    });

    it('should batch updates', async () => {
        let renderCount = 0;

        @Component({ tag: 'test-batch' })
        class TestBatch extends CossackElement {
            @State() a = 0;
            @State() b = 0;
            
            render() {
                renderCount++;
                return html`${this.a},${this.b}`;
            }
        }

        const el = document.createElement('test-batch') as unknown as TestBatch;
        document.body.appendChild(el);
        await nextFrame();
        renderCount = 0; // Reset after initial render

        el.a = 1;
        el.b = 2;
        el.a = 3;

        await nextFrame();
        
        expect(renderCount).toBe(1);
        expect(el.textContent).toContain('3,2');
    });
});
