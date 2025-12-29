// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { html } from '../src/index';
import { render } from '../src/lib/client/render';

describe('Renderer', () => {
    describe('Ref', () => {
        it('should call the function ref with the element', () => {
            const container = document.createElement('div');
            const refSpy = vi.fn();
            
            const template = html`<div ref=${refSpy}></div>`;
            render(template, container);

            expect(refSpy).toHaveBeenCalledTimes(1);
            expect(refSpy).toHaveBeenCalledWith(expect.any(HTMLElement));
            expect(refSpy.mock.calls[0][0].tagName).toBe('DIV');
        });

        it('should set the value property of a RefObject', () => {
            const container = document.createElement('div');
            const refObject = { value: undefined };
            
            const template = html`<input ref=${refObject} />`;
            render(template, container);

            expect(refObject.value).toBeDefined();
            expect(refObject.value).toBeInstanceOf(HTMLInputElement);
        });
    });

    describe('Multi-Interpolation', () => {
        it('should handle multiple values in a single attribute', () => {
            const container = document.createElement('div');
            const color = 'red';
            const bg = 'blue';
            
            const template = html`<div style="color: ${color}; background-color: ${bg};"></div>`;
            render(template, container);

            const div = container.querySelector('div');
            expect(div).not.toBeNull();
            expect(div!.getAttribute('style')).toBe('color: red; background-color: blue;');
        });

        it('should update multi-interpolated attributes correctly', () => {
            const container = document.createElement('div');
            
            const renderTemplate = (color: string, bg: string) => {
                const template = html`<div style="color: ${color}; background-color: ${bg};"></div>`;
                render(template, container);
            };

            renderTemplate('red', 'blue');
            let div = container.querySelector('div');
            expect(div!.getAttribute('style')).toBe('color: red; background-color: blue;');

            renderTemplate('green', 'yellow');
            div = container.querySelector('div');
            expect(div!.getAttribute('style')).toBe('color: green; background-color: yellow;');
        });
    });

    describe('Standard Features', () => {
        it('should render text interpolation', () => {
            const container = document.createElement('div');
            const text = 'World';
            render(html`<div>Hello ${text}</div>`, container);
            expect(container.textContent).toBe('Hello World');
        });

        it('should render attribute interpolation', () => {
            const container = document.createElement('div');
            const cls = 'my-class';
            render(html`<div class=${cls}></div>`, container);
            expect(container.querySelector('div')!.className).toBe('my-class');
        });
        
        it('should handle boolean attributes', () => {
             const container = document.createElement('div');
             render(html`<input ?disabled=${true} />`, container);
             expect(container.querySelector('input')!.hasAttribute('disabled')).toBe(true);
             
             render(html`<input ?disabled=${false} />`, container);
             expect(container.querySelector('input')!.hasAttribute('disabled')).toBe(false);
        });

        it('should handle event listeners', () => {
            const container = document.createElement('div');
            const spy = vi.fn();
            render(html`<button @click=${spy}></button>`, container);
            
            const button = container.querySelector('button')!;
            button.click();
            expect(spy).toHaveBeenCalled();
        });
    });
});
