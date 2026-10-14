import { describe, it, expect, vi } from 'vitest';
import { html, render, renderToString, hydrate } from './cossack-html';
import { live, bind } from './directives';

describe('camelCase property bindings', () => {
  it('sets .innerHTML, .tabIndex and .textContent with their original case', () => {
    const container = document.createElement('div');
    render(html`<div class="a" .innerHTML=${'<b>bold</b>'}></div><span .tabIndex=${5} .textContent=${'text'}></span>`, container);
    const div = container.querySelector('div')!;
    const span = container.querySelector('span')!;
    expect(div.querySelector('b')!.textContent).toBe('bold');
    expect(span.tabIndex).toBe(5);
    expect(span.textContent).toBe('text');
    expect((div as any).innerhtml).toBeUndefined();
    expect(div.getAttributeNames()).toEqual(['class']);
    // tabIndex reflects to the real attribute; no binding markers remain.
    expect(span.getAttributeNames()).toEqual(['tabindex']);
  });

  it('sets a camelCase custom element property', () => {
    const container = document.createElement('div');
    const data = { rows: [1, 2] };
    render(html`<x-grid .rowData=${data}></x-grid>`, container);
    const grid = container.querySelector('x-grid') as any;
    expect(grid.rowData).toBe(data);
    expect(grid.rowdata).toBeUndefined();
  });

  it('updates camelCase properties on re-render and after hydration', () => {
    const tpl = (n: number) => html`<span .tabIndex=${n}></span>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(tpl(1), { hydrate: true });
    hydrate(tpl(2), container);
    const span = container.querySelector('span')!;
    expect(span.tabIndex).toBe(2);
    render(tpl(3), container);
    expect(span.tabIndex).toBe(3);
  });

  it('keeps camelCase event names', () => {
    const container = document.createElement('div');
    const handler = vi.fn();
    render(html`<div @myEvent=${handler}></div>`, container);
    const div = container.querySelector('div')!;
    div.dispatchEvent(new Event('myEvent'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(div.getAttributeNames()).toEqual([]);
  });

  it('SSR emits nothing for properties without an attribute equivalent', () => {
    expect(renderToString(html`<div .innerHTML=${'<b>x</b>'} .tabIndex=${5} .textContent=${'t'} .rowData=${{ a: 1 }}></div>`))
      .toBe('<div></div>');
    expect(renderToString(html`<div id="a" .foo=${'bar'} title="t"></div>`)).toBe('<div id="a" title="t"></div>');
  });

  it('SSR keeps .value and boolean properties', () => {
    expect(renderToString(html`<input .value=${'v'} .checked=${true} .disabled=${false}>`)).toBe('<input value="v" checked>');
    expect(renderToString(html`<input .checked=${live(true)} .indeterminate=${true}>`)).toBe('<input checked>');
    expect(renderToString(html`<input type="checkbox" .checked=${bind({ on: true }, 'on')}>`)).toBe('<input type="checkbox" checked>');
  });

  it('SSR spread drops properties without an attribute equivalent', () => {
    expect(renderToString(html`<div ...=${{ '.innerHTML': '<b>x</b>', '.tabIndex': 1, id: 'a', '.hidden': true }}></div>`))
      .toBe('<div id="a" hidden></div>');
  });
});
