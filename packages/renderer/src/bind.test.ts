import { describe, it, expect, vi } from 'vitest';
import { html, render, renderToString } from './cossack-html';
import { bind } from './directives';

// `bind(this, 'field')` — two-way binding. Reads the field for render and
// writes user edits back to it. These tests use a plain object as the
// "component": in a real app the `@State` setter triggers requestUpdate on
// assignment; here we just assert the field is written back.
describe('bind directive (two-way)', () => {
  it('renders the current field value into .value', () => {
    const container = document.createElement('div');
    const component = { email: 'a@b.com' };
    const tpl = () => html`<input .value=${bind(component, 'email')} />`;

    render(tpl(), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('a@b.com');
    // The .value binding must not leak into the DOM as an attribute.
    expect(input.hasAttribute('.value')).toBe(false);
    expect(input.hasAttribute('value')).toBe(false);
  });

  it('writes user input back to the field (input event)', () => {
    const container = document.createElement('div');
    const component = { email: '' };
    const tpl = () => html`<input .value=${bind(component, 'email')} />`;

    render(tpl(), container);
    const input = container.querySelector('input')!;
    input.value = 'typed@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(component.email).toBe('typed@example.com');
  });

  it('uses the change event for a checkbox and writes .checked back', () => {
    const container = document.createElement('div');
    const component = { active: false };
    const tpl = () => html`<input type="checkbox" .checked=${bind(component, 'active')} />`;

    render(tpl(), container);
    const input = container.querySelector('input')!;
    expect(input.checked).toBe(false);

    // User toggles the checkbox; checkboxes fire `change`.
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(component.active).toBe(true);
  });

  it('uses the change event for a select and writes .value back', () => {
    const container = document.createElement('div');
    const component = { color: '' };
    const tpl = () => html`<select .value=${bind(component, 'color')}>
      <option value="red">Red</option>
      <option value="blue">Blue</option>
    </select>`;

    render(tpl(), container);
    const select = container.querySelector('select')!;
    select.value = 'blue';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(component.color).toBe('blue');
  });

  it('re-applies a bound select value after dynamic options are committed', async () => {
    const container = document.createElement('div');
    const component = { color: 'blue' };
    const options = html`<option value="red">Red</option><option value="blue">Blue</option>`;
    const tpl = () => html`<select .value=${bind(component, 'color')}>${options}</select>`;

    render(tpl(), container);
    await Promise.resolve();

    expect(container.querySelector('select')!.value).toBe('blue');
  });

  it('re-applies a spread-bound select value after dynamic options are committed', async () => {
    const container = document.createElement('div');
    const component = { color: 'blue' };
    const options = html`<option value="red">Red</option><option value="blue">Blue</option>`;
    const tpl = () => html`<select ...=${{ '.value': bind(component, 'color') }}>${options}</select>`;

    render(tpl(), container);
    await Promise.resolve();

    expect(container.querySelector('select')!.value).toBe('blue');
  });

  it('updates the DOM when the field changes (render direction)', () => {
    const container = document.createElement('div');
    const component = { email: 'one@example.com' };
    const tpl = () => html`<input .value=${bind(component, 'email')} />`;

    render(tpl(), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('one@example.com');

    component.email = 'two@example.com';
    render(tpl(), container);
    expect(input.value).toBe('two@example.com');
  });

  it('does NOT clobber a user edit when the field is unchanged', () => {
    // Re-rendering with an unchanged field should leave the DOM alone — this
    // is the dirty-check, mirroring plain `.value` behavior so two-way
    // binding doesn't fight the user mid-keystroke.
    const container = document.createElement('div');
    const component = { email: 'initial@example.com' };
    const tpl = () => html`<input .value=${bind(component, 'email')} />`;

    render(tpl(), container);
    const input = container.querySelector('input')!;
    input.value = 'mid-edit@example.com';
    render(tpl(), container);
    expect(input.value).toBe('mid-edit@example.com');
  });

  it('does not clobber a user edit when the field is null/undefined (stable empty string)', () => {
    // Regression: the dirty-check normalized null/undefined to '' on write but
    // stored the raw value, so String(undefined) === 'undefined' !== '' on the
    // next render — the field was rewritten every render, clobbering edits.
    const container = document.createElement('div');
    const component: { email: string | null } = { email: null };
    const tpl = () => html`<input .value=${bind(component, 'email')} />`;

    render(tpl(), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('');

    // User starts typing into the empty field.
    input.value = 'mid-edit';
    // Re-render with the SAME null field: dirty-check must skip the write.
    render(tpl(), container);
    expect(input.value).toBe('mid-edit');

    // Same for undefined.
    component.email = undefined as unknown as null;
    render(tpl(), container);
    expect(input.value).toBe('mid-edit');
  });

  it('reads writeback from the bound element, not a bubbled child (currentTarget)', () => {
    // Regression: the writeback listener used e.target, which on a bubbled
    // event from a child is the child, not the bound element. We simulate a
    // custom element that wraps a native input and binds .value on the HOST.
    // The inner input dispatches `input`; e.target is the inner input, but
    // e.currentTarget is the host — the listener must read the host's .value.
    class InputHost extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        const inner = document.createElement('input');
        inner.type = 'text';
        root.appendChild(inner);
      }
    }
    if (!customElements.get('bind-input-host')) {
      customElements.define('bind-input-host', InputHost);
    }

    const container = document.createElement('div');
    const component = { value: 'initial' };
    // Bind .value onto the host. bindEventFor falls back to 'input' for the
    // custom element, so a writeback listener is attached on the host.
    const tpl = () => html`<bind-input-host .value=${bind(component, 'value')}></bind-input-host>`;
    render(tpl(), container);
    const host = container.querySelector('bind-input-host') as any;
    expect(host.value).toBe('initial');

    // The host's .value is what should be written back. Set it, then dispatch
    // a bubbled input event from the inner shadow input (whose own .value
    // differs). The listener must read currentTarget.value, not target.value.
    host.value = 'host-value';
    const inner = host.shadowRoot.querySelector('input') as any;
    inner.value = 'inner-value';
    const bubbled = new Event('input', { bubbles: true, composed: true });
    Object.defineProperty(bubbled, 'target', { value: inner });
    host.dispatchEvent(bubbled);

    // component.value must reflect the HOST's .value, not the inner input's.
    expect(component.value).toBe('host-value');
  });

  it('does not attach duplicate listeners across re-renders', () => {
    const container = document.createElement('div');
    const component = { email: '' };
    const tpl = () => html`<input .value=${bind(component, 'email')} />`;

    render(tpl(), container);
    render(tpl(), container);
    render(tpl(), container);
    const input = container.querySelector('input')!;

    const spy = vi.fn();
    // Patch the field setter so we can count how many times the listener
    // actually fires (a duplicate listener would fire multiple times).
    let writeCount = 0;
    Object.defineProperty(component, 'email', {
      get() { return (this as any)._email; },
      set(v) { writeCount++; (this as any)._email = v; },
      configurable: true,
    });

    input.value = 'dup@test.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    spy();
    expect(writeCount).toBe(1);
  });

  it('SSR emits the current field value', () => {
    const component = { email: 'ssr@example.com' };
    const template = html`<input .value=${bind(component, 'email')}>`;
    expect(renderToString(template)).toBe('<input value="ssr@example.com">');
  });

  it('SSR handles null/undefined field gracefully', () => {
    const component = { email: undefined };
    const template = html`<input .value=${bind(component, 'email')}>`;
    expect(renderToString(template)).toBe('<input>');
  });

  it('SSR emits checked for a true checkbox field', () => {
    const component = { active: true };
    const template = html`<input type="checkbox" .checked=${bind(component, 'active')}>`;
    expect(renderToString(template)).toBe('<input type="checkbox" checked>');
  });

  it('detaches the writeback listener when the part switches from bind() to a plain value', () => {
    // Regression: a conditional `.value=${cond ? bind(this,'x') : 'static'}`
    // must stop writing user edits into `x` once cond becomes false. Previously
    // the listener stayed attached and kept mutating the old field.
    //
    // We use a SINGLE template literal site (so the render cache reuses the
    // same part across re-renders) and toggle the value between bind() and a
    // plain string.
    const container = document.createElement('div');
    const component = { email: 'a@b.c' };
    const tpl = (useBind: boolean) =>
      html`<input .value=${useBind ? bind(component, 'email') : 'static'}>`;

    render(tpl(true), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('a@b.c');

    // Switch away from bind() on the SAME part (same template site → cached).
    render(tpl(false), container);
    const input2 = container.querySelector('input')!;
    expect(input2.value).toBe('static');

    // A user edit must NOT write back to the old component field.
    input2.value = 'changed-by-user';
    input2.dispatchEvent(new Event('input'));
    expect(component.email).toBe('a@b.c'); // not 'changed-by-user'
  });

  it('recreates the listener when the bound component/field changes', () => {
    // Regression: `.value=${bind(a,'x')}` then `.value=${bind(b,'y')}` on the
    // same part must write the edit to `b.y`, not the stale `a.x` captured by
    // the first listener. Uses one template site so the part is reused.
    const container = document.createElement('div');
    const a = { x: 'from-a' };
    const b = { y: 'from-b' };

    const tpl = (target: { x?: string; y?: string } | typeof a | typeof b) =>
      html`<input .value=${'x' in target ? bind(target, 'x') : bind(target, 'y')}>`;

    render(tpl(a), container);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('from-a');

    // Re-render binding to a different component + field on the same part.
    render(tpl(b), container);
    const input2 = container.querySelector('input')!;
    expect(input2.value).toBe('from-b');

    // User edit must write to b.y, not a.x.
    input2.value = 'edited';
    input2.dispatchEvent(new Event('input'));
    expect(b.y).toBe('edited');
    expect(a.x).toBe('from-a'); // untouched
  });
});
