// tests/bind.test.ts
//
// Verifies the `bind()` directive works when routed through `component()`
// (i.e. via the `...=${rest}` spread → SpreadPart), not just the direct
// `.value="${bind(...)}"` path. Also covers dot-path nested state.
import { describe, it, expect } from 'vitest';
import { html, renderToString, render, bind, live } from '../src/index';

describe('bind() via spread (component() props)', () => {
  it('SSR renders the field value, not "[object Object]"', () => {
    // Simulates component(Input, { '.value': bind(this, 'name') }) — the
    // BindResult reaches SpreadPart via the ...=${rest} spread.
    const component = { name: 'Alice' };
    const tpl = html`<input ...=${{ '.value': bind(component, 'name') }} />`;
    const out = renderToString(tpl);
    expect(out).toContain('value="Alice"');
    expect(out).not.toContain('[object Object]');
  });

  it('SSR omits the value attribute when the field is null/undefined', () => {
    // Consistent with the renderer's null/undefined handling elsewhere.
    const component = { name: undefined };
    const tpl = html`<input ...=${{ '.value': bind(component, 'name') }} />`;
    const out = renderToString(tpl);
    expect(out).not.toContain('[object Object]');
    expect(out).not.toContain('value=');
  });

  it('SSR renders .checked as a bare presence attribute when truthy', () => {
    const component = { active: true };
    const tpl = html`<input ...=${{ '.checked': bind(component, 'active') }} />`;
    const out = renderToString(tpl);
    expect(out).toContain('checked');
    expect(out).not.toContain('checked="');
  });

  it('SSR omits .checked when the field is falsy', () => {
    const component = { active: false };
    const tpl = html`<input ...=${{ '.checked': bind(component, 'active') }} />`;
    const out = renderToString(tpl);
    expect(out).not.toContain('checked');
  });

  it('SSR renders other boolean-ish attrs (.hidden/.autofocus) as presence attrs via spread', () => {
    // Regression for the boolean-attr list asymmetry between the spread and
    // direct SSR paths — .hidden/.autofocus must serialize the same way.
    const tpl = html`<input ...=${{ '.hidden': true, '.autofocus': true }} />`;
    const out = renderToString(tpl);
    expect(out).toContain('hidden');
    expect(out).toContain('autofocus');
    expect(out).not.toContain('hidden="');
    expect(out).not.toContain('autofocus="');
  });

  it('SSR omits boolean-ish attrs when falsy via spread', () => {
    const tpl = html`<input ...=${{ '.hidden': false, '.disabled': false }} />`;
    const out = renderToString(tpl);
    expect(out).not.toContain('hidden');
    expect(out).not.toContain('disabled');
  });

  it('a plain (non-bind) .value still does a plain property assignment', () => {
    // Regression: non-BindResult values must keep working through the spread.
    const tpl = html`<input ...=${{ '.value': 'static-value' }} />`;
    const out = renderToString(tpl);
    expect(out).toContain('value="static-value"');
  });
});

describe('bind() with dot-path nested state', () => {
  it('SSR resolves a nested dot-path via the spread', () => {
    const component = { address: { street: '123 Main' } };
    const tpl = html`<input ...=${{ '.value': bind(component, 'address.street') }} />`;
    const out = renderToString(tpl);
    expect(out).toContain('value="123 Main"');
  });

  it('SSR resolves a nested dot-path via the direct .value binding', () => {
    const component = { address: { street: '456 Oak' } };
    const tpl = html`<input .value="${bind(component, 'address.street')}" />`;
    const out = renderToString(tpl);
    expect(out).toContain('value="456 Oak"');
  });

  it('SSR omits the value for a missing nested path (no throw)', () => {
    const component = { address: {} };
    const tpl = html`<input ...=${{ '.value': bind(component, 'address.missing') }} />`;
    const out = renderToString(tpl);
    expect(out).not.toContain('[object Object]');
    expect(out).not.toContain('value=');
  });
});

describe('bind() client writeback via spread', () => {
  it('typing in the input writes back to the component field', () => {
    const host = document.createElement('div');
    const component: any = { name: 'Initial' };
    const tpl = html`<input ...=${{ '.value': bind(component, 'name') }} />`;
    render(tpl, host);
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Initial');

    // Simulate user typing.
    input.value = 'Updated';
    input.dispatchEvent(new Event('input'));
    expect(component.name).toBe('Updated');
  });

  it('writing back resolves a nested dot-path', () => {
    const host = document.createElement('div');
    const component: any = { address: { street: 'Old' } };
    const tpl = html`<input ...=${{ '.value': bind(component, 'address.street') }} />`;
    render(tpl, host);
    const input = host.querySelector('input') as HTMLInputElement;

    input.value = 'New';
    input.dispatchEvent(new Event('input'));
    expect(component.address.street).toBe('New');
  });

  it('a state change re-renders the input value', () => {
    const host = document.createElement('div');
    const component: any = { name: 'Before' };
    const tpl = () => html`<input ...=${{ '.value': bind(component, 'name') }} />`;
    render(tpl(), host);
    const input = host.querySelector('input') as HTMLInputElement;

    component.name = 'After';
    render(tpl(), host);
    expect(input.value).toBe('After');
  });

  it('.checked writeback via spread toggles the field', () => {
    const host = document.createElement('div');
    const component: any = { active: false };
    const tpl = html`<input type="checkbox" ...=${{ '.checked': bind(component, 'active') }} />`;
    render(tpl, host);
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.checked).toBe(false);

    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(component.active).toBe(true);
  });
});

describe('live() via spread (component() props)', () => {
  it('SSR renders the inner value, not "[object Object]"', () => {
    // Simulates component(Input, { '.value': live('Hello') }).
    const tpl = html`<input ...=${{ '.value': live('Hello') }} />`;
    const out = renderToString(tpl);
    expect(out).toContain('value="Hello"');
    expect(out).not.toContain('[object Object]');
  });

  it('SSR omits the value when the inner value is null/undefined', () => {
    const tpl = html`<input ...=${{ '.value': live(null) }} />`;
    const out = renderToString(tpl);
    expect(out).not.toContain('[object Object]');
    expect(out).not.toContain('value=');
  });

  it('SSR renders .checked as a bare presence attribute when truthy', () => {
    const tpl = html`<input ...=${{ '.checked': live(true) }} />`;
    const out = renderToString(tpl);
    expect(out).toContain('checked');
    expect(out).not.toContain('checked="');
  });

  it('SSR omits .checked when the inner value is falsy', () => {
    const tpl = html`<input ...=${{ '.checked': live(false) }} />`;
    const out = renderToString(tpl);
    expect(out).not.toContain('checked');
  });

  it('writes the value when the live DOM differs', () => {
    const host = document.createElement('div');
    const tpl = (v: string) => html`<input ...=${{ '.value': live(v) }} />`;
    render(tpl('A'), host);
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('A');

    // Re-render with a new value — DOM differs, so it writes.
    render(tpl('B'), host);
    expect(input.value).toBe('B');
  });

  it('does NOT clobber a user edit when the live DOM already matches the target', () => {
    const host = document.createElement('div');
    const tpl = (v: string) => html`<input ...=${{ '.value': live(v) }} />`;
    render(tpl('A'), host);
    const input = host.querySelector('input') as HTMLInputElement;

    // User is mid-edit; the live DOM already shows what live() targets.
    input.value = 'A-edited';
    // live('A-edited') — live DOM matches, so no write (no clobber).
    render(tpl('A-edited'), host);
    expect(input.value).toBe('A-edited');
  });

  it('respects a change to the target value even if the last-rendered value was the same', () => {
    // live() compares against the DOM, not the last render — so if the DOM was
    // changed independently, a re-render to the same target still corrects it.
    const host = document.createElement('div');
    const tpl = (v: string) => html`<input ...=${{ '.value': live(v) }} />`;
    render(tpl('A'), host);
    const input = host.querySelector('input') as HTMLInputElement;

    // Externally mutate the DOM (simulating a non-bind user/script change).
    input.value = 'tampered';
    // Re-render with the original target — DOM differs, so live() writes.
    render(tpl('A'), host);
    expect(input.value).toBe('A');
  });

  it('.checked via spread toggles from the inner value', () => {
    const host = document.createElement('div');
    const tpl = (v: boolean) => html`<input type="checkbox" ...=${{ '.checked': live(v) }} />`;
    render(tpl(false), host);
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.checked).toBe(false);

    render(tpl(true), host);
    expect(input.checked).toBe(true);
  });
});

describe('wrapper directives on non-value/checked properties via spread', () => {
  // Regression: a BindResult/LiveResult on a non-form property (.disabled,
  // .data-*) must unwrap rather than set a raw [object Object] on the DOM.

  it('bind() on a non-form property unwraps to the field value (client)', () => {
    const host = document.createElement('div');
    const component: any = { flag: true };
    const tpl = html`<input ...=${{ '.disabled': bind(component, 'flag') }} />`;
    render(tpl, host);
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    // Not the raw wrapper object.
    expect(input.disabled).not.toBe(component);
  });

  it('live() on a non-form property unwraps to the inner value (client)', () => {
    const host = document.createElement('div');
    const tpl = html`<input ...=${{ '.disabled': live(true) }} />`;
    render(tpl, host);
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('bind() on a non-form property renders the field value via SSR', () => {
    const component = { hidden: true };
    const tpl = html`<input ...=${{ '.hidden': bind(component, 'hidden') }} />`;
    const out = renderToString(tpl);
    // boolean-ish attr — presence when truthy.
    expect(out).toContain('hidden');
    expect(out).not.toContain('[object Object]');
  });
});
