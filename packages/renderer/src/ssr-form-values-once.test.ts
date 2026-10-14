import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('parse5', async (importOriginal) => {
  const actual = await importOriginal<typeof import('parse5')>();
  return {
    ...actual,
    parseFragment: ((...args: Parameters<typeof actual.parseFragment>) => {
      parseSpy.calls++;
      return actual.parseFragment(...args);
    }) as typeof actual.parseFragment,
  };
});

import { html, renderToString, component } from './cossack-html';
import { CossackElement } from './cossack-element';
import { bind } from './directives';

class Field extends CossackElement {
  declare value: string;
  render() { return html`<label><input .value=${this.value}></label>`; }
}
class Notes extends CossackElement {
  declare value: string;
  render() { return html`<textarea .value=${this.value}></textarea>`; }
}
class Choice extends CossackElement {
  declare value: string;
  render() { return html`<select .value=${this.value}><option>a</option><option>b</option></select>`; }
}
class SpreadInput extends CossackElement {
  declare props: Record<string, unknown>;
  render() { return html`<input class="x" ...=${this.props}>`; }
}

beforeEach(() => { parseSpy.calls = 0; });

describe('SSR form value serialization', () => {
  it('parses the output once for the outermost render, not per nested template', () => {
    const values = ['a', 'b', 'c', 'd', 'e'];
    const out = renderToString(html`<form>${values.map((value) => component(Notes, { value } as any))}${component(Choice, { value: 'b' } as any)}<p>${html`<textarea .value=${'f'}></textarea>`}</p></form>`);
    expect(parseSpy.calls).toBe(1);
    for (const value of [...values, 'f']) expect(out).toContain(`<textarea >${value}</textarea>`);
    expect(out).toContain('<option selected>b</option>');
    expect(out).not.toContain('.value');
  });

  it('still serializes hydratable output once', () => {
    const out = renderToString(html`<div>${component(Notes, { value: 'x' } as any)}${component(Notes, { value: 'y' } as any)}</div>`, { hydrate: true });
    expect(parseSpy.calls).toBe(1);
    expect(out).toContain("<textarea >x</textarea>");
  });

  it('emits input values directly without parsing', () => {
    const owner = { name: 'Ada' };
    const out = renderToString(html`<form>${['a', 'b'].map((value) => component(Field, { value } as any))}
      ${component(SpreadInput, { ".value": bind(owner, "name") } as any)}</form>`, { hydrate: true });
    expect(parseSpy.calls).toBe(0);
    expect(out).toContain('<input value="a">');
    expect(out).toContain('<input value="b">');
    expect(out).toContain('<input class="x" value="Ada">');
    expect(out).not.toContain('.value');
  });

  it('defers to the parser when a static value default must be replaced', () => {
    const out = renderToString(html`<input value="default" .value=${'live'}>`);
    expect(parseSpy.calls).toBe(1);
    expect(out).toBe('<input  value="live">');
  });
});
