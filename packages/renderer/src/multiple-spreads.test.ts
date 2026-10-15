import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { component, html, hydrate, nothing, render, renderToString, type TemplateResult } from './cossack-html';
import { CossackElement } from './cossack-element';
import { ifDefined, preventDefault } from './directives';

// Several spreads on one element. The client used to compile templates with
// the HTML parser, which keeps only the first of several `...` attributes, so
// only the first spread applied while SSR applied all of them. Both sides now
// merge the spreads the same way: a later spread wins an attribute or a
// property, class tokens from every spread are merged, and every spread's
// event handlers run.

type Spread = Record<string, unknown> | typeof nothing | null | undefined;
type Make = (...spreads: Spread[]) => TemplateResult;

/** Tag and sorted attributes of every element, so attribute order does not matter. */
const snapshot = (container: Element) => [...container.querySelectorAll('*')].map((element) => ({
  tag: element.localName,
  attributes: Object.fromEntries(element.getAttributeNames().sort().map((name) => [name, element.getAttribute(name)])),
}));

const ssr = (template: TemplateResult) => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(template);
  return container;
};

const client = (...templates: TemplateResult[]) => {
  const container = document.createElement('div');
  for (const template of templates) render(template, container);
  return container;
};

let warn: MockInstance;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

/**
 * SSR output, the client's first render and hydrated SSR output agree, and a
 * re-render with `next` matches a fresh render of `next` on both sides.
 */
const expectSameEverywhere = (make: Make, first: Spread[], next: Spread[]) => {
  const expected = snapshot(ssr(make(...first)));
  expect(snapshot(client(make(...first)))).toEqual(expected);

  const container = document.createElement('div');
  container.innerHTML = renderToString(make(...first), { hydrate: true });
  const root = container.firstElementChild;
  hydrate(make(...first), container);
  expect(container.firstElementChild).toBe(root);
  expect(snapshot(container)).toEqual(expected);
  expect(warn).not.toHaveBeenCalled();

  render(make(...next), container);
  const expectedNext = snapshot(ssr(make(...next)));
  expect(snapshot(container)).toEqual(expectedNext);
  expect(snapshot(client(make(...first), make(...next)))).toEqual(expectedNext);
  expect(snapshot(client(make(...next)))).toEqual(expectedNext);
  return expected;
};

describe('several spreads on one element', () => {
  const cases: [string, Make, Spread[], Spread[], Record<string, string | null>][] = [
    ['two spreads with different keys',
      (a, b) => html`<div ...=${a} ...=${b}></div>`,
      [{ id: 'one' }, { title: 'two' }], [{ id: 'uno' }, { title: 'dos', 'data-x': '1' }],
      { id: 'one', title: 'two' }],
    ['a later spread wins a shared attribute and gives it back when it drops the key',
      (a, b) => html`<div ...=${a} ...=${b}></div>`,
      [{ id: 'first', title: 'a' }, { id: 'second' }], [{ id: 'first', title: 'a' }, {}],
      { id: 'second', title: 'a' }],
    ['three spreads',
      (a, b, c) => html`<div ...=${a} ...=${b} ...=${c}></div>`,
      [{ id: 'a', title: 'a', lang: 'a' }, { id: 'b', title: 'b' }, { title: 'c' }], [{ id: 'a' }, { id: 'b', title: 'b' }, {}],
      { id: 'b', title: 'c', lang: 'a' }],
    ['class tokens from every spread after the static class',
      (a, b) => html`<div class="base" ...=${a} ...=${b}></div>`,
      [{ class: 'one two' }, { className: 'three', class: 'four' }], [{ class: 'five' }, {}],
      { class: 'base one two three four' }],
    ['a static class between spreads',
      (a, b) => html`<div ...=${a} class="base" ...=${b}></div>`,
      [{ class: 'one' }, { class: 'two' }], [{}, { class: 'three' }],
      { class: 'base one two' }],
    ['a static class after the spreads',
      (a, b) => html`<div ...=${a} ...=${b} class="base"></div>`,
      [{ class: 'one', id: 'x' }, { class: 'two' }], [{ class: 'two' }, { class: 'one' }],
      { class: 'base one two', id: 'x' }],
    ['a bound class between spreads',
      (a, b) => html`<div ...=${a} class=${'base'} ...=${b}></div>`,
      [{ class: 'one' }, { class: 'two' }], [{ class: 'three' }, nothing],
      { class: 'base one two' }],
    ['spreads after static attributes of the same name',
      (a, b) => html`<a href="/static" title="static" ...=${a} ...=${b}>link</a>`,
      [{ href: '/first' }, { title: 'second' }], [{}, { href: '/second' }],
      { href: '/first', title: 'second' }],
    ['spreads before static attributes of the same name',
      (a, b) => html`<a ...=${a} ...=${b} href="/static" title="static">link</a>`,
      [{ href: '/first' }, { href: '/second' }], [{ href: '/first' }, {}],
      { href: '/second', title: 'static' }],
    ['a later spread removing attributes',
      (a, b) => html`<div title="static" ...=${a} ...=${b}></div>`,
      [
        { title: 'first', id: 'x', hidden: true, lang: 'en', dir: 'ltr', 'aria-label': 'label' },
        { title: null, id: nothing, hidden: false, lang: ifDefined(undefined), dir: () => 'rtl', 'aria-label': undefined },
      ],
      [{ title: 'first', id: 'x' }, {}],
      { title: null, id: null, hidden: null, lang: null, dir: null, 'aria-label': null }],
    ['boolean keys across spreads',
      (a, b) => html`<button ...=${a} ...=${b}>x</button>`,
      [{ '?disabled': true, '?hidden': true, inert: true }, { disabled: false, '?hidden': false }], [{ '?disabled': true }, { '?disabled': false, hidden: true }],
      { disabled: null, hidden: null, inert: '' }],
    ['a spread set to nothing next to another',
      (a, b) => html`<div ...=${a} ...=${b}></div>`,
      [nothing, { id: 'b' }], [{ id: 'a', title: 't' }, nothing],
      { id: 'b' }],
    ['spreads separated by other attributes',
      (a, b) => html`<div ...=${a} data-static="s" title=${'bound'} ...=${b} ?hidden=${false}></div>`,
      [{ id: 'one', lang: 'en' }, { id: 'two', class: 'c' }], [{ id: 'one' }, { lang: 'de' }],
      { id: 'two', lang: 'en', class: 'c', 'data-static': 's', title: 'bound', hidden: null }],
    ['spreads on a void element',
      (a, b) => html`<input ...=${a} ...=${b}/>`,
      [{ type: 'text', name: 'a' }, { name: 'b', class: 'c' }], [{ type: 'email' }, { name: 'b' }],
      { type: 'text', name: 'b', class: 'c' }],
    ['spreads on an SVG element',
      (a, b) => html`<svg><circle ...=${a} ...=${b}></circle></svg>`,
      [{ r: '1', fill: 'red' }, { fill: 'blue' }], [{ r: '2', fill: 'red' }, {}],
      { r: '1', fill: 'blue' }],
    ['spreads on several elements',
      (a, b, c, d) => html`<div ...=${a}><span class="s" ...=${b} ...=${c}>${'text'}</span></div><p ...=${d}></p>`,
      [{ id: 'outer' }, { id: 'one', class: 'b' }, { id: 'two', class: 'c' }, { id: 'last' }],
      [{ title: 'outer' }, { id: 'one' }, { class: 'c' }, {}],
      { id: 'outer' }],
  ];

  for (const [name, make, first, next, expected] of cases) {
    it(`renders ${name} the same way on SSR, the client and hydration`, () => {
      const elements = expectSameEverywhere(make, first, next);
      const element = elements.find((entry) => entry.tag !== 'svg')!;
      for (const [attribute, value] of Object.entries(expected)) {
        expect(element.attributes[attribute] ?? null).toBe(value);
      }
    });
  }

  it('compiles each spread with its own marker and leaves none in the DOM', () => {
    const container = client(html`<div ...=${{ id: 'a' }} ...=${{ title: 'b' }} ...=${{ lang: 'c' }}></div>`);
    expect(container.innerHTML).toBe('<div id="a" title="b" lang="c"></div>');
  });

  it('writes the merged attributes where the last spread is', () => {
    expect(renderToString(html`<p ...=${{ id: 'a', title: 'a' }} class="x" ...=${{ title: 'b' }} lang="en"></p>`))
      .toBe('<p class="x" id="a" title="b" lang="en"></p>');
  });

  it('applies property keys from several spreads, later spread first', () => {
    const make = (a: Spread, b: Spread) => html`<input type="checkbox" ...=${a} ...=${b}>`;
    const first = [{ '.checked': true, '.value': 'first' }, { '.checked': false }];
    const next = [{ '.checked': true }, { '.value': 'second' }];
    const read = (container: Element) => {
      const input = container.querySelector('input')!;
      return { checked: input.checked, value: input.value };
    };
    expect(read(ssr(make(first[0], first[1])))).toEqual({ checked: false, value: 'first' });
    expect(read(client(make(first[0], first[1])))).toEqual({ checked: false, value: 'first' });

    const container = document.createElement('div');
    container.innerHTML = renderToString(make(first[0], first[1]), { hydrate: true });
    hydrate(make(first[0], first[1]), container);
    expect(read(container)).toEqual({ checked: false, value: 'first' });
    expect(warn).not.toHaveBeenCalled();

    render(make(next[0], next[1]), container);
    expect(read(container)).toEqual({ checked: true, value: 'second' });
    expect(read(ssr(make(next[0], next[1])))).toEqual({ checked: true, value: 'second' });
  });
});

describe('event keys in several spreads', () => {
  const click = (element: Element) => element.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
  const make = (a: Spread, b: Spread) => html`<button ...=${a} ...=${b}>x</button>`;

  it('runs the handler of every spread after a client render', () => {
    const calls: string[] = [];
    const container = client(make({ '@click': () => calls.push('first') }, { '@click': () => calls.push('second') }));
    click(container.querySelector('button')!);
    expect(calls).toEqual(['first', 'second']);
  });

  it('runs every handler after hydration and updates each spread independently', () => {
    const calls: string[] = [];
    const first = () => calls.push('first');
    const second = () => calls.push('second');
    expect(renderToString(make({ '@click': first, id: 'b' }, { '@click': second }))).toBe('<button id="b">x</button>');

    const container = document.createElement('div');
    container.innerHTML = renderToString(make({ '@click': first, id: 'b' }, { '@click': second }), { hydrate: true });
    const button = container.querySelector('button')!;
    hydrate(make({ '@click': first, id: 'b' }, { '@click': second }), container);
    expect(warn).not.toHaveBeenCalled();
    click(button);
    expect(calls).toEqual(['first', 'second']);

    // Fresh closures replace the handler; a dropped key removes the listener.
    calls.length = 0;
    render(make({ '@click': () => calls.push('third'), id: 'b' }, {}), container);
    click(button);
    expect(calls).toEqual(['third']);

    calls.length = 0;
    render(make({ '@click': nothing }, { '@click': second }), container);
    click(button);
    expect(calls).toEqual(['second']);

    calls.length = 0;
    render(make({ '@click': first }, { '@click': second }), container);
    render(make({ '@click': first }, { '@click': second }), container);
    click(button);
    expect(calls.sort()).toEqual(['first', 'second']);
    expect(button.id).toBe('');
  });

  it('wraps preventDefault() handlers from any spread', () => {
    const handler = vi.fn();
    const container = client(html`<form ...=${{ id: 'f' }} ...=${{ '@submit': preventDefault(handler) }}></form>`);
    const form = container.querySelector('form')!;
    const event = new Event('submit', { cancelable: true });
    form.dispatchEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(form.id).toBe('f');
    expect(form.hasAttribute('novalidate')).toBe(true);
  });
});

describe('several spreads in a hydrated component', () => {
  it('merges caller attributes with the component\'s own spread', async () => {
    const clicks: string[] = [];
    class Action extends CossackElement {
      declare props: Record<string, unknown>;
      render() {
        const { label, ...rest } = this.props;
        return html`<button class="action" ...=${rest} ...=${{ class: 'own', type: 'button', '@click': () => clicks.push('own') }}>${label}</button>`;
      }
    }
    const page = (props: Record<string, unknown>) => html`<main>${component(Action, props as never)}</main>`;
    const props = { label: 'Save', id: 'save', class: 'caller', type: 'submit', '@click': () => clicks.push('caller') };

    const expected = '<main><button class="action caller own" id="save" type="button">Save</button></main>';
    expect(renderToString(page(props))).toBe(expected);

    const container = document.createElement('div');
    container.innerHTML = renderToString(page(props), { hydrate: true });
    const button = container.querySelector('button')!;
    hydrate(page(props), container);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
    expect(container.querySelector('button')).toBe(button);
    expect(snapshot(container)).toEqual(snapshot(ssr(page(props))));
    button.click();
    expect(clicks).toEqual(['caller', 'own']);
  });
});
