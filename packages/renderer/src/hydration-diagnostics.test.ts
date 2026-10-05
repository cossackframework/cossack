import { afterEach, expect, it, vi } from 'vitest';
import { html, hydrate, render, renderToString } from './cossack-html';
import { CossackElement } from './cossack-element';
const warnings = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => vi.restoreAllMocks());
const container = (result: ReturnType<typeof html>) => {
  const root = document.createElement('div'); root.innerHTML = renderToString(result, { hydrate: true }); return root;
};
it('reconciles dynamic text without replacing SSR nodes and provides safe field context', () => {
  const view = (value: string) => html`<p>${value}</p>`;
  const root = container(view('PRIVATE_SERVER_SECRET')); const paragraph = root.firstChild;
  const warning = warnings();
  hydrate(view('PRIVATE_CLIENT_SECRET'), root, { component: 'Account', source: { file: 'src/pages/account/index.ts', line: 12 }, fields: { 0: 'public.label' } });
  expect(root.firstChild).toBe(paragraph); expect(root.textContent).toBe('PRIVATE_CLIENT_SECRET');
  expect(warning).toHaveBeenCalledWith(expect.objectContaining({ category: 'text-content', component: 'Account', statePath: 'public.label', source: { file: 'src/pages/account/index.ts', line: 12 }, action: 'text-reconcile', path: expect.stringContaining('node[') }));
  expect(JSON.stringify(warning.mock.calls)).not.toMatch(/PRIVATE_(SERVER|CLIENT)_SECRET/);
});
it('detects static text mismatches without structural fallback', () => {
  const root = container(html`<h1>Server content</h1>`); const heading = root.firstChild; const warning = warnings();
  hydrate(html`<h1>Client content</h1>`, root, { component: 'Heading' });
  expect(root.firstChild).toBe(heading); expect(root.textContent).toBe('Client content');
  expect(warning).toHaveBeenCalledWith(expect.objectContaining({ category: 'text-content', component: 'Heading', expected: 'text', actual: 'text' }));
});
it('adds safe structural source context and omits absolute source and invalid state paths', () => {
  const root = container(html`<p>SSR</p>`); const warning = warnings();
  hydrate(html`<section>Client</section>`, root, { component: 'Profile', source: { file: '/home/private/project/file.ts' }, statePath: 'token secret' });
  const event = warning.mock.calls[0][0]; expect(event).toMatchObject({ category: 'element-tag', component: 'Profile' });
  expect(event).not.toHaveProperty('source'); expect(event).not.toHaveProperty('statePath');
});
it.each(['text', 'structure'])('explicit expected client-only %s differences reconcile quietly', kind => {
  const root = container(html`<p>Server</p>`); const warning = warnings();
  hydrate(kind === 'text' ? html`<p>Client</p>` : html`<section>Client</section>`, root, { expectedClientOnly: true });
  expect(root.textContent).toBe('Client'); expect(warning).not.toHaveBeenCalled();
});
it('valid hydration and subsequent hydration bind each listener once', () => {
  const clicked = vi.fn(); const view = () => html`<button @click=${clicked}>Click</button>`;
  const root = container(view()); const button = root.firstChild; const warning = warnings();
  hydrate(view(), root); hydrate(view(), root); (root.querySelector('button')!).click();
  expect(clicked).toHaveBeenCalledTimes(1); expect(root.firstChild).toBe(button); expect(warning).not.toHaveBeenCalled();
});

it('nested boundaries retain their own field/source metadata through asynchronous rendering', async () => {
  class Nested extends CossackElement {
    get hydrationMetadata() { return { component: 'Nested', source: { file: 'src/components/nested.ts', line: 8 }, fields: { 0: 'public.caption' } }; }
    render() { return html`<span>${'client'}</span>`; }
  }
  const view = () => html`<div>${{ _type: 'COMPONENT', clazz: Nested, props: {}, children: null } as any}</div>`;
  const root = container(view()); const span = root.querySelector('span')!; span.childNodes[1].nodeValue = 'PRIVATE_NESTED_SERVER';
  const warning = warnings(); hydrate(view(), root, { component: 'Parent', statePath: 'public.parent' });
  await Promise.resolve(); await Promise.resolve();
  expect(root.querySelector('span')).toBe(span); expect(span.textContent).toBe('client');
  expect(warning).toHaveBeenCalledWith(expect.objectContaining({ boundary: 'component', component: 'Nested', statePath: 'public.caption', source: { file: 'src/components/nested.ts', line: 8 }, category: 'text-content' }));
  expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_NESTED_SERVER');
});
it('a nested expected-client-only boundary does not suppress its parent sibling', async () => {
  class Expected extends CossackElement {
    get hydrationMetadata() { return { expectedClientOnly: true }; }
    render() { return html`<span>Client</span>`; }
  }
  const view = (text: string) => html`<div>${{ _type: 'COMPONENT', clazz: Expected, props: {}, children: null } as any}<p>${text}</p></div>`;
  const root = container(view('Server sibling')); root.querySelector('span')!.textContent = 'Server';
  const warning = warnings(); hydrate(view('Client sibling'), root, { component: 'Parent' });
  await Promise.resolve(); await Promise.resolve();
  expect(root.textContent).toBe('ClientClient sibling');
  expect(warning.mock.calls).toHaveLength(1); expect(warning.mock.calls[0][0]).toMatchObject({ component: 'Parent', category: 'text-content' });
});

it('nested SSR consumes the component wrapped-template hook so development anchors hydrate in place', async () => {
  const wrapped = vi.fn();
  class SourceWrapped extends CossackElement {
    render() { return html`<section><button>Owned</button></section>`; }
    _getWrappedTemplate() { wrapped(); return html`<!--cossack-start:source-->${this.render()}<!--cossack-end:source-->`; }
    protected async performUpdate() {
      await Promise.resolve();
      (this as any).__notifyListeners(this._getWrappedTemplate());
      return true;
    }
  }
  const view = () => html`<main>${{ _type: 'COMPONENT', clazz: SourceWrapped, props: {}, children: null } as any}</main>`;
  const root = container(view()); expect(wrapped).toHaveBeenCalledTimes(1);
  const section = root.querySelector('section'); const button = root.querySelector('button'); const warning = warnings();
  hydrate(view(), root); await Promise.resolve(); await Promise.resolve();
  expect(root.querySelector('section')).toBe(section); expect(root.querySelector('button')).toBe(button);
  expect(warning).not.toHaveBeenCalled();
});

it('ordinary reactive text updates after valid hydration do not report a mismatch', () => {
  const view = (text: string) => html`<p>${text}</p>`;
  const root = container(view('Initial')); const paragraph = root.firstChild; const warning = warnings();
  hydrate(view('Initial'), root, { component: 'Counter', fields: { 0: 'public.count' } });
  render(view('Updated'), root);
  expect(root.firstChild).toBe(paragraph); expect(root.textContent).toBe('Updated');
  expect(warning).not.toHaveBeenCalled();
});
