import { describe, it, expect } from 'vitest';
import { html, render, renderToString, component, nothing } from './cossack-html';
import { CossackElement } from './cossack-element';
import { css } from './css';
import { analyzeTemplate, getTemplateAnalysis, templateAnalysisStats } from './template-analysis';
import { ifDefined, live } from './directives';

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

  it('shares one frozen analysis that renders with any values leave unchanged', () => {
    const tpl = (cls: unknown, title: unknown, spread: unknown, text: unknown) => html`<div class="a ${cls}" title=${title} ...=${spread}>
      <input value="d" .value=${text}><textarea .value=${text}></textarea><b ?hidden=${cls}>${text}</b></div>`;
    const variants: [unknown, unknown, unknown, unknown][] = [
      ['b', 't', { class: 'merged', id: 'x' }, 'one'],
      [nothing, nothing, nothing, ''],
      [false, ifDefined(undefined), { '.value': 'v', '?open': true }, ['a', html`<i>${1}</i>`]],
      [live('c'), live('t'), null, 0],
    ];
    const { strings } = tpl(...variants[0]);
    for (const values of variants) {
      renderToString(tpl(...values));
      renderToString(tpl(...values), { hydrate: true });
      render(tpl(...values), document.createElement('div'));
    }
    const cached = getTemplateAnalysis(strings);
    expect(getTemplateAnalysis(strings)).toBe(cached);
    expect(cached).toEqual(analyzeTemplate(strings));
    expect(Object.isFrozen(cached)).toBe(true);
    expect(Object.isFrozen(cached.strings)).toBe(true);
    expect(Object.isFrozen(cached.bindings)).toBe(true);
    expect(cached.bindings.every((binding) => Object.isFrozen(binding))).toBe(true);
    expect(Object.isFrozen(cached.attributeGroups)).toBe(true);
    const groups = cached.attributeGroups.filter((group) => group !== undefined);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((group) => Object.isFrozen(group) && Object.isFrozen(group!.indices))).toBe(true);
    expect(() => { (cached.bindings as unknown[]).push({ kind: 'node' }); }).toThrow(TypeError);
  });
});
