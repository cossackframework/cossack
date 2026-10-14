import { describe, it, expect } from 'vitest';
import { html, render, renderToString, component, nothing } from './cossack-html';
import { CossackElement } from './cossack-element';
import { css } from './css';
import { templateAnalysisStats } from './template-analysis';

describe('template analysis cache', () => {
  class Row extends CossackElement {
    static styles = css`.row { color: red; }`;
    declare label: string;
    render() { return html`<li class="row ${this.label}" title=${this.label}>${this.label}</li>`; }
  }
  const rows = (items: string[]) => html`<ul>${items.map((item) => html`<li class="a ${item}">${item}</li>`)}</ul>
    <ol>${items.map((label) => component(Row, { label } as any))}</ol>`;

  it('analyses each template strings array once per scope across SSR renders', () => {
    const items = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    renderToString(rows(['warm-up']));
    renderToString(rows(['warm-up']), { hydrate: true });
    const before = templateAnalysisStats.runs;
    for (let i = 0; i < 3; i++) {
      renderToString(rows(items));
      renderToString(rows(items), { hydrate: true });
    }
    expect(templateAnalysisStats.runs).toBe(before);
  });

  it('analyses a new strings array once, then reuses it on the client too', () => {
    const fresh = (v: string) => html`<p data-v=${v}>${v}</p>`;
    const before = templateAnalysisStats.runs;
    renderToString(fresh('a'));
    expect(templateAnalysisStats.runs).toBe(before + 1);
    const container = document.createElement('div');
    for (let i = 0; i < 5; i++) {
      const target = document.createElement('div');
      render(fresh(String(i)), target);
      container.appendChild(target);
    }
    renderToString(fresh('b'));
    expect(templateAnalysisStats.runs).toBe(before + 1);
    expect(container.textContent).toBe('01234');
  });

  it('checks nothing per render even though the attribute structure is cached', () => {
    const tpl = (v: unknown) => html`<div class="a ${v}" id="x"></div>`;
    expect(renderToString(tpl('b'))).toBe('<div class="a b" id="x"></div>');
    expect(renderToString(tpl(nothing))).toBe('<div id="x"></div>');
    expect(renderToString(tpl('c'))).toBe('<div class="a c" id="x"></div>');
  });
});
