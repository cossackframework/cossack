import { describe, it, expect } from 'vitest';
import { html, renderToString, render, unsafeHTML } from './cossack-html';
import { CossackElement } from './cossack-element';

describe('SSR renderToString', () => {
  it('renders simple static html', () => {
    const template = html`<div>Hello World</div>`;
    expect(renderToString(template)).toBe('<div>Hello World</div>');
  });

  it('renders interpolated values', () => {
    const name = 'Cossack';
    const template = html`<h1>Hello ${name}</h1>`;
    expect(renderToString(template)).toBe('<h1>Hello Cossack</h1>');
  });

  it('renders arrays of values', () => {
    const items = ['a', 'b', 'c'];
    const template = html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`;
    expect(renderToString(template)).toBe('<ul><li>a</li><li>b</li><li>c</li></ul>');
  });

  it('handles nested templates', () => {
    const nested = html`<span>nested</span>`;
    const template = html`<div>${nested}</div>`;
    expect(renderToString(template)).toBe('<div><span>nested</span></div>');
  });

  it('escapes unsafe strings by default', () => {
      const unsafe = '<script>alert(1)</script>';
      const template = html`<div>${unsafe}</div>`;
      expect(renderToString(template)).toBe('<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
  });

  it('renders unsafeHTML raw', () => {
      const raw = '<span>Raw HTML</span>';
      const template = html`<div>${unsafeHTML(raw)}</div>`;
      expect(renderToString(template)).toBe('<div><span>Raw HTML</span></div>');
  });
});

describe('Component Logic (SSR)', () => {
    class MyElement extends CossackElement {
        render() {
            return html`<p>Inner Content</p>`;
        }
    }

    it('renders a component manually', async () => {
        const el = new MyElement();
        const template = el.render();
        expect(renderToString(template!)).toBe('<p>Inner Content</p>');
    });
});

describe('Attribute interpolation', () => {
    describe('SSR', () => {
        it('renders class with static prefix and dynamic suffix', () => {
            const backgroundClass = 'bg-red-500';
            const template = html`<div class="h-[100px] w-[100px] ${backgroundClass}"></div>`;
            expect(renderToString(template)).toBe('<div class="h-[100px] w-[100px] bg-red-500"></div>');
        });

        it('renders class with dynamic value only', () => {
            const cls = 'active';
            const template = html`<div class="${cls}"></div>`;
            expect(renderToString(template)).toBe('<div class="active"></div>');
        });

        it('renders class with static prefix, dynamic middle, and static suffix', () => {
            const color = 'blue';
            const template = html`<div class="btn ${color}-text large"></div>`;
            expect(renderToString(template)).toBe('<div class="btn blue-text large"></div>');
        });

        it('renders two markers in one attribute', () => {
            const x = 'X';
            const y = 'Y';
            const template = html`<div class="a ${x} b ${y} c"></div>`;
            expect(renderToString(template)).toBe('<div class="a X b Y c"></div>');
        });

        it('renders three markers in one attribute', () => {
            const a = 'A';
            const b = 'B';
            const c = 'C';
            const template = html`<div style="p:${a}; q:${b}; r:${c};"></div>`;
            expect(renderToString(template)).toBe('<div style="p:A; q:B; r:C;"></div>');
        });
    });

    describe('Client-side render', () => {
        it('renders class with static prefix and dynamic suffix', () => {
            const container = document.createElement('div');
            const backgroundClass = 'bg-red-500';
            render(html`<div class="h-[100px] w-[100px] ${backgroundClass}"></div>`, container);
            const div = container.querySelector('div');
            expect(div).not.toBeNull();
            expect(div!.getAttribute('class')).toBe('h-[100px] w-[100px] bg-red-500');
        });

        it('preserves static prefix when updating dynamic value', () => {
            const container = document.createElement('div');
            // Use a helper to ensure the same strings array reference is used
            // (tagged template literals cache the strings array)
            function renderTemplate(val: string) {
                return html`<div class="h-[100px] w-[100px] ${val}"></div>`;
            }
            render(renderTemplate('bg-red-500'), container);
            const div = container.querySelector('div');
            expect(div!.getAttribute('class')).toBe('h-[100px] w-[100px] bg-red-500');

            // Update with same template (tagged template literals reuse the same strings object)
            render(renderTemplate('bg-blue-500'), container);
            expect(div!.getAttribute('class')).toBe('h-[100px] w-[100px] bg-blue-500');
        });

        it('renders class with dynamic value only', () => {
            const container = document.createElement('div');
            const cls = 'active';
            render(html`<div class="${cls}"></div>`, container);
            const div = container.querySelector('div');
            expect(div!.getAttribute('class')).toBe('active');
        });

        it('renders class with multiple static and dynamic segments', () => {
            const container = document.createElement('div');
            const color = 'blue';
            render(html`<div class="btn ${color}-text large"></div>`, container);
            const div = container.querySelector('div');
            expect(div!.getAttribute('class')).toBe('btn blue-text large');
        });

        it('renders two markers in one attribute', () => {
            const container = document.createElement('div');
            const x = 'X';
            const y = 'Y';
            render(html`<div class="a ${x} b ${y} c"></div>`, container);
            const div = container.querySelector('div');
            expect(div!.getAttribute('class')).toBe('a X b Y c');
        });

        it('updates both markers on re-render', () => {
            const container = document.createElement('div');
            function renderTemplate(x: string, y: string) {
                return html`<div class="a ${x} b ${y} c"></div>`;
            }
            render(renderTemplate('X', 'Y'), container);
            const div = container.querySelector('div');
            expect(div!.getAttribute('class')).toBe('a X b Y c');

            render(renderTemplate('X2', 'Y2'), container);
            expect(div!.getAttribute('class')).toBe('a X2 b Y2 c');
        });

        it('renders three markers in one attribute', () => {
            const container = document.createElement('div');
            const a = 'A';
            const b = 'B';
            const c = 'C';
            render(html`<div style="p:${a}; q:${b}; r:${c};"></div>`, container);
            const div = container.querySelector('div');
            expect(div!.getAttribute('style')).toBe('p:A; q:B; r:C;');
        });

        it('handles undefined initial value in a multi-marker attribute', () => {
            const container = document.createElement('div');
            const a = 'A';
            const b: string | undefined = undefined;
            render(html`<div style="p:${a}; q:${b};"></div>`, container);
            const div = container.querySelector('div');
            // undefined renders as "undefined" via String(); no crash.
            expect(div!.getAttribute('style')).toBe('p:A; q:undefined;');
        });
    });

    describe('unsafeHTML (client-side render)', () => {
        it('renders raw HTML without recursion', () => {
            // Regression: UnsafeHTMLResult is an object, so the generic
            // object branch in updateNode used to catch it before the
            // isUnsafeHTML branch — causing infinite recursion via
            // render(html`${value}`) -> NodePart.update -> updateNode -> ...
            const container = document.createElement('div');
            render(html`<div>${unsafeHTML('<span>raw</span>')}</div>`, container);
            const span = container.querySelector('span');
            expect(span).not.toBeNull();
            expect(span!.textContent).toBe('raw');
        });

        it('updates unsafeHTML without recursion', () => {
            const container = document.createElement('div');
            function tpl(html2: string) {
                return html`<div>${unsafeHTML(html2)}</div>`;
            }
            render(tpl('<b>one</b>'), container);
            expect(container.querySelector('b')!.textContent).toBe('one');

            // Re-render with same strings array (cached path).
            render(tpl('<i>two</i>'), container);
            expect(container.querySelector('i')!.textContent).toBe('two');
        });
    });
});