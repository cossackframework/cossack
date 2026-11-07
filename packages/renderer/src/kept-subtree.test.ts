import { describe, expect, it } from 'vitest';
import { html, render, component, type TemplateResult } from './cossack-html';
import { CossackElement } from './cossack-element';
import { guard } from './directives';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let renders = 0;
const created: CossackElement[] = [];
class Child extends CossackElement {
  connectedCallback() { created.push(this); super.connectedCallback(); }
  render() { renders++; return html`<i>child</i>`; }
}
class Other extends CossackElement {
  connectedCallback() { created.push(this); super.connectedCallback(); }
  render() { return html`<b>other</b>`; }
}

// An editor keeps the template of a hidden tab: the same template object again
// is a snapshot of the same values, so its subtree and components stay as they are.
describe('a template rendered again as the same object', () => {
  class Page extends CossackElement {
    static properties = { showFirst: {}, showLast: {}, text: {} };
    declare showFirst: boolean;
    declare showLast: boolean;
    declare text: string;
    keep = true;
    kept: TemplateResult | undefined;
    render() {
      const tab = this.keep ? this.kept ??= html`<section>${component(Child)}</section>` : html`<section>${component(Child)}</section>`;
      return html`${this.showFirst ? component(Other) : null}${tab}<p>${this.text}</p>${this.showLast ? component(Other) : null}`;
    }
  }
  const mount = async (keep: boolean) => {
    renders = 0;
    created.length = 0;
    const page = new Page();
    page._id = 'p';
    page.keep = keep;
    page.showFirst = true;
    page.showLast = false;
    page.text = 'a';
    const container = document.createElement('div');
    page.mount(container);
    await flush();
    return { page, container };
  };

  it('leaves the subtree and its components as they are', async () => {
    const { page, container } = await mount(true);
    const section = container.querySelector('section');
    expect(renders).toBe(1);
    page.text = 'b';
    await flush();
    expect(container.querySelector('p')!.textContent).toBe('b');
    expect(container.querySelector('section')).toBe(section);
    expect(renders).toBe(1);
  });

  it('numbers a component after the kept subtree as a full render does', async () => {
    const ids = async (keep: boolean) => {
      const { page } = await mount(keep);
      // The first component goes, freeing its id; one after the subtree comes.
      page.showFirst = false;
      await flush();
      page.showLast = true;
      await flush();
      return created.map(instance => `${instance.constructor.name} ${instance._id}`);
    };
    const full = await ids(false);
    expect(await ids(true)).toEqual(full);
  });
});

describe('guard with unchanged deps', () => {
  class Guarded extends CossackElement {
    static properties = { dep: {}, text: {}, plain: {} };
    declare dep: number;
    declare text: string;
    declare plain: boolean;
    factoryRuns = 0;
    render() {
      const guarded = guard([this.dep], () => { this.factoryRuns++; return html`<section>${component(Child)}</section>`; });
      return html`${this.plain ? 'plain' : guarded}<p>${this.text}</p>`;
    }
  }
  const mount = async () => {
    renders = 0;
    const host = new Guarded();
    host._id = 'g';
    host.dep = 1;
    host.text = 'a';
    host.plain = false;
    const container = document.createElement('div');
    host.mount(container);
    await flush();
    return { host, container };
  };

  it('does not render its components again until a dep changes', async () => {
    const { host } = await mount();
    host.text = 'b';
    await flush();
    expect([host.factoryRuns, renders]).toEqual([1, 1]);
    host.dep = 2;
    await flush();
    expect([host.factoryRuns, renders]).toEqual([2, 2]);
  });

  it('starts over after another value replaced it, instead of bringing back the old one', async () => {
    const { host, container } = await mount();
    host.plain = true;
    await flush();
    expect(container.textContent).toContain('plain');
    host.plain = false;
    await flush();
    expect(host.factoryRuns).toBe(2);
    expect(container.querySelector('section i')!.textContent).toBe('child');
  });
});

it('renders a template again when a parent hands over a new one with the same strings', () => {
  const container = document.createElement('div');
  const template = (text: string) => html`<p>${text}</p>`;
  render(template('a'), container);
  render(template('b'), container);
  expect(container.querySelector('p')!.textContent).toBe('b');
});
