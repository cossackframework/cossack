import { describe, expect, it, vi } from 'vitest';
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

// The client adds spread classes to the element's own class list, whichever
// side of the spread the class attribute is on. SSR must render the same
// class attribute in every order, and hydration must keep it.
describe('spread class order: SSR matches the client', () => {
  type Spread = Record<string, unknown>;
  const cases: [string, (spread: Spread) => TemplateResult, Spread, string][] = [
    ['spread after a static class', (s) => html`<div class="y" ...=${s}></div>`, { class: 'x' }, 'y x'],
    ['spread before a static class', (s) => html`<div ...=${s} class="y"></div>`, { class: 'x' }, 'y x'],
    ['className before a static class', (s) => html`<div ...=${s} class="y"></div>`, { className: 'x' }, 'y x'],
    ['className after a static class', (s) => html`<div class="y" ...=${s}></div>`, { className: 'x' }, 'y x'],
    ['spread before an empty static class', (s) => html`<div ...=${s} class=""></div>`, { class: 'x' }, 'x'],
    ['spread after an empty static class', (s) => html`<div class="" ...=${s}></div>`, { class: 'x' }, 'x'],
    ['spread with other keys before a class', (s) => html`<a ...=${s} class="y" href="/">a</a>`, { id: 'i', class: 'x z', title: 't' }, 'y x z'],
    ['no class attribute', (s) => html`<div ...=${s}></div>`, { class: 'x' }, 'x'],
    ['spread before a bound class', (s) => html`<div ...=${s} class=${'y'}></div>`, { class: 'x' }, 'y x'],
    ['spread after a bound class', (s) => html`<div class=${'y'} ...=${s}></div>`, { class: 'x' }, 'y x'],
    ['spread before a multi-part class', (s) => html`<div ...=${s} class="a ${'b'}"></div>`, { class: 'x' }, 'a b x'],
    ['tokens the class already has', (s) => html`<div ...=${s} class="a  b"></div>`, { class: ' b  c ' }, 'a b c'],
    ['both class and className', (s) => html`<div ...=${s} class="y"></div>`, { className: 'x', class: 'w' }, 'y x w'],
    ['a void element closed with />', (s) => html`<input ...=${s} class="y"/>`, { class: 'x' }, 'y x'],
    ['a void element without a class', (s) => html`<input ...=${s}/>`, { class: 'x' }, 'x'],
    ['an empty spread class', (s) => html`<div ...=${s} class="y"></div>`, { class: '' }, 'y'],
  ];
  for (const empty of [null, undefined, false, nothing]) {
    cases.push([`a ${String(empty)} spread class`, (s) => html`<div ...=${s} class="y"></div>`, { class: empty }, 'y']);
  }

  for (const [name, template, spread, expected] of cases) {
    it(`renders ${name} the same way`, () => {
      const ssr = ssrElement(template(spread));
      const client = clientElement(template(spread));
      expect(ssr.getAttribute('class')).toBe(expected);
      expect(client.getAttribute('class')).toBe(expected);
      expect([...ssr.classList]).toEqual([...client.classList]);
      expect(ssr.outerHTML.match(/ class=/g)?.length ?? 0).toBe(expected ? 1 : 0);
    });

    it(`hydrates ${name} without warnings and keeps updating`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const container = document.createElement('div');
        container.innerHTML = renderToString(template(spread), { hydrate: true });
        const element = container.firstElementChild!;
        hydrate(template(spread), container);
        expect(container.firstElementChild).toBe(element);
        expect(element.getAttribute('class')).toBe(expected);
        expect(warn).not.toHaveBeenCalled();
        // A later render behaves exactly like the same update on the client.
        const next = { ...spread, class: 'n' };
        render(template(next), container);
        const client = document.createElement('div');
        render(template(spread), client);
        render(template(next), client);
        expect(element.getAttribute('class')).toBe(client.firstElementChild!.getAttribute('class'));
      } finally {
        warn.mockRestore();
      }
    });
  }
});
