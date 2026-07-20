import { describe, it, expect, vi } from 'vitest';
import { CossackElement } from './cossack-element';
import { html, renderToString, render } from './cossack-html';
import type { ComponentResult } from './component';
import { cache } from './directives';

function makeComponentResult(clazz: new () => CossackElement): ComponentResult {
  return { _type: 'COMPONENT', clazz, props: {}, children: undefined };
}

describe('cache directive', () => {
  describe('SSR', () => {
    it('is transparent — renders the inner value', () => {
      expect(renderToString(html`<div>${cache(html`<b>hi</b>`)}</div>`).trim()).toBe(
        '<div><b>hi</b></div>',
      );
    });

    it('renders non-template inner values', () => {
      expect(renderToString(html`<div>${cache('plain text')}</div>`).trim()).toBe(
        '<div>plain text</div>',
      );
    });
  });

  describe('client', () => {
    it('renders the inner template on first render', () => {
      const container = document.createElement('div');
      render(html`<div>${cache(html`<span class="m">A</span>`)}</div>`, container);
      expect(container.querySelector('.m')).toBeInstanceOf(HTMLSpanElement);
      expect(container.textContent).toContain('A');
    });

    it('reuses the same DOM nodes when toggling back to a cached template', () => {
      const container = document.createElement('div');
      const a = () => html`<span class="a">A</span>`;
      const b = () => html`<span class="b">B</span>`;
      const tpl = (showA: boolean) =>
        html`<div>${cache(showA ? a() : b())}</div>`;

      // Render A, capture its node identity.
      render(tpl(true), container);
      const aNode1 = container.querySelector('.a');
      expect(aNode1).toBeInstanceOf(HTMLSpanElement);

      // Switch to B: A's node is removed, B's is shown.
      render(tpl(false), container);
      expect(container.querySelector('.a')).toBeNull();
      const bNode1 = container.querySelector('.b');
      expect(bNode1).toBeInstanceOf(HTMLSpanElement);

      // Switch back to A: the SAME A node must be restored (not a rebuild).
      render(tpl(true), container);
      expect(container.querySelector('.a')).toBe(aNode1);
      expect(container.querySelector('.b')).toBeNull();

      // And B is cached too — switch back to B, same identity.
      render(tpl(false), container);
      expect(container.querySelector('.b')).toBe(bNode1);
    });

    it('updates cached template values when restored', () => {
      // The restored subtree's parts must apply the latest values, not stale ones.
      const container = document.createElement('div');
      const a = (v: string) => html`<span class="a">${v}</span>`;
      const b = () => html`<span class="b">B</span>`;
      const tpl = (showA: boolean, val: string) =>
        html`<div>${cache(showA ? a(val) : b())}</div>`;

      render(tpl(true, 'first'), container);
      expect(container.querySelector('.a')!.textContent).toBe('first');

      render(tpl(false, ''), container);

      // Restore A with a new value — the node is reused AND shows the new value.
      render(tpl(true, 'second'), container);
      expect(container.querySelector('.a')!.textContent).toBe('second');
    });

    it('updates in place when the same template re-renders', () => {
      const container = document.createElement('div');
      const tpl = (v: string) => html`<div>${cache(html`<span class="m">${v}</span>`)}</div>`;

      render(tpl('a'), container);
      const first = container.querySelector('.m');
      render(tpl('b'), container);
      // Same template, same node, updated text.
      expect(container.querySelector('.m')).toBe(first);
      expect(first!.textContent).toBe('b');
    });

    it('renders non-template inner values without caching (passthrough)', () => {
      const container = document.createElement('div');
      render(html`<div>${cache('hello')}</div>`, container);
      expect(container.textContent).toContain('hello');
    });

    it('handles switching from a cached template to a plain value', () => {
      const container = document.createElement('div');
      const tpl = (mode: 't' | 'p', v: string) =>
        html`<div>${cache(mode === 't' ? html`<span class="m">${v}</span>` : v)}</div>`;

      render(tpl('t', 'A'), container);
      expect(container.querySelector('.m')).toBeInstanceOf(HTMLSpanElement);

      // Switch to plain value: template subtree detached, plain text shown.
      render(tpl('p', 'plain'), container);
      expect(container.querySelector('.m')).toBeNull();
      expect(container.textContent).toContain('plain');

      // Switch back: the cached template (with the new value) is restored.
      render(tpl('t', 'B'), container);
      expect(container.querySelector('.m')).toBeInstanceOf(HTMLSpanElement);
      expect(container.querySelector('.m')!.textContent).toBe('B');
    });

    it('caches more than two distinct templates', () => {
      const container = document.createElement('div');
      const tpl = (which: number) =>
        html`<div>${cache(
          which === 0
            ? html`<i class="i0">0</i>`
            : which === 1
              ? html`<i class="i1">1</i>`
              : html`<i class="i2">2</i>`,
        )}</div>`;

      render(tpl(0), container);
      const n0 = container.querySelector('.i0');
      render(tpl(1), container);
      const n1 = container.querySelector('.i1');
      render(tpl(2), container);
      const n2 = container.querySelector('.i2');

      // Cycle through all three again — each must restore its original node.
      render(tpl(1), container);
      expect(container.querySelector('.i1')).toBe(n1);
      render(tpl(0), container);
      expect(container.querySelector('.i0')).toBe(n0);
      render(tpl(2), container);
      expect(container.querySelector('.i2')).toBe(n2);
    });
  });

  describe('cleanup / no leaks', () => {
    it('disposes a previously-rendered component when switching into cache() (regression)', () => {
      // A single template site switching its value from a component to
      // cache(template) keeps the same NodePart. The cache fast-path returns
      // early, so it must still tear down the component instance — otherwise
      // the component's render listener / lifecycle leaks for the page lifetime.
      const destroySpy = vi.fn();
      const disconnectedSpy = vi.fn();

      class LeakComp extends CossackElement {
        render() {
          return html`<p>child</p>`;
        }
        disconnectedCallback() {
          disconnectedSpy();
        }
        destroy() {
          destroySpy();
        }
      }

      const container = document.createElement('div');
      document.body.appendChild(container);

      // One reusable template site: only the interpolated VALUE changes, so the
      // outer NodePart persists (the leak only manifests with a persistent part).
      const tpl = (v: unknown) => html`${v}`;
      render(tpl(makeComponentResult(LeakComp)), container);
      expect(disconnectedSpy).not.toHaveBeenCalled();

      // Switch the same site to a cached template.
      render(tpl(cache(html`<b class="cached">x</b>`)), container);

      expect(disconnectedSpy).toHaveBeenCalledTimes(1);
      expect(destroySpy).toHaveBeenCalledTimes(1);

      container.remove();
    });

    it('clears the stash when switching away from cache() to a non-cache value', () => {
      // After toggling between two cached templates, switching the same site to a
      // plain (non-cache) value must dispose the stashed subtrees rather than
      // retaining them indefinitely. Re-toggling back to cache() then rebuilds.
      const container = document.createElement('div');
      const a = () => html`<span class="a">A</span>`;
      const b = () => html`<span class="b">B</span>`;
      const tpl = (v: unknown) => html`${v}`;

      // Prime both cache entries.
      render(tpl(cache(a())), container);
      render(tpl(cache(b())), container);
      render(tpl(cache(a())), container);

      // Switch away from cache entirely to a plain value.
      render(tpl('plain'), container);
      expect(container.textContent).toContain('plain');

      // Switching back to cache() rebuilds (the stash was cleared), so a fresh
      // node is produced — not a restored one. This confirms the stash is gone.
      render(tpl(cache(a())), container);
      expect(container.querySelector('.a')).toBeInstanceOf(HTMLSpanElement);
    });
  });
});
