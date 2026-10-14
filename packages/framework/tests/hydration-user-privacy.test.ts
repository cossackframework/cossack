import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page, setPublicUserProjection } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

const { registry, session } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, any>, layouts: {} as Record<string, any>, loadings: {} },
  session: { user: undefined as Record<string, unknown> | undefined },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: () => Promise<void>) => {
  if (session.user) c.set('user', session.user);
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page({ transport: 'http' })
class Account extends Cossack { render() { return html`<main>account</main>`; } }
@Page()
class Layout extends Cossack { render() { return html`${this.children}`; } }
@Page({ transport: 'http' })
class Section extends Cossack { render() { return html`<section>${this.children}</section>`; } }
registry.pages['/src/pages/account/index.ts'] = { default: Account };
registry.layouts['/src/pages/layout.ts'] = { default: Layout };
registry.layouts['/src/pages/account/layout.ts'] = { default: Section };
const { createApp } = await import('../src/router');

const user = { id: 'u1', email: 'taras@example.com', name: 'Taras', passwordHash: 'argon2-SECRET-HASH' };
afterEach(() => { session.user = undefined; setPublicUserProjection(undefined); });

async function render(options: Parameters<typeof createApp>[0] = {}) {
  const response = await createApp(options).request('/account');
  expect(response.status).toBe(200);
  const body = await response.text();
  const json = body.match(/window\.__INITIAL_STATE__ = (.*?)<\/script>/s)![1]!;
  return { response, body, state: JSON.parse(json) };
}

describe('user data in the SSR hydration payload', () => {
  it('emits only the user id and marks the response private', async () => {
    session.user = user;
    const { response, body, state } = await render();
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('argon2-SECRET-HASH');
    expect(body).not.toContain('taras@example.com');
    expect(state.user).toEqual({ id: 'u1' });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('emits the user once, at the payload root, for the page, its layouts and the App', async () => {
    session.user = user;
    const { state } = await render({ publicUser: u => ({ name: (u as any).name }) });
    const json = JSON.stringify(state);
    expect(json.match(/"user":/g)).toHaveLength(1);
    expect(json.match(/"Taras"/g)).toHaveLength(1);
    expect(state.user).toEqual({ id: 'u1', name: 'Taras' });
    expect(state._layout_stack).toHaveLength(2);
    for (const component of [state, state._app_state, ...state._layout_stack.map((layout: any) => layout.state)]) {
      expect(component.metadata).not.toHaveProperty('user');
    }
  });

  it('leaves anonymous responses cacheable by policy', async () => {
    const { response, state } = await render();
    expect(state).not.toHaveProperty('user');
    expect(response.headers.get('Cache-Control')).toBeNull();
  });

  it('supports an explicit publicUser projection that always keeps the id', async () => {
    session.user = user;
    const { body, state } = await render({ publicUser: u => ({ name: (u as any).name, id: 'forged' }) });
    expect(state.user).toEqual({ id: 'u1', name: 'Taras' });
    expect(body).not.toContain('argon2-SECRET-HASH');
  });
});
