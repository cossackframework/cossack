import { describe, it, expect } from 'vitest';
import { html, renderToString, unsafeHTML } from './cossack-html';
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