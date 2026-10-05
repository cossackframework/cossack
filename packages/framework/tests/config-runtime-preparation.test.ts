import 'reflect-metadata';
import { beforeEach, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { config, env, requireEnv, requireBinding, ConfigBindingError, requireConfigVariable } from '../src/config';
import { renderSsgPage } from '../src/ssg-renderer';
const { factories, requirements, registry, middlewareEntered } = vi.hoisted(() => ({
  requirements: {} as Record<string, any>, middlewareEntered: vi.fn(), factories: {} as Record<string, unknown>, registry: { pages: {} as Record<string, unknown>, layouts: {}, loadings: {} },
}));
vi.mock('virtual:cossack-config', () => ({ requirements, environment: 'staging', default: factories }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [async (_c: unknown, next: () => Promise<void>) => { middlewareEntered(); await next(); }] }));
const entered = vi.fn();
let gate = Promise.resolve();
@Page({ transport: 'http' })
class ConfigApi extends Cossack {
  async get() {
    entered();
    await gate;
    return this.c.json({ name: config('app.name'), environmentName: env('APP_NAME') });
  }
}
registry.pages['/src/pages/api/config.ts'] = { default: ConfigApi };
const { createApp } = await import('../src/router');
beforeEach(() => { for (const key of Object.keys(requirements)) delete requirements[key]; for (const key of Object.keys(factories)) delete factories[key]; entered.mockClear(); middlewareEntered.mockClear(); gate = Promise.resolve(); });
it('prepares each real HTTP request with its own required bindings before its handler', async () => {
  factories.app = () => ({ name: requireEnv('APP_NAME'), database: requireBinding('DB') });
  const app = createApp();
  let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; });
  const first = app.request('/api/config', {}, { APP_NAME: 'first', DB: { id: 1 } });
  const second = app.request('/api/config', {}, { APP_NAME: 'second', DB: { id: 2 } });
  await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(2));
  release();
  expect(await (await first).json()).toEqual({ name: 'first', environmentName: 'first' });
  expect(await (await second).json()).toEqual({ name: 'second', environmentName: 'second' });
  expect(env('APP_NAME')).toBe('');
});
it('handles an omitted HTTP environment with a named missing-variable error', async () => {
  factories.app = () => ({ name: requireEnv('APP_NAME') });
  const app = createApp(); let captured: unknown;
  app.onError((error, c) => { captured = error; return c.text('Configuration unavailable', 500); });
  expect((await app.request('/api/config')).status).toBe(500);
  expect(captured).toMatchObject({ code: 'COSSACK_BINDING_MISSING', bindingName: 'APP_NAME' });
  expect(entered).not.toHaveBeenCalled(); expect(middlewareEntered).not.toHaveBeenCalled();
});
it('rejects a missing required factory binding before the HTTP handler', async () => {
  factories.app = () => ({ name: requireEnv('APP_NAME'), database: requireBinding('DB') });
  const app = createApp(); let captured: unknown;
  app.onError((error, c) => { captured = error; return c.text('Configuration unavailable', 500); });
  const response = await app.request('/api/config', {}, { APP_NAME: 'PRIVATE_VALUE_SENTINEL' });
  expect(response.status).toBe(500); expect(entered).not.toHaveBeenCalled(); expect(middlewareEntered).not.toHaveBeenCalled();
  expect(captured).toBeInstanceOf(ConfigBindingError);
  expect(captured).toMatchObject({ code: 'COSSACK_BINDING_MISSING', bindingName: 'DB' });
  expect(String(captured)).not.toContain('PRIVATE_VALUE_SENTINEL');
});
@Page({ transport: 'http' })
class SsgApp extends Cossack { render() { return html`<div>${this.children}</div>`; } }
const pageStarted = vi.fn();
@Page({ ssg: true, transport: 'http' })
class ConfigSsgPage extends Cossack {
  init() { pageStarted(); }
  render() { return html`<p>${config('app.url')}</p>`; }
}
it('supplies the SSG URL to required factory accessors', async () => {
  const output = await renderSsgPage(ConfigSsgPage, '/config', undefined, {}, 'https://config.example', SsgApp,
    undefined, undefined, undefined, { app: () => ({ url: requireEnv('APP_URL') }) });
  expect(output).toContain('https://config.example');
  expect(env('APP_URL')).toBe('');
});
it('fails SSG required live bindings before page lifecycle starts', async () => {
  pageStarted.mockClear(); const middleware = vi.fn();
  await expect(renderSsgPage(ConfigSsgPage, '/config', undefined, {}, 'https://config.example', SsgApp,
    undefined, undefined, undefined, { app: () => ({ database: requireBinding('DB') }) },
    undefined, {}, [async (_c, next) => { middleware(); await next(); }]))
    .rejects.toMatchObject({ code: 'COSSACK_BINDING_MISSING', bindingName: 'DB' });
  expect(pageStarted).not.toHaveBeenCalled(); expect(middleware).not.toHaveBeenCalled();
});

it('rejects declared requirements before any HTTP factory or middleware', async () => {
  const factory = vi.fn(() => ({ name: 'unused' })); factories.app = factory;
  requirements.app = { variables: { PORT: { type: 'number', coerce: true } } };
  const app = createApp(); let captured: unknown;
  app.onError((error, c) => { captured = error; return c.text('Configuration unavailable', 500); });
  expect((await app.request('/api/config', {}, { PORT: 'PRIVATE_SENTINEL' })).status).toBe(500);
  expect(captured).toMatchObject({ code: 'COSSACK_CONFIG_VARIABLE_INVALID', requirementName: 'PORT', runtime: 'cloudflare', environment: 'staging' });
  expect(String(captured)).not.toContain('PRIVATE_SENTINEL');
  expect(factory).not.toHaveBeenCalled(); expect(entered).not.toHaveBeenCalled(); expect(middlewareEntered).not.toHaveBeenCalled();
});
it('exposes declared coercion through actual HTTP factory preparation', async () => {
  requirements.app = { variables: { PORT: { type: 'number', coerce: true } } };
  factories.app = () => ({ name: requireConfigVariable('PORT', 'number') });
  let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; });
  const app = createApp();
  const responses = ['81', '82'].map(PORT => app.request('/api/config', {}, { PORT }));
  await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(2)); release();
  const [first, second] = await Promise.all(responses);
  expect(await first.json()).toEqual({ name: 81, environmentName: '' });
  expect(await second.json()).toEqual({ name: 82, environmentName: '' });
});
it('rejects live binding metadata before SSG factories, middleware or page lifecycle', async () => {
  const factory = vi.fn(() => ({})); const middleware = vi.fn(); pageStarted.mockClear();
  await expect(renderSsgPage(ConfigSsgPage, '/config', undefined, {}, 'https://config.example', SsgApp,
    undefined, undefined, undefined, { app: factory }, undefined, {}, [async (_c, next) => { middleware(); await next(); }],
    { app: { bindings: { DB: { kind: 'd1' } } } }))
    .rejects.toMatchObject({ code: 'COSSACK_CONFIG_RUNTIME_UNSUPPORTED', requirementName: 'DB', runtime: 'ssg' });
  expect(factory).not.toHaveBeenCalled(); expect(middleware).not.toHaveBeenCalled(); expect(pageStarted).not.toHaveBeenCalled();
});
it('allows SSG with declared APP_URL and explicitly Cloudflare-only bindings', async () => {
  const output = await renderSsgPage(ConfigSsgPage, '/config', undefined, {}, 'https://config.example', SsgApp,
    undefined, undefined, undefined, { app: () => ({ url: requireConfigVariable('APP_URL', 'string') }) }, undefined, {}, [],
    { app: { variables: { APP_URL: { type: 'string' } }, bindings: { DB: { kind: 'd1', runtimes: ['cloudflare'] } } } });
  expect(output).toContain('https://config.example');
});

it('uses the actual adapter runtime for declarations', async () => {
  requirements.app = { bindings: { DB: { kind: 'd1' } } };
  factories.app = vi.fn(() => ({ name: 'unused' }));
  const app = createApp({ runtimeAdapter: { name: 'node' } }); let captured: unknown;
  app.onError((error, c) => { captured = error; return c.text('Configuration unavailable', 500); });
  expect((await app.request('/api/config')).status).toBe(500);
  expect(captured).toMatchObject({ code: 'COSSACK_CONFIG_RUNTIME_UNSUPPORTED', runtime: 'node', environment: 'staging' });
  expect(factories.app).not.toHaveBeenCalled();
});
it('keeps custom adapters unknown instead of treating them as Cloudflare', async () => {
  requirements.app = { variables: { PORT: { type: 'number', runtimes: ['unknown'] } } };
  factories.app = vi.fn(() => ({ name: 'unused' }));
  const app = createApp({ runtimeAdapter: { name: 'custom' } }); let captured: unknown;
  app.onError((error, c) => { captured = error; return c.text('Configuration unavailable', 500); });
  expect((await app.request('/api/config')).status).toBe(500);
  expect(captured).toMatchObject({ code: 'COSSACK_CONFIG_REQUIRED_MISSING', runtime: 'unknown' });
  expect(factories.app).not.toHaveBeenCalled();
});
