import { describe, it, expect } from 'vitest';
import { html, renderToString, render, hydrate, unsafeHTML } from './cossack-html';
import { CossackElement } from './cossack-element';

/**
 * Helper: produce a container whose innerHTML is the SSR output of `result`,
 * the same way the framework delivers server-rendered HTML to the client.
 */
const ssrContainer = (result: ReturnType<typeof html>) => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(result, { hydrate: true });
  return container;
};

describe('SSR hydrate markers', () => {
  it('does NOT emit markers by default (backwards compatible)', () => {
    expect(renderToString(html`<div>Hello ${'World'}</div>`)).toBe('<div>Hello World</div>');
  });

  it('emits node-position markers when { hydrate: true }', () => {
    const out = renderToString(html`<div>Hello ${'World'}</div>`, { hydrate: true });
    expect(out).toBe('<div>Hello <!--CRP_0-->World<!--/CRP--></div>');
  });

  it('emits markers for multiple node positions', () => {
    const out = renderToString(html`<div>${'a'}<span>${'b'}</span></div>`, { hydrate: true });
    expect(out).toBe('<div><!--CRP_0-->a<!--/CRP--><span><!--CRP_1-->b<!--/CRP--></span></div>');
  });

  it('keeps attributes clean (no markers in attribute values)', () => {
    const out = renderToString(html`<div class="btn ${'active'}">x</div>`, { hydrate: true });
    expect(out).toBe('<div class="btn active">x</div>');
  });

  it('emits nested markers for nested templates', () => {
    const inner = html`<b>${'x'}</b>`;
    const out = renderToString(html`<div>${inner}</div>`, { hydrate: true });
    expect(out).toBe('<div><!--CRP_0--><b><!--CRP_0-->x<!--/CRP--></b><!--/CRP--></div>');
  });

  it('suppresses the `ref` directive attribute (no malformed `ref=` in output)', () => {
    const refObj = { value: undefined } as any;
    const out = renderToString(html`<input ref=${refObj} class="x" />`, { hydrate: true });
    expect(out).not.toContain('ref');
    expect(out).toBe('<input class="x" />');
  });
});

describe('hydrate() — DOM preservation', () => {
  it('preserves existing element nodes (same node identity)', () => {
    const container = ssrContainer(html`<div class="static">Hello</div>`);
    const originalDiv = container.querySelector('div')!;
    const originalText = originalDiv.firstChild!;
    expect(originalDiv).toBeTruthy();

    hydrate(html`<div class="static">Hello</div>`, container);

    // The exact same element node must survive hydration.
    expect(container.querySelector('div')).toBe(originalDiv);
    expect(container.querySelector('div')!.firstChild).toBe(originalText);
  });

  it('preserves nodes for nested static structure', () => {
    const container = ssrContainer(html`<ul><li>a</li><li>b</li></ul>`);
    const li0 = container.querySelectorAll('li')[0];
    const li1 = container.querySelectorAll('li')[1];

    hydrate(html`<ul><li>a</li><li>b</li></ul>`, container);

    expect(container.querySelectorAll('li')[0]).toBe(li0);
    expect(container.querySelectorAll('li')[1]).toBe(li1);
  });

  it('binds dynamic attributes to existing elements without recreating them', () => {
    const container = ssrContainer(html`<div class="btn active">x</div>`);
    const div = container.querySelector('div')!;

    hydrate(html`<div class="btn ${'active'}">x</div>`, container);

    expect(container.querySelector('div')).toBe(div);
    expect(div.getAttribute('class')).toBe('btn active');
  });

  it('updates dynamic attributes after hydration', () => {
    const container = ssrContainer(html`<div class="btn active">x</div>`);

    function tpl(v: string) {
      return html`<div class="btn ${v}">x</div>`;
    }
    hydrate(tpl('active'), container);
    expect(container.querySelector('div')!.getAttribute('class')).toBe('btn active');

    // Subsequent render() reconciles via the cached parts (no wipe).
    render(tpl('disabled'), container);
    expect(container.querySelector('div')!.getAttribute('class')).toBe('btn disabled');
  });

  it('preserves text interpolation nodes', () => {
    const container = ssrContainer(html`<div>Hello ${'World'}</div>`);
    hydrate(html`<div>Hello ${'World'}</div>`, container);
    expect(container.querySelector('div')!.textContent).toBe('Hello World');
  });

  it('updates interpolated text after hydration', () => {
    const container = ssrContainer(html`<div>Hello ${'World'}</div>`);
    hydrate(html`<div>Hello ${'World'}</div>`, container);

    render(html`<div>Hello ${'Cossack'}</div>`, container);
    expect(container.querySelector('div')!.textContent).toBe('Hello Cossack');
  });

  it('hydrates nested templates preserving the subtree', () => {
    const inner = (v: string) => html`<b>${v}</b>`;
    // Helper so both calls share the SAME tagged-template strings array
    // (tagged-template caching is per source location).
    const outer = (v: string) => html`<div>${inner(v)}</div>`;
    const container = ssrContainer(outer('x'));
    const bold = container.querySelector('b')!;

    hydrate(outer('x'), container);

    // The <b> element survives hydration (adopted, not rebuilt).
    expect(container.querySelector('b')).toBe(bold);
    expect(bold.textContent).toBe('x');

    // And updates flow through the adopted parts.
    render(outer('y'), container);
    expect(container.querySelector('b')).toBe(bold);
    expect(bold.textContent).toBe('y');
  });

  it('falls back to a full render when the DOM does not match the template', () => {
    // Container has totally different content from the template.
    const container = document.createElement('div');
    container.innerHTML = '<p>unrelated</p>';

    // Should not throw; should produce the correct rendered output.
    expect(() => hydrate(html`<div class="btn ${'active'}">x</div>`, container)).not.toThrow();
    expect(container.querySelector('div')!.getAttribute('class')).toBe('btn active');
  });

  it('falls back to render when container is empty', () => {
    const container = document.createElement('div');
    hydrate(html`<div>${'hi'}</div>`, container);
    expect(container.querySelector('div')!.textContent).toBe('hi');
  });

  it('tolerates whitespace differences (minified SSR vs unminified template)', () => {
    // Simulate production: SSR output is minified (no whitespace between
    // tags), while the client compiles the blueprint from the unminified
    // template literal (which has newlines/indentation).
    const container = document.createElement('div');
    container.innerHTML = '<ul><li>a</li><li>b</li></ul>';
    const li0 = container.querySelectorAll('li')[0];
    const li1 = container.querySelectorAll('li')[1];

    hydrate(html`<ul>
      <li>a</li>
      <li>b</li>
    </ul>`, container);

    // Despite the whitespace mismatch, nodes are preserved (true hydration).
    expect(container.querySelectorAll('li')[0]).toBe(li0);
    expect(container.querySelectorAll('li')[1]).toBe(li1);
  });

  it('hydrates a node-position value that is itself a template with top-level markers', () => {
    // The inner template emits its OWN CRP markers at the top level of the
    // value region, so the reconcile must use depth-aware marker matching
    // (not pair the outer start with the first inner /CRP).
    const inner = (v: string) => html`${v} - text`;
    const outer = (v: string) => html`<div>${inner(v)}</div>`;
    const container = ssrContainer(outer('a'));

    hydrate(outer('a'), container);
    expect(container.querySelector('div')!.textContent).toBe('a - text');

    // Update flows through.
    render(outer('b'), container);
    expect(container.querySelector('div')!.textContent).toBe('b - text');
  });
});

describe('hydrate() — components & lists', () => {
  it('instantiates a component during hydration and renders its output', async () => {
    class Badge extends CossackElement {
      render() {
        return html`<span class="badge">new</span>`;
      }
    }
    // Build SSR output for a template that embeds the component via a helper.
    const embed = () => html`<div>${{ _type: 'COMPONENT', clazz: Badge, props: {}, children: null } as any}</div>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(embed(), { hydrate: true });

    hydrate(embed(), container);
    // Component render runs via an async requestUpdate(); let it flush.
    await Promise.resolve();
    await Promise.resolve();
    const span = container.querySelector('span.badge');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('new');
  });

  it('hydrates arrays by rebuilding the list (safe fallback) with correct content', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(html`<ul>${['a', 'b'].map((i) => html`<li>${i}</li>`)}</ul>`, { hydrate: true });

    hydrate(html`<ul>${['a', 'b'].map((i) => html`<li>${i}</li>`)}</ul>`, container);
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('a');
    expect(items[1].textContent).toBe('b');
  });
});

describe('mount() with hydration', () => {
  it('hydrates on first render then reconciles on updates', async () => {
    class Counter extends CossackElement {
      n = 0;
      render() {
        return html`<button class="cnt">Count: ${this.n}</button>`;
      }
    }
    // Simulate SSR: render to string with markers, put in a container.
    const ssrEl = document.createElement('div');
    const tmp = new Counter();
    ssrEl.innerHTML = renderToString(tmp.render()!, { hydrate: true });
    const btn = ssrEl.querySelector('button')!;

    // Mount with hydration: the existing <button> must be preserved.
    const inst = new Counter();
    inst.mount(ssrEl, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(ssrEl.querySelector('button')).toBe(btn);
    expect(btn.textContent).toBe('Count: 0');

    // Update: value flows through to the same node.
    inst.n = 5;
    await inst.requestUpdate();
    expect(ssrEl.querySelector('button')).toBe(btn);
    expect(btn.textContent).toBe('Count: 5');
  });
});
