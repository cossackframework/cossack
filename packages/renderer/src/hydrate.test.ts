import { describe, it, expect } from 'vitest';
import { html, renderToString, render, hydrate, unsafeHTML } from './cossack-html';
import { repeat, key } from './directives';
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

  it('falls back when the existing DOM has extra nodes beyond the template', () => {
    // Correct SSR content, but with an extra trailing element that the
    // template doesn't manage (e.g. injected by a browser extension). The
    // end-of-walk check must reject this so the stale node isn't orphaned.
    const container = document.createElement('div');
    container.innerHTML = '<div>Hello</div><span>extra</span>';

    expect(() => hydrate(html`<div>Hello</div>`, container)).not.toThrow();
    // Fell back to a full render: the stale <span> is gone and the template
    // owns the container.
    expect(container.querySelector('span')).toBeNull();
    expect(container.querySelector('div')!.textContent).toBe('Hello');
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

describe('hydrate() — components & lists (adoption)', () => {
  it('adopts a component subtree (preserves the SSR element node)', async () => {
    let rendered = 0;
    class Badge extends CossackElement {
      render() {
        rendered++;
        return html`<span class="badge">new</span>`;
      }
    }
    const embed = () => html`<div>${{ _type: 'COMPONENT', clazz: Badge, props: {}, children: null } as any}</div>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(embed(), { hydrate: true });
    const ssrSpan = container.querySelector('span.badge')!;

    hydrate(embed(), container);
    // Component render runs via an async requestUpdate(); let it flush.
    await Promise.resolve();
    await Promise.resolve();

    // The exact SSR <span> survives hydration (not rebuilt).
    expect(container.querySelector('span.badge')).toBe(ssrSpan);
    expect(ssrSpan.textContent).toBe('new');
  });

  it('adopts array items (preserves each SSR item node)', () => {
    const list = (vals: string[]) => html`<ul>${vals.map((v) => html`<li>${v}</li>`)}</ul>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(list(['a', 'b']), { hydrate: true });
    const ssrItems = Array.from(container.querySelectorAll('li'));

    hydrate(list(['a', 'b']), container);
    const after = container.querySelectorAll('li');
    expect(after.length).toBe(2);
    // Same node identity — the SSR <li>s were adopted.
    expect(after[0]).toBe(ssrItems[0]);
    expect(after[1]).toBe(ssrItems[1]);
    expect(after[0].textContent).toBe('a');
  });

  it('updates an adopted array (append / remove items reconcile in place)', () => {
    const list = (vals: string[]) => html`<ul>${vals.map((v) => html`<li>${v}</li>`)}</ul>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(list(['a', 'b']), { hydrate: true });
    hydrate(list(['a', 'b']), container);
    const item0 = container.querySelectorAll('li')[0];

    // Append a third item — the adopted part should reconcile, keeping item0.
    render(list(['a', 'b', 'c']), container);
    const after = container.querySelectorAll('li');
    expect(after.length).toBe(3);
    expect(after[0]).toBe(item0); // original item preserved across update
    expect(after[2].textContent).toBe('c');
  });

  it('adopts a `repeat()` list (preserves items, tracks keys)', () => {
    const container = document.createElement('div');
    const tpl = (items: { k: number; v: string }[]) =>
      html`<ul>${repeat(items, (i) => i.k, (i) => html`<li>${i.v}</li>`)}</ul>`;
    const data = [{ k: 1, v: 'a' }, { k: 2, v: 'b' }];
    container.innerHTML = renderToString(tpl(data), { hydrate: true });
    const ssrItems = Array.from(container.querySelectorAll('li'));

    hydrate(tpl(data), container);
    const after = container.querySelectorAll('li');
    expect(after.length).toBe(2);
    expect(after[0]).toBe(ssrItems[0]);
    expect(after[1]).toBe(ssrItems[1]);
  });

  it('adopts a `key()` region (preserves the SSR subtree)', () => {
    const tpl = (k: unknown, v: string) => html`<div>${key(k, html`<b>${v}</b>`)}</div>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(tpl('stable', 'x'), { hydrate: true });
    const ssrBold = container.querySelector('b')!;

    hydrate(tpl('stable', 'x'), container);
    expect(container.querySelector('b')).toBe(ssrBold);
    expect(ssrBold.textContent).toBe('x');
  });

  it('adopts unsafeHTML (keeps the SSR-parsed nodes)', () => {
    const tpl = (raw: string) => html`<div>${unsafeHTML(raw)}</div>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(tpl('<b>raw</b>'), { hydrate: true });
    const ssrBold = container.querySelector('b')!;

    hydrate(tpl('<b>raw</b>'), container);
    // The SSR <b> is preserved, not reparsed.
    expect(container.querySelector('b')).toBe(ssrBold);
    expect(ssrBold.textContent).toBe('raw');
  });

  it('falls back to rebuild when the array length differs from SSR', () => {
    const list = (vals: string[]) => html`<ul>${vals.map((v) => html`<li>${v}</li>`)}</ul>`;
    const container = document.createElement('div');
    container.innerHTML = renderToString(list(['a', 'b']), { hydrate: true });

    // Client template has a different length than the SSR DOM. Hydration must
    // not throw and must produce the correct (rebuilt) output.
    expect(() => hydrate(list(['a', 'b', 'c']), container)).not.toThrow();
    expect(container.querySelectorAll('li').length).toBe(3);
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
