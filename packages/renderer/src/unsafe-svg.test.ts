import { expect, it } from 'vitest';
import { html, render, hydrate, renderToString, unsafeHTML } from './cossack-html';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

it('parses unsafe SVG artwork in its parent namespace on creation and update', () => {
    const container = document.createElement('div');
    const template = (raw: string) => html`<svg><g>${unsafeHTML(raw)}</g></svg>`;
    render(template('<path d="M0 0h10v10z"/>'), container);
    expect(container.querySelector('path')!.namespaceURI).toBe(SVG_NS);
    render(template('<circle cx="5" cy="5" r="4"/>'), container);
    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('circle')!.namespaceURI).toBe(SVG_NS);
});

it('retains hydrated SVG then preserves namespaces when its raw children change', () => {
    const container = document.createElement('div');
    const template = (raw: string) => html`<svg>${unsafeHTML(raw)}</svg>`;
    container.innerHTML = renderToString(template('<path d="M0 0h10v10z"/>'), { hydrate: true });
    const original = container.querySelector('path');
    hydrate(template('<path d="M0 0h10v10z"/>'), container);
    expect(container.querySelector('path')).toBe(original);
    render(template('<rect width="12" height="12"/>'), container);
    expect(container.querySelector('rect')!.namespaceURI).toBe(SVG_NS);
});

it('keeps foreignObject HTML integration and ordinary HTML unsafe content intact', () => {
    const container = document.createElement('div');
    render(html`<svg><foreignObject>${unsafeHTML('<div>HTML</div>')}</foreignObject></svg><section>${unsafeHTML('<span>Ordinary</span>')}</section>`, container);
    expect(container.querySelector('foreignObject')!.namespaceURI).toBe(SVG_NS);
    expect(container.querySelector('div')!.namespaceURI).toBe(HTML_NS);
    expect(container.querySelector('span')!.namespaceURI).toBe(HTML_NS);
});

it('escapes spread class text while preserving literal entities and replacement patterns', () => {
    const payload = 'x" onload="alert(1) &copy; $& $`';
    const template = html`<svg class="base &amp; old" ...=${{ class: payload }}></svg>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(template);
    const element = container.querySelector('svg')!;
    expect(element.getAttribute('class')).toBe('base & old ' + payload);
    expect(element.hasAttribute('onload')).toBe(false);
});
