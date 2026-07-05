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
});
