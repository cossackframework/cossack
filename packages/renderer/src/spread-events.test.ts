import { describe, it, expect, vi } from 'vitest';
import { html, render, renderToString, nothing } from './cossack-html';
import { preventDefault } from './directives';

const click = (el: Element) => el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

describe('@event attribute and spread on the same element', () => {
  const tpl = (a: unknown, b: unknown) => html`<button @click=${a} ...=${{ '@click': b }}>x</button>`;

  it('runs each handler exactly once', () => {
    const a = vi.fn();
    const b = vi.fn();
    const container = document.createElement('div');
    render(tpl(a, b), container);
    click(container.querySelector('button')!);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate listeners across renders with fresh closures', () => {
    const calls: string[] = [];
    const container = document.createElement('div');
    for (let i = 0; i < 3; i++) {
      render(tpl(() => calls.push(`a${i}`), () => calls.push(`b${i}`)), container);
    }
    click(container.querySelector('button')!);
    expect(calls.sort()).toEqual(['a2', 'b2']);
  });

  it('removes only the spread handler when its key is dropped', () => {
    const a = vi.fn();
    const b = vi.fn();
    const container = document.createElement('div');
    render(html`<button @click=${a} ...=${{ '@click': b }}>x</button>`, container);
    render(html`<button @click=${a} ...=${{}}>x</button>`, container);
    click(container.querySelector('button')!);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('removes only the attribute handler when it becomes nothing', () => {
    const a = vi.fn();
    const b = vi.fn();
    const container = document.createElement('div');
    render(tpl(a, b), container);
    render(tpl(nothing, b), container);
    click(container.querySelector('button')!);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('keeps one spread listener per event across renders, including preventDefault()', () => {
    const container = document.createElement('div');
    const handler = vi.fn();
    for (let i = 0; i < 3; i++) {
      render(html`<form ...=${{ '@submit': preventDefault(handler) }}></form>`, container);
    }
    const form = container.querySelector('form')!;
    const event = new Event('submit', { cancelable: true });
    form.dispatchEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('spread with null/undefined', () => {
  for (const empty of [null, undefined]) {
    it(`treats ${empty} as an empty object and clears stale attributes and listeners`, () => {
      const handler = vi.fn();
      const container = document.createElement('div');
      const tpl = (props: unknown) => html`<div class="own" ...=${props}></div>`;
      render(tpl({ id: 'x', title: 't', '?hidden': true, class: 'extra', '@click': handler }), container);
      const div = container.querySelector('div')!;
      expect(div.id).toBe('x');
      render(tpl(empty), container);
      expect(div.hasAttribute('id')).toBe(false);
      expect(div.hasAttribute('title')).toBe(false);
      expect(div.hasAttribute('hidden')).toBe(false);
      expect(div.className).toBe('own');
      click(div);
      expect(handler).not.toHaveBeenCalled();
      expect(renderToString(tpl(empty))).toBe('<div class="own"></div>');
    });
  }
});
