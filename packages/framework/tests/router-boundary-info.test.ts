// @vitest-environment node
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { ServerFailure } from '../src/router';

const { registry, policy } = vi.hoisted(() => ({
  registry: { pages: {} as Record<string, unknown>, layouts: {} as Record<string, unknown>, loadings: {} },
  policy: { fail: false, deny: false, errorPageFails: false, errorGuardFails: false, ran: 0 },
}));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (c: any, next: any) => {
  policy.ran++;
  c.header('Cache-Control', 'public, max-age=600');
  if (policy.fail) throw new Error('PRIVATE_MIDDLEWARE_SENTINEL');
  if (policy.deny) throw Object.assign(new Error('PRIVATE_DENIAL_SENTINEL'), { authorizationCode: 'COSSACK_AUTH_FORBIDDEN' });
  await next();
}] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

/** What the page was told, written so a test can read it back from the markup. */
class Told extends Cossack {
  told() {
    const info = this.boundary;
    return html`<p data-told>${info ? `${info.type}|${info.status}|${info.requestId ?? 'none'}` : 'nothing'}</p>`;
  }
}
@Page({ transport: 'http' })
class Home extends Told { render() { return html`<main>home</main>${this.told()}`; } }
@Page({ transport: 'http' })
class Broken extends Cossack { render(): never { throw new Error('PRIVATE_RENDER_SENTINEL'); } }
@Page({ transport: 'http', middlewares: [async (_c, next) => {
  if (policy.errorGuardFails) throw new Error('PRIVATE_ERROR_GUARD_SENTINEL');
  await next();
}] })
class ErrorPage extends Told {
  render() {
    if (policy.errorPageFails) throw new Error('PRIVATE_ERROR_PAGE_SENTINEL');
    return html`<h1>Error page</h1>${this.told()}`;
  }
}
@Page({ transport: 'http' })
class NotFound extends Told { render() { return html`<h1>Not found page</h1>${this.told()}`; } }

registry.pages['/src/pages/index/index.ts'] = { default: Home };
registry.pages['/src/pages/broken/index.ts'] = { default: Broken };
registry.pages['/src/pages/error/index.ts'] = { default: ErrorPage };
registry.pages['/src/pages/404/index.ts'] = { default: NotFound };
const { createApp } = await import('../src/router');

const assets = { ASSETS: { fetch: async (request: Request) => new URL(request.url).pathname === '/cossack-manifest.json'
  ? Response.json({ 'src/client/entry-client.ts': { file: 'assets/entry.abc12345.js' } }) : new Response(null, { status: 404 }) } };
const browser = { headers: { accept: 'text/html,application/xhtml+xml' } };
const told = (markup: string) => /data-told[^>]*>(?:<!--[^>]*-->)*([^<]*)</.exec(markup)?.[1];
/** The boundary record in the page's hydration state. */
const hydrated = (markup: string) => /"boundary":(\{[^}]*\})/.exec(markup)?.[1];

beforeEach(() => { vi.stubEnv('DEV', false); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { Object.assign(policy, { fail: false, deny: false, errorPageFails: false, errorGuardFails: false, ran: 0 }); vi.restoreAllMocks(); vi.unstubAllEnvs(); createApp(); });

describe('what a boundary page is told', () => {
  it('tells an ordinary page nothing', async () => {
    const response = await createApp().request('/', browser, assets);
    expect(response.status).toBe(200);
    const markup = await response.text();
    expect(told(markup)).toBe('nothing');
    expect(hydrated(markup)).toBeUndefined();
  });

  it('tells the error page status 500 and the request id of a page that failed', async () => {
    const response = await createApp().request('/broken', browser, assets);
    expect(response.status).toBe(500);
    const id = response.headers.get('X-Cossack-Request-Id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const markup = await response.text();
    expect(markup).toContain('Error page');
    expect(told(markup)).toBe(`error|500|${id}`);
    // The browser reads the same record after hydration.
    expect(JSON.parse(hydrated(markup)!)).toEqual({ type: 'error', status: 500, requestId: id });
    expect(markup).not.toContain('PRIVATE_');
  });

  it('tells the error page the status of a denial', async () => {
    policy.deny = true;
    const response = await createApp().request('/', browser, assets);
    expect(response.status).toBe(403);
    const markup = await response.text();
    expect(told(markup)).toBe(`error|403|${response.headers.get('X-Cossack-Request-Id')}`);
  });

  it('tells the 404 page status 404 and the id of its response', async () => {
    const response = await createApp().request('/no-such-page', browser, assets);
    expect(response.status).toBe(404);
    const id = response.headers.get('X-Cossack-Request-Id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(told(await response.text())).toBe(`404|404|${id}`);
  });
});

describe('a middleware that fails', () => {
  it('renders the nearest error page for a browser, never cached, and runs once', async () => {
    policy.fail = true;
    const seen: Array<{ failure: ServerFailure; error: unknown }> = [];
    const response = await createApp({ onServerFailure: (failure, error) => { seen.push({ failure, error }); } }).request('/', browser, assets);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const id = response.headers.get('X-Cossack-Request-Id');
    const markup = await response.text();
    expect(markup).toContain('Error page');
    expect(told(markup)).toBe(`error|500|${id}`);
    expect(markup).not.toContain('PRIVATE_');
    expect(policy.ran).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].failure).toMatchObject({ event: 'cossack.request.failure', stage: 'middleware', code: 'COSSACK_REQUEST_INTERNAL', requestId: id, route: '/' });
    expect((seen[0].error as Error).message).toBe('PRIVATE_MIDDLEWARE_SENTINEL');
  });

  it('keeps the JSON answer for a client that did not ask for a page', async () => {
    policy.fail = true;
    const app = createApp();
    for (const init of [undefined, { headers: { accept: 'application/json' } }, { method: 'POST', headers: browser.headers }]) {
      const response = await app.request('/', init, assets);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal Server Error', code: 'COSSACK_REQUEST_INTERNAL',
        requestId: response.headers.get('X-Cossack-Request-Id') });
    }
    const api = await app.request('/api/anything', browser, assets);
    expect(api.status).toBe(500);
    expect(api.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('answers a plain document when the error page fails too', async () => {
    policy.fail = true;
    policy.errorPageFails = true;
    const seen: ServerFailure[] = [];
    const response = await createApp({ onServerFailure: failure => { seen.push(failure); } }).request('/', browser, assets);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(await response.text()).toBe('<h1>Internal Server Error</h1>');
    expect(seen.map(failure => failure.event)).toEqual(['cossack.request.failure', 'cossack.ssr.failure']);
    expect(new Set(seen.map(failure => failure.requestId)).size).toBe(1);
  });

  it('answers a plain document when a middleware of the error page fails', async () => {
    policy.fail = true;
    policy.errorGuardFails = true;
    const response = await createApp().request('/', browser, assets);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('<h1>Internal Server Error</h1>');
  });

  it('names the code, the request id and the route in development, without the error', async () => {
    vi.stubEnv('DEV', true);
    policy.fail = true;
    policy.errorGuardFails = true;
    const response = await createApp().request('/', browser, assets);
    const markup = await response.text();
    expect(markup).toContain('COSSACK_REQUEST_INTERNAL');
    expect(markup).toContain(`Request ID: ${response.headers.get('X-Cossack-Request-Id')}`);
    expect(markup).toContain('Route: /');
    expect(markup).not.toContain('PRIVATE_');
  });
});
