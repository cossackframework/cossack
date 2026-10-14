import 'reflect-metadata';
import { beforeAll, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { component, css, CossackElement, html } from '@cossackframework/renderer';

const { registry } = vi.hoisted(() => ({ registry: {
  pages: {} as Record<string, unknown>, layouts: {} as Record<string, unknown>, loadings: {},
} }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {}, requirements: {}, environment: undefined }));

class Card extends CossackElement {
  static styles = css`.card { border: 1px solid #ccc; }`;
  render() { return html`<li class="card">${this.props.label}</li>`; }
}

@Page({ transport: 'http' })
class Shell extends Cossack {
  static styles = css`.shell { display: grid; }`;
  render() { return html`<div class="shell">${this.children}</div>`; }
}

@Page({ transport: 'http' })
class StyledPage extends Cossack {
  static styles = css`.page { color: #333; }`;
  render() {
    return html`<main class="page"><ul>${['a', 'b', 'c', 'd'].map((label) => component(Card, { label }))}</ul></main>`;
  }
}
registry.pages['/src/pages/index.ts'] = { default: StyledPage };
registry.layouts['/src/pages/layout.ts'] = { default: Shell };

let createApp: typeof import('../src/router').createApp;
beforeAll(async () => {
  ({ createApp } = await import('../src/router'));
});

it('emits each component style scope once in <head>, in first-use order', async () => {
  const response = await createApp().request('/', undefined, { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } });
  expect(response.status).toBe(200);
  const document = await response.text();
  const head = document.slice(0, document.indexOf('</head>'));
  const body = document.slice(document.indexOf('<body'));
  const scopes = [new Shell()._getStyleScopeId(), new StyledPage()._getStyleScopeId(), new Card()._getStyleScopeId()];
  const headScopes = [...head.matchAll(/<style data-cossack-style="([^"]+)">/g)].map((match) => match[1]);

  expect(headScopes).toEqual(scopes);
  expect(body).not.toContain('<style');
  expect(body.match(new RegExp(`<li data-cossack-scope="${scopes[2]}" class="card">`, 'g'))).toHaveLength(4);
});
