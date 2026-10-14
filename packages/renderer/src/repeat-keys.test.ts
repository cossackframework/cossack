import { describe, it, expect, vi, afterEach } from 'vitest';
import { html, render, renderToString, hydrate, component } from './cossack-html';
import { CossackElement } from './cossack-element';
import { repeat } from './directives';

afterEach(() => vi.restoreAllMocks());

const list = (items: string[]) => html`<ul>${repeat(items, (item) => item, (item) => html`<li>${item}</li>`)}</ul>`;

describe('repeat() with duplicate keys', () => {
  it('does not grow the DOM across re-renders', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = document.createElement('div');
    for (let i = 0; i < 4; i++) {
      render(list(['a', 'a']), container);
      expect(container.querySelectorAll('li').length).toBe(2);
    }
    // Comment anchors are not leaked either.
    const ul = container.querySelector('ul')!;
    const comments = [...ul.childNodes].filter((n) => n.nodeType === Node.COMMENT_NODE).length;
    render(list(['a', 'a']), container);
    expect([...ul.childNodes].filter((n) => n.nodeType === Node.COMMENT_NODE).length).toBe(comments);
  });

  it('reuses every duplicate part in order and disposes the rest', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = document.createElement('div');
    render(list(['a', 'a', 'a']), container);
    const [first, second] = container.querySelectorAll('li');
    render(list(['a', 'a']), container);
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0]).toBe(first);
    expect(items[1]).toBe(second);
    render(list(['a', 'b', 'a']), container);
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b', 'a']);
  });

  it('tears down components rendered under dropped duplicate keys', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let live = 0;
    class Row extends CossackElement {
      connectedCallback() { live++; super.connectedCallback(); }
      disconnectedCallback() { live--; super.disconnectedCallback(); }
      render() { return html`<li>row</li>`; }
    }
    const rows = (items: string[]) => html`<ul>${repeat(items, (item) => item, () => component(Row))}</ul>`;
    const container = document.createElement('div');
    render(rows(['a', 'a', 'a']), container);
    render(rows(['a', 'a', 'a']), container);
    expect(live).toBe(3);
    render(rows(['a']), container);
    expect(live).toBe(1);
  });

  it('warns about duplicate keys in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = document.createElement('div');
    render(list(['a', 'b', 'a']), container);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate key'));
  });

  it('keeps duplicate keys working after hydration', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = document.createElement('div');
    container.innerHTML = renderToString(list(['a', 'a']), { hydrate: true });
    hydrate(list(['a', 'a']), container);
    render(list(['a', 'a']), container);
    render(list(['a', 'a']), container);
    expect(container.querySelectorAll('li').length).toBe(2);
  });
});
