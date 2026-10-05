// @vitest-environment node
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { renderSsgPage } from '../src/ssg-renderer';
const fixture = vi.hoisted(() => ({ failure: 'PRIVATE_MANIFEST_PARSE_SENTINEL' }));
vi.mock('fs', async importOriginal => ({ ...await importOriginal<typeof import('fs')>(), readFileSync: () => { throw new Error(fixture.failure); } }));
afterEach(() => vi.restoreAllMocks());
@Page({ transport: 'http' })
class App extends Cossack { render() { return html`${this.children}`; } }
it('renders after unreadable manifest while logging only a fixed failure event', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  @Page({ ssg: true })
  class PublicPage extends Cossack { render() { return html`<p>public</p>`; } }
  const output = await renderSsgPage(PublicPage, '/public', undefined, {}, 'https://example.test', App);
  expect(output).toContain('public');
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'cossack.runtime.failure', component: 'ssg-manifest', stage: 'initialization', code: 'COSSACK_RUNTIME_FAILED' }));
  expect(JSON.stringify(spy.mock.calls)).not.toContain(fixture.failure);
  expect(output).not.toContain(fixture.failure);
});
it('rejects cleanup failures without putting concrete route or exception values in wrapper diagnostics', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  @Page({ ssg: true })
  class BrokenCleanup extends Cossack {
    render() { return html`<p>private cleanup is never published</p>`; }
    onCleanup() { throw new Error('PRIVATE_CLEANUP_EXCEPTION_SENTINEL'); }
  }
  const failure = await renderSsgPage(BrokenCleanup, '/PRIVATE_ROUTE_SENTINEL', undefined, {}, 'https://example.test', App).catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.message).toBe('[cossack/ssg] Static rendering failed during cleanup.');
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ component: 'ssg-renderer', stage: 'component-cleanup', code: 'COSSACK_COMPONENT_CLEANUP_FAILED' }));
  expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_ROUTE_SENTINEL|PRIVATE_CLEANUP_EXCEPTION_SENTINEL|PRIVATE_MANIFEST_PARSE_SENTINEL/);
});
