import { describe, it, expect } from 'vitest';
import { html, render, renderToString, hydrate, type TemplateResult } from './cossack-html';
import { live } from './directives';

const ssrAttr = (tpl: TemplateResult, name: string, hydrateMarkers: boolean) => {
  const container = document.createElement('div');
  const out = renderToString(tpl, { hydrate: hydrateMarkers });
  container.innerHTML = out;
  return { out, value: container.firstElementChild!.getAttribute(name) };
};

const clientAttr = (tpl: TemplateResult, name: string) => {
  const container = document.createElement('div');
  render(tpl, container);
  return container.firstElementChild!.getAttribute(name);
};

const expectParity = (tpl: TemplateResult, name: string, expected: string | null) => {
  for (const hydrateMarkers of [false, true]) {
    const { out, value } = ssrAttr(tpl, name, hydrateMarkers);
    expect(out).not.toContain('<!--');
    expect(value).toBe(expected);
  }
  expect(clientAttr(tpl, name)).toBe(expected);
};

describe('multi-expression attribute values', () => {
  it('render null/undefined as empty and false as "false" on SSR and client', () => {
    expectParity(html`<div class="a ${null} b ${false} c ${undefined} d ${0}"></div>`, 'class', 'a  b false c  d 0');
  });

  it('update to the same text the SSR would render', () => {
    const tpl = (x: unknown, y: unknown) => html`<div class="a ${x} b ${y}"></div>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(tpl(null, 'on'), { hydrate: true });
    hydrate(tpl(null, 'on'), container);
    const div = container.firstElementChild!;
    expect(div.getAttribute('class')).toBe('a  b on');
    render(tpl(undefined, live('x')), container);
    expect(div.getAttribute('class')).toBe('a  b x');
  });
});

describe('arrays and templates in attribute position', () => {
  it('render arrays the same on SSR and client, without markers', () => {
    expectParity(html`<div title="${['a', 'b']}"></div>`, 'title', 'a,b');
    expectParity(html`<div title=${['a', 'b']}></div>`, 'title', 'a,b');
    expectParity(html`<div class="x ${['a', 'b']} y"></div>`, 'class', 'x a,b y');
  });

  it('never inject template markup into an attribute value', () => {
    const inner = html`<b title="q">"x"</b>`;
    expectParity(html`<div title="${inner}" id="after"></div>`, 'title', '[object Object]');
    expectParity(html`<div title="${inner}" id="after"></div>`, 'id', 'after');
    expectParity(html`<div class="a ${inner}"></div>`, 'class', 'a [object Object]');
  });

  it('render functions as empty in attribute values', () => {
    const fn = () => 'source';
    expectParity(html`<div data-x="${fn}"></div>`, 'data-x', '');
    expectParity(html`<div data-x="a ${fn} b"></div>`, 'data-x', 'a  b');
  });
});
