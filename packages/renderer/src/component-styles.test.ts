import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, html, hydrate, render, renderToString, type TemplateResult } from './cossack-html';
import { CossackElement } from './cossack-element';
import { css } from './css';
import { collectComponentStyles, renderComponentStyles } from './style-runtime';

const headStyles = (scopeId: string, root: ParentNode = document.head) =>
  root.querySelectorAll(`style[data-cossack-style="${scopeId}"]`);
// Component updates run in microtasks that may schedule the deferred style
// release after a first timer; two macrotask turns let both settle.
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async () => { await nextTask(); await nextTask(); };
const scopeOf = (clazz: new () => CossackElement) => new clazz()._getStyleScopeId()!;

class Card extends CossackElement {
  static styles = css`.card { border: 1px solid; }`;
  render() { return html`<li class="card">${this.props.label}</li>`; }
}
class Badge extends CossackElement {
  static styles = css`.badge { font-weight: 700; }`;
  render() { return html`<b class="badge">${this.props.label}</b>`; }
}
class Note extends CossackElement {
  static styles = css`.note { font-style: italic; }`;
  render() { return html`<em class="note">note</em>`; }
}

const cards = (labels: string[]) => html`<ul>${labels.map((label) => component(Card, { label } as any))}</ul>`;
const containers: Element[] = [];
const connected = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  return container;
};
afterEach(async () => {
  for (const container of containers.splice(0)) render(html``, container);
  await settle();
  for (const container of document.body.querySelectorAll('div')) container.remove();
});

describe('component styles on SSR', () => {
  it('collects one style per scope, in first-use order, and keeps it out of the markup', () => {
    const page = html`<main>${component(Badge, { label: 'a' } as any)}${cards(['1', '2', '3'])}${component(Badge, { label: 'b' } as any)}${component(Note)}</main>`;
    const { result, styles } = collectComponentStyles(() => renderToString(page, { hydrate: true }));
    expect(styles.map((style) => style.scopeId)).toEqual([scopeOf(Badge), scopeOf(Card), scopeOf(Note)]);
    expect(styles[1].cssText).toBe(`.card[data-cossack-scope="${scopeOf(Card)}"]{border:1px solid}`);
    expect(result).not.toContain('<style');
    expect(result.match(/class="card"/g)).toHaveLength(3);
  });

  it('marks styled output like unstyled output so hydration stays exact', () => {
    class Plain extends CossackElement {
      render() { return html`<li class="card">${this.props.label}</li>`; }
    }
    const styled = renderToString(html`${component(Card, { label: 'x' } as any)}`, { hydrate: true });
    const plain = renderToString(html`${component(Plain, { label: 'x' } as any)}`, { hydrate: true });
    expect(styled.replace(/ data-cossack-scope="[^"]+"/g, '')).toBe(plain);
  });

  it('collects styles for output a styled component does not own', () => {
    class Wrapper extends CossackElement {
      static styles = css`@font-face { font-family: Demo; src: url(demo.woff2); }`;
      render() { return this.children as TemplateResult; }
    }
    class Text extends CossackElement {
      static styles = css`.unused { color: red; }`;
      render() { return 'plain text' as unknown as TemplateResult; }
    }
    // The projected template belongs to the (unstyled) Page, not to Wrapper.
    class Page extends CossackElement {
      render() { return html`${component(Wrapper, {}, html`<p>projected</p>`)}${component(Text)}`; }
    }
    const { result, styles } = collectComponentStyles(() => renderToString(html`${component(Page)}`));
    expect(styles.map((style) => style.scopeId)).toEqual([scopeOf(Wrapper), scopeOf(Text)]);
    expect(result).toBe('<p>projected</p>plain text');
  });

  it('collects nothing outside a collector and counts nested collections once', () => {
    expect(renderToString(cards(['1']))).not.toContain('<style');
    const outer = collectComponentStyles(() => {
      const inner = collectComponentStyles(() => renderToString(cards(['1'])));
      expect(inner.styles).toHaveLength(1);
      return renderToString(html`${component(Note)}${cards(['2'])}`);
    });
    expect(outer.styles.map((style) => style.scopeId)).toEqual([scopeOf(Card), scopeOf(Note)]);
  });

  it('renders head style elements that cannot end early', () => {
    expect(renderComponentStyles([{ scopeId: 'cabc', cssText: 'a::after { content: "</style>"; }' }]))
      .toBe('<style data-cossack-style="cabc">a::after { content: "<\\/style>"; }</style>');
  });
});

describe('component styles on the client', () => {
  it('shares one head style between all instances and inserts it before updated() runs', async () => {
    const seen: number[] = [];
    class Measured extends CossackElement {
      static styles = css`.measured { width: 10px; }`;
      render() { return html`<span class="measured"></span>`; }
      updated() { seen.push(headStyles(scopeOf(Measured)).length); }
    }
    const container = connected();
    render(html`${[1, 2, 3].map(() => component(Measured))}${cards(['a', 'b', 'c', 'd'])}`, container);
    await settle();
    expect(seen).toEqual([1, 1, 1]);
    expect(headStyles(scopeOf(Card))).toHaveLength(1);
    expect(container.querySelectorAll('li.card')).toHaveLength(4);
    expect(container.querySelector('style')).toBeNull();
  });

  it('keeps the style while any instance remains and removes it after the last', async () => {
    const container = connected();
    render(cards(['a', 'b', 'c']), container);
    await settle();
    const style = headStyles(scopeOf(Card))[0];
    expect(style).toBeDefined();

    render(cards(['a']), container);
    await settle();
    expect(headStyles(scopeOf(Card))[0]).toBe(style);

    render(cards([]), container);
    // Removal waits for a macrotask, after nested components re-rendered.
    await Promise.resolve();
    expect(headStyles(scopeOf(Card))[0]).toBe(style);
    await settle();
    expect(headStyles(scopeOf(Card))).toHaveLength(0);
    expect(style.isConnected).toBe(false);
  });

  it('adopts server-rendered head styles on hydration', async () => {
    const page = () => html`<section>${cards(['a', 'b'])}${component(Badge, { label: 'x' } as any)}</section>`;
    const { result, styles } = collectComponentStyles(() => renderToString(page(), { hydrate: true }));
    document.head.insertAdjacentHTML('beforeend', renderComponentStyles(styles));
    const ssrCard = headStyles(scopeOf(Card))[0];
    const ssrBadge = headStyles(scopeOf(Badge))[0];
    const container = connected();
    container.innerHTML = result;
    const ssrItem = container.querySelector('li')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hydrate(page(), container);
    await settle();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    expect(container.querySelector('li')).toBe(ssrItem);
    expect(headStyles(scopeOf(Card))).toHaveLength(1);
    expect(headStyles(scopeOf(Card))[0]).toBe(ssrCard);
    expect(headStyles(scopeOf(Badge))[0]).toBe(ssrBadge);

    // The adopted elements are counted: the last teardown removes them.
    render(html`<p>next page</p>`, container);
    await settle();
    expect(ssrCard.isConnected).toBe(false);
    expect(ssrBadge.isConnected).toBe(false);
  });

  it('keeps shared styles across a navigation and adds the new page styles', async () => {
    class Layout extends CossackElement {
      static styles = css`.layout { display: grid; }`;
      render() { return html`<div class="layout">${this.children}</div>`; }
    }
    const app = (page: unknown) => html`${component(Layout, {}, page)}`;
    const container = connected();
    render(app(html`${cards(['a'])}${component(Note)}`), container);
    await settle();
    const layoutStyle = headStyles(scopeOf(Layout))[0];
    const cardStyle = headStyles(scopeOf(Card))[0];
    const noteStyle = headStyles(scopeOf(Note))[0];
    expect([layoutStyle, cardStyle, noteStyle].every(Boolean)).toBe(true);

    const removed: Node[] = [];
    const added: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        removed.push(...record.removedNodes);
        added.push(...record.addedNodes);
      }
    });
    observer.observe(document.head, { childList: true });
    // The next page keeps Card, drops Note and adds Badge.
    render(app(html`${cards(['b', 'c'])}${component(Badge, { label: 'new' } as any)}`), container);
    await settle();
    observer.disconnect();

    expect(headStyles(scopeOf(Layout))[0]).toBe(layoutStyle);
    expect(headStyles(scopeOf(Card))[0]).toBe(cardStyle);
    expect(headStyles(scopeOf(Card))).toHaveLength(1);
    expect(headStyles(scopeOf(Badge))).toHaveLength(1);
    expect(noteStyle.isConnected).toBe(false);
    expect(removed).toEqual([noteStyle]);
    expect(added).toEqual([headStyles(scopeOf(Badge))[0]]);
  });

  it('gives components in a shadow root their own copy', async () => {
    const host = connected();
    const shadow = host.attachShadow({ mode: 'open' });
    const lightContainer = connected();
    render(cards(['light']), lightContainer);
    render(cards(['shadow-1', 'shadow-2']), shadow);
    await settle();
    expect(headStyles(scopeOf(Card))).toHaveLength(1);
    expect(headStyles(scopeOf(Card), shadow)).toHaveLength(1);
    const shadowStyle = headStyles(scopeOf(Card), shadow)[0];
    expect(shadow.firstChild).toBe(shadowStyle);

    // Re-rendering the shadow root keeps its style while cards remain.
    render(html`<ol>${component(Card, { label: 'other' } as any)}</ol>`, shadow);
    await settle();
    expect(headStyles(scopeOf(Card), shadow)[0]).toBe(shadowStyle);
    expect(shadow.querySelectorAll('li.card')).toHaveLength(1);

    render(html`<p>empty</p>`, shadow);
    await settle();
    expect(headStyles(scopeOf(Card), shadow)).toHaveLength(0);
    expect(headStyles(scopeOf(Card))).toHaveLength(1);
  });

  it('re-counts a moved subtree in its new root without leaking the old count', async () => {
    const container = connected();
    render(cards(['a']), container);
    await settle();
    expect(headStyles(scopeOf(Card))).toHaveLength(1);

    const host = connected();
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(container);
    render(cards(['a']), container);
    await settle();
    expect(headStyles(scopeOf(Card), shadow)).toHaveLength(1);
    expect(headStyles(scopeOf(Card))).toHaveLength(0);

    render(cards([]), container);
    await settle();
    expect(headStyles(scopeOf(Card), shadow)).toHaveLength(0);
    expect(headStyles(scopeOf(Card))).toHaveLength(0);
  });

  it('never inserts a style for an instance discarded before its nodes were placed', async () => {
    class Transient extends CossackElement {
      static styles = css`.transient { color: red; }`;
      render() { return html`<i class="transient"></i>`; }
    }
    const detached = document.createElement('div');
    render(html`<i class="transient">${'x'}</i>`, detached);
    const template = new Transient()._finalizeRenderOutput(new Transient().render()) as TemplateResult;
    render(template, detached);
    render(html`<p>${'gone'}</p>`, detached);
    await settle();
    expect(headStyles(scopeOf(Transient))).toHaveLength(0);
  });
});
