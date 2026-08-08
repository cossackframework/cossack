import { describe, it, expect } from 'vitest';
import { html, render } from './cossack-html';
import { live } from './directives';

// These tests exercise the CLIENT-SIDE behavior of `live`, which was
// previously uncovered (only SSR tests existed in ssr-fixes.test.ts).
//
// Lit semantics (the source of truth for this directive):
//  - Plain `.value=${x}`: dirty-check against the LAST value the part
//    committed. Re-rendering with the same x does NOT overwrite the DOM, so
//    a user's in-progress edit is preserved.
//  - `live(x)`: compare against the LIVE DOM. If the DOM differs from x, the
//    write happens — so `live` is the opt-in for forcing the DOM back to the
//    bound value (e.g. a Reset button), and it WILL overwrite a user edit.
// The two directives differ in WHICH value they compare against; that is the
// whole point of `live`.
describe('live directive (client-side)', () => {
  it('plain .value preserves a user edit on re-render with the same bound value', () => {
    const container = document.createElement('div');
    const tpl = (v: string) => html`<input .value=${v} />`;

    render(tpl('initial'), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('initial');

    // Simulate the user typing.
    input.value = 'user-typed';

    // Re-render with the SAME bound value: plain binding skips (dirty check).
    render(tpl('initial'), container);
    expect(input.value).toBe('user-typed');
  });

  it('plain .value DOES update when the bound value changes', () => {
    const container = document.createElement('div');
    const tpl = (v: string) => html`<input .value=${v} />`;

    render(tpl('a'), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('a');

    render(tpl('b'), container);
    expect(input.value).toBe('b');
  });

  it('plain select .value preserves a manual selection on an unrelated re-render', () => {
    const container = document.createElement('div');
    const tpl = (value: string, label: string) => html`<label>${label}<select .value=${value}>
      <option value="a">A</option>
      <option value="b">B</option>
    </select></label>`;

    render(tpl('a', 'first'), container);
    const select = container.querySelector('select')!;
    select.value = 'b';

    render(tpl('a', 'updated'), container);
    expect(select.value).toBe('b');
  });

  it('live(.value) forces the DOM back to the bound value, overwriting a user edit', () => {
    const container = document.createElement('div');
    const tpl = (v: string) => html`<input .value=${live(v)} />`;

    render(tpl('initial'), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('initial');

    // Simulate the user typing.
    input.value = 'user-typed';

    // Re-render with the SAME bound value: live() compares against the live
    // DOM ('user-typed') !== 'initial', so it writes — resetting the field.
    // This is the documented behavior and the reason `live` is the opt-in.
    render(tpl('initial'), container);
    expect(input.value).toBe('initial');
  });

  it('live(.value) updates when the bound value changes', () => {
    const container = document.createElement('div');
    const tpl = (v: string) => html`<input .value=${live(v)} />`;

    render(tpl('a'), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('a');

    render(tpl('b'), container);
    expect(input.value).toBe('b');
  });

  it('live(.value) does NOT write when the DOM already matches the bound value', () => {
    // This is the "skip redundant write" case: if the DOM already equals x,
    // live() leaves it alone (no spurious reset / cursor jump).
    const container = document.createElement('div');
    const tpl = (v: string) => html`<input .value=${live(v)} />`;

    render(tpl('synced'), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('synced');

    // DOM already equals 'synced' — live() must skip the write.
    let writeCount = 0;
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', {
      get: desc.get!,
      set(v) {
        writeCount++;
        desc.set!.call(this, v);
      },
      configurable: true,
    });

    render(tpl('synced'), container);
    expect(writeCount).toBe(0);
    expect(input.value).toBe('synced');
  });

  it('plain .value on a textarea preserves a user edit', () => {
    const container = document.createElement('div');
    const tpl = (v: string) => html`<textarea .value=${v}></textarea>`;

    render(tpl('hello'), container);
    const ta = container.querySelector('textarea')!;
    expect(ta.value).toBe('hello');

    ta.value = 'edited';
    render(tpl('hello'), container);
    expect(ta.value).toBe('edited');
  });

  it('plain .checked preserves a user toggle on re-render with the same bound value', () => {
    const container = document.createElement('div');
    const tpl = (v: boolean) => html`<input type="checkbox" .checked=${v} />`;

    render(tpl(false), container);
    const input = container.querySelector('input')!;
    expect(input.checked).toBe(false);

    // User clicks the checkbox.
    input.checked = true;

    render(tpl(false), container);
    expect(input.checked).toBe(true);
  });

  it('live(.checked) forces the DOM back to the bound value', () => {
    const container = document.createElement('div');
    const tpl = (v: boolean) => html`<input type="checkbox" .checked=${live(v)} />`;

    render(tpl(false), container);
    const input = container.querySelector('input')!;
    expect(input.checked).toBe(false);

    // User clicks the checkbox.
    input.checked = true;

    // Re-render with the SAME bound value (false): live() compares against
    // the live DOM (true) !== false, so it writes — resetting the checkbox.
    render(tpl(false), container);
    expect(input.checked).toBe(false);
  });

  it('live(.checked) updates when the bound value changes', () => {
    const container = document.createElement('div');
    const tpl = (v: boolean) => html`<input type="checkbox" .checked=${live(v)} />`;

    render(tpl(false), container);
    const input = container.querySelector('input')!;
    expect(input.checked).toBe(false);

    render(tpl(true), container);
    expect(input.checked).toBe(true);
  });

  it('plain non-form property binding always assigns when the value changes', () => {
    const container = document.createElement('div');
    // .title on a div is a real property; live() has no special meaning here.
    const tpl = (v: string) => html`<div .title=${v}></div>`;

    render(tpl('a'), container);
    const div = container.querySelector('div')!;
    expect(div.title).toBe('a');

    render(tpl('b'), container);
    expect(div.title).toBe('b');
  });
});
