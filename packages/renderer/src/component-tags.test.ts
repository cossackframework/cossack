import { describe, expect, it } from 'vitest';
import { captureRenderDrafts, component, html, hydrate, nothing, render, renderToString, svg, type TemplateResult } from './cossack-html';
import { CossackElement } from './cossack-element';
import { cache, key, repeat } from './directives';
import { compileComponentTags, decodeEntities } from './component-tags';
import { isComponentResult, type ComponentResult } from './component';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The ComponentResult inside a component() wrapper template. */
const componentOf = (value: unknown): ComponentResult => {
  const inner = (value as TemplateResult).values[0];
  if (!isComponentResult(inner)) throw new Error('expected a component() result');
  return inner;
};

class Card extends CossackElement {
  declare props: { hoverable?: boolean; padding?: string; title?: string; [key: string]: unknown };
  render() {
    const { hoverable, padding = 'default', title } = this.props;
    return html`<section class="card ${padding}" ?data-hover=${!!hoverable}>${title ? html`<h3>${title}</h3>` : nothing}${this.children}</section>`;
  }
}

class Button extends CossackElement {
  declare props: { variant?: string; '@click'?: (event: Event) => void };
  render() {
    const { variant = 'default', ...rest } = this.props;
    return html`<button class=${`btn ${variant}`} ...=${rest}>${this.children}</button>`;
  }
}

describe('component tags compile to component()', () => {
  it('maps attributes to props the way component() takes them', () => {
    const handler = () => {};
    const spread = { title: 'from spread', padding: 'lg' };
    const result = html`<${Card} hoverable padding="sm" title=${'Hi'} data-id="a &amp; b" class="x ${'y'}" .value=${1} @click=${handler} ?open=${true} ...=${spread} padding="xs"></${Card}>`;
    const card = componentOf(result.values[0]);
    expect(card.clazz).toBe(Card);
    expect(card.props).toEqual({
      hoverable: true, padding: 'xs', title: 'from spread', 'data-id': 'a & b', class: 'x y',
      '.value': 1, '@click': handler, '?open': true,
    });
    expect(card.children).toBeUndefined();
  });

  it('removes an interpolated prop that contains nothing', () => {
    const card = componentOf(html`<${Card} class="a ${nothing}" />`.values[0]);
    expect(card.props).toEqual({});
  });

  it('keeps the case of prop names', () => {
    const card = componentOf(html`<${Card} rowCount=${3} getRowId=${String} />`.values[0]);
    expect(Object.keys(card.props)).toEqual(['rowCount', 'getRowId']);
  });

  it('passes children as text, one value, a component or a template', () => {
    const value = { some: 'value' };
    expect(componentOf(html`<${Button}>Save</${Button}>`.values[0]).children).toBe('Save');
    expect(componentOf(html`<${Button}>  ${value}  </${Button}>`.values[0]).children).toBe(value);
    expect(componentOf(html`<${Button}>
    </${Button}>`.values[0]).children).toBeUndefined();
    const nested = componentOf(html`<${Card}><${Button} variant="ghost">Save</${Button}></${Card}>`.values[0]);
    const button = componentOf(nested.children);
    expect(button.clazz).toBe(Button);
    expect(button.props).toEqual({ variant: 'ghost' });
    const mixed = componentOf(html`<${Card}><p>${'a'}</p><${Button}>B</${Button}></${Card}>`.values[0]).children as TemplateResult;
    expect([...mixed.strings]).toEqual(['<p>', '</p>', '']);
    expect(mixed.values[0]).toBe('a');
    expect(componentOf(mixed.values[1]).children).toBe('B');
  });

  it('keeps template identity across calls', () => {
    const view = (title: string) => html`<div><${Card} title=${title}><b>${title}</b></${Card}></div>`;
    const first = view('a');
    const second = view('b');
    expect(first.strings).toBe(second.strings);
    expect((componentOf(first.values[0]).children as TemplateResult).strings)
      .toBe((componentOf(second.values[0]).children as TemplateResult).strings);
  });

  it('rejects a value that is not a class and a mismatched closing tag', () => {
    expect(() => html`<${'div'}></${'div'}>`).toThrow(/must bind a component class, not string/);
    expect(() => html`<${Card}></${Button}>`).toThrow(/Close a component tag with the same class/);
    expect(() => html`<div><${Card}></div>`).toThrow(/has no closing tag/);
    expect(() => html`<div></${Card}></div>`).toThrow(/no open component tag/);
  });

  it('leaves templates without component tags untouched', () => {
    const view = () => html`<p>${'x'}</p>`;
    expect(view().strings).toBe(view().strings);
    expect(compileComponentTags(['<p title="a<', '"></p>'])).toBeNull();
    expect(compileComponentTags(['<script>a<', '</script>'])).toBeNull();
  });

  it('compiles component tags in svg templates', () => {
    class Dot extends CossackElement {
      render() { return svg`<circle r=${String(this.props.r)} />`; }
    }
    expect(renderToString(html`<svg>${svg`<${Dot} r=${2} />`}</svg>`)).toBe('<svg><circle r="2" /></svg>');
  });

  it('decodes common character references in static values', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &unknown;')).toBe('a & b <c> "d" \'e\' &unknown;');
  });
});

describe('component tags match component() at runtime', () => {
  const tagView = (title: string, items: string[]) => html`
    <main>
      <${Card} hoverable padding="sm" title=${title}>
        <ul>${repeat(items, (item) => item, (item) => html`<li><${Button} variant="ghost">${item}</${Button}></li>`)}</ul>
        <${Button} @click=${() => {}}>Save</${Button}>
      </${Card}>
    </main>`;
  const callView = (title: string, items: string[]) => html`
    <main>
      ${component(Card, { hoverable: true, padding: 'sm', title }, html`
        <ul>${repeat(items, (item) => item, (item) => html`<li>${component(Button, { variant: 'ghost' }, item)}</li>`)}</ul>
        ${component(Button, { '@click': () => {} }, 'Save')}
      `)}
    </main>`;

  const normalize = (markup: string) => markup.replace(/<!--[^]*?-->/g, '').replace(/\s+/g, ' ').trim();

  it('renders the same SSR markup', () => {
    expect(normalize(renderToString(tagView('T', ['a', 'b'])))).toBe(normalize(renderToString(callView('T', ['a', 'b']))));
    expect(normalize(renderToString(tagView('T', ['a']), { hydrate: true })))
      .toBe(normalize(renderToString(callView('T', ['a']), { hydrate: true })));
  });

  it('emits the same hydration markers as component()', () => {
    const tag = renderToString(html`<div><${Button}>x</${Button}></div>`, { hydrate: true });
    const call = renderToString(html`<div>${component(Button, {}, 'x')}</div>`, { hydrate: true });
    expect(tag).toBe(call);
  });

  it('hydrates server markup in place', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(tagView('T', ['a', 'b']), { hydrate: true });
    const section = container.querySelector('section');
    const firstButton = container.querySelector('li button');
    hydrate(tagView('T', ['a', 'b']), container);
    await settle();
    expect(container.querySelector('section')).toBe(section);
    expect(container.querySelector('li button')).toBe(firstButton);
    expect(normalize(container.textContent!)).toBe('T ab Save');
  });

  it('updates retained component instances and replaces a changed class', async () => {
    const created: CossackElement[] = [];
    class Tracked extends CossackElement {
      connectedCallback() { created.push(this); super.connectedCallback(); }
      render() { return html`<i>${this.props.label}</i>`; }
    }
    class Other extends Tracked {}
    const container = document.createElement('div');
    const view = (clazz: typeof Tracked, label: string) => html`<p><${clazz} label=${label}></${clazz}></p>`;
    render(view(Tracked, 'one'), container);
    await settle();
    render(view(Tracked, 'two'), container);
    await settle();
    expect(created.length).toBe(1);
    expect(container.textContent).toBe('two');
    render(view(Other, 'three'), container);
    await settle();
    expect(created.length).toBe(2);
    expect(created[1]).toBeInstanceOf(Other);
    expect(container.textContent).toBe('three');
  });

  it('restores draft checkpoints the same way', async () => {
    const run = async (form: 'tag' | 'call') => {
      const instances: Draft[] = [];
      const capabilities = new WeakMap<object, string>();
      class Draft extends CossackElement {
        text = '';
        static _frameworkForkClientDraft(token: object) {
          const text = capabilities.get(token);
          if (text === undefined) return undefined;
          const fork = {};
          capabilities.set(fork, text);
          return fork;
        }
        _frameworkCaptureClientDraft() {
          const token = {};
          capabilities.set(token, this.text);
          return token;
        }
        _frameworkRestoreClientDraft(token: object) {
          const text = capabilities.get(token);
          if (text === undefined) return false;
          capabilities.delete(token);
          this.text = text;
          return true;
        }
        connectedCallback() { instances.push(this); super.connectedCallback(); }
        render() { return html`<span>${this.text}</span>`; }
      }
      const branch = () => form === 'tag' ? html`<${Draft}></${Draft}>` : html`${component(Draft)}`;
      const view = (visible: boolean) => html`<main>${key('owner', html`${cache(visible ? branch() : null)}`)}</main>`;
      const container = document.createElement('div');
      render(view(true), container);
      await settle();
      instances[0].text = 'kept';
      render(view(false), container);
      const snapshot = captureRenderDrafts(container);
      render(html`elsewhere`, container);
      snapshot.restore(() => true);
      render(view(false), container);
      render(view(true), container);
      await settle();
      return { count: instances.length, text: instances.at(-1)!.text, markup: container.innerHTML.replace(/<!--[^]*?-->/g, '') };
    };
    const tag = await run('tag');
    const call = await run('call');
    expect(tag).toEqual(call);
    expect(tag.text).toBe('kept');
  });

  it('captures the rendering owner as the parent', async () => {
    const parents: (CossackElement | null)[] = [];
    class Child extends CossackElement {
      connectedCallback() { parents.push(this.__parent); super.connectedCallback(); }
      render() { return html`<b>child</b>`; }
    }
    class Host extends CossackElement {
      render() { return html`<div><${Child} /></div>`; }
    }
    const host = new Host();
    const container = document.createElement('div');
    host.mount(container);
    await settle();
    await settle();
    expect(container.textContent).toBe('child');
    expect(parents).toEqual([host]);
  });
});
