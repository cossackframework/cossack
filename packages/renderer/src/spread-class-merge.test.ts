import { describe, expect, it } from 'vitest';
import { html, hydrate, nothing, render, renderToString, type TemplateResult } from './cossack-html';

// SSR merges a spread `class` into the element's own class attribute. The tag
// is read with the shared tokenizer, so the result must match the client for
// every quoting style and for markup-like text in other attribute values.
const ssrElement = (template: TemplateResult) => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(template);
  return container.firstElementChild!;
};
const clientElement = (template: TemplateResult) => {
  const container = document.createElement('div');
  render(template, container);
  return container.firstElementChild!;
};

describe('SSR spread class merge', () => {
  const cases: [string, () => TemplateResult, string][] = [
    ['double-quoted class', () => html`<div class="base" ...=${{ class: 'extra' }}></div>`, 'base extra'],
    ['single-quoted class', () => html`<div class='base' ...=${{ class: 'extra' }}></div>`, 'base extra'],
    ['unquoted class', () => html`<div class=base ...=${{ class: 'extra' }}></div>`, 'base extra'],
    ['uppercase CLASS', () => html`<div CLASS="base" ...=${{ class: 'extra' }}></div>`, 'base extra'],
    ['bare class attribute', () => html`<div class ...=${{ class: 'extra' }}></div>`, 'extra'],
    ['bound class', () => html`<div class=${'base'} ...=${{ className: 'extra' }}></div>`, 'base extra'],
    ['`<` in a later attribute value', () => html`<div class="base" title="1 < 2" ...=${{ class: 'extra' }}></div>`, 'base extra'],
    ['class-like text in another value', () => html`<div title='x class="nope" y' class="base" ...=${{ class: 'extra' }}></div>`, 'base extra'],
    ['className without a class attribute', () => html`<div id="a" ...=${{ className: 'extra' }}></div>`, 'extra'],
  ];

  for (const [name, template, expected] of cases) {
    it(`merges into a ${name} like the client`, () => {
      const ssr = ssrElement(template());
      expect(ssr.getAttribute('class')).toBe(expected);
      expect(clientElement(template()).getAttribute('class')).toBe(expected);
    });
  }

  it('leaves other attribute values untouched', () => {
    const ssr = ssrElement(html`<div title='x class="nope" y' class="base" data-x="1 < 2" ...=${{ class: 'extra', id: 'i' }}></div>`);
    expect(ssr.getAttribute('title')).toBe('x class="nope" y');
    expect(ssr.getAttribute('data-x')).toBe('1 < 2');
    expect(ssr.id).toBe('i');
    expect(ssr.getAttributeNames().filter((n) => n === 'class')).toEqual(['class']);
  });

  it('merges into the element that owns the spread, not an earlier one', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(html`<p class="outer" title="a > b"><span title="c < d" ...=${{ class: 'inner' }}></span></p>`);
    expect(container.querySelector('p')!.getAttribute('class')).toBe('outer');
    expect(container.querySelector('span')!.getAttribute('class')).toBe('inner');
  });

  it('finds the element after an attribute that `nothing` removed', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(html`<p title="${nothing}"><span class='b' ...=${{ class: 'x' }}></span></p>`);
    expect(container.querySelector('p')!.hasAttribute('title')).toBe(false);
    expect(container.querySelector('span')!.getAttribute('class')).toBe('b x');
  });

  it('escapes the merged class and keeps it inside the original quotes', () => {
    const ssr = ssrElement(html`<div class='base' ...=${{ class: `it's "x"` }}></div>`);
    expect(ssr.getAttribute('class')).toBe(`base it's "x"`);
  });

  it('hydrates a merged single-quoted class and keeps updating it', () => {
    const template = (extra: string) => html`<div class='base' title="1 < 2" ...=${{ class: extra }}></div>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(template('one'), { hydrate: true });
    const element = container.firstElementChild!;
    hydrate(template('one'), container);
    expect(container.firstElementChild).toBe(element);
    expect(element.getAttribute('class')).toBe('base one');
    render(template('two'), container);
    expect(element.getAttribute('class')).toBe('base two');
  });
});
