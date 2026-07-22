import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  html,
  hydrate,
  nothing,
  render,
  renderToString,
  svg,
  type SanitizerFactory,
  type SVGTemplateResult,
  type TemplateResult,
  type ValueSanitizer,
} from './cossack-html';
import { component } from './cossack-html';
import { CossackElement } from './cossack-element';
import { css, unsafeCSS, type CSSResultGroup } from './css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

describe('Lit-compatible public types', () => {
  it('discriminates HTML and SVG template results', () => {
    const htmlResult = html`<p></p>`;
    const svgResult = svg`<circle></circle>`;
    expectTypeOf(htmlResult).toEqualTypeOf<TemplateResult<1>>();
    expectTypeOf(svgResult).toEqualTypeOf<SVGTemplateResult>();
    expect(htmlResult['_$litType$']).toBe(1);
    expect(svgResult['_$litType$']).toBe(2);
  });

  it('exports Lit-compatible sanitizer function types without runtime setup', () => {
    const sanitizer: ValueSanitizer = (value) => value;
    const factory: SanitizerFactory = (_node, _name, _type) => sanitizer;
    expect(factory(document.body, 'title', 'attribute')('safe')).toBe('safe');
  });
});

describe('SVG templates', () => {
  it('creates namespaced SVG fragments with dynamic attributes and text', () => {
    const container = document.createElementNS(SVG_NS, 'svg');
    const circle = (fill: string, label: string) => svg`<circle fill="${fill}"><title>${label}</title></circle>`;
    render(circle('red', 'first'), container);

    const element = container.firstElementChild!;
    const title = element.firstElementChild!;
    expect(element.namespaceURI).toBe(SVG_NS);
    expect(title.namespaceURI).toBe(SVG_NS);
    expect(element.getAttribute('fill')).toBe('red');
    expect(title.textContent).toBe('first');

    render(circle('blue', 'second'), container);
    expect(container.firstElementChild).toBe(element);
    expect(element.getAttribute('fill')).toBe('blue');
    expect(title.textContent).toBe('second');
  });

  it('preserves namespaces through nested fragments, arrays, and foreignObject', () => {
    const container = document.createElementNS(SVG_NS, 'svg');
    const nested = [svg`<path d="M0 0"></path>`, svg`<text>label</text>`];
    render(svg`<g>${nested}<foreignObject>${html`<div>HTML</div>`}</foreignObject></g>`, container);

    expect(container.querySelector('g')!.namespaceURI).toBe(SVG_NS);
    expect(container.querySelector('path')!.namespaceURI).toBe(SVG_NS);
    expect(container.querySelector('text')!.namespaceURI).toBe(SVG_NS);
    expect(container.querySelector('foreignObject')!.namespaceURI).toBe(SVG_NS);
    expect(container.querySelector('div')!.namespaceURI).toBe(HTML_NS);
  });

  it('serializes SVG like HTML and hydrates without replacing correctly parsed nodes', () => {
    const template = (label: string) => svg`<g><text>${label}</text></g>`;
    expect(renderToString(template('SSR'))).toBe('<g><text>SSR</text></g>');

    const container = document.createElementNS(SVG_NS, 'svg');
    container.innerHTML = renderToString(template('SSR'), { hydrate: true });
    const group = container.firstElementChild!;
    hydrate(template('SSR'), container);
    expect(container.firstElementChild).toBe(group);
    expect(group.namespaceURI).toBe(SVG_NS);
    render(template('updated'), container);
    expect(container.firstElementChild).toBe(group);
    expect(group.textContent).toBe('updated');
  });

  it('does not reuse an HTML compilation for identical tagged strings', () => {
    const container = document.createElement('div');
    const make = (tag: typeof html | typeof svg) => tag`<circle></circle>`;
    render(make(html), container);
    expect(container.firstElementChild!.namespaceURI).toBe(HTML_NS);
    render(make(svg), container);
    expect(container.firstElementChild!.namespaceURI).toBe(SVG_NS);
  });
});

describe('nothing', () => {
  it('clears child expressions and treats an empty string as an empty child', () => {
    const container = document.createElement('div');
    const template = (value: unknown) => html`<p>${value}</p>`;
    render(template('shown'), container);
    const paragraph = container.firstElementChild!;
    render(template(nothing), container);
    expect(paragraph.childNodes).toHaveLength(2); // managed anchor comments only
    expect(paragraph.textContent).toBe('');
    render(template('again'), container);
    expect(paragraph.textContent).toBe('again');
    render(template(''), container);
    expect(paragraph.textContent).toBe('');
  });

  it('removes normal and multi-expression attributes in SSR and client updates', () => {
    const multi = (a: unknown, b: unknown) => html`<div title="pre-${a}-mid-${b}-post"></div>`;
    expect(renderToString(multi('a', nothing))).toBe('<div></div>');

    const container = document.createElement('div');
    render(multi('a', 'b'), container);
    const element = container.firstElementChild!;
    expect(element.getAttribute('title')).toBe('pre-a-mid-b-post');
    render(multi('a', nothing), container);
    expect(element.hasAttribute('title')).toBe(false);
    render(multi('x', 'y'), container);
    expect(element.getAttribute('title')).toBe('pre-x-mid-y-post');
  });

  it('assigns undefined to properties, removes booleans, and deactivates events', () => {
    const handler = vi.fn();
    const template = (property: unknown, disabled: unknown, event: unknown) =>
      html`<button .custom=${property} ?disabled=${disabled} @click=${event}>go</button>`;
    const container = document.createElement('div');
    render(template('value', true, handler), container);
    const button = container.firstElementChild as HTMLButtonElement & { custom?: unknown };
    button.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);

    render(template(nothing, nothing, nothing), container);
    expect(button.custom).toBeUndefined();
    expect(button.hasAttribute('disabled')).toBe(false);
    button.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(renderToString(template(nothing, nothing, nothing))).toBe('<button>go</button>');
  });

  it('clears all attributes managed by a spread and restores later values', () => {
    const template = (value: unknown) => html`<input ...=${value}>`;
    const container = document.createElement('div');
    render(template({ title: 'x', '?disabled': true, '.custom': 'hello' }), container);
    const input = container.firstElementChild as HTMLInputElement & { custom?: unknown };
    expect(input.title).toBe('x');
    expect(input.disabled).toBe(true);
    expect(input.custom).toBe('hello');

    render(template(nothing), container);
    expect(input.hasAttribute('title')).toBe(false);
    expect(input.disabled).toBe(false);
    expect(input.custom).toBeUndefined();
    expect(renderToString(template(nothing))).toBe('<input>');
  });

  it('hydrates empty values and supports later transitions', () => {
    const template = (value: unknown) => html`<div>${value}</div>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(template(nothing), { hydrate: true });
    const element = container.firstElementChild!;
    hydrate(template(nothing), container);
    expect(container.firstElementChild).toBe(element);
    render(template('ready'), container);
    expect(element.textContent).toBe('ready');
  });
});

describe('Light DOM component styles', () => {
  it('validates css interpolations immediately and accepts trusted unsafeCSS', () => {
    expect(() => css`div { color: ${'red'}; }`).toThrow(/unsafeCSS/);
    expect(css`div { width: ${2}px; color: ${unsafeCSS('rebeccapurple')}; }`.cssText)
      .toContain('rebeccapurple');
  });

  it('flattens inherited arrays and keeps the last occurrence of a repeated result', () => {
    const repeated = css`.repeated { color: red; }`;
    const middle = css`.middle { color: blue; }`;
    class Base extends CossackElement {
      static styles: CSSResultGroup = [[repeated]];
    }
    class Styled extends Base {
      static styles: CSSResultGroup = [Base.styles, middle, repeated];
      render() { return html`<div class="repeated middle"></div>`; }
    }
    const output = renderToString(component(Styled));
    const middleIndex = output.indexOf('.middle');
    const repeatedIndex = output.indexOf('.repeated');
    expect(middleIndex).toBeGreaterThan(-1);
    expect(repeatedIndex).toBeGreaterThan(middleIndex);
    expect(output.match(/\.repeated/g)).toHaveLength(1);
  });

  it('rejects non-CSSResult static style entries', () => {
    class Invalid extends CossackElement {
      static styles = ['div { color: red; }'] as unknown as CSSResultGroup;
    }
    expect(() => new Invalid()._getStyleScopeId()).toThrow(/static styles/);
  });

  it('rewrites compounds, functional selectors, conditional rules, and keyframes', () => {
    class Styled extends CossackElement {
      static styles = css`
        .card > span:hover, :is(.active, div em)::before { animation: fade 1s; }
        @media (min-width: 1px) { p { animation-name: fade; } }
        @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
        @font-face { font-family: Demo; src: url(demo.woff2); }
      `;
      render() { return html`<div class="card"><span></span><p></p></div>`; }
    }
    const output = renderToString(component(Styled));
    const scope = output.match(/data-cossack-style="([^"]+)"/)![1];
    expect(output).toContain(`.card[data-cossack-scope="${scope}"]>span[data-cossack-scope="${scope}"]:hover`);
    expect(output).toContain(`.active[data-cossack-scope="${scope}"]`);
    expect(output).toContain(`@media (min-width:1px){p[data-cossack-scope="${scope}"]`);
    expect(output).toContain(`@keyframes ${scope}-fade`);
    expect(output).toContain(`animation:${scope}-fade 1s`);
    expect(output).toContain(`animation-name:${scope}-fade`);
    expect(output).toContain('@font-face{font-family:Demo');
  });

  it('rejects Shadow DOM-only selectors descriptively', () => {
    for (const selector of [':host', ':host-context(.theme)', '::slotted(span)']) {
      class Invalid extends CossackElement {
        static styles = unsafeCSS(`${selector} { color: red; }`);
      }
      expect(() => new Invalid()._getStyleScopeId()).toThrow(/Shadow DOM selector/);
    }
  });

  it('scopes owned elements, isolates nested components, and preserves projected ownership', () => {
    class Child extends CossackElement {
      static styles = css`.target { color: blue; }`;
      render() { return html`<section class="target">${this.children}</section>`; }
    }
    class Parent extends CossackElement {
      static styles = css`.target { color: red; }`;
      render() {
        const projected = html`<strong class="target">projected</strong>`;
        return html`<div class="target">parent</div>${component(Child, {}, projected)}`;
      }
    }

    const container = document.createElement('div');
    const parent = new Parent();
    parent.mount(container);
    return parent.updateComplete.then(() => Promise.resolve()).then(() => {
      const styleIds = Array.from(container.querySelectorAll('style')).map((style) => style.dataset.cossackStyle!);
      const [parentScope, childScope] = styleIds;
      expect(parentScope).toBeTruthy();
      expect(childScope).toBeTruthy();
      expect(parentScope).not.toBe(childScope);
      expect(container.querySelector('div.target')!.getAttribute('data-cossack-scope')).toBe(parentScope);
      expect(container.querySelector('section.target')!.getAttribute('data-cossack-scope')).toBe(childScope);
      expect(container.querySelector('strong.target')!.getAttribute('data-cossack-scope')).toBe(parentScope);
    });
  });

  it('keeps one managed style node stable across updates and hydration', async () => {
    class Styled extends CossackElement {
      static properties = { count: { state: true } };
      static styles = css`button { color: red; }`;
      declare count: number;
      constructor() { super(); this.count = 0; }
      render() { return html`<button>${this.count}</button>`; }
    }

    const instance = new Styled();
    const container = document.createElement('div');
    instance.mount(container);
    await instance.updateComplete;
    const style = container.querySelector('style')!;
    const button = container.querySelector('button')!;
    instance.count = 1;
    await instance.updateComplete;
    expect(container.querySelectorAll('style')).toHaveLength(1);
    expect(container.querySelector('style')).toBe(style);
    expect(container.querySelector('button')).toBe(button);

    const embedded = () => html`${component(Styled)}`;
    const hydrated = document.createElement('div');
    hydrated.innerHTML = renderToString(embedded(), { hydrate: true });
    const ssrStyle = hydrated.querySelector('style')!;
    const ssrButton = hydrated.querySelector('button')!;
    hydrate(embedded(), hydrated);
    await Promise.resolve();
    await Promise.resolve();
    expect(hydrated.querySelector('style')).toBe(ssrStyle);
    expect(hydrated.querySelector('button')).toBe(ssrButton);
  });

  it('uses deterministic scopes for multiple instances and leaves escape-hatch nodes untouched', async () => {
    class Styled extends CossackElement {
      static styles = css`.owned { color: green; }`;
      render() {
        const raw = document.createElement('i');
        raw.className = 'manual';
        return html`<span class="owned" title="literal <b> text"></span>${raw}`;
      }
    }
    const first = new Styled();
    const second = new Styled();
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    first.mount(firstContainer);
    second.mount(secondContainer);
    await Promise.all([first.updateComplete, second.updateComplete]);

    const firstId = firstContainer.querySelector('style')!.dataset.cossackStyle;
    const secondId = secondContainer.querySelector('style')!.dataset.cossackStyle;
    expect(firstId).toBe(secondId);
    expect(firstContainer.querySelector('span')!.getAttribute('data-cossack-scope')).toBe(firstId);
    expect(firstContainer.querySelector('span')!.getAttribute('title')).toBe('literal <b> text');
    expect(firstContainer.querySelector('i')!.hasAttribute('data-cossack-scope')).toBe(false);
    expect(firstContainer.querySelectorAll('style')).toHaveLength(1);
    expect(secondContainer.querySelectorAll('style')).toHaveLength(1);
  });

  it('preserves authored text that resembles an internal template marker', () => {
    class Styled extends CossackElement {
      static styles = css`p { color: green; }`;
      render() { return html`<p>\uE0000\uE001 ${'dynamic'}</p>`; }
    }

    const output = renderToString(component(Styled));
    expect(output).toContain(`<p data-cossack-scope=`);
    expect(output).toContain(`\uE0000\uE001 dynamic</p>`);
  });
});
