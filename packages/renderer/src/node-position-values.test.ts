import { describe, it, expect } from 'vitest';
import { html, render, renderToString, hydrate } from './cossack-html';
import { live, ifDefined, bind } from './directives';

const clientText = (value: unknown): string => {
  const container = document.createElement('div');
  render(html`<div>${value}</div>`, container);
  return container.querySelector('div')!.textContent!;
};

const ssrText = (value: unknown): string => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(html`<div>${value}</div>`);
  return container.querySelector('div')!.textContent!;
};

describe('non-renderable values in node position', () => {
  it('renders a plain object as text on the client without recursing', () => {
    expect(() => clientText({ a: 1 })).not.toThrow();
    expect(clientText({ a: 1 })).toBe('[object Object]');
  });

  it('renders a Promise as text on the client (forgotten await)', () => {
    const promise = Promise.resolve(1);
    expect(clientText(promise)).toBe('[object Promise]');
  });

  it('matches SSR output for plain objects and promises', () => {
    for (const value of [{ a: 1 }, Promise.resolve(1), { value: 'x' }, new Date(0)]) {
      expect(clientText(value)).toBe(ssrText(value));
    }
  });

  it('unwraps live(), ifDefined() and bind() in node position', () => {
    const owner = { name: 'Ada' };
    expect(clientText(live('x'))).toBe('x');
    expect(ssrText(live('x'))).toBe('x');
    expect(clientText(ifDefined('y'))).toBe('y');
    expect(ssrText(ifDefined('y'))).toBe('y');
    expect(clientText(ifDefined(undefined))).toBe('');
    expect(ssrText(ifDefined(undefined))).toBe('');
    expect(clientText(bind(owner, 'name'))).toBe('Ada');
    expect(ssrText(bind(owner, 'name'))).toBe('Ada');
  });

  it('renders functions as empty on both client and SSR', () => {
    const fn = () => 'secret source';
    expect(clientText(fn)).toBe('');
    expect(ssrText(fn)).toBe('');
  });

  it('updates object text in place across renders', () => {
    const container = document.createElement('div');
    render(html`<p>${{ a: 1 }}</p>`, container);
    render(html`<p>${'later'}</p>`, container);
    expect(container.textContent).toBe('later');
    render(html`<p>${live('again')}</p>`, container);
    expect(container.textContent).toBe('again');
  });

  it('hydrates objects in node position without throwing', () => {
    const value = { a: 1 };
    const container = document.createElement('div');
    container.innerHTML = renderToString(html`<p>${value}</p>`, { hydrate: true });
    const p = container.querySelector('p');
    expect(() => hydrate(html`<p>${value}</p>`, container)).not.toThrow();
    expect(container.querySelector('p')).toBe(p);
    expect(p!.textContent).toBe('[object Object]');
  });
});
