import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack, CossackService, Inject, Page, Service, State } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { renderSsgPage } from '../src/ssg-renderer';

@Page({ transport: 'http' })
class App extends Cossack { render() { return html`${this.children}`; } }

afterEach(() => vi.restoreAllMocks());

const hydration = (output: string) => JSON.parse(output.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)![1]);

describe('SSG scoped services and lifecycle', () => {
  it('shares, shadows, and hydrates layout services with real anonymous request facilities', async () => {
    const disposed: string[] = [];
    @Service()
    class Counter extends CossackService<{ APP_URL: string }> {
      @State() label = 'fresh';
      @State() count = 0;
      snapshot() { return { user: this.user, id: this.c.req.param('id'), url: this.env.APP_URL }; }
      onDispose() { disposed.push(this.label); }
    }
    @Page({ services: [Counter] })
    class RootLayout extends Cossack {
      @Inject(Counter) counter!: Counter;
      async init() { this.counter.label = 'root'; }
      render() { return html`<aside>${this.counter.label}:${this.counter.count}</aside>${this.children}`; }
    }
    @Page({ services: [Counter] })
    class InnerLayout extends Cossack {
      @Inject(Counter) counter!: Counter;
      async init() { this.counter.label = 'inner'; }
      render() { return html`<section>${this.counter.label}:${this.counter.count}${this.children}</section>`; }
    }
    @Page({ ssg: true, scope: c => `public:${c.req.param('id')}` })
    class PublicPage extends Cossack {
      @Inject(Counter) counter!: Counter;
      constructor(public constructorCounter: Counter) { super(); }
      async init() {
        expect(this.counter).toBe(this.constructorCounter);
        expect(this.counter.snapshot()).toEqual({ user: undefined, id: 'alice', url: 'https://site.example.test' });
        this.counter.count++;
      }
      render() { return html`<main>${this.counter.label}:${this.counter.count}</main>`; }
    }
    Reflect.defineMetadata('design:paramtypes', [Counter], PublicPage);
    const file = '/src/pages/(public)/users/[id]/index.ts';
    const layouts = {
      '/src/pages/layout.ts': { default: RootLayout },
      '/src/pages/(public)/users/[id]/layout.ts': { default: InnerLayout },
    };
    const output = await renderSsgPage(PublicPage, '/users/[id]', { id: 'alice' }, layouts,
      'https://site.example.test', App, undefined, file, 'page-id', undefined, undefined,
      { '/src/pages/layout.ts': 'root-id', '/src/pages/(public)/users/[id]/layout.ts': 'inner-id' });
    expect(output.replace(/<!--[\s\S]*?-->/g, '')).toContain('<main>inner:1</main>');
    const state = hydration(output);
    expect(state.scopeKey).toBe('public:alice');
    expect(state.public).not.toHaveProperty('counter');
    expect(state._layout_stack).toMatchObject([
      { componentRouteId: 'root-id', state: { services: { '0': { label: 'root', count: 0 } } } },
      { componentRouteId: 'inner-id', state: { services: { '0': { label: 'inner', count: 1 } } } },
    ]);
    expect(disposed).toEqual(['inner', 'root']);
  });

  it('isolates service state across concurrent static renders', async () => {
    const instances: Counter[] = [];
    @Service()
    class Counter extends CossackService {
      @State() id = '';
      constructor() { super(); instances.push(this); }
      pathname() { return this.c.req.path; }
    }
    @Page({ services: [Counter] })
    class Layout extends Cossack { render() { return html`${this.children}`; } }
    @Page({ ssg: true })
    class PublicPage extends Cossack {
      @Inject(Counter) counter!: Counter;
      async init() {
        this.counter.id = this.c.req.param('id')!;
        await Promise.resolve();
        expect(this.counter.pathname()).toBe(`/users/${this.counter.id}`);
      }
      render() { return html`<main>${this.counter.id}</main>`; }
    }
    const outputs = await Promise.all(['alice', 'bob'].map(id => renderSsgPage(PublicPage, '/users/[id]', { id },
      { '/src/pages/layout.ts': { default: Layout } }, 'https://site.example.test', App,
      undefined, '/src/pages/users/[id]/index.ts')));
    expect(instances[0]).not.toBe(instances[1]);
    expect(outputs.map(output => hydration(output)._layout_stack[0].state.services['0'].id)).toEqual(['alice', 'bob']);
  });

  it('injects constructor services into App as well as page and layouts', async () => {
    @Service({ scope: 'transient' })
    class Branding { title() { return 'build branding'; } }
    @Page()
    class BrandedApp extends Cossack {
      constructor(private branding: Branding) { super(); }
      head() { return { title: this.branding.title() }; }
      render() { return html`${this.children}`; }
    }
    Reflect.defineMetadata('design:paramtypes', [Branding], BrandedApp);
    @Page({ ssg: true })
    class PublicPage extends Cossack { render() { return html`public`; } }
    const output = await renderSsgPage(PublicPage, '/public', undefined, {}, 'https://site.example.test', BrandedApp);
    expect(output).toMatch(/<title[^>]*>build branding<\/title>/);
  });

  it('cleans renderer-created descendants before releasing their scoped service', async () => {
    const calls: string[] = [];
    @Service()
    class Resource { onDispose() { calls.push('service'); } }
    @Page({ services: [Resource] })
    class Layout extends Cossack {
      onCleanup() { calls.push('layout'); }
      render() { return html`${this.children}`; }
    }
    class Child extends Cossack {
      @Inject(Resource) resource!: Resource;
      render() { expect(this.resource).toBeInstanceOf(Resource); return html`child`; }
      async onCleanup() { await Promise.resolve(); calls.push('child'); }
    }
    @Page({ ssg: true })
    class PublicPage extends Cossack {
      onCleanup() { calls.push('page'); }
      render() { return html`${component(Child, {})}`; }
    }
    await renderSsgPage(PublicPage, '/public', undefined, { '/src/pages/layout.ts': { default: Layout } },
      'https://site.example.test', App);
    expect(calls).toContain('child');
    expect(calls.indexOf('child')).toBeLessThan(calls.indexOf('service'));
    expect(calls.indexOf('page')).toBeLessThan(calls.indexOf('layout'));
    expect(calls.filter(call => call === 'child')).toHaveLength(1);
  });

  it.each(['init', 'render', 'head', 'constructor'])('releases the complete request tree after a page %s failure', async stage => {
    const calls: string[] = [];
    const failure = new Error(`page ${stage} failed`);
    @Service()
    class Resource { async onDispose() { await Promise.resolve(); calls.push('service'); } }
    @Page({ services: [Resource] })
    class Layout extends Cossack {
      onCleanup() { calls.push('layout'); }
      render() { return html`${this.children}`; }
    }
    @Page()
    class CleanApp extends App { onCleanup() { calls.push('app'); } }
    @Page({ ssg: true })
    class BrokenPage extends Cossack {
      constructor() { super(); if (stage === 'constructor') throw failure; }
      async init() { if (stage === 'init') throw failure; }
      render() { if (stage === 'render') throw failure; return html`public`; }
      head() { if (stage === 'head') throw failure; return {}; }
      onCleanup() { calls.push('page'); }
    }
    await expect(renderSsgPage(BrokenPage, '/broken', undefined,
      { '/src/pages/layout.ts': { default: Layout } }, 'https://site.example.test', CleanApp)).rejects.toBe(failure);
    expect(calls).toEqual(stage === 'constructor' ? ['layout', 'service', 'app'] : ['page', 'layout', 'service', 'app']);
  });

  it.each([false, true])('rejects failed cleanup after a render (render also fails: %s)', async renderAlsoFails => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const disposed = vi.fn();
    const renderFailure = new Error('render failed');
    @Service()
    class Resource { async onDispose() { await Promise.resolve(); disposed(); throw new Error('dispose failed'); } }
    @Page({ services: [Resource] })
    class Layout extends Cossack { render() { return html`${this.children}`; } }
    @Page({ ssg: true })
    class BrokenPage extends Cossack {
      render() { if (renderAlsoFails) throw renderFailure; return html`public`; }
    }
    const failure = await renderSsgPage(BrokenPage, '/broken', undefined,
      { '/src/pages/layout.ts': { default: Layout } }, 'https://site.example.test', App).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.cause).toBe(renderAlsoFails ? renderFailure : undefined);
    if (renderAlsoFails) expect(failure.errors[0]).toBe(renderFailure);
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
