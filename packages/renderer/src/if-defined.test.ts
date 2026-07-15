import { describe, it, expect } from 'vitest';
import { html, renderToString, render } from './cossack-html';
import { ifDefined } from './directives';

describe('ifDefined directive', () => {
  describe('SSR', () => {
    it('omits the attribute when the value is undefined', () => {
      const template = html`<a href="${ifDefined(undefined)}">link</a>`;
      expect(renderToString(template).trim()).toBe('<a>link</a>');
    });

    it('renders a defined value', () => {
      const template = html`<a href="${ifDefined('/home')}">link</a>`;
      expect(renderToString(template).trim()).toBe('<a href="/home">link</a>');
    });

    it('renders null (not omitted)', () => {
      const template = html`<div data-x="${ifDefined(null)}">x</div>`;
      expect(renderToString(template).trim()).toBe('<div data-x="null">x</div>');
    });

    it('renders false as the literal string "false"', () => {
      const template = html`<div data-flag="${ifDefined(false)}">x</div>`;
      expect(renderToString(template).trim()).toBe('<div data-flag="false">x</div>');
    });

    it('renders 0 and empty string', () => {
      expect(renderToString(html`<div data-n="${ifDefined(0)}">x</div>`).trim()).toBe(
        '<div data-n="0">x</div>',
      );
      expect(renderToString(html`<div data-e="${ifDefined('')}">x</div>`).trim()).toBe(
        '<div data-e="">x</div>',
      );
    });

    it('escapes the value', () => {
      const template = html`<div data-x="${ifDefined('<b>')}">x</div>`;
      expect(renderToString(template).trim()).toBe('<div data-x="&lt;b&gt;">x</div>');
    });
  });

  describe('client', () => {
    it('omits the attribute when undefined', () => {
      const container = document.createElement('div');
      render(html`<a href="${ifDefined(undefined)}">link</a>`, container);
      const a = container.querySelector('a')!;
      expect(a.hasAttribute('href')).toBe(false);
    });

    it('renders a defined value', () => {
      const container = document.createElement('div');
      render(html`<a href="${ifDefined('/home')}">link</a>`, container);
      expect(container.querySelector('a')!.getAttribute('href')).toBe('/home');
    });

    it('renders false as "false" (not dropped)', () => {
      const container = document.createElement('div');
      render(html`<div data-flag="${ifDefined(false)}">x</div>`, container);
      expect(container.querySelector('div')!.getAttribute('data-flag')).toBe('false');
    });

    it('removes the attribute when transitioning to undefined on re-render', () => {
      const container = document.createElement('div');
      const tpl = (url: string | undefined) => html`<a href="${ifDefined(url)}">link</a>`;

      render(tpl('/first'), container);
      const a = container.querySelector('a')!;
      expect(a.getAttribute('href')).toBe('/first');

      render(tpl(undefined), container);
      expect(a.hasAttribute('href')).toBe(false);

      // And re-applies when defined again on the same element/node.
      render(tpl('/back'), container);
      expect(a.getAttribute('href')).toBe('/back');
    });

    it('updates the attribute value across renders', () => {
      const container = document.createElement('div');
      const tpl = (url: string) => html`<a href="${ifDefined(url)}">link</a>`;
      render(tpl('/a'), container);
      render(tpl('/b'), container);
      expect(container.querySelector('a')!.getAttribute('href')).toBe('/b');
    });
  });

  describe('via spread binding', () => {
    it('omits on undefined and renders otherwise', () => {
      const container = document.createElement('div');
      render(html`<a ...=${{ href: ifDefined('/x') }}>link</a>`, container);
      expect(container.querySelector('a')!.getAttribute('href')).toBe('/x');

      render(html`<a ...=${{ href: ifDefined(undefined) }}>link</a>`, container);
      expect(container.querySelector('a')!.hasAttribute('href')).toBe(false);
    });

    it('renders false as "false" via spread', () => {
      const container = document.createElement('div');
      render(html`<div ...=${{ 'data-flag': ifDefined(false) }}>x</div>`, container);
      expect(container.querySelector('div')!.getAttribute('data-flag')).toBe('false');
    });

    it('SSR spread omits on undefined', () => {
      const template = html`<a ...=${{ href: ifDefined(undefined), title: ifDefined('hi') }}>link</a>`;
      expect(renderToString(template).trim()).toBe('<a title="hi">link</a>');
    });
  });
});
