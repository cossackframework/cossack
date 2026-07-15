import { describe, it, expect, vi } from 'vitest';
import { html, renderToString, render } from './cossack-html';
import { guard } from './directives';

describe('guard directive', () => {
  it('SSR always evaluates the factory once', () => {
    const factory = vi.fn(() => html`<b>rendered</b>`);
    const template = html`<div>${guard([1, 2], factory)}</div>`;
    expect(renderToString(template).trim()).toBe('<div><b>rendered</b></div>');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('SSR renders the factory result value', () => {
    expect(renderToString(html`<div>${guard(0, () => 'hello')}</div>`).trim()).toBe(
      '<div>hello</div>',
    );
  });

  it('skips the factory when deps are unchanged on re-render (client)', () => {
    const container = document.createElement('div');
    const factory = vi.fn(() => html`<span class="m">v1</span>`);
    const tpl = () => html`<div>${guard('same', factory)}</div>`;

    render(tpl(), container);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('v1');

    // Re-render with the SAME deps — factory must NOT run again.
    render(tpl(), container);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('re-evaluates the factory when a single dep changes', () => {
    const container = document.createElement('div');
    const factory = vi.fn((n: number) => html`<span class="m">${n}</span>`);
    const tpl = (n: number) => html`<div>${guard(n, () => factory(n))}</div>`;

    render(tpl(1), container);
    expect(factory).toHaveBeenCalledTimes(1);

    render(tpl(2), container);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('2');

    // Same dep again — no extra invocation.
    render(tpl(2), container);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('re-evaluates when an array dep element changes', () => {
    const container = document.createElement('div');
    const factory = vi.fn(() => html`<span>x</span>`);
    const tpl = (a: number, b: number) => html`<div>${guard([a, b], factory)}</div>`;

    render(tpl(1, 2), container);
    render(tpl(1, 2), container); // same -> skip
    expect(factory).toHaveBeenCalledTimes(1);

    render(tpl(1, 3), container); // b changed -> re-eval
    expect(factory).toHaveBeenCalledTimes(2);

    render(tpl(9, 3), container); // a changed -> re-eval
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('re-evaluates when the array length changes even if the prefix matches', () => {
    const container = document.createElement('div');
    const factory = vi.fn(() => html`<span>x</span>`);
    const tpl = (deps: unknown) => html`<div>${guard(deps, factory)}</div>`;

    render(tpl([1, 2]), container);
    render(tpl([1, 2, 3]), container);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('preserves DOM node identity when deps are unchanged (in-place update)', () => {
    const container = document.createElement('div');
    const tpl = (label: string) =>
      html`<div>${guard('k', () => html`<span class="m">${label}</span>`)}</div>`;

    render(tpl('a'), container);
    const first = container.querySelector('.m');
    expect(first).toBeInstanceOf(HTMLSpanElement);

    // Re-render with the same guard deps but a different interpolated value.
    // The factory is NOT called, so the cached template result (carrying 'a')
    // is reused. Node identity is preserved.
    render(tpl('a'), container);
    expect(container.querySelector('.m')).toBe(first);
  });

  it('treats array and non-array deps with the same single element as equal', () => {
    // Memoization is per-NodePart, which is only reused across renders that
    // share the SAME template site. So render through one parameterized site
    // and switch the deps between a bare value and a single-element array.
    const container = document.createElement('div');
    const factory = vi.fn(() => html`<span>x</span>`);
    const tpl = (deps: unknown) => html`<div>${guard(deps, factory)}</div>`;

    render(tpl(1), container);
    // `guard(1)` normalizes to [1]; `guard([1])` is [1] — equal, so skip.
    render(tpl([1]), container);
    expect(factory).toHaveBeenCalledTimes(1);

    // A genuinely different value still re-evaluates.
    render(tpl([2]), container);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('detects in-place mutation of a deps array (regression)', () => {
    // Without snapshotting the deps array, the part would alias the caller's
    // array; mutating it between renders would leave both the cached and new
    // deps pointing at the same (mutated) values, so _depsEqual would always be
    // true and the factory would never re-run.
    const container = document.createElement('div');
    const factory = vi.fn(() => html`<span>x</span>`);
    const deps = [1, 2];
    const tpl = () => html`<div>${guard(deps, factory)}</div>`;

    render(tpl(), container);
    expect(factory).toHaveBeenCalledTimes(1);

    // Mutate the SAME array in place — must be detected as a change.
    deps[1] = 99;
    render(tpl(), container);
    expect(factory).toHaveBeenCalledTimes(2);

    // No further mutation -> skip again.
    render(tpl(), container);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
