import { describe, it, expect, vi } from 'vitest';
import { html, renderToString, render } from './cossack-html';
import { repeat, classMap, styleMap, key } from './directives';

describe('Directives', () => {
  it('repeat renders items', () => {
    const items = [
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ];
    const template = html`<ul>
      ${repeat(
        items,
        (i) => i.id,
        (i) => html`<li>${i.text}</li>`,
      )}
    </ul>`;
    expect(renderToString(template).trim()).toBe('<ul><li>A</li><li>B</li></ul>');
  });

  it('classMap generates class string', () => {
    const classes = { foo: true, bar: false, baz: true };
    expect(classMap(classes)).toBe('foo baz');
  });

  it('styleMap generates style string', () => {
    const styles = { color: 'red', 'font-size': '12px', display: null };
    expect(styleMap(styles)).toBe('color:red;font-size:12px');
  });

  it('ref callback is called', () => {
    const container = document.createElement('div');
    const spy = vi.fn();

    const template = html`<div ref="${spy}"></div>`;
    render(template, container);

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
  });

  it('repeat handles keyed updates (simulated)', () => {
    const items = [{ id: 1, text: 'A' }];
    const template1 = html`${repeat(
      items,
      (i) => i.id,
      (i) => i.text,
    )}`;

    const container = document.createElement('div');
    render(template1, container);
    expect(container.textContent).toBe('A');

    const items2 = [
      { id: 2, text: 'B' },
      { id: 1, text: 'A-Upd' },
    ];
    const template2 = html`${repeat(
      items2,
      (i) => i.id,
      (i) => i.text,
    )}`;
    render(template2, container);
    expect(container.textContent).toBe('BA-Upd');
  });

  it('key is transparent in SSR', () => {
    const template = html`<div>${key('x', html`<b>hi</b>`)}</div>`;
    expect(renderToString(template).trim()).toBe('<div><b>hi</b></div>');
  });

  it('key rebuilds subtree when key changes', () => {
    const container = document.createElement('div');
    // Reuse the same `html` tagged template across renders so the engine
    // would normally take the in-place update path (cache hit). `key` must
    // force a rebuild when the key changes, producing a new DOM node.
    const tpl = (k: string) => html`<div>${key(k, html`<span class="marker">child</span>`)}</div>`;

    render(tpl('a'), container);
    const first = container.querySelector('.marker');
    expect(first).toBeInstanceOf(HTMLSpanElement);

    // Same key -> in-place update, same node identity preserved.
    render(tpl('a'), container);
    expect(container.querySelector('.marker')).toBe(first);

    // New key -> rebuild, new node identity.
    render(tpl('b'), container);
    const rebuilt = container.querySelector('.marker');
    expect(rebuilt).not.toBe(first);
    expect(container.textContent).toContain('child');
  });

  it('key handles undefined keys without infinite rebuild', () => {
    const container = document.createElement('div');
    const tpl = () => html`<div>${key(undefined, html`<span class="m">x</span>`)}</div>`;

    render(tpl(), container);
    const first = container.querySelector('.m');
    render(tpl(), container);
    // Same key (undefined) -> no rebuild, same node.
    expect(container.querySelector('.m')).toBe(first);
  });
});
