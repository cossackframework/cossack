import { describe, it, expect } from 'vitest';
import { html, renderToString, component } from './cossack-html';
import { CossackElement, pushCurrentInstance, popCurrentInstance } from './cossack-element';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('nested component ids', () => {
  const created: CossackElement[] = [];
  class A extends CossackElement {
    connectedCallback() { created.push(this); super.connectedCallback(); }
    render() { return html`<i>A</i>`; }
  }
  class B extends CossackElement {
    connectedCallback() { created.push(this); super.connectedCallback(); }
    render() { return html`<b>B</b>`; }
  }
  class C extends CossackElement {
    connectedCallback() { created.push(this); super.connectedCallback(); }
    render() { return html`<u>C</u>`; }
  }
  class Parent extends CossackElement {
    static properties = { showA: {}, showC: {} };
    declare showA: boolean;
    declare showC: boolean;
    render() {
      return html`<div>${this.showA ? component(A) : null}${component(B)}${this.showC ? component(C) : null}</div>`;
    }
  }

  const mount = async (showA: boolean) => {
    created.length = 0;
    const parent = new Parent();
    parent._id = 'p';
    parent.showA = showA;
    parent.showC = false;
    const container = document.createElement('div');
    parent.mount(container);
    await flush();
    return { parent, container };
  };

  it('gives a conditionally inserted child an id distinct from its retained sibling', async () => {
    const { parent, container } = await mount(false);
    const b = created.find((c) => c instanceof B)!;
    expect(b._id).toBe('p:0');

    parent.showA = true;
    await flush();
    const a = created.find((c) => c instanceof A)!;
    expect(container.textContent).toBe('AB');
    expect(a._id).not.toBe(b._id);

    parent.showC = true;
    await flush();
    const c = created.find((x) => x instanceof C)!;
    expect(new Set([a._id, b._id, c._id]).size).toBe(3);
  });

  it('reuses an id once its owner is gone', async () => {
    const { parent } = await mount(true);
    const [a1, b] = created;
    expect([a1._id, b._id]).toEqual(['p:0', 'p:1']);
    parent.showA = false;
    await flush();
    parent.showA = true;
    await flush();
    const a2 = created[2];
    expect(a2).toBeInstanceOf(A);
    expect(a2._id).not.toBe(b._id);
  });

  it('matches SSR ids on the first client render', async () => {
    created.length = 0;
    renderToString(component(Parent, { showA: true, showC: true } as any));
    const ssrIds = created.map((c) => c._id.replace(/^[^:]*/, 'p'));

    created.length = 0;
    const parent = new Parent();
    parent._id = 'p';
    parent.showA = true;
    parent.showC = true;
    parent.mount(document.createElement('div'));
    await flush();
    expect(created.map((c) => c._id)).toEqual(['p:0', 'p:1', 'p:2']);
    expect(ssrIds).toEqual(['p:0', 'p:1', 'p:2']);
  });

  it('keeps SSR ids deterministic across repeated render passes', () => {
    const parent = new Parent();
    parent._id = 'p';
    parent.showA = true;
    parent.showC = true;
    const passes: string[][] = [];
    for (let pass = 0; pass < 2; pass++) {
      created.length = 0;
      parent.resetRenderState();
      pushCurrentInstance(parent);
      try {
        renderToString(parent.render());
      } finally {
        popCurrentInstance();
      }
      passes.push(created.map((c) => c._id));
    }
    expect(passes).toEqual([['p:0', 'p:1', 'p:2'], ['p:0', 'p:1', 'p:2']]);
  });
});
