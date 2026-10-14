import { describe, it, expect } from 'vitest';
import { html, render, renderToString, hydrate, component } from './cossack-html';
import { CossackElement, getComponentRange } from './cossack-element';
import { repeat } from './directives';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const elementsInRange = (instance: CossackElement): string[] => {
  const range = getComponentRange(instance)!;
  const out: string[] = [];
  for (let node = range.start.nextSibling; node && node !== range.end; node = node.nextSibling) {
    if (node.nodeType === Node.ELEMENT_NODE) out.push(`${(node as Element).localName}:${node.textContent}`);
  }
  return out;
};

describe('component() DOM range', () => {
  const instances: Record<string, CossackElement> = {};
  class Child extends CossackElement {
    declare props: { name: string };
    connectedCallback() { instances[this.props.name] = this; super.connectedCallback(); }
    render() { return html`<span>${this.props.name}</span><b>!</b>`; }
  }
  const page = (names: string[]) => html`<div><p>before</p>${repeat(names, (n) => n, (name) => component(Child, { name }))}<p>after</p></div>`;

  it('gives each child start/end markers that bracket exactly its own nodes', async () => {
    const container = document.createElement('div');
    render(page(['a', 'b']), container);
    await flush();
    const a = instances.a;
    expect(getComponentRange(a)!.start.nodeType).toBe(Node.COMMENT_NODE);
    expect(getComponentRange(a)!.end.nodeType).toBe(Node.COMMENT_NODE);
    expect(elementsInRange(a)).toEqual(['span:a', 'b:!']);
    expect(elementsInRange(instances.b)).toEqual(['span:b', 'b:!']);
    expect(getComponentRange(a)!.start.parentNode).toBe(container.querySelector('div'));
  });

  it('keeps the range valid when the child is moved or re-rendered', async () => {
    const container = document.createElement('div');
    render(page(['a', 'b']), container);
    await flush();
    const a = instances.a;
    render(page(['b', 'a']), container);
    await flush();
    expect(instances.a).toBe(a);
    expect(elementsInRange(a)).toEqual(['span:a', 'b:!']);
  });

  it('is set for hydrated children too and cleared on teardown', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(page(['a']), { hydrate: true });
    const span = container.querySelector('span');
    hydrate(page(['a']), container);
    await flush();
    const a = instances.a;
    expect(container.querySelector('span')).toBe(span);
    expect(elementsInRange(a)).toEqual(['span:a', 'b:!']);
    render(page([]), container);
    expect(getComponentRange(a)).toBeUndefined();
  });
});
