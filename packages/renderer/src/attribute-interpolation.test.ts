import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { html, hydrate, nothing, render, renderToString, svg, type TemplateResult } from './cossack-html';
import { ifDefined, live } from './directives';

// An attribute whose value is text with bindings in it, such as
// `viewBox="0 0 ${size} ${size}"`. The client used to write it once per
// binding, so the browser briefly saw "0 0 16 " and logged an invalid
// viewBox. It is now written once per render, after all its bindings have
// updated, and not at all when the value is unchanged.

let setSpy: MockInstance<Element['setAttribute']>;
let removeSpy: MockInstance<Element['removeAttribute']>;

beforeEach(() => {
  setSpy = vi.spyOn(Element.prototype, 'setAttribute');
  removeSpy = vi.spyOn(Element.prototype, 'removeAttribute');
});
afterEach(() => {
  setSpy.mockRestore();
  removeSpy.mockRestore();
});

/** Writes of attribute `name` since the last call: `set <value>` or `remove`. */
const takeWrites = (name: string): string[] => {
  const writes: { order: number; text: string }[] = [];
  setSpy.mock.calls.forEach(([attribute, value], i) => {
    if (attribute === name) writes.push({ order: setSpy.mock.invocationCallOrder[i], text: `set ${value}` });
  });
  removeSpy.mock.calls.forEach(([attribute], i) => {
    if (attribute === name) writes.push({ order: removeSpy.mock.invocationCallOrder[i], text: 'remove' });
  });
  setSpy.mockClear();
  removeSpy.mockClear();
  return writes.sort((a, b) => a.order - b.order).map((write) => write.text);
};

const icon = (size: number | typeof nothing, label = 'icon') =>
  html`<svg viewBox="0 0 ${size} ${size}" aria-label="${label}"></svg>`;

describe('attributes with several bindings', () => {
  it('writes the assembled value once on the first client render', () => {
    const container = document.createElement('div');
    render(icon(16), container);
    expect(takeWrites('viewBox')).toEqual(['set 0 0 16 16']);
    expect(container.firstElementChild!.getAttribute('viewBox')).toBe('0 0 16 16');
  });

  it('writes once per render on updates and not at all when the value is unchanged', () => {
    const container = document.createElement('div');
    render(icon(16), container);
    takeWrites('viewBox');

    render(icon(16, 'other'), container);
    expect(takeWrites('viewBox')).toEqual([]);

    render(icon(24), container);
    expect(takeWrites('viewBox')).toEqual(['set 0 0 24 24']);

    render(icon(nothing), container);
    expect(takeWrites('viewBox')).toEqual(['remove']);
    expect(container.firstElementChild!.hasAttribute('viewBox')).toBe(false);

    render(icon(nothing), container);
    expect(takeWrites('viewBox')).toEqual([]);

    render(icon(32), container);
    expect(takeWrites('viewBox')).toEqual(['set 0 0 32 32']);
  });

  it('keeps the server value on hydration and writes once when it changes', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(icon(16), { hydrate: true });
    const element = container.firstElementChild!;
    takeWrites('viewBox');

    hydrate(icon(16), container);
    expect(container.firstElementChild).toBe(element);
    expect(takeWrites('viewBox')).toEqual([]);
    expect(element.getAttribute('viewBox')).toBe('0 0 16 16');

    render(icon(20), container);
    expect(takeWrites('viewBox')).toEqual(['set 0 0 20 20']);
  });

  it('corrects a different server value with one write on hydration', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(icon(16), { hydrate: true });
    takeWrites('viewBox');
    hydrate(icon(24), container);
    expect(takeWrites('viewBox')).toEqual(['set 0 0 24 24']);
  });

  it('writes once inside SVG templates and for a binding next to static text', () => {
    const shape = (x: number, y: number) => svg`<path d="M${x} ${y} L10 10"></path>`;
    const container = document.createElement('div');
    render(html`<svg>${shape(1, 2)}</svg>`, container);
    expect(takeWrites('d')).toEqual(['set M1 2 L10 10']);

    const button = (kind: string) => html`<button class="btn btn-${kind}">x</button>`;
    render(button('primary'), container);
    expect(takeWrites('class')).toEqual(['set btn btn-primary']);
    render(button('primary'), container);
    expect(takeWrites('class')).toEqual([]);
    render(button('ghost'), container);
    expect(takeWrites('class')).toEqual(['set btn btn-ghost']);
  });

  it('keeps spread classes when an unchanged class value is skipped', () => {
    const tpl = (kind: string, extra: string) => html`<div class="btn ${kind}" ...=${{ class: extra }}></div>`;
    const container = document.createElement('div');
    render(tpl('a', 'x'), container);
    render(tpl('a', 'x'), container);
    expect(container.firstElementChild!.getAttribute('class')).toBe('btn a x');
    render(tpl('b', 'x'), container);
    expect(container.firstElementChild!.getAttribute('class')).toBe('btn b x');
  });
});

describe('text bindings in attribute values: SSR matches the client', () => {
  const ssrValue = (template: TemplateResult, name: string) => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(template);
    return { markup: renderToString(template), value: container.firstElementChild!.getAttribute(name) };
  };
  const clientValue = (template: TemplateResult, name: string) => {
    const container = document.createElement('div');
    render(template, container);
    return container.firstElementChild!.getAttribute(name);
  };

  const cases: [string, () => TemplateResult, string | null][] = [
    // A binding in text adds its text: null, undefined, functions and
    // ifDefined(undefined) add nothing, booleans and numbers add String().
    ['null before static text', () => html`<div title="${null} x ${'b'}"></div>`, ' x b'],
    ['undefined before static text', () => html`<div title="${undefined} b"></div>`, ' b'],
    ['false before static text', () => html`<div title="${false} x ${'b'}"></div>`, 'false x b'],
    ['ifDefined(undefined) before static text', () => html`<div title="${ifDefined(undefined)} b"></div>`, ' b'],
    ['a function before static text', () => html`<div title="${() => 'source'} b"></div>`, ' b'],
    ['null after static text', () => html`<div title="a ${null}"></div>`, 'a '],
    ['false after static text', () => html`<div title="a ${false}"></div>`, 'a false'],
    ['live() after static text', () => html`<div title="a ${live('x')}"></div>`, 'a x'],
    ['two bindings without static text', () => html`<div title="${'a'}${'b'}"></div>`, 'ab'],
    // `nothing` anywhere removes the attribute.
    ['nothing before static text', () => html`<div title="${nothing} b"></div>`, null],
    ['nothing after static text', () => html`<div title="a ${nothing}"></div>`, null],
    ['nothing in the second of two bindings', () => html`<div title="${'a'} ${nothing}"></div>`, null],
    // A binding that is the whole value keeps its own rules.
    ['a whole null value', () => html`<div title="${null}"></div>`, null],
    ['a whole false value', () => html`<div title=${false}></div>`, 'false'],
  ];

  for (const [name, template, expected] of cases) {
    it(`renders ${name} the same way`, () => {
      const { markup, value } = ssrValue(template(), 'title');
      expect(value).toBe(expected);
      expect(markup).toMatch(/^<div( title="[^"]*")?><\/div>$/);
      expect(clientValue(template(), 'title')).toBe(expected);

      const container = document.createElement('div');
      container.innerHTML = renderToString(template(), { hydrate: true });
      hydrate(template(), container);
      expect(container.firstElementChild!.getAttribute('title')).toBe(expected);
    });
  }
});
